# BE-09 — Consumer UX Polish: Contact Validity, Calmer Filters, Nav Consistency, A11y

## Depends on

None functionally — this is a small, independent polish ticket against the
existing, already-shipped `BE-*` consumer app. Touches the same surfaces
`BE-07` (reservation routing) and `BE-04`/`BE-06` (homepage shift, filters)
already established; extends their conventions rather than replacing them.

## Goal

Improve the calmness, clarity, and trustworthiness of the existing consumer
experience — no new data promises, no change to the static consumer read
path, no visual redesign.

## Scope

1. **Invalid contact/reservation actions hidden.** Added `isValidPhone()`
   and `isValidUrl()` guards to `src/utils/reservation.js` (the existing,
   designated single source of truth for reservation actions) and applied
   them everywhere a restaurant's `phone`/`whatsapp`/`website` value is
   read directly. A placeholder string (e.g. `"Via website"` stored as a
   phone/WhatsApp value) or an empty/implausible value no longer renders as
   a dead `tel:`/`wa.me` link; a genuinely valid website action is
   unaffected.
2. **Dead ranking language removed.** Removed the `⭐ Best beoordeeld`
   toggle (tracked and persisted state that never affected filtering) and
   its `localStorage` key. Renamed the `'best'` sort option's label from
   "Best beoordeeld"/"Best rated" to "Standaardvolgorde"/"Default order" —
   the sort behavior itself (id order) is unchanged; only its previously
   inaccurate name changed. No rating/ranking data or logic was added.
3. **Calmer default filter layer on `/restaurants`.** Price, buurt, keuken,
   and allergy filters now live behind a "Filters" toggle, reusing the
   exact pattern and CSS classes already shipped on `/search`
   (`filters-toggle-btn`/`filters-panel`/`filters-panel-group`). Search,
   meal type, day selection, and "Nu open" remain directly visible.
   `/search` itself is unchanged.
4. **Consistent navigation and CTAs.** `← Alle restaurants` on
   `/restaurant/[id]` and `/menu/[id]` now actually links to `/restaurants`
   (previously pointed at `/`, a leftover from before `BE-04` relocated the
   restaurant overview). Standardized the two generic "go to the full menu
   page" CTAs to "Bekijk menu →" (`RestaurantCard`'s dropdown-adjacent link,
   `RestaurantDetailView`'s menu-preview link); meal-type-specific labels
   (e.g. "Lunchkaart") and the primary hero CTA ("Bekijk menukaart") are
   unchanged.
5. **Card hierarchy and accessibility.** `RestaurantCard`'s second footer
   row (reservation actions) now renders only when at least one action
   passed validation, removing a residual empty gap. Every icon-only
   reservation action now has `aria-label` (its existing label text) and
   its decorative SVG is `aria-hidden`.
6. **Contrast measured, not changed.** Measured actual WCAG contrast ratios
   for `--text-dim`/`--text-faint` against their real backgrounds in both
   themes (see report below) — confirms the "not a certified audit" gap
   `planning/specs/tickets/theme-design-tokens.md` already flagged. No
   token value changed in this ticket; a real, measured shortfall exists
   and is reported as a separate follow-up proposal, not fixed here.
7. **"Systeem" removed from the theme picker.** Added after the rest of
   this ticket's scope, on explicit direction: `src/components/ThemeToggle.js`
   now offers only `Licht`/`Donker` — the `system` option and its
   `prefers-color-scheme`-following behavior are removed from the picker.
   A pre-existing stored `'system'` value is migrated exactly once, in the
   existing blocking init script (`app/layout.js`, unchanged in
   position/timing from `THEME`'s original flash-prevention mechanism):
   resolved synchronously via `matchMedia('(prefers-color-scheme: light)')`
   to a concrete `light`/`dark` value, applied immediately (no flash), and
   written back to `localStorage` so it is never read as `'system'` again.
   `app/globals.css`'s `prefers-color-scheme` media-query block is left in
   place, unused going forward, rather than removed — out of scope for this
   correction (see Out of scope).

## Out of scope

- Any visual redesign or new visual language.
- `Dagmenu vandaag`, `Specialiteit`, source/freshness badges, or any real
  data-driven sort/ranking.
- `Beste match`, `Recent bijgewerkt`, or any other new sort logic.
- `MARKET-04` import, database/Supabase changes, canonical data, snapshot
  layer, or any new API.
- Changing shared color tokens (see point 6 above).
- Removing the now-unused `prefers-color-scheme` CSS block from
  `app/globals.css` (see point 7 above) — leaving dead-but-harmless CSS in
  place rather than expanding this correction's diff further.
- `outputs/` or mockup files.

## Key risk

The filter-layer reorganization (point 3) is the most visible change.
Mitigated by reusing a pattern already live and validated on `/search`,
not inventing a new one — every filter still filters identically; only its
default visibility changed. Saved filters, active-filter tags, and reset
all continue to work regardless of whether the panel is open or closed
(verified: an old `localStorage` value containing the now-removed
`bestRatedOnly` key loads without error).

## Verification performed

- No existing test framework/runner is configured in this repository
  (`package.json` has no `devDependencies`, `src/tests/` is empty) — adding
  one was judged out of scope for a small polish ticket, so verification
  here is manual/scripted rather than a committed unit-test suite, per
  instruction to only add tests where existing infrastructure supports it.
- `npm run build` passes; bundle impact measured by diffing against a
  stashed pre-change build (see chat report for exact numbers).
- Playwright (ad hoc via `npx`, not added as a dependency — same approach
  already noted as acceptable in `theme-design-tokens.md`) used to:
  - Confirm restaurant id `10` (a placeholder `"Via website"` phone/
    WhatsApp value in `data/restaurants.json`) shows no `tel:`/`wa.me`
    link, only its valid website action.
  - Confirm a restaurant with real contact data (id `1`) keeps working
    identically, with correct `aria-label`s verified via the actual
    accessibility tree (`ariaSnapshot()`), not just source inspection.
  - Confirm both corrected back-links resolve to `/restaurants`.
  - Confirm the "Bekijk menu →" CTA rename applied only to the two generic
    surfaces, and the primary "Bekijk menukaart" CTA is untouched.
  - Confirm old, pre-BE-09 `localStorage` filter state (including the
    removed `bestRatedOnly` key) still loads without error and applies
    filters correctly while the new Filters panel is collapsed.
  - Confirm, via direct module calls, that a fully-placeholder/empty
    `reservation` object now yields zero actions from
    `getReservationActions()` (the shape that makes the footer row-2
    conditional render actually activate — no restaurant in the current
    dataset happens to have zero valid contact fields today, since every
    one has at least a valid website).
  - Confirm "Systeem" appears nowhere on `/`, `/restaurants`, `/search`,
    `/restaurant/[id]`, or `/menu/[id]`, and that the theme switch renders
    exactly two buttons ("Licht", "Donker") on each.
  - Confirm the `'system'` migration itself: with a pre-existing stored
    `'system'` value, emulating each OS color-scheme preference in turn,
    `data-theme` is already resolved correctly (`dark`/`light` matching
    the OS preference) by `domcontentloaded` — i.e. before body content
    paints, no flash — and `localStorage` holds the resolved value
    afterward, not `'system'`. Confirmed a subsequent reload stays stable
    (does not re-trigger migration logic, since the stored value is now a
    genuine `light`/`dark` choice).

## Acceptance criteria

- [x] Invalid/placeholder phone, WhatsApp, and website values never render
      as a dead action; a valid website action still shows when present.
- [x] The dead "best rated" toggle and its unused `localStorage` key are
      removed; the sort option label is accurate and neutral.
- [x] `/restaurants`' default filter view shows search, meal type, day, and
      "Nu open" directly; price/buurt/keuken/allergies sit behind a
      `/search`-consistent "Filters" toggle; `/search` itself is unchanged.
- [x] `← Alle restaurants` links resolve to `/restaurants`; generic menu
      CTAs read "Bekijk menu →"; the primary hero CTA still reads "Bekijk
      menukaart".
- [x] A restaurant card's second footer row only renders with at least one
      valid action; icon-only reservation actions have `aria-label` and
      `aria-hidden` decorative icons.
- [x] Contrast ratios for `--text-dim`/`--text-faint` measured and
      reported; no shared token changed.
- [x] "Systeem" is removed from the theme picker everywhere; only
      `Licht`/`Donker` remain. A pre-existing stored `'system'` value is
      migrated exactly once to a concrete, OS-resolved `light`/`dark`
      value with no visible flash, and persisted so it is never read as
      `'system'` again.
- [x] `npm run build` succeeds; bundle impact reported.
