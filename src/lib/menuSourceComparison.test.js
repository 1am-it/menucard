'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeName, normalizePrice, categoryPath, compareMenuSource } = require('./menuSourceComparison');

// Every reference row and every actual row must be explained exactly once.
// This is the invariant the read-only probe refuses to go green without, so
// each scenario below checks it in addition to the explicit difference lists.
function assertEveryRowAccountedOnce(result) {
  assert.equal(result.accounting.expected.total, result.expectedItems);
  assert.equal(result.accounting.actual.total, result.actualItems);
  assert.equal(result.accounting.expected.accounted, result.expectedItems);
  assert.equal(result.accounting.actual.accounted, result.actualItems);
  assert.equal(result.accounting.expected.balanced, true);
  assert.equal(result.accounting.actual.balanced, true);
  assert.equal(
    result.matched + result.missing.length + result.priceMismatches.length + result.categoryMismatches.length,
    result.expectedItems,
    'expected rows must be matched, missing, mispriced or wrongly linked — never dropped',
  );
  assert.equal(
    result.matched + result.extra.length + result.priceMismatches.length + result.categoryMismatches.length,
    result.actualItems,
    'actual rows must be matched, surplus, mispriced or wrongly linked — never dropped',
  );
}

const reference = {
  label: 'Fictieve bron',
  categories: [
    { path: ['DINER', 'VOOR'], items: [{ name: 'Fictieve soep', price: '9.50' }, { name: 'Fictieve salade', price: '11' }] },
    { path: ['LUNCH', 'BROODJES'], items: [{ name: 'Fictief broodje', price: '8.00' }] },
  ],
};

test('normalisation: names, prices and paths are compared deterministically', () => {
  assert.equal(normalizeName('  Fictieve  Crème SOEP '), 'fictieve creme soep');
  assert.equal(normalizePrice('9,5'), '9.50');
  assert.equal(normalizePrice('€ 11'), '11.00');
  assert.deepEqual(categoryPath({ name: 'VOOR', path: ['DINER', 'VOOR'] }), ['DINER', 'VOOR']);
});

test('an exact match reports no differences — and still no quality score', () => {
  const menus = [{ categories: [
    { path: ['DINER', 'VOOR'], items: [{ name: 'Fictieve soep', price: '9.50' }, { name: 'Fictieve salade', price: '11.00' }] },
    { path: ['LUNCH', 'BROODJES'], items: [{ name: 'Fictief broodje', price: '8' }] },
  ] }];
  const result = compareMenuSource(reference, menus);
  assert.equal(result.expectedItems, 3);
  assert.equal(result.actualItems, 3);
  assert.equal(result.matched, 3);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.extra, []);
  assert.deepEqual(result.priceMismatches, []);
  assert.deepEqual(result.categoryMismatches, []);
  assert.deepEqual(result.duplicates, []);
  assertEveryRowAccountedOnce(result);
});

test('missed, extra, mispriced, wrongly linked and duplicate items are each reported', () => {
  const menus = [{ categories: [
    { path: ['DINER', 'VOOR'], items: [
      { name: 'Fictieve soep', price: '10.00' }, // price error
      { name: 'Fictieve extra', price: '4.00' }, // extra
    ] },
    { path: ['LUNCH', 'BROODJES'], items: [
      { name: 'Fictieve salade', price: '11.00' }, // wrong section
      { name: 'Fictief broodje', price: '8.00' },
      { name: 'Fictief broodje', price: '8.00' }, // duplicate
    ] },
  ] }];
  const result = compareMenuSource(reference, menus);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.missing, []);
  // The repeated broodje is both a duplicate and surplus: after matching, no
  // reference row is left to explain that second row. Hiding it from `extra`
  // was exactly the review-6247746317 defect.
  assert.deepEqual(result.extra.map((row) => row.name), ['Fictieve extra', 'Fictief broodje']);
  assert.deepEqual(result.priceMismatches, [{ name: 'Fictieve soep', path: ['DINER', 'VOOR'], expectedPrice: '9.50', actualPrice: '10.00' }]);
  assert.deepEqual(result.categoryMismatches, [{ name: 'Fictieve salade', price: '11.00', expectedPath: ['DINER', 'VOOR'], actualPath: ['LUNCH', 'BROODJES'] }]);
  assert.deepEqual(result.duplicates.map((row) => [row.name, row.count, row.expectedCount]), [['Fictief broodje', 2, 1]]);
  assertEveryRowAccountedOnce(result);
});

test('a missing item is a miss even when the total count happens to match', () => {
  const menus = [{ categories: [
    { path: ['DINER', 'VOOR'], items: [{ name: 'Fictieve soep', price: '9.50' }, { name: 'Ander gerecht', price: '11.00' }] },
    { path: ['LUNCH', 'BROODJES'], items: [{ name: 'Fictief broodje', price: '8.00' }] },
  ] }];
  const result = compareMenuSource(reference, menus);
  assert.equal(result.actualItems, result.expectedItems);
  assert.equal(result.matched, 2);
  assert.deepEqual(result.missing.map((row) => row.name), ['Fictieve salade']);
  assert.deepEqual(result.extra.map((row) => row.name), ['Ander gerecht']);
  assertEveryRowAccountedOnce(result);
});

test('the same dish in an extra section is surplus, not a hidden match', () => {
  // Delivery Lead review 6247746317: a row in another section was filtered out
  // of `extra` because the same name+price existed in the reference, so the
  // probe could pass a menu that held the dish twice in different sections.
  const single = {
    label: 'Eén rubriek',
    categories: [{ path: ['A'], items: [{ name: 'Fictieve soep', price: '10' }] }],
  };
  const menus = [{ categories: [
    { path: ['A'], items: [{ name: 'Fictieve soep', price: '10' }] },
    { path: ['B'], items: [{ name: 'Fictieve soep', price: '10' }] },
  ] }];
  const result = compareMenuSource(single, menus);
  assert.equal(result.expectedItems, 1);
  assert.equal(result.actualItems, 2);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.extra, [{ name: 'Fictieve soep', price: '10.00', path: ['B'] }]);
  assert.deepEqual(result.priceMismatches, []);
  assert.deepEqual(result.categoryMismatches, []);
  // Both rows are in different sections, so this is surplus, not a repeat.
  assert.deepEqual(result.duplicates, []);
  assertEveryRowAccountedOnce(result);
});

test('an identical extra row in the same section is surplus and a duplicate', () => {
  const single = {
    label: 'Eén gerecht',
    categories: [{ path: ['A'], items: [{ name: 'Fictieve soep', price: '10' }] }],
  };
  const menus = [{ categories: [
    { path: ['A'], items: [
      { name: 'Fictieve soep', price: '10' },
      { name: 'Fictieve soep', price: '10' },
    ] },
  ] }];
  const result = compareMenuSource(single, menus);
  assert.equal(result.matched, 1);
  assert.equal(result.actualItems, 2);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.extra, [{ name: 'Fictieve soep', price: '10.00', path: ['A'] }]);
  assert.deepEqual(result.priceMismatches, []);
  assert.deepEqual(result.categoryMismatches, []);
  assert.deepEqual(result.duplicates.map((row) => [row.name, row.count, row.expectedCount]), [['Fictieve soep', 2, 1]]);
  assertEveryRowAccountedOnce(result);
});

test('a repetition the reference itself expects stays a match, not a difference', () => {
  const repeated = {
    label: 'Twee keer verwacht',
    categories: [{ path: ['LUNCH'], items: [
      { name: 'Fictieve soep', price: '10' },
      { name: 'Fictieve soep', price: '10' },
    ] }],
  };
  const exact = [{ categories: [
    { path: ['LUNCH'], items: [
      { name: 'Fictieve soep', price: '10' },
      { name: 'Fictieve soep', price: '10' },
    ] },
  ] }];
  const result = compareMenuSource(repeated, exact);
  assert.equal(result.expectedItems, 2);
  assert.equal(result.actualItems, 2);
  assert.equal(result.matched, 2);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.extra, []);
  assert.deepEqual(result.duplicates, []);
  assertEveryRowAccountedOnce(result);

  // One of the two expected rows delivered: a genuine miss, no invented extra.
  const oneShort = [{ categories: [
    { path: ['LUNCH'], items: [{ name: 'Fictieve soep', price: '10' }] },
  ] }];
  const partial = compareMenuSource(repeated, oneShort);
  assert.equal(partial.matched, 1);
  assert.deepEqual(partial.missing, [{ name: 'Fictieve soep', price: '10.00', path: ['LUNCH'] }]);
  assert.deepEqual(partial.extra, []);
  assert.deepEqual(partial.duplicates, []);
  assertEveryRowAccountedOnce(partial);
});
