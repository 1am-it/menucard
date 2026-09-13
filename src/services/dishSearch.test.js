'use strict';

// BE-11 Stap 0/1 — regression tests for the sup/wine search-completeness
// fix. Written against the real, unmodified project data (data/restaurants
// .json, data/menus.json), per this project's own "read the real thing, no
// mocks" testing convention. Covers exactly the five cases the BE-11
// baseline review named:
//   1) `pancetta` now finds its dish via `sup`;
//   2) `Chablis` now finds its dish via `wine`;
//   3) the public dish shape never includes `sup`/`wine`;
//   4) the fixed `q=steak&excl=7` allergen-exclusion baseline is unchanged;
//   5) an ordinary query with no sup/wine involvement keeps its exact,
//      pre-existing result set and order.
//
// This is also the first test file for dishSearch.js — the module was
// converted from ESM `import`/`export` to CommonJS specifically so it
// could be tested this way, matching importInbox.js/moderationFormatting
// .js's own, already-documented reasoning for the same choice.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { searchDishes } = require('./dishSearch');

test('sup: "pancetta" finds exactly the four known T-Huis dishes via its sup field', () => {
  const res = searchDishes({ q: 'pancetta' });
  const expectedIds = ['23-lunch-0-10', '23-diner-1-0', '23-lunch-0-11', '23-diner-1-1'];
  assert.equal(res.total, expectedIds.length, 'baseline expected exactly 4 matches for "pancetta"');
  assert.deepEqual(
    res.results.map((d) => d.dishId).sort(),
    expectedIds.sort(),
    'expected exactly these four T-Huis dishes, no more, no fewer'
  );
  // Keep the original, most-readable case as an explicit sanity check.
  const match = res.results.find((d) => d.dishId === '23-lunch-0-10');
  assert.ok(match, 'expected dish 23-lunch-0-10 ("Steak à la T-Huis") to be found via sup');
  assert.equal(match.name, 'Steak à la T-Huis');
  assert.equal(match.restaurantName, 'T-Huis');
});

test('wine: "Chablis" finds exactly the six known Brasserie Bardot dishes via its wine field', () => {
  const res = searchDishes({ q: 'Chablis' });
  const expectedIds = [
    '6-diner-1-3', '6-lunch-2-10', '6-borrel-0-5',
    '6-diner-2-4', '6-borrel-0-0', '6-diner-2-5',
  ];
  assert.equal(res.total, expectedIds.length, 'baseline expected exactly 6 matches for "Chablis"');
  assert.deepEqual(
    res.results.map((d) => d.dishId).sort(),
    expectedIds.sort(),
    'expected exactly these six Brasserie Bardot dishes, no more, no fewer'
  );
  // Keep the original, most-readable case as an explicit sanity check.
  const match = res.results.find((d) => d.dishId === '6-diner-1-3');
  assert.ok(match, 'expected dish 6-diner-1-3 ("Garnalenkroketten (2 st.)") to be found via wine');
  assert.equal(match.name, 'Garnalenkroketten (2 st.)');
  assert.equal(match.restaurantName, 'Brasserie Bardot');
});

test('public shape never includes sup or wine, for any result', () => {
  const queries = ['pancetta', 'Chablis', 'steak', 'gnocchi'];
  for (const q of queries) {
    const res = searchDishes({ q });
    for (const dish of res.results) {
      assert.equal(Object.prototype.hasOwnProperty.call(dish, 'sup'), false, `sup leaked into public shape for query "${q}"`);
      assert.equal(Object.prototype.hasOwnProperty.call(dish, 'wine'), false, `wine leaked into public shape for query "${q}"`);
      assert.equal(Object.prototype.hasOwnProperty.call(dish, '_sup'), false, `_sup leaked into public shape for query "${q}"`);
      assert.equal(Object.prototype.hasOwnProperty.call(dish, '_wine'), false, `_wine leaked into public shape for query "${q}"`);
      assert.equal(Object.prototype.hasOwnProperty.call(dish, '_restaurant'), false, `_restaurant leaked into public shape for query "${q}"`);
    }
  }
});

test('allergen-exclusion baseline: "steak" excluding allergen 7 still excludes exactly the same two known dishes', () => {
  const withoutExclusion = searchDishes({ q: 'steak' });
  const withExclusion = searchDishes({ q: 'steak', excludeAllergens: [7] });

  assert.equal(withoutExclusion.total, 11, 'baseline expected 11 matches for "steak" without exclusion');
  assert.equal(withExclusion.total, 9, 'baseline expected 9 matches for "steak" excluding allergen 7');

  const idsWithout = withoutExclusion.results.map((d) => d.dishId);
  const idsWith = withExclusion.results.map((d) => d.dishId);
  const removed = idsWithout.filter((id) => !idsWith.includes(id));

  assert.deepEqual(
    removed.sort(),
    ['19-diner-2-0', '19-lunch-3-0'].sort(),
    'excluding allergen 7 should remove exactly the two known Restaurant Zuyd "Steak tartaar" dishes'
  );
  for (const dish of withExclusion.results) {
    assert.ok(!dish.allergens.includes(7), `dish ${dish.dishId} should not carry excluded allergen 7`);
  }
});

test('ordinary query unaffected by sup/wine: "steak" keeps its exact pre-existing result set and order', () => {
  const res = searchDishes({ q: 'steak' });
  const expectedOrder = [
    '6-diner-1-1', '6-diner-1-0', '6-lunch-2-4', '6-lunch-2-3',
    '19-lunch-3-0', '19-diner-2-0', '23-lunch-0-10', '23-diner-1-0',
    '23-diner-0-0', '23-lunch-3-2', '23-diner-4-2',
  ];
  assert.equal(res.total, expectedOrder.length);
  assert.deepEqual(res.results.map((d) => d.dishId), expectedOrder);
});
