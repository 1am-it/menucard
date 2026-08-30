# THEME — Theme Token System (Light + Dark) — done

## Status

Done. Implemented ahead of its originally planned position in the sequence
(originally: after BE-06/BE-04/BE-07/BE-05) — see
`planning/decisions/006-theme-token-system-implemented-early.md` for why.

## Depends on

BE-03 (done). Not blocked on BE-02b/BE-02c beyond that, and not blocked on
BE-06/BE-04/BE-07/BE-05 — those tickets now build on top of this ticket's
token system rather than the other way around.

## Goal

Support the documented light design direction (`docs/mockups/`) while
preserving dark mode as a fully supported, user-selectable theme — without
redesigning any page's information architecture, structure, or behaviour.

## What was delivered

- **A complete design-token layer** in `app/globals.css` (`:root` custom
  properties) covering every color that was previously hardcoded — surfaces,
  borders, text, tags, status colors (danger/warning), the allergy-filter
  accent, gradients, shadows, and scrollbar/selection colors.
- **Both palettes defined simultaneously**: the original dark values remain
  the base `:root` (so "no stored preference" renders identically to the
  pre-THEME app), and a light palette is defined twice — once under
  `@media (prefers-color-scheme: light)` guarded to not apply when the user
  explicitly forced dark, and once under `:root[data-theme="light"]` for an
  explicit choice regardless of OS preference.
- **A Light/Dark/System toggle** (`src/components/ThemeToggle.js`), the same
  component reused in every page's header, storing the choice in
  `localStorage` under `bredaeats_theme`.
- **A blocking init script** in `app/layout.js` that applies the stored
  preference to `<html data-theme="...">` before first paint (avoiding a
  theme-flash), defaulting an unset/first-visit preference to `'dark'` — not
  to system preference — so behaviour is unchanged for anyone who never
  touches the toggle. `<html>` carries `suppressHydrationWarning` since this
  script intentionally sets an attribute React's server render doesn't know
  about (the standard, accepted pattern for this technique).
- **Inline `style={{...}}` colors tokenized too**, not just CSS classes —
  `app/page.js`, `app/restaurant/[id]/page.js`, `app/menu/[id]/page.js` and
  `app/nvwa/[id]/page.js` all had hardcoded hex/rgba colors in JSX `style`
  props (dynamic ones, e.g. the NVWA compliance-score color, were refactored
  into a small tone-lookup object rather than left as inline hex ternaries).

## Explicitly out of scope (and not touched)

- Any page restructuring, copy change, or new component beyond the toggle
  itself.
- Search, ranking, filters, reservation logic, or data loading — untouched.
- A full WCAG contrast audit — see "Known limitations" below.
- Migrating away from CSS custom properties to a CSS-in-JS or design-system
  library — deliberately avoided per "avoid large new dependencies."

## Known limitations

- **Contrast**: the highest-traffic color pairings (accent-on-background,
  button-label-on-accent) were checked against real contrast ratios; the
  green accent for the light theme was deliberately darkened from
  `#06C167` to `#087f45` because the original hex fails WCAG AA as text on
  white (~2.4:1). Secondary/decorative tokens (tags, warning, danger, the
  allergy-filter purple) were darkened by the same heuristic for the light
  theme without individually recomputing each ratio — not a certified audit.
- **Minor legacy-value consolidation**: a handful of near-duplicate dark
  color literals (e.g. `#1a1a1a` vs `#1f1f1f`, `#666` vs `#888`) were folded
  onto a single shared token during tokenization. This is an intentional,
  low-risk simplification of what was already inconsistent, not an
  oversight.
- **Print styles** (`@media print` in `app/globals.css`) are intentionally
  left as literal black-on-white values — printed output shouldn't follow
  the on-screen theme.

## Acceptance criteria

- [x] Support the documented light design direction and preserve dark mode
      as a supported user-selectable theme.
- [x] `system` mode included, since it stayed simple and low-risk (a media
      query plus one script branch).
- [x] One shared component/layout system across themes — no theme-specific
      structural variants; every page renders the same JSX regardless of
      theme.
- [x] Colors, borders, surfaces, and text styling moved into reusable theme
      tokens.
- [x] Accessibility/contrast addressed for primary pairings (see "Known
      limitations" for what wasn't individually re-verified).
- [x] Lightweight, text-first product feel preserved in both modes — no new
      imagery, no large new dependencies (`playwright` was used only for
      local screenshot verification during implementation, not shipped).
- [x] Existing behaviour intact — verified via `npm run build` (unchanged
      bundle sizes aside from the toggle component) and Playwright
      screenshots across `/`, `/restaurant/[id]`, `/menu/[id]`, `/nvwa/[id]`,
      `/search` in both themes plus `system` mode under both emulated OS
      preferences.
