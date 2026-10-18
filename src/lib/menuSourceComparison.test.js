'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeName, normalizePrice, categoryPath, compareMenuSource } = require('./menuSourceComparison');

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
  assert.deepEqual(result.extra.map((row) => row.name), ['Fictieve extra']);
  assert.deepEqual(result.priceMismatches, [{ name: 'Fictieve soep', path: ['DINER', 'VOOR'], expectedPrice: '9.50', actualPrice: '10.00' }]);
  assert.deepEqual(result.categoryMismatches, [{ name: 'Fictieve salade', price: '11.00', expectedPath: ['DINER', 'VOOR'], actualPath: ['LUNCH', 'BROODJES'] }]);
  assert.deepEqual(result.duplicates.map((row) => [row.name, row.count]), [['Fictief broodje', 2]]);
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
});
