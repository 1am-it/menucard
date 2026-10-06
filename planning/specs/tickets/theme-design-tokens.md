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

## Addendum — theme choice in the internal UI (2026-10-06)

A read-only production check of `/internal/source-workqueue` found that
emulating `prefers-color-scheme: dark` left the page on
`data-theme="light"`, and that the internal UI had no theme toggle. Both
follow from the decided contract, not from a broken chain:

- The theme is an explicit per-browser choice (`localStorage`
  `bredaeats_theme`, `light` or `dark`), dark when nothing is stored
  (decision 006). The OS preference is deliberately **not** followed: BE-09
  removed "Systeem" and only uses `prefers-color-scheme` once, to migrate a
  legacy stored `system` value. A browser that had stored `light` therefore
  stays light under an emulated dark OS preference.
- The gap was that internal pages had no way to make that choice: the
  shared `ThemeToggle` was only mounted in the public headers, while this
  ticket says "the same component reused in every page's header".

Fix: `src/components/InternalNav.js` mounts the same shared `ThemeToggle`
once, next to Sign out, so every internal page that uses the internal nav
gets it. No internal-only theme logic, storage key or default was added,
and `app/layout.js`'s init script is unchanged. Inside the internal nav
only, the inactive toggle option uses `--text-secondary` instead of
`--text-muted` (measured 4.39:1 light / 3.09:1 dark before, at least
5.08:1 / 7.64:1 after) and gets a visible focus ring; the public header's
`.theme-btn` styling is unchanged (its inactive option has the same low
contrast — a separate, pre-existing follow-up, not changed here).
Internal pages without the internal nav (login, activation, set-password)
still apply the stored choice through the init script but show no toggle.

## Addendum — Onze Menukaarten brand accent (2026-10-06)

Implements the chosen Claude Design direction "5 · Oker licht — uitgewerkt
(okergeel)" (see `docs/guides/design-reference.md`, "Wordmark and brand
accent"). The theme contract (explicit Licht/Donker, dark default, no live
OS following) is unchanged. The light values are the approved handoff
values; the dark values are derived for contrast on the existing dark
surfaces.

| Token | Light | Dark |
|---|---|---|
| `--accent` | `#7A4E00` | `#F2C35B` |
| `--accent-dim` | `#5E3C00` | `#E0AA36` |
| `--accent-fill` | `#F2C35B` | `#F2C35B` |
| `--accent-fill-hover` | `#E8B648` | `#E3B04A` |
| `--on-accent-fill` | `#1F1600` | `#1F1600` |
| `--accent-faint` | `#FDF3D8` | `rgba(242, 195, 91, 0.08)` |
| `--accent-border` | `rgba(122, 78, 0, 0.30)` | `rgba(242, 195, 91, 0.28)` |
| `--accent-surface` | `#FDF3D8` | `#2A2109` |
| `--accent-surface-strong` | `#FBE6A8` | `#3A2D0C` |
| `--wordmark` | `#7A4E00` | `#F2C35B` |
| `--mark-bg` / `--mark-text` | `#F2C35B` / inherit | `#3A2D0C` / `#F2C35B` |
| `--warning` | `#9A3412` (was `#8a5a00`, identical to the old brand-adjacent oker) | `#FF9E6B` (was `#ffa000`, too close to the accent) |
| `--input-border` (control border) | `#8A919C` (was `#d7dae0`, ~1.4:1) | `#6b7280` (was `#2a2a2a`) |
| `--bg-hover-accent` | `#FDF8EA` | `#1a170d` |

`--hero-gradient-start(-alt)` were removed: hero and detail surfaces are
flat (`var(--bg)`).

Measured contrast (WCAG 2.x), also asserted in
`src/components/Wordmark.test.js`:

| Pair | Light | Dark |
|---|---|---|
| `--accent` on `--bg` | 7.20:1 | 12.60:1 |
| `--on-accent-fill` on `--accent-fill` | 10.85:1 | 10.85:1 |
| `--accent` on `--accent-surface` | 6.51:1 | 9.65:1 |
| `--accent` on `--accent-surface-strong` | 5.82:1 | 8.16:1 |
| `--warning` on `--bg` / `--bg-card` | 7.31:1 | 9.31:1 |
| `--input-border` on `--bg` / `--bg-card` (UI, 3:1) | 3.18:1 | 3.91:1 |
| `--accent-fill` as text on white | 1.65:1 — not allowed | — |

`--green` keeps its values and is now a status colour only. Known,
unchanged follow-ups: dark `--text-muted` (`#666666`) stays below 4.5:1;
`--tag-featured` / `--tag-halal` (gold) sit close to the accent hue; the
editor-only moderation approve buttons still use white on `--green`.
