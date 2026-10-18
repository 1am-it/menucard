'use strict';

// Guards the four Product Owner-approved holdout pins (issue #59, instruction
// 6248411416). The reference file is capture-only: it may pin a source version
// and an honest read outcome, but it may not contain a parser result, item
// count or fabricated ground truth. The first evaluation is recorded exactly
// once in the acceptance set and in the committed output.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sources = require('./holdout-sources.json');
const references = require('./holdout-references.json');
const acceptance = require('./menu-extraction-acceptance-set.json');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED_IDS = ['debotanist', 'gauchosgrill', 'mrmoos', 'colonie'];
const EXPECTED_URLS = [
  'https://debotanistbreda.nl/',
  'https://www.gauchosgrill.nl/breda',
  'https://mrmoos.nl/',
  'https://breda.colonie.nl/',
];

test('exactly the four approved public holdouts are pinned, with explicit non-provider authorization', () => {
  assert.equal(sources.version, '1.0.0');
  assert.match(sources.pinnedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(sources.authorization.reference, /6248411416/);
  assert.equal(sources.authorization.appProviderActivation, false);
  assert.match(sources.authorization.scope, /read-only/i);
  assert.deepEqual(sources.sources.map((source) => source.id).sort(), [...EXPECTED_IDS].sort());
  assert.deepEqual(sources.sources.map((source) => source.url).sort(), [...EXPECTED_URLS].sort());
  for (const source of sources.sources) {
    const host = new URL(source.url).hostname;
    assert.ok(source.allowedHosts.includes(host), `${source.id} host is explicitly allowed`);
    assert.match(source.class, /^[a-z_]+$/);
  }
});

test('the holdout reference pins source versions only, never parser outcomes or ground truth', () => {
  assert.equal(references.version, '1.0.0');
  assert.match(references.pinnedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(references.authorization.appProviderActivation, false);
  assert.deepEqual(Object.keys(references.sources).sort(), [...EXPECTED_IDS].sort());
  for (const [id, source] of Object.entries(references.sources)) {
    const where = `holdout reference ${id}`;
    assert.equal(source.referenceMode, 'capture_only', where);
    assert.equal(source.groundTruth, null, where);
    assert.equal(Object.prototype.hasOwnProperty.call(source, 'categories'), false, `${where}: no category ground truth`);
    assert.equal(Object.prototype.hasOwnProperty.call(source, 'items'), false, `${where}: no item ground truth`);
    assert.equal(Object.prototype.hasOwnProperty.call(source, 'expectedItemCount'), false, `${where}: no hardcoded count`);
    assert.equal(Object.prototype.hasOwnProperty.call(source, 'result'), false, `${where}: no parser result in the pin`);
    assert.ok(['captured', 'blocked', 'failed'].includes(source.captureStatus), where);
    assert.match(source.capturedAt, /^\d{4}-\d{2}-\d{2}T/, where);
    if (source.captureStatus === 'captured') {
      assert.ok(source.bytes > 0, where);
      assert.match(source.bytesSha256, SHA256, where);
      assert.ok(source.kind === 'html' || source.kind === 'pdf', where);
      const sourceEntry = sources.sources.find((entry) => entry.id === id);
      assert.ok(sourceEntry.allowedHosts.includes(new URL(source.finalUrl).hostname), `${where}: final URL stays on an approved host`);
    } else {
      assert.equal(source.bytesSha256, null, `${where}: an unreadable source has no fabricated hash`);
      assert.ok(Number.isInteger(source.httpStatus) && source.httpStatus >= 400 && source.httpStatus <= 599, where);
      assert.ok(typeof source.error === 'string' && source.error.length > 0, where);
    }
  }
});


test('each approved holdout records exactly one honest evaluation and no tuning', () => {
  const entries = acceptance.holdout.entries.filter((entry) => entry.provenance === 'real_source');
  assert.deepEqual(entries.map((entry) => entry.referenceId).sort(), [...EXPECTED_IDS].sort());
  for (const entry of entries) {
    assert.equal(entry.evaluationState, 'evaluated_once', entry.id);
    assert.equal(entry.evaluationCount, 1, entry.id);
    assert.equal(entry.usedForTuning, false, entry.id);
    assert.match(entry.firstEvaluatedAt, /^\d{4}-\d{2}-\d{2}$/, entry.id);
    assert.ok(typeof entry.result === 'string' && entry.result.length > 0, entry.id);
    const reference = references.sources[entry.referenceId];
    assert.ok(reference, `${entry.id} has a pinned reference`);
    if (reference.captureStatus !== 'captured') {
      assert.equal(entry.status, 'blocked', `${entry.id} must not claim a successful read`);
    }
  }
  const output = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-evaluation.json'), 'utf8'));
  assert.equal(output.noTuning, true);
  assert.match(output.note, /No parser or rule was changed/i);
  assert.deepEqual(Object.keys(output.results).sort(), entries.map((entry) => entry.id).sort());
});

test('the holdout scripts stay read-only and cannot run from a package script', () => {
  const capture = fs.readFileSync(path.join(REPO_ROOT, 'ops', 'scripts', 'capture-menu-extraction-holdout-references.js'), 'utf8');
  const probe = fs.readFileSync(path.join(REPO_ROOT, 'ops', 'scripts', 'probe-menu-extraction-holdout.js'), 'utf8');
  for (const [name, source] of [['capture', capture], ['probe', probe]]) {
    for (const forbidden of ['supabase', 'createClient', 'child_process', 'process.env', 'claude', 'openai']) {
      assert.equal(source.includes(forbidden), false, `${name} must not use ${forbidden}`);
    }
  }
  assert.match(capture, /safeOutboundFetch/);
  assert.match(probe, /sourceAnalysisPipeline/);
  assert.match(probe, /safeOutboundFetch/);
  assert.match(probe, /flag: 'wx'/);
  assert.match(capture, /flag: 'wx'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.equal(String(command).includes('probe-menu-extraction-holdout'), false, `holdout probe must not run from ${name}`);
    assert.equal(String(command).includes('capture-menu-extraction-holdout'), false, `holdout capture must not run from ${name}`);
  }
});
