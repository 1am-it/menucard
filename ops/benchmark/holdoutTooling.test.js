'use strict';

// Runtime guards for the holdout CLI itself. Every case stops before a real
// source read: a second evaluation, a second capture, a non-pinned host and a
// tuned source are refused by the manifest/output checks. Fixtures live in a
// temporary folder inside the repository (the CLI refuses paths outside it)
// and are removed again by this test.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TMP_DIR = path.join(__dirname, '.holdout-tooling-test');
const CAPTURE = path.join(REPO_ROOT, 'ops', 'scripts', 'capture-menu-extraction-holdout-references.js');
const PROBE = path.join(REPO_ROOT, 'ops', 'scripts', 'probe-menu-extraction-holdout.js');
const TRANSITION = path.join(REPO_ROOT, 'ops', 'scripts', 'transition-menu-extraction-holdout.js');
const { repositoryTextSha256, validateHoldoutManifest, holdoutSelectionDigest } = require('./holdoutManifest');

function fixtureManifest(name, overrides = {}) {
  const definition = {
    version: '1.0.0',
    pinnedAt: '2026-10-21',
    authorization: { reference: 'fixture-only', appProviderActivation: false },
    sources: [
      {
        id: 'FIX-01',
        label: 'Fixture source',
        url: 'https://fixture.invalid/menu',
        allowedHosts: ['fixture.invalid'],
        evaluationState: 'unused',
        evaluationCount: 0,
        usedForTuning: false,
      },
    ],
    ...overrides,
  };
  const file = path.join(TMP_DIR, `${name}-sources.json`);
  fs.writeFileSync(file, `${JSON.stringify(definition, null, 2)}\n`);
  return file;
}

function run(script, manifestPath) {
  return spawnSync(process.execPath, [script, '--manifest', path.relative(REPO_ROOT, manifestPath)], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test.before(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

test.after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test('the probe refuses a second evaluation before reading any source', () => {
  const file = fixtureManifest('second-evaluation');
  fs.writeFileSync(path.join(TMP_DIR, 'second-evaluation-evaluation.json'), '{}\n');
  const result = run(PROBE, file);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists; a holdout is evaluated at most once/);
});

test('the capture refuses to overwrite a pinned source version', () => {
  const file = fixtureManifest('second-capture');
  fs.writeFileSync(path.join(TMP_DIR, 'second-capture-references.json'), '{}\n');
  const result = run(CAPTURE, file);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists; the pinned source version is immutable/);
});

test('the probe refuses an evaluation without a pinned capture', () => {
  const file = fixtureManifest('without-capture');
  const result = run(PROBE, file);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /capture the pinned source version first/);
});

test('a host outside the pinned allowedHosts is refused before any fetch', () => {
  const file = fixtureManifest('unpinned-host', {
    sources: [
      {
        id: 'FIX-01',
        label: 'Non-pinned host',
        url: 'https://evil.invalid/menu',
        allowedHosts: ['fixture.invalid'],
        evaluationState: 'unused',
        evaluationCount: 0,
        usedForTuning: false,
      },
    ],
  });
  const result = run(CAPTURE, file);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /allowedHosts/);
  assert.equal(fs.existsSync(path.join(TMP_DIR, 'unpinned-host-references.json')), false, 'no capture was written');
});

test('a tuned source is refused as a holdout', () => {
  const file = fixtureManifest('tuned', {
    sources: [
      {
        id: 'FIX-01',
        label: 'Tuned source',
        url: 'https://fixture.invalid/menu',
        allowedHosts: ['fixture.invalid'],
        evaluationState: 'used_for_tuning',
        evaluationCount: 1,
        usedForTuning: true,
      },
    ],
  });
  const result = run(PROBE, file);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no longer a holdout/);
});

// ─── the tooling-only holdout lifecycle (#59 review 6316295818) ───────────

/** A complete, self-consistent fixture: manifest + capture + evaluation. */
function lifecycleFixture(name, { evaluationManifestHash = null, evaluationBytesSuffix = '' } = {}) {
  const manifestFile = fixtureManifest(name);
  const prefix = path.basename(manifestFile, '-sources.json');
  const manifestBytes = fs.readFileSync(manifestFile);
  const manifestHash = repositoryTextSha256(manifestBytes);
  const relativeManifest = path.relative(REPO_ROOT, manifestFile).split(path.sep).join('/');
  const evaluation = {
    version: '1.0.0',
    evaluatedAt: '2026-10-21T10:00:00.000Z',
    manifest: { path: relativeManifest, bytesSha256: evaluationManifestHash || manifestHash, sourceCount: 1 },
    results: { 'FIX-01': { pinnedBytesSha256: 'a'.repeat(64), status: 'executed_with_limitation' } },
  };
  const references = {
    version: '1.1.0',
    manifest: { path: relativeManifest, bytesSha256: manifestHash, sourceCount: 1 },
    sources: { 'FIX-01': { captureStatus: 'captured', bytesSha256: 'a'.repeat(64) } },
  };
  fs.writeFileSync(path.join(TMP_DIR, `${prefix}-evaluation.json`), `${JSON.stringify(evaluation, null, 2)}\n${evaluationBytesSuffix}`);
  fs.writeFileSync(path.join(TMP_DIR, `${prefix}-references.json`), `${JSON.stringify(references, null, 2)}\n`);
  return { manifestFile, prefix, manifestHash, evaluation, references };
}

function runTransition(manifestFile, ...args) {
  return spawnSync(process.execPath, [TRANSITION, '--manifest', path.relative(REPO_ROOT, manifestFile), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('the lifecycle tool records exactly one evaluation and then the tuning decision', () => {
  const { manifestFile, manifestHash, evaluation } = lifecycleFixture('lifecycle');
  const first = runTransition(manifestFile, '--step', 'evaluated_once', '--at', '2026-10-22');
  assert.equal(first.status, 0, first.stderr);
  let manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.sources[0].evaluationState, 'evaluated_once');
  assert.equal(manifest.sources[0].evaluationCount, 1);
  assert.equal(manifest.sources[0].usedForTuning, false);
  assert.equal(manifest.sources[0].firstEvaluation.manifestBytesSha256, manifestHash);
  assert.equal(manifest.sources[0].firstEvaluation.evaluatedAt, evaluation.evaluatedAt);
  assert.equal(manifest.sources[0].firstEvaluation.selectionDigest, holdoutSelectionDigest(manifest));

  // A second first-evaluation is refused, both by the tool and the guard.
  const again = runTransition(manifestFile, '--step', 'evaluated_once');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /only an unused source may be evaluated|at most once/);

  // The tuning step needs an explicit decision.
  const withoutDecision = runTransition(manifestFile, '--step', 'used_for_tuning');
  assert.equal(withoutDecision.status, 1);
  assert.match(withoutDecision.stderr, /--decision is required/);

  const tuned = runTransition(manifestFile, '--step', 'used_for_tuning', '--decision', 'fixture-decision', '--at', '2026-10-22');
  assert.equal(tuned.status, 0, tuned.stderr);
  manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.sources[0].evaluationState, 'used_for_tuning');
  assert.equal(manifest.sources[0].usedForTuning, true);
  assert.equal(manifest.sources[0].tuningDecision.reference, 'fixture-decision');
  assert.equal(manifest.representative.reference, 'fixture-decision');
  assert.equal(validateHoldoutManifest(manifest, { mode: 'representative' }).ok, true);
  assert.equal(validateHoldoutManifest(manifest, { mode: 'evaluation' }).ok, false);
  assert.equal(validateHoldoutManifest(manifest, { mode: 'capture' }).ok, false);

  // No third state, no repeated tuning step.
  assert.equal(runTransition(manifestFile, '--step', 'used_for_tuning', '--decision', 'again').status, 1);
});

test('the lifecycle tool refuses an evaluation from another manifest version or a changed evaluation file', () => {
  const wrongHash = lifecycleFixture('lifecycle-wrong-hash', { evaluationManifestHash: 'b'.repeat(64) });
  const refused = runTransition(wrongHash.manifestFile, '--step', 'evaluated_once');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /does not belong to this pinned manifest/);

  const changed = lifecycleFixture('lifecycle-changed');
  assert.equal(runTransition(changed.manifestFile, '--step', 'evaluated_once').status, 0);
  const evaluationFile = path.join(TMP_DIR, `${changed.prefix}-evaluation.json`);
  fs.appendFileSync(evaluationFile, '\n');
  const stepTwo = runTransition(changed.manifestFile, '--step', 'used_for_tuning', '--decision', 'fixture-decision');
  assert.equal(stepTwo.status, 1);
  assert.match(stepTwo.stderr, /evaluation file changed/);
});

