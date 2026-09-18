# BE-15 — Group Broad Dish Search Results by Restaurant and Menu

## Status

Proposed; not started. Documentation/planning only — no product code,
test, route, API, data, mockup, commit, push, deploy, database, account,
or storage change has been made for this ticket.

## Depends on

`docs/api/dish-search-ranking.md`/`docs/api/dish-result-shape.md`
(BE-02a/02c) — the existing, unmodified dish-level ranking and shape this
ticket proposes grouping for display, never replacing or re-ranking.
`src/services/dishSearch.js`'s existing `DEFAULT_LIMIT`(20)/`MAX_LIMIT`(50)
offset-cursor pagination and `getMatchTier()`/tie-break logic — reused,
unchanged, by the new aggregation function this ticket decides on (see
"Server-side aggregation — the decided architecture").
`planning/specs/tickets/be-12-dish-result-deep-link-scroll-highlight.md`
— the exact-dish deep link (`dish`/`name`/`cat`/`fromQuery`) this ticket
must not touch, and the existing, already-safe, already-shipped `?q=` +
`fromQuery` combination this ticket proposes reusing unmodified for its
new "view all matches" action (see "Reused, not new: the query
parameters" below — this is verified against the actual, current
`app/menu/[id]/MenuView.js`, not assumed).
`planning/specs/tickets/be-11-public-menu-discovery-intent-aware-results.md`
— `RestaurantBrowseCard`'s restrained-fields/one-primary-action precedent
and its "two levels of disclosure, never three" information-architecture
principle, both reused as direct design precedent, not reopened.
`planning/decisions/014-navigation-and-orientation-standard.md` — the
accessibility/heading/mobile-overflow acceptance bar restated, not
redecided.
`app/menu/[id]/MenuView.js`'s existing, unmodified `?q=` filter
(`itemMatchesQuery`) — the exact, already-shipped mechanism this ticket
proposes reusing for "view the filtered menu, no highlight."

## Problem

A dish-name/ingredient query that matches many dishes across several
restaurants renders today, on `/search`, as one flat list of individual
dish cards (`app/search/page.js`'s `dish-results-list`) — one card per
matching dish, regardless of how many of those dishes belong to the same
restaurant and menu. This already causes real, measurable clutter at
Breda's current, still-small menu-data coverage, and gets structurally
worse as more restaurants and cities gain digitized menus, without any
change in query behavior.

**Verified against real, current data (`data/restaurants.json`/
`data/menus.json`, checked 2026-09-18):**

- Only 4 of Breda's 25 restaurants (`1`, `6`, `19`, `23`) currently have
  any digitized menu data at all — the same, still-current gap BE-11's
  own "Problem" section already named on 2026-09-13. A genuine
  "90 restaurants match" scenario is **not reproducible against today's
  real data** — it is a real, future-scale problem this ticket designs
  for ahead of time, the same way BE-11 itself designed `Alle
  restaurants` around a rule that holds regardless of how the 4-of-25
  ratio changes, rather than around today's specific numbers.
- `q=friet` (`searchDishes({ q: 'friet' })`) — the example most people
  reach for — returns 12 dishes, but from **exactly one restaurant**
  (T-Huis, id `23`), split across its lunch menu (4 dishes) and diner
  menu (8 dishes). This is a real "one restaurant, two menus" case, not
  a "many restaurants" one — worth naming explicitly, since it is not
  the illustrative example its own familiarity suggests.
- `q=kip` (`searchDishes({ q: 'kip' })`) — the best available real,
  current "broad, many-restaurant" fixture — returns 11 dishes across
  **3 different restaurants** (Brasserie Bardot id `6`, Restaurant Zuyd
  id `19`, T-Huis id `23`) and **7 distinct restaurant+menu
  combinations**:
  - `6-lunch` (Brasserie Bardot, 2: "Club Classic", "Vol au vent")
  - `6-diner` (Brasserie Bardot, 1: "Poussin")
  - `6-specialiteiten` (Brasserie Bardot, 1: "Poussin")
  - `19-lunch` (Restaurant Zuyd, 1: "Steak tartaar")
  - `19-diner` (Restaurant Zuyd, 1: "Steak tartaar")
  - `23-lunch` (T-Huis, 3: "Caesar Salade", "Frietjes & Snacks", "Greek
    Chicken Sandwich")
  - `23-diner` (T-Huis, 2: "Caesar Salade", "Frietjes & Snacks")

  Today, this renders as 11 separate, near-identical individual dish
  cards on `/search` — already a real instance of the exact clutter this
  ticket exists to fix, at a scale that will only grow as menu-data
  coverage improves.

## User story

As a visitor who searches a common ingredient or dish name (e.g. "kip"),
I want to quickly see which restaurants and which of their menus actually
have matching dishes, glance at a couple of examples per restaurant, and
either open one specific dish I already recognize, or jump straight to
that restaurant's full, filtered menu to browse all its matches myself —
without scrolling past a wall of near-duplicate cards from the same
handful of restaurants.

## Two intents to preserve (explicit, non-negotiable)

1. **A specific, already-recognized dish** → the existing, unmodified
   BE-12 exact-dish deep link (`dish`/`name`/`cat`/`fromQuery` on
   `/menu/[id]`) — scroll, focus, temporary highlight, `aria-live`
   confirmation, all exactly as BE-12 already built and this project has
   already verified live. Not reopened, not modified, not reinterpreted
   by this ticket in any way.
2. **All matching dishes at one restaurant's one menu** → a new,
   additive action that opens that restaurant's existing `/menu/[id]`
   route with the on-page ingredient filter (`?q=`) pre-set to the
   original query — the full menu stays visible, filtered down to
   matches, and **no item is scrolled to, focused, or highlighted**,
   because `?q=` alone has never triggered BE-12's highlight mechanism
   (verified: `MenuView.js`'s scroll/focus/highlight effect fires only
   when `dish`+`name`+`cat` all resolve via `resolveDishTarget()`; `?q=`
   is read into a completely separate, independent state variable and
   has never been part of that effect's dependencies, at any point in
   this project's history). This action exists once per **qualifying
   menu subgroup** (see "Proposed UX" below) — never once per dish, and
   never a single action spanning more than one menu.

**Decision review (2026-09-18) confirmed both of the above hold today,
independently re-verified against the actual, current `MenuView.js` —
not merely assumed from this ticket's own earlier text.**

## Reused, not new: the query parameters (verified, not assumed)

Investigated directly against the current, real `app/menu/[id]/
MenuView.js`, not assumed from the ticket text alone:

- `?q=` already does exactly "load the full menu, filter it to matches,
  highlight nothing" — this is `itemMatchesQuery()`'s existing, unchanged
  behavior, live and tested since before BE-12 existed. No new query
  parameter is needed for intent 2's "filtered menu" half.
- `fromQuery` already renders the existing "← Terug naar zoekresultaten
  voor '{fromQuery}'" back-link **whenever `fromQuery` is present**,
  **independent of whether a `dish` context is present or valid**
  (`MenuView.js`'s `backToSearchHref` is computed from `fromQueryParam`
  alone — verified in the current source, not assumed). Sending
  `fromQuery={originalQuery}` alongside `?q={originalQuery}` on a group's
  "view all matches" link therefore gets a working, already-tested,
  already-safe back-link **for free**, with zero new code, using the
  exact same safe, same-origin, `URLSearchParams`-only mechanism BE-12
  already built and this ticket must not touch.
- **Conclusion: the proposed "view all matches" link is
  `/menu/{restaurantId}-{mealType}?q={query}&fromQuery={query}` — an
  additive combination of two already-existing, already-safe parameters,
  not a new parameter or a new mechanism.** This directly answers this
  ticket's own instruction to investigate whether the existing parameters
  are safe and sufficient: they are, verified, with no new
  herkomsttracking of any kind.

## Proposed UX — decided group structure (2026-09-18)

**A restaurant is one accessible, top-level group. Within it, one
subgroup per relevant menu.** This directly replaces this ticket's
earlier, flatter `(restaurantId, mealType)`-card-per-group draft, in
response to a real gap the decision review found: under the earlier
draft, a restaurant matching across several of its own menus (real
fixture: Brasserie Bardot at `q=kip` — `6-lunch`, `6-diner`, and
`6-specialiteiten` all match) rendered as several separate, adjacent
cards for the *same* restaurant — reintroducing, at restaurant level,
exactly the repetition this whole ticket exists to remove.

The decided structure, shown for a real restaurant matching across three
menus:

```text
Restaurant
  Dinerkaart — 8 gerechten
  Lunchkaart — 3 gerechten
  Borrelkaart — 1 gerecht
```

Rules:

- **A restaurant is one top-level group** (`<h3>`, reusing
  `RestaurantBrowseCard`'s existing `headingLevel={3}` convention rather
  than inventing a new one) — never split into multiple, separate
  restaurant-named cards for its different menus.
- **Within that group, one subgroup per relevant menu** (`<h4>`,
  labelled with the existing `MEAL_TYPE_LABELS` map BE-12 already
  introduced — e.g. "Dinerkaart", matching `MEAL_CONFIG`'s existing
  title strings already used on `/menu/[id]` itself, not a new label
  vocabulary).
- **Only menus with at least one match appear.** A restaurant's menu
  with zero matches for this query is never listed, never shown as
  "0 gerechten."
- **Every menu subgroup shows a full-sentence count** (e.g. `8
  gerechten`, or `1 gerecht` for the singular — matching BE-11 §2's own
  "full sentence, never a bare label" rule) **and up to 3 example dish
  names**, in the existing tier/tie-break relevance order already
  returned by `dishSearch.js` — never re-sorted, never alphabetical.
  When a subgroup has 3 or fewer matches, its examples are simply all of
  its matches (nothing is hidden); "collapsing" only becomes visible once
  a subgroup has **4 or more** matches, per the worked example above
  (`Borrelkaart — 1 gerecht` shows its one real dish; `Dinerkaart — 8
  gerechten` shows only its top 3 as examples).
- **Every menu subgroup has exactly one primary action**, honestly
  labelled (e.g. `Bekijk alle 8 op de kaart →`), linking to that one
  menu's filtered view — never a second, competing action per subgroup,
  matching `RestaurantBrowseCard`'s own "exactly one primary action"
  precedent, applied here per subgroup rather than per card.
- **No new "all menus" route.** A restaurant with matches in three menus
  still has three separate primary actions (one per subgroup), each
  pointing at that one specific, existing `/menu/[id]` route — never a
  single action that would require a route that doesn't exist.
- **A group action never picks or highlights a dish at random.** Every
  subgroup's action is the "view all matches, filtered, no highlight"
  action from "Two intents to preserve" above — never a BE-12 exact-dish
  link pointed at an arbitrarily-chosen member of the subgroup.
- **Never**: a reservation/contact/phone/website action, a long
  description, or a photo on the restaurant group or any menu subgroup —
  the same restraint `RestaurantBrowseCard` already applies, for the same
  reason (this is a discovery aid, not a restaurant profile). Example
  dish names are plain, non-interactive text — never links — so each
  menu subgroup has exactly one click target.
- **The exact, definitive threshold (stated once, positively, and reused
  verbatim everywhere else in this ticket): a restaurant qualifies for
  grouping when at least one of its menus has 4 or more matches for the
  query. A menu with 3 or fewer matches never triggers grouping on its
  own.** This is the only threshold this ticket defines — never phrased
  elsewhere as `>2`, `>3`, `3+`, or "exceeds 3."
- **When a restaurant is shown as a group at all vs. today's plain
  individual cards**: a restaurant renders using the structure above only
  when **at least one of its menus** has 4 or more matches for the query
  — every one of that restaurant's other matching menus is then shown
  alongside it, as a subgroup, **even if that other menu individually has
  only 1, 2, or 3 matches** (exactly the "Borrelkaart — 1 gerecht" line in
  the worked example — shown for visual coherence within its own
  restaurant's group, not because it independently reached 4 or more). A
  restaurant where **no** menu reaches 4 or more matches renders **exactly
  as it does today** — unchanged, individual `DishResultRow` cards, one
  per dish — a real, checkable backward-compatibility property for
  queries whose matches stay thinly spread, not just an intention.
  Verified against the real `kip` fixture: Restaurant Zuyd (`19-lunch`:
  1, `19-diner`: 1 — neither reaches 4) and Brasserie Bardot (`6-lunch`:
  2, `6-diner`: 1, `6-specialiteiten`: 1 — none reaches 4) both stay
  exactly as today's flat individual cards for this query. Verified
  against the real `brood` fixture (see "Real data fixtures" below): only
  T-Huis reaches 4 or more on any menu, and is the only restaurant that
  renders using the grouped structure above for that query.
- **Section placement and heading hierarchy (decided, 2026-09-18 decision
  review):** the new restaurant-group section is its own, distinctly
  named `<h2>Gerechten gegroepeerd per restaurant</h2>` — **never** the
  existing `Restaurants gevonden` heading, which already means something
  unrelated (BE-11's restaurant *name*/buurt/address match, not dish-
  content volume) and must never be confused with it. It always renders
  immediately after the page's existing, visually-hidden
  `<h1>Zoeken</h1>`, in the same fixed position regardless of BE-11 Fase
  2's own existing order-flip logic between `Gerechten gevonden` and
  `Restaurants gevonden` (that logic is untouched — see "Non-goals").
  Full hierarchy: `<h1>` → `<h2>Gerechten gegroepeerd per restaurant</h2>`
  (only when non-empty) → each restaurant group's name as `<h3>` → each
  menu subgroup label as `<h4>` → the existing `<h2>Gerechten
  gevonden</h2>` (now scoped to only the dishes below, see next bullet) →
  the existing, unmodified `<h2>Restaurants gevonden</h2>`. No skipped
  level anywhere in this chain.
- **No duplication between the new section and `Gerechten gevonden`**: a
  dish appears in exactly one of the two — `Gerechten gevonden` shows
  only dishes belonging to a restaurant that did **not** qualify for
  grouping. Once a restaurant qualifies, all of its dishes (including
  ones on a menu with only 1-3 matches, shown as that restaurant's own
  subgroup) move into the new section and are removed from `Gerechten
  gevonden` entirely — never shown in both places.
- **How the existing, exact BE-12 dish link stays reachable**: unchanged
  and fully reachable, exactly as today, for every dish belonging to a
  non-qualifying restaurant (still an individual `DishResultRow` with its
  own BE-12 link). For a dish that is one of a subgroup's plain-text,
  non-clickable examples (or beyond the shown examples), no new
  mechanism is added or needed — per "Two intents to preserve" above,
  reaching it is exactly intent 2's designed hand-off: open that
  subgroup's filtered menu and read it there, unhighlighted. This is the
  intended behavior, not a gap.

## Server-side aggregation — the decided architecture (2026-09-18)

**Decision, confirmed by an independent decision review: server-side
aggregation is this ticket's target architecture, not an optional
alternative.** The earlier draft's "start client-side, maybe move to
server-side later" framing is retired. The reason is a real, reproduced
defect in the client-side-only approach, not a theoretical concern:

**Proof (`q=brood`, verified 2026-09-18, `searchDishes({ q: 'brood' })`):**
this real query returns `total: 24`, `hasMore: true` at the existing
default page size (`DEFAULT_LIMIT`=20). Page 1 (`cursor=0`) contains
`23-lunch`: 2 matches and `23-diner`: 6 matches (both T-Huis); page 2
(`cursor=20`) contains 3 *more* `23-lunch` matches and 1 *more*
`23-diner` match — the same two restaurant+menu combinations, split
across a pagination boundary that already exists in production today,
at Breda's current, still-small data coverage. A client-side grouping
pass over only page 1 would show "2 gerechten"/"6 gerechten" for a real
total of 5/7 — a demonstrated undercount, not a hypothetical one. Worse:
a restaurant+menu with **zero** matches on page 1 but real matches on
page 2 would not appear in the grouped view **at all** until "Meer
resultaten laden" is clicked — the exact "which restaurants actually
match" question this whole ticket exists to answer, silently wrong for
as long as a page remains unloaded.

**Decided rules:**

1. **Aggregation happens before pagination, over the complete matching
   set** — never over one already-paginated page of raw dishes. This is
   what makes every displayed count exact and complete, regardless of
   how many total dishes match, following exactly the same principle
   `getMatchTier()`'s own hard filters already apply before any
   cursor/limit slicing happens today.
2. **The existing `/api/search` response and its individual, per-dish
   behavior are completely unchanged.** Grouping is available only
   through a new, additive, optional response mode, decided (2026-09-18
   decision review) to be the query flag **`group=restaurant`** — the
   value names the aggregation unit explicitly (rejecting the vaguer
   `group=1`/boolean form, and rejecting `group=meal`, which would
   wrongly name the *inner* subgroup unit instead of the *paginated*
   outer one). An absent **or unrecognized** `group` value falls back,
   silently and completely, to today's exact, unmodified response — the
   same non-breaking, additive-only pattern `GET /api/restaurants`'s own
   `uniqueNameMatch` field already established for this project. This is
   a deliberately different failure mode from `meal`'s own existing
   validation (an unrecognized `meal` value correctly zeroes out
   results, because `meal` is a content filter); `group` is a
   response-shape flag, not a content filter, so an unrecognized value
   must never zero out real matches — it must fall back to the default
   shape instead.
3. **Pagination happens at the restaurant level, never at the raw-dish
   level and never at the individual-menu-subgroup level.** The grouped
   response's own cursor/limit paginate over the list of *qualifying
   restaurant groups* (see "Proposed UX" for what "qualifying" means) —
   e.g. 20 restaurant groups per page, reusing the existing
   `DEFAULT_LIMIT`/`MAX_LIMIT` constants at this new aggregation level,
   not a new numeric convention. A restaurant's own menu subgroups (and
   their exact counts and sample dishes) are never split across two
   pages of this response, because the whole restaurant is the paginated
   unit. The response's data payload is returned under its own field,
   **`restaurantGroups`** — deliberately not reusing the existing
   `results` field name, since `results` would otherwise sometimes hold
   dish objects and sometimes hold structurally different restaurant-
   group objects depending on an easy-to-miss query flag, a real
   API-hygiene risk for any consumer that doesn't check for `group`
   explicitly. `total`, `nextCursor`, and `hasMore` keep their existing
   names and meaning — unit-agnostic pagination metadata, now counting
   restaurant groups instead of dishes.
4. **This ticket is itself the explicit decision authorizing exactly
   this one, additive, optional grouped-response mode on `GET
   /api/search`** — restated because "Non-goals" below still forbids any
   *other*, broader backend/API change without a separate decision.
5. **No permanent `N+`/open-ended counts.** Because aggregation happens
   over the complete matching set before pagination, every count shown
   for a restaurant group or menu subgroup that has actually been fetched
   is exact and final — never an estimate, never open-ended. (A
   restaurant group that hasn't been fetched yet, because it's on a
   later page of the restaurant-level pagination, simply isn't rendered
   yet — exactly like today's individual dish results already behave
   with "Meer resultaten laden," not a new kind of uncertainty.)
6. **`total` means two different things across the two modes, and
   `lowCoverage` must never be derived from the wrong one.** In today's
   ungrouped response, `total` is the number of matching *dishes*
   (`candidates.length` in `src/services/dishSearch.js`). In the
   `group=restaurant` response, `total` counts qualifying *restaurant
   groups* instead — a structurally different number that can be `0`
   (no restaurant reaches the 4-or-more threshold) even while dozens of
   individual dishes matched. `lowCoverage` is **never** derived from
   this new, group-mode `total === 0` — doing so would be a false
   "weinig aanbod" (low-coverage) claim for a query that actually
   returned plenty of individual dish matches, just none clustered
   into a qualifying group.
   **`lowCoverage` keeps its exact existing meaning**, computed by the
   exact same, unmodified `computeLowCoverageSignal()` function, against
   the exact same input: the full, underlying, *ungrouped* dish
   candidate set (`candidates.length`, before any restaurant-group
   aggregation), filtered only by `cuisines`/`buurt`/`day`/`nowOpen` —
   entirely independent of `q` and of `group`. Concretely: `lowCoverage`
   is included in a `group=restaurant` response if and only if that same
   underlying dish candidate count is genuinely `0` — the identical
   condition that would include it in today's ungrouped response for the
   same filters, computed once, not per mode.
   **Worked case — the real `q=kip` fixture proves the distinction that
   matters most:** 11 dishes match across 3 restaurants, so the
   underlying dish candidate count is 11, not 0. Under the 4-or-more
   threshold, none of the 7 restaurant+menu combinations qualifies, so
   `restaurantGroups: []` and the group-mode `total` is `0`. Because the
   underlying dish count (11) is not zero, `lowCoverage` stays **absent**
   — exactly as it is absent in today's ungrouped `q=kip` response
   (`total: 11`, no `lowCoverage` key). An empty `restaurantGroups` array
   is a legitimate "nothing clustered enough to group" outcome, not a
   coverage gap, and must never be presented as one.
   **The genuine-zero case is unchanged:** when the underlying dish
   candidate count is actually `0` (no dish matches the filters at all),
   `lowCoverage` appears in both modes, identically — same field name,
   same value, same trigger, computed once regardless of `group`.
   **`nextCursor` and `hasMore` follow the same rule as `total`:** in
   group mode both describe pagination over restaurant groups only, and
   neither one feeds into, gates, or otherwise changes `lowCoverage`'s
   trigger or value.

**Client-side-only grouping (this ticket's earlier "Option B") is
retired as a target — it is proven unreliable by the `brood` fixture
above, not merely disfavored.** It remains, at most, a historical note:
if a genuinely temporary, throwaway prototype were ever built for
internal review purposes only, any group count it showed would need
explicit "may be incomplete" labeling — but that path is not this
ticket's plan and is not to be shipped to visitors.

## Exact scope

Documentation and design decision only, in this ticket. **No
implementation is authorized here** — this ticket now decides the
architecture (server-side aggregation, restaurant-level pagination, the
nested restaurant→menu-subgroup structure) but does not itself build any
of it. A follow-up implementation ticket (or an amendment to this one)
would be scoped to:
- `src/services/dishSearch.js` — a new, additive aggregation function
  (e.g. `groupDishesByRestaurant()`), computed over the full, unpaginated
  matching set using the existing, unmodified `getMatchTier()`/tie-break
  logic — no ranking change.
- `app/api/search/route.js` — the new, additive, optional grouped
  response mode described above; the existing, ungrouped response stays
  byte-for-byte unchanged when that mode is not requested.
- `app/search/page.js` — the new restaurant-group/menu-subgroup render
  path, alongside (not replacing) the existing individual
  `DishResultRow` path for restaurants that don't qualify for grouping,
  and the "view all matches" link construction described above.
- A new, small, presentation-only component (or an inline block,
  decided at implementation time) for the restaurant group and its menu
  subgroups — following `RestaurantBrowseCard`'s existing field/action
  restraint, not a new design language.
- Targeted tests: real-data-driven unit tests for the aggregation
  function (same pattern as `dishSearch.test.js`), plus `app/*`-page
  structural tests following this project's existing `fs.readFileSync` +
  regex convention (same pattern as BE-12's own test files).

No change to `app/menu/[id]/MenuView.js` or `src/lib/dishDeepLink.js` is
anticipated — the "view all matches" action reuses their existing,
unmodified `?q=`/`fromQuery` behavior exactly as verified above.

## Non-goals (explicitly out of scope)

- **No change to BE-12's validation or highlight behavior.**
  `resolveDishTarget()`, the scroll/focus/highlight effect, and the
  `aria-live` announcement in `app/menu/[id]/MenuView.js` are not
  reopened, not modified, not reinterpreted.
- **No change to dish-search ranking** (`src/services/dishSearch.js`'s
  tiers, tie-break order) **unless a later implementation round proves a
  change is genuinely necessary** — this ticket's own default assumption
  is that grouping is a pure display transform over the existing,
  unmodified order, and no ranking change is expected to be needed.
- **No backend or API contract change beyond the one, specific, additive
  grouped-response mode decided in "Server-side aggregation" above.**
  That one mode is authorized by this ticket's own decision; no other
  endpoint, no ranking change, and no removal or breaking change to the
  existing `/api/search` response is authorized here.
- **No rebranding, domain, multi-city, or `MARKET-*` work of any kind.**
  This ticket operates entirely inside today's existing, single-market,
  unprefixed route structure, exactly like BE-12/BE-14 before it.
- **No redesign of the existing individual dish card, the restaurant
  results group (`Restaurants gevonden`), `PrimaryNav`, or
  `RestaurantBrowseCard` itself.** The new group card is an additional,
  narrowly-scoped presentation alongside them, reusing their existing
  tokens and restraint principles — not a visual overhaul.
- **No origin/herkomst-tracking of any kind** — no new query parameter
  beyond the already-existing `q`/`fromQuery` combination named above, no
  `document.referrer`, no `sessionStorage`, no `returnTo`.

## Risks

- **The false-precision/pagination risk is resolved by the architecture
  decision above (aggregate before paginating, at the restaurant level),
  not by a UI-copy workaround.** The residual risk is an implementation
  one: an implementation that computes the aggregation *after* an
  existing dish-level cursor/limit slice, instead of before it, would
  silently reintroduce the exact `brood`-fixture defect this ticket
  proves and decides against. Acceptance criteria below name the
  `brood` fixture explicitly so this is checkable, not just stated.
- **Scope creep toward a bigger redesign** of `/search`'s entire results
  layout, or toward building a second, unrelated aggregation for
  `/api/restaurants` or any other endpoint — explicitly forbidden in
  "Non-goals," which now authorizes exactly one, specific, additive
  grouped mode on `/api/search` and nothing broader.
- **Duplicating `RestaurantBrowseCard`'s existing logic** instead of
  reusing its established patterns (heading-level prop, single-action
  restraint, accessible price/label conventions) — the new restaurant
  group/menu subgroup should follow, not reinvent, those conventions.
- **A menu subgroup's sample dishes silently becoming clickable** (a de
  facto second action per subgroup) — explicitly forbidden; sample names
  are plain text only, matching BE-11's "no nested links" rule.
- **The "does any menu qualify" grouping trigger and the "which
  restaurants are non-qualifying and stay flat" fallback interacting
  incorrectly on the same results page** — e.g. a non-qualifying
  restaurant's individual dish cards rendering interleaved with
  qualifying restaurants' grouped cards in a confusing order. The exact
  combined ordering of grouped-restaurant sections and remaining
  individual dish cards on one results page is a real implementation
  detail this ticket names as a risk but does not fully resolve — see
  "Open decisions."

## Performance

Stays inside the existing consumer performance budget
(`planning/decisions/003-performance-budget.md`/
`009-consumer-vs-internal-performance-budget.md`). The grouped mode is
still exactly one request per fetch — the same `/api/search` call
`/search` already makes, with an additive query flag — never a second,
separate request to compute aggregation. Aggregation work moves
server-side (see "Server-side aggregation" above) precisely so the
client never has to fetch more raw dishes than it needs just to compute
a correct count. No new dataset, no new dependency.

## Accessibility

Applies `planning/decisions/014-navigation-and-orientation-standard.md`
in full, restated (not redecided) for this specific surface:
- Heading hierarchy as described above — no skipped levels, matching
  BE-11 Fase 2's own already-corrected pattern.
- No horizontal overflow at ~390px or ~1280px, in both themes — the
  count sentence and the example-dish list must wrap naturally, exactly
  like existing dish-result-card text already does (no new
  `nowrap`/truncation).
- Exactly one real, keyboard-operable `<Link>`/`<a>` per menu subgroup
  (the primary action) — no nested links, no fake buttons, matching
  decision 014 item 10 and `RestaurantBrowseCard`'s own existing pattern.
- Visible keyboard focus on the primary action, reusing existing,
  already-shipped focus styles (`.lrc-primary-btn:focus-visible` or an
  equivalent existing token-based rule) — no new focus convention
  invented.
- The example dish names are plain, non-interactive text with sufficient
  color contrast against existing tokens — no new color introduced.

## Real data fixtures (verified 2026-09-18, re-verify before implementation)

- **`q=brood` — the decisive pagination-reliability fixture, and this
  ticket's primary "mixed page" fixture.** `total: 24`, `hasMore: true`
  at the default page size (`DEFAULT_LIMIT`=20). Page 1 (`cursor=0`, 20
  results): `6-diner` (Brasserie Bardot): 3, `6-lunch` (Brasserie
  Bardot): 3, `19-lunch` (Restaurant Zuyd): 3, `23-borrel` (T-Huis): 1,
  `1-diner` (Restaurant Wolfslaar): 1, `19-diner` (Restaurant Zuyd): 1,
  `23-lunch` (T-Huis): 2, `23-diner` (T-Huis): 6. Page 2 (`cursor=20`, 4
  remaining results): `23-lunch`: 3 more (real total 5), `23-diner`: 1
  more (real total 7). **Complete, real totals per restaurant+menu:**
  `6-lunch`=3, `6-diner`=3 (Brasserie Bardot), `19-lunch`=3, `19-diner`=1
  (Restaurant Zuyd), `1-diner`=1 (Restaurant Wolfslaar), `23-lunch`=5,
  `23-diner`=7, `23-borrel`=1 (T-Huis).
  **Definitive, unambiguous outcome under the 4-or-more threshold:**
  T-Huis is the **only** qualifying restaurant, because `23-lunch` (5)
  and `23-diner` (7) both reach 4 or more — it renders as **one**
  restaurant group with **three** subgroups: `Dinerkaart — 7 gerechten`,
  `Lunchkaart — 5 gerechten`, and `Borrelkaart — 1 gerecht` (the last one
  included solely because T-Huis already qualifies via its other two
  menus, not because 1 reaches the threshold on its own). Brasserie
  Bardot (3 and 3), Restaurant Zuyd (3 and 1), and Restaurant Wolfslaar
  (1) all have **no** menu reaching 4 or more, so **none of them
  qualifies for grouping** — their combined 11 dishes (3+3+3+1+1) render
  exactly as today's individual `DishResultRow` cards, in the existing
  `Gerechten gevonden` section. 13 (T-Huis, grouped) + 11 (everyone else,
  individual) = 24, matching `total` exactly. **Use this fixture to
  prove both the exact, complete counts (`23-lunch: 5`, `23-diner: 7`,
  regardless of the underlying dish-level page size — a client-side pass
  over page 1 alone would show 2 and 6, the exact defect this ticket's
  architecture decision exists to prevent) and the correct coexistence
  of one grouped restaurant with 11 remaining individual results on the
  same page.**
- **`q=kip`** — 11 dishes, 3 restaurants, 7 restaurant+menu groups (see
  "Problem" for the full breakdown). A **negative** fixture: Brasserie
  Bardot (`6-lunch`: 2, `6-diner`: 1, `6-specialiteiten`: 1), Restaurant
  Zuyd (`19-lunch`: 1, `19-diner`: 1), and T-Huis (`23-lunch`: 3,
  `23-diner`: 2) each have multiple matching menus, but **none of the 7
  restaurant+menu combinations reaches 4 or more matches** — so, under
  this ticket's decided rule, **no restaurant qualifies for grouping**
  and all 11 dishes render exactly as today's flat individual cards.
  This proves the grouping trigger doesn't fire merely because a
  restaurant has multiple matching menus, or because a menu has 3
  matches (`23-lunch` here is deliberately at, not past, the boundary).
- **`q=friet`** — 12 dishes, 1 restaurant (T-Huis, id `23`), 2 menus
  (lunch: 4, diner: 8). Both `23-lunch` (4) and `23-diner` (8) reach 4 or
  more, so both become menu subgroups within **one** T-Huis restaurant
  group — proving two independently-qualifying subgroups render together
  under one restaurant heading, not as two separate restaurant-named
  cards, and proving the threshold's own boundary case (`23-lunch`'s 4
  is the smallest possible qualifying count).
- **Dated coverage caveat**: only 4 of 25 Breda restaurants have any
  menu data today (re-verified 2026-09-18, matching BE-11's own
  2026-09-13 snapshot) — re-run this check before implementation, since
  the underlying product rule (group whenever at least one of a
  restaurant's menus has a large match count, regardless of how many
  restaurants that spans) does not depend on this ratio, but real test
  fixtures will change as coverage grows.

## Acceptance criteria

**Exact, complete counts (the `brood` fixture)**
- [ ] Given `q=brood`, the grouped server-side response reports
      `23-lunch: 5` and `23-diner: 7` (T-Huis) — the real, complete
      totals — regardless of the underlying dish-level page size, proven
      by computing the aggregation over the full matching set before any
      pagination cut, never over one already-paginated page.
- [ ] No count shown anywhere is ever a page-bound undercount or an
      open-ended `N+`/estimate — every rendered count is exact and final
      for the restaurant group it belongs to.

**Restaurant-level pagination**
- [ ] The grouped response's cursor/limit paginate over the list of
      qualifying restaurant groups — never over raw dishes, and never
      over individual menu subgroups. A restaurant's own menu subgroups
      (and their exact counts/samples) never span two pages of this
      response.
- [ ] No more restaurant groups are rendered per fetch than the existing
      `DEFAULT_LIMIT`/`MAX_LIMIT` conventions already allow at this new
      aggregation level, reusing the existing "Meer resultaten laden ↓"
      pattern — no new pagination UI.

**Contiguous menu subgroups within one restaurant**
- [ ] Given the real `q=friet` fixture, `23-lunch` (4 matches) and
      `23-diner` (8 matches) — both reaching 4 or more — render as two
      menu subgroups nested under exactly **one** T-Huis restaurant
      group, never as two separate, restaurant-named cards.
- [ ] Given the real `q=kip` fixture, Brasserie Bardot's three matching
      menus (`6-lunch`: 2, `6-diner`: 1, `6-specialiteiten`: 1 — none
      reaching 4 or more) render as today's flat individual
      `DishResultRow` cards, unchanged — proving the grouping trigger
      requires at least one menu to actually reach 4 or more matches,
      not merely "more than one menu matches."
- [ ] Given the real `q=brood` fixture, T-Huis (`23-lunch`: 5,
      `23-diner`: 7, `23-borrel`: 1) renders as exactly one restaurant
      group with three subgroups (`Dinerkaart — 7 gerechten`,
      `Lunchkaart — 5 gerechten`, `Borrelkaart — 1 gerecht`), while
      Brasserie Bardot, Restaurant Zuyd, and Restaurant Wolfslaar (11
      dishes combined) render as individual cards — none of their menus
      reaches 4 or more matches, so no group claim applies to any of
      those three restaurants for this query.
- [ ] Once a restaurant qualifies for grouping (at least one menu with 4
      or more matches), **every** other menu of that same restaurant
      with ≥1 match appears as its own subgroup in the same group, even
      if that other menu's own count is 1, 2, or 3 — matching the worked
      "Borrelkaart — 1 gerecht" example.
- [ ] A menu with zero matches for the query is never listed as an empty
      subgroup.

**Correct individual and group routes**
- [ ] Each menu subgroup's primary action `href` is exactly
      `/menu/{restaurantId}-{mealType}?q={query}&fromQuery={query}`,
      built via `URLSearchParams`, reusing only the two existing,
      already-safe parameters — no new parameter, no new route.
- [ ] A specific dish's existing BE-12 deep link
      (`dish`/`name`/`cat`/`fromQuery`) is completely unchanged for
      restaurants/dishes rendered as individual cards — same URL shape,
      same validation, same scroll/focus/highlight/`aria-live` behavior,
      verified by re-running BE-12's own existing, unmodified test suite.

**No highlight on "view all matches"**
- [ ] Visiting a menu subgroup's primary action opens the full, normal
      menu, filtered to matches via the existing `?q=` mechanism, with
      **zero** items scrolled to, focused, or highlighted — proving
      intent 2 never triggers BE-12's exact-dish mechanism, and never
      picks an arbitrary member of the subgroup to highlight instead.
- [ ] The existing "← Terug naar zoekresultaten voor '{query}'" back-link
      appears on that filtered menu view, unmodified, because
      `fromQuery` is present.

**Mobile semantics, focus, overflow**
- [ ] No horizontal overflow at ~390px or ~1280px, in both themes, with
      a long restaurant name, a long menu label, and 3 example dish
      names all present within one restaurant group at once.
- [ ] Exactly one real `<Link>`/`<a>` per menu subgroup — no nested
      links, no plain-text sample dish name is clickable.
- [ ] Heading hierarchy has no skipped level: the page's `<h1>` → the new
      `Gerechten gegroepeerd per restaurant` `<h2>` (only when non-empty)
      → each restaurant group's name as `<h3>` → each menu subgroup label
      as `<h4>` → the existing `Gerechten gevonden` `<h2>` (now scoped to
      only non-qualifying/individual dishes) → the existing, unmodified
      `Restaurants gevonden` `<h2>`.
- [ ] Visible keyboard focus on every menu subgroup's primary action,
      reusing an existing, already-shipped focus-visible token rule — no
      new focus convention.

**Preservation of existing behavior**
- [ ] `src/services/dishSearch.js`'s tiers/tie-break order are verified
      unchanged; the aggregation function reuses them, never re-ranks.
- [ ] `/api/search`'s existing response is verified byte-for-byte
      unchanged when the new grouped mode is not requested.
- [ ] `app/menu/[id]/MenuView.js`'s `?q=`/allergen/diet/price filter
      logic and BE-12's `dish`/`name`/`cat`/`fromQuery` validation are
      both verified unchanged.
- [ ] No new network request is introduced for a restaurant that does
      not qualify for grouping — its dishes are served exactly as today.

**`lowCoverage` signal unaffected by `group=restaurant` (two different meanings of `total`)**
- [ ] Given filter params that produce a genuinely zero underlying dish
      candidate count (today's ungrouped `total === 0`, with a
      `lowCoverage` signal in today's response), requesting the same
      search with `group=restaurant` yields byte-for-byte the same
      `lowCoverage` field: same key, same trigger condition (the full,
      *ungrouped* dish candidate count derived from `{cuisines, buurt,
      day, nowOpen}` is `0`), same value — never silently dropped,
      renamed, or recomputed against the group-mode `total`.
- [ ] Given filter params that produce a non-zero underlying dish
      candidate count (no `lowCoverage` field in today's response),
      requesting the same search with `group=restaurant` also omits
      `lowCoverage` entirely, **even when zero restaurants qualify for
      grouping** (`restaurantGroups: []`, group-mode `total: 0`) —
      grouping never introduces the field based on the group-mode
      `total` where the underlying dish match count says it doesn't
      belong.
- [ ] Given the real `q=kip` fixture requested with `group=restaurant`:
      11 dishes match (non-zero underlying dish candidate count), but
      under the 4-or-more threshold none of the 7 restaurant+menu
      combinations qualifies, so `restaurantGroups: []` and the
      group-mode `total` is `0`. `lowCoverage` is **absent** from this
      response — proving the group-mode `total === 0` (empty
      `restaurantGroups`) is never mistaken for the ungrouped
      `total === 0` (zero dish matches) that actually triggers
      `lowCoverage`.
- [ ] In `group=restaurant` mode, `nextCursor` and `hasMore` describe
      pagination over restaurant groups only and are never read,
      referenced, or used as an input when deciding whether
      `lowCoverage` appears.

## Open decisions (explicitly not resolved by this ticket)

**Resolved, no longer open** (2026-09-18 decision reviews, both applied
above — not merely recommended): the per-menu collapse threshold (4 or
more matches on at least one menu), the number of sample dish names (3,
in existing relevance order), the client-side-vs-server-side aggregation
question (server-side, decided), the exact query flag and its semantics
(`group=restaurant`, unknown/absent falls back to the default response),
the grouped payload's field name (`restaurantGroups`, not `results`),
the combined section ordering (the new section always immediately after
`<h1>`, before `Gerechten gevonden`, independent of BE-11 Fase 2's own
order-flip logic), and how the existing `lowCoverage` signal behaves
under `group=restaurant` (keeps its exact existing meaning and trigger,
computed from the underlying ungrouped dish candidate count — never from
the group-mode `total` of qualifying restaurant groups — see
"Server-side aggregation" point 6). `N+`/open-ended counts are explicitly
retired, not merely deferred.

Still genuinely open:

- **Exact visual treatment of the restaurant group and its menu
  subgroups** (only the field list, nesting, and restraint principles
  are decided here, not a pixel-level design) — a short static mockup,
  following this project's own `docs/mockups/README.md` convention, is
  recommended before implementation but not produced by this ticket.

## Suggested order

An independent extension of `BE-11`'s existing search/browse experience,
following `BE-13` and `BE-12`. This ticket explicitly reuses, rather than
modifies, BE-12's mechanisms.

**BE-15 implementation must not start until both of the following are
true:**

1. **The one remaining item in "Open decisions" above is resolved or
   consciously deferred** — the exact visual treatment/mockup is the only
   item left there; every other behavior-relevant decision (threshold,
   sample count, aggregation architecture, query flag, response field
   names, section ordering, `lowCoverage` handling) is already resolved
   and stated as such above, not merely proposed.
2. **The full BE-12 chain is completely finished, not merely "mostly
   done"** — committed, pushed, and live-verified, including its own
   still-outstanding, currently-uncommitted name-collision refinement to
   `app/search/page.js`/`app/search/page.test.js` and that refinement's
   own ticket status update. BE-15 touches the same file
   (`app/search/page.js`) BE-12's collision work already modified — the
   two must not be developed concurrently against a moving, unfinished
   base.
