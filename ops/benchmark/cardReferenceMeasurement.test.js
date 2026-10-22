'use strict';

// Regression for the criterion-5 measurement report (#59 order 6347355753, K2).
// The committed report must stay derived from its committed inputs, must keep
// Bardot and Zuyd separate, and must stay deterministic: no wall-clock time and
// no network read in the measuring script.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const report = require('./card-reference-measurement.json');
const cardPin = require('./card-reference-captures.json');
const cardCapture = require('./existing-card-references.json');
const referenceIndex = require('./reference-references/index.json');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'ops', 'scripts', 'measure-menu-extraction-card-reference.js');
const { repositoryTextSha256 } = require('./holdoutManifest');

// The pinned hashes are EOL-stable repository text hashes (the project's own
// helper), so a checkout that stores CRLF does not break them.
function sha256(file) {
  return repositoryTextSha256(fs.readFileSync(path.join(REPO_ROOT, file)));
}

function sum(field) {
  return report.sources
    .filter((source) => source.captureStatus === 'captured')
    .reduce((total, source) => total + source[field], 0);
}

test('the report measures Bardot next to Zuyd and keeps both cards separate', () => {
  assert.equal(report.issue, 59);
  assert.deepEqual(report.sources.map((source) => source.sourceId), ['bardot', 'zuyd']);
  assert.equal(report.sources[0].label, 'Brasserie Bardot');
  assert.equal(report.sources[1].label, 'Restaurant Zuyd');
  assert.equal(report.totals.sources, 2);
  assert.equal(report.totals.capturedSources, 2);
  assert.equal(report.totals.blockedSources, 0);
});

test('the totals are the sum of the reported rows, never a separate claim', () => {
  for (const field of ['referenceItems', 'actualItems', 'matched', 'missing', 'invented', 'priceErrors', 'categoryErrors']) {
    assert.equal(report.totals[field], sum(field), `total ${field}`);
  }
  for (const source of report.sources) {
    assert.equal(source.missingDishes.length, source.missing, `${source.label}: missing rows`);
    assert.equal(source.inventedDishes.length, source.invented, `${source.label}: invented rows`);
    assert.equal(source.priceErrorRows.length, source.priceErrors, `${source.label}: price rows`);
    assert.equal(source.categoryErrorRows.length, source.categoryErrors, `${source.label}: rubric rows`);
    assert.equal(source.accounting.reference.balanced, true, `${source.label}: reference accounting`);
    assert.equal(source.accounting.actual.balanced, true, `${source.label}: actual accounting`);
  }
  const precision = Math.round((report.totals.matched / report.totals.actualItems) * 10000) / 100;
  const recall = Math.round((report.totals.matched / report.totals.referenceItems) * 10000) / 100;
  assert.equal(report.totals.precision, precision);
  assert.equal(report.totals.recall, recall);
});

test('the report is tied to the committed inputs by hash', () => {
  assert.equal(report.countingRules.sha256, referenceIndex.countingRules.sha256);
  assert.equal(report.countingRules.sha256, sha256(report.countingRules.path), 'the counting rules may not change after the references were authored');
  assert.equal(report.cardCapture.bytesSha256, sha256(report.cardCapture.path));
  assert.equal(report.cardPin.bytesSha256, sha256(report.cardPin.path));
  assert.equal(report.bardotReference.bytesSha256, sha256(report.bardotReference.path));
  assert.equal(report.zuydReference.bytesSha256, sha256(report.zuydReference.path));
  assert.equal(report.cardPin.bytesSha256, sha256('ops/benchmark/card-reference-captures.json'));
  assert.equal(report.bardotReference.items, 112);
  assert.equal(report.bardotReference.priceProofs > 0, true);
});

test('the report is deterministic: no wall-clock time and no network in the script', () => {
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('generatedAt'), false);
  assert.equal(serialized.includes('measuredAt'), false);
  const script = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(script.includes('safeOutboundFetch'), false, 'the measurement must not read the network');
  assert.equal(/new Date\(/.test(script), false, 'the report must not contain a wall-clock timestamp');
});

test('the Markdown report shows both cards, the four deviation classes and the hashes', () => {
  const markdown = fs.readFileSync(path.join(REPO_ROOT, 'ops', 'benchmark', 'card-reference-measurement.md'), 'utf8');
  assert.match(markdown, /## Totalen/);
  assert.match(markdown, /## Per kaart/);
  assert.match(markdown, /Brasserie Bardot \| gemeten/);
  assert.match(markdown, /Restaurant Zuyd \| gemeten/);
  for (const row of ['Gemiste gerechten \\| \\d+', 'Verzonnen gerechten \\| \\d+', 'Prijsfouten \\| \\d+', 'Rubriekfouten \\| \\d+']) {
    assert.match(markdown, new RegExp(row));
  }
  assert.match(markdown, /SHA-256 `[0-9a-f]{64}`/);
  assert.match(markdown, /geen ongeziene holdout/);
});

test('the pinned card capture still carries the three Bardot URLs the pin verified', () => {
  const bardot = cardCapture.sources.bardot;
  assert.equal(bardot.captures.length, 3);
  assert.equal(cardPin.captures.length, 3);
  for (const capture of cardPin.captures) {
    assert.ok(bardot.captures.some((pinned) => pinned.url === capture.requestedUrl), capture.requestedUrl);
  }
});
