# BE-12 — Dish Search Result Deep Link: Scroll, Focus and Highlight on the Menu

## Status

Proposed; **implemented and locally verified across two separate local
commits — base commit `fbaefe45160e9aead41f482419845f3468952172`
(2026-09-18) plus a later, separate local commit
`8cd3f05cae76732ecd02de738b82ec86f879de1a` (2026-09-18) that adds the
name-collision disambiguation refinement described in the
"Implementation note" below — neither commit has been pushed or
deployed; no production or live verification has been done.** The base
commit's flow is built end-to-end: a dish search result's CTA now reads
`Bekijk {gerechtnaam} op menu →` and links to `/menu/[id]` with
`dish`/`name`/`cat` (and, when a real text query is active, `fromQuery`)
built safely via `URLSearchParams`, from the existing, unmodified public
dish fields (`dishId`/`name`/`category`); every dish result row also now
shows a consistent, visible `{maaltijdtype} · {categorie}` context line,
from those same existing fields. On `/menu/[id]`, `dish`+`name`+`cat` are
validated strictly (route prefix, in-range position, exact trimmed/case-
insensitive name, exact category) via the new, independently unit-tested
`src/lib/dishDeepLink.js`; any mismatch falls back silently to the
normal, unfiltered, unhighlighted menu — no guess, no error. A valid
match scrolls the exact item into view (respecting
`prefers-reduced-motion`), moves keyboard focus to it, applies a
temporary (~2.5–3s) highlight to that one item only, and announces it
once via a visually-hidden `aria-live="polite"` region; when `fromQuery`
is present, an additional, same-origin `/search?q=...` back-link (built
only via `URLSearchParams`) appears alongside the existing restaurant
back-link. `?q=`'s own existing behavior is completely independent and
unmodified — it is read separately and never assigned into any dish-
target state — and the specific case of a valid dish context whose item
is excluded by an active `?q=`/allergen/diet/price filter falls back
safely (no highlight, no focus move, no announcement, no error): the
item simply has no rendered DOM node to attach to, and the effect
inspects that before doing anything. Targeted tests, the full project
test suite, and `npm run build` all pass locally. Behavior has been
verified against a local production server only (390px/1280px, both
themes, `prefers-reduced-motion: reduce`, the real 8-way "friet" spread
and the real 3-way "Höpler - Seeblick" duplicate on restaurant 23, and a
full search → highlight → back-link → search click-through) — not
against any live/deployed environment, regardless of the commit's
current push status.

**Implementation note (2026-09-18), updated (2026-09-18):** the
originally planned "Desired behavior" §1.1 also described same-named
dish rows for the same restaurant additionally showing their
distinguishing category inline next to the dish name, on top of the
already-built consistent meal-type/category context line. That specific
inline-on-collision refinement — a separate local commit,
`8cd3f05cae76732ecd02de738b82ec86f879de1a` (2026-09-18), on top of the
`fbaefe4...` base commit above, not folded into it — has now been
implemented and verified locally: `hasDishNameCollision()` in
`app/search/page.js` flags
a collision only when two results share both the same `restaurantId` and
the same raw `dish.name`; only the visible card title gains the inline
`(category)` suffix (e.g. "Höpler - Seeblick (Wijnen — Rood)"), confirmed
against the real 3-way "Höpler - Seeblick" fixture on restaurant `23`.
The deep-link (`buildDishMenuHref`, still built from the raw `dish.name`),
the CTA text (still `Bekijk {dish.name} op menu →`), the `?q=`/`fromQuery`
query contract, the highlight/scroll/focus behavior on `/menu/[id]`, and
every dish with a unique name are all verified unchanged. Targeted tests,
the full project test suite, and `npm run build` all pass locally. This
refinement has **not** been pushed, deployed, or verified against any
live/deployed environment — it remains local-only, same as the rest of
this ticket's implementation.

## Depends on

`docs/api/dish-result-shape.md`/`dish-search-ranking.md` (BE-02a/02c) —
the existing, unmodified dish-level result contract this ticket's new
query parameters (`dish`/`name`/`cat`) are built entirely from: `dishId`,
`menuLink`, `name`, and `category` are all BE-02a/02c's own fields,
reused here exactly as already defined, never redefined or extended.
`src/services/dishSearch.js`'s existing tier ranking is likewise reused,
unmodified.

`BE-11` (`planning/specs/tickets/be-11-public-menu-discovery-intent-aware-results.md`)
— referenced only for its restaurant-level browse/navigation context, not
as the owner of the dish-result contract above: this ticket does not
reopen or modify any restaurant-level navigation, card, or grouping
decision `BE-11` already made. It does, however, **close part of `BE-11`
Fase 3's still-open "back to results" question** ("Exact copy for the
page-specific 'back to results' link on `/restaurant/[id]`/`/menu/[id]`
(Fase 3) — the requirement is fixed, the exact wording is not") —
specifically for the entry point this ticket adds (`/search` dish result
→ `/menu/[id]`), not for every possible way `/menu/[id]` can be reached.

`app/search/page.js`, `app/menu/[id]/MenuView.js` — existing,
unmodified-in-contract components this ticket extends additively.

## Problem

- Today, clicking a dish search result's "Bekijk menu →" link
  (`app/search/page.js`'s `DishResultRow`) sends the visitor to
  `dish.menuLink` — a bare `/menu/{restaurantId}-{mealType}` route with no
  reference to which specific dish was found. The visitor lands on a
  normal, unfiltered menu and has to re-search or scroll manually to find
  the exact dish that brought them there — the search context is lost at
  the exact moment it matters most.
- `/menu/[id]` (`MenuView.js`) already has a `?q=` query parameter, but it
  does something different from what this problem needs: it pre-fills the
  on-page ingredient filter and **filters** the category/item list down to
  text matches (`itemMatchesQuery`, `filteredCategories`) — hiding
  everything else. Nothing in the current codebase actually constructs a
  `/menu/[id]?q=...` link (`grep` across `app/page.js`, `src/services/*.js`,
  `app/search/page.js` finds none) — this is a dormant capability whose
  intended caller was the homepage, not `/search`'s dish results.
- Reusing `?q=` for this new flow would be wrong, not just unused:
  filtering hides the rest of the menu (the opposite of what's wanted),
  and matching by free text alone is ambiguous. Verified directly against
  real data (`data/menus.json`): restaurant `23`'s two menus (`23-lunch`,
  `23-diner`) together contain 12 items whose name/description/supplement
  text matches "friet"; the same restaurant's `23-borrel` menu contains a
  real, exact name duplicate — "Höpler - Seeblick" appears three times,
  once each in the "Wijnen — Wit", "Wijnen — Rood", and "Wijnen — Rosé"
  categories, at an identical price. A text-substring reuse of `?q=`
  cannot honestly resolve either case to the one specific dish the
  visitor actually clicked.

## Objective

A click on a specific dish search result takes the visitor to that
dish's existing, unmodified menu route, where the full menu stays visible
and exactly the clicked dish — never a guess, never the first same-named
match, never every text match — is scrolled into view, given keyboard
focus, and briefly, visibly highlighted. The click never depends only on
the free-text query that produced it.

## User story

As a visitor who searched for "friet" and found "Steak à la T-Huis" at
T-Huis, when I click that result I want to land on that restaurant's
actual menu with the rest of the menu still there for context, see my
exact dish immediately without scrolling or re-searching, and be able to
get back to my search results without losing my place — never see a
different "friet" dish highlighted by mistake, and never see every dish
that happens to mention "friet" lit up at once.

## Non-goals (explicitly out of scope)

- No change to `/api/search`, `/api/restaurants`,
  `src/services/dishSearch.js`'s ranking/tiers, or
  `src/services/restaurantIndex.js` — this ticket adds no backend field,
  only reuses existing public response fields (`dishId`, `name`,
  `category`) as additive query-string values.
- No change to `?q=`'s existing filter behavior on `/menu/[id]` — it
  keeps its current meaning and effect, unconditionally, regardless of
  whether the new parameters below are present.
- No change to `BE-11`'s restaurant-level navigation, `PrimaryNav`,
  `RestaurantBrowseCard`, or the `/alle-restaurants`/`/search`
  restaurant-group behavior — not reopened.
- No debounce or automatic-search change on `/search` — a separate,
  already-closed advisory topic.
- No canonical, stable menu-item ID (`MARKET-02`'s future
  `CanonicalMenuItem.id`) — this ticket's validation rule is designed to
  work safely with today's positional `dishId`; see "Open technical
  questions."
- No new backend endpoint, no full-menu duplication to the client beyond
  what `/menu/[id]` already loads today, no extra network request — all
  data needed already arrives in `/api/search`'s existing response.
- No automatic "item no longer exists" error message — the fallback is
  always the silent, full, normal menu view (see "Validation and
  fallback").

## Route and query contract

Additive only. Every existing `/menu/[id]` deep link (with or without
today's `?q=`) is unaffected.

| Parameter   | Meaning                                                                 | Required |
|-------------|--------------------------------------------------------------------------|----------|
| `dish`      | The existing, unmodified `dishId` (`docs/api/dish-result-shape.md`) — positional locator within this exact route's menu. | With `name`/`cat` |
| `name`      | The expected dish name (`dish-result-shape.md`'s existing `name` field) — validated against the resolved item before anything is highlighted. | With `dish`/`cat` |
| `cat`       | The expected category name (`dish-result-shape.md`'s existing `category` field) — validated against the resolved item's category before anything is highlighted. | With `dish`/`name` |
| `fromQuery` | The original free-text query, used **only** to build a same-origin `/search?q=...` back-link and, optionally, to mark the matched substring inside the one already-validated target item. | No |

`?q=` keeps its exact current meaning (pre-fills and filters the on-page
ingredient search) unconditionally — its behavior never changes based on
whether `dish`/`name`/`cat`/`fromQuery` are present. `dish`, `name`,
`cat` are read, validated, and used only for the new scroll/focus/
highlight behavior below; they are never assigned into the existing
filter state (`query`/`excludeAllergens`/`dietTags`/`maxPrice`) that
`?q=` already drives.

The URL a dish search result builds (replacing today's bare `menuLink`):

```
/menu/{restaurantId}-{mealType}
  ?dish={dishId}
  &name={encodeURIComponent(name)}
  &cat={encodeURIComponent(category)}
  &fromQuery={encodeURIComponent(originalQuery)}
```

All four values come directly, unchanged, from fields `GET /api/search`
already returns for that same dish result — built via `URLSearchParams`,
the same mechanism `app/search/page.js`'s own `buildParams()` already
uses for every existing parameter, so encoding/decoding needs no new
logic.

## Validation and fallback

Applied only when `dish` is present; `dish` absent means today's
behavior, completely unchanged.

1. `dish` must start with exactly `{this route's own id}-` — otherwise
   invalid.
2. The remaining `{categoryIndex}-{itemIndex}` must be valid, in-range
   indices against the **unfiltered** `r.categories`/`.items` — never
   against any already-filtered list.
3. The resolved item's `name` (trimmed, case-insensitive) must equal
   `name`, **and** its category's name must equal `cat` — both must
   match, not just one (see "Multiple matches on one menu" below for why
   category is required, not optional).
4. Only if every step above passes: scroll the resolved item into view,
   move keyboard focus to it, apply a brief, temporary highlight, and —
   only if `fromQuery` is also present — mark the matching substring
   inside that one item's own name/description (reusing `MenuView.js`'s
   existing `highlight()` function, applied to that one item only).
5. If any step fails: render the normal, full, unfiltered, unhighlighted
   menu — no error message, no partial highlight, no best-effort guess at
   a nearby item.

### Multiple matches on one menu (explicitly named, tested against real data)

- Ten "friet" matches on one menu (real: restaurant `23` has 12 across
  its two menus): no ambiguity — each search result already carries its
  own specific `dishId`/`name`/`cat`; clicking one only ever validates and
  highlights that one.
- Identical names in different categories (real: "Höpler - Seeblick" ×3 in
  `23-borrel`, same price, different category): `name` alone is not
  sufficient to disambiguate these — `cat` is the deciding field. This is
  why step 3 requires both, not either.
- At most one item ever carries the temporary highlight or the substring
  mark, however many other items on the same menu contain the same word
  — this is a hard rule, verified in "Acceptance criteria" below, not a
  best-effort behavior.

## Desired behavior

### 1. Search result → menu → back

1. `/search`'s dish result row shows its existing fields (name, price,
   restaurant, description, tags) plus, newly, its `category`/`mealType`
   as a compact secondary label — shown consistently on every dish row,
   not only when a collision is detected. When two rows for the same
   restaurant happen to share a name, the category is additionally
   appended inline to the name (e.g. "Höpler - Seeblick (Wijnen —
   Rood)"), computed purely client-side from the already-fetched results
   array — no new field.
2. The CTA reads `Bekijk {gerechtnaam} op menu →` (was the generic
   `Bekijk menu →`) — matches `BE-11` §3's existing "the button text
   honestly names the destination" principle, applied here to a specific
   dish instead of a meal-type intent. This wording change ships together
   with the scroll/focus/highlight mechanism, never separately — a
   specific promise without a specific destination would be more
   misleading than today's generic text.
3. `/menu/[id]` loads its full, normal, unfiltered menu. Once validation
   (above) succeeds: scroll (instant under `prefers-reduced-motion:
   reduce`, otherwise smooth) the target item into view with enough
   clearance to not land under the page's existing `position: sticky`
   `.menu-filter-bar` (`block: 'center'` and/or a matching
   `scroll-margin-top`); move keyboard focus to the item (`tabIndex={-1}`
   + `.focus()`); apply a brief (~2.5–3s) highlight using existing tokens
   (`--green`/`--green-faint`, the same quiet-accent pair already
   established for the restaurant browse card), with no animation under
   reduced motion; announce the resolved dish via a visually-hidden
   `aria-live="polite"` region.
4. An explicit "← Terug naar zoekresultaten voor '{fromQuery}'" link
   (alongside, not replacing, the existing static "← Alle restaurants"
   link) points to `/search?q={fromQuery}` — a same-origin,
   self-constructed relative path, never a free `returnTo` URL. Shown
   only when `fromQuery` is present. The browser's own Back button
   remains, as always, a correct and available alternative.
5. If validation fails at any step: the full, normal menu renders with no
   highlight and no error — indistinguishable from a visit with no `dish`
   parameter at all.

### 2. Accessibility

- Focus lands on the resolved item (decision 014 item 7), not left at the
  top of the page.
- An `aria-live="polite"` region announces the resolved dish once.
- Highlight duration ~2.5–3s: long enough to notice, short enough not to
  read as a permanent selection state.
- `prefers-reduced-motion: reduce` disables the smooth scroll (`behavior:
  'auto'`) and any highlight animation (an instant, non-animated state
  change for the same total duration) — this is the first place in the
  codebase to implement this preference; no existing convention to
  break.
- The sticky `.menu-filter-bar` is accounted for in the scroll target
  position.

### 3. Performance

No new network request — `dish`/`name`/`cat`/`fromQuery` are built
entirely from fields `GET /api/search` already returns. No full-menu
duplication beyond what `/menu/[id]` already loads server-rendered
today. Stays inside the existing consumer performance budget
(`planning/decisions/003-performance-budget.md`/
`009-consumer-vs-internal-performance-budget.md`) — no measurable
bundle-size or payload change expected beyond the small amount of new
client-side interaction code.

## User flow

1. Visitor searches "friet" on `/search`, presses Enter (existing,
   unmodified behavior).
2. A dish result reads "Steak à la T-Huis — T-Huis — Diner" (a real,
   verified item from `data/menus.json`, the same fixture already cited
   in "Problem" — its description reads "Rumpsteak | gepofte
   cherrytomaat | balsamico | jus | friet"), CTA "Bekijk Steak à la
   T-Huis op menu →", linking to
   `/menu/23-diner?dish=23-diner-1-0&name=Steak%20%C3%A0%20la%20T-Huis&cat=Hoofdgerechten&fromQuery=friet`.
3. `/menu/23-diner` loads its full, normal menu; the target item is
   validated, scrolled to, focused, and briefly highlighted; the
   substring "friet" is marked within that one item's description only.
4. Every other item — including the seven other real items on this same
   menu that also mention "friet" (see "Problem") — renders completely
   unmarked.
5. The visitor uses the explicit "← Terug naar zoekresultaten voor
   'friet'" link (or the browser's own Back button) to return to
   `/search?q=friet`.
6. If the same link is followed after `data/menus.json` has since changed
   (a redeploy moved or removed the item): the full, normal menu renders,
   unhighlighted, with no error.

## Phased delivery

- **Fase 1**: `/search`'s dish CTA/link change, `dish`/`name`/`cat`/
  `fromQuery` on `/menu/[id]`, validation + fallback, scroll/focus/
  highlight, the back-link, and the `category`/`mealType` secondary label
  on `/search` result rows.
- **Fase 2** (optional, separately decided, not scoped here): extending
  the same dish-context link pattern to any other future entry point that
  might link directly to a specific dish — none exists today outside
  `/search`.

## Risks

- `dishId`'s positional format
  (`{restaurantId}-{mealType}-{categoryIndex}-{itemIndex}`) is not an
  immutable primary key (`dish-result-shape.md` names this itself: "until
  a real primary key exists") — a menu reorder between deploys could, in
  the narrowest case, move one of two items sharing both identical name
  and identical category into each other's exact former position; the
  visitor-facing outcome of that specific coincidence is not meaningfully
  wrong (the two items are, by definition, indistinguishable to the
  visitor), but it is not theoretically perfect. See "Open technical
  questions."
- Scrolling to a point on the page is not entirely without precedent —
  `app/restaurants/page.js` already calls `resultsRef.current?.
  scrollIntoView({ behavior: 'smooth', block: 'start' })` once, to bring a
  results section into view after a button click — but that existing call
  has no focus movement, no `prefers-reduced-motion` check, and no
  per-item highlight. This ticket's accessible refinement — deliberate
  keyboard focus on the resolved item, `prefers-reduced-motion` respect,
  an `aria-live` confirmation, and a temporary, item-scoped highlight — is
  genuinely new: no existing `prefers-reduced-motion` rule or
  post-navigation-focus convention exists anywhere else in this codebase
  (verified: neither appears anywhere in `app/globals.css` or any other
  route), so there is no existing pattern to copy for those specific
  behaviors, even though basic smooth-scrolling itself is not
  unprecedented.
- The `.menu-filter-bar`'s `position: sticky` (confirmed in
  `app/globals.css`) must be accounted for in the scroll target, or the
  highlighted item could land underneath it.

## Open technical questions (explicitly not decided here)

- Whether `MARKET-02`'s future `CanonicalMenuItem.id` (a real, stable
  primary key, decoupled from position — see
  `docs/api/canonical-restaurant-menu-schema.md`) should eventually
  replace `dishId` as this ticket's locator. Not required for this
  ticket: the `name`+`cat` validation, checked against real production
  data (the 12-way "friet" spread and the 3-way "Höpler" name
  duplicate), already prevents every practical case of highlighting the
  wrong item; a canonical ID would remove the last, narrow,
  practically-inconsequential theoretical edge described above, not fix
  a defect that ships without it.

## Acceptance criteria

All items below are checked off as **verified locally** (targeted tests,
full test suite, `npm run build`, and a local production server) across
both local commits: base commit
`fbaefe45160e9aead41f482419845f3468952172`, plus the separate local
commit `8cd3f05cae76732ecd02de738b82ec86f879de1a` containing the
name-collision refinement described in the updated "Implementation note
(2026-09-18)" above, also verified locally on 2026-09-18 — none of this
has been verified against a live or deployed environment. That remains
true regardless of either commit's push status; live verification is a
separate, later step this ticket does not claim has happened. Every item
below is now demonstrably proven by local verification (targeted tests,
the full suite, and the build), not assumed.

- [x] Existing `/menu/[id]` deep links, with or without `?q=`, render
      identically to today when `dish` is absent — proven structurally:
      `resolveDishTarget()` returns `null` whenever `dish` is absent, so
      the entire scroll/focus/highlight effect never runs at all in that
      case, and every pre-existing, unmodified test for `/menu/[id]`
      still passes unchanged.
- [x] Given a valid `dish`+`name`+`cat`, the resolved item is scrolled
      into view, receives keyboard focus, and is temporarily (~2.5–3s)
      highlighted; the rest of the menu remains fully visible and
      unfiltered. Verified live against the real `23-diner-1-0` ("Steak
      à la T-Huis") fixture.
- [x] Given the real `23-diner` fixture (8 "friet" matches in one menu)
      and a `dish`/`name`/`cat` pointing at one of them: at most one item
      on the entire rendered page carries the temporary highlight, and at
      most one substring is wrapped in `<mark>`, regardless of how many
      other items also contain "friet". Verified live: exactly 1
      highlighted card, exactly 1 `<mark>` on the whole page.
- [x] Given the real `23-borrel` fixture (three "Höpler - Seeblick"
      entries, identical name and price, different category): each of
      the three distinct `dish` values resolves to, validates against,
      and highlights only its own specific category's entry — never one
      of the other two. Proven for all three by
      `src/lib/dishDeepLink.test.js`; the `Wijnen — Rosé` case additionally
      verified live.
- [x] A mismatched `name`, a mismatched `cat`, an out-of-range index, or a
      `dish` whose restaurantId-mealType prefix doesn't match the current
      route each independently trigger the full, unhighlighted fallback,
      with zero items carrying any highlight class — not just "the
      intended item is absent." Proven by 13 targeted tests in
      `src/lib/dishDeepLink.test.js` plus live checks for a wrong name, a
      wrong category, and an out-of-range position.
- [x] The back-link, when `fromQuery` is present, renders as a relative
      path beginning with `/search?q=`, built only via `URLSearchParams`,
      never as an absolute URL or a value containing a URL scheme. Proven
      structurally and live (`href="/search?q=friet"`).
- [x] `prefers-reduced-motion: reduce` results in an instant (non-smooth)
      scroll and a non-animated highlight, visible for the same total
      duration as the animated version. Verified live: `scrollIntoView`
      is called with `{behavior: 'auto'}` under reduced motion (`'smooth'`
      otherwise). The highlight itself (`.menu-card-highlighted`, a
      background/border color change applied and removed by a JS timer)
      carries no CSS transition or animation of its own in either mode —
      it is unconditionally instant, which satisfies this criterion in
      its strongest form rather than only under the reduced-motion branch.
- [x] The resolved item is reachable despite the page's sticky
      `.menu-filter-bar` — verified visually at ~390px and ~1280px, in
      both themes. `.menu-card-highlighted`'s `scroll-margin-top: 160px`
      plus `scrollIntoView({block: 'center'})` were used; no page in any
      of the tested viewport/theme combinations showed the highlighted
      item obscured or any horizontal overflow.
- [x] `/search`'s dish result rows show `category`/`mealType`
      consistently — verified live (local production server). Two
      same-named rows for the same restaurant additionally showing their
      distinguishing category inline is now also implemented and verified
      locally, in the separate local commit
      `8cd3f05cae76732ecd02de738b82ec86f879de1a` — `hasDishNameCollision()`
      scoped to a shared `restaurantId` and shared raw `dish.name`, only
      the visible card title affected — confirmed against the real 3-way
      "Höpler - Seeblick" fixture on restaurant `23`. See the updated
      "Implementation note (2026-09-18)" above. Not yet pushed, deployed,
      or verified against any live/deployed environment.
- [x] No new network request is made beyond what `/search` and
      `/menu/[id]` already make today; no `/api/search`/`/api/restaurants`
      contract change. Confirmed: neither file appears anywhere in either
      commit's diff.

## Suggested order

An independent extension of `BE-11`'s existing browse/search
navigation, following it directly — not blocked by any `PLATFORM-*`/
`MARKET-*` work. Depends only on already-existing, already-live fields —
`dishId`, `menuLink`, `name`, and `category` — all of which belong to
`BE-02a`/`02c`'s dish-result contract, not to `BE-11`.
