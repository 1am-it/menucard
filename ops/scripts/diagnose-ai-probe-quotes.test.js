'use strict';

// Q2 of the Delivery Lead order for #59 / BE-21 (review 6375125413): the offline
// diagnosis command. Every case is injected: no key, no network, no provider and
// no dependency on the gitignored captured bytes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { DEFAULT_OUT, diagnoseCalls, inventoryForCall, parseArgs, totalsOf } = require('./diagnose-ai-probe-quotes');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, 'diagnose-ai-probe-quotes.js');

const capturedText = 'LUNCH\n\nSoep van de dag\n6,50\n';
const capturesBySource = {
  zuyd: [{ id: 'zuyd-02', url: 'https://fictief.example/zuyd-02', kind: 'html', pageCount: null, text: capturedText }],
};

function answerTextWith(quote) {
  return JSON.stringify({
    menus: [
      {
        title: 'Lunch',
        sourceId: 'zuyd-02',
        categories: [{ name: 'Voor', items: [{ name: 'Soep', priceStatus: 'known', amountMinorUnits: 650, currency: 'EUR', evidence: { sourceId: 'zuyd-02', locator: 'regel 3', quote } }] }],
      },
    ],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  });
}

/** Writes one saved answer and returns the report call that references it. */
function savedCall({ call = 1, sourceId = 'zuyd', quote = 'Soep van de dag - 6,50', captureIds = ['zuyd-02'], text = null } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-diagnose-'));
  const answer = text || answerTextWith(quote);
  const { writeRawAnswer } = require('../benchmark/aiProbeRawOutput');
  const saved = writeRawAnswer({ directory, root: REPO_ROOT, sourceId, run: 1, chunkIndex: 0, call, text: answer });
  return { call: { call, sourceId, ok: false, reason: 'schema_violation', captureIds, rawOutputFile: saved.file, rawOutputSha256: saved.sha256 }, answer };
}

test('Q2: the command diagnoses a saved rejected answer against the captures of that call', () => {
  const { call, answer } = savedCall();
  const results = diagnoseCalls({ calls: [call], capturesBySource });
  assert.equal(results.length, 1);
  assert.equal(results[0].error, undefined);
  assert.equal(results[0].rawOutputSha256, call.rawOutputSha256);
  assert.equal(results[0].diagnosis.items, 1);
  assert.equal(results[0].diagnosis.itemsWithInvalidQuote, 1);
  assert.equal(results[0].diagnosis.quotes[0].quote, 'Soep van de dag - 6,50');
  assert.equal(results[0].diagnosis.quotes[0].classification, 'added_separator');
  assert.equal(results[0].diagnosis.quotes[0].nearest[0].text, 'Soep van de dag');
  // The diagnosis is about the saved answer, not about a different one.
  assert.equal(answer.includes('Soep van de dag - 6,50'), true);
  const totals = totalsOf(results);
  assert.equal(totals.answers, 1);
  assert.equal(totals.items, 1);
  assert.equal(totals.itemsWithInvalidQuote, 1);
  assert.equal(totals.classes.added_separator, 1);
});

test('Q2: a call without a saved answer is reported, never skipped and never guessed', () => {
  const results = diagnoseCalls({ calls: [{ call: 4, sourceId: 'zuyd', ok: false, reason: 'schema_violation', captureIds: ['zuyd-02'] }], capturesBySource });
  assert.equal(results[0].error, 'answer_missing');
  assert.equal(results[0].rawOutputFile, null);
  assert.equal(results[0].diagnosis, null);
  assert.equal(totalsOf(results).answersMissing, 1);
});

test('Q2: a saved answer that no longer matches its hash is an integrity error', () => {
  const { call } = savedCall();
  const results = diagnoseCalls({ calls: [{ ...call, rawOutputSha256: 'f'.repeat(64) }], capturesBySource });
  assert.equal(results[0].diagnosis, null);
  assert.match(results[0].error, /does not match/);
});

test('Q2: only the captures of that call are the comparison source', () => {
  const { call } = savedCall({ captureIds: ['zuyd-01'] });
  // The answer cites zuyd-02, which this call did not receive.
  const results = diagnoseCalls({ calls: [call], capturesBySource });
  assert.equal(results[0].diagnosis.itemsWithUnknownSource, 1);
  assert.equal(results[0].diagnosis.quotes[0].classification, 'unknown_source');
  const inventory = inventoryForCall({ sourceId: 'zuyd', captureIds: ['zuyd-02'] }, capturesBySource);
  assert.deepEqual(inventory.map((capture) => capture.id), ['zuyd-02']);
  assert.deepEqual(inventoryForCall({ sourceId: 'zuyd' }, capturesBySource).map((capture) => capture.id), ['zuyd-02']);
});

test('Q2: the command refuses a missing report, an unknown argument and a raw file without a source', () => {
  const missing = spawnSync(process.execPath, [SCRIPT, `--report=${path.join(os.tmpdir(), 'no-such-report-59.json')}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /geen rapport/);

  const refused = spawnSync(process.execPath, [SCRIPT, '--bogus=1'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /unknown argument/);

  assert.throws(() => parseArgs(['--raw-file=somewhere.json']), /needs --source/);
  assert.equal(DEFAULT_OUT.endsWith(path.join('ops', 'benchmark', 'output', 'ai-probe-quote-diagnosis.json')), true);
});
