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
