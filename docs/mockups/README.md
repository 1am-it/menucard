# Mockups

This directory stores the visual design references for BredaEats.

These mockups define the intended UX direction for the dish-first redesign.

Use them as guidance for:

- information hierarchy
- layout direction
- typography emphasis
- spacing
- mobile-first behavior

Do not treat them as a pixel-perfect implementation requirement.

## Recommended files

- [Homepage mockup](./homepage-v1.png)
- [Search results mockup](./search-results-v1.png)
- [Restaurant menu mockup](./restaurant-menu-v1.png)

## Internal tooling (addition, 2026-09-06)

Consumer-facing pages are the primary scope above; this project's
`internal`-only tools (e.g. `/internal/import-inbox`) also get a mockup
once one exists, so a presentation redesign has a concrete acceptance
reference instead of ad hoc judgment calls:

- [Internal candidate triage mockup](./internal-candidate-triage-v1.png) —
  visual reference for `/internal/import-inbox`'s "Review Overview"
  section (`planning/specs/tickets/market-05-normalization-deduplication.md`'s
  own "MARKET-05A" section covers the underlying feature/data contract;
  this mockup governs layout/visual language only, per this file's own
  "Do not treat them as a pixel-perfect implementation requirement" note
  above). **Correction (2026-09-06):** this entry originally named the
  section "Triage overview" and the page "Candidate triage" — both were
  renamed for terminology consistency ("Review Overview" on the page
  "Imported Restaurant Review") after this mockup image itself was
  captured; the image file is unchanged and still shows those older
  labels, since it governs layout only, never exact text (see this
  file's own top-level note). Full detail:
  `planning/specs/tickets/market-05-normalization-deduplication.md`'s
  own terminology glossary. **Correction (2026-09-06, later still):**
  the page name above, "Imported Restaurant Review", is itself now
  stale — the page title is "Dashboard imported Restaurant Data" as of
  that ticket's "information-hierarchy update" section; "Review
  Overview" is unchanged. This mockup still governs layout/visual
  language only, not exact text.
- [Restaurant Profile Drafts mockup](./restaurant-profile-drafts-v1.png)
  (addition, 2026-09-12) — visual reference for the MARKET-05C candidate
  detail card on `/internal/import-inbox` (the "Create Restaurant Profile
  Draft"/discard flow reached via a candidate's "Details & review"):
  governs page layout, the existing Import Inbox context, the compact
  status overview, the single primary action, the three secondary
  accordions (Review decision/Enrichment/History & sources), and the
  human-readable history timeline, at both desktop and mobile widths. Per
  this file's own top-level note, it governs layout/visual language
  only, not exact text; see
  `docs/api/restaurant-profile-drafts-schema.md`'s own "Presentation
  rebuild (2026-09-12)" section for the full implementation notes.
  **Correction (2026-09-12, later still):** an earlier version of this
  entry also referenced a second, companion mockup
  (`restaurant-profile-drafts-detail-v1.png`) that additionally informed
  some of the above. That file contains restaurant photography, which
  does not fit this project's text-first/no-photography UI principle
  (see `CLAUDE.md`), so it was never committed and is not listed here —
  photography itself was never built, per that same principle.
- [Coverage Dashboard mockup](./coverage-dashboard-v1.png) (addition,
  2026-09-12) — visual reference for `/internal/coverage`'s (PLATFORM-01)
  presentation: the compact internal-only/read-only badge, the four
  equal metric cards, and the calmer neighbourhood/cuisine breakdown
  tables (centered numeric columns, an em dash for small samples, one
  shared explanation below each table). Governs layout/visual language
  only, per this file's own top-level note — the sample Dutch labels and
  cuisine groupings shown in the mockup were not adopted as real page
  text or data; the page keeps its existing English copy and its real,
  computed `computeCoverageMetrics()` figures unchanged.

- [Community "Restaurant ontbreekt?" mockup](./community-add-restaurant-v1.png)
  (addition, 2026-09-13) — directional reference for `PLATFORM-08B`'s
  missing-restaurant flow: search by name/address, a non-blocking
  duplicate-possibility hint, and the required name/full-address fields
  with optional website/reservation/menu-link fields. Mobile-first only —
  no distinct desktop layout is shown, since this is a short, single-column
  form with no functional desktop-specific difference. Per this file's own
  top-level note, this mockup governs layout/information-hierarchy only:
  it is not product code, does not imply any backend, storage, validation,
  rate-limiting, or moderation mechanism has actually been built, and does
  not by itself authorize automatic publication of anything a visitor
  submits — see `planning/specs/tickets/platform-08b-community-evidence-submissions.md`'s
  own "Data model needs" and "Hard boundaries" for what is and isn't
  decided.
- [Community "Menukaart gevonden?" mockup](./community-add-menu-link-v1.png)
  (addition, 2026-09-13) — directional reference for the same ticket's
  menu-link submission flow: read-only restaurant context, one required
  `https://` URL field, and an optional short note. Mobile-first only, same
  reasoning as above. Governs layout only — it does not imply MenuCard
  fetches, previews, or copies anything from a submitted link; the ticket's
  own "Menu-link submission" section states that boundary explicitly as a
  structural rule, not a presentation detail this mockup could relax.
- [Community submission status mockup](./community-submission-status-v1.png)
  (addition, 2026-09-13) — directional reference for the shared
  post-submission status screen: an honest "received"/"in review"
  confirmation, a neutral (non-graded) status badge, and an optional,
  account-free email field for a later status update. Mobile-first only.
  Governs layout only — deliberately shows no feed, score, social
  affordance, or fake button; it does not imply any of `PLATFORM-08B`'s
  status transitions, moderation queue, or optional magic-link route have
  actually been built.

## Public menu discovery (addition, 2026-09-13)

- [BE-11 menu discovery prototype](./be-11-menu-discovery-v1.html) — a
  static, local HTML/CSS UX prototype (not a PNG — the HTML/CSS file
  itself is the primary mockup for this ticket) for
  `planning/specs/tickets/be-11-public-menu-discovery-intent-aware-results.md`.
  Shows four switchable states, each **genuinely responsive** between a
  ~390px mobile width and a ~1280px desktop width (resize the browser
  window to see both — this is not a fixed mobile frame floating in empty
  desktop space): a light search start with no default result list, a
  general `Alle restaurants` browse overview (one card per restaurant,
  available menu types as non-clickable information labels, no filter
  chip pre-selected), an explicit meal-type intent opening the matching
  menu directly, and a general search query — shown as three separate,
  clearly labelled examples (not sequential steps of one query) — of a
  single direct match, a short explicit choice among matches spread
  across different restaurants, and a same-restaurant match restricted to
  only its matching menus (`Bekijk N passende menukaarten`, never that
  restaurant's full, unfiltered menu count). Every restaurant summary
  card deliberately shows only name, cuisine, an optional compact price
  level (`€`/`€€`/`€€€`, appended to the cuisine line, shown only when
  real data exists and never a fallback default), a compact address, an
  optional short open/closed status, available menu types, and exactly
  one primary action — no description, and no reservation/phone/chat/
  website/contact action of any kind; a Michelin-style quality label, when
  shown, is plain compact text, never a badge or icon. The price level's
  visible glyph is `aria-hidden`, paired with a visually-hidden text
  alternative (e.g. "prijsniveau: gemiddeld") — a small pattern scoped to
  this prototype file only, not a general product CSS utility — since a
  plain, non-interactive element's `aria-label` is not reliably exposed by
  screen readers. The `Alle restaurants` browse overview also includes
  one card for a restaurant with no menu/dish data at all (most of
  Breda's real restaurants are currently in this state — only 4 of 25
  have any entry in `data/menus.json`) — it shows the same allowed base
  fields with no menu-type row, and its one primary action is honestly
  labelled `Bekijk restaurant` (conceptually `/restaurant/[id]`), never a
  menu-specific label. This demonstrates the ticket's own corrected rule
  that `Alle restaurants` must be sourced from a restaurant-level index,
  never from grouping dish-search results, which would silently exclude
  it. On desktop,
  restaurant cards lay out in a real multi-column grid (reusing the
  existing `.restaurant-grid`
  `repeat(auto-fill, minmax(...,1fr))` pattern from `app/globals.css`),
  not a stretched phone frame.
  **Primary navigation is `Zoeken`/`Alle restaurants`** — plain text
  labels, no icon, no emoji (a deliberate replacement of the earlier
  `Restaurants`/`Menukaarten` draft and today's live `🏠`/`📋` mode-switch
  icons, not an oversight — see the ticket's own "Primary navigation"
  section for the full decision). `Zoeken` is shown active for the search
  start, an explicit meal-type filter, and any general search result;
  `Alle restaurants` is shown active only on the dedicated browse view.
  Reuses existing design tokens (`app/globals.css`'s light-theme custom
  properties), the existing `.restaurant-card`/`.rc-*` card structure, and
  the existing `.mode-switch`/`.theme-switch`/`.lang-switch`
  segmented-control patterns — including reusing the real theme/language
  toggles themselves to demonstrate that they wrap beneath the primary
  tabs on mobile and sit visually separate from them on desktop, rather
  than competing for space. Per this file's own top-level note, this
  prototype governs layout, information hierarchy, and interaction logic
  only: it is not product code, is not wired to the application, and does
  not by itself prove that a lightweight restaurant-summary data
  contract, a server-side address/buurt search extension, route transfer
  logic, or result filtering has actually been built — the desktop
  responsiveness shown here is a layout demonstration only, not proof
  that this behavior exists anywhere in the live application. All names,
  addresses, counts, and search terms shown are clearly directional
  example data, never real MenuCard data.

## Restaurant onboarding (addition, 2026-09-23)

- [Onboarding Restaurant workflow](./onboarding-restaurant-workflow-v1.png) —
  approved visual reference for the future internal restaurant-source
  intake flow: one homepage URL, visible analysis progress, reviewable
  restaurant and menu concepts, and a later bulk-URL intake view. It
  deliberately contains no restaurant photography or image-upload
  interaction. The restaurant concept includes a source-backed,
  reviewable short description; it is not a second content type and must
  remain empty when the source provides insufficient evidence. Governs
  layout, information hierarchy, and interaction intent only; it does
  not imply that source discovery, PDF extraction, AI structuring, bulk
  intake, or publication has already been built. **Its own top
  navigation bar still shows the full, not-yet-simplified module list
  (`Beheer`, `Nieuwe aanleveringen`, `Profielconcepten`,
  `Dekkingsoverzicht`, `Beoordelen`, `Onboarding Restaurant`) — this
  predates and is superseded by the navigation mockup below for
  navigation structure specifically; this mockup governs the workflow
  steps/content shown in its four panels only, never the nav shell.**
- [Internal navigation and work queue](./internal-navigation-workqueue-v1.png) —
  **leading, approved visual reference for the simplified internal
  navigation structure** — supersedes the workflow mockup above wherever
  the two differ on navigation. The main navigation exposes only
  `Dekkingsoverzicht` and `Onboarding Restaurant`; the BredaEats wordmark
  is the quiet internal home link. `Nieuwe aanleveringen`,
  `Profielconcepten`, and `Beoordelen` remain reachable through an
  accessible work-queue control. Counts shown in the mockup are
  directional only and must never be rendered unless computed from real
  work items. Governs visual hierarchy only, not route, role, or
  data-contract changes.

## Naming

Prefer clear versioned names such as:

- `homepage-v1.png`
- `homepage-v2.png`
- `search-results-v1.png`
- `restaurant-menu-v1.png`

Keep only the latest approved versions referenced from planning and design docs.
