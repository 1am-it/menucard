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
const wolfslaarPin = require('./card-reference-captures.wolfslaar.json');
const thuisPin = require('./card-reference-captures.thuis.json');
const wolfslaarReference = require('./reference-references/wolfslaar.json');
const thuisReference = require('./reference-references/thuis.json');

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

test('the report measures Bardot next to Zuyd and keeps every card separate', () => {
  assert.equal(report.issue, 59);
  assert.deepEqual(report.sources.map((source) => source.sourceId), ['bardot', 'zuyd', 'wolfslaar', 'thuis']);
  assert.equal(report.sources[0].label, 'Brasserie Bardot');
  assert.equal(report.sources[1].label, 'Restaurant Zuyd');
  assert.equal(report.sources[2].label, 'Restaurant Wolfslaar');
  assert.equal(report.sources[3].label, 'T-Huis');
  assert.equal(report.totals.sources, 4);
  assert.equal(report.totals.capturedSources, 3);
  assert.equal(report.totals.blockedSources, 1);
  assert.deepEqual(report.totals.blocked.map((row) => row.id), ['thuis']);
});

test('T-Huis stays an honest blocked row: an image-only menu is never an empty success', () => {
  const thuis = report.sources.find((source) => source.sourceId === 'thuis');
  assert.equal(thuis.captureStatus, 'blocked');
  assert.equal(thuis.referenceItems, 0);
  assert.equal(thuis.actualItems, 0);
  assert.match(thuis.blockedReason, /SVG/);
  assert.equal(thuis.sourceVersion.captures.some((capture) => capture.captureStatus === 'captured'), true);
  assert.equal(thuisReference.captureStatus, 'blocked');
  assert.deepEqual(thuisReference.menus, []);
  assert.equal(thuisReference.ambiguous.length, 5, 'the five SVG tab panels are named');
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

test('the Wolfslaar and T-Huis pins and references are tied to the report by hash', () => {
  assert.equal(report.cardPins.length, 2);
  assert.equal(report.cardPins[0].path, 'ops/benchmark/card-reference-captures.wolfslaar.json');
  assert.equal(report.cardPins[0].bytesSha256, sha256(report.cardPins[0].path));
  assert.equal(report.cardPins[1].path, 'ops/benchmark/card-reference-captures.thuis.json');
  assert.equal(report.cardPins[1].bytesSha256, sha256(report.cardPins[1].path));
  assert.equal(report.wolfslaarReference.bytesSha256, sha256(report.wolfslaarReference.path));
  assert.equal(report.thuisReference.bytesSha256, sha256(report.thuisReference.path));
  assert.equal(report.wolfslaarReference.items, 30);
  assert.equal(report.wolfslaarReference.categories, 6);
  assert.equal(report.wolfslaarReference.arrangements, 4);
  assert.equal(report.wolfslaarReference.supplements, 3);
  assert.equal(report.thuisReference.items, 0);
  assert.equal(wolfslaarReference.pinnedCapture.bytesSha256, sha256(wolfslaarReference.pinnedCapture.path));
  assert.equal(thuisReference.pinnedCapture.bytesSha256, sha256(thuisReference.pinnedCapture.path));
  assert.equal(wolfslaarPin.captureStatus, 'captured');
  assert.equal(thuisPin.captureStatus, 'captured');
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
  assert.match(markdown, /Restaurant Wolfslaar \| gemeten/);
  assert.match(markdown, /T-Huis \| geblokkeerd/);
  assert.match(markdown, /SVG-afbeelding/);
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
