# BE-10 — Results Sort Placement, Filter/Results Boundary, Card Hierarchy, Mobile Overflow

## Depends on

`BE-09` (the approved baseline this ticket builds on directly — the
`.results-header`/`.sort-bar`/`RestaurantCard` markup and the theme-toggle
header fix this ticket extends were all introduced or last touched there).

## Goal

A small, independent visual-polish ticket against `/restaurants` — no new
data, ranking, or sort logic; no redesign; hero, stappenbalk, navigation
structure, the static read path, and existing filter/sort behavior are all
unchanged.

## Scope

1. **Sort next to the result count.** The existing sort `<select>`
   (Standaardvolgorde/Naam A–Z/Naam Z–A) moved from the old `.sort-bar` in
   the filter layer into `.results-header`, directly beside
   `.results-count` (`display:flex; justify-content:space-between`). Same
   `sortBy` state, same options, same behavior — only its position changed.
   `.sort-bar` now only renders (conditionally, when `hasFilters`) as a
   home for the Reset button, so it no longer leaves an empty bordered
   strip once the sort select moved out.
2. **Visible filter/results boundary.** `.results-section` gained a
   `border-top: 1px solid var(--border)` (existing token) and slightly
   more top padding (24px → 32px), placing a subtle divider at the actual
   seam between the filter layer and the results — previously there was
   only generic whitespace, and the one existing divider (`.sort-bar`'s
   border) sat mid-filter-layer instead.
3. **One primary card action, matching "Zie de menukaart vóór je
   reserveert."** `RestaurantCard` now derives `hasMenu = allLinks.length
   > 0`. When a menu exists, the menu-access control (dropdown-adjacent
   "Bekijk menu →", or the single-menu-link button) gets a new
   `--primary` modifier (solid `var(--green)` fill) and the first
   reservation action gets a new `--secondary` modifier (outline, no
   fill) — reusing existing tokens, adding no new ones. When no menu
   exists, both stay exactly as before: the reservation/website action is
   the solid/primary one, and the "Bekijk menu" fallback (which actually
   routes to `/restaurant/[id]`, not a real menu) keeps its existing
   outline treatment. No action is removed, hidden, or made harder to
   reach either way — only which one carries the solid-fill treatment.
4. **Mobile header overflow on `/restaurants` fixed at 390px and 320px.**
   `/restaurants`' header carries more control groups (theme toggle,
   back-link, language switch, mode switch) than any other route's and
   was the only page with horizontal page overflow on narrow viewports
   (confirmed: 0px overflow on `/`, `/search`, `/restaurant/[id]`,
   `/menu/[id]` even before this ticket). Fixed by letting `.header-inner`
   and `.header-right` wrap onto additional rows at the existing
   `max-width: 768px` breakpoint, and letting `header`/`.site-header`
   grow (`height: auto`, was a fixed `var(--header-h)`) to fit the
   wrapped rows. No control is removed, hidden, or cut off; pages whose
   header content already fit on one line render unchanged.

## Out of scope

- Any new sort value, ranking signal, or filter logic.
- Any redesign of the filter layer, hero, stappenbalk, or navigation
  structure.
- `Dagmenu vandaag`, `Specialiteit`, source/freshness badges, a share
  feature, or any `MARKET-*` work.
- `outputs/`, mockup files, or the uncommitted `MARKET-10` documentation.
- A release, tag, or version change.

## Key risk

The card-hierarchy swap (point 3) touches the most-used component on the
page (`RestaurantCard`, rendered once per restaurant). Mitigated by
reusing existing color tokens and existing button structure — only CSS
classes/modifiers changed, no markup removed, no `href`/route changed —
and by verifying both branches (`hasMenu` true/false) render correctly
across multiple real restaurants, not just one example of each.

## Verification performed

- `npm run build` succeeds; bundle impact reported in the chat report for
  this round (only `/restaurants`' own route bundle changes at all).
- Playwright (ad hoc via `npx`, same approach as `BE-09`) used to:
  - Measure `document.documentElement.scrollWidth` vs. `clientWidth` on
    `/restaurants` at 1440px, 390px, and 320px — confirmed 0px overflow
    at all three after the fix (320px required an additional
    `.header-inner`/`.header-right` wrap rule beyond the first pass, since
    `.mode-switch` alone was still wider than the space left next to the
    logo at exactly 320px).
  - Confirm the sort select still sorts identically (`az` produces a
    correctly alphabetically-sorted list) from its new position.
  - Confirm card hierarchy on a restaurant with a menu (id `1`, Restaurant
    Wolfslaar): menu action carries `rc-menu-go-btn--primary`, reservation
    action carries `rc-reserve-btn--secondary`, both hrefs unchanged and
    still present.
  - Confirm card hierarchy on restaurants without a menu, including
    restaurant `10` (Salon de Provence) and two others found incidentally
    (Restaurant Blossem, Con Fuego): reservation action stays
    `rc-reserve-btn` (primary, unmodified), "Bekijk menu" stays
    `rc-menu-btn--outline` (secondary, unmodified).
  - Visual screenshots at 1440px, 390px, and 320px confirming the header
    wraps cleanly (no cut-off control) and the results-header/boundary/
    card changes render as intended in the existing dark visual style.

## Acceptance criteria

- [x] The sort select sits in `.results-header`, next to the result
      count; no new sort value or logic was added.
- [x] A visible border/whitespace boundary marks the filter-layer/results
      seam, using existing design tokens only.
- [x] Exactly one card action reads as visually primary depending on
      whether the restaurant has a menu; no action is removed, hidden, or
      made less accessible.
- [x] `/restaurants` has zero horizontal overflow at 1440px, 390px, and
      320px; no header control is cut off or removed.
- [x] `npm run build` succeeds; bundle impact reported.
