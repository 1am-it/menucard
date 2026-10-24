'use strict';

// Guards the explicit-manifest holdout tooling added for holdout-2
// (#59 Delivery Lead review 6315269210). These tests never fetch a source:
// they validate manifests, output-path derivation and the approved-host rule
// with fixtures and `.invalid` hosts only. The pinned holdout-1 and holdout-2
// manifests are read as data; no URL from them is opened here.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const holdout1 = require('./holdout-sources.json');
const holdout2 = require('./holdout-2-sources.json');
const fs = require('node:fs');
const {
  DEFAULT_MANIFEST,
  assertApprovedHost,
  validateHoldoutManifest,
  isManifestDriven,
  evaluationEntriesFromManifest,
  holdoutOutputPaths,
  resolveManifestArgument,
  holdoutSelectionDigest,
  repositoryTextSha256,
} = require('./holdoutManifest');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function manifest(overrides = {}) {
  return {
    version: '1.0.0',
    pinnedAt: '2026-10-21',
    authorization: { reference: 'fixture', appProviderActivation: false },
    sources: [
      {
        id: 'fixture-1',
        label: 'Fixture One',
        url: 'https://fixture.invalid/menu',
        allowedHosts: ['fixture.invalid'],
        evaluationState: 'unused',
        evaluationCount: 0,
        usedForTuning: false,
      },
    ],
    ...overrides,
  };
}

test('the pinned holdout manifests are valid and holdout-2 is recorded as representative', () => {
  assert.equal(validateHoldoutManifest(holdout1, { mode: 'capture' }).ok, true);
  const second = validateHoldoutManifest(holdout2, { mode: 'representative' });
  assert.deepEqual(second.errors, []);
  assert.equal(holdout2.sources.length, 19);
  assert.equal(holdout2.authorization.appProviderActivation, false);
  assert.equal(isManifestDriven(holdout1), false, 'holdout-1 keeps its acceptance-set state');
  assert.equal(isManifestDriven(holdout2), true);
  assert.equal(holdout2.sources.every((source) => source.evaluationState === 'used_for_tuning'), true);
  assert.equal(holdout2.sources.every((source) => source.usedForTuning === true), true);
  assert.equal(holdout2.sources.every((source) => source.evaluationCount === 1), true);
  // The first evaluation is a real, committed one: every source points at the
  // same evaluation file and at the same source selection.
  const evaluationBytes = fs.readFileSync(path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-2-evaluation.json'));
  const evaluationSha256 = repositoryTextSha256(evaluationBytes);
  const selectionDigest = holdoutSelectionDigest(holdout2);
  for (const source of holdout2.sources) {
    assert.equal(source.firstEvaluation.path, 'ops/benchmark/holdout-2-evaluation.json');
    assert.equal(source.firstEvaluation.sha256, evaluationSha256);
    assert.equal(source.firstEvaluation.selectionDigest, selectionDigest);
    assert.equal(source.firstEvaluation.manifestBytesSha256, '151c34c0a383438a1227d71b1751f947b64a94e2397e69e00b4cbc89f283c2c8');
    assert.match(source.tuningDecision.reference, /6316295818/);
  }
  assert.equal(holdout2.representative.evaluation.sha256, evaluationSha256);
  // The same manifest can no longer be captured or evaluated as a holdout.
  assert.equal(validateHoldoutManifest(holdout2, { mode: 'capture' }).ok, false);
  assert.equal(validateHoldoutManifest(holdout2, { mode: 'evaluation' }).ok, false);
});


test('a holdout manifest refuses a tuned, already evaluated or second-pin source', () => {
  const tuned = manifest();
  tuned.sources[0].usedForTuning = true;
  assert.equal(validateHoldoutManifest(tuned).ok, false);
  assert.match(validateHoldoutManifest(tuned).errors.join('; '), /may not be used for tuning/);

  const stateTuned = manifest();
  stateTuned.sources[0].evaluationState = 'used_for_tuning';
  assert.match(validateHoldoutManifest(stateTuned).errors.join('; '), /no longer a holdout/);

  const evaluated = manifest();
  evaluated.sources[0].evaluationState = 'evaluated_once';
  evaluated.sources[0].evaluationCount = 1;
  const refusal = validateHoldoutManifest(evaluated);
  assert.equal(refusal.ok, false);
  assert.match(refusal.errors.join('; '), /second evaluation is refused/);
  assert.match(refusal.errors.join('; '), /at most once/);

  const reCapture = validateHoldoutManifest(evaluated, { mode: 'capture' });
  assert.match(reCapture.errors.join('; '), /capture must precede the first evaluation/);
});

test('a manifest refuses missing authorization, unsafe URLs, credentials and duplicates', () => {
  assert.equal(validateHoldoutManifest({}).ok, false);
  assert.match(validateHoldoutManifest(manifest({ authorization: { reference: 'x' } })).errors.join('; '), /provider activation/);
  const httpSource = { ...manifest().sources[0], url: 'http://fixture.invalid/' };
  assert.match(validateHoldoutManifest(manifest({ sources: [httpSource] })).errors.join('; '), /must be https/);
  const credentialSource = { ...manifest().sources[0], url: 'https://user:secret@fixture.invalid/' };
  assert.match(validateHoldoutManifest(manifest({ sources: [credentialSource] })).errors.join('; '), /must not carry credentials/);
  const wrongHost = { ...manifest().sources[0], allowedHosts: ['other.invalid'] };
  assert.match(validateHoldoutManifest(manifest({ sources: [wrongHost] })).errors.join('; '), /one of the pinned allowedHosts/);
  const hostWithPath = { ...manifest().sources[0], allowedHosts: ['fixture.invalid/path'] };
  assert.match(validateHoldoutManifest(manifest({ sources: [hostWithPath] })).errors.join('; '), /bare host names/);
  assert.match(
    validateHoldoutManifest(manifest({ sources: [manifest().sources[0], manifest().sources[0]] })).errors.join('; '),
    /duplicate source id/,
  );
  const sameUrl = { ...manifest().sources[0], id: 'fixture-2' };
  assert.match(validateHoldoutManifest(manifest({ sources: [manifest().sources[0], sameUrl] })).errors.join('; '), /duplicate source url/);
});

test('approved-host guard never accepts another host, http or credentials', () => {
  assert.doesNotThrow(() => assertApprovedHost('https://fixture.invalid/menu', ['fixture.invalid']));
  assert.throws(() => assertApprovedHost('https://evil.invalid/menu', ['fixture.invalid']), /not an approved holdout host/);
  assert.throws(() => assertApprovedHost('http://fixture.invalid/menu', ['fixture.invalid']), /not https/);
  assert.throws(() => assertApprovedHost('https://user:pass@fixture.invalid/', ['fixture.invalid']), /credentials/);
});

test('output paths are derived from the explicit manifest and keep holdout-1 byte-identical', () => {
  const first = holdoutOutputPaths(path.join(REPO_ROOT, DEFAULT_MANIFEST));
  assert.equal(path.basename(first.references), 'holdout-references.json');
  assert.equal(path.basename(first.evaluation), 'holdout-evaluation.json');
  const second = holdoutOutputPaths(path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-2-sources.json'));
  assert.equal(path.basename(second.references), 'holdout-2-references.json');
  assert.equal(path.basename(second.evaluation), 'holdout-2-evaluation.json');
});

test('manifest CLI stays inside the repository and refuses unknown arguments', () => {
  assert.equal(resolveManifestArgument([], REPO_ROOT), path.join(REPO_ROOT, DEFAULT_MANIFEST));
  assert.equal(
    resolveManifestArgument(['--manifest', 'ops/benchmark/holdout-2-sources.json'], REPO_ROOT),
    path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-2-sources.json'),
  );
  assert.equal(
    resolveManifestArgument(['--manifest=ops/benchmark/holdout-2-sources.json'], REPO_ROOT),
    path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-2-sources.json'),
  );
  assert.throws(() => resolveManifestArgument(['--manifest', '..\\outside.json'], REPO_ROOT), /inside the repository/);
  assert.throws(() => resolveManifestArgument(['--other'], REPO_ROOT), /unknown argument/);
  assert.throws(() => resolveManifestArgument(['--manifest'], REPO_ROOT), /requires a path/);
  assert.throws(
    () => resolveManifestArgument(['--manifest', 'a.json', '--manifest', 'b.json'], REPO_ROOT),
    /only once/,
  );
});

test('the evaluation plan comes from the manifest itself, never from another file', () => {
  assert.equal(evaluationEntriesFromManifest(holdout1), null);
  const entries = evaluationEntriesFromManifest(holdout2);
  assert.equal(entries.length, holdout2.sources.length);
  assert.deepEqual(entries.map((entry) => entry.id), holdout2.sources.map((source) => source.id));
  assert.deepEqual(entries[0].allowedHosts, holdout2.sources[0].allowedHosts);
  assert.equal(entries[0].referenceId, holdout2.sources[0].id);
});

test('a manifest fixture with a mixed evaluated state is still refused for evaluation', () => {
  const evaluatedSource = {
    ...manifest().sources[0],
    id: 'fixture-2',
    url: 'https://second.invalid/',
    allowedHosts: ['second.invalid'],
    evaluationState: 'evaluated_once',
    evaluationCount: 1,
  };
  const mixed = manifest({ sources: [manifest().sources[0], evaluatedSource] });
  const validation = validateHoldoutManifest(mixed, { mode: 'evaluation' });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('; '), /fixture-2/);
});
