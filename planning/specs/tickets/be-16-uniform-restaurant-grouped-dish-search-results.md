# BE-16 — Uniform Restaurant Grouping for Dish Search Results

## Status

Done — **implemented, pushed, and verified live.** The presentation
revision was built and committed in
`447ecfe27832fc6f1c058f5cc22a114c33b563f3` (code) on top of this
ticket's own documentation commit `04acfbe35c67f0e5a609236af8d9f3adc0763ede`
(both already pushed to `origin/main`). The automatic Vercel deploy for
the code commit completed successfully on `2026-09-19`.

Production verification against `https://menucard-kappa.vercel.app`, on
`2026-09-19`, confirmed: `q=brood` renders four restaurant groups
(Brasserie Bardot, Restaurant Zuyd, T-Huis, Restaurant Wolfslaar) summing
to 24 gerechten, with no separate leftover-individual-results section
anywhere on the page; `q=friet` renders one restaurant group (T-Huis)
with two uniform menu subgroups (Dinerkaart 8, Lunchkaart 4, correctly
showing `+5 meer`/`+1 meer`); `q=kip` renders three restaurant groups
summing to 11 gerechten, with no incorrect low-coverage note; `q=Höpler`
shows Wit, Rood, and Rosé as three separately recognizable, clickable
examples within one Borrelkaart subgroup, and clicking "Rood" produces
exactly one correct highlight, the right category, an accurate
`aria-live` announcement, and visible keyboard focus that persists
independently of the highlight; a primary group action opens the
filtered menu with only `q`/`fromQuery` in its URL and zero highlights;
a secondary example click was independently confirmed across a 1-match
subgroup (Borrelkaart's "Brood & Boter"), a 3-match subgroup (Höpler's
"Rood"), and one of a >3-match subgroup's shown examples (Dinerkaart's
"Desem stokbrood") — each produced exactly one highlight and a correct
announcement; the highlight remained visible well past BE-12's old
2750ms mark and was gone by the expected ~4000ms window, with focus
remaining on a real element throughout; `q=Chablis` showed the restored,
honest `· Gevonden in aanvullende menudetails` hint on all six relevant
wine-only examples, while `q=Bardot`'s visible description match showed
no hint; a direct call to the live `/api/search?group=restaurant`
endpoint confirmed every example object contains only
`dishId`/`name`/`category`/`weakMatch` (no internal wine/supplement
data), that an absent/unrecognized `group` value still returns the exact
pre-existing ungrouped response, and that restaurant-level pagination
(`limit`/`cursor`) never splits a restaurant's own menu subgroups across
two pages. All routes were checked at both `390px` and `1280px`, in both
light and dark themes, with no horizontal overflow and no console
errors. Targeted tests, the full project test suite, and `npm run build`
all pass locally on the exact pushed commit.

This ticket does not build, and does not claim to have built, `BE-12`'s
own validation/highlight mechanism beyond the one deliberate `4000`ms
duration change, any multi-city/`MARKET-*` work, any rebranding/domain
change, or any `PLATFORM-12` work — all remain exactly as scoped in
"Non-goals" below, unaffected by this status update.

## Depends on

`planning/specs/tickets/be-15-group-broad-dish-search-results.md` — BE-15
itself is not reopened and stays intact as the delivered technical base
this ticket builds on: server-side aggregation before pagination, the
`group=restaurant` additive response-shape flag (unknown/absent falls
back to the default, ungrouped response), restaurant-level pagination
(`total`/`nextCursor`/`hasMore` counting restaurant groups, reusing
`DEFAULT_LIMIT`/`MAX_LIMIT`), and the `lowCoverage` independence rule are
all reused verbatim. BE-15's own code is real and live: implemented and
pushed in commit `81b4df2c37c9ec7c49b11fa5308c3559e44df908`
(`src/services/dishSearch.js`, `app/api/search/route.js`,
`app/search/page.js`, `app/globals.css` — verified against the actual,
current source, not assumed); live/production verification for that
commit was still pending as of the last check in this session — re-verify
before starting this ticket's own implementation. This ticket revises
exactly one thing BE-15 shipped: the presentation rule that currently
decides whether a restaurant appears grouped at all.

`planning/specs/tickets/be-12-dish-result-deep-link-scroll-highlight.md`
— the exact-dish deep link (`dish`/`name`/`cat`/`fromQuery`,
`resolveDishTarget()` in `src/lib/dishDeepLink.js`, and the
scroll/focus/highlight/`aria-live` effect in
`app/menu/[id]/MenuView.js`) this ticket reuses, unmodified except for
the one explicit exception named in "Non-goals" below (the highlight's
own visible duration). Verified against the actual, current
`MenuView.js`: the effect is keyed only on `[dishTarget]`
(`app/menu/[id]/MenuView.js`), never on `?q=`, and its temporary
highlight is removed via
`setTimeout(() => setShowPulse(false), 2750)` — **today's real duration
is 2750ms (~2.75s), not the 4s this ticket decides on below** — see
"Decided presentation model (2026-09-19)" point 8.

## Problem

BE-15 shipped a threshold hybrid: a restaurant is shown as one grouped
card only when at least one of its menus reaches 4 or more matches;
every restaurant below that line still renders as a wall of individual,
near-identical dish cards, exactly the clutter BE-15 itself set out to
remove. Real, verified fixture (`q=brood`, checked 2026-09-19): T-Huis
renders as one clean, three-subgroup group, while Brasserie Bardot (6
dishes across two menus), Restaurant Zuyd (4 dishes across two menus),
and Restaurant Wolfslaar (1 dish) all still render as 11 separate flat
cards on the very same results page. A visitor sees two structurally
different card types for what is, from their point of view, the same
kind of result — "a restaurant that has dishes matching my search" —
and the difference (a restaurant-internal match count crossing an
invisible "4") is not something a visitor can perceive or predict. This
gets worse, not better, as menu-data coverage grows: today only 4 of
Breda's 25 restaurants have any digitized menu (unchanged since BE-15,
re-verified 2026-09-19), so a broad query typically triggers this exact
inconsistency (one restaurant qualifies, two or three others don't) far
more often than it produces either a fully-grouped or fully-flat page —
the mixed case is the common case, not an edge case.

## User story

As a visitor who searches a common ingredient or dish name, I want every
restaurant with a matching dish to look and behave the same way in the
results — grouped by restaurant and menu, with a short, honest summary
and a clear way to see everything on that restaurant's actual menu —
regardless of whether that restaurant has one match or fifty, so the
page reads as one consistent list of restaurants, not two different
kinds of cards stitched together.

## Decided presentation model (2026-09-19)

**Always one restaurant group per restaurant with at least one match; no
separate, second section for leftover individual dishes.** This directly
supersedes BE-15's own qualifying-threshold rule for *whether a
restaurant is grouped at all* — see "Non-goals" for what this does not
touch.

1. **Every restaurant with ≥1 matching dish is always exactly one
   restaurant group** — never a flat individual card, regardless of how
   few matches it has. A restaurant with a single match still gets its
   own group.
2. **Every one of that restaurant's relevant menus (≥1 match) is always
   the same menu-subgroup form** — there is no separate "this menu is
   small enough to list individually" rendering and no separate "this
   menu is large enough to summarize" rendering. One shape, always.
3. **There is no second, separate section of leftover individual dish
   cards next to the restaurant groups.** Every matching dish lives
   inside exactly one menu subgroup of exactly one restaurant group —
   BE-15's own "Gerechten gevonden" section (already scoped to
   non-qualifying dishes) is retired entirely by this ticket, not kept
   alongside the grouped section.
4. **Every menu-subgroup always shows, in this exact form:**
   - the menu-card name (`Dinerkaart`/`Lunchkaart`/`Borrelkaart`/
     `Specialiteiten`, the existing menu-card title strings already
     shown on `/menu/[id]` itself — not the shorter `Diner`/`Lunch`/
     `Borrel` label used elsewhere on this same page for a dish row's
     own context line);
   - the total match count for that menu, as a full sentence (`7
     gerechten`, `1 gerecht` for the singular);
   - up to three example dish names, in the existing tier/tie-break
     relevance order already returned by the ranking — never re-sorted,
     never alphabetical;
   - when the menu has more than three matches, a trailing `+N meer`
     immediately after the third example, where `N` is the exact
     remainder (`count - 3`) — never shown when `count <= 3`;
   - exactly one primary action, honestly labelled `Bekijk alle X
     gerechten op de kaart →` (singular: `Bekijk alle 1 gerecht op de
     kaart →`), where `X` is the same total match count.

   Worked example, taken literally from the real `q=brood` fixture
   (T-Huis, `23-diner`=7, `23-lunch`=5, `23-borrel`=1 — see "Real data
   fixtures" below):

   ```text
   T-Huis · 13 gerechten

   Dinerkaart · 7 gerechten
   Biefstukje met Friet · Frietjes & Snacks · Kids Burger +4
   Bekijk alle 7 gerechten op de kaart →

   Lunchkaart · 5 gerechten
   Biefstukje met Friet · Frietjes & Snacks · Kids Burger +2
   Bekijk alle 5 gerechten op de kaart →

   Borrelkaart · 1 gerecht
   Brood & Boter
   Bekijk alle 1 gerecht op de kaart →
   ```

   (The restaurant-level `T-Huis · 13 gerechten` line is the group's own
   heading/summary — `13` is the sum of that restaurant's own subgroup
   counts, 7+5+1, computed the same way the existing acceptance criteria
   already check this sum for the whole page.)

5. **The primary action always opens the filtered menu using only the
   existing, already-safe search context** — `?q=` + `fromQuery`, built
   via `URLSearchParams`, targeting that specific menu's own route
   (`/menu/{restaurantId}-{mealType}`). No new query parameter, no new
   route — reuses exactly BE-15's already-built `buildGroupMenuHref()`
   mechanism unchanged.
6. **The primary action never sets `dish`, `name`, or `cat`**, so
   `resolveDishTarget()` always returns `null` for it and the filtered
   menu it opens never scrolls to, focuses, or highlights any item —
   this is unchanged from BE-15 and is restated here because it remains
   load-bearing for this ticket's own point 7 below.
7. **Every visible example dish name is itself a distinct, clearly
   secondary, exact BE-12 link** — this is the one genuinely new
   navigation surface this ticket adds. Clicking a specific example
   (never the primary action, never a bare example that isn't one of
   the shown three) sends the visitor straight to that one exact dish
   on its real menu, via the existing, unmodified `dish`/`name`/`cat`/
   `fromQuery` mechanism — scroll, focus, temporary highlight, and the
   `aria-live` announcement all fire exactly as BE-12 already built.
   This is what keeps a one-match or two-match restaurant from losing
   BE-12's precise, satisfying deep link once every subgroup uses the
   same summarized shape: the summary itself is the entry point, not a
   dead end. `+N meer` is plain, non-interactive text, never a link —
   only the shown example names themselves are secondary links.
8. **The temporary highlight becomes visible immediately, stays visible
   for exactly 4 seconds, then disappears** — a deliberate, explicit
   change from BE-12's current, real `2750`ms constant (verified in
   `app/menu/[id]/MenuView.js`'s `setTimeout(() => setShowPulse(false),
   2750)`) to `4000`ms. This is the one, narrow, explicitly-scoped
   exception to "no change to BE-12" in "Non-goals" below — every other
   part of the highlight/scroll/focus/`aria-live` mechanism, and its
   validation, is untouched. **Visible keyboard focus is independent of
   this timer** — focus already moves to the resolved item once, via
   `node.focus()`, and is not tied to `showPulse`/the timer in the
   current code; it continues to behave exactly that way here, unchanged.
9. **BE-15's old "4 or more" restaurant-qualification threshold no
   longer decides card shape or navigation for any restaurant or menu.**
   The only place a fixed number still matters is the examples list: a
   fixed limit of **three** examples are shown before `+N meer` appears
   — this is a display-truncation limit, not a qualification gate, and
   it applies identically to every menu subgroup regardless of its own
   match count.
10. **Unchanged, reused verbatim from BE-15:** server-side aggregation
    happens over the complete, unpaginated candidate set before any
    pagination cut; pagination happens at the restaurant-group level,
    never at the raw-dish or menu-subgroup level; `lowCoverage` is
    computed only from the full, underlying, ungrouped candidate count
    (never from the number of restaurant groups, a group-mode cursor, or
    `hasMore`); an absent or unrecognized `group` value falls back,
    completely and silently, to today's exact, unmodified, ungrouped
    response.
11. **Heading hierarchy stays `<h1>` → `<h2>` (the grouped section's own
    heading) → `<h3>` (restaurant) → `<h4>` (menu subgroup)** — no
    skipped level, no new level. Because there is no more separate
    leftover-individual section (point 3 above), the existing `<h2>
    Gerechten gevonden</h2>` heading this page also renders today is
    retired for the dish-results path; `<h2>Restaurants gevonden</h2>`
    (BE-11's unrelated restaurant *name*/buurt match group) is
    untouched.
12. **The grouped API response uses one uniform shape for every menu
    subgroup — never an implicit "full item list" vs. "count +
    examples" variant that would make the presentation depend on a
    hidden threshold again.** Every menu subgroup carries, at minimum,
    the exact match `count` for that menu and up to three *public*
    example dish objects (not bare name strings) — each carrying enough
    of the existing, unmodified public dish shape
    (`dishId`/`name`/`category`, per `docs/api/dish-result-shape.md`) to
    build its own exact BE-12 link per point 7 above. BE-15's own
    `examples: string[]` (bare names only) is not sufficient for this and
    is expected to change shape during implementation — this ticket
    decides that a hidden items-vs-summary branch must not come back to
    replace it, not the exact field name/type, which is an
    implementation detail for the follow-up code ticket.

## Non-goals (explicitly out of scope)

- **No change to BE-12's validation, deep-link security, or menu
  highlight logic beyond the temporary green marker's own visible
  duration.** `resolveDishTarget()`'s strict validation, the
  scroll/focus behavior, the `aria-live` announcement, and every other
  part of `app/menu/[id]/MenuView.js`'s highlight effect are not
  reopened, not modified, not reinterpreted — only the `2750` → `4000`
  constant named in point 8 above is in scope.
- **No change to dish-search ranking**
  (`src/services/dishSearch.js`'s tiers/tie-break order), restaurant
  data, branding, domains, multi-city/`MARKET-*` work, or any
  unrelated navigation (`PrimaryNav`, the homepage, `/alle-restaurants`,
  etc.).
- **No new query parameter.** The primary action keeps using exactly
  `?q=`/`fromQuery`; the secondary example links keep using exactly
  `dish`/`name`/`cat`/`fromQuery` — both already-existing, already-safe
  mechanisms.
- **No product code, test, or styling change in this task.** This
  ticket is documentation/planning only; implementation is a separate,
  later task that may only begin once this ticket, its own
  documentation commit/push, and an independent implementation-readiness
  review are all green (see "Suggested order").

## Real data fixtures (verified 2026-09-19, re-verify before implementation)

- **`q=brood`** — `total: 24` (ungrouped). Real per-restaurant-menu
  counts: `23-diner`(T-Huis)=7, `23-lunch`(T-Huis)=5, `23-borrel`
  (T-Huis)=1, `6-diner`(Brasserie Bardot)=3, `6-lunch`(Brasserie
  Bardot)=3, `19-lunch`(Restaurant Zuyd)=3, `19-diner`(Restaurant
  Zuyd)=1, `1-diner`(Restaurant Wolfslaar)=1. Under this ticket's
  decided model: **four** restaurant groups, not one — T-Huis (13
  gerechten across 3 subgroups, per the worked example above), Brasserie
  Bardot (6 gerechten across 2 subgroups: Dinerkaart 3, Lunchkaart 3, no
  `+N meer` on either since each is ≤3), Restaurant Zuyd (4 gerechten
  across 2 subgroups: Lunchkaart 3, Dinerkaart 1), Restaurant Wolfslaar
  (1 gerecht, 1 subgroup: Dinerkaart 1). No leftover individual dish
  section at all. 13+6+4+1 = 24, matching the ungrouped total exactly —
  this sum-check is the generalized form of BE-15's own "13 grouped + 11
  individual = 24" check, now applied across every group instead of a
  grouped/individual split.
- **`q=friet`** — `total: 12`. T-Huis only: `23-lunch`=4, `23-diner`=8.
  One restaurant group, two subgroups (Dinerkaart 8, with examples +
  `+5`; Lunchkaart 4, with examples + `+1`) — unchanged in outcome from
  BE-15's own current behavior for this query, since T-Huis already
  qualified under the old threshold too.
- **`q=kip`** — `total: 11` across 3 restaurants, 7 restaurant+menu
  combinations: `6-lunch`(Bardot)=2, `6-diner`(Bardot)=1,
  `6-specialiteiten`(Bardot)=1, `19-lunch`(Zuyd)=1, `19-diner`(Zuyd)=1,
  `23-lunch`(T-Huis)=3, `23-diner`(T-Huis)=2. Under BE-15's old
  threshold this produced **zero** groups and 11 flat individual cards —
  the exact inconsistency this ticket exists to remove. Under this
  ticket's decided model: **three** restaurant groups (Bardot with 3
  subgroups, Zuyd with 2, T-Huis with 2), zero leftover individual
  cards, and `lowCoverage` still correctly absent (the underlying,
  ungrouped candidate count is 11, not 0).
- **Dated coverage caveat**: only 4 of Breda's 25 restaurants
  (`1`/`6`/`19`/`23`) have any digitized menu data today (re-verified
  2026-09-19, unchanged since BE-15's own equivalent check) — re-run
  this check before implementation; it does not change the presentation
  rule itself, only how many real restaurant groups a given query
  produces today.

## Acceptance criteria

All items below were originally written as pre-implementation
requirements. Every item except the one explicitly noted below was
verified both locally (targeted tests, full test suite, `npm run build`,
and a local production server) as of commit
`447ecfe27832fc6f1c058f5cc22a114c33b563f3`, and independently
re-confirmed live against `https://menucard-kappa.vercel.app` on
`2026-09-19` — including direct calls to the live `/api/search` endpoint
itself for the server-side/API-shaped items, not only through the
rendered page.

**Always grouped, never a leftover individual section**
- [x] For any query with `total > 0`, every matching dish belongs to
      exactly one menu subgroup of exactly one restaurant group — there
      is no separate section of individual, ungrouped dish cards
      anywhere on the page.
- [x] Given the real `q=kip` fixture, all three restaurants (Brasserie
      Bardot, Restaurant Zuyd, T-Huis) each render as their own
      restaurant group — none renders as flat individual cards, even
      though none reaches BE-15's old "4 or more" threshold on any
      single menu.
- [x] Given the real `q=brood` fixture, all four restaurants (T-Huis,
      Brasserie Bardot, Restaurant Zuyd, Restaurant Wolfslaar) each
      render as their own group; the sum of every subgroup's count
      across all four groups equals 24 exactly.
- [x] Given the real `q=friet` fixture, T-Huis renders as one group with
      two subgroups (Dinerkaart 8, Lunchkaart 4); the sum equals 12.

**Uniform menu-subgroup shape**
- [x] Every menu subgroup — regardless of its own match count — renders
      the exact same shape: menu-card name, full-sentence count, up to
      three example dish names, `+N meer` only when `count > 3`, and
      exactly one primary action labelled `Bekijk alle X
      gerechten/gerecht op de kaart →`.
- [x] A menu subgroup with exactly 1, 2, or 3 matches never shows `+N
      meer` and shows every one of its matches as an example.
- [x] A menu subgroup with more than 3 matches shows exactly 3 examples
      (in existing relevance order) followed by `+N meer`, where `N`
      equals `count - 3` exactly — live-verified on `q=friet`'s
      Dinerkaart (8 total, `+5`) and Lunchkaart (4 total, `+1`); the same
      formula/code path is exercised identically for `q=brood`'s
      Dinerkaart (7 total, `+4`).
- [x] No menu subgroup is ever rendered with a different structure based
      on its own size — there is no code path that renders a "full item
      list" for small subgroups and a "count + examples" summary for
      large ones.

**Primary action (filtered menu, no highlight)**
- [x] The primary action's `href` is exactly `/menu/{restaurantId}-
      {mealType}?q={query}&fromQuery={query}`, built via
      `URLSearchParams`, reusing only the two existing, already-safe
      parameters — no new parameter, no new route.
- [x] Visiting the primary action opens the full, normal menu, filtered
      to matches via the existing `?q=` mechanism, with zero items
      scrolled to, focused, or highlighted.

**Secondary example links (exact BE-12 deep link)**
- [x] Each of the up to three shown example dish names is its own real,
      keyboard-operable link, built from that dish's existing
      `dishId`/`name`/`category` via the unmodified BE-12 mechanism
      (`dish`/`name`/`cat`/`fromQuery`).
- [x] Clicking a specific example dish name scrolls to, focuses, and
      temporarily highlights exactly that one dish, and announces it via
      the existing `aria-live` region — live-verified for a 1-match
      subgroup (`q=brood`'s Borrelkaart, "Brood & Boter"), a 3-match
      subgroup (`q=Höpler`'s "Rood"), and one of a >3-match subgroup's
      shown examples (`q=brood`'s Dinerkaart, "Desem stokbrood").
- [x] `+N meer` is plain, non-interactive text — never a link, never
      clickable, and never itself a path to any specific dish.
- [x] The temporary highlight becomes visible immediately, remains
      visible for exactly 4000ms, then disappears — a real, measured
      change from BE-12's current 2750ms constant, live-timed against
      production.
- [x] Keyboard focus on the resolved dish is visible and remains exactly
      as long as focus stays there, independent of the 4-second
      highlight timer (tabbing away or waiting past 4 seconds must not
      remove focus itself, only the highlight class) — live-confirmed
      focus remained on a real element both mid-highlight and after it
      cleared.

**No duplication or loss**
- [x] For every real fixture above, the sum of every rendered menu
      subgroup's count across every rendered restaurant group equals the
      query's own ungrouped `total` exactly — no dish is ever counted
      twice or dropped.
- [x] No dish ever appears in two different restaurant groups, or in a
      restaurant group and anywhere else on the page.

**Restaurant-level pagination, sorting, and `lowCoverage`**
- [x] Restaurant groups are paginated (cursor/limit), never raw dishes
      and never menu subgroups — a restaurant's own subgroups never
      span two pages of the response. Reuses the existing
      `DEFAULT_LIMIT`/`MAX_LIMIT` constants at this aggregation level,
      unchanged from BE-15. Live-verified with a direct
      `limit=2`/`cursor` call against the production API on the real
      `q=brood` fixture (4 groups split cleanly across two pages, no
      group split).
- [x] Restaurant groups are ordered by relevance (a restaurant's
      position determined by its best-ranked matching dish, the same
      tier/tie-break order `dishSearch.js` already produces) — never
      alphabetical, never by match count alone. Menu subgroups within one
      restaurant keep BE-15's own descending-match-count order.
- [x] `lowCoverage` is present if and only if the full, underlying,
      ungrouped candidate count is genuinely zero — never derived from
      the number of restaurant groups, a restaurant-level cursor, or
      `hasMore`. Live-verified on both sides: the real `q=kip` fixture
      (11 underlying matches, 3 real groups) correctly omits
      `lowCoverage`, and the real `cuisine=Chinees` fixture (genuinely
      zero underlying matches) correctly includes it, identically to the
      ungrouped response.
- [x] An absent or unrecognized `group` value still falls back,
      completely and silently, to today's exact, unmodified, ungrouped
      response — unchanged from BE-15; live-verified directly against
      the production API.

**Accessibility and mobile**
- [x] Heading hierarchy has no skipped level: `<h1>` → the grouped
      section's own `<h2>` → each restaurant group's `<h3>` → each menu
      subgroup's `<h4>`.
- [x] No horizontal overflow at ~390px or ~1280px, in both themes, with
      a restaurant that has a long name, a long menu label, and three
      long example dish names all present in one subgroup at once —
      confirmed across every real fixture tested (`brood`, `friet`,
      `kip`, `Höpler`, `Chablis`).
- [x] Exactly four real, keyboard-operable links per >3-match subgroup
      (three example links + one primary action) and exactly `count + 1`
      links per ≤3-match subgroup — no nested links, no fake buttons.
- [x] Visible keyboard focus on every example link and every primary
      action, reusing existing, already-shipped focus-visible tokens —
      no new focus convention. Live-confirmed via computed style: both
      an example link and a primary action show a real, visible outline
      on focus.
- [ ] A page with many restaurant groups (e.g. a synthetic or future
      fixture with 10+ qualifying restaurants) remains scannable on a
      ~390px viewport — still not reproducible against today's real
      data (only 4 of Breda's 25 restaurants have any digitized menu);
      left unchecked for this reason, not because of any known defect.

**API compatibility**
- [x] `/api/search`'s existing, ungrouped response (no `group` param, or
      an unrecognized one) is verified byte-for-byte unchanged —
      live-verified directly against the production API.
- [x] Every menu subgroup in the `group=restaurant` response uses one
      uniform shape (`count` + up to three public example dish objects)
      — no field or branch whose presence or shape depends on whether
      `count` crosses any threshold. Live-verified via a direct
      production API call: every example object contains exactly
      `dishId`/`name`/`category`/`weakMatch`, never any internal
      wine/supplement data.

## Open decisions (explicitly not resolved by this ticket)

**Resolved during implementation (2026-09-19):** the exact example
object shape was settled as `{ dishId, name, category, weakMatch }` in
`src/services/dishSearch.js` — a uniform shape for every menu subgroup
regardless of size, satisfying this ticket's own constraint (no hidden
items-vs-summary branch). `weakMatch` is a restored BE-12 §1.2/BE-13
provenance signal, not part of the shape question this ticket originally
posed, but decided alongside it — see the ticket's own commit history.
The exact visual treatment was implemented directly during the code
round (no separate static mockup was produced) and was live-verified at
`390px`/`1280px`, both themes, with no overflow — a conscious deferral to
the implementation task itself, per "Suggested order" point 3 below, not
an unresolved gap.

Still genuinely open:

- **Restaurant-group page size at real scale** (today's real data caps
  out at 4 restaurant groups for any query) — the existing
  `DEFAULT_LIMIT`/`MAX_LIMIT` constants are reused per point 10 above,
  but whether a smaller default improves mobile scannability once
  coverage grows to dozens of qualifying restaurants per query is not
  decided here, and is not reproducible against today's real data (see
  the one remaining unchecked acceptance criterion below).

## Suggested order

A direct revision of `BE-15`'s own delivered presentation rule — not a
new feature area. `BE-15`'s architecture (server-side aggregation,
restaurant-level pagination, the API flag/fallback contract) was not
reopened; only the "does a restaurant get grouped at all" rule and the
menu-subgroup's own display shape changed.

**All preconditions below were met before implementation started, in
order:**

1. This ticket's own documentation commit was made
   (`04acfbe35c67f0e5a609236af8d9f3adc0763ede`) and pushed.
2. An independent, read-only implementation-readiness review of this
   ticket was green.
3. The exact example-object shape (see "Open decisions") was resolved
   directly during the implementation round, per the constraint already
   decided (no hidden items-vs-summary branch).

Implementation, an independent pre-commit review, a combined pre-push
review, the code push, and production verification then followed, in
that order — see "Status" above for the full result.
