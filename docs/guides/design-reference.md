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
(`var(--text-primary)`, `var(--border)`, `var(--accent)` for the brand
accent, a `var(--status-*)` role only for status, etc.) rather than
hardcoded colors, so it works correctly in both themes automatically. The
colour values and rules are set by **Kleurtaal v2** (see "Kleurtaal v2"
below).

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

Product direction (product owner, 2026-10-06; formal decision record pending): BredaEats is not intended to operate as a standalone ordering or delivery platform.

Reservations follow the existing, source-backed rule (BE-07):
BredaEats is not a standalone booking platform and takes no bookings
itself.

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

- The visible product name on the public screens and in the shared
  navigation is **Onze Menukaarten**, with the descriptor **Menukaarten in
  Breda** (product owner, 2026-10-06; implemented with the chosen Claude
  Design direction "5 · Oker licht — uitgewerkt", see "Wordmark and brand
  accent" below). This changes visible UI copy and the wordmark only:
  domains, redirects, technical identifiers (package name, the
  `bredaeats_theme` storage key), SEO metadata, e-mails, legal texts,
  database values, APIs and outgoing messages (e.g. the WhatsApp
  reservation text in `src/utils/reservation.js`) still say BredaEats
  until a separate decision changes them. The name is descriptive; a
  separate trademark check is still open. Internal module names stay
  plain Dutch labels (`Dekkingsoverzicht`, `Onboarding Restaurant`,
  `Bronwerkvoorraad`, …).
- Restaurant branding stays secondary during search and discovery. We
  never adopt a restaurant's logo, photography, colours or house style as
  our own UI.
- No restaurant or dish photography appears in the hero, search results
  or listing cards. At most a neutral icon or monogram is used (decision
  002, BE-20 "Visual contract").
- Product names, logos or wordmarks that appear in a mockup are
  placeholders, not adopted branding, unless a decision adopts them. The
  "Onze Menukaarten" name was adopted on 2026-10-06 (above); the
  `InternalNav` shell itself is unchanged apart from its wordmark.
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

### Wordmark and brand accent (implemented 2026-10-06)

Source: Claude Design canvas "Onze Menukaarten — Identiteit &
kleurstudies", variant "5 · Oker licht — uitgewerkt (okergeel)", without
the colour-gradient variant. The green reference, cobalt and aubergine
directions were rejected.

- **Wordmark (logo E2, 2026-10-14):** `src/components/Wordmark.js`.
  Chosen by the product owner from the Claude Design canvas "Logo
  richting E" (variant E2 "Tegel"); it replaces the folded-menu-card
  motif with stacked `ONZE` / `Menukaarten`. The mark is a rounded tile
  (32×32, radius 8) in `--accent-fill` with a drawn "om" monogram in
  `--on-accent-fill` — the same pair as the primary button, so it meets
  the fill-text contrast in both themes. Inline SVG, `aria-hidden`, colours
  from tokens via CSS, no external font or asset. Next to it, stacked in
  lower case: "onze" (weight 500, `--text-secondary`) above "menukaarten"
  (weight 800, `--wordmark`: `#1A1410` light, `#FFFFFF` dark). No word part
  is oker. The favicon `app/icon.svg` is the same tile in the light token
  values. Sizes: public header tile 26px / text 18px (24px / 16px below
  720px); `InternalNav` tile 26px / text 15px. The link carries an explicit
  `aria-label` so screen readers hear the capitalised name: "Onze
  Menukaarten, naar de startpagina" (public) and "Onze Menukaarten, naar
  het interne overzicht" (`InternalNav`). The descriptor sits next to the
  link and is hidden below 720px. Every public page header renders exactly
  one `<Wordmark />`; `InternalNav` uses `WordmarkInline`.
  `--wordmark-icon` is no longer used by the wordmark and can be retired.
- **Brand accent tokens** (`app/globals.css`, all three theme blocks):
  `--accent` (text, links, icons, focus), `--accent-fill` /
  `--on-accent-fill` (filled controls), `--accent-faint`,
  `--accent-border`, `--accent-surface(-strong)`, `--accent-glow`,
  `--wordmark`, `--wordmark-icon`, `--nav-indicator` (decorative active
  tab stripe), `--mark-bg` / `--mark-text` (homepage keyword marker).
  `--border-focus` follows `--accent`.
- **Full okergeel only for three things** (handoff rule): the primary
  button, the homepage keyword marker (and search-term highlight) and an
  active tab underline — plus, since logo E2, the wordmark tile itself. Selected chips, active navigation, the active
  theme option and similar toggles use the soft treatment:
  `--accent-surface` background, `--accent` text, 1px `--accent` ring.
- **Green is never a brand or action accent.** It exists only as the
  dark value of `--status-positive` (see "Kleurtaal v2"). Approvals and
  primary action buttons use the oker fill; information banners use the
  soft accent; dietary labels are neutral. The former exceptions (coverage
  table header and headline number, moderation approve buttons,
  import-inbox info banner) were migrated by Kleurtaal v2.
- **Okergeel is a fill, never text on a light surface** (light
  `#F6C057`, dark `#F2C35B`; 1.65:1 on white). Light text, links, focus
  and active chip text use ink oker `#7A4E00`.
- **Control borders** (`--input-border`) reach at least 3:1 on every
  surface token in both themes (light `#8E877B`, dark `#6B7280`).
- **No gradients** on hero or detail surfaces; the homepage keyword
  marker is an inset `box-shadow`.
- **Reservation actions** never read as an ordering or primary internal
  button. On the menu page they are outlined (`.rp-btn-reserveer`); on
  the restaurant detail page they stay secondary to "Bekijk menukaart";
  the legacy `/restaurants` card button is outlined. When the action
  leaves the site it carries `ExternalLinkIcon` (decorative icon plus
  visually hidden "(opent in een nieuw venster)"). Below the action a
  note names the restaurant's own channel and says Onze Menukaarten
  takes no reservations or orders itself (`getReservationNote` in
  `src/utils/reservation.js`).
- **Homepage USP blocks:** "Zoek op gerecht", "Zie direct de prijs" and
  "Snel en licht", directly under the search bar and meal chips and
  before "Populaire keukens" (handoff "Start · 1280"): a list with one
  `h2` and plain text per block and a 44px soft-oker icon tile. Three
  columns on desktop, one column below 720px. The handoff's 390px frame
  does not draw them above the fold; they stay in the same order on
  mobile rather than being hidden.

Light and dark values and measured contrast:
`planning/specs/tickets/theme-design-tokens.md`, addenda "Onze
Menukaarten brand accent" and "Kleurtaal v2".

## Kleurtaal v2 (implemented 2026-10-07)

Source: the final design handoff "Onze Menukaarten — Kleurtaal v2
(Brontriage)" (PDF, product owner; the full version is not stored in the
repository, like the earlier Claude Design canvas; only its SHARE-1
selection is, as `docs/mockups/share-1-dish-sharing-handoff-v1.pdf`).
One colour language for public and internal UI. It is leading for
every colour decision; where it and an older section of this file
disagree, this section wins. Behaviour,
routes, data, roles and the theme contract (explicit Licht/Donker, dark
default, no system mode) are unchanged by it.

**Global tokens** (`app/globals.css`; light / dark):

| Token | Light | Dark |
|---|---|---|
| `--bg` / `--bg-card` | `#FCFAF4` / `#FFFDF9` | `#0A0A0A` / `#111111` |
| `--bg-elevated` (also table header) | `#F5F3EE` | `#181818` |
| `--text-primary` / `--text-secondary` | `#1A1410` / `#5C5650` | `#FFFFFF` / `#AAAAAA` |
| `--input-border` (control border) | `#8E877B` | `#6B7280` |
| `--accent` = `--border-focus` (links, focus, active nav/chip text) | `#7A4E00` | `#F2C35B` |
| `--accent-fill` / `--on-accent-fill` (primary button, marker, active underline) | `#F6C057` / `#1F1600` | `#F2C35B` / `#1F1600` |
| `--accent-surface` (selected, soft accent) | `#FEF1D5` | `#2A2109` |
| `--border` (divider) | `#EFE8D8` | unchanged |
| `--wordmark` / `--wordmark-icon` | `#1A1410` / `#B28110` | `#F2C35B` / `#F2C35B` |
| `--nav-indicator` (decorative stripe) | `#D8BC7A` | `#F2C35B` |

Hard rules:

- **Oker is the brand and interaction colour.** Ink oker (`--accent`) is
  text; okergeel (`--accent-fill`) is a fill only, behind `#1F1600`.
- **Green is never a brand accent**; it is only the dark value of
  `--status-positive`. Approvals and primary buttons are oker.
- **Readable text uses `--text-primary` or `--text-secondary` only.**
  Body text, labels, help text and status text never use `--text-muted`,
  `--text-dim` or `--text-faint` (they miss AA on some surface: light
  muted 4.36:1 on `--bg-elevated`, dark muted 3.09:1, faint ≤ 2.50:1).
  Those tokens remain only for non-text decoration.
- **Status always shows icon plus text**; colour is never the only
  carrier. Use the shared `.status-badge` with `src/components/StatusIcon.js`
  (or a module badge such as `.swq-badge` that uses the same roles).
- No gradients, no food photography, no ordering, delivery or booking
  look.

**Semantic status roles** — only for status. Each role has a text
colour, `-bg` and `-border` token; `--status-radius` gives the shape.

| Role | Light (text on fill) | Dark (text + 1px border, 10% fill) | Used for |
|---|---|---|---|
| `--status-blocked` | `#8A1C12` on `#FCE0DA` (7.45:1) | `#FF6B6B` (min. 4.96:1) | Robots geblokkeerd, Niet bereikbaar, load and validation errors |
| `--status-file` | `#5A3A0A` on `#FEF0D3` (9.11:1) | `#64B4FF` (min. 6.05:1) | Afbeelding/PDF, Klaar voor review |
| `--status-old` | `#5A3A0A` on `#FEF0D3` (9.11:1) | `#FF9E6B` (min. 6.43:1) | Oude URL, Toegang beperkt, Identiteit gewijzigd, Structuur niet herkend |
| `--status-action` | `#5A3A0A` on `#FEF1D5` (9.18:1) | `#FFD27A`, fill `rgba(255,210,122,0.10)` (min. **8.70:1**) | Reserved design role "Actie nodig" (an open task for an editor); not yet assigned to any business state |
| `--status-neutral` | `#2A2E36` on `#EFEFEF` (11.84:1) | `#AAAAAA` (min. 5.71:1) | Geen bruikbare menulink, Niet beoordeeld, Geen menukaart aangetroffen, closed |
| `--status-positive` | `#2A2E36` on `#EFEFEF` (11.84:1) | `#06C167` (min. 5.77:1) | Herkenbaar, Bereikbaar, Nu open, goedgekeurd |

Dark minima are measured over `--bg-card`, `--bg-elevated` and
`--accent-surface`. Light is a borderless pill in calm red, oker and grey
only (no blue, no green); dark uses a 6px radius and may also use blue
and green. A user who switches themes therefore sees e.g. "Bereikbaar"
grey in light and green in dark — deliberate.

Meaning that must be kept:

- Dietary labels (vegetarisch, vegan) are neutral outlined labels with a
  leaf icon, not a success status.
- Information is not success: info banners use `--accent-surface` with a
  1px `--accent` border.
- Approvals and primary action buttons use the oker fill, never green.
- A status role is used only where the content really is a semantic
  status. A shared CSS class name is no proof that every use means the
  same thing: each screen maps its own states per meaning
  (`src/lib/statusRoles.js`). Confidence is not a status: it is a
  neutral outlined label (`.di-chip--label`), written out as
  "Betrouwbaarheid: hoog/middel/laag", without status colour or status
  icon.
- "Nu open" (`--status-positive`, check icon) only when the restaurant
  is open at this moment, by the browser's clock after the page has
  loaded (`src/lib/openingStatus.js`, same rule as the existing
  open-now helpers: open from the opening minute up to the closing
  minute). Opening hours today alone are not a positive status: before
  opening, after closing and during the server render the badge is
  neutral with a clock ("Opent vandaag om 12:00", "Nu gesloten ·
  vandaag 12:00-23:00", "Vandaag 12:00-23:00") and never says "Open".
  A chosen other day on `/restaurants` shows its opening hours,
  neutrally. The browse card (`/search`, `/alle-restaurants`) shows no
  live opening status: its API shape has no opening hours, only a
  server/cache-computed `openStatus`, which must never become a status
  on its own. Today's hours on that card need an API extension (a
  separate ticket).
- "Today" in opening hours is a presentation marker, not a status: the
  day label is ink oker (`--accent`), the times primary text, with
  `aria-current="date"`; never `--status-positive`. Whether the
  restaurant is open is shown separately ("Vandaag" badge).
- Incomplete data, missing allergen (NVWA) data, data conflicts,
  possible duplicates and similar uncertainty use the **neutral** role
  (`--status-neutral`, `-bg`; banners `.di-banner-neutral`). They never
  use `--warning` (an alias of `--status-old`, which is reserved for the
  four source states in the table above) and never
  `--danger`/`--status-blocked`. A destructive action (e.g. "Discard")
  and real load/validation errors keep `--danger`. A robots.txt block on
  a page Onze Menukaarten tried to read is "Robots geblokkeerd": the
  **blocked** role (`--status-blocked`, icon + text,
  `robotsTxtRole()` in `src/lib/statusRoles.js`); an unconfirmed
  robots.txt is uncertainty and stays neutral. `--status-old` is only
  for Oude URL, Toegang beperkt, Identiteit gewijzigd and Structuur niet
  herkend.

BE-23 mapping (`app/internal/source-workqueue/page.js`): Bereikbaar →
positive; Niet bereikbaar → blocked; Toegang beperkt, Identiteit
gewijzigd, Structuur niet herkend → old; Klaar voor review → file; Niet
beoordeeld, Geen menukaart aangetroffen → neutral.

BE-25 Batchanalyse mapping (decided 2026-10-09, not built; BE-25
"Status vocabulary and copy"): In wachtrij, Bezig, Geen bruikbare
menukaart gevonden, Recent geanalyseerd and the colleague banner →
neutral; Menukaart gevonden · controle nodig → file; Controle nodig →
old; Robots geblokkeerd (a `robots.txt` block on a read; lock icon),
Ongeldige URL, Fout → blocked; Bron bevestigd → positive (check-circle
icon). BE-25 does not use the
BE-23 source state "Toegang beperkt" (old), which is unchanged.

Other internal screens (`src/lib/statusRoles.js`; conservative until the
status vocabulary is decided — anything not named by the design source
stays neutral):

- Import inbox and onboarding menu review status: Approved (internal
  only) → positive; New, Not yet reviewed, Needs review, Needs
  enrichment, Deferred, Rejected → neutral.
- Data completeness: Complete → positive; Incomplete and "possible
  duplicate" → neutral — the same role in the list and in the detail.
- Import run: failed → blocked (a real technical error); running,
  partial and succeeded → neutral.
- Menu proposal request (onboarding): Mislukt → blocked; Bezig…,
  Voorstel aangemaakt, Al voorgesteld → neutral.
- Restaurant Profile Draft (Active, Discarded, "Profile draft created")
  → neutral: a concept is not an approval.
- Owner claim: Domain match → positive (check icon); No domain match,
  Already has an owner → neutral (neutral dot icon, not an attention
  icon).
- Coverage metric: Complete → positive; Partial → neutral; None yet →
  `--text-secondary`.

Compatibility: `--green`, `--green-faint`, `--green-border` (→
`--status-positive*`), `--danger` (→ `--status-blocked`) and `--warning`
(→ `--status-old`) remain as aliases so other branches do not break
silently. New code uses the role names; no UI in `app/` or `src/` uses
`--warning` any more (asserted in `src/lib/colourLanguage.test.js`). `--tag-*` content tags
(Aanbevolen, Dagspecial, Halal, Glutenvrij) are not status roles and keep
their own tokens.

Open points (not decided by Kleurtaal v2):

- Where "Actie nodig" sits in the status vocabulary below (which
  dimension, when it is assigned). The role and its tokens exist as a
  reserved design role, but no business state uses it: assigning it
  (for example to the import inbox's "New") is a future product
  decision, as are non-neutral roles for the states listed as neutral
  above.
- The Brontriage screens of that handoff were not adopted as a mockup.
  BE-24 (`planning/specs/tickets/be-24-internal-source-triage.md`) built a
  first, proposal-only version on BE-23's layout. Its proposal statuses use
  only existing roles: `Wacht op controle` → neutral (clock),
  `Geaccepteerd` → positive (check), `Afgewezen` → neutral (cross); the
  reserved "Actie nodig" role stays unused. BE-24's v1 product decisions
  are recorded in that ticket: `Brontriage` is internal-only, under
  `Werkvoorraad`, directly after `Bronwerkvoorraad`; self-review is
  allowed and visibly marked; the unusable-reason list is fixed.
- In light, the "Actie nodig" fill equals the selected-row fill; on a
  selected row the fill disappears, icon and text stay readable.
- The light values were measured from a generated mockup image (a few
  shades of margin). Serif typography, KPI tiles and the deviating nav
  labels in that mockup were not adopted.

## BE-28 — frisse publieke stijl (implemented 2026-10-25, #65)

Owner decisions (2026-10-25, recorded in
`planning/specs/tickets/be-28-fresh-public-style.md`):

- "negeer even de md files eenmalig op dit vlak: geef het een modernere look
  o.a. toevoegen van emoji's … het moet technisch allemaal zo licht en snel
  mogelijk laden";
- dark theme: antraciet instead of black (not black with bright oker,
  because of the NAC association);
- buttons in the dark theme: **white** (variant 4);
- emoji everywhere, desktop and phone (choice 1);
- "Akkoord om dit te bouwen … zoals aangeleverd in de mockups".

Approved visual reference: Claude Design canvas "Onze Menukaarten – eigen
gezicht v2", version 14 (https://claude.ai/artifact/8VLxwWFHkffexpyLPyF5DD).
The source HTML is committed in `docs/mockups/be-28-fresh-style-v1/`; its
README names which boards lead. The canvas' top rows (quiet version,
Espresso, Inkt) and the other button variants were **not** chosen.

This decision supersedes exactly these Kleurtaal v2 rules for the **public**
surfaces (home, search, alle restaurants, restaurants, restaurant page, menu
page, the shared header and the wordmark). Internal screens keep their own
layout and colours; they only inherit the token values.

1. **Palette / surfaces.** Light: white page and card surfaces, soft warm
   tints (`#F6F4EF`, `#F3F1EC`, warm panel `#FFF6E2`), oker primary button.
   Dark: antraciet `#1F2328` page, `#2A2F35` cards, `#3A4048` borders, text
   `#F2F3F4` / `#B6BCC3`. All values live in `app/globals.css` as tokens
   (`--surface-soft`, `--surface-warm`, `--card-*`, `--button-primary-*`,
   `--chip-*`, `--price-*`, `--tabbar-*`, `--nav-active-*`); components never
   hard-code a colour. Dark stays the runtime default on a first visit
   (theme contract unchanged).
2. **Buttons and selected states.** Light: oker `--button-primary-bg`
   (`#F6C057`, text `#1F1600`). Dark: white (`#F2F3F4`, text `#1F2328`) for
   the primary button, the active chip and the active tab/menu item. Prices
   are a label: dark `#353A41` fill with oker text; light `#1A1410` fill with
   white text. The logo tile stays oker in both themes.
3. **Green.** Green remains a *status* colour only (`--status-positive`, for
   example "🟢 Nu open" when the existing opening logic says the restaurant
   is open right now). It is never a brand or interaction colour. On the
   antraciet surfaces the dark status colours were lifted so status text on
   its own 10% fill keeps AA; the measured minima are pinned in
   `src/lib/colourLanguage.test.js`.
4. **Emoji.** Emoji are ordinary system characters: no emoji font, no image,
   no library. Every decorative emoji is rendered through
   `src/components/Emoji.js`, which is always `aria-hidden`; the meaning
   lives in the text next to it. Earlier "no emoji" rules (for example in
   `be-11-*` and the old homepage tests) are superseded for these public
   surfaces by this decision. The one exception kept is the approved
   "🟢 Nu open" filter chip wording on `/search` and `/restaurants`.
5. **Card shape.** Cards are round (`--radius-card` 20 px, panels
   `--radius-panel` 28 px). Light: white card, 1px `#EEEAE2` edge and a soft
   shadow. Dark: `#2A2F35` card with a `#3A4048` edge and no shadow. The
   search bar and chips are pills. On the phone (≤720 px) a floating tab bar
   sits at the bottom with the two existing destinations (🔍 Zoeken,
   🍽️ Restaurants); tap targets are at least 44 px (the bar's own links 48 px).
6. **Measurement.** Contrast is measured in both themes and pinned in
   `src/lib/publicStyle.test.js`: every public text token pair ≥ 4.5:1,
   control borders and focus rings ≥ 3:1. Card *container* edges follow the
   approved mockup (soft in light, `#3A4048` in dark) and are never the only
   affordance: the card's own text, hover state and focus ring carry the
   interaction. Interactive fields (the home and search bars) use
   `--input-border`, which does meet 3:1 in both themes.

   Measured in the browser (`ops/browser/run-public-style-browser-check.js`,
   developer evidence on a local production build, 2026-10-25):

   - initial transfer of `/`, dark, 1280 px, cold cache: **190 KB before**
     (base `a517052`) → **148.7 KB after** — under the 250 KB target and
     41 KB smaller than before;
   - live contrast, light: body 18.24:1, secondary 7.24:1, price label
     18.24:1, primary button 10.74:1, chip 18.24:1, tab bar 18.24:1, search
     field border 3.56:1;
   - live contrast, dark: body 14.22:1, secondary 7.05:1, price label
     6.95:1, primary button 14.22:1, chip 10.31:1, tab bar 10.31:1, search
     field border 3.56:1;
   - no horizontal overflow at 1280/390/320 px on any public page, the tab
     bar only appears at ≤720 px, tap targets ≥ 44 px, keyboard Tab from the
     search field reaches the Zoeken button.

   The full result and the 35 screenshots are in
   `ops/browser/evidence/public-style-browser-evidence.json` and
   `ops/browser/output/be-28/` (the output folder is generated, not
   committed).

### Vervolg BE-28b (#68) — Alle restaurants en de overige publieke pagina's

Owner decision 2026-10-25 ("ja heel goed ga met alles akkoord"), canvas
version 17, source HTML in `docs/mockups/be-28-fresh-style-v1/`
(`alle-restaurants-*.html`). Implemented on `feat/fresh-style-68`:

- `/alle-restaurants` has one whole-card link per restaurant (no nested link
  or button), an emoji tile from the small tested `src/lib/cuisineStyle.js`
  mapping (unknown cuisine → 🍽️), the cuisine · price line, 📍 address,
  equal-height round cards, the existing menu labels with emoji and exactly
  one "📋 Bekijk N menukaarten" CTA when a menu exists. Without a menu there
  is no big button: only "Nog geen menukaart" and "Bekijk restaurant →"
  (a compact line with an arrow at ≤720 px).
- The filter row reuses the existing chip style and real data:
  "📋 Met menukaart" plus cuisine chips derived from the loaded restaurants.
  Sorting is "📋 Met menukaart eerst" by default (alphabetical within that)
  and A–Z as the alternative; the choice lives in the URL (`?sort=az`). The
  count line ("25 restaurants · 4 met menukaart") is computed from the real
  API data, not hardcoded.
- `/restaurants`, `/restaurant/[id]`, `/menu/[id]`, `/claim/[id]` and
  `/nvwa/[id]` use the same tokens, round cards, pills and emoji labels;
  menu actions remain leading and reservations secondary. Routes and
  behaviour are unchanged. On the phone the shared floating tab bar is now
  also on `/claim` and `/nvwa`. The NVWA compliance score no longer overlaps
  its explanation at 320 px.
- Transport-only: `GET /api/restaurants` now gzips the same JSON when the
  client accepts it (5,874 → 1,389 bytes for the 25-restaurant response).
  No field, route or data change; this keeps the full-list transfer under
  the previous size.

Measured with `ops/browser/run-public-style-browser-check.js` on a local
production build (developer evidence, 2026-10-25), cold cache, dark, 1280 px:

- `/alle-restaurants`: **154.5 KB before** → **152.1 KB after**;
- live contrast, light: card name 18.24:1, kind/address 7.24:1, CTA
  10.74:1, chip 18.24:1, count 7.24:1;
- live contrast, dark: card name 12.14:1, kind/address 7.05:1, CTA 14.22:1,
  chip 10.31:1, count 8.25:1;
- 275 checks passed, 0 failed, 59 screenshots: `/alle-restaurants`,
  `/restaurants`, `/restaurant/[id]` with and without a menu, `/menu/[id]`,
  `/claim/[id]` and `/nvwa/[id]` at 1280/390/320 px in light and dark, plus
  the existing home/search/internal coverage. No horizontal overflow and the
  tab bar only at ≤720 px on every measured page.

This remains developer evidence on a local build; it is not production or
independent acceptance.

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

1. **Onze Menukaarten wordmark** (`WordmarkInline`): the quiet home link
   to `/internal`.
2. **Primary items:** `Dekkingsoverzicht` (`/internal/coverage`) and
   `Onboarding Restaurant` (`/internal/onboarding-restaurant`).
3. **`Werkvoorraad`:** one accessible `<details>` disclosure. Each entry
   has a short subtitle; the exact texts live in `INTERNAL_MODULES` in
   `src/lib/internalNav.js`. The entries are, in order:
   - `Beheer` → `/internal`;
   - `Nieuwe aanleveringen` → `/internal/import-inbox`;
   - `Bronwerkvoorraad` → `/internal/source-workqueue`;
   - `Brontriage` → `/internal/source-triage` (BE-24, internal-only;
     directly after `Bronwerkvoorraad`, decided for v1);
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
- `Brontriage` is an internal-only Werkvoorraad entry directly after
  `Bronwerkvoorraad`, without a count (BE-24 "V1 product decisions").
- **Visible name `Bronnen beoordelen`** (decided 2026-10-09, BE-25
  "Design v2 decisions"; not built yet). The visible label `Brontriage`
  becomes `Bronnen beoordelen`. BE-25's `Batchanalyse` page lives under
  it, with the breadcrumb `Werkvoorraad / Bronnen beoordelen /
  Batchanalyse` (mobile: `← Bronnen beoordelen / Batchanalyse`). Routes
  and technical identifiers stay unchanged for now
  (`/internal/source-triage`, `source_triage_*`, `sourceTriage*`). Until
  the label in `src/lib/internalNav.js` changes, the live navigation
  keeps showing `Brontriage` ("Implemented today" above).
- In BE-25's Batchanalyse, a high-certainty result offers "Bevestig
  bron": a short inline human confirmation that only records an accepted
  BE-24 source proposal. It publishes nothing and changes no restaurant
  data. Bulk confirmation ("Bevestig {n} bronnen") covers only
  high-certainty results and keeps per-result confirmation available.
  Other `internal` staff see a batch read-only and never see who
  started it.

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
  existing token there instead of a hardcoded colour. Readable text uses
  `--text-secondary`, never `--text-muted`/`--text-dim`/`--text-faint`
  (Kleurtaal v2).
- Record the measured minimum in the ticket.
- The former gap of the public header's inactive toggle option (4.39:1
  light / 3.09:1 dark with `--text-muted`) is closed by Kleurtaal v2: it
  now uses `--text-secondary` (at least 6.46:1 light / 6.85:1 dark).

**Status is never colour alone.** Every status badge carries an icon and
the full text, e.g. "Bron: Bereikbaar" (BE-23; decision 014, item 2:
the current destination is "never color alone"). Colours come from the
Kleurtaal v2 status roles; a bare coloured dot is not a status.

**Keyboard and focus** (decision 014, items 6–7)

- Every interactive element is keyboard-operable, in a focus order that
  matches the visual order.
- Every interactive element has an explicit `:focus-visible` treatment.
  Use `var(--border-focus)` (which follows `--accent`); never
  `var(--green)` for focus since 2026-10-06.
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
- One recorded exception: `docs/mockups/share-1-dish-sharing-handoff-v1.pdf`
  (SHARE-1) is a PDF. It is a multi-page handoff that keeps the light,
  dark, mobile, desktop, mismatch and copy states together with their
  token mapping and visual acceptance criteria. Its size of about 5.9 MB
  is deliberately accepted for this one reference. It does not change
  the convention: other mockups stay `.png` or `.html`.
- A second recorded exception (2026-10-09):
  `docs/mockups/be-25-batch-analysis-handoff-v2.pdf` (BE-25), a
  one-page handoff (about 0.25 MB) that keeps the token mapping, status
  role per state, accessibility and per-width rules of the two v2 PNGs
  together. It accompanies those PNGs and does not replace them; the
  convention above is otherwise unchanged.
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

## BE-29 — slimme "Vanavond op de kaart", seizoen en daghap (implemented 2026-10-25, #70)

Owner decision 2026-10-25 ("akkoord ik volg al jouw adviezen"): the BE-28
style stays the visual reference; no new page or design gate. The labels
follow the existing emoji-plus-text pattern (`<Emoji/>` decorative, the text
carries the meaning):

- "✨ Nieuw op de kaart" — a menu updated in the last 30 days;
- "🌿 Seizoen" — only when the menu itself says so (Wildkaart,
  Seizoenskaart or the section "Seizoen"), never from a dish name;
- "📅 Daghap" — only when the source says Daghap/Dagschotel/Dagspecial/
  Vandaag or carries the `Dagspecial` label, always followed by
  "volgens de kaart van [brondatum]";
- "🌱 Vegetarisch" — the existing neutral diet label;
- "🟢 Nu open" — unchanged, browser clock only.

The home season tiles reuse the existing `.home-tile` pattern and link to the
existing `/search?q=` route; a tile only appears when that search really has
results. The moment section keeps the BE-28 card, one dish per restaurant, and
disappears below three dishes. The measured colours still come from the
existing tokens; the BE-29 block adds no hard-coded colour.

## BE-36 - de AI-leeskaart bij een gedeeltelijke lezing (implemented 2026-10-27, #87)

The AI reading card (`src/components/AiMenuReadBlock.js`) keeps its place in the
existing flow: one card after the source choice, with the manual import as a
small link. What is new is what the card says when a menu is read page by page.

- **Before the click**: "Kost ongeveer 1 cent per pagina - duurt +/- 1 minuut".
  The estimate follows the number of pages, not one fixed reading.
- **A partial reading**: a neutral banner "8 van 9 pagina's gelezen." above the
  summary. The summary itself stays "Concept klaar: N gerechten - X in orde, Y
  nalopen"; the card never claims a complete menu.
- **A failed page**: one line per page in the card, in the page's own words
  ("Pagina 4 kon niet gelezen worden. Het antwoord was afgekapt.") with the small
  text button "Opnieuw proberen". That button reads only that page again; the
  rest of the reading stays on screen.
- **Budget**: "Het budget van deze maand is op." and the manual import link
  remains visible; the manual import is never the only sentence a failure says.
- **One click in a row** (Dekking / Bronnen beoordelen): the same measured
  sentence is used in the row's own reason line; the row's result and the card
  describe the same reading.

Layout rules that do not change: the card is the same `.bta-card` with
`mai-step-head`, the numbers follow the visible order (BB3), the primary button
keeps `di-btn-primary`, and "Opnieuw proberen" is the small `mai-link` variant,
not a second primary action. The failed-page list is an ordinary `ul` inside the
card; it adds no colour token and no new page.

