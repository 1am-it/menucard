'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const report = require('./reference-measurement.json');
const metadata = require('./reference-captures.json');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'ops', 'scripts', 'measure-menu-extraction-references.js');

function sum(field) {
  return report.sources
    .filter((source) => source.captureStatus === 'captured')
    .reduce((total, source) => total + source[field], 0);
}

test('the committed measurement reports the four deviation classes per source and in total', () => {
  assert.equal(report.sources.length, 5);
  assert.equal(report.totals.sources, 5);
  assert.equal(report.totals.capturedSources, 4);
  assert.equal(report.totals.blockedSources, 1);
  for (const field of ['referenceItems', 'actualItems', 'matched', 'missing', 'invented', 'priceErrors', 'categoryErrors']) {
    assert.equal(report.totals[field], sum(field), `total ${field}`);
  }
  for (const source of report.sources) {
    assert.ok(Array.isArray(source.missingDishes));
    assert.ok(Array.isArray(source.inventedDishes));
    assert.ok(Array.isArray(source.priceErrorRows));
    assert.ok(Array.isArray(source.categoryErrorRows));
    if (source.captureStatus !== 'captured') {
      assert.ok(source.blockedReason && source.blockedReason.trim(), `${source.label} keeps its blocked reason`);
      continue;
    }
    assert.equal(source.missingDishes.length, source.missing);
    assert.equal(source.inventedDishes.length, source.invented);
    assert.equal(source.priceErrorRows.length, source.priceErrors);
    assert.equal(source.categoryErrorRows.length, source.categoryErrors);
    assert.equal(source.accounting.reference.balanced, true);
    assert.equal(source.accounting.actual.balanced, true);
    assert.equal(source.accounting.reference.accounted, source.referenceItems);
    assert.equal(source.accounting.actual.accounted, source.actualItems);
  }
});

test('precision and recall are derived from the reported rows, not asserted separately', () => {
  const expectedPrecision = Math.round((report.totals.matched / report.totals.actualItems) * 10000) / 100;
  const expectedRecall = Math.round((report.totals.matched / report.totals.referenceItems) * 10000) / 100;
  assert.equal(report.totals.precision, expectedPrecision);
  assert.equal(report.totals.recall, expectedRecall);
});

test('the report is deterministic: no wall-clock generation time is stored', () => {
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('generatedAt'), false);
  assert.equal(serialized.includes('measuredAt'), false);
  assert.equal(report.pinnedAt, metadata.pinnedAt);
  const script = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(script.includes('safeOutboundFetch'), false, 'the measurement must not read the network');
  assert.equal(/new Date\(/.test(script), false, 'the report must not contain a wall-clock timestamp');
});

test('the Markdown report shows every source, the total and the blocked source', () => {
  const markdown = fs.readFileSync(path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-measurement.md'), 'utf8');
  assert.match(markdown, /## Totalen/);
  assert.match(markdown, /## Per bron/);
  assert.match(markdown, /Senang Makan \| geblokkeerd/);
  assert.match(markdown, /Gemiste gerechten \| \d+/);
  assert.match(markdown, /Verzonnen gerechten \| \d+/);
  assert.match(markdown, /Prijsfouten \| \d+/);
  assert.match(markdown, /Rubriekfouten \| \d+/);
  assert.match(markdown, /geen ongeziene holdout/);
});
