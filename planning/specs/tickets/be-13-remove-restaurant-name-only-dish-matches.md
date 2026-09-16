# BE-13 — Remove Restaurant-Name-Only Dish Matches from Search

## Status

Proposed; **implemented and locally verified in commit
`a93778aef74f6a3f07a5d11bdefd7e3b5e152ab7` (2026-09-16); deployment and
live verification are pending.** Tier 4 has been removed from
`src/services/dishSearch.js`'s `getMatchTier()`; `docs/api/dish-search-
ranking.md` documents the removal; targeted tests, the full project test
suite, and `npm run build` all pass locally. Behavior has been verified
against a local production server only (390px/1280px, both themes) — not
against any live/deployed environment, regardless of the commit's current
push status. The actual implementation scope grew by two files beyond
what was originally planned below, for a reason the ticket itself already
anticipated — see "Planned implementation scope" and "Risks" for the
full, dated account.

## Depends on

`docs/api/dish-search-ranking.md`/`src/services/dishSearch.js` (BE-02a/
02c) — this ticket amends exactly one row of that already-shipped,
documented ranking contract (`getMatchTier()`'s tier 4); every other tier
(0-3) and every other part of `searchDishes()` is unaffected and stays
exactly as BE-02a/02c left it.

`src/services/restaurantIndex.js` (BE-11 Fase 1) — referenced only as the
existing, already-independent restaurant-level search layer that already
handles restaurant-name matching on its own (`getMatchTier()`'s tiers 0/1,
`hasUniqueRestaurantNameMatch()`); this ticket does not add, remove, or
change any coupling between `dishSearch.js` and `restaurantIndex.js` —
the two remain exactly as decoupled as `restaurantIndex.js`'s own header
comment already mandates ("this module does NOT import anything from
dishSearch.js... requiring that module would... defeat the... guarantee").

`BE-11` (`planning/specs/tickets/be-11-public-menu-discovery-intent-aware-results.md`)
— referenced only because `/search`'s existing Fase 2 empty-state logic
(`app/search/page.js`, the "Geen gerechten gevonden voor '{q}' — wel N
restaurant(en) gevonden..." / "Geen gerechten gevonden voor '{q}'."
branches) already anticipates exactly the state this ticket will cause to
occur far more often. No change to that logic, or to any other BE-11
navigation/grouping decision, is proposed here — not reopened.

`BE-12` (`planning/specs/tickets/be-12-dish-result-deep-link-scroll-highlight.md`)
— unaffected: it operates per rendered dish result (via `dishId`/`name`/
`category`) regardless of which tier produced that result, and never
relied on tier 4.

## Problem

`src/services/dishSearch.js`'s `getMatchTier()` (BE-02c, documented in
`docs/api/dish-search-ranking.md`) assigns tier 4 to a dish whenever its
**restaurant's name** contains the query — with no requirement that the
dish's own name, description, supplement note, wine-pairing suggestion,
or tags match anything. `searchDishes()` never excludes tier 4; every
dish at a name-matching restaurant is returned as a "gerecht gevonden".

**Verified directly against real data (`data/menus.json`,
`data/restaurants.json`), not assumed:** for the query `"Bardot"` against
restaurant `6` ("Brasserie Bardot", 4 menus: lunch/diner/borrel/
specialiteiten, 111 dishes total), the tier breakdown is exactly:

| Tier | Count |
|------|-------|
| 0 (exact name) | 0 |
| 1 (name contains query) | 0 |
| 2 (description/supplement/wine contains query) | 1 |
| 3 (tag contains query) | 0 |
| 4 (restaurant name only) | 110 |

The one tier-2 match is a real, visible content match: "Café Spécial",
description "French, Italian, Spanish of Bardot" — genuinely worth
showing. The other 110 are the restaurant's entire remaining menu,
returned only because "Bardot" happens to be part of the restaurant's own
name. `/search?q=Bardot` therefore shows "Gerechten gevonden (111 voor
"Bardot")" — effectively a full, unfiltered menu dump under a heading
that implies 111 relevant dish matches, alongside the one restaurant card
that already, correctly, offers a single "Bekijk 4 menukaarten →" action
to see the same restaurant's full menu.

No existing test in `src/services/dishSearch.test.js` queries by a
restaurant name or asserts tier-4 behavior (verified by inspection) — the
110-dish dump is unexercised by the current test suite, not a
deliberately tested feature.

## Decision

Remove tier 4 (restaurant-name-only match) **entirely and
unconditionally** from dish search results. A dish that matches no
field of its own (name, description, supplement note, wine-pairing
suggestion, tag) is never returned by `searchDishes()`, regardless of
whether its restaurant's name contains the query, and regardless of
whether that restaurant name is unique, common, or short. Restaurant-name
search stays exactly where it already, independently lives:
`src/services/restaurantIndex.js`'s own `searchRestaurants()` /
`getMatchTier()` / `hasUniqueRestaurantNameMatch()`, entirely unchanged.

## Preserved (must not change)

- Every real dish-content match — name (tiers 0/1), description/
  supplement/wine (tier 2), tag (tier 3) — is returned exactly as today,
  for every query. A dish is never excluded merely because it *also*
  happens to belong to a name-matching restaurant: the existing
  tier-computation order (name → description/supplement/wine → tag →
  restaurant name, first match wins) already guarantees this — a dish
  with any real content match never reaches the tier-4 check at all.
- `/search?q=Bardot` continues to show the restaurant card (via
  `restaurantIndex.js`'s own, unchanged matching) and, additionally, only
  whatever real content matches exist for that query (today: exactly the
  one "Café Spécial" match).
- `/search?q=friet` (and every other pure dish/ingredient query) is
  functionally and behaviorally unchanged — it never reaches tier 4
  today, since a real dish/ingredient term matches on name/description/
  tag first.
- The public response shape (`PUBLIC_DISH_FIELDS`/`toPublicDishShape()`
  in `dishSearch.js`) does not change — no field is added, removed, or
  newly exposed. No internal-only field (`_restaurant`, `_sup`, `_wine`)
  becomes public.
- `/api/search`'s request/response contract, every route, `PrimaryNav`,
  and the light `RestaurantBrowseCard` (its single primary action
  included) are all unchanged.
- No client-side hiding, capping, or grouping of already-fetched
  irrelevant dishes — the exclusion happens inside `searchDishes()`'s own
  tier computation, so an irrelevant dish is never fetched by the client
  in the first place, not merely hidden after the fact.

## Non-goals (explicitly out of scope)

- **Mixed, tokenized, cross-field queries (e.g. `"Bardot friet"`) are
  explicitly out of scope for this ticket.** Verified directly: today,
  `searchDishes({q: 'Bardot friet'})` and `searchRestaurants({q: 'Bardot
  friet'})` both already return `total: 0` — neither layer tokenizes a
  multi-word query or matches different words against different fields;
  each treats the whole query string as one literal substring against one
  field at a time. This ticket's tier-4 removal does not change that
  behavior in any way — `"Bardot friet"` still returns `total: 0` after
  this ticket ships, exactly as before. Solving it requires a genuinely
  new capability (splitting a query into tokens and matching a
  restaurant-identifying token against `restaurantIndex.js`-style name
  matching while matching the remaining token(s) against dish content,
  scoped to that restaurant) that does not exist in any form today. **No
  temporary workaround, heuristic, or partial tokenization is introduced
  here to approximate this** — the honest, unchanged "0 resultaten" state
  is preferred over an approximate or partially-correct mixed-query
  behavior shipped ahead of a real design for it. This capability is
  named as a distinct, later, separately-scoped ticket (not created by
  this planning ticket) once BE-13 has shipped and is verified.
- No change to `docs/api/restaurant-summary-shape.md`, `restaurantIndex.js`,
  `/api/restaurants`, or any restaurant-level filter/ranking.
- No change to `/search`'s UI, copy, empty-state branches, group-ordering
  logic, or `RestaurantBrowseCard` — the existing BE-11 Fase 2 empty-state
  copy already handles the resulting states correctly (see "Depends on"
  above); a UI change is only in scope if a concrete test demonstrates the
  existing copy/logic is actually insufficient once tier 4 is removed.
- No new query parameter, no new public response field, no cuisine/
  category-based matching (`dish-search-ranking.md`'s own "What ranking
  deliberately ignores" already excludes `category` as a searched field —
  unchanged by this ticket), no location/distance matching (`distanceMeters`
  stays permanently `null`, unrelated to this ticket).
- No debounce/automatic-search change on `/search` — a separate, already
  closed advisory topic.

## Planned implementation scope (smallest safe set)

Confined to exactly:
- `src/services/dishSearch.js` — remove the single tier-4 line
  (`if (dish.restaurantName.toLowerCase().includes(needle)) return 4`)
  from `getMatchTier()`; the function's final `return null` becomes the
  fallthrough for "no field matched at all, including restaurant name."
- `src/services/dishSearch.test.js` — add tests proving the new behavior
  against the real, verified `Bardot`/restaurant-6 fixture (see
  "Acceptance criteria"); no existing test in this file requires
  modification (verified: none currently queries by a restaurant name or
  depends on tier-4 behavior).
- `docs/api/dish-search-ranking.md` — remove the tier-4 row from the tier
  table and record the change with its date and reason, per this
  project's own documentation-correction convention (e.g. `restaurant-
  summary-shape.md`'s dated "Consistency guarantee, corrected..." note).

Explicitly not touched: `src/services/restaurantIndex.js`,
`app/api/search/route.js`'s request/response wiring,
`src/components/RestaurantBrowseCard.js`, any route, any migration, any
mockup.

**Correction (2026-09-16, implementation): `app/search/page.js` and
`app/search/page.test.js` were touched after all, narrowly.** This was
not part of the original plan above, but the ticket's own "Risks" section
already named the reason in advance: removing tier 4 makes
`app/search/page.js`'s existing `isWeakMatch()` hint ("· gevonden via
restaurantnaam") describe a cause that can no longer occur. A concrete
test, run during implementation, proved this: `q=Chablis` (an existing,
unmodified `dishSearch.test.js` fixture) matches six dishes only via
their internal `_wine` field, at a restaurant whose name never contains
"Chablis" — live-verified on a local production build to still render
"· gevonden via restaurantnaam" for all six, which is factually wrong
regardless of tier 4. Per this ticket's own condition for allowing a UI
change ("a UI change is only in scope if a concrete test demonstrates the
existing copy/logic is actually insufficient once tier 4 is removed" —
see the original "Non-goals" wording above), this qualified. The fix was
kept minimal: the visible hint text was replaced with neutral, honest
copy, `Gevonden in aanvullende menudetails`, and `isWeakMatch()`'s own
comment was corrected to no longer assume restaurant name or tier 4 as a
possible cause. Nothing about which dishes match, result order, counts,
filters, the public API shape, or `dishSearch.js`/`restaurantIndex.js`'s
decoupling changed as part of this — see commit
`a93778aef74f6a3f07a5d11bdefd7e3b5e152ab7` for the exact diff.

## Acceptance criteria

All items below are checked off as **verified locally** (targeted tests,
full test suite, `npm run build`, and a local production server) as of
commit `a93778aef74f6a3f07a5d11bdefd7e3b5e152ab7` — none of this has been
verified against a live or deployed environment. That remains true
regardless of the commit's push status; live verification is a separate,
later step this ticket does not claim has happened.

- [x] `searchDishes({ q: 'Bardot' })` returns `total: 1`, and that one
      result is "Café Spécial" — not 111, not 0.
- [x] `searchDishes({ q: 'friet' })`'s result count and contents are
      byte-for-byte unchanged from today (regression check against the
      pre-change behavior).
- [x] A dish with a real name, description, supplement, wine-pairing, or
      tag match is never excluded, for any query — verified against at
      least one fixture where a dish's own content match and its
      restaurant's name match would previously have coincided.
- [x] A dish whose *only* match reason is its restaurant's name never
      appears in `Gerechten gevonden` (i.e. is never part of
      `searchDishes()`'s `results`/`total`), for any query, unique or
      non-unique restaurant name alike.
- [x] `searchDishes({ q: 'Bardot friet' })` still returns `total: 0` after
      this change — explicitly confirmed as the expected, unchanged,
      out-of-scope state, not treated as a regression.
- [x] Every existing test in `src/services/dishSearch.test.js` passes
      unmodified; the full project test suite and `npm run build` are run
      and pass before this ticket is considered done.
- [x] `docs/api/dish-search-ranking.md`'s tier table contains no
      restaurant-name-only tier after implementation.
- [x] **Added during implementation:** the now-inaccurate "· gevonden via
      restaurantnaam" hint in `app/search/page.js` no longer appears
      anywhere; the replacement copy, "Gevonden in aanvullende
      menudetails", is factually correct for every remaining case that can
      trigger it (a tier-2 match via the non-public `_sup`/`_wine`
      fields only) and never implies restaurant name as a cause.

## Risks

- `app/search/page.js`'s existing `isWeakMatch()` client-side hint
  ("· gevonden via restaurantnaam") was written when tier 4 could still
  produce a dish with no visible name/description/tag match. After this
  ticket, that specific cause disappears, but the hint remains
  meaningful for the narrower remaining case of a tier-2 match via the
  non-public `_sup`/`_wine` fields (a dish whose only match is its
  internal supplement/wine text, invisible on the rendered card) — this
  ticket does not remove or rename that hint, since it is not dead code,
  only less frequently triggered. Confirming this empirically (finding a
  real sup/wine-only match fixture) is left to implementation-time
  verification, not decided here.
  **Resolved during implementation (2026-09-16):** exactly this case was
  found and confirmed on a local production build — `q=Chablis` still
  showed "· gevonden via restaurantnaam" on all six of its real, existing
  wine-field matches,
  none of which sit at a restaurant whose name contains "Chablis". The
  hint text itself was corrected (see "Planned implementation scope"'s
  correction note and the updated acceptance criteria above); the
  underlying mechanism (`isWeakMatch()`'s matching logic, which dishes
  trigger it) was not changed.
- This is a documented, deliberate behavior change to an already-shipped
  BE-02c ranking rule, not a bug fix to unreleased code — verified above
  to have zero existing test coverage depending on it, which lowers but
  does not eliminate the chance that some other, not-yet-found part of
  the app implicitly relies on a restaurant-name query returning that
  restaurant's full dish list.

## Suggested order

An independent, small follow-up to the closed `BE-02c` ranking contract
and to `BE-11`'s already-shipped `/search` experience — not blocked by,
and not blocking, any `PLATFORM-*`/`MARKET-*` work. Pickupable
immediately; does not depend on the future, separately-scoped mixed-query
(`"Bardot friet"`) ticket, and that future ticket should not start before
this one ships and is verified, since it would otherwise build on a tier
system this ticket is about to simplify.
