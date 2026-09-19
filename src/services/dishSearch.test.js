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

// ─── BE-13 — restaurant-name-only matches removed from dish search ────────
// Written against the real, unmodified project data, same "no mocks"
// convention as the rest of this file. Baseline before this ticket's
// change: `q=Bardot` returned all 111 dishes at restaurant 6 ("Brasserie
// Bardot"), of which 110 matched only because the restaurant's own name
// contains "Bardot" — never because of anything in the dish itself. See
// planning/specs/tickets/be-13-remove-restaurant-name-only-dish-matches.md
// and docs/api/dish-search-ranking.md's "BE-13" amendment.

test('BE-13: "Bardot" returns only the one real content match, not the restaurant\'s full 111-dish menu', () => {
  const res = searchDishes({ q: 'Bardot' });
  assert.equal(res.total, 1, 'restaurant-name-only matches must no longer appear — only "Café Spécial" is a real match');
  const [match] = res.results;
  assert.equal(match.dishId, '6-lunch-4-5');
  assert.equal(match.name, 'Café Spécial');
  assert.equal(match.restaurantName, 'Brasserie Bardot');
  // The kept match is retained BECAUSE of its own description, not merely
  // because it happens to sit at a "Bardot"-named restaurant — this is the
  // exact "a dish matching the term both directly and via its restaurant
  // name must never disappear" case named in the BE-13 ticket.
  assert.match(match.description, /Bardot/, 'the surviving match must have a real, visible description match, not just a restaurant-name coincidence');
});

test('BE-13: a restaurant name with no dish-content match of its own now returns zero dish results', () => {
  // "Restaurant Wolfslaar" (id 1, 25 dishes across lunch/diner) has no
  // dish whose own name/description/supplement/wine/tag mentions
  // "Wolfslaar" — before this ticket, all 25 of its dishes matched via
  // the now-removed restaurant-name tier alone.
  const res = searchDishes({ q: 'Wolfslaar' });
  assert.equal(res.total, 0, 'a restaurant-name-only match must never produce a dish result');
});

test('BE-13: "friet" keeps its exact, unchanged pre-existing result set — unaffected by the restaurant-name tier removal', () => {
  const res = searchDishes({ q: 'friet' });
  const expectedIds = [
    '23-lunch-3-2', '23-diner-4-2', '23-lunch-3-4', '23-diner-4-4',
    '23-lunch-3-1', '23-diner-4-1', '23-diner-4-3', '23-diner-1-2',
    '23-diner-1-0', '23-lunch-0-12', '23-diner-1-6', '23-diner-1-1',
  ];
  assert.equal(res.total, expectedIds.length);
  assert.deepEqual(res.results.map((d) => d.dishId).sort(), expectedIds.sort());
});

test('BE-13: the mixed query "Bardot friet" stays at zero results — explicitly out of scope, not a regression', () => {
  const res = searchDishes({ q: 'Bardot friet' });
  assert.equal(res.total, 0, 'mixed/tokenized cross-field queries are a distinct, separately-scoped problem this ticket does not solve');
});

// ─── BE-15 — group broad dish search results by restaurant and menu ──────
// Written against the real, unmodified project data, same "no mocks"
// convention as the rest of this file. See
// planning/specs/tickets/be-15-group-broad-dish-search-results.md.

test('BE-15: an absent group value returns the exact, unmodified ungrouped response — no restaurantGroups field at all', () => {
  const ungrouped = searchDishes({ q: 'friet' });
  const withoutGroupParam = searchDishes({ q: 'friet', group: '' });
  assert.deepEqual(withoutGroupParam, ungrouped, 'omitting group must be byte-for-byte identical to the pre-BE-15 response');
  assert.equal(Object.prototype.hasOwnProperty.call(ungrouped, 'restaurantGroups'), false);
});

test('BE-15: an unknown group value falls back to the exact ungrouped response, same as an absent one', () => {
  const ungrouped = searchDishes({ q: 'friet' });
  const unknownGroup = searchDishes({ q: 'friet', group: 'meal' });
  assert.deepEqual(unknownGroup, ungrouped, 'an unrecognized group value must fall back completely and silently, never zero out results like an invalid `meal` would');
});

test('BE-15: q=kip — 11 dishes match, but none reaches the 4-or-more threshold, so restaurantGroups is empty and all 11 stay as individual results', () => {
  const res = searchDishes({ q: 'kip', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 0, 'no restaurant+menu combination for "kip" reaches 4 matches');
  assert.equal(res.total, 0, 'group-mode total counts qualifying restaurant groups — zero here');
  assert.equal(res.results.length, 11, 'all 11 underlying dish matches remain as individual, non-grouped results');
  assert.equal(res.lowCoverage, undefined, 'lowCoverage must not appear — the underlying, ungrouped dish count (11) is not zero, even though the group-mode total is');
});

test('BE-15: q=friet — both T-Huis menus reach the threshold (lunch=4, diner=8), one restaurant group with two subgroups, zero leftover individual results', () => {
  const res = searchDishes({ q: 'friet', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 1);
  const [group] = res.restaurantGroups;
  assert.equal(group.restaurantId, '23');
  assert.equal(group.restaurantName, 'T-Huis');
  assert.deepEqual(group.menus.map((m) => [m.mealType, m.count]), [['diner', 8], ['lunch', 4]], 'subgroups ordered by descending match count, diner (8) before lunch (4)');
  assert.equal(res.results.length, 0, 'every friet match belongs to the one qualifying restaurant, so no individual leftover dishes remain');
});

test('BE-15: q=brood — the decisive pagination-reliability fixture. Server-side aggregation over the full candidate set gives the real, complete counts regardless of dish-level page size', () => {
  const res = searchDishes({ q: 'brood', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 1, 'only T-Huis qualifies');
  const [group] = res.restaurantGroups;
  assert.equal(group.restaurantId, '23');
  assert.deepEqual(
    group.menus.map((m) => [m.mealType, m.count]),
    [['diner', 7], ['lunch', 5], ['borrel', 1]],
    'exact, complete per-menu totals (diner=7, lunch=5) — a client-side pass over one dish-level page alone would undercount these (see the ungrouped q=brood pagination test below)'
  );
  // T-Huis's own thin borrel menu (1 match) rides along as a third
  // subgroup purely because T-Huis already qualifies via diner/lunch —
  // never because 1 reaches the threshold on its own.
  assert.equal(group.menus.find((m) => m.mealType === 'borrel').count, 1);
  assert.equal(res.results.length, 11, 'Bardot (6), Zuyd (4), and Wolfslaar (1) — 11 dishes — stay individual; 13 grouped + 11 individual = 24');
  const leftoverRestaurantIds = new Set(res.results.map((d) => d.restaurantId));
  assert.deepEqual([...leftoverRestaurantIds].sort(), ['1', '19', '6'], 'no leftover dish belongs to T-Huis (id 23) — no duplication between the group and the individual list');
});

test('BE-15: the ungrouped q=brood response still exhibits the real pagination boundary this ticket\'s architecture is designed around', () => {
  // Proof that aggregation must happen over the full set, not one page:
  // page 1 alone would undercount 23-lunch/23-diner.
  const page1 = searchDishes({ q: 'brood', cursor: 0, limit: 20 });
  const page2 = searchDishes({ q: 'brood', cursor: 20, limit: 20 });
  assert.equal(page1.total, 24);
  assert.equal(page1.hasMore, true);
  const countOnPage1 = (mealType) => page1.results.filter((d) => d.restaurantId === '23' && d.mealType === mealType).length;
  const countOnPage2 = (mealType) => page2.results.filter((d) => d.restaurantId === '23' && d.mealType === mealType).length;
  assert.equal(countOnPage1('lunch') + countOnPage2('lunch'), 5, 'real total for 23-lunch is 5, split across the two dish-level pages');
  assert.equal(countOnPage1('diner') + countOnPage2('diner'), 7, 'real total for 23-diner is 7, split across the two dish-level pages');
});

test('BE-15: server-side aggregation happens before pagination — a small cursor/limit never shrinks a restaurant group\'s counts or drops the restaurant entirely', () => {
  const full = searchDishes({ q: 'brood', group: 'restaurant', limit: 20 });
  const tinyPage = searchDishes({ q: 'brood', group: 'restaurant', limit: 1 });
  assert.deepEqual(tinyPage.restaurantGroups[0], full.restaurantGroups[0], 'the one restaurant group on a 1-per-page slice is identical to the same group in a full, unpaginated fetch — aggregation ran over all 24 candidates either way');
});

test('BE-15: restaurant-level pagination — cursor/limit paginate qualifying restaurant groups, never raw dishes, and a group is never split across two pages', () => {
  // A synthetic broad query with more than one qualifying restaurant is not
  // reproducible against today's real data (only T-Huis ever reaches the
  // threshold on any single real query) — so this proves the pagination
  // mechanics themselves on the one real multi-group-shaped case available:
  // requesting limit=1 still returns exactly the one real qualifying group,
  // complete and un-split, with hasMore correctly false since there is only
  // one qualifying restaurant for this query today.
  const res = searchDishes({ q: 'brood', group: 'restaurant', limit: 1 });
  assert.equal(res.restaurantGroups.length, 1);
  assert.equal(res.restaurantGroups[0].menus.length, 3, 'all three of T-Huis\'s own qualifying/riding-along menus stay together in the one group, never split');
  assert.equal(res.hasMore, false);
  assert.equal(res.nextCursor, null);
});

test('BE-15: no duplication — a dish appearing in a qualifying restaurant group never also appears in the individual results list', () => {
  const res = searchDishes({ q: 'brood', group: 'restaurant' });
  const groupedRestaurantIds = new Set(res.restaurantGroups.map((g) => g.restaurantId));
  for (const dish of res.results) {
    assert.equal(groupedRestaurantIds.has(dish.restaurantId), false, `dish ${dish.dishId} belongs to a restaurant that is both grouped and listed individually`);
  }
});

test('BE-15: qualifying menu subgroups reuse the exact same public dish fields and openStatus computation as the ungrouped path — no separate/duplicated shape', () => {
  const ungrouped = searchDishes({ q: 'friet' });
  const grouped = searchDishes({ q: 'friet', group: 'restaurant' });
  const dinerNames = ungrouped.results.filter((d) => d.mealType === 'diner').map((d) => d.name);
  const group = grouped.restaurantGroups[0];
  const dinerMenu = group.menus.find((m) => m.mealType === 'diner');
  assert.deepEqual(dinerMenu.examples, dinerNames.slice(0, 3), 'the first three examples must be the same three dishes, in the same relevance order, as the ungrouped path already returns');
  assert.equal(dinerMenu.menuLink, '/menu/23-diner');
});

test('BE-15: lowCoverage keeps its exact existing trigger under group=restaurant — a genuinely zero-match query still gets it, identically in both modes', () => {
  // Real fixture: cuisine "Chinees" has one relevant restaurant with no
  // digitized menu data — the ungrouped path already surfaces lowCoverage
  // for this filter today.
  const filters = { cuisines: ['Chinees'] };
  const ungrouped = searchDishes(filters);
  const grouped = searchDishes({ ...filters, group: 'restaurant' });
  assert.ok(ungrouped.lowCoverage, 'baseline: this real filter must already trigger lowCoverage in the ungrouped response');
  assert.deepEqual(grouped.lowCoverage, ungrouped.lowCoverage, 'lowCoverage must be identical in both modes for the same genuinely-zero-match filters');
  assert.deepEqual(grouped.restaurantGroups, [], 'zero underlying matches means zero groups too');
});
