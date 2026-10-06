# Design Reference

The intended BredaEats direction is a fast, lightweight, text-first interface.

This file is the canonical, durable design context for consumer and
internal UI. It covers visual direction, theming, positioning and
branding, internal navigation, accessibility, status vocabulary and
mockup conventions. Tickets may refine it for their own surface, but must
not contradict it silently. When a ticket changes one of these rules,
update this file in the same change.

Primary design assets live in:

`docs/mockups/`

Start with:

- `docs/mockups/README.md`
- `docs/mockups/homepage-v1.png`
- `docs/mockups/search-results-v1.png`
- `docs/mockups/restaurant-menu-v1.png`

## Visual direction

- no hero photography
- no dish photography in discovery
- strong typography
- generous whitespace
- subtle borders
- compact filter chips
- lightweight icons
- restrained motion
- mobile-first layout

## Information hierarchy

Discovery should emphasize:

1. dish name
2. price
3. restaurant
4. short description
5. dietary tags
6. distance/open status
7. clear menu/reservation actions

Restaurant branding should remain secondary during search and discovery.

## Theming

The mockups above show the light palette, which is the primary/default
design direction going forward. The original dark theme is preserved as a
fully supported, user-selectable alternative — not deprecated — via a
`Licht`/`Donker` toggle (`src/components/ThemeToggle.js`; the earlier
`Systeem` option was removed by
`planning/specs/tickets/be-09-consumer-ux-polish.md`). Anyone who doesn't
touch the toggle keeps seeing dark, unchanged.

Both palettes are implemented through one shared set of CSS custom
properties in `app/globals.css` (see
`planning/specs/tickets/theme-design-tokens.md` for the full token list and
`planning/decisions/006-theme-token-system-implemented-early.md` for why
this was built before the pages that visually depend on it, e.g. the
homepage, were restyled). New UI work should reference these tokens
(`var(--text-primary)`, `var(--border)`, `var(--green)`, etc.) rather than
hardcoded colors, so it works correctly in both themes automatically.

The implemented theme contract, which every new page inherits without
extra work:

- The choice is stored per browser in `localStorage` under
  `bredaeats_theme` (`light` or `dark`).
- With nothing stored, the page renders dark and stores `dark`
  (`THEME_INIT_SCRIPT` in `app/layout.js`).
- The OS colour-scheme preference is not followed as a live choice. It
  is read only once, to migrate a legacy stored `system` value.
- `:root` holds the dark tokens; light is applied through
  `:root[data-theme="light"]`.
- The public header and the internal navigation use the same shared
  `ThemeToggle`. In the internal navigation it sits in
  `.internal-nav-theme`, next to `Sign out` (addendum of 2026-10-06 in
  `theme-design-tokens.md`).
- There is no internal-only theme logic. Login, activation and
  set-password pages show no toggle but respect the stored choice.

**Open wording point (not a contract change):** "primary/default design
direction" above and in `CLAUDE.md` refers to the *design* direction of
the mockups. It is not the runtime default, which is dark (decision 006,
BE-09). Two older documents, `theme-design-tokens.md` and decision 006,
still mention a `Light/Dark/System` toggle; BE-09 superseded that.
Aligning that wording is a separate docs ticket that has not been
scheduled yet.

## Product positioning and branding

BredaEats answers *"Wat wil je vanavond eten, waar kan ik dat krijgen, en
wat kost het?"* It is a dish-first, text-first menu search with real
prices (see `CLAUDE.md`'s mission and product principles, and
`planning/specs/dish-first-discovery.md`).

BredaEats is not a stand-alone ordering, delivery or booking platform. It
takes no orders, deliveries or bookings itself:

- Where a reservation action is visible, it routes to the reservation
  channel the restaurant itself offers (its website or booking page,
  WhatsApp or phone). The label names that channel, e.g.
  `Reserveer via website` (BE-07, `planning/specs/reservation-routing.md`,
  `src/utils/reservation.js`). An unsupported method is never shown.
- Integrating a booking platform's API is out of scope (BE-07,
  "Out of scope").
- User-generated reviews are a non-goal (`dish-first-discovery.md`,
  "Non-goals").
- Nothing is published automatically; see "Source status and menu status
  are separate dimensions" below.

What is decided:

- The visible product name is **BredaEats**. Internal module names are
  plain Dutch labels (`Dekkingsoverzicht`, `Onboarding Restaurant`,
  `Bronwerkvoorraad`, …). No ticket introduces a rebrand or domain
  change (non-goals in BE-14, BE-15 and BE-16).
- Restaurant branding stays secondary during search and discovery. We
  never adopt a restaurant's logo, photography, colours or house style as
  our own UI.
- No restaurant or dish photography appears in the hero, search results
  or listing cards. At most a neutral icon or monogram is used (decision
  002, BE-20 "Visual contract").
- Product names, logos or wordmarks that appear in a mockup are
  placeholders, not adopted branding. Example: the Bronwerkvoorraad
  mockup's top bar reads "Onze Menukaarten", but the built page keeps
  the BredaEats `InternalNav` shell.
- The UI says "stad"/"regio", never "market" (`CLAUDE.md`, decision 011).
- Status and trust labels never suggest more certainty than the data
  carries. No "geverifieerd", score or quality badge appears without
  recorded evidence (PLATFORM-03 trust model, BE-23).

**Not yet decided: forbidden lookalike associations.** No document lists
specific third-party brands, apps or visual styles that BredaEats must
not resemble. Until the product owner records such a list (here, or in a
`planning/decisions/` record), apply only the rules above:

- no borrowed brand names, logos or house styles of restaurants or
  platforms;
- no UI that implies BredaEats itself takes orders, deliveries or
  bookings. A reservation action that routes to the restaurant's own
  channel, as above, is allowed.

Do not invent a fuller policy in a ticket.

## Internal navigation hierarchy

Sources:

- **Decided structure:** BE-20 "Visual contract" and "Approved design
  references", with the leading mockup
  `docs/mockups/internal-navigation-workqueue-v1.png`.
- **Role filtering and the `/internal` home:** PLATFORM-11.
- **Orientation, stability and access rules for every navigation:**
  decision 014.
- **Live behaviour:** `src/lib/internalNav.js` (config) and
  `src/components/InternalNav.js` (render).

### Implemented today

1. **BredaEats wordmark:** the quiet home link to `/internal`.
2. **Primary items:** `Dekkingsoverzicht` (`/internal/coverage`) and
   `Onboarding Restaurant` (`/internal/onboarding-restaurant`).
3. **`Werkvoorraad`:** one accessible `<details>` disclosure. Each entry
   has a short subtitle; the exact texts live in `INTERNAL_MODULES` in
   `src/lib/internalNav.js`. The entries are, in order:
   - `Beheer` → `/internal`;
   - `Nieuwe aanleveringen` → `/internal/import-inbox`;
   - `Bronwerkvoorraad` → `/internal/source-workqueue`;
   - `Profielconcepten` → `/internal/profile-drafts`;
   - `Beoordelen` → `/internal/moderation`, editor only.
4. **Right side:** the shared theme toggle, then `Sign out`.
5. **No counts:** no entry shows a count today. BE-23 added
   `Bronwerkvoorraad` without a badge count and lists "any nav badge
   count" under "Not built (deliberately)".

### Decided direction (not all built yet)

- Werkvoorraad entries may show counts, but only counts that are
  provably computed from real, currently open work items. Never show a
  placeholder or hardcoded number (BE-20 "Visual contract"; BE-20
  acceptance criterion "Werkvoorraad navigation", tested against a
  non-zero and a zero-count state).
- The mockup's 3/2/1 and badge-6 counts are directional only
  (`docs/mockups/README.md`).
- `Beoordelen` groups the existing editor-only Moderation module under
  Werkvoorraad, with route, role gate and data model unchanged (BE-20
  "Visual contract").

### Open product decisions

- **`Beheer` → `/internal`.** BE-20 says `Beheer` is not a separate
  top-level item. No approved mockup or ticket names its destination. The
  mapping to `/internal` is the build's own choice, flagged in
  `src/lib/internalNav.js` for confirmation or correction. Treat it as
  provisional until the product owner confirms it.

### Rules

- A new internal module is a new entry in `internalNav.js`, usually under
  `Werkvoorraad`. It is never a second navigation or a page-local nav.
- Every internal page uses the same order, labels and position. The
  active destination has `aria-current="page"` (decision 014, item 2).
- Role filtering only hides links. Every route and API keeps its own
  server-side authorization check (decision 014, item 4).

## Accessibility and responsive requirements

Where these rules come from:

- **Decision 014** (items 5–8 and 10, and its "Acceptance checklist —
  include in every future UI ticket") carries the keyboard, focus,
  semantics, responsive and dead-end rules below. Every UI ticket must
  meet those.
- **The contrast thresholds** are not in decision 014. They are the
  WCAG AA practice this project already measures against:
  `theme-design-tokens.md` ("Contrast"; addendum of 2026-10-06), BE-09
  item 6, and BE-23's verification. No decision fixes them as a binding
  standard, and no full WCAG audit has been done (decision 006,
  `theme-design-tokens.md` "Known limitations"). Use them as the target,
  and record the measurement.

**Contrast (target: WCAG AA)**

- Text, including small badge, chip and toggle labels, aims for at least
  4.5:1. Focus indicators and essential non-text UI aim for at least
  3:1. Measure in **both** themes.
- Use tokens. When a token fails in a specific context, use a stronger
  existing token there instead of a hardcoded colour. For example, the
  inactive internal toggle option uses `--text-secondary` instead of
  `--text-muted`.
- Record the measured minimum in the ticket.
- Known gap: the public header's inactive toggle option measures 4.39:1
  light and 3.09:1 dark. This is a separate follow-up.

**Status is never colour alone.** Every status badge carries an icon and
the full text, e.g. "Bron: Bereikbaar" (BE-23; decision 014, item 2:
the current destination is "never color alone").

**Keyboard and focus** (decision 014, items 6–7)

- Every interactive element is keyboard-operable, in a focus order that
  matches the visual order.
- Every interactive element has an explicit `:focus-visible` treatment.
  Existing practice uses `var(--border-focus)` or `var(--green)`.
- A page with a navigation region offers a skip-link to the main
  content as its first focusable element. The current `InternalNav` has
  none yet.
- A mobile menu control exposes its expanded/collapsed state. Existing
  toggles expose `aria-pressed` (`ThemeToggle`).
- Focus lands deliberately after navigating or closing an overlay.

**Semantics.** Use real `<nav>`, `<a>`, `<button>` elements and tables
with headers. No `<div>` click handlers and no fake or dead buttons
(decision 014, item 10).

**Responsive** (decision 014, item 5 and acceptance checklist)

- Verify at desktop width and at about 390px, in light and dark. Desktop
  checks so far used about 1280px (e.g. the BE-11 prototype).
- No page-level horizontal overflow (`scrollWidth <= clientWidth`).
- Mobile may collapse a destination or action, never remove it.
- Wide tables may become cards on mobile, as in
  `/internal/source-workqueue` (BE-23 mockup).

**Dead ends.** Logged-out, 403, 404, empty and success states each offer
a working next step (decision 014, item 8).

## Source status and menu status are separate dimensions

Defined in `planning/specs/tickets/be-23-internal-source-workqueue.md`.
The vocabulary there is the only list; reuse it verbatim.

- **Bron** (can we read the source?): `Bereikbaar`, `Niet bereikbaar`,
  `Toegang beperkt`, `Identiteit gewijzigd`.
- **Menukaart** (what do we know about its menu?): `Klaar voor review`,
  `Structuur niet herkend`, `Geen menukaart aangetroffen`,
  `Niet beoordeeld`.
- Always show two separate badges, never one combined status. If Bron is
  not `Bereikbaar`, Menukaart is `Niet beoordeeld`.
- Each row has exactly one next action: `Beoordeel`,
  `Beoordeel handmatig`, `Controleer bron`, `Controleer toegang` or
  `Controleer identiteit`.
- "Nothing recognized" is not evidence of absence (BE-22), so it never
  becomes `Geen menukaart aangetroffen`.
- `Identiteit gewijzigd` and `Geen menukaart aangetroffen` need explicit
  recorded evidence that the data model does not have yet (BE-23,
  "Datamodelkloof").
- These are workflow statuses, not trust labels. Field-level trust and
  provenance (who confirmed what, and when) belong to PLATFORM-03 and
  `planning/specs/platform-trust-model.md`. Never present a workflow
  status as verification.
- Nothing is published automatically from any of these statuses.

### Existing restaurants without a source check are not a new intake

Some restaurants are already in the dataset but have never had a usable
source check. They are listed under "Nog niet in de werkvoorraad" with a
plain reason:

- `Nog nooit gecontroleerd`;
- `Geen website bekend`;
- `Controle loopt nog`;
- `Laatste controle gaf geen bruikbaar resultaat`;
- `Controle niet eenduidig te koppelen`.

Such a restaurant is **not** a new aanlevering, not an
`Onboarding Restaurant` intake and not an import candidate. It gets no
Bron or Menukaart status until a check is attributed to it. Do not label
these restaurants "nieuw", do not route them into
`Nieuwe aanleveringen`, and do not count them as intake volume.

> **Snapshot, 2026-10-06 — not a design rule or a product claim.**
> According to the product owner's production check of
> `/internal/source-workqueue` on that date, none of the 25 Breda
> restaurants had a production source check (a BE-20 analysis job)
> attributed to it. This cannot be reproduced from the repository.
>
> - Offline benchmarks over the same restaurants (BE-20, BE-22) do not
>   count as source checks here.
> - Each restaurant still carries its own reason from the list above;
>   this snapshot does not imply one shared reason.
> - The snapshot goes stale as soon as checks are attributed. Do not
>   copy it into UI text or tickets as a current fact.

## Mockups: location, naming and leading references

- All mockups live in `docs/mockups/`. `docs/mockups/README.md` is the
  index: per mockup, it names the ticket it belongs to and what the
  mockup does and does not govern.
- Mockups govern layout, hierarchy and interaction intent. They never
  govern exact text, example data, counts or brand names.
- Naming is `<surface>-v<N>.png`, or `.html` for an interactive
  prototype. A new version gets a new file (`-v2`). Older files are kept,
  and the index marks which version leads.
- Derived design direction, not a direct rule from decision 002: do not
  commit mockups with restaurant or dish photography.
  - Decision 002 and `CLAUDE.md` forbid that photography in the UI
    itself (hero, dish search results, listing cards).
  - The precedent for mockups is `restaurant-profile-drafts-detail-v1.png`.
    It was never committed for this reason (index,
    `restaurant-profile-drafts` entry). BE-20 "Visual contract" follows
    that precedent.
- If a mockup and a ticket disagree, the ticket's "Deviations from the
  mockup" section (or its equivalent) wins. If two mockups disagree, the
  index says which one leads.
