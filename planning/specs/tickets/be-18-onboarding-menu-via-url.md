# BE-18 — Onboarding Menu via URL (Fase 1: HTML-bronnen)

## Status

Implemented, committed, pushed, and live-verified in production.
**Fase 1 only** (a single, directly pasted URL, HTML sources with
reliable JSON-LD menu structured data) was built, tested, independently
pre-commit- and pre-push-reviewed, committed (`d4caa06`, `feat(internal):
add onboarding menu URL flow`) and pushed, with a follow-up fix also
independently reviewed, committed (`1d100e6`, `fix(internal): avoid
false no-access flash`) and pushed — see `## Voortgang` below for the
full, per-step evidence trail.

**Also confirmed via a non-mutating production/browser check** (not a
data-mutating end-to-end proposal/review test — see Voortgang step 9
below for exactly what this confirms and does not confirm): `/internal`
and `/internal/onboarding-menu` render correctly on the live production
deployment, without the previously observed premature "No internal
access for this account" message. No proposal, review, or other
product data was created during this check.

PDF sources, batch/CSV intake of multiple URLs, general source
discovery, restaurant profile fetch, HTML heuristics beyond JSON-LD,
OCR, and the navigation restructuring discussed for later `/internal`
work are **not built** in this fase and remain explicitly later,
separately scoped work — see "Non-goals / later work" below.

## Voortgang

BE-18 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [x] 2a. Documentatiecommit lokaal gemaakt
- [x] 2b. Documentatiecommit gepusht
- [x] 3. Implementatie-readinessreview groen
- [x] 4. Lokale productcode gebouwd en getest
- [x] 5. Onafhankelijke pre-commitreview groen
- [x] 6. Lokale codecommit gemaakt
- [x] 7. Gecombineerde pre-pushreview groen
- [x] 8. Code gepusht
- [x] 9. Productiecontrole

**Voortgangsreconciliatie (retroactief, stappen 1–8).** Step 1/2a/2b: the
ticket and its core decisions were authored and committed in `7781c94`
(`docs(planning): reconcile BE-17 and prepare BE-18`), confirmed pushed
(an ancestor of `origin/main`). Step 3: a dedicated implementation-
readiness review and a follow-up scope-closure advice review (resolving
the three open "Besluitpunten" above) were each conducted and reported
green before implementation began. Step 4: fase 1 was built and tested,
committed in `d4caa06` (`feat(internal): add onboarding menu URL flow`)
with a follow-up fix in `1d100e6`; a fresh full local test run (598/598
passing) and a fresh `next build` (no errors, all fase-1 routes present)
both succeed against current `HEAD`. Steps 5/7: an independent pre-commit
review and pre-push review were each separately conducted and reported
green, once for `d4caa06` and once for `1d100e6`. Step 6/8: both commits
exist locally and are confirmed pushed (ancestors of `origin/main`).

**Non-mutating UI smoketest, live-verified** — mirrors BE-17's own step 9
precedent (a non-mutating check, never a data-mutating end-to-end
proposal/review test): commit `1d100e64d85da9f97b760fa1a1e6ddc59ecff601`
is live in production; the Vercel production deployment is `Ready` and
the production alias resolves to that commit. In an existing,
authenticated `internal`/`editor` browser session, `/internal` was
freshly loaded multiple times — first a neutral `Loading…`, then the
correct `Beheer` page with resolved roles; `/internal/onboarding-menu`
was freshly loaded multiple times without the premature `No internal
access for this account` message, showing the menu-URL field and "Lees
URL uit" — the old manual restaurant-id/menu-context/JSON form is not
visible. No URL was read, no proposal or review was created, and no
database or other product mutation occurred.

See `015-be-ticket-structure-and-time-boxing.md` for what this checklist
means and how it must be kept up to date.

## Depends on

`be-17-menu-proposal-snapshot-foundation.md` — the `menu_snapshot_proposals`/
`menu_snapshot_reviews` tables, their grants/RLS, and the existing
`POST /api/internal/v1/menu-snapshots` / `POST
/api/internal/v1/menu-snapshots/[id]/reviews` routes are already built,
tested, committed, and pushed (commits `9fee5f7`, `dedb31e`), and are
reused **entirely unchanged** by this ticket. This is an
application-layer intake/UX ticket on top of an already-live foundation —
it introduces **no new migration, no new table, no new column, no new
grant**. `src/lib/safeOutboundFetch.js` (MARKET-05A's SSRF-hardened
outbound fetch, already live and used by the existing "Suggest data from
website" feature) is the other direct dependency this ticket reuses.

## Problem

The BE-17 pilot route's own input form (`app/internal/onboarding-menu/page.js`)
asks the internal reviewer to type a `restaurant_id`, a `menu_context`
string in the exact `{restaurantId}-{mealtype}` shape, and raw
`captured_content` JSON by hand. This is not a usable end-user flow — it
exposes the database's own internal addressing scheme to a person who
should never need to know it, and it makes manual transcription errors
(a malformed `menu_context`, invalid JSON) the normal case rather than
the exception. It was accepted at the time as the smallest possible
pilot-testable surface (see BE-17's own "Minimal internal review route"),
not as the intended real workflow.

## Product decision (explicit, user-provided)

- The employee pastes **only** a direct URL to a menu page — no
  restaurant ID, no menu context, no JSON.
- The app reads the source in a controlled way and proposes a match to
  an **existing** restaurant, asking only on genuine ambiguity — never
  inventing a match, never creating a new restaurant record.
- The app shows an intermediate status, **`Menukaart uitgelezen`**, before
  ever showing "ready for review" — reading the source and preparing a
  proposal are two visibly distinct steps.
- The app recognizes distinct menu contexts (e.g. Lunch, Diner, Borrel,
  Dranken) within one source. Categories within one coherent card (e.g.
  voorgerechten, hoofdgerechten, desserts) stay **one** menu proposal;
  genuinely separate cards (e.g. Lunch and Diner) become **separate**
  proposals with their own, independent review history.
- The user sees a compact, expandable preview per found menu (categories
  and dishes), can uncheck menus they don't want proposed, and never
  types a menu context, JSON, or restaurant ID.
- Only after selection does the app show e.g. `"3 menuvoorstellen klaar
  voor review"` with one button, `"Maak 3 voorstellen voor review"`.
- On an unclear source structure, the app never invents a menu context —
  it asks a targeted question instead.
- No automatic public publication — unchanged from BE-17.

## Fase 1 scope (this ticket)

1. One text input: a single URL. No other field.
2. Server-side fetch of that URL via `safeOutboundFetch.js`, reused
   unchanged (see "Security requirements" below for the one new caller
   consideration).
3. **HTML only in this fase.** A response whose content-type is not
   `text/html`/`application/xhtml+xml` (in particular `application/pdf`)
   is rejected with a clear, honest message — never attempted, never
   silently ignored. PDF support is explicitly out of scope (see
   "Non-goals / later work").
4. Structured extraction: **prefer schema.org `Menu`/`MenuSection`/
   `MenuItem` JSON-LD** when present on the page — the same
   "JSON-LD first, narrow fallback, never scan free text" strategy
   `src/lib/candidateSuggestions.js`'s `parseContactSuggestionsFromHtml`
   already uses for contact fields (see "Reused building blocks"). When
   no reliable JSON-LD menu data is found, the app does not guess from
   free HTML text — it reports that the source could not be read
   automatically and stops there for this fase (a heuristic,
   non-JSON-LD fallback parser is explicitly not part of this ticket).
5. Menu-context vs. category segmentation: a structurally separate
   page/tab/section with its own prominent heading (Lunch/Diner/Borrel/
   Dranken) is a new menu context; headings within one continuous,
   structurally connected block stay categories inside one proposal —
   see "Distinguishing menu contexts from categories" below for the
   evidence this is based on.
6. Restaurant matching by source-URL hostname against each existing
   restaurant's own `website` field in `data/restaurants.json` — see
   "Restaurant matching" below. Exactly one plausible match: attached
   automatically. Zero or more than one: an explicit choice from the
   existing, small restaurant list — never guessed, never a new
   restaurant record.
7. Status shown at this point: **`Menukaart uitgelezen`**.
8. A compact, expandable preview per found menu context (reusing the
   existing `di-accordion` pattern — categories and dishes, read-only,
   no editable fields) with a checkbox per menu to include/exclude it.
9. On confirming the selection: exactly one `POST
   /api/internal/v1/menu-snapshots` call per selected menu context,
   reusing that route **entirely unchanged** — this ticket adds no new
   write path, no new table access, and no change to that route's
   existing `internal`-only authorization. `quality_score`/`source_type`
   default sensibly (`source_type: 'own_website'`, a fixed default
   `quality_score` — exact default value is an implementation decision,
   not a schema change) rather than being typed by the reviewer.
10. Button label and count shown only after selection, per the product
    decision above (e.g. `"3 menuvoorstellen klaar voor review"` /
    `"Maak 3 voorstellen voor review"`).

## Restaurant matching

Primary, low-risk signal: compare the pasted source URL's hostname
against each existing restaurant's own `website` field in
`data/restaurants.json` (already a per-restaurant, curated field for
every one of the current ~11–25 Breda restaurants). An exact or
subdomain-level hostname match is a strong, deterministic signal —
deliberately **not** fuzzy name/address matching (`src/lib/importInbox.js`'s
`computePossibleDuplicateIds` reuses normalized-name + haversine-distance
for *candidate-to-candidate* duplicate detection during import; that is a
different problem — matching a pasted URL to one of a small, already-known
set of real restaurants — and is deliberately not reused here to avoid
introducing fuzzy-match false positives against production identity
data). No domain match, or a domain that could plausibly belong to more
than one restaurant (e.g. a third-party menu-aggregator domain): an
explicit choice from the existing restaurant list, in the same
never-silent spirit as `app/api/internal/v1/profile-drafts/route.js`'s
`confirm_possible_duplicate_of_draft_id` echo-back pattern (a structured,
visible confirmation step — never an automatic merge). This ticket never
creates a new restaurant record and never writes to any restaurant
identity source (`data/restaurants.json` stays byte-for-byte unchanged,
same guarantee BE-17 already gives).

## Distinguishing menu contexts from categories

Evidence this is already a solved, existing convention — not a new
invention: `data/menus.json`'s own real documents (e.g. `6-diner`,
`6-lunch`, `6-borrel`, `6-specialiteiten` — four separate menu documents
for one restaurant today) already carry `subtitle` (e.g. "Dinerkaart") as
the human-readable menu-context label, distinct from `categories[].name`
(e.g. "Specialiteiten van Bardot", or elsewhere voorgerechten/
hoofdgerechten/desserts) as groupings **within** one such document. Fase
1's heuristic: a structurally separate page, tab, or clearly delimited
section with its own prominent top-level heading is a new menu context;
sequential headings within one continuous block of markup stay
categories in one proposal. Where JSON-LD itself already expresses
multiple `Menu` nodes (schema.org supports this directly), that is an
unambiguous, ideal signal and should be preferred over any heuristic.
Where this distinction cannot be made with confidence, per the product
decision, the app asks — it never guesses a menu context.

## Reused building blocks (verified against current code)

- `src/lib/safeOutboundFetch.js` — SSRF-hardened fetch (protocol
  allowlist, guarded DNS lookup against private/loopback/link-local
  addresses including after a redirect, bounded redirects/response
  size/timeout, no cookies/session forwarding). Reused **unchanged**.
- The "JSON-LD first, narrow fallback, never scan free text" extraction
  strategy already proven in `src/lib/candidateSuggestions.js`'s
  `parseContactSuggestionsFromHtml` — the same shape, applied to
  schema.org `Menu` data instead of contact fields.
- The "never silent, always an explicit confirm" ambiguity pattern
  already proven in `app/api/internal/v1/profile-drafts/route.js` /
  `src/lib/restaurantProfileDrafts.js`'s `findPossibleDuplicateDraftId`
  (a structured 409 requiring an explicit
  `confirm_possible_duplicate_of_draft_id` on retry).
- robots.txt fail-closed gating (`classifyRobotsGate` in
  `src/lib/candidateSuggestions.js`) — reused for the same reason it
  already exists: a technical, self-imposed gate, never a claim of legal
  permission.
- The current internal UI vocabulary: `app/globals.css`'s `di-*` classes
  as already used in `app/internal/import-inbox/page.js` and
  `app/internal/onboarding-menu/page.js` (`di-candidate-card`,
  `di-accordion`, `di-chip`, `di-btn-primary`, `di-empty`,
  `di-banner-*`) — **not** Moderation's or Coverage Dashboard's older,
  inline-style-only pages, which predate this vocabulary and are not the
  reference pattern here.
- The existing shared internal nav (`src/components/InternalNav.js`,
  `src/lib/internalNav.js`) and server-side role checks
  (`authenticateInternalRequest`/`isInternalOnly`/`isEditor`) — unchanged.

## New building blocks needed (do not exist today — confirmed by direct search)

- A new route accepting a **caller-supplied, arbitrary** URL (unlike the
  existing "Suggest data from website" route, which only ever fetches a
  URL already stored on a candidate — see "Security requirements" for
  why this distinction matters even though the technical SSRF defense
  itself does not change).
- Content-type validation at the calling route (`safeOutboundFetch.js`
  itself returns `contentType` but does not gate on it — that
  responsibility belongs to the caller, same as today).
- A JSON-LD `Menu`/`MenuSection`/`MenuItem` parser mapping onto the
  existing `captured_content` shape (`{categories: [{name, items: [{name,
  desc, price, ...}]}]}`, matching `data/menus.json`'s own convention) —
  genuinely new; no HTML/JSON-LD menu parser exists anywhere in this
  codebase today.
- The menu-context/category segmentation heuristic described above —
  new.
- The preview/select UI (per-menu-context accordion with a checkbox) and
  the post-selection bulk-create action (looping the existing, unchanged
  `POST /api/internal/v1/menu-snapshots` call once per selected context)
  — new UI and orchestration, no new write path.

## Security requirements for arbitrary URL ingestion

- Every defense already in `safeOutboundFetch.js` applies unchanged:
  http/https only, no embedded credentials, `localhost`/literal private
  IP rejected before any request, guarded DNS lookup against DNS
  rebinding (including the cloud metadata address), redirect targets
  re-validated identically, bounded response size and timeout, no
  cookies/`Authorization`/session state ever sent.
- **New consideration, not a new technical gap**: the existing caller
  (`suggest-from-website`) only ever fetches a URL already stored on an
  existing candidate; this ticket's route fetches **any** URL an
  `internal` reviewer pastes. The underlying SSRF hardening is unchanged
  and sufficient, but the misuse surface changes from "fetch an
  already-trusted source" to "an authorized user can make the server
  fetch anything" — this should be a deliberate, stated design
  acknowledgment in implementation, not an unexamined reuse.
- Content-type is validated explicitly by the new route before any
  parser runs — `text/html`/`application/xhtml+xml` only in fase 1;
  anything else (including `application/pdf`) is rejected with a clear
  message, never attempted.
- robots.txt is honored the same fail-closed way the existing feature
  already does.
- No automatic public publication — unchanged from BE-17; this ticket
  introduces no new write path beyond calling the existing, unchanged
  proposal-creation route.
- See "Besluitpunten" below for the two remaining open questions
  (audit logging shape; exact rejection behavior for unexpected
  content-types/login pages/source errors) that must be settled before
  implementation, not decided here.

## Relationship to other `/internal` modules (hard architecture agreements)

- **Import Inbox** and **Restaurant Profile Drafts** remain the flow for
  discovering new restaurant candidates and their profile/identity
  fields. This ticket never touches `import_extraction_records`,
  `import_candidate_reviews`, `import_candidate_enrichments`,
  `restaurant_profile_drafts`, or `restaurant_profile_draft_field_facts`.
- **Onboarding Menu** handles exclusively menu **content** for an
  **existing, already-trusted restaurant record** (a `data/restaurants.json`
  key) — never restaurant identity, never a candidate, never a draft.
- **Moderation** remains exclusively the flow for ownership claims and
  existing change requests. This ticket adds no menu-review queue to
  Moderation — menu review stays inside Onboarding Menu, exactly as
  BE-17 already established.
- **Coverage Dashboard** stays read-only and unchanged by this ticket. A
  later, separately scoped ticket may let it surface an onboarding
  pipeline view (e.g. "N restaurants missing a reviewed menu snapshot"),
  but internal `menu_snapshot_proposals`/`menu_snapshot_reviews` rows
  must never be counted as, or conflated with, public/canonical
  `data/menus.json` coverage — that distinction is permanent, not a
  fase-1-only caveat.
- Existing restaurant IDs (`data/restaurants.json`'s own string keys) are
  the **only** identity source this ticket ever matches against — no
  parallel restaurant register, table, or list is created.
- The existing shared internal navigation, server-side role checks, and
  the current Import Inbox/Onboarding Menu card and accordion patterns
  are reused as-is — no new visual pattern, no new navigation shell.
- Onboarding Menu remains a **workflow**, not a second dashboard — no
  charts, no summary tiles, no analytics overview added by this ticket.
- A future link from a **confirmed** restaurant record into Onboarding
  Menu (e.g. from Coverage Dashboard) is later work, to be scoped
  separately — never a link from an unconfirmed import candidate or an
  unpromoted profile draft, which have no confirmed restaurant identity
  yet.
- Terminology: `Beheer` is the existing internal shell name; `Onboarding
  Menu` is the fixed module name introduced by BE-17. Both stay
  unchanged by this ticket — no broad renaming pass is proposed or
  authorized here.

## Non-goals / later work (explicitly out of scope for this ticket)

- **PDF sources.** No PDF text-extraction dependency exists anywhere in
  this codebase today (confirmed by direct search — `data/menus.json`'s
  own `notes` fields confirm its 11 existing PDF-sourced menus were
  manually transcribed, not automatically parsed). PDF support is a
  separate, later, small follow-up ticket once the HTML/JSON-LD path is
  proven.
- **Batch or CSV intake of multiple URLs at once.** Fase 1 is
  deliberately one URL at a time. A later ticket may extend the same
  fetch/extract/match/preview core to a list of URLs, with its own
  per-URL progress/error handling and queue UI — reusing, not
  redesigning, this ticket's core.
- **A heuristic (non-JSON-LD) HTML fallback parser.** Fase 1 reports
  "could not be read automatically" rather than guessing when no
  reliable JSON-LD menu data exists; a broader heuristic parser, if ever
  built, is separate, later work.
- **Any public menu change, automatic publication, or batch
  publication.** Unchanged from BE-17 in every phase.
- **A menu review queue inside Moderation, or a second dashboard.**
  Unchanged — see "Relationship to other `/internal` modules" above.
- **A parallel restaurant register or new restaurant-matching table.**
  Unchanged — see "Restaurant matching" above.
- **Version-incrementing recapture** (already noted as later work in
  BE-17's own Non-goals) — unaffected by this ticket; a URL-sourced
  proposal is still always `version = 1` for its `(restaurant_id,
  menu_context)` lineage today.

## Voorgestelde richting — advies gevraagd

None of the three items below are decided yet — each is a recommendation
awaiting explicit user confirmation before implementation, not a
product decision already made.

1. **Labeltaal (voorstel).** New, task-oriented status/action labels
   introduced by this ticket could be Dutch — e.g. `Menukaart
   uitgelezen`. The fixed names `Beheer` and `Onboarding Menu` would stay
   unchanged in any case. This would not be a broad renaming or
   translation pass across the largely English existing internal labels
   (Import Inbox, Onboarding Menu's own current "New proposal"/"Save
   decision") — only this ticket's own new labels would be Dutch.
   **Not yet decided by the user.**
2. **Auditregistratie-vorm (voorstel).** URL-fetch-attempt audit records
   could contain only necessary, non-sensitive metadata: actor,
   timestamp, hostname, outcome category, and the count of menus found.
   A full URL, including query parameters, would never be duplicated
   into an audit log entry. A created snapshot's own `source_url` field
   (already specified, unchanged, in BE-17's data model) would be
   unaffected by this proposal — it would govern only the separate audit
   trail for fetch *attempts*, not the stored proposal data itself.
   **Not yet decided by the user.**
3. **Fail-safe foutgedrag (voorstel).** Every failure should fail safely
   and never produce a proposal: HTML is fase 1; a PDF source would get a
   clear, honest message that PDF support is later work (see "Non-goals /
   later work"); a login-page redirect, an unsafe URL, an unsupported
   content type, and any fetch error would each get an understandable,
   user-facing message — never an internal error detail, and never a
   fallback attempt to scrape or guess around the failure. **Not yet
   decided by the user.**

## Acceptance criteria

- [ ] The reviewer never types a restaurant ID, menu context, or JSON —
      the only manual input is the source URL.
- [ ] The fetch path reuses `safeOutboundFetch.js` unchanged, with an
      explicit content-type check rejecting anything other than
      `text/html`/`application/xhtml+xml` before any parsing occurs.
- [ ] robots.txt is honored fail-closed, identically to the existing
      "Suggest data from website" feature.
- [ ] A restaurant match is either unambiguous (exact/subdomain hostname
      match against `data/restaurants.json`) or requires an explicit
      reviewer choice — no automatic match on partial/fuzzy signals, and
      no new restaurant record is ever created.
- [ ] The intermediate `Menukaart uitgelezen` status is shown before any
      "ready for review" state.
- [ ] Categories within one structurally coherent source stay one
      proposal; structurally separate menu contexts become separate
      proposals — demonstrated against at least one real multi-context
      source shape (e.g. matching `6-diner`/`6-lunch`/`6-borrel`/
      `6-specialiteiten`'s existing shape).
- [ ] The reviewer can deselect individual found menus before any
      proposal is created; the create action is a single button shown
      only after selection, with an accurate count.
- [ ] Each confirmed menu results in exactly one, independent call to the
      existing, unchanged `POST /api/internal/v1/menu-snapshots` route —
      no new write path, no change to that route's own authorization.
- [ ] `data/restaurants.json`, `data/menus.json`, and every other
      currently public data source are byte-for-byte unchanged after
      this ticket ships.
- [ ] **Proposed requirement — advies, not yet finalized as a product
      decision.** While roles are still loading, Onboarding Menu should
      show a neutral loading state, with a "no access" message appearing
      only after role resolution has definitively finished, never while
      it is still pending. This addresses a real, observed, non-blocking
      UX issue on the already-shipped BE-17 page
      (`https://menucard-kappa.vercel.app/internal`): on a fresh load,
      "No internal access for this account" briefly appeared before the
      correct, role-gated content rendered — confirmed as a loading-state
      timing issue, not an authorization defect (see BE-17's own
      "Status" section). This ticket should address the underlying
      issue; the exact UX/implementation approach (e.g. a distinct
      loading state while roles resolve) is a recommendation here, open
      for confirmation, not a settled requirement.
- [ ] Satisfies `014-navigation-and-orientation-standard.md`'s full
      acceptance checklist (orientation, stable nav, role-vs-navigation
      separation, mobile parity at ~390px, accessibility basics, a
      working next step at every dead-end state, JSON never as the human
      page experience, no fake/hidden controls) — required of every
      future UI ticket per that decision, not restated as a BE-18-specific
      invention.

## Suggested order

1. This ticket's own documentation commit, made and pushed.
2. An independent, read-only implementation-readiness review of this
   ticket — including a decision on the three open "Besluitpunten"
   above.
3. Implementation of fase 1 exactly as scoped here (HTML + JSON-LD only,
   single URL, no PDF, no batch).
4. An independent pre-commit review, a combined pre-push review, the
   code push, and a production check — tracked in this ticket's own
   `## Voortgang` checklist above, per
   `015-be-ticket-structure-and-time-boxing.md`.
5. PDF support and batch/CSV intake follow as separate, later tickets
   once fase 1 is live and proven — not decided or scheduled here.
