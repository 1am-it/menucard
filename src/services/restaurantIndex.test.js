'use strict';

// BE-11 Fase 1 — regression tests for the restaurant-level browse index.
// Written against the real, unmodified project data (data/restaurants
// .json), per this project's own "read the real thing, no mocks" testing
// convention — same pattern as src/services/dishSearch.test.js.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { searchRestaurants, isValidAddress } = require('./restaurantIndex');

test('whitelist: no internal field leaks into the public shape, for any result', () => {
  const res = searchRestaurants({ limit: 50 });
  for (const restaurant of res.results) {
    assert.equal(Object.prototype.hasOwnProperty.call(restaurant, '_validAddress'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(restaurant, '_restaurant'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(restaurant, 'menus'), false, 'legacy embedded menus blob must never leak');
    assert.equal(Object.prototype.hasOwnProperty.call(restaurant, 'phone'), false, 'contact fields are not part of this whitelist');
    assert.equal(Object.prototype.hasOwnProperty.call(restaurant, 'reservation'), false, 'contact fields are not part of this whitelist');
    assert.equal(Object.prototype.hasOwnProperty.call(restaurant, 'website'), false, 'contact fields are not part of this whitelist');
    assert.equal(Object.prototype.hasOwnProperty.call(restaurant, 'description'), false, 'no long description in this whitelist');
  }
});

test('whitelist: every result carries exactly the documented public fields', () => {
  const res = searchRestaurants({ limit: 1 });
  const expectedKeys = ['restaurantId', 'name', 'cuisine', 'priceLevel', 'buurt', 'address', 'openStatus', 'menuLinks', 'hasMenu'].sort();
  assert.deepEqual(Object.keys(res.results[0]).sort(), expectedKeys);
});

test('pagination: default limit, total, and cursor across two pages cover the full known catalog', () => {
  const page1 = searchRestaurants({});
  assert.equal(page1.total, 25, 'baseline expected 25 known restaurants');
  assert.equal(page1.results.length, 20, 'default limit expected to be 20');
  assert.equal(page1.nextCursor, 20);
  assert.equal(page1.hasMore, true);

  const page2 = searchRestaurants({ cursor: page1.nextCursor });
  assert.equal(page2.total, 25);
  assert.equal(page2.results.length, 5, 'remaining 5 restaurants on the second page');
  assert.equal(page2.nextCursor, null);
  assert.equal(page2.hasMore, false);

  const combinedIds = [...page1.results, ...page2.results].map((r) => r.restaurantId);
  assert.equal(new Set(combinedIds).size, 25, 'two pages together must cover every known restaurant exactly once');
});

test('negative cursor is treated safely as the first page, not an error', () => {
  const res = searchRestaurants({ cursor: -5 });
  assert.equal(res.total, 25);
  assert.equal(res.results.length, 20, 'a negative cursor must clamp to 0, not throw or skip');
});

test('cursor past the end of the result set returns an empty page with an honest total, not an error', () => {
  const res = searchRestaurants({ cursor: 1000 });
  assert.equal(res.total, 25, 'total reflects the full matching set, independent of an out-of-range cursor');
  assert.deepEqual(res.results, []);
  assert.equal(res.nextCursor, null);
  assert.equal(res.hasMore, false);
});

test('menu-less restaurant: appears in the browse index with hasMenu false and an empty menuLinks array', () => {
  const res = searchRestaurants({ limit: 50 });
  const blossem = res.results.find((r) => r.restaurantId === '2');
  assert.ok(blossem, 'Restaurant Blossem (id 2, known to have zero menu data) must still appear');
  assert.equal(blossem.hasMenu, false);
  assert.deepEqual(blossem.menuLinks, []);
});

test('restaurant with menu data: hasMenu true and real menuLinks are exposed', () => {
  const res = searchRestaurants({ limit: 50 });
  const bardot = res.results.find((r) => r.restaurantId === '6');
  assert.ok(bardot);
  assert.equal(bardot.hasMenu, true);
  assert.equal(bardot.menuLinks.length, 4);
});

test('valid buurt matching: q="Binnenstad" returns exactly the 16 known Binnenstad restaurants', () => {
  const res = searchRestaurants({ q: 'Binnenstad', limit: 50 });
  assert.equal(res.total, 16);
  for (const restaurant of res.results) {
    assert.equal(restaurant.buurt, 'Binnenstad');
  }
});

test('name search: q="Bardot" finds exactly the one known matching restaurant', () => {
  const res = searchRestaurants({ q: 'Bardot' });
  assert.equal(res.total, 1);
  assert.equal(res.results[0].name, 'Brasserie Bardot');
});

test('a query with no match returns an empty result set, total 0, no next cursor, and no error', () => {
  const res = searchRestaurants({ q: 'zzzznomatch' });
  assert.deepEqual(res.results, []);
  assert.equal(res.total, 0);
  assert.equal(res.nextCursor, null);
  assert.equal(res.hasMore, false);
});

test('a query shorter than 2 characters behaves exactly like browsing with no query at all', () => {
  const res = searchRestaurants({ q: 'a' });
  const browseAll = searchRestaurants({});
  assert.equal(res.total, 25);
  assert.equal(res.total, browseAll.total);
  assert.deepEqual(res.results.map((r) => r.restaurantId), browseAll.results.map((r) => r.restaurantId));
});

test('restaurant 10 (Salon de Provence) placeholder address is excluded from free-text address matching', () => {
  // No real restaurant's name or buurt contains "breda" (verified against
  // the real dataset) — so a "breda" query can only match via a valid,
  // real street address. Restaurant 10's own placeholder address contains
  // the literal string "Breda" too, but must not match, because it is not
  // a real address.
  const res = searchRestaurants({ q: 'breda', limit: 50 });
  assert.equal(res.total, 24, 'expected all real addresses except the one known placeholder');
  const ids = res.results.map((r) => r.restaurantId);
  assert.equal(ids.includes('10'), false, 'restaurant 10 must not match via its placeholder address');
});

test('restaurant 10 (Salon de Provence) is still findable by name and shows address: null, never the placeholder text', () => {
  const res = searchRestaurants({ q: 'Provence' });
  const salon = res.results.find((r) => r.restaurantId === '10');
  assert.ok(salon, 'restaurant 10 must still be findable via its real name');
  assert.equal(salon.address, null, 'the placeholder address string must never be exposed publicly');
  assert.equal(salon.buurt, 'Binnenstad', 'a valid, unrelated field (buurt) is unaffected by the address problem');
});

test('isValidAddress: rejects only the specific name+city placeholder pattern, not addresses without a digit', () => {
  assert.equal(isValidAddress('Salon de Provence Breda', 'Salon de Provence'), false);
  assert.equal(isValidAddress('Wolfslaardreef 100, 4834 SP Breda', 'Restaurant Wolfslaar'), true);
  // Deliberately not a blanket "no digit = invalid" rule: a plausible,
  // non-placeholder address with no house number must still be accepted.
  assert.equal(isValidAddress('Grote Markt, Breda', 'Con Fuego'), true);
  assert.equal(isValidAddress('', 'Any Restaurant'), false);
  assert.equal(isValidAddress(null, 'Any Restaurant'), false);
});

test('ordinary browse (no query) is sorted deterministically by restaurant name', () => {
  const res = searchRestaurants({ limit: 50 });
  const names = res.results.map((r) => r.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'nl'));
  assert.deepEqual(names, sorted);
});
