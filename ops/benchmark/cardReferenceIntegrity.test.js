'use strict';

// Regression for the card price proofs (#59 order 6347355753, K1/K2): a
// two-column PDF states the name and the amount as separate text items, so a
// reference row proves its price by naming the exact pinned baseline. This
// proves the resolver refuses a wrong baseline, a wrong amount and a missing
// proof instead of trusting the reference.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cardRows,
  findPriceRow,
  normalizeAmount,
  verifyCardPriceProofs,
} = require('./cardReferenceIntegrity');

const PAGES = [
  {
    pageNumber: 2,
    lines: [
      { y: 744, items: [{ x: 245.7, str: 'Per stuk 4.00' }] },
      { y: 742, items: [{ x: 55, str: 'Naturel' }, { x: 90.6, str: 'met citroen' }] },
      { y: 674, items: [{ x: 351.5, str: 'Poussin,' }, { x: 541.6, str: '20.95' }] },
      { y: 672, items: [{ x: 332.8, str: 'Tournedos' }, { x: 558.5, str: '37,95' }] },
    ],
  },
];

function reference(items) {
  return { menus: [{ title: 'Dinerkaart', categories: [{ path: ['Dinerkaart', 'HOOFDGERECHTEN'], items }] }] };
}

test('rows never mix the left and right column of one baseline', () => {
  const rows = cardRows(PAGES);
  const right = rows.find((row) => row.page === 2 && row.y === 674 && row.column === 'right');
  assert.ok(right, 'the right column row exists');
  assert.match(right.text, /Poussin/);
  assert.match(right.text, /20\.95/);
  const left = rows.find((row) => row.page === 2 && row.y === 742 && row.column === 'left');
  assert.match(left.text, /Naturel/);
});

test('a price proof resolves only on the exact printed baseline', () => {
  const rows = cardRows(PAGES);
  assert.ok(findPriceRow(rows, { page: 2, column: 'left', y: 744 }));
  assert.equal(findPriceRow(rows, { page: 2, column: 'left', y: 743 }), null, 'a neighbouring baseline is not the proof');
  assert.equal(findPriceRow(rows, { page: 2, column: 'right', y: 744 }), null, 'the other column is not the proof');
  assert.equal(findPriceRow(rows, { page: 3, column: 'left', y: 744 }), null, 'another page is not the proof');
});

test('every price on a reference row must occur on its pinned row', () => {
  const ok = verifyCardPriceProofs(reference([
    { name: 'Poussin', price: '20.95', priceProofs: [{ page: 2, column: 'right', y: 674 }] },
    { name: 'Tournedos', priceVariants: [{ label: 'per stuk', price: '37.95' }], priceProofs: [{ page: 2, column: 'right', y: 672 }] },
  ]), PAGES);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.proofs.length, 2);
  assert.match(ok.proofs[1].row, /37,95/, 'the report repeats the pinned row for the Lead');

  const wrongAmount = verifyCardPriceProofs(reference([
    { name: 'Poussin', price: '20.59', priceProofs: [{ page: 2, column: 'right', y: 674 }] },
  ]), PAGES);
  assert.equal(wrongAmount.ok, false);
  assert.match(wrongAmount.errors[0], /does not occur on the pinned row/);

  const missingProof = verifyCardPriceProofs(reference([{ name: 'Poussin', price: '20.95' }]), PAGES);
  assert.equal(missingProof.ok, false);
  assert.match(missingProof.errors[0], /needs a price proof/);

  const mismatchedCount = verifyCardPriceProofs(reference([
    { name: 'Plateau', priceVariants: [{ label: '3 stuks', price: '10.95' }, { label: '5 stuks', price: '15.95' }], priceProofs: [{ page: 2, column: 'right', y: 674 }] },
  ]), PAGES);
  assert.equal(mismatchedCount.ok, false);
  assert.match(mismatchedCount.errors[0], /1 price proof\(s\) for 2 price\(s\)/);
});

test('amount comparison accepts the source notation with a comma and nothing else', () => {
  assert.equal(normalizeAmount('37,95'), '37.95');
  assert.equal(normalizeAmount(' 20.95 '), '20.95');
  const result = verifyCardPriceProofs(reference([
    { name: 'Tournedos', price: '37.95', priceProofs: [{ page: 2, column: 'right', y: 672 }] },
  ]), PAGES);
  assert.deepEqual(result.errors, []);
});
