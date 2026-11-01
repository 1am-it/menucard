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

  assert.equal(withoutExclusion.total, 15, 'baseline expected 15 matches for "steak" without exclusion (BE-71 added the two live cards of restaurant 5)');
  assert.equal(withExclusion.total, 13, 'baseline expected 13 matches for "steak" excluding allergen 7');

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

test('BE-71 R5: een toeslag ("Extra vlees: Kipfilet € 4") staat nooit als los zoekresultaat', () => {
  // The Zenza card prints "Kipfilet" twice: € 18,50 as a dish of the SCHOTELS
  // and € 4 as an extra under EXTRA VLEES. Only the dish is a search result.
  const res = searchDishes({ q: 'kipfilet' });
  const zenza = res.results.filter((dish) => dish.restaurantId === '17');
  assert.ok(zenza.some((dish) => dish.category === 'SCHOTELS' && dish.priceDisplay === '€18,50'), 'de kipfilet van de schotels is een gerecht');
  assert.deepEqual(zenza.filter((dish) => dish.category === 'EXTRA VLEES'), [], 'de toeslag van "Extra vlees" staat nergens tussen');
  for (const dish of res.results) assert.notEqual(dish.priceDisplay, '€4', 'no supplement may surface as a dish');

  // The same check over every supplement of the data, so a future card cannot
  // quietly reintroduce one.
  const menus = require('../../data/menus.json');
  for (const [key, menu] of Object.entries(menus)) {
    for (const category of menu.categories || []) {
      for (const item of category.items || []) {
        if (item.priceIsSupplement !== true) continue;
        const found = searchDishes({ q: item.name }).results.some((dish) => dish.restaurantId === key.split('-')[0] && dish.category === category.name && dish.priceDisplay === item.price);
        assert.equal(found, false, `${key}: ${item.name} (${item.price}) is een toeslag`);
      }
    }
  }
});

test('ordinary query unaffected by sup/wine: "steak" keeps its exact pre-existing result set and order', () => {
  const res = searchDishes({ q: 'steak' });
  const expectedOrder = [
    '6-diner-1-1', '6-diner-1-0', '6-lunch-2-4', '6-lunch-2-3',
    '5-lunch-0-10', '5-lunch-0-0',
    '19-lunch-3-0', '19-diner-2-0', '23-lunch-0-10', '23-diner-1-0',
    '23-diner-0-0', '5-lunch-0-8', '5-lunch-0-5',
    '23-lunch-3-2', '23-diner-4-2',
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
    // BE-71: the live card of Restaurant Chocolat (5) prints friet twice.
    '5-lunch-0-4', '5-lunch-0-10',
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

test('BE-16: q=kip — 36 dishes match across 5 restaurants; every restaurant becomes its own group, none stays an individual result, and lowCoverage is correctly absent', () => {
  const res = searchDishes({ q: 'kip', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 5, 'BE-15\'s old "4 or more" threshold is retired — Brasserie Bardot, Restaurant Zuyd, T-Huis, Makanan and (since BE-71 ronde 3) Restaurant Zenza all qualify now');
  assert.equal(res.total, 5, 'group-mode total counts restaurant groups');
  assert.equal(res.results.length, 0, 'no leftover individual results — every one of the 36 dishes lives inside a group');
  const byRestaurant = Object.fromEntries(res.restaurantGroups.map((g) => [g.restaurantName, g.menus.map((m) => [m.mealType, m.count])]));
  assert.deepEqual(byRestaurant['Makanan'], [['afhaal', 4]], 'BE-71: the startvulling card of Makanan (22)');
  // BE-71 ronde 4: the startvulling card of Restaurant Zenza (17) now carries
  // its real sections (R9), so 19 dishes match "kip" instead of the 21 under
  // the old slogan section.
  assert.deepEqual(byRestaurant['Restaurant Zenza'], [['menukaart', 19]]);
  assert.deepEqual(byRestaurant['Brasserie Bardot'], [['lunch', 2], ['diner', 1], ['specialiteiten', 1]]);
  assert.deepEqual(byRestaurant['Restaurant Zuyd'], [['lunch', 1], ['diner', 1]]);
  assert.deepEqual(byRestaurant['T-Huis'], [['lunch', 3], ['diner', 2]]);
  assert.equal(res.lowCoverage, undefined, 'lowCoverage must not appear — the underlying, ungrouped dish count (36) is not zero');
});

test('BE-16: q=friet — two restaurant groups; T-Huis keeps its two subgroups', () => {
  const res = searchDishes({ q: 'friet', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 2);
  const [group] = res.restaurantGroups.filter((g) => g.restaurantId === '23');
  assert.equal(group.restaurantId, '23');
  assert.equal(group.restaurantName, 'T-Huis');
  assert.deepEqual(group.menus.map((m) => [m.mealType, m.count]), [['diner', 8], ['lunch', 4]], 'subgroups ordered by descending match count, diner (8) before lunch (4)');
  // BE-71: the live card of Restaurant Chocolat (5) is a second group.
  assert.deepEqual(
    res.restaurantGroups.filter((g) => g.restaurantId === '5').map((g) => [g.restaurantName, g.menus.map((m) => [m.mealType, m.count])]),
    [['Restaurant Chocolat', [['lunch', 2]]]],
  );
  assert.equal(res.results.length, 0, 'no leftover individual results');
});

test('BE-16: q=brood — five restaurant groups (not one), no leftover individual results, sum equals the ungrouped total exactly', () => {
  const res = searchDishes({ q: 'brood', group: 'restaurant' });
  assert.equal(res.restaurantGroups.length, 5, 'every restaurant with a match is now its own group: Brasserie Bardot, Restaurant Zenza, Restaurant Zuyd, T-Huis, Restaurant Wolfslaar');
  assert.equal(res.results.length, 0, 'no leftover individual results — every dish lives inside a group');
  const byRestaurant = Object.fromEntries(res.restaurantGroups.map((g) => [g.restaurantName, g.menus.map((m) => [m.mealType, m.count])]));
  assert.deepEqual(byRestaurant['T-Huis'], [['diner', 7], ['lunch', 5], ['borrel', 1]], 'exact, complete per-menu totals (diner=7, lunch=5) — a client-side pass over one dish-level page alone would undercount these');
  assert.deepEqual(byRestaurant['Brasserie Bardot'], [['diner', 3], ['lunch', 3]]);
  // BE-71 ronde 3: the startvulling card of Restaurant Zenza (17) prints four broodjes.
  assert.deepEqual(byRestaurant['Restaurant Zenza'], [['menukaart', 4]]);
  assert.deepEqual(byRestaurant['Restaurant Zuyd'], [['lunch', 3], ['diner', 1]]);
  assert.deepEqual(byRestaurant['Restaurant Wolfslaar'], [['diner', 1]]);
  const sum = res.restaurantGroups.reduce((s, g) => s + g.menus.reduce((s2, m) => s2 + m.count, 0), 0);
  assert.equal(sum, 28, '6 (Bardot) + 4 (Zenza) + 4 (Zuyd) + 13 (T-Huis) + 1 (Wolfslaar) = 28, matching the ungrouped total exactly — no dish counted twice or dropped');
});

test('BE-15: the ungrouped q=brood response still exhibits the real pagination boundary this ticket\'s architecture is designed around', () => {
  // Proof that aggregation must happen over the full set, not one page:
  // page 1 alone would undercount 23-lunch/23-diner.
  const page1 = searchDishes({ q: 'brood', cursor: 0, limit: 20 });
  const page2 = searchDishes({ q: 'brood', cursor: 20, limit: 20 });
  assert.equal(page1.total, 28);
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
  // q=brood now produces 5 real restaurant groups — enough to prove
  // restaurant-level pagination across three pages of real, multi-group data
  // (BE-15 could only prove this against one real group).
  const page1 = searchDishes({ q: 'brood', group: 'restaurant', limit: 2 });
  const page2 = searchDishes({ q: 'brood', group: 'restaurant', limit: 2, cursor: page1.nextCursor });
  const page3 = searchDishes({ q: 'brood', group: 'restaurant', limit: 2, cursor: page2.nextCursor });
  assert.equal(page1.restaurantGroups.length, 2);
  assert.equal(page1.total, 5);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.restaurantGroups.length, 2);
  assert.equal(page2.hasMore, true);
  assert.equal(page3.restaurantGroups.length, 1);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.nextCursor, null);
  const allNames = [...page1.restaurantGroups, ...page2.restaurantGroups, ...page3.restaurantGroups].map((g) => g.restaurantName);
  assert.deepEqual(allNames, ['Brasserie Bardot', 'Restaurant Zenza', 'Restaurant Zuyd', 'T-Huis', 'Restaurant Wolfslaar'], 'restaurant groups are ordered by relevance (first-appearance in the ranked candidates), never alphabetical, and no group spans two pages');
  // T-Huis's own three menus (including the thin, 1-match borrel menu)
  // stay together, un-split, on page 2.
  assert.equal(page2.restaurantGroups[1].menus.length, 3);
});

test('BE-16: no duplication or loss — every restaurant group appears exactly once across all pages, and no dish is ever left over', () => {
  const res = searchDishes({ q: 'brood', group: 'restaurant', limit: 50 });
  const restaurantIds = res.restaurantGroups.map((g) => g.restaurantId);
  assert.equal(new Set(restaurantIds).size, restaurantIds.length, 'no restaurant appears in more than one group');
  assert.equal(res.results.length, 0, 'no dish is ever left as an individual, non-grouped result');
});

test('BE-16: menu subgroups carry public example dish objects (dishId/name/category/weakMatch plus BE-28\'s own price fields), sufficient to build an exact BE-12 link, in the same relevance order and capped at 3 the ungrouped path already returns', () => {
  const ungrouped = searchDishes({ q: 'friet' });
  const grouped = searchDishes({ q: 'friet', group: 'restaurant' });
  const dinerDishes = ungrouped.results.filter((d) => d.mealType === 'diner');
  const group = grouped.restaurantGroups[0];
  const dinerMenu = group.menus.find((m) => m.mealType === 'diner');
  assert.equal(dinerMenu.examples.length, 3, 'capped at the example limit even though 8 dishes match');
  assert.deepEqual(
    dinerMenu.examples,
    dinerDishes.slice(0, 3).map((d) => ({
      dishId: d.dishId,
      name: d.name,
      category: d.category,
      weakMatch: false,
      // BE-28 (#65) — the shown example's own real price, so the public
      // result card can show it on the right. Same public fields as the
      // ungrouped response; still no internal field.
      priceDisplay: d.priceDisplay,
      priceOnRequest: d.priceOnRequest,
      priceIsFrom: d.priceIsFrom,
    })),
    'the first three examples must be the same three dishes, with the same dishId/name/category BE-12 needs and the same real price BE-28 shows, in the same relevance order the ungrouped path already returns; none of these visibly-named "friet" matches is a weak match'
  );
  assert.equal(dinerMenu.menuLink, '/menu/23-diner');
  for (const example of dinerMenu.examples) {
    const allowedKeys = ['dishId', 'name', 'category', 'weakMatch', 'priceDisplay', 'priceOnRequest', 'priceIsFrom'];
    assert.deepEqual(Object.keys(example).sort(), allowedKeys.sort(), 'examples must never leak internal/extra dish fields beyond the public id/name/category/weakMatch/price fields');
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

// BE-55 stap B, deel 5 (#135) — het filter en het label "Vandaag".
// Echte data: q=brood levert vier restaurantgroepen. Het aanbod komt — net als
// in de zoekroute — als map binnen; deze laag kent zelf geen databank.

const AANBOD_VOORBEELD = [{ soort: 'daghap', naam: 'Pompoensoep met brood' }];

function groepIds(res) {
  return res.restaurantGroups.map((g) => g.restaurantId);
}

test('BE-55: het filter Vandaag sluit gerechten en groepen zonder aanbod uit', () => {
  const zonderFilter = searchDishes({ q: 'brood', group: 'restaurant' });
  assert.ok(groepIds(zonderFilter).length > 3, 'baseline: q=brood moet meerdere restaurants geven');

  const doel = groepIds(zonderFilter)[0];
  const metFilter = searchDishes({
    q: 'brood',
    group: 'restaurant',
    vandaag: true,
    aanbod: { [doel]: AANBOD_VOORBEELD },
  });

  assert.deepEqual(groepIds(metFilter), [doel], 'alleen het restaurant met aanbod blijft over');
  assert.equal(metFilter.total, 1);
  const ongegroepeerd = searchDishes({ q: 'brood', vandaag: true, aanbod: { [doel]: AANBOD_VOORBEELD } });
  assert.ok(ongegroepeerd.results.length > 0);
  assert.ok(ongegroepeerd.results.every((dish) => dish.restaurantId === doel), 'ook losse gerechten zonder aanbod vallen af');
  assert.equal(searchDishes({ q: 'brood', vandaag: true }).total, 0, 'zonder opgehaald aanbod is er geen treffer');
});

test('BE-55: de volgorde is identiek met en zonder daghap', () => {
  const zonderAanbod = searchDishes({ q: 'brood', group: 'restaurant' });
  const eersteTwee = groepIds(zonderAanbod).slice(0, 2);
  const aanbod = { [eersteTwee[1]]: AANBOD_VOORBEELD, [eersteTwee[0]]: AANBOD_VOORBEELD };
  // Zonder filter: het aanbod voegt alleen een label toe, geen andere volgorde.
  const metAanbod = searchDishes({ q: 'brood', group: 'restaurant', aanbod });
  assert.deepEqual(groepIds(metAanbod), groepIds(zonderAanbod));
  assert.deepEqual(
    metAanbod.restaurantGroups.map((g) => g.menus.map((m) => m.examples.map((e) => e.dishId))),
    zonderAanbod.restaurantGroups.map((g) => g.menus.map((m) => m.examples.map((e) => e.dishId))),
    'ook de menu-subgroepen en hun voorbeelden houden hun volgorde',
  );
  // Met filter: precies dezelfde volgorde, alleen zonder de restaurants zonder aanbod.
  const gefilterd = searchDishes({ q: 'brood', group: 'restaurant', vandaag: true, aanbod });
  assert.deepEqual(groepIds(gefilterd), groepIds(zonderAanbod).filter((id) => aanbod[id]));
  const losZonderAanbod = searchDishes({ q: 'brood' }).results.map((d) => d.dishId);
  const losMetAanbod = searchDishes({ q: 'brood', aanbod }).results.map((d) => d.dishId);
  assert.deepEqual(losMetAanbod, losZonderAanbod, 'de losse gerechten houden hun volgorde');
});

test('BE-55: het label Vandaag staat alleen bij een restaurant met aanbod', () => {
  const zonderAanbod = searchDishes({ q: 'brood', group: 'restaurant' });
  const doel = groepIds(zonderAanbod)[0];
  const metAanbod = searchDishes({ q: 'brood', group: 'restaurant', aanbod: { [doel]: AANBOD_VOORBEELD } });
  for (const groep of metAanbod.restaurantGroups) {
    if (groep.restaurantId === doel) {
      assert.deepEqual(groep.vandaag, { soort: 'daghap', naam: 'Pompoensoep met brood' });
    } else {
      assert.equal(groep.vandaag, undefined, 'geen aanbod betekent geen label');
    }
  }
  const leegAanbod = searchDishes({ q: 'brood', group: 'restaurant', aanbod: { [doel]: [] } });
  assert.ok(leegAanbod.restaurantGroups.every((groep) => groep.vandaag === undefined), 'een lege lijst is geen treffer');
});


// BE-60 (#150) — een goedgekeurde houderwijziging in de zoekresultaten: de
// nieuwe prijs, het label "Tijdelijk niet beschikbaar", het prijsfilter dat met
// de nieuwe prijs rekent, en een volgorde die identiek blijft. Alles tegen de
// echte data, zoals de rest van dit bestand: 23-lunch-0-10 is "Steak à la
// T-Huis" (€ 23,75) en 23-lunch-0-0 is "Middle Eastern Pancakes" (€ 14,75).
const STEAK = '23-lunch-0-10';
const PANCAKES = '23-lunch-0-0';

function prijsWijziging(prijsCent, { menuId = '23-lunch', categorieIndex = 0, gerechtIndex = 10 } = {}) {
  return { menuId, categorieIndex, gerechtIndex, soort: 'prijs', prijsCent };
}

function labelWijziging({ menuId = '23-lunch', categorieIndex = 0, gerechtIndex = 10 } = {}) {
  return { menuId, categorieIndex, gerechtIndex, soort: 'beschikbaarheid', tijdelijkNietBeschikbaar: true };
}

test('BE-60: een goedgekeurde prijswijziging staat als nieuwe prijs in de zoekresultaten', () => {
  const zonder = searchDishes({ q: 'pancetta' });
  const met = searchDishes({ q: 'pancetta', overlay: { '23': [prijsWijziging(1850)] } });
  const voor = zonder.results.find((d) => d.dishId === STEAK);
  const na = met.results.find((d) => d.dishId === STEAK);
  assert.equal(voor.priceDisplay, '€23,75', 'de statische prijs is de basis');
  assert.equal(na.priceDisplay, '€18,50', 'de nieuwe prijs staat in het resultaat');
  assert.equal(na.priceValue, 18.5);
  assert.equal(na.priceOnRequest, false);
  assert.deepEqual(Object.keys(na).sort(), Object.keys(voor).sort(), 'geen enkel ander veld verandert');
  assert.equal(met.total, zonder.total, 'het aantal treffers blijft gelijk');
});

test('BE-60: het prijsfilter "Tot € x" rekent met de nieuwe prijs', () => {
  // Zonder overlay valt de steak (€ 23,75) buiten "tot € 20".
  const zonder = searchDishes({ q: 'pancetta', maxPrice: 20 });
  assert.ok(!zonder.results.some((d) => d.dishId === STEAK), 'zonder overlay: te duur');

  // Een goedgekeurde prijs van € 18,50 brengt hem binnen het filter.
  const goedkoper = searchDishes({ q: 'pancetta', maxPrice: 20, overlay: { '23': [prijsWijziging(1850)] } });
  const steak = goedkoper.results.find((d) => d.dishId === STEAK);
  assert.ok(steak, 'met de nieuwe prijs valt het gerecht binnen "tot € 20"');
  assert.equal(steak.priceDisplay, '€18,50');

  // Andersom: de pancakes (€ 14,75) vallen door een duurdere nieuwe prijs af.
  const pancakes = { menuId: '23-lunch', categorieIndex: 0, gerechtIndex: 0 };
  const voor = searchDishes({ q: 'pancakes', maxPrice: 20 }).results.some((d) => d.dishId === PANCAKES);
  assert.ok(voor, 'zonder overlay: binnen het filter');
  const duurder = searchDishes({ q: 'pancakes', maxPrice: 20, overlay: { '23': [prijsWijziging(2500, pancakes)] } });
  assert.ok(!duurder.results.some((d) => d.dishId === PANCAKES), 'met de nieuwe prijs: te duur');
});

test('BE-60: een gerecht tijdelijk niet beschikbaar blijft staan met het label', () => {
  const zonder = searchDishes({ q: 'pancetta' });
  const met = searchDishes({ q: 'pancetta', overlay: { '23': [labelWijziging()] } });
  const na = met.results.find((d) => d.dishId === STEAK);
  assert.ok(na, 'het gerecht blijft in de resultaten staan');
  assert.equal(na.tijdelijkNietBeschikbaar, true, 'met het label van de menukaart');
  assert.equal(na.priceDisplay, '€23,75', 'de prijs blijft staan');
  assert.equal(met.total, zonder.total, 'niets wordt verborgen');
  assert.deepEqual(
    met.results.map((d) => d.dishId),
    zonder.results.map((d) => d.dishId),
    'de volgorde verandert niet',
  );
});

test('BE-60: de volgorde is identiek met en zonder overlay', () => {
  const zonder = searchDishes({ q: 'soep', group: 'restaurant' });
  const met = searchDishes({
    q: 'soep',
    group: 'restaurant',
    overlay: { '23': [prijsWijziging(1850), labelWijziging()] },
  });
  assert.deepEqual(
    met.restaurantGroups.map((groep) => groep.restaurantId),
    zonder.restaurantGroups.map((groep) => groep.restaurantId),
    'dezelfde restaurants in dezelfde volgorde',
  );
  assert.deepEqual(
    met.restaurantGroups.map((groep) => groep.menus.map((menu) => `${menu.mealType}:${menu.count}`)),
    zonder.restaurantGroups.map((groep) => groep.menus.map((menu) => `${menu.mealType}:${menu.count}`)),
    'dezelfde menu\'s met dezelfde aantallen',
  );
});

test('BE-60: zonder overlay verandert er niets (geen label, dezelfde prijs)', () => {
  const zonder = searchDishes({ q: 'pancetta' });
  for (const dish of zonder.results) {
    assert.equal(Object.hasOwn(dish, 'tijdelijkNietBeschikbaar'), false, 'geen label zonder wijziging');
  }
  const steak = zonder.results.find((d) => d.dishId === STEAK);
  assert.equal(steak.priceDisplay, '€23,75');
});

test('BE-60: het label staat ook op de voorbeeldgerechten van een restaurantgroep', () => {
  const met = searchDishes({ q: 'pancetta', group: 'restaurant', overlay: { '23': [labelWijziging()] } });
  const voorbeelden = met.restaurantGroups.flatMap((groep) => groep.menus.flatMap((menu) => menu.examples));
  const steak = voorbeelden.find((voorbeeld) => voorbeeld.dishId === STEAK);
  assert.ok(steak, 'het voorbeeld staat in de groep');
  assert.equal(steak.tijdelijkNietBeschikbaar, true);
  const zonder = searchDishes({ q: 'pancetta', group: 'restaurant' });
  const eerder = zonder.restaurantGroups
    .flatMap((groep) => groep.menus.flatMap((menu) => menu.examples))
    .find((voorbeeld) => voorbeeld.dishId === STEAK);
  assert.equal(Object.hasOwn(eerder, 'tijdelijkNietBeschikbaar'), false);
});


// BE-67, uitkomst 5 � zoeken op de naam van een gang van een dagmenu.
test("BE-67: een zoekopdracht op een gangnaam vindt het restaurant met dat dagmenu", () => {
  // q=brood geeft vier restaurants; alleen het eerste heeft een dagmenu met een
  // gang die "pompoensoep" heet. Zonder die gangnaam is er geen treffer.
  const zonderFilter = searchDishes({ q: "brood", group: "restaurant" });
  const doel = groepIds(zonderFilter)[0];
  const dagmenu = [{
    soort: "dagmenu",
    naam: "Herfstmenu",
    gangen: ["Pompoensoep met brood", "Hertenstoof", "Kastanjetaart"],
  }];

  const metGang = searchDishes({
    q: "pompoensoep",
    group: "restaurant",
    vandaag: true,
    aanbod: { [doel]: dagmenu },
  });
  assert.deepEqual(groepIds(metGang), [doel], "de gangnaam is een treffer voor dit restaurant");

  const zonderGang = searchDishes({
    q: "pompoensoep",
    vandaag: true,
    aanbod: { [doel]: [{ soort: "daghap", naam: "Herfstmenu" }] },
  });
  assert.equal(zonderGang.total, 0, "zonder de gangnaam is er geen treffer");
});
