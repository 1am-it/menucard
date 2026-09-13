# BE-11 — Public Menu Discovery and Intent-Aware Results

## Status

Proposed, **not started**. Documentation/planning only — no code, route,
data, test, or deploy action exists yet for anything described here.

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
this ticket's address/buurt matching extends). Reads, but does not modify:
`app/restaurants/page.js`, `app/page.js`, `app/search/page.js`,
`app/restaurant/[id]/RestaurantDetailView.js`, `app/menu/[id]/MenuView.js`,
`data/restaurants.json`, `data/menus.json`.

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
- **Result-count copy is a full sentence, not a bare label**: e.g.
  `4 restaurants gevonden`, never only a bare, all-caps category heading
  (`4 RESTAURANTS`) with no readable count sentence anywhere on the page.

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

## Open technical questions (explicitly not decided here)

- Exact shape and source of the lightweight restaurant-summary data (a
  new static export, a new server-side endpoint, or a slimmed client-side
  projection) — a `dish-result-shape.md`-equivalent contract is implied
  but not written by this ticket.
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

**Go/no-go**: the lightweight restaurant-summary shape exists and is
proven not to ship full menu content by default.

### Fase 2 — Address/buurt server-side search extension

The named, real server-side search extension.

**Go/no-go**: Fase 1 is live and stable; the exact matching algorithm has
its own, separate design decision.

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
