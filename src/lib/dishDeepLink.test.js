'use strict';

// BE-12 — functional tests for resolveDishTarget() against real project
// data (data/menus.json), not synthetic fixtures — same "no mocks"
// convention as src/services/dishSearch.test.js. Covers exactly the cases
// be-12-dish-result-deep-link-scroll-highlight.md names as load-bearing:
// a real 12-way (8-within-one-menu) "friet" spread on restaurant 23, and a
// real 3-way identical-name-different-category duplicate ("Höpler -
// Seeblick") on 23-borrel.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const menusData = require('../../data/menus.json');
const { resolveDishTarget } = require('./dishDeepLink');

test('valid dish/name/cat resolves to the exact real fixture (23-diner-1-0, "Steak à la T-Huis", "Hoofdgerechten")', () => {
  const categories = menusData['23-diner'].categories;
  const result = resolveDishTarget('23-diner-1-0', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories);
  assert.deepEqual(result, { catIdx: 1, itemIdx: 0 });
  assert.equal(categories[result.catIdx].items[result.itemIdx].name, 'Steak à la T-Huis');
});

test('name comparison is trimmed and case-insensitive, matching the ticket\'s own validation rule', () => {
  const categories = menusData['23-diner'].categories;
  const result = resolveDishTarget('23-diner-1-0', '  steak à la t-huis  ', 'Hoofdgerechten', '23-diner', categories);
  assert.deepEqual(result, { catIdx: 1, itemIdx: 0 });
});

test('category comparison is exact — a near-miss category is rejected, not fuzzy-matched', () => {
  const categories = menusData['23-diner'].categories;
  const result = resolveDishTarget('23-diner-1-0', 'Steak à la T-Huis', 'hoofdgerechten', '23-diner', categories);
  assert.equal(result, null);
});

test('a mismatched name invalidates the whole result, even with a correct dish id and category', () => {
  const categories = menusData['23-diner'].categories;
  const result = resolveDishTarget('23-diner-1-0', 'Kipsaté', 'Hoofdgerechten', '23-diner', categories);
  assert.equal(result, null);
});

test('a mismatched category invalidates the whole result, even with a correct dish id and name', () => {
  const categories = menusData['23-diner'].categories;
  const result = resolveDishTarget('23-diner-1-0', 'Steak à la T-Huis', 'Voorgerechten', '23-diner', categories);
  assert.equal(result, null);
});

test('a dish id whose route-id prefix does not match this route is rejected outright', () => {
  const categories = menusData['23-diner'].categories;
  // Same suffix, but this route is "23-lunch", not "23-diner".
  const result = resolveDishTarget('23-lunch-1-0', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories);
  assert.equal(result, null);
});

test('an out-of-range category index is rejected, never wraps or clamps', () => {
  const categories = menusData['23-diner'].categories;
  const result = resolveDishTarget('23-diner-99-0', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories);
  assert.equal(result, null);
});

test('an out-of-range item index is rejected, never wraps or clamps', () => {
  const categories = menusData['23-diner'].categories;
  const result = resolveDishTarget('23-diner-1-999', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories);
  assert.equal(result, null);
});

test('a malformed dish id (non-numeric position, extra segments) is rejected, never partially parsed', () => {
  const categories = menusData['23-diner'].categories;
  assert.equal(resolveDishTarget('23-diner-abc-0', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories), null);
  assert.equal(resolveDishTarget('23-diner-1-0-extra', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories), null);
  assert.equal(resolveDishTarget('23-diner-1', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories), null);
  // A negative-looking index must not be silently accepted as index 1 by
  // a loose numeric parse — the digit-only regex must reject it outright.
  assert.equal(resolveDishTarget('23-diner--1', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories), null);
});

test('dish context requires all three of dish/name/cat — any single one missing invalidates it, matching the "no partial context" rule', () => {
  const categories = menusData['23-diner'].categories;
  assert.equal(resolveDishTarget(null, 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories), null);
  assert.equal(resolveDishTarget('23-diner-1-0', null, 'Hoofdgerechten', '23-diner', categories), null);
  assert.equal(resolveDishTarget('23-diner-1-0', 'Steak à la T-Huis', null, '23-diner', categories), null);
  assert.equal(resolveDishTarget('23-diner-1-0', '', 'Hoofdgerechten', '23-diner', categories), null);
});

// ─── Real, verified multiple-matches fixture — 8 "friet" matches on this
// exact menu (data/menus.json, confirmed via searchDishes({q:'friet'})) —
// only the one, explicitly validated dishId may ever resolve. ───────────

test('among 8 real "friet" matches on the same menu, only the exact validated dishId resolves — never a different one that also contains "friet"', () => {
  const categories = menusData['23-diner'].categories;
  const otherFrietDishIds = ['23-diner-4-1', '23-diner-4-2', '23-diner-4-3', '23-diner-4-4', '23-diner-1-1', '23-diner-1-2', '23-diner-1-6'];
  for (const otherDishId of otherFrietDishIds) {
    // Deliberately keep the *target's* real name/category while pointing
    // at a *different* real dishId — this must fail, proving the position
    // itself is checked, not just "does some item on this menu match."
    const result = resolveDishTarget(otherDishId, 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories);
    assert.equal(result, null, `${otherDishId} must not resolve to "Steak à la T-Huis"`);
  }
  // The real, intended target still resolves correctly on its own.
  assert.deepEqual(
    resolveDishTarget('23-diner-1-0', 'Steak à la T-Huis', 'Hoofdgerechten', '23-diner', categories),
    { catIdx: 1, itemIdx: 0 }
  );
});

// ─── Real, verified identical-name-different-category fixture ──────────

test('three real, identically-named "Höpler - Seeblick" entries in different categories each resolve only to their own category — never to one of the other two', () => {
  const categories = menusData['23-borrel'].categories;
  const cases = [
    { dishId: '23-borrel-2-4', cat: 'Wijnen — Wit' },
    { dishId: '23-borrel-5-6', cat: 'Wijnen — Rood' },
    { dishId: '23-borrel-6-1', cat: 'Wijnen — Rosé' },
  ];
  for (const { dishId, cat } of cases) {
    const result = resolveDishTarget(dishId, 'Höpler - Seeblick', cat, '23-borrel', categories);
    assert.ok(result, `${dishId} with its own real category (${cat}) must resolve`);
    assert.equal(categories[result.catIdx].name, cat);
  }
  // Cross-matching the same name against a *different* one of the three
  // categories must fail — this is exactly why category is required, not
  // optional, per the ticket's own "Multiple matches" section.
  assert.equal(resolveDishTarget('23-borrel-2-4', 'Höpler - Seeblick', 'Wijnen — Rood', '23-borrel', categories), null);
  assert.equal(resolveDishTarget('23-borrel-5-6', 'Höpler - Seeblick', 'Wijnen — Rosé', '23-borrel', categories), null);
});

// ─── Safe encoding — a real accented dish name survives an encode/decode
// round trip (exactly what URLSearchParams does in the browser) and still
// validates correctly. ───────────────────────────────────────────────────

test('a real accented dish name ("Café Spécial") still resolves correctly after a URL encode/decode round trip', () => {
  const categories = menusData['6-lunch'].categories;
  const encoded = new URLSearchParams({ name: 'Café Spécial' }).toString();
  const decodedName = new URLSearchParams(encoded).get('name');
  assert.equal(decodedName, 'Café Spécial', 'sanity check: the round trip itself must be lossless');
  const result = resolveDishTarget('6-lunch-4-5', decodedName, 'Dessert', '6-lunch', categories);
  assert.deepEqual(result, { catIdx: 4, itemIdx: 5 });
});
