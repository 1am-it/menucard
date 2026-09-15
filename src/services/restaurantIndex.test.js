'use strict';

// BE-11 Fase 1 — regression tests for the restaurant-level browse index.
// Written against the real, unmodified project data (data/restaurants
// .json), per this project's own "read the real thing, no mocks" testing
// convention — same pattern as src/services/dishSearch.test.js.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { searchRestaurants, isValidAddress, hasUniqueRestaurantNameMatch } = require('./restaurantIndex');

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

// ─── BE-11 Fase 2: hasUniqueRestaurantNameMatch() / uniqueNameMatch ────────
// Group-ordering signal for /search's "Restaurants gevonden" vs "Gerechten
// gevonden" precedence. Verified against the real, unmodified 25-restaurant
// dataset — no mocks, same convention as every other test in this file.

test('unique single-token name match: "Bardot" matches exactly one restaurant name (Brasserie Bardot)', () => {
  assert.equal(hasUniqueRestaurantNameMatch('Bardot'), true);
  const res = searchRestaurants({ q: 'Bardot' });
  assert.equal(res.uniqueNameMatch, true, 'the same signal must be exposed on the searchRestaurants() response');
});

test('unique multi-token name match: the full name "Brasserie Bardot" also matches uniquely', () => {
  assert.equal(hasUniqueRestaurantNameMatch('Brasserie Bardot'), true);
});

test('hyphen/space equivalence: "T-Huis", "T Huis", and "Huis" all tokenize identically and match uniquely', () => {
  assert.equal(hasUniqueRestaurantNameMatch('T-Huis'), true);
  assert.equal(hasUniqueRestaurantNameMatch('T Huis'), true);
  assert.equal(hasUniqueRestaurantNameMatch('Huis'), true);
});

test('short-token floor: a 3-character token ("Bar") is never treated as matching "Barrels" as a substring', () => {
  // "Beers & Barrels" tokenizes to ["beers", "barrels"] — "bar" is a
  // substring of "barrels" but never a whole token of it, so this must
  // not match, even though "bar" itself clears the 3-character floor.
  assert.equal(hasUniqueRestaurantNameMatch('Bar'), false);
});

test('article/short-word floor: "De" tokenizes to zero remaining tokens and never matches, even though "de" is a real whole token in two restaurant names', () => {
  // "Salon de Provence" and "De Beyerd" both contain "de" as a genuine,
  // full token — proof this isn't filtered by coincidence of substring
  // matching, but by the deliberate <3-character floor.
  assert.equal(hasUniqueRestaurantNameMatch('De'), false);
});

test('non-unique name match: "Restaurant" matches many restaurant names and must not fire the precedence rule', () => {
  assert.equal(hasUniqueRestaurantNameMatch('Restaurant'), false);
  const res = searchRestaurants({ q: 'Restaurant' });
  assert.equal(res.uniqueNameMatch, false);
  assert.ok(res.total > 1, 'sanity check: this query must still match more than one restaurant via the ordinary tier ranking');
});

test('a buurt match, however exact, never sets uniqueNameMatch — only a name-token match does', () => {
  // "Binnenstad" matches 16 restaurants by buurt (tier 2) but is not a
  // token of any restaurant's own name.
  assert.equal(hasUniqueRestaurantNameMatch('Binnenstad'), false);
  const res = searchRestaurants({ q: 'Binnenstad', limit: 50 });
  assert.equal(res.total, 16);
  assert.equal(res.uniqueNameMatch, false);
});

test('a real address match never sets uniqueNameMatch either', () => {
  // "Wolfslaardreef" (restaurant 1's real street) is not a token of any
  // restaurant's own name, only of its address (tier 3) — the rule must
  // stay false here.
  const res = searchRestaurants({ q: 'Wolfslaardreef' });
  assert.equal(res.total, 1);
  assert.equal(res.uniqueNameMatch, false);
});

test('no query means no name match: uniqueNameMatch is false on a plain browse', () => {
  const res = searchRestaurants({});
  assert.equal(res.uniqueNameMatch, false);
});

test('a query matching zero restaurants by name never fires the rule', () => {
  assert.equal(hasUniqueRestaurantNameMatch('zzzznomatch'), false);
});

test('a menu-less restaurant is still reachable via a unique name match (Restaurant Blossem, id 2, has zero menu data)', () => {
  assert.equal(hasUniqueRestaurantNameMatch('Blossem'), true);
  const res = searchRestaurants({ q: 'Blossem' });
  assert.equal(res.total, 1);
  assert.equal(res.results[0].hasMenu, false);
  assert.equal(res.uniqueNameMatch, true);
});

// ─── Regression fix: a unique token-name match must also be a real result ──
// A pre-commit review found that uniqueNameMatch could report true while
// searchRestaurants()'s own results/total for that exact same call were
// empty, because getMatchTier() (tier 0/1, substring-based) does not
// recognize the same separator equivalence (space/hyphen/"&") that
// findRestaurantsByNameToken() uses — e.g. "t-huis".includes("t huis") is
// false. The fix injects a unique token-name match into the candidate set
// (at tier 1) when getMatchTier() didn't already find it, so uniqueNameMatch:
// true now always means that restaurant is actually present in `results`.

test('"T Huis" (space instead of hyphen) actually finds "T-Huis" as a real, visible result', () => {
  const res = searchRestaurants({ q: 'T Huis' });
  assert.equal(res.total, 1, 'the space variant must return the same result as the stored hyphenated name');
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].name, 'T-Huis');
  assert.equal(res.uniqueNameMatch, true);
});

test('"Beers Barrels" (no "&") actually finds "Beers & Barrels" as a real, visible result', () => {
  const res = searchRestaurants({ q: 'Beers Barrels' });
  assert.equal(res.total, 1);
  assert.equal(res.results[0].name, 'Beers & Barrels');
  assert.equal(res.uniqueNameMatch, true);
});

test('double spaces in an otherwise valid restaurant-name query still return a real result ("Con  Fuego" finds "Con Fuego")', () => {
  const res = searchRestaurants({ q: 'Con  Fuego' });
  assert.equal(res.total, 1);
  assert.equal(res.results[0].name, 'Con Fuego');
  assert.equal(res.uniqueNameMatch, true);
});

test('invariant: uniqueNameMatch: true always implies at least one actual result, across every query tried', () => {
  const queries = [
    'Bardot', 'Brasserie Bardot', 'T-Huis', 'T Huis', 'Huis',
    'Beers Barrels', 'Beers & Barrels', 'Con  Fuego', 'Con Fuego',
    'Blossem', 'de Beyerd', 'Bar', 'De', 'Restaurant', 'Binnenstad',
    'Wolfslaardreef', 'zzzznomatch', 'a',
  ];
  for (const q of queries) {
    const res = searchRestaurants({ q });
    if (res.uniqueNameMatch) {
      assert.ok(res.total > 0, `uniqueNameMatch was true for ${JSON.stringify(q)} but total was 0`);
      assert.ok(res.results.length > 0, `uniqueNameMatch was true for ${JSON.stringify(q)} but results was empty`);
    }
  }
});

test('"Bar" and "De" still never trigger an unwarranted unique-name priority, and their existing substring results are unaffected by the injection fix', () => {
  const bar = searchRestaurants({ q: 'Bar' });
  assert.equal(bar.uniqueNameMatch, false);
  assert.ok(bar.total >= 1, 'existing substring matches (e.g. "Beers & Barrels" containing "bar") must still work');

  const de = searchRestaurants({ q: 'De' });
  assert.equal(de.uniqueNameMatch, false);
  assert.ok(de.total >= 1, 'existing substring/buurt/address matches for "De" must still work');
});

test('existing buurt, address, and substring results are unchanged by the token-injection fix', () => {
  const binnenstad = searchRestaurants({ q: 'Binnenstad', limit: 50 });
  assert.equal(binnenstad.total, 16);
  assert.equal(binnenstad.uniqueNameMatch, false);

  const wolfslaardreef = searchRestaurants({ q: 'Wolfslaardreef' });
  assert.equal(wolfslaardreef.total, 1);
  assert.equal(wolfslaardreef.results[0].name, 'Restaurant Wolfslaar');
  assert.equal(wolfslaardreef.uniqueNameMatch, false);

  const bardot = searchRestaurants({ q: 'Bardot' });
  assert.equal(bardot.total, 1);
  assert.equal(bardot.results[0].name, 'Brasserie Bardot');
  assert.equal(bardot.uniqueNameMatch, true);

  const restaurant = searchRestaurants({ q: 'Restaurant' });
  assert.equal(restaurant.total, 8, 'non-unique substring name match count must be unaffected by the injection fix');
  assert.equal(restaurant.uniqueNameMatch, false);
});

test('a unique token match injected into candidates never outranks an existing exact (tier 0) or substring (tier 1) match', () => {
  // "Bardot" already matches "Brasserie Bardot" via substring tier 1
  // (getMatchTier) AND via the token rule uniquely — the injection must
  // not duplicate it or change its tier/position.
  const res = searchRestaurants({ q: 'Bardot' });
  assert.equal(res.results.length, 1, 'no duplicate entry from the injection when a substring match already exists');
});
