'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeCanonicalContentHash } = require('./menuSnapshotHash');

test('computeCanonicalContentHash: identical content produces an identical hash', () => {
  const content = { categories: [{ name: 'Dinerkaart', items: [{ name: 'Tournedos', price: '22,50' }] }] };
  const hashA = computeCanonicalContentHash(content);
  const hashB = computeCanonicalContentHash(JSON.parse(JSON.stringify(content)));
  assert.equal(hashA, hashB);
  assert.match(hashA, /^[0-9a-f]{64}$/, 'must be exactly the 64-character lowercase hex shape the migration constraint requires');
});

test('computeCanonicalContentHash: key order never changes the hash', () => {
  const contentA = { b: 2, a: 1, categories: [{ name: 'Lunchkaart', items: [] }] };
  const contentB = { a: 1, categories: [{ items: [], name: 'Lunchkaart' }], b: 2 };
  assert.equal(computeCanonicalContentHash(contentA), computeCanonicalContentHash(contentB));
});

test('computeCanonicalContentHash: array order is preserved and does change the hash', () => {
  const dishesInOrder = { items: ['Tournedos', 'Zalm'] };
  const dishesReordered = { items: ['Zalm', 'Tournedos'] };
  assert.notEqual(computeCanonicalContentHash(dishesInOrder), computeCanonicalContentHash(dishesReordered));
});

test('computeCanonicalContentHash: genuinely different content produces a different hash', () => {
  const original = { categories: [{ name: 'Dinerkaart', items: [{ name: 'Tournedos', price: '22,50' }] }] };
  const changedPrice = { categories: [{ name: 'Dinerkaart', items: [{ name: 'Tournedos', price: '24,50' }] }] };
  assert.notEqual(computeCanonicalContentHash(original), computeCanonicalContentHash(changedPrice));
});
