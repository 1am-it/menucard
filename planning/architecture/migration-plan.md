# Architecture — Migration Plan

This document covers the `BE-*` dish-first migration only. The separate,
parallel data-platform track (`PLATFORM-*`) is documented in
[platform-plan.md](./platform-plan.md) — it does not reorder or depend on
anything below.

## Strategy

Evolve the existing BredaEats application incrementally.

Do not create a separate v2 codebase unless the audit discovers a strong
technical reason.

## Current conceptual flow

Homepage
→ restaurant
→ menu
→ dish

## Target conceptual flow

Homepage
→ dish search
→ dish results
→ restaurant menu
→ reservation

## Migration phases

Revised 2026-08-29 after external review of the BE-01 audit. BE-02 was split
into three smaller tickets to keep functional regressions isolable, the
theming work was pulled out into its own workstream, and the ticket order was
rearranged so the server-side search foundation lands before any homepage or
menu restyling begins.

Revised again 2026-08-30: THEME landed ahead of BE-06/BE-04/BE-07/BE-05 once
its actual scope turned out to be a token system + a user-selectable
light/dark toggle applied to unchanged pages, rather than a one-way visual
flip of already-restructured pages. See
[[006-theme-token-system-implemented-early]].

### BE-01 — Audit (done)

Inspect:

- architecture
- routing
- data models
- search
- filters
- assets
- data loading
- performance

Delivered:

- reusable components list
- replacement candidates
- minimal-risk migration sequence
- backend/API impact
- regression risks

### BE-02a — Data model repair

**Scope**: Normalize price to a numeric field (keep display string
derived from it, not the other way around). Add explicit reservation fields
(`reservationType`, `reservationUrl`, `reservationPhone`,
`reservationWhatsapp`) to the restaurant model instead of inferring
reservation method from presence of a phone number. Define the dish-result
shape that BE-02b/BE-03 will consume (dish name, price, restaurant, short
description, dietary tags, distance/open-status where available, menu link).
Reconcile `allergens: null` (unknown) vs `[]` (none) consistently across the
dataset.

**Key risk**: Silent data-shape drift — existing pages (`/menu/[id]`,
`/restaurant/[id]`, `/nvwa/[id]`) read the current JSON shape directly and
must keep working while the shape is repaired.

**Acceptance criteria**:
- Every menu item has a numeric price or an explicit "price on request" state.
- Every restaurant has an explicit reservation method, never inferred.
- A documented dish-result shape exists that BE-02b can query into.
- Existing routes render unchanged against the repaired data.

### BE-02b — Server-side search / data access layer

**Scope**: Move dish/restaurant data and query logic server-side (route
handler or server component), returning only the fields required for the
current view. This is the hard prerequisite for BE-04 and BE-05 — see
[[004-server-side-search-before-restyle]].

**Key risk**: Building this against a data shape that BE-02a hasn't actually
finished repairing yet — sequence matters, don't parallelize with BE-02a.

**Acceptance criteria**:
- A search/query endpoint exists that accepts query + filters and returns a
  bounded, paginated result set.
- No route ships the full restaurants/menus dataset to the client anymore.
- Response payload for a typical search stays within the performance budget.

### BE-02c — Dish ranking and result mapping

**Scope**: Define and implement match/ranking rules (exact dish-name match vs
ingredient/tag/restaurant-name match) and map query results into the BE-02a
result shape.

**Key risk**: "Finding steak" is easy; ranking multiple plausible matches
usefully is where this quietly turns into a UX problem if left implicit.

**Acceptance criteria**:
- Documented ranking rules (what wins: name match, ingredient match, tag
  match, restaurant-name match).
- Ranking is covered by the search endpoint from BE-02b, not reimplemented
  client-side.

### BE-03 — Dish search results

**Scope**: Text-first dish result rendering with price-first hierarchy,
consuming BE-02b/BE-02c. Existing dark theme stays in place for this ticket.

**Key risk**: Conflating this with the theme change — don't.

**Acceptance criteria**:
- Result list matches the information hierarchy in
  `planning/specs/dish-first-discovery.md`.
- Pagination/"Meer resultaten laden" works against the bounded server
  response from BE-02b.
- Graceful empty/no-result state.

### THEME — Theme token system (done)

**Scope**: Implemented ahead of its originally planned position — see
[[006-theme-token-system-implemented-early]]. Delivered a complete design
token layer (`app/globals.css` `:root` custom properties) covering every
color previously hardcoded in CSS and in inline `style={{...}}` props across
`app/page.js`, `app/restaurant/[id]/page.js`, `app/menu/[id]/page.js` and
`app/nvwa/[id]/page.js`. Both a light palette (per `docs/mockups/`) and the
original dark palette are defined simultaneously and switchable via a
user-facing Light/Dark/System control (`src/components/ThemeToggle.js`),
persisted in `localStorage`. A blocking inline script in `app/layout.js`
applies the stored preference before first paint to avoid a flash of the
wrong theme. No stored preference resolves to dark, matching the app's exact
pre-THEME appearance — the change is invisible until a visitor opts in.

**Key risk**: Doing this at the same time as a structural/functional change
would make it impossible to tell whether a regression is visual or
behavioural. Mitigated here because no page's structure, copy, routing,
search, ranking, filters, reservation logic, or data loading changed — every
diff was a color-literal-to-token substitution or additive (the toggle
component, the init script).

**Residual gaps** (tracked, not silently resolved):
- A handful of near-duplicate legacy color literals were deliberately
  consolidated onto shared tokens during tokenization (e.g. several
  slightly-different dark greys all became `--border` or `--bg-hover`).
- Contrast was rigorously checked for the highest-traffic pairings
  (accent-on-background, button-label-on-accent) and adjusted by the same
  darkening heuristic for secondary/decorative tokens (tags, warning,
  danger, allergy accent) without recomputing an exact ratio for each one —
  not a full WCAG audit.
- The print stylesheet (`@media print` in `app/globals.css`) is intentionally
  left un-tokenized — print output should always be black-on-white
  regardless of the on-screen theme.

**Acceptance criteria**:
- [x] Design tokens exist and are used consistently instead of
      hardcoded/inline colors.
- [x] Light theme matches the mockups' contrast, spacing and border
      treatment.
- [x] Dark theme is preserved and remains the default for visitors with no
      stored preference.
- [x] One shared component/layout system across both themes — no
      theme-specific structural variants.

### BE-06 — Filters + URL state

**Scope**: Price, cuisine, and allergy filtering on top of the new search
flow, represented in URL/query state so results are deep-linkable and support
back/forward navigation.

**Key risk**: SEO/deeplinks — existing indexable routes and any shared links
must be deliberately mapped onto the new URL scheme, not silently replaced.

**Acceptance criteria**:
- Filters are reflected in the URL and restorable from it.
- Filtering does not reload unrelated data or refetch the full dataset.

### BE-04 — Homepage shift

**Scope**: Make search the primary homepage action, per
`docs/mockups/homepage-v1.png`. Restaurant browsing may remain as a secondary
route. Requires BE-02b to be live — do not build this against static JSON.

**Key risk**: Breaking existing persisted user state (localStorage filters,
guided day/meal flow) that the current homepage depends on.

**Acceptance criteria**:
- Search is the primary above-the-fold action.
- Old guided flow either removed deliberately or kept behind a route
  variant/feature flag, not silently abandoned mid-migration.

### BE-07 — Reservation routing

**Scope**: CTA behaviour follows the real reservation capability per
restaurant, using the `reservationType`/`reservationUrl`/`reservationPhone`/
`reservationWhatsapp` fields from BE-02a. Never display a reservation method
the restaurant doesn't actually support.

**Key risk**: Losing currently-working WhatsApp leads while fixing the
incorrect "every restaurant with a phone number accepts WhatsApp" assumption.

**Acceptance criteria**:
- CTA label reflects the real action (Reserveer / Reserveer online /
  Reserveer via WhatsApp / Bel restaurant).
- No restaurant shows an unsupported reservation method.

### BE-05 — Restaurant menu

**Scope**: Refactor the restaurant detail/menu experience toward a
lightweight universal menu view per
`docs/mockups/restaurant-menu-v1.png`. Requires BE-02b to be live.

**Key risk**: Low relative to other tickets — the existing `/menu/[id]` page
is already structurally close to the target, and the theming ticket has
already landed with a working token system to build on; treat this mostly as
adapting to the BE-02b data layer plus any remaining structural gaps.

**Acceptance criteria**:
- Matches `planning/specs/restaurant-menu.md`.
- No dish images required; reservation CTA visible and correct per BE-07.

### BE-08 — Performance cleanup

Remove unnecessary asset/dependency weight and validate that the new flow
stays within performance targets, including a before/after comparison against
the analytics baseline captured before BE-03 shipped.

## Technical principles

- Preserve existing routes where practical.
- Prefer compatibility shims over wide rewrites.
- Keep old and new flows coexisting temporarily if this reduces risk, behind
  feature flags or separate route variants rather than ad hoc branching.
- Avoid large new dependencies.
- Move expensive data work away from the client when possible.
- Keep implementation steps independently testable.
- Capture an analytics/performance baseline before BE-03 ships, so the
  dish-first flow's impact can actually be measured afterward.
