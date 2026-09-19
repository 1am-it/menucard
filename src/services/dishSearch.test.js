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

// ─── BE-15/BE-16 — group broad dish search results by restaurant and
// menu, always, for every restaurant with at least one match ───────────
// Written against the real, unmodified project data, same "no mocks"
// convention as the rest of this file. See
// planning/specs/tickets/be-16-uniform-restaurant-grouped-dish-search-results.md.

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

test('BE-16: q=kip — 11 dishes match across 3 restaurants; every restaurant becomes its own group, none stays an individual result, and lowCoverage is correctly absent', () => {
  const res = searchDishes({ q: 'kip', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 3, 'BE-15\'s old "4 or more" threshold is retired — Brasserie Bardot, Restaurant Zuyd, and T-Huis all qualify now, none of them reaching 4 on any single menu');
  assert.equal(res.total, 3, 'group-mode total counts restaurant groups');
  assert.equal(res.results.length, 0, 'no leftover individual results — every one of the 11 dishes lives inside a group');
  const byRestaurant = Object.fromEntries(res.restaurantGroups.map((g) => [g.restaurantName, g.menus.map((m) => [m.mealType, m.count])]));
  assert.deepEqual(byRestaurant['Brasserie Bardot'], [['lunch', 2], ['diner', 1], ['specialiteiten', 1]]);
  assert.deepEqual(byRestaurant['Restaurant Zuyd'], [['lunch', 1], ['diner', 1]]);
  assert.deepEqual(byRestaurant['T-Huis'], [['lunch', 3], ['diner', 2]]);
  assert.equal(res.lowCoverage, undefined, 'lowCoverage must not appear — the underlying, ungrouped dish count (11) is not zero');
});

test('BE-16: q=friet — one restaurant group with two subgroups (unchanged in outcome from before, since T-Huis already had 4+ matches on both menus)', () => {
  const res = searchDishes({ q: 'friet', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 1);
  const [group] = res.restaurantGroups;
  assert.equal(group.restaurantId, '23');
  assert.equal(group.restaurantName, 'T-Huis');
  assert.deepEqual(group.menus.map((m) => [m.mealType, m.count]), [['diner', 8], ['lunch', 4]], 'subgroups ordered by descending match count, diner (8) before lunch (4)');
  assert.equal(res.results.length, 0, 'no leftover individual results');
});

test('BE-16: q=brood — four restaurant groups (not one), no leftover individual results, sum equals the ungrouped total exactly', () => {
  const res = searchDishes({ q: 'brood', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 4, 'every restaurant with a match is now its own group: T-Huis, Brasserie Bardot, Restaurant Zuyd, Restaurant Wolfslaar');
  assert.equal(res.results.length, 0, 'no leftover individual results — every dish lives inside a group');
  const byRestaurant = Object.fromEntries(res.restaurantGroups.map((g) => [g.restaurantName, g.menus.map((m) => [m.mealType, m.count])]));
  assert.deepEqual(byRestaurant['T-Huis'], [['diner', 7], ['lunch', 5], ['borrel', 1]], 'exact, complete per-menu totals (diner=7, lunch=5) — a client-side pass over one dish-level page alone would undercount these');
  assert.deepEqual(byRestaurant['Brasserie Bardot'], [['diner', 3], ['lunch', 3]]);
  assert.deepEqual(byRestaurant['Restaurant Zuyd'], [['lunch', 3], ['diner', 1]]);
  assert.deepEqual(byRestaurant['Restaurant Wolfslaar'], [['diner', 1]]);
  const sum = res.restaurantGroups.reduce((s, g) => s + g.menus.reduce((s2, m) => s2 + m.count, 0), 0);
  assert.equal(sum, 24, '13 (T-Huis) + 6 (Bardot) + 4 (Zuyd) + 1 (Wolfslaar) = 24, matching the ungrouped total exactly — no dish counted twice or dropped');
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

test('BE-15: server-side aggregation happens before pagination — a small cursor/limit never shrinks a restaurant group\'s counts or drops it from the page it belongs on', () => {
  const full = searchDishes({ q: 'brood', group: 'restaurant', limit: 20 });
  const tinyPage = searchDishes({ q: 'brood', group: 'restaurant', limit: 1 });
  assert.deepEqual(tinyPage.restaurantGroups[0], full.restaurantGroups[0], 'the one restaurant group on a 1-per-page slice is identical to the same group (first in relevance order) in a full, unpaginated fetch — aggregation ran over all 24 candidates either way');
});

test('BE-16: restaurant-level pagination — cursor/limit paginate restaurant groups across real multi-group data, never raw dishes, and a group is never split across two pages', () => {
  // q=brood now produces 4 real restaurant groups — enough to prove
  // restaurant-level pagination against real, multi-group data (BE-15
  // could only prove this against one real group).
  const page1 = searchDishes({ q: 'brood', group: 'restaurant', limit: 2 });
  const page2 = searchDishes({ q: 'brood', group: 'restaurant', limit: 2, cursor: page1.nextCursor });
  assert.equal(page1.restaurantGroups.length, 2);
  assert.equal(page1.total, 4);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.restaurantGroups.length, 2);
  assert.equal(page2.hasMore, false);
  assert.equal(page2.nextCursor, null);
  const allNames = [...page1.restaurantGroups, ...page2.restaurantGroups].map((g) => g.restaurantName);
  assert.deepEqual(allNames, ['Brasserie Bardot', 'Restaurant Zuyd', 'T-Huis', 'Restaurant Wolfslaar'], 'restaurant groups are ordered by relevance (first-appearance in the ranked candidates), never alphabetical, and no group spans two pages');
  // T-Huis's own three menus (including the thin, 1-match borrel menu)
  // stay together, un-split, on page 2.
  assert.equal(page2.restaurantGroups[0].menus.length, 3);
});

test('BE-16: no duplication or loss — every restaurant group appears exactly once across all pages, and no dish is ever left over', () => {
  const res = searchDishes({ q: 'brood', group: 'restaurant', limit: 50 });
  const restaurantIds = res.restaurantGroups.map((g) => g.restaurantId);
  assert.equal(new Set(restaurantIds).size, restaurantIds.length, 'no restaurant appears in more than one group');
  assert.equal(res.results.length, 0, 'no dish is ever left as an individual, non-grouped result');
});

test('BE-16: menu subgroups carry public example dish objects (dishId/name/category/weakMatch), sufficient to build an exact BE-12 link, in the same relevance order and capped at 3 the ungrouped path already returns', () => {
  const ungrouped = searchDishes({ q: 'friet' });
  const grouped = searchDishes({ q: 'friet', group: 'restaurant' });
  const dinerDishes = ungrouped.results.filter((d) => d.mealType === 'diner');
  const group = grouped.restaurantGroups[0];
  const dinerMenu = group.menus.find((m) => m.mealType === 'diner');
  assert.equal(dinerMenu.examples.length, 3, 'capped at the example limit even though 8 dishes match');
  assert.deepEqual(
    dinerMenu.examples,
    dinerDishes.slice(0, 3).map((d) => ({ dishId: d.dishId, name: d.name, category: d.category, weakMatch: false })),
    'the first three examples must be the same three dishes, with the same dishId/name/category BE-12 needs, in the same relevance order the ungrouped path already returns; none of these visibly-named "friet" matches is a weak match'
  );
  assert.equal(dinerMenu.menuLink, '/menu/23-diner');
  for (const example of dinerMenu.examples) {
    const allowedKeys = ['dishId', 'name', 'category', 'weakMatch'];
    assert.deepEqual(Object.keys(example).sort(), allowedKeys.sort(), 'examples must never leak internal/extra dish fields beyond dishId/name/category/weakMatch');
    assert.equal(Object.prototype.hasOwnProperty.call(example, 'priceValue'), false);
  }
});

// ─── BE-12 §1.2/BE-13 — restored provenance hint for BE-16's examples ────
// Recovered from the pre-BE-16 app/search/page.js's own isWeakMatch(dish,
// query): a dish is a weak match only when the query appears in none of
// its visible fields (name/description/tags) — never a tier-based
// approximation, since tier 2 also covers a *visible* description match.
// Only a boolean ever reaches the client; the raw internal `_sup`/`_wine`
// text itself is never exposed.

test('BE-13/BE-16: the real q=Chablis fixture — every shown example matches only via the internal wine field, so every one is flagged weakMatch: true', () => {
  const res = searchDishes({ q: 'Chablis', group: 'restaurant' });
  const [group] = res.restaurantGroups;
  assert.equal(group.restaurantName, 'Brasserie Bardot');
  const allExamples = group.menus.flatMap((m) => m.examples);
  assert.ok(allExamples.length > 0, 'expected at least one shown example');
  for (const example of allExamples) {
    assert.equal(example.weakMatch, true, `expected ${example.name} (${example.dishId}) to be flagged as a weak match — none of these dish names/categories visibly contain "Chablis"`);
    assert.doesNotMatch(example.name.toLowerCase(), /chablis/, 'sanity check: the visible name really does not contain the query');
  }
});

test('BE-13/BE-16: a normal, visibly-matching example (q=Bardot, matches via its own visible description) is never flagged as a weak match', () => {
  const res = searchDishes({ q: 'Bardot', group: 'restaurant' });
  const [group] = res.restaurantGroups;
  const [menu] = group.menus;
  assert.equal(menu.examples.length, 1);
  assert.equal(menu.examples[0].name, 'Café Spécial');
  assert.equal(menu.examples[0].weakMatch, false, 'this dish is kept precisely because its own description visibly contains "Bardot" (BE-13) — it must never be flagged as a weak match');
});

test('BE-13/BE-16: q=friet — none of the shown examples are weak matches, even though the underlying result set contains at least one real weak-match dish (23-lunch-0-12, "TFC Burger") that simply isn\'t among the top 3 shown', () => {
  const grouped = searchDishes({ q: 'friet', group: 'restaurant' });
  const allExamples = grouped.restaurantGroups.flatMap((g) => g.menus.flatMap((m) => m.examples));
  assert.ok(allExamples.length > 0);
  for (const example of allExamples) {
    assert.equal(example.weakMatch, false, `expected ${example.name} to be a real, visible "friet" match, not a weak one`);
  }
  // Confirm the real weak-match dish this fixture is known to contain
  // still exists in the underlying (ungrouped) result set — proving the
  // hint mechanism is correctly selective, not simply always-false.
  const ungrouped = searchDishes({ q: 'friet' });
  assert.ok(ungrouped.results.some((d) => d.dishId === '23-lunch-0-12'), 'expected the known real weak-match dish to still be part of the underlying friet result set');
});

test('BE-16: the real q=Höpler fixture — one restaurant, one menu subgroup, three examples that all share the identical name but differ by category', () => {
  const res = searchDishes({ q: 'Höpler', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 1);
  const [group] = res.restaurantGroups;
  assert.equal(group.restaurantName, 'T-Huis');
  const [menu] = group.menus;
  assert.equal(menu.mealType, 'borrel');
  assert.equal(menu.count, 3);
  assert.equal(menu.examples.length, 3);
  assert.ok(menu.examples.every((e) => e.name === 'Höpler - Seeblick'), 'all three real examples share the identical dish name');
  assert.deepEqual(
    menu.examples.map((e) => e.category).sort(),
    ['Wijnen — Rood', 'Wijnen — Rosé', 'Wijnen — Wit'].sort(),
    'each example is distinguishable by its own category, and by its own dishId — enough for the client to disambiguate and deep-link correctly'
  );
  assert.equal(new Set(menu.examples.map((e) => e.dishId)).size, 3, 'each example has its own distinct dishId');
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
