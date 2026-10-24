'use strict';

// The probe verdict must never go green on an unexplained row (#59, Delivery
// Lead review 6247746317). These are fictional reports; nothing is fetched,
// written or configured here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { DIFFERENCE_LISTS, rowsFullyAccounted, hasUnaccountedRows, sourceHasDifference } = require('./probeVerdict');
const { compareMenuSource } = require('../../src/lib/menuSourceComparison');

const accounting = {
  expected: { total: 1, matched: 1, missing: 0, priceMismatch: 0, categoryMismatch: 0, accounted: 1, balanced: true },
  actual: { total: 1, matched: 1, extra: 0, priceMismatch: 0, categoryMismatch: 0, accounted: 1, balanced: true },
};

function cleanReport(overrides = {}) {
  return {
    ok: true,
    bytesSha256Matches: true,
    contentHashMatches: true,
    expectedItems: 1,
    actualItems: 1,
    matched: 1,
    missing: [],
    extra: [],
    priceMismatches: [],
    categoryMismatches: [],
    duplicates: [],
    accounting,
    ...overrides,
  };
}

test('a fully matched report with pinned hashes passes', () => {
  assert.equal(sourceHasDifference(cleanReport()), false);
  assert.equal(hasUnaccountedRows(cleanReport()), false);
  assert.equal(rowsFullyAccounted(accounting), true);
});

test('every difference list is fatal, including a single surplus row', () => {
  const entries = {
    missing: { name: 'Fictieve soep', price: '10.00', path: ['A'] },
    extra: { name: 'Fictieve soep', price: '10.00', path: ['B'] },
    priceMismatches: { name: 'Fictieve soep', path: ['A'], expectedPrice: '10.00', actualPrice: '11.00' },
    categoryMismatches: { name: 'Fictieve soep', price: '10.00', expectedPath: ['A'], actualPath: ['B'] },
    duplicates: { name: 'Fictieve soep', price: '10.00', path: ['A'], count: 2, expectedCount: 1 },
  };
  assert.deepEqual(Object.keys(entries).sort(), [...DIFFERENCE_LISTS].sort());
  for (const key of DIFFERENCE_LISTS) {
    const report = cleanReport({ [key]: [entries[key]] });
    assert.equal(sourceHasDifference(report), true, `${key} with one entry must fail the probe`);
  }
  assert.equal(sourceHasDifference(cleanReport({ extra: [entries.extra] })), true);
});

test('an unbalanced comparison fails even when the difference lists look empty', () => {
  const dropped = cleanReport({
    accounting: {
      expected: { ...accounting.expected, total: 2, accounted: 1, balanced: false },
      actual: { ...accounting.actual },
    },
  });
  assert.equal(hasUnaccountedRows(dropped), true);
  assert.equal(sourceHasDifference(dropped), true);

  const silentSurplus = cleanReport({
    accounting: {
      expected: { ...accounting.expected },
      actual: { ...accounting.actual, total: 2, accounted: 1, balanced: false },
    },
  });
  assert.equal(sourceHasDifference(silentSurplus), true);
});

test('a missing or non-numeric accounting block is fatal', () => {
  assert.equal(sourceHasDifference(cleanReport({ accounting: undefined })), true);
  assert.equal(sourceHasDifference(cleanReport({ accounting: { expected: accounting.expected } })), true);
  assert.equal(
    sourceHasDifference(cleanReport({ accounting: { ...accounting, actual: { ...accounting.actual, accounted: '1' } } })),
    true,
  );
  // A missing difference list is not treated as "zero entries".
  assert.equal(sourceHasDifference(cleanReport({ extra: undefined })), true);
});

test('a source hash mismatch, failed analysis or missing report is fatal', () => {
  assert.equal(sourceHasDifference(cleanReport({ bytesSha256Matches: false })), true);
  assert.equal(sourceHasDifference(cleanReport({ contentHashMatches: false })), true);
  assert.equal(sourceHasDifference({ ok: false, errorReason: 'fetch_failed' }), true);
  assert.equal(sourceHasDifference(null), true);
});

test('the review repro — same dish in an extra section — fails the probe verdict', () => {
  const reference = {
    label: 'Eén rubriek',
    categories: [{ path: ['A'], items: [{ name: 'Fictieve soep', price: '10' }] }],
  };
  const menus = [{ categories: [
    { path: ['A'], items: [{ name: 'Fictieve soep', price: '10' }] },
    { path: ['B'], items: [{ name: 'Fictieve soep', price: '10' }] },
  ] }];
  const comparison = compareMenuSource(reference, menus);
  assert.equal(comparison.matched, 1);
  assert.equal(comparison.actualItems, 2);
  assert.equal(comparison.extra.length, 1);
  const report = cleanReport({ ...comparison, expectedItems: comparison.expectedItems, actualItems: comparison.actualItems });
  assert.equal(sourceHasDifference(report), true);
});
