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

Source of truth: `src/lib/internalNav.js` (config) and
`src/components/InternalNav.js` (render), per PLATFORM-11, decision 014
and the leading mockup `docs/mockups/internal-navigation-workqueue-v1.png`.

1. **BredaEats wordmark:** the quiet home link to `/internal`.
2. **Primary items:** `Dekkingsoverzicht` (`/internal/coverage`) and
   `Onboarding Restaurant` (`/internal/onboarding-restaurant`).
3. **`Werkvoorraad`:** one accessible `<details>` disclosure. Each
   module in it has a short subtitle:
   - `Beheer` (`/internal`, "Alle modules");
   - `Nieuwe aanleveringen` (`/internal/import-inbox`);
   - `Bronwerkvoorraad` (`/internal/source-workqueue`, "Bron en
     menukaart per restaurant");
   - `Profielconcepten` (`/internal/profile-drafts`);
   - `Beoordelen` (`/internal/moderation`, editor only).
4. **Right side:** the shared theme toggle, then `Sign out`.

Rules:

- A new internal module is a new entry in `internalNav.js`, usually under
  `Werkvoorraad`. It is never a second navigation or a page-local nav.
- Every internal page uses the same order, labels and position. The
  active destination has `aria-current="page"` (decision 014, item 2).
- No badge counts in the nav. A count may only ever appear when it is
  computed from real work items (BE-20 visual contract, mockup note).
- Role filtering only hides links. Every route and API keeps its own
  server-side authorization check (decision 014, item 4).

## Accessibility and responsive requirements

These restate decision 014's acceptance checklist and the measured
practice of BE-23 and the internal theme toggle. Every UI ticket must
meet them.

**Contrast**

- Text, including small badge, chip and toggle labels, needs at least
  4.5:1. Focus indicators and essential non-text UI need at least 3:1.
  Measure in **both** themes.
- Use tokens. When a token fails in a specific context, use a stronger
  existing token there instead of a hardcoded colour. For example, the
  inactive internal toggle option uses `--text-secondary` instead of
  `--text-muted`.
- Record the measured minimum in the ticket.
- Known gap: the public header's inactive toggle option measures 4.39:1
  light and 3.09:1 dark. This is a separate follow-up.

**Status is never colour alone.** Every status badge carries an icon and
the full text (e.g. "Bron: Bereikbaar").

**Keyboard**

- Every interactive element can be reached and operated with Tab, Enter
  and Space, in visual order.
- Every interactive element has an explicit `:focus-visible` outline
  (`var(--border-focus)` or `var(--green)`).
- Toggles expose `aria-pressed`, and disclosures expose their open state.
- Focus lands deliberately after navigation (decision 014, items 6–7).

**Semantics.** Use real `<nav>`, `<a>`, `<button>` elements and tables
with headers. No `<div>` click handlers and no fake or dead buttons
(decision 014, item 10).

**Responsive**

- Verify at desktop (about 1280px) and at about 390px, in light and dark.
- No page-level horizontal overflow (`scrollWidth <= clientWidth`).
- Mobile may collapse a destination or action, never remove it.
- Wide tables become cards on mobile, as in `/internal/source-workqueue`.

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

As of 2026-10-06, all 25 Breda restaurants in production are in this
state: nothing has been analysed yet.

## Mockups: location, naming and leading references

- All mockups live in `docs/mockups/`. `docs/mockups/README.md` is the
  index: per mockup, it names the ticket it belongs to and what the
  mockup does and does not govern.
- Mockups govern layout, hierarchy and interaction intent. They never
  govern exact text, example data, counts or brand names.
- Naming is `<surface>-v<N>.png`, or `.html` for an interactive
  prototype. A new version gets a new file (`-v2`). Older files are kept,
  and the index marks which version leads.
- Mockups with restaurant or dish photography are not committed (see the
  `restaurant-profile-drafts` entry in the index).
- If a mockup and a ticket disagree, the ticket's "Deviations from the
  mockup" section (or its equivalent) wins. If two mockups disagree, the
  index says which one leads.
