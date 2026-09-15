# BE-11 — Public Menu Discovery and Intent-Aware Results

## Status

Proposed; **Fase 1's first vertical slice is built, committed, and live;
Fase 2's joint search experience is built and locally verified, not yet
committed or pushed.** Concretely, as of this writing:
- **Fase 1 — built, tested, committed (`f7e6e79`), pushed, and verified
  live** on production (`https://menucard-kappa.vercel.app`): `GET /api/
  restaurants` (`app/api/restaurants/route.js`, `src/services/
  restaurantIndex.js`), a restaurant-level browse index that reads only
  `data/restaurants.json` — see `docs/api/restaurant-summary-shape.md`
  for the full contract — and a first real UI at `/alle-restaurants`
  (`app/alle-restaurants/page.js`) consuming it against real data.
- **Fase 2 — built and locally verified (tests + build green;
  Playwright-checked at 390px/1280px against a local production server),
  not yet committed or pushed:** `/search` (`app/search/page.js`) now
  additionally queries `GET /api/restaurants` in parallel, for a
  meaningful free-text query only, and renders a separate "Restaurants
  gevonden" group alongside the existing, unmodified "Gerechten
  gevonden" dish group. Group order is decided by a new, server-computed
  `uniqueNameMatch` field on `GET /api/restaurants`'s response (see
  `src/services/restaurantIndex.js`'s `hasUniqueRestaurantNameMatch()`
  and `docs/api/restaurant-summary-shape.md`'s "Name-token match for
  group ordering") — never derived client-side from a paginated result
  list. `RestaurantBrowseCard` was extracted from `/alle-restaurants`
  into `src/components/RestaurantBrowseCard.js` so both routes render the
  identical card. `src/services/dishSearch.js` and `app/api/search/
  route.js` are unmodified — see "Fase 2" under "Phased delivery" below
  for the full account of what this covers and what remains open.
- **Fase 2 corrections, applied before this reached the state above:**
  two review rounds found and fixed real defects in the first build of
  the above. (1) `uniqueNameMatch` could report `true` while `GET /api/
  restaurants` returned zero actual results for the same query (e.g.
  `T Huis` against the stored name `T-Huis`) — fixed so a valid unique
  name-token match is now guaranteed to be an actual, visible result;
  see `docs/api/restaurant-summary-shape.md`'s "Consistency guarantee".
  (2) The heading structure inside a rendered restaurant group was
  incoherent (no page-level `<h1>`, restaurant names as sibling `<h2>`s
  to the group heading) — fixed with a visually hidden `<h1>Zoeken</h1>`,
  `<h2>` group headings, and restaurant names correctly nested as
  `<h3>`; the page's own "Waar heb je zin in?" and "Er ging iets mis"
  states were also promoted from `<h3>` to `<h2>` to close the same
  heading-level gap there. Two related copy corrections shipped
  alongside: a neutral note now states that active dish filters do not
  apply to restaurant results, and the dish-empty message no longer
  repeats a restaurant count already visible above it. None of this
  touched the two parallel fetches' own async-loading behavior: a query
  whose restaurant fetch resolves meaningfully later than its dish fetch
  can still cause the restaurant group to appear above already-rendered
  dish results a moment after first paint — a known, deliberately
  unaddressed UX/performance trade-off of the parallel-fetch design, not
  a defect introduced or fixed by either correction round above.
- Deliberately **not** built yet: any link from the shared site header/
  primary navigation to `/alle-restaurants` or a combined `/search` entry
  point (the final `Zoeken`/`Alle restaurants` nav is a separate, larger
  decision — see "Open technical questions"); cuisine/buurt-exact/day/
  "now open" filters on `GET /api/restaurants`; the meal-type-intent and
  general-search-intent behaviors in "Desired behavior" §3/§4 (no `meal`
  parameter exists on this endpoint yet); GPS/distance/"near me"; a
  restaurant-level price-level filter; free-text cuisine matching (no
  matching against `cuisine`/`cuisineLabel` exists anywhere in this
  product yet — a known, pre-existing gap, not introduced or closed by
  Fase 2); Fase 3 (back-to-results links).
- `/restaurants` is completely unchanged and still the canonical deep
  link for existing bookmarks/links — Fase 1 added a new, additive
  route, never modified the existing one; Fase 2 added to `/search`
  without changing its existing URL/filter semantics or its `/api/
  search` dependency.

## Depends on

`planning/decisions/007-homepage-shift.md` (the existing `/` ↔
`/restaurants` split this ticket extends, never replaces),
`planning/decisions/004-server-side-search-before-restyle.md` (server-side
search is the layer this ticket's new address/buurt matching must extend),
`planning/decisions/002-text-first-no-images.md`,
`planning/decisions/009-consumer-vs-internal-performance-budget.md`,
`planning/decisions/014-navigation-and-orientation-standard.md` (this
ticket's own navigation/accessibility bar, restated, not redecided),
`docs/api/dish-result-shape.md`/`dish-search-ranking.md` (BE-02a/02c — the
existing dish-level search contract this ticket's restaurant-level summary
sits alongside, never replaces), `src/services/dishSearch.js`,
`app/api/search/route.js` (BE-02b — the existing server-side search layer
this ticket's address/buurt matching extends).
**Implements** (this ticket's own, new artifacts, Fase 1 first slice):
`src/services/restaurantIndex.js`, `src/services/restaurantIndex.test.js`,
`app/api/restaurants/route.js`, `app/alle-restaurants/page.js`,
`docs/api/restaurant-summary-shape.md`, plus a new, additively-scoped
`.lrc-*`/`.vh` CSS block in `app/globals.css` (existing `.rc-*`/
`.restaurant-card`/`.restaurant-grid` rules untouched). Reads, but does not modify:
`app/restaurants/page.js`, `app/page.js`, `app/search/page.js`,
`app/restaurant/[id]/RestaurantDetailView.js`, `app/menu/[id]/MenuView.js`,
`data/restaurants.json`, `data/menus.json`,
`src/services/coverageMetrics.js` (PLATFORM-01 — its existing
`withMenuData`/`withoutMenuData` computation is the source for this
ticket's menu-coverage figure in "Problem," reused, not reimplemented).

## Problem

- `/restaurants`' existing "Menukaarten" mode renders one card per
  `{restaurantId}-{mealType}` entry (`Object.entries(menusData)` in
  `app/restaurants/page.js`) — a restaurant with four menu types (lunch,
  diner, borrel, specialiteiten) shows as four separate, near-identical
  cards instead of one.
- No lightweight restaurant-summary data shape exists today. Both
  `data/restaurants.json` and `data/menus.json` carry full menu content;
  `restaurants.json` itself still embeds a full, legacy `menus` blob per
  restaurant (`src/services/coverageMetrics.js`'s own comment calls this
  "legacy, pre-BE-02a" — the real, searched source is `data/menus.json`
  alone). There is no `dish-result-shape.md`-equivalent contract for a
  restaurant-level summary.
- The existing server-side search layer (`src/services/dishSearch.js`,
  `docs/api/dish-search-ranking.md`) matches dish name, description, tag,
  and restaurant name only — it does not match address or buurt. Address
  filtering exists only as a separate, client-side-only filter on
  `/restaurants`, not as part of the searched/ranked query.
- Deep public routes (`/restaurant/[id]`, `/menu/[id]`) have no
  page-specific "back to results" destination beyond the shared header's
  logo-as-home link — an already-named gap in
  `planning/decisions/014-navigation-and-orientation-standard.md`'s own
  "Known deviations."
- **Dated snapshot (verified 2026-09-13, reproducible via the same
  computation `src/services/coverageMetrics.js` (PLATFORM-01) already
  uses — `withMenuData`/`withoutMenuData`, grouped by
  `Object.keys(menusData).map(k => k.split('-')[0])`): only 4 of Breda's
  25 restaurants had any entry in `data/menus.json` at the time this
  ticket was written; the other 21 had no menu/dish data and no
  `menuLinks` at all.** This is a one-time, dated measurement, not a
  fixed assumption this ticket depends on — re-run the same computation
  to check today's real ratio before relying on it. The underlying
  product rule does not depend on the exact count: as long as *any*
  known restaurant can lack real menu/dish data in
  `data/menus.json` — whether that gap is large today or shrinks
  significantly after future data entry — a restaurant-summary source
  derived from grouping `src/services/dishSearch.js`'s dish-level
  results would still silently exclude it from `Alle restaurants`, the
  opposite of what that name promises. A restaurant counts as having a
  menu only when real menu/dish data exists for it in that source —
  never because a UI element, a planned future intent, or an assumption
  about eventual coverage suggests it should. This is why "Primary
  navigation" and "Technical and accessibility boundaries" below require
  a restaurant-level index as that view's permanent source, never the
  dish index — regardless of how complete menu coverage becomes over
  time.

## Objective

Make the public menu-discovery experience default to a light, search-first
start; group results one card per restaurant instead of one per menu type;
resolve an explicit meal-type intent directly to the right existing menu
route; and resolve a general search/filter intent to either a single
matching menu or a short, honest choice among matches — never a guess.
Replace the existing `Restaurants`/`Menukaarten` primary navigation with
two permanent, text-only destinations — `Zoeken` and `Alle restaurants` —
so the top-level choice itself is self-explanatory before a visitor ever
clicks; see "Primary navigation" below for the full decision and
rationale.

## User story

As a visitor who doesn't yet know exactly what they want, I want a light
start that either lets me search directly or lets me deliberately browse
all restaurants — and once I've searched or picked a meal type, I want to
see one clear card per restaurant (not several near-identical ones), with
a primary action that takes me exactly where its label says it will, so I
never have to guess which of several similar-looking results actually
leads where I want to go.

## Non-goals (explicitly out of scope for this ticket)

- **No change to underlying routes, deep links, or search-engine-indexed
  URLs.** This is a navigation-label and active-state decision, not a
  route rebuild — `/restaurants`, `/search`, `/menu/[id]`, and
  `/restaurant/[id]` all keep their exact current paths; see "Primary
  navigation" below for what does change (the header labels and which
  destination is marked active).
- **No removal of `/restaurants` or its guided browsing flow.** This
  ticket changes its "Menukaarten" mode's result grouping (one card per
  restaurant) and adds a lighter default search start elsewhere — it does
  not replace or delete the existing guided flow.
- **No new sort value, ranking signal, price/allergen filter logic, or
  visual redesign** of colors, typography, or components beyond what
  grouping/navigation requires. Reuses existing tokens, card shapes, and
  button styles exactly.
- **No `Daghap vandaag`/`Dagmenu vandaag`/"Specialiteit" feature.** See
  "Daghap — explicitly out of scope" below.
- **No change to menu content, allergen data, source/provenance,
  moderation, publication, or authorization.** This is a presentation and
  query-shape ticket only — it reads the same underlying data, never
  changes what that data means or how it's governed
  (`docs/api/data-trust-model.md`, `MARKET-02B` remain untouched).
- **No migration, database, or API contract change beyond the
  address/buurt search extension named explicitly in "Technical and
  accessibility boundaries" below** — and even that extension is *named
  as required here*, not designed or implemented by this ticket.
- **No mockup-to-production wiring.** The static prototype this ticket
  also produces governs layout/interaction logic only — see "Mockup
  boundary."

## Primary navigation

**Decided (this ticket, superseding the earlier `Restaurants`/
`Menukaarten` draft): two permanent, text-only destinations — `Zoeken`
and `Alle restaurants`.** Neither carries an icon — no emoji, no new SVG
— plain text labels only, matching the already-shipped
`ThemeToggle`/`.theme-switch` precedent. Both stay visible, including on
mobile, per decision 014 item 5 (mobile never drops a route or action
that exists on desktop), and the active destination stays unambiguous
both visually and programmatically (`aria-current="page"`), per decision
014 item 2.

**First slice scope, built (`src/components/PrimaryNav.js`):** `PrimaryNav`
is mounted only on `/search` and `/alle-restaurants` — the two pages that
actually need it as a tab. The homepage (`/`) is deliberately excluded
for this slice: it already has its own `Restaurants` link to
`/restaurants` (`app/page.js`), and adding the two new tabs there before
that is reconciled would create a third, colliding destination.
`/restaurants` is excluded because its existing mode-switch (`🏠
Restaurants` / `📋 Menukaarten`) is a different, in-page view toggle over
the same dataset, not page-level routing — this ticket does not touch or
replace it. `/restaurant/[id]`, `/menu/[id]`, and `/nvwa/[id]` remain
excluded for the same reason detail pages are below (neither tab is
ever current there) — they keep their own existing, page-specific
back-link as the sole orientation mechanism, unchanged. Widening
`PrimaryNav` to any of these routes is future work, not decided here.

- **`Zoeken`** is the default, standard route for a dish query, an
  explicit meal-type filter (`Lunch`/`Diner`/`Borrel`/`Ontbijt`/
  `Specialiteiten`), a restaurant-name query, and — once Fase 2 ships —
  an address/buurt query. `Zoeken` is marked active for every one of
  these: the empty search start, a dish/name query, a meal-type filter,
  and any resulting list of matches.
- **`Alle restaurants`** is the deliberate browse route for a visitor who
  wants to see every restaurant, independent of any search or filter
  intent. It is marked active **only** on that dedicated browse view —
  never on a `Zoeken`-driven result, even one that happens to list every
  restaurant (e.g. an empty query).
- **`Alle restaurants` means literally every known restaurant matching
  only restaurant-level filters** (cuisine, buurt, day, "now open",
  indicative price level) — **never a byproduct of dish/menu search.** A
  restaurant must never disappear from this browse view solely because
  it has no menu/dish data yet (see "Problem" for the dated 4-of-25
  coverage snapshot — a one-time measurement, not a number this rule
  depends on). Deriving `Alle restaurants` from a grouping of
  `src/services/dishSearch.js` results is explicitly rejected: its
  source must be a light, server-side restaurant-level index built from
  `data/restaurants.json`, never the dish index. The exact endpoint/
  route form of that index is *not* decided by this ticket — see "Open
  technical questions"; this ticket approves no specific API or route.
- **`Menukaarten` is not a primary destination.** Menu content is
  presentation *within* `Zoeken` results and within `/restaurant/[id]`'s
  own menu-preview section, reached via a restaurant card's primary
  action — never via its own top-level tab.
- **Detail pages mark neither tab active.** `/restaurant/[id]` and
  `/menu/[id]` are not, in truth, either `Zoeken` or `Alle restaurants` —
  forcing one to look current would misrepresent where the visitor is.
  This matches the W3C WAI-ARIA `aria-current` definition itself
  (authors should mark only the element that *is* current; if the
  current page isn't represented by a link in the set at all, marking
  none is correct) — these pages instead get an explicit, page-specific
  "back to results" link (see "Technical and accessibility boundaries"
  and Fase 3), which carries the orientation responsibility here, not a
  falsely-active tab.
- **No duplicate `Bekijk alle restaurants` action.** Because
  `Alle restaurants` is itself now a permanent, always-visible tab, the
  light search start needs no separate text reference or button pointing
  at it — this removes the earlier draft's "quiet text reference"
  entirely, rather than merely keeping it unobtrusive.
- **Filter continuity between `Zoeken` and `Alle restaurants`**: only
  filter context meaningful on *both* destinations carries over when
  switching (e.g. day, "now open", cuisine, price, buurt). A
  `Zoeken`-specific meal-type intent is never silently reinterpreted when
  switching to `Alle restaurants` — it is either preserved verbatim (if
  meaningful there too) or explicitly cleared, never carried over in a
  way that could imply an incorrect meaning.
- **Secondary settings (theme, language) never compete with `Zoeken`/
  `Alle restaurants` for space or visual weight.** On narrow viewports
  they wrap beneath the primary tabs (the existing, already-shipped
  `.header-right` `flex-wrap` treatment, per decision 014 item 5); on
  desktop they sit visually and logically separate from the primary
  navigation group, never interleaved with it.

## Desired behavior

### 1. Default — no active search or meal intent

- A light search start with one search bar:
  `Zoek op gerecht, restaurant of adres`.
- No large default restaurant-card list and no full menu content loaded
  by default — see "Technical and accessibility boundaries."
- The start is never dead or empty: a short explanatory line, the search
  field itself, and the quick meal-type chips are the minimum required
  next step, per decision 014 item 8 — no separate text reference to
  `Alle restaurants` is needed, since it is already a permanent, visible
  tab (see "Primary navigation").

### 2. After an explicit choice or search action

- One result card per restaurant, never one per menu type.
- **A restaurant summary card shows only**: name, cuisine, an optional
  indicative price level (`€`/`€€`/`€€€`, appended to the cuisine line —
  see below for the full rule), a compact address or buurt, an optional
  short open/closed status, the available menu types (as information, not
  as a second row of competing actions — see below), and exactly one
  primary action. Nothing else.
- **No long marketing description** on this card — a short cuisine label
  only (e.g. `Modern Frans · Grand Café`), never a multi-sentence
  restaurant blurb. A full description belongs on `/restaurant/[id]`.
- **No reservation, phone, chat, website, or other contact/secondary
  action** of any kind (button, icon, or link) on this card — those stay
  on `/restaurant/[id]`, never duplicated here.
- **Michelin-/quality information, if shown at all, is at most a compact
  text label** (e.g. `Michelin-vermeld`) — never a dominant badge, star
  icon, colored box, or other decoration competing with the card's actual
  content. Full, expanded badges belong on `/restaurant/[id]`.
- **An optional, compact price level (`€`/`€€`/`€€€`) may be appended to
  the existing cuisine line** (e.g. `Modern Frans · Grand Café · €€`) —
  never a new row, badge, colored accent, button, filter, sort, or
  ranking input. It is an **indicative price level, never an exact
  price, a freshness claim, or a verified/trust claim** — the same
  presentational-only caveat as the Michelin-/quality label above, and
  for the same reason: `docs/api/data-trust-model.md` names "Price" as a
  field with no source/confidence model yet.
  - Shown on **every** card that has a real, present price-level value —
    independent of whether a price filter is currently active. It is a
    static restaurant attribute, like cuisine, not a filter-context
    highlight like an active-intent menu-type pill.
  - **Never a fallback or invented default** when the value is missing —
    the segment is simply omitted for that card, exactly like the
    quality label above. Do not reuse the existing
    `getPriceLevel()`-style `|| 2` fallback pattern that
    `app/restaurants/page.js` uses today for filtering — that pattern is
    explicitly not acceptable for display.
  - **Accessible name requirement (a result, not a specific markup
    mandate here — see the prototype for one concrete implementation):**
    a screen reader must announce the cuisine text plus an indicative
    price-level description (e.g. "Modern Frans · Grand Café, prijsniveau:
    gemiddeld") **exactly once** — never the bare `€€` glyph read
    literally (e.g. as repeated "euro" tokens), never both the glyph and
    a separate description announced together, and never at the cost of
    the surrounding cuisine text becoming inaccessible. `aria-label` on a
    plain, non-interactive text node is **not** a reliable way to achieve
    this — screen reader support for `aria-label` is inconsistent outside
    interactive elements, widgets, landmarks, and images; a visually
    hidden text alternative paired with `aria-hidden` on the visible
    glyph is the dependable pattern, demonstrated in the prototype.
- Available menu types and their count shown as information on the card
  (e.g. `Lunch · Diner · Borrel · Specialiteiten`) — plain, non-interactive
  labels, not buttons or links; see §3 for when one is marked as the
  active intent.
- Without a specific menu-type intent, the primary action opens an
  overview, e.g. `Bekijk 4 menukaarten` — never a guess at which single
  menu the visitor wants.
- **A restaurant with no menu/dish data at all still gets its own card,
  on `Alle restaurants`, with the same allowed base fields as any other**
  (name, cuisine, optional indicative price level, compact address/buurt,
  optional short open/closed status) — it simply has no menu types to
  list. Its one primary action is honestly labelled `Bekijk restaurant`
  and conceptually leads to `/restaurant/[id]` — **never** `Bekijk menu`,
  `Open lunchkaart`, or any other menu-specific promise this card cannot
  keep. This card is never silently omitted, and never given a fallback
  or invented menu-type row.
- **Result-count copy is a full sentence, not a bare label**: e.g.
  `4 restaurants gevonden`, never only a bare, all-caps category heading
  (`4 RESTAURANTS`) with no readable count sentence anywhere on the page.
  On `Alle restaurants`, this count includes restaurants with no menu
  data — it is a count of matching restaurants, not of matching menus.

### 3. Explicit meal-type intent

- Given `Lunch`, `Diner`, `Borrel`, `Ontbijt`, or `Specialiteiten`, the
  primary action opens the matching **existing** menu route directly
  (`/menu/[id]`, unchanged).
- The button text honestly names the destination, e.g. `Open lunchkaart`
  — never a generic `Bekijken` when the destination is already known.
- **The whole card and its primary action never point at different
  destinations.** If the card as a whole is also clickable, it resolves
  to exactly the same place the primary action button does.
- **No competing second action.** A card never shows a separate
  menu-type button next to a second, generic `Bekijk menu` button — that
  is two competing steps toward the same place. Exactly one primary
  action per card, always.
- **No nested links.** If the whole card is clickable, it contains no
  second click target of any kind; if it is not, only the primary action
  itself is clickable — never both a whole-card link and an inner link or
  button pointing elsewhere.

### 4. General search/filter intent

- For dish text, allergen exclusion, price, date, or another general
  filter:
  - **exactly one matching menu** → opens directly, with honest button
    text (e.g. `Open lunchkaart`);
  - **more than one matching menu, across different restaurants** → a
    short, explicit choice naming each restaurant and menu type — never
    a guess at which one the visitor meant;
  - **more than one matching menu within the same restaurant** → that
    restaurant's card shows one primary action restricted to only the
    matching menus, e.g. `Bekijk 2 passende menukaarten` — never the
    card's full, unfiltered `Bekijk N menukaarten` count, and never a
    second action next to it.
  - These two "more than one matching menu" cases are distinct and must
    not be conflated: the first names restaurants explicitly because the
    matches are spread across them; the second stays a single card
    because the matches are within one restaurant.
  - Result-count copy above these results follows the same full-sentence
    rule as §2 (e.g. `2 restaurants gevonden`), stated for whichever of
    the above cases actually applies.

### 5. Filters

- The fast, always-visible filter row stays compact — e.g. `Lunch`,
  `Diner`, `Borrel`.
- Less frequent types (`Ontbijt`, `Specialiteiten`) remain reachable via
  `Filters`/`Alle menutypen`, never removed, only tucked one step deeper.
- Available types and their counts are derived from the real, current
  data (`data/menus.json`'s actual keys per restaurant) — never
  hardcoded, so a future menu-type addition or removal is reflected
  automatically.

### 6. Technical and accessibility boundaries

- **A lightweight restaurant-summary data shape is a precondition, not an
  implementation detail decided here.** It must not use the full legacy
  `menus` blob embedded in `data/restaurants.json`, and must not require
  fetching `data/menus.json`'s full content just to render a summary card
  — see "Open technical questions" for what remains undecided about its
  exact shape/source.
- **`Alle restaurants` and `Zoeken` use different data sources for
  filtering, not just different default states of one query:**
  - `Alle restaurants` (no dish/menu-content intent) filters only on
    restaurant-level attributes — cuisine, buurt, day, "now open",
    indicative price level — evaluated against the full restaurant
    catalog (`data/restaurants.json`), independent of whether a
    restaurant has any menu/dish data at all.
  - `Zoeken` with a dish/ingredient text query, an explicit meal-type
    intent, or an allergen exclusion filters on actual menu/dish content
    (the existing `src/services/dishSearch.js` index) — a restaurant
    with no matching (or no) menu content legitimately does not appear
    in these results. This is correct, expected behavior, not a defect.
  - A dish/menu-dependent result set must never be presented under the
    `Alle restaurants` name or its active navigation state — that name
    promises the full restaurant catalog, not "restaurants with a
    searchable menu."
  - Result-count copy for a pure `Alle restaurants` browse counts every
    restaurant matching the restaurant-level filters, including those
    with no menu/dish data — never only those with searchable menu
    content.
- **The future restaurant-level index may return only an explicit,
  whitelisted light restaurant shape** — a `dish-result-shape.md`-
  equivalent contract naming its exact fields is implied but not written
  or approved by this ticket. It must never include full menu content or
  the legacy embedded `menus` blob from `data/restaurants.json`.
- **Restaurant-level filter predicates that already exist in more than
  one place today** (`searchDishes()`'s own filter step and
  `computeLowCoverageSignal()`, both in `src/services/dishSearch.js`)
  should eventually be consolidated into one shared function once the
  restaurant-level index is built, so the two never silently diverge —
  named here as a real, future need. This ticket does not design or
  implement that refactor.
- **Pagination is part of the future restaurant-index contract, not an
  optional later addition** — even though Breda's current 25-restaurant
  catalog is small enough that "return all" would work today, the
  contract itself must not assume that stays true (this project's own
  multi-city ambition, per `CLAUDE.md`, means a future city's catalog
  will not be this small).
- **Address/buurt search is a real, future server-side search extension**
  (`src/services/dishSearch.js`/`app/api/search/route.js`), not a
  client-side text-matching shortcut. This ticket names the requirement;
  it does not design the matching algorithm.
- Existing individual menu routes and deep links (`/menu/[id]`,
  `/restaurant/[id]`) are preserved exactly — no route renamed, removed,
  or restructured.
- No change to menu content, allergen data, source/provenance,
  moderation, publication, or authorization (restated from "Non-goals"
  for emphasis, since this is the section a future implementer will check
  against first).
- Applies `planning/decisions/014-navigation-and-orientation-standard.md`
  in full: visible keyboard focus (`:focus-visible`, a known project-wide
  gap this ticket must not add to), no horizontal overflow at
  approximately 390px, logical keyboard operability, and — closing a
  named existing gap — an explicit, page-specific "back to results" link
  on `/restaurant/[id]`/`/menu/[id]`, not only the shared header's
  logo-as-home link.
- **The cuisine line (including an appended price level, if shown) wraps
  naturally at approximately 390px** — exactly like the existing,
  unmodified cuisine text does today; no truncation, no ellipsis, and the
  price level itself is never silently hidden at narrow widths. The price
  glyph (`€`/`€€`/`€€€`) never breaks internally across two lines — a
  wrap point may occur before it, never inside it.

## Daghap — explicitly out of scope

`Daghap vandaag`/`Dagmenu vandaag` is **not** part of this ticket, in any
form. It has already been named and deliberately deferred twice before
(`be-09-consumer-ux-polish.md`, `be-10-results-sort-card-hierarchy-mobile.md`,
both listing it under "Out of scope"). Before any prominent public display
of a "today"-scoped dish or price, a **separate, later product ticket**
must first establish: a demonstrable source (`SourceReference`-equivalent),
an explicit freshness/verification status
(`docs/api/data-trust-model.md`'s existing `source`/`confidence`/
`verifiedAt` shape), and an explicit validity window (a
`schema.org Offer.availabilityStarts`/`availabilityEnds`-style pattern is
a reasonable external precedent, not a decision made here) — so that a
"today" item is never shown as still valid after its own validity date has
passed. This ticket does not design, name a data source for, or authorize
building any part of that feature.

## User flow

1. Visitor lands on the light search start (default state).
2. Visitor either types a query, picks a quick meal-type chip, or
   deliberately chooses the `Alle restaurants` tab to browse everything.
3. Results render as one card per restaurant, annotated with available
   menu types and counts.
4. Visitor either has an explicit meal-type intent (card's primary action
   opens that exact menu) or a general intent (card's primary action
   opens the single match, or a short list restricted to matches).
5. From a menu or restaurant detail page, an explicit "back to results"
   link returns the visitor to where they came from — never only the
   browser's own history or the header logo.

## Information architecture

Two levels of disclosure, never three, per the same "more than two levels
loses people" principle already guiding this project's other UI work:

1. **Restaurant summary** (search result / `Alle restaurants` overview
   card) — identity, available menu types, counts, primary action.
2. **Full menu** (`/menu/[id]`, unchanged) — reached either directly (one
   clear destination) or via one short, explicit intermediate choice
   (multiple destinations) — never a third, deeper level.

## Mobile approach

Mobile-first, ~390px as the primary reference width, per this project's
existing mockup convention. No route or action available on desktop is
removed on mobile (decision 014 item 5) — the primary navigation, the
search bar, and every card's primary action remain present and reachable
without horizontal overflow. The static prototype additionally
demonstrates a real, responsive desktop layout (~1280px) using the same
information architecture and visual language as mobile — not a
mobile-only frame floating in unused space — see "Mockup boundary."

## Performance approach

Stays inside the existing consumer performance budget
(`planning/decisions/009-consumer-vs-internal-performance-budget.md`,
inheriting `003-performance-budget.md`'s `<250 KB`/no-full-dataset
principles): the default search start loads neither a full restaurant
list nor any menu content; a restaurant-summary shape (once defined) is
the only additional data loaded before an explicit search, filter, or
`Alle restaurants`/menu-type action — mirroring exactly the reasoning
`planning/decisions/007-homepage-shift.md` already used to make `/`
dramatically lighter than `/restaurants`.

## Risks

- **The lightweight restaurant-summary shape gets skipped under
  implementation pressure**, and a "light" card silently re-imports the
  full legacy menu blob — mitigated by naming this explicitly as a
  precondition in "Technical and accessibility boundaries," not an
  optional nicety.
- **Address/buurt search is implemented as a client-side shortcut**
  instead of a real server-side extension — explicitly named as
  unacceptable in "Technical and accessibility boundaries."
- **Filter-context confusion when switching `Zoeken` ↔
  `Alle restaurants`** — a meal-type filter silently misapplied on the
  other route — mitigated by the explicit carry-over rule in "Primary
  navigation."
- **Users who knew the old `Restaurants`/`Menukaarten` split need a brief
  relearning moment** — mitigated by the stronger information scent of
  the new labels themselves (see "Primary navigation") and by the fact
  that no underlying route changes, so nothing a returning visitor
  bookmarked or shared breaks.
- **Scope creep toward `Daghap`** during implementation, since it's an
  adjacent, already-desired idea — mitigated by the explicit,
  standalone "Daghap — explicitly out of scope" section above.
- **Card/action destination mismatch** (the whole card links somewhere
  different from its own primary button) — explicitly named as a hard
  rule in "Explicit meal-type intent" above, not left to implementation
  judgment.
- **The two "more than one matching menu" subcases get conflated during
  implementation** (a same-restaurant restricted overview built as if it
  were a cross-restaurant choice, or vice versa) — mitigated by naming
  both explicitly, with distinct example copy, in "Desired behavior" §4.
- **A browse/summary card quietly grows a contact or reservation
  shortcut** (phone, chat, website, "reserveer") because it already
  exists on the detail page and seems convenient to surface earlier —
  explicitly forbidden in §2, since it competes with the card's one
  primary action and duplicates content that belongs on
  `/restaurant/[id]`.
- **The price-level segment reuses `app/restaurants/page.js`'s existing
  `getPriceLevel()` `|| 2` fallback** during implementation, silently
  showing "gemiddeld" for a restaurant with no real price-level data —
  explicitly forbidden in §2; the segment must be omitted entirely when
  the value is absent.
- **The price-level segment is implemented with `aria-label` on a plain
  `<span>`**, matching this project's own existing (but different)
  `aria-label`-on-`<button>` precedent (e.g. `filter-tag-remove`) without
  noticing the accessible-name reliability gap between interactive and
  non-interactive elements — mitigated by naming the correct pattern
  explicitly in §2 and demonstrating it concretely in the prototype.
- **`Alle restaurants` gets implemented as a grouping of
  `src/services/dishSearch.js` results** instead of a restaurant-level
  index — would silently reduce the browse view to only whichever
  restaurants happen to have real menu/dish data at any given time (a
  dated snapshot found 4 of 25 at the time this ticket was written, see
  "Problem" — not a number this risk depends on), defeating the tab's
  own name regardless of how that ratio changes over time. Explicitly
  rejected in "Primary navigation" and "Technical and accessibility
  boundaries."

## Open technical questions (explicitly not decided here)

- **Exact shape and source of the lightweight restaurant-summary
  index** — a new static export, a new server-side endpoint, or a
  slimmed client-side projection are all still open. What is *not* open
  (see "Primary navigation" and "Technical and accessibility
  boundaries") is that its source must be restaurant-level data
  (`data/restaurants.json`), never a grouping of
  `src/services/dishSearch.js`'s dish-level results. A
  `dish-result-shape.md`-equivalent contract — its exact field
  whitelist, its pagination shape, and whether/how the restaurant-level
  filter predicates that today exist independently in both
  `searchDishes()`'s own filter step and `computeLowCoverageSignal()`
  get consolidated — is implied but not written or approved by this
  ticket. This ticket approves no specific API or route for it.
- Exact address/buurt matching algorithm and where it sits in
  `docs/api/dish-search-ranking.md`'s existing tier system.
- Exact copy/threshold for "a short, clear choice" vs. "an overview
  restricted to matches" when multiple menus match a general query.
- Whether the existing `/restaurants` "Menukaarten" mode is restructured
  in place or a new, separate light-search entry point is added
  alongside it — this ticket specifies the required *behavior*, not the
  exact route topology.
- Exact copy for the page-specific "back to results" link on
  `/restaurant/[id]`/`/menu/[id]` (Fase 3) — the requirement is fixed
  ("Primary navigation"), the exact wording is not.

## Phased delivery — with explicit go/no-go per phase

### Fase 0 — Contract and prototype

This ticket plus the static UX prototype (see "Mockup boundary"). No
implementation without this phase's decisions being explicit.

**Go/no-go**: the restaurant-summary shape's exact source is decided
separately before Fase 1 begins — this ticket only names the requirement.

### Fase 1 — Result grouping and intent-aware primary action

One card per restaurant in existing result surfaces; explicit meal-type
and general-search-intent resolution as described above. No address/buurt
search yet — reuses the existing dish-level search tiers unchanged.

**Go/no-go**: the lightweight restaurant-summary shape exists, is proven
not to ship full menu content by default, and is proven to be sourced
from the restaurant-level index (`data/restaurants.json`), not a
grouping of dish-search results — so restaurants without menu data are
never silently excluded from `Alle restaurants`.

**First vertical slice, implemented:** `GET /api/restaurants` +
`/alle-restaurants` (see "Status" above and
`docs/api/restaurant-summary-shape.md`) prove the go/no-go condition
above against real data — one card per restaurant, `hasMenu`-aware
primary action, restaurant id `10`'s placeholder address correctly
excluded and never shown. **Still open within Fase 1**, not yet built:
wiring `/alle-restaurants` into primary navigation (a separate,
shared-header decision); cuisine/buurt-exact/day/"now open" filters on
this endpoint; explicit meal-type intent (`Open lunchkaart`, requires a
`meal` parameter this endpoint doesn't have); the general-search-intent
behaviors in §4 (single match vs. short choice vs. restricted overview) —
this endpoint has no dish-content awareness at all, by design (see
"Technical and accessibility boundaries").

### Fase 2 — Joint dish + restaurant search on `/search`

**Note on this phase's original name:** this phase was originally named
"Address/buurt server-side search extension." That specific capability —
free-text matching against a restaurant's buurt and valid address, not
only its name — was, in the event, already delivered as part of Fase 1's
`GET /api/restaurants` (`getMatchTier()`'s tiers 2 and 3; see
`docs/api/restaurant-summary-shape.md` "Ranking"). What this phase
actually built, once Fase 1 was live, is the joint public search
experience that surfaces that capability to a visitor: `/search` showing
a separate, named restaurant-result group (by name, buurt, or address)
alongside its existing dish results, rather than requiring a visit to the
separate `/alle-restaurants` page to search restaurants at all. This
section is renamed to describe that, rather than leaving a stale
description that reads as not-yet-done for a search capability that
already exists.

**Go/no-go**: Fase 1 is live and stable (met — see "Status").

**Built:**
- `/search` fetches `GET /api/restaurants?q=...` in parallel with its
  existing `GET /api/search` call, gated only on a meaningful (2+
  character) free-text query — never on an empty page, and never merely
  because an existing dish filter (meal/price/cuisine/day/allergen/"nu
  open") is active with no text query.
- Two separate, explicitly named groups — `Gerechten gevonden` and
  `Restaurants gevonden` — are rendered as real `<h2>` headings, never
  merged into one ranked list. Each is shown only when it has results;
  neither ever shows a bare "0 results" block for the other.
- Default order is dishes first. `Restaurants gevonden` is shown first
  only when the query is a whole-word/token match against exactly one
  restaurant's own name (never a buurt or address match, however exact)
  — the full, tested rule lives in `src/services/restaurantIndex.js`'s
  `hasUniqueRestaurantNameMatch()`, exposed as `uniqueNameMatch` on `GET
  /api/restaurants`'s response and documented in `docs/api/restaurant-
  summary-shape.md`. Normally this only ever changes which of the two
  already-visible groups is shown first. In the narrow, explicitly
  documented case where a unique whole-name-token match exists but a
  space/hyphen/`&` difference kept the existing substring search from
  finding it (e.g. the query `T Huis` against the stored name `T-Huis`),
  the rule additionally guarantees that one specific restaurant is
  actually present in `Restaurants gevonden`, not only its ordering —
  it adds no fuzzy, substring, or otherwise unrelated result, only that
  single, exact whole-name-token match. See `docs/api/restaurant-
  summary-shape.md`'s "Name-token match for group ordering" for the full
  contract.
- Honest copy for every combination: both groups empty shows one
  combined "Niets gevonden" message (mentioning dish, restaurant, and
  buurt as real, working search forms); dishes-empty-but-restaurants-
  found says so explicitly instead of showing a bare "Geen gerechten
  gevonden"; restaurants-empty-but-dishes-found never mentions
  restaurants at all. The search field placeholder and the default
  (no-query, no-filter) empty state were updated to mention restaurant
  name and buurt as real search forms — the old "keuken" (cuisine)
  mention in the default empty state was removed in the same edit, since
  free-text cuisine matching does not exist anywhere in this product
  (a pre-existing inaccuracy, not something Fase 2 introduced, corrected
  because this exact sentence was already being touched).
- Heading hierarchy: the page carries a real, visually hidden
  `<h1>Zoeken</h1>`; `Gerechten gevonden`/`Restaurants gevonden` are its
  `<h2>` children; each restaurant name inside a rendered group is a
  correctly nested `<h3>` (via `RestaurantBrowseCard`'s `headingLevel`
  prop); and the page's own "Waar heb je zin in?"/"Er ging iets mis"
  states are `<h2>`, not `<h3>` — no heading-level skip remains anywhere
  on this page. When active dish filters are shown alongside a rendered
  restaurant group, a neutral note states they only apply to dish
  results, since `GET /api/restaurants` has no filter parameters at all.
  When the restaurant group already renders above the dish-empty
  message, that message no longer repeats the restaurant count it
  already made visible.
- `RestaurantBrowseCard` (name, cuisine + accessible price level, one
  primary action, `hasMenu`-aware button text, the `Buurt: X` fallback,
  no contact/reservation/phone/chat/website action) was extracted from
  `/alle-restaurants` into `src/components/RestaurantBrowseCard.js` and
  is now shared, unchanged, by both routes.
- `src/services/dishSearch.js` and `app/api/search/route.js` are
  untouched; `/search`'s existing URL params, filters, and dish ranking
  are unchanged (see `app/search/page.test.js`'s explicit regression
  checks).

**Still open within this phase, not yet built:** wiring a combined
`/search` entry point into primary navigation (see "Open technical
questions"); a restaurant-level price/day/"now open" filter surfaced from
`/search` itself; GPS/distance; free-text cuisine matching.

### Fase 3 — Back-to-results navigation closure

Explicit "back to results" links on `/restaurant/[id]`/`/menu/[id]`,
closing `planning/decisions/014-navigation-and-orientation-standard.md`'s
named deviation.

**Go/no-go**: none — this phase has no data dependency and could, in
practice, ship independently/earlier if convenient.

## Mockup boundary

A static, local HTML/CSS UX prototype exists for this ticket at
`docs/mockups/be-11-menu-discovery-v1.html` — see also
`docs/mockups/README.md`'s standing rule: it clarifies layout, information
hierarchy, and interaction logic only. It is not product code, is not
wired to the application, and does not by itself prove that a
restaurant-summary data contract, a server-side search extension, a route
transfer, or result filtering has actually been built.

**Update — Fase 1 first vertical slice:** the restaurant-summary data
contract, the server-side restaurant-level index, and a real (if
unlinked) route now do exist — see "Status" above. The static prototype
remains the directional reference for the eventual, fully-wired
`Zoeken`/`Alle restaurants` navigation and for behaviors not yet built
(meal-type intent, general-search-intent choices); it does not need to
be updated just because a first real slice now exists alongside it.

## Acceptance criteria

- [ ] The primary navigation shows exactly two permanent, text-only
      destinations, `Zoeken` and `Alle restaurants`, in that order,
      unchanged in position and presence on every viewport, including
      mobile.
- [ ] No emoji or icon of any kind is used for either primary tab.
- [ ] No call-to-action or text reference duplicates what the
      always-visible `Alle restaurants` tab already does.
- [ ] The default search start loads neither a full restaurant list nor
      any menu content.
- [ ] `Zoeken` is marked active for the empty search start, a dish/name
      query, a meal-type filter, and any resulting matches; `Alle
      restaurants` is marked active only on the dedicated browse view —
      never both, never neither, on any of these.
- [ ] Neither tab is marked active on `/restaurant/[id]` or `/menu/[id]`;
      each instead carries an explicit, page-specific "back to results"
      link, not only the header logo.
- [ ] Search results and the `Alle restaurants` browse view show exactly
      one card per restaurant, never one per menu type.
- [ ] `Alle restaurants` is sourced from a restaurant-level index
      (`data/restaurants.json`-equivalent), never from grouping
      dish-search results — every restaurant matching only the
      restaurant-level filters (cuisine, buurt, day, "now open",
      indicative price level) appears, including restaurants with no
      menu/dish data at all.
- [ ] A restaurant with no menu/dish data still gets its own light
      summary card on `Alle restaurants` — it is never silently omitted
      solely because it lacks menu data.
- [ ] A restaurant-without-menu card shows only the same allowed base
      fields as any other summary card (name, cuisine, optional
      indicative price level, compact address/buurt, optional short
      open/closed status) and exactly one primary action, honestly
      labelled `Bekijk restaurant` — never `Bekijk menu`, `Open
      lunchkaart`, or any other menu-specific promise it cannot keep.
- [ ] Result-count copy on a pure `Alle restaurants` browse counts every
      matching restaurant, including those without menu data — never
      only restaurants with searchable menu content.
- [ ] A dish- or menu-dependent result set (an active meal-type intent,
      dish/ingredient query, or allergen exclusion) never appears under
      the `Alle restaurants` name or its active navigation state.
- [ ] A restaurant card shows its available menu types and their count as
      information; no menu-type label is shown as active/selected unless
      that specific intent is actually active.
- [ ] Given an explicit meal-type intent, the primary action opens the
      matching existing menu route directly, with honest button text.
- [ ] A card and its own primary action never resolve to different
      destinations.
- [ ] Given a general search/filter intent with exactly one match, that
      match opens directly; with more than one match, a short, explicit
      choice or a matches-only overview is shown — never a guess.
- [ ] A restaurant summary card shows only name, cuisine, an optional
      indicative price level, a compact address/buurt, an optional short
      open/closed status, available menu types, and exactly one primary
      action — no long description and no reservation/phone/chat/website/
      contact action of any kind.
- [ ] Michelin-/quality information, when present on a summary card, is
      at most a compact text label, never a dominant badge or decoration.
- [ ] A restaurant summary card shows a price level (`€`/`€€`/`€€€`)
      appended to its cuisine line only when that restaurant's real
      price-level data is present — never a fallback or invented default
      when it is missing, and never a separate row, badge, colored
      accent, button, filter, sort, or ranking input.
- [ ] The price level appears on every summary card with real data,
      independent of whether a price filter is currently active.
- [ ] The cuisine line, including an appended price level, wraps
      naturally at approximately 390px exactly like it does today; the
      price glyph itself never breaks internally across two lines.
- [ ] A screen reader announces the cuisine text plus an indicative
      price-level description exactly once — never the bare price glyph
      read literally, never both the glyph and a description announced
      together, and never at the cost of the surrounding cuisine text
      becoming inaccessible; `aria-label` on a plain, non-interactive
      text node is not used for this, since screen reader support for it
      is unreliable outside interactive elements, widgets, landmarks, and
      images.
- [ ] The price level is presented as an indicative price level only —
      never as an exact price, a freshness claim, or a verified/trust
      claim.
- [ ] Result counts are always stated as a full sentence (e.g.
      `4 restaurants gevonden`), never only as a bare, all-caps category
      label.
- [ ] No card shows a competing second action (a separate menu-type
      button next to a generic `Bekijk menu` button) and no card contains
      a nested link — exactly one click target per card.
- [ ] Given more than one matching menu within the same restaurant, that
      restaurant's card shows one action restricted to the matching menus
      only (e.g. `Bekijk 2 passende menukaarten`); this is kept distinct
      from more-than-one-match-across-restaurants, which shows a short,
      explicit choice instead.
- [ ] The fast filter row stays compact; less-frequent menu types remain
      reachable via `Filters`/`Alle menutypen`, never removed.
- [ ] Available menu types/counts are derived from real data, never
      hardcoded.
- [ ] Filter context carries over between `Zoeken` and `Alle restaurants`
      only where meaningful on both; a route-specific filter is never
      silently misapplied on the other.
- [ ] `Daghap vandaag`/`Dagmenu vandaag` is not built, named as a data
      source, or authorized by this ticket in any form.
- [ ] No change to menu content, allergen data, source/provenance,
      moderation, publication, or authorization.
- [ ] Existing individual menu/restaurant routes and deep links are
      unchanged; no URL is renamed, removed, or restructured.
- [ ] No horizontal overflow at approximately 390px or approximately
      1280px; keyboard operability and visible focus verified, per
      decision 014's checklist.
- [ ] Secondary settings (theme, language) never compete with the primary
      tabs for space or visual weight — wrapping beneath them on mobile,
      sitting visually separate on desktop.
- [ ] The static HTML/CSS prototype exists, demonstrates both a mobile
      (~390px) and a responsive desktop (~1280px) layout sharing the same
      information architecture, reuses existing design tokens and
      component patterns, and is referenced from
      `docs/mockups/README.md` as a directional, non-binding reference.

### Fase 2 — joint `/search` acceptance criteria

- [x] `/search`'s existing URL params, filters, and `GET /api/search`
      request are unchanged; `src/services/dishSearch.js` and
      `app/api/search/route.js` are not modified by this phase.
- [x] `GET /api/restaurants` is only queried from `/search` for a
      meaningful (2+ character) free-text query — never on an empty page
      and never merely because an existing dish filter is active with no
      text query.
- [x] Dish and restaurant results are never merged into one ranked list;
      they render as two separately, explicitly headed groups
      (`Gerechten gevonden`, `Restaurants gevonden`).
- [x] Each group is shown only when it has results; neither ever renders
      a bare "0 results" block for the other.
- [x] `Gerechten gevonden` is the default first group; `Restaurants
      gevonden` is shown first only when the query is a whole-word/token
      match against exactly one restaurant's own name, per
      `hasUniqueRestaurantNameMatch()` — never for a buurt or address
      match, however exact, and never derived client-side from a
      paginated result list.
- [x] Group order only ever changes which group renders first; it never
      hides or adds a result in either group.
- [x] Both groups empty for a meaningful query renders one combined
      "Niets gevonden" message, not two separate empty blocks.
- [x] Dishes empty but restaurants found states this explicitly, rather
      than showing an unqualified "Geen gerechten gevonden".
- [x] Restaurants empty but dishes found never mentions restaurants —
      the dish results render exactly as they did before this phase.
- [x] `Restaurants gevonden` reuses the same `RestaurantBrowseCard` as
      `/alle-restaurants` (one primary action, `hasMenu`-aware button
      text, accessible price level, the `Buurt: X` fallback, no contact/
      reservation/phone/chat/website action) — no separate, duplicated
      card implementation.
- [x] No horizontal overflow at ~390px or ~1280px on `/search` for a
      dish-only, restaurant-only, both-groups, and both-empty query,
      verified against a local production build.
- [x] No GPS/distance, restaurant-level price/day/"now open" filter, or
      free-text cuisine matching is introduced by this phase.

## Release boundary and rollback

- The eventual product implementation of this navigation decision must be
  shippable as a **separate, UI-only change** — never bundled with a
  data, route, or authorization change.
- Existing routes and deep links (`/restaurants`, `/search`, `/menu/[id]`,
  `/restaurant/[id]`) are unaffected; nothing in this ticket requires or
  implies a URL change.
- No data migration, publication, source, allergen, or authorization
  change is part of this UX delivery, ever — restated once more here
  because it is the specific boundary a rollback decision needs to trust.
- Before this ships live, a visual and functional comparison against the
  current experience, on both mobile (~390px) and desktop (~1280px), is
  required.
- If the new navigation does not hold up in that comparison, it must be
  revertible as an isolated UI change — a header/navigation-component-level
  revert, never a data or route rollback.

## Suggested order

An independent extension of the closed `BE-*` track, following `BE-10` —
not part of the `PLATFORM-*`/`MARKET-*` tracks and not blocked by either.
Not planned; pickupable once the restaurant-summary data shape (Fase 0's
own open question) has its own, separate design decision.
