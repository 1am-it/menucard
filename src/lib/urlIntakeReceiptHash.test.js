'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeAnalysisResultHash } = require('./urlIntakeReceiptHash');

const BASE_INPUT = {
  actorUserId: '11111111-1111-1111-1111-111111111111',
  canonicalSourceUrl: 'https://example.nl/menu',
  restaurantMatchType: 'exact',
  matchedRestaurantId: '6',
  candidateSummary: { restaurant: { name: 'Test' }, menus: [] },
};

test('computeAnalysisResultHash: returns a 64-character lowercase hex string, matching the migration\'s own check constraint', () => {
  const hash = computeAnalysisResultHash(BASE_INPUT);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('computeAnalysisResultHash: deterministic — same input always produces the same hash', () => {
  const h1 = computeAnalysisResultHash(BASE_INPUT);
  const h2 = computeAnalysisResultHash(BASE_INPUT);
  assert.equal(h1, h2);
});

test('computeAnalysisResultHash: independent of candidateSummary key order (canonicalization)', () => {
  const h1 = computeAnalysisResultHash({ ...BASE_INPUT, candidateSummary: { restaurant: { name: 'Test', address: 'A' }, menus: [] } });
  const h2 = computeAnalysisResultHash({ ...BASE_INPUT, candidateSummary: { menus: [], restaurant: { address: 'A', name: 'Test' } } });
  assert.equal(h1, h2);
});

test('computeAnalysisResultHash: array order inside candidateSummary IS meaningful and changes the hash', () => {
  const h1 = computeAnalysisResultHash({ ...BASE_INPUT, candidateSummary: { restaurant: {}, menus: [{ contextSlug: 'lunch' }, { contextSlug: 'diner' }] } });
  const h2 = computeAnalysisResultHash({ ...BASE_INPUT, candidateSummary: { restaurant: {}, menus: [{ contextSlug: 'diner' }, { contextSlug: 'lunch' }] } });
  assert.notEqual(h1, h2);
});

test('computeAnalysisResultHash: changes when actorUserId changes (actor binding is part of the integrity check)', () => {
  const h1 = computeAnalysisResultHash(BASE_INPUT);
  const h2 = computeAnalysisResultHash({ ...BASE_INPUT, actorUserId: '22222222-2222-2222-2222-222222222222' });
  assert.notEqual(h1, h2);
});

test('computeAnalysisResultHash: changes when canonicalSourceUrl changes (URL binding is part of the integrity check)', () => {
  const h1 = computeAnalysisResultHash(BASE_INPUT);
  const h2 = computeAnalysisResultHash({ ...BASE_INPUT, canonicalSourceUrl: 'https://other.nl/menu' });
  assert.notEqual(h1, h2);
});

test('computeAnalysisResultHash: changes when restaurantMatchType or matchedRestaurantId changes', () => {
  const h1 = computeAnalysisResultHash(BASE_INPUT);
  const h2 = computeAnalysisResultHash({ ...BASE_INPUT, restaurantMatchType: 'none', matchedRestaurantId: null });
  assert.notEqual(h1, h2);
});

test('computeAnalysisResultHash: changes when the candidate summary content itself changes (tamper detection)', () => {
  const h1 = computeAnalysisResultHash(BASE_INPUT);
  const h2 = computeAnalysisResultHash({ ...BASE_INPUT, candidateSummary: { restaurant: { name: 'Tampered' }, menus: [] } });
  assert.notEqual(h1, h2);
});

test('computeAnalysisResultHash: never throws on a missing matchedRestaurantId (normalized to null)', () => {
  assert.doesNotThrow(() => computeAnalysisResultHash({ ...BASE_INPUT, matchedRestaurantId: undefined }));
});
