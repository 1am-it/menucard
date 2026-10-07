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
| `--input-border` (control border) | `#808792` (was `#d7dae0`, ~1.4:1; see note) | `#6b7280` (was `#2a2a2a`) |
| `--bg-hover-accent` | `#FDF8EA` | `#1a170d` |

Note on `--input-border`: the handoff value `#8A919C` measures 3.18:1 on
white but only 2.89:1 on `--bg-elevated` and 2.78:1 on `--bg-hover`, where
controls also sit. The light value was darkened to `#808792` so the control
border reaches 3:1 on every surface token (follow-up of 2026-10-07).

`--hero-gradient-start(-alt)` were removed: hero and detail surfaces are
flat (`var(--bg)`).

Measured contrast (WCAG 2.x) against the backgrounds the tokens are
actually used on (light `--bg`/`--bg-card` `#ffffff`, `--bg-elevated`
`#f3f4f6`, `--bg-hover` `#eef0f2`; dark `--bg` `#0a0a0a`, `--bg-card`
`#111111`, `--bg-elevated` `#181818`, `--bg-hover` `#222222`). Also asserted
in `src/components/Wordmark.test.js`:

| Pair | Light | Dark |
|---|---|---|
| `--accent` on `--bg` | 7.20:1 | 12.00:1 |
| `--accent` on `--bg-card` | 7.20:1 | 11.45:1 |
| `--accent` on `--bg-elevated` / `--bg-hover` | 6.54:1 / 6.30:1 | 10.77:1 / 9.65:1 |
| `--on-accent-fill` on `--accent-fill` (hover) | 10.85:1 (9.56:1) | 10.85:1 (9.02:1) |
| `--accent` on `--accent-surface` (selected states) | 6.51:1 | 9.65:1 |
| `--accent` on `--accent-surface-strong` | 5.82:1 | 8.16:1 |
| `--warning` on `--bg` / `--bg-card` | 7.31:1 / 7.31:1 | 9.76:1 / 9.31:1 |
| `--border-focus` (= `--accent`) on `--bg` (UI, 3:1) | 7.20:1 | 12.00:1 |
| `--input-border`, minimum over all surface tokens (UI, 3:1) | 3.17:1 (on `--bg-hover`; 3.62:1 on `--bg`) | 3.29:1 (on `--bg-hover` / `--accent-surface`; 4.10:1 on `--bg`) |
| `--accent-fill` as text on white | 1.65:1 — not allowed | — |

Selected states (2026-10-07): the full okergeel fill is only for the
primary button, the homepage keyword marker and an active tab underline
(handoff rule). Selected chips, active navigation, the active theme option
and similar toggles use `--accent-surface` with `--accent` text and a 1px
`--accent` ring.

`--green` keeps its values and is a status colour in the public UI and the
shared navigation. Known exceptions outside this scope, left unchanged:
the coverage dashboard's table header tint and headline number
(`app/internal/coverage/page.js`), the editor-only moderation approve
buttons (white on `--green`, `app/internal/moderation/page.js`) and the
import-inbox info banner (`.di-banner-info`). The handoff also proposed a
darker open-green (`#1B6B3A`) and a neutral info colour; neither is
implemented — the current `--green` meets 4.5:1 (5.08:1 on white). Other
known, unchanged follow-ups: dark `--text-muted` (`#666666`) stays below
4.5:1; `--tag-featured` / `--tag-halal` (gold) sit close to the accent hue.

## Addendum — Kleurtaal v2 (2026-10-07)

Implements the final design source "Onze Menukaarten — Kleurtaal v2
(Brontriage)" for public and internal UI. The rules, the full token table
and the status roles live in `docs/guides/design-reference.md`
("Kleurtaal v2"); this addendum records the migration. The theme contract
is unchanged: explicit Licht/Donker, dark is the runtime default, no
system option. Dark behaviour and the dark base surfaces (`#0A0A0A`,
`#111111`, `#181818`), text, accent and control-border values are
unchanged; the visual refinements dark does receive are listed under
"Dark: what changed, and its source" below. Both light blocks (media +
explicit) stay identical.

Old → new (light unless noted):

| Token | Before | After |
|---|---|---|
| `--bg` / `--bg-card` | `#ffffff` / `#ffffff` | `#FCFAF4` / `#FFFDF9` |
| `--bg-elevated` | `#f3f4f6` | `#F5F3EE` |
| `--bg-input` | `#ffffff` | `#FFFDF9` (derived: same as card) |
| `--text-primary` / `--text-secondary` | `#14181c` / `#4b5563` | `#1A1410` / `#5C5650` |
| `--border` | `#e3e5e8` | `#EFE8D8` |
| `--input-border` | `#808792` | `#8E877B` |
| `--accent-fill`, `--mark-bg` | `#F2C35B` | `#F6C057` |
| `--accent-surface`, `--accent-faint` | `#FDF3D8` | `#FEF1D5` |
| `--wordmark` | `#7A4E00` | `#1A1410` (+ new `--wordmark-icon` `#B28110`) |
| `--nav-indicator` | — | new: `#D8BC7A` light / `#F2C35B` dark |
| `--header-bg` / `--sticky-bg` | white, 0.92 / 0.94 | `rgba(252, 250, 244, …)` (derived from `--bg`) |
| `--tag-featured` | `#8a6a00` (4.33:1 on white, below AA) | `#735800` (5.54:1 on its tint over the card) |
| `--status-*` (6 roles × text/`-bg`/`-border`), `--status-radius` | — | new, both themes |
| `--green`, `--green-faint`, `--green-border` | light `#087f45`…, dark `#06C167`… | aliases of `--status-positive*`, defined once in the dark `:root` |
| `--green-dim`, `--green-surface(-strong)`, `--green-glow` | defined, unused | removed |
| `--danger`, `--danger-bg` | light `#c62828`, dark `#ff4444` | aliases of `--status-blocked(-bg)` (light `#8A1C12`, dark `#FF6B6B`); dark `--danger-border` keeps its former 20% alpha |
| `--warning`, `--warning-bg` | light `#9A3412` (rust), dark `#FF9E6B` | aliases of `--status-old(-bg)` (light `#5A3A0A` oker, dark unchanged) |
| `--whatsapp-bg/-border/-hover-bg` | green tints | removed; the WhatsApp button is outlined oker like `.rc-reserve-btn` |
| `--text-muted`, `--text-dim`, `--text-faint` | used for readable text | values unchanged; decoration only. All 165 readable uses moved to `--text-secondary` |

Green applications moved:

- To oker: moderation approve buttons (white on green → `--accent-fill` /
  `--on-accent-fill`).
- To the soft accent: the import-inbox info banner (`--accent-surface`,
  1px `--accent`, primary text).
- To neutral: coverage table header tint (`--bg-elevated`), coverage
  headline number (`--text-primary`), the coverage "Internal only" label,
  `.tag-vegetarisch` / `.tag-vegan` (outlined, `--text-secondary`, leaf
  icon), the WhatsApp reservation button tint.
- To `--status-positive` with icon + text: "Open" on the menu page, the
  restaurant detail page, the legacy `/restaurants` card and the browse
  card (`.lrc-status`); "Approved (internal only)" and "Complete" in the
  import inbox (list chip, summary tile, detail) and "Approved" in the
  onboarding menu review; Bronwerkvoorraad "Bereikbaar"; coverage
  "Complete"; the set-password success message; moderation "Domain match".
- Not a status, so not `--status-positive`: `.hours-today` (today's row
  is a presentation marker — ink-oker day label, primary-text times,
  `aria-current="date"`; see the correction below).
- Removed as dead CSS (no reference anywhere in `app/` or `src/`):
  `.rc-open-status`, `.rc-open-dot*`, `.rc-open-label*`,
  `.dish-result-status.*`.
- Dots replaced: coloured status dots became `StatusIcon` + text; the
  "Nu open" filter buttons show a decorative clock icon (the button text
  and its active state carry the meaning).

Also aligned: internal navigation active destinations now use
`--accent-surface` + 1px `--accent` ring (the soft treatment this file
already prescribes), and every status chip on the import inbox,
onboarding and profile-draft screens carries an icon next to its text.

Dark: what changed, and its source. Dark behaviour, the stored theme
choice, the runtime default and the base surfaces are unchanged, but dark
is not frozen pixel for pixel. This is the complete list of visual
refinements dark receives on this branch, each carried by the design
source or by existing documentation:

| Dark change | Source |
|---|---|
| Status roles (`--status-*`): role colour as text and 1px border, 10% fill, 6px radius (`.status-badge`, `.swq-badge`, `.di-chip`) — so Bronwerkvoorraad badge text and the internal chips now take their role colour and border | PDF, "Semantische statusrollen" (dark: "statuskleur op 10% met 1px rand") |
| `--danger` `#ff4444` → `#FF6B6B` (via `--status-blocked`) | PDF, "Vervangt --danger (#C62828 / #FF4444)" |
| "Actie nodig" tokens (`--status-action*`), reserved, not assigned | PDF, "Donker ongewijzigd, aangevuld met Actie nodig" |
| Readable text from `--text-muted`/`--text-dim`/`--text-faint` to `--text-secondary` | PDF, hard rule for secondary text |
| No green outside a positive status: moderation approve buttons oker, info banner soft accent, coverage header/headline neutral, WhatsApp reservation button outlined oker instead of a green tint | PDF, "Bestaande groene toepassingen" and "nooit merk, knopkleur" |
| Internal navigation active destination: `--accent-surface` + 1px `--accent` ring | existing rule in this file / design-reference ("selected chips, active navigation … soft treatment") |
| Dietary labels (vegetarisch/vegan): green tint → neutral outlined label with a leaf icon | PDF, "dieet is geen successtatus" |
| Status dots → icon + text badges (open/closed indicators, "Nu open" filter button shows a clock) | PDF, "Waar nu alleen een stip staat: stip vervangen door icoon + tekst" |
| Public "Open" badge: green only when open at this moment, otherwise a neutral clock line ("Opent vandaag om …", "Nu gesloten · …") | PDF, positive = "Nu open" |
| `.hours-today`: green → ink-oker day label and primary-text times | PDF, accent as text; today is not a status |
| Internal status chips per meaning: only approved/complete green, failed import run / failed request red, everything else neutral grey (previously blue, orange, red or green by status name) | PDF status roles; `src/lib/statusRoles.js` |
| Incomplete data and uncertainty orange → neutral grey: NVWA score, NVWA note and "?" marks, menu-card "Allergeneninformatie onbekend" badge and border, search low-coverage note, Coverage "Partial" and "Menu data is limited", import-inbox missing fields / possible duplicate / phone format / robots unconfirmed / suggestion warnings, profile-draft duplicate note, onboarding conflict note and notice banners; moderation "No domain match" / "Already has an owner" orange → grey | PDF, `--status-old` only for the four source states |
| Errors that were orange become red: import inbox failed-run banner, search restaurant-load error | PDF, blocked = "laad- en validatiefout" |
| Coverage secondary text `#8f8f8f` → `--text-secondary` `#aaaaaa` | PDF, hard rule for secondary text |
| Confidence (onboarding): coloured chip → neutral outlined label "Betrouwbaarheid: …" | not a status (design-reference) |
| Disabled "Suggest data from website" button: dashed border | keeps the text at AA instead of fading it |

Reverted because neither source covers it: a stronger dark
`--danger-border` (0.35 alpha) — it is back at the former 20% alpha, in
the new `#FF6B6B` hue.

Correction (2026-10-07, review round). The first implementation mapped
shared chip class names to status roles globally, so screens that were
not migrated showed the wrong meaning. Fixed:

- `.di-chip`, `.di-summary-icon` and `.di-status-icon` now only have
  role classes (`--positive`, `--blocked`, `--neutral`, plus
  `.di-chip--label` for non-status labels); each screen picks the role
  per meaning in `src/lib/statusRoles.js`. `.di-chip` takes the status
  shape (`--status-radius`).
- The unapproved "New → Actie nodig" mapping is withdrawn from code and
  documentation. `--status-action` stays a reserved design role;
  assigning it to a business state is a future product decision.
- Conservatively neutral until that decision: New / Not yet reviewed /
  Needs review / Needs enrichment / Deferred / Rejected, Incomplete,
  "possible duplicate", running/partial/succeeded import runs, "Bezig…",
  "Voorstel aangemaakt", "Al voorgesteld", profile drafts, coverage
  "Partial", moderation "No domain match" / "Already has an owner".
- Confidence hoog/middel/laag (onboarding restaurant) is not a status:
  neutral outlined label, no status colour or icon.
- Incomplete data is not an error: NVWA "grotendeels nog niet
  vastgelegd" and the onboarding field-conflict note no longer use
  `--danger` (first moved to `--warning`; superseded by the second
  review round below, which makes them neutral).
- The coverage page's own secondary colour (`--cov-text-subtle`) is
  removed; its secondary text is `--text-secondary`.

Correction (2026-10-07, second review round):

- Public "Open": `MenuView`, `RestaurantDetailView` and the legacy
  `/restaurants` card showed a green "Open · …" whenever today had
  opening hours, also at night. Now `src/lib/openingStatus.js` (pure,
  tested with fixed moments) gives "Nu open · tot …" (positive) only
  while open, and a neutral clock line otherwise; the browser clock is
  read after mount (`src/components/useClientNow.js`), so the server
  render is always neutral.
- `--warning` (alias of `--status-old`) is no longer used for any
  content: incomplete data, missing NVWA data, conflicts, duplicates and
  similar uncertainty use the neutral role; `.di-banner-warning` and the
  unused `.badge-warning` are removed; real errors in those slots use the
  error role. The robots.txt block on a read page is "Robots
  geblokkeerd" and uses the blocked role with icon + text
  (`robotsTxtRole()`; corrected in a later review round — it briefly
  used `--status-old`, which the design source reserves for the four
  source states). The `--warning*` and `--warning-strong-border` tokens stay
  only as unused compatibility aliases.
- Moderation neutral states use a neutral dot icon instead of the
  attention icon; confidence reads "Betrouwbaarheid: …".

Measured (WCAG 2.x; asserted in `src/lib/colourLanguage.test.js`):

| Pair | Light | Dark |
|---|---|---|
| `--text-secondary` on bg / card / elevated / accent-surface | 6.93 / 7.12 / 6.53 / 6.46 | 8.52 / 8.13 / 7.64 / 6.85 |
| `--accent` on bg / accent-surface | 6.90 / 6.43 | 12.00 / 9.65 |
| `--on-accent-fill` on `--accent-fill` | 10.74 | 10.85 |
| `--input-border` on bg / elevated / hover (UI 3:1) | 3.41 / 3.21 / 3.11 | 4.10 / 3.67 / 3.29 |
| Focus ring (`--accent`) on bg | 6.90 | 12.00 |
| Status minima | see design-reference table | "Actie nodig" 8.70 |

`--nav-indicator` light (`#D8BC7A`, 1.77:1) and `--wordmark-icon`
(`#B28110`, 3.33:1) are decorative; the active tab is also carried by its
`--accent` text, the wordmark by its text and accessible name.
