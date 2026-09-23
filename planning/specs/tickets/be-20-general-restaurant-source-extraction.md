# BE-20 — General Restaurant Source Extraction (Onboarding Restaurant, fase 1)

## Status

Proposed; not started. Documentation/schema-contract only — no product
code, migration, route, API, worker, UI, or Supabase change has been
made for this ticket. This ticket is the narrative/product-contract
layer; a later, separate documentation step will add the exact,
implementable schema shape (`docs/api/*.md`), matching the same
"ticket = rationale, `docs/api/*.md` = exact contract" split BE-19 and
`MARKET-02` already use.

## Voortgang

BE-20 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2a. Documentatiecommit lokaal gemaakt
- [ ] 2b. Documentatiecommit gepusht
- [ ] 3. Implementatie-readinessreview groen
- [ ] 4. Lokale productcode gebouwd en getest
- [ ] 5. Onafhankelijke pre-commitreview groen
- [ ] 6. Lokale codecommit gemaakt
- [ ] 7. Gecombineerde pre-pushreview groen
- [ ] 8. Code gepusht
- [ ] 9. Productiecontrole

See `015-be-ticket-structure-and-time-boxing.md` for what this checklist
means and how it must be kept up to date.

## Depends on

`be-19-onboarding-restaurant-via-url.md` — `url_intakes`,
`url_intake_analysis_receipts`, the dual-origin `restaurant_profile_drafts`/
`_field_facts` amendment, `create_url_intake_from_receipt`,
`promote_url_intake_to_profile_draft`, all reused **unchanged** as the
durable audit/concept backbone this ticket extends, never replaces.
`be-18-onboarding-menu-via-url.md`'s JSON-LD menu extraction
(`src/lib/menuJsonLdExtraction.js`) and contact-field extraction
(`src/lib/candidateSuggestions.js`'s `extractFromJsonLd`/
`parseContactSuggestionsFromHtml`/`classifyRobotsGate`) — both reused
**unchanged** as fase 1's deterministic, zero-AI extraction tier.
`src/lib/safeOutboundFetch.js` (SSRF-hardened outbound fetch) — reused
**unchanged** as the only network egress for every new fetch this
ticket introduces (candidate-link fetches, PDF fetches). `docs/api/url-intake-schema.md`
(amended by this same documentation round — see "Amendment to the
Governance exception" below) and `docs/api/restaurant-profile-drafts-schema.md`
(read, not modified — `restaurant_profile_draft_field_facts.origin`
stays exactly `import`/`enrichment`/`url_intake`, per this ticket's own
"Vaststaande productkeuzes" §3). `docs/api/data-trust-model.md`'s
`source`/`confidence`/`verifiedAt`/`verifiedBy` vocabulary — referenced
for the eventual mapping of an `ai_structured` extraction result onto a
future canonical field, not consumed directly by this ticket's own
narrower `extraction_method` vocabulary (see "Vaststaande productkeuzes"
§3 above and "Adapter contract, content-hash evidence, and confidence"
below for why the two stay separate, same reasoning
`restaurant-profile-drafts-schema.md`'s own "Field-level provenance"
section already gives for `origin` vs. that fuller model).
`planning/decisions/014-navigation-and-orientation-standard.md` — the
future simplified navigation this ticket documents (see the navigation
bullet in "Visual contract" below) must satisfy this standard's full
acceptance checklist once built; not re-derived here.
`planning/specs/tickets/market-04b-controlled-csv-jsonl-intake.md` and
`market-11-import-batch-operations-scalable-review-queue.md` — read for
precedent only. **This ticket's future batch intake is a third,
separate mechanism, not a reuse of either**: `MARKET-04B` requires a
newly-registered `Source`/`SourceAuthorizationVersion` per `MARKET-03`'s
heavier governance; `MARKET-11` scales the existing `import_extraction_records`
review UI. This ticket's batch (see "Batch-readiness" below) is a list
of arbitrary staff-supplied URLs, each still individually gated by
BE-19's own lighter "Governance exception," bundled only for progress
bookkeeping — never a fourth import pipeline.
`be-21-restaurant-source-extraction-vendor-benchmark.md` — the separate,
later ticket that owns the OCR/browser-rendering vendor benchmark,
comparison, and choice this ticket's own "Non-goals for fase 1"
explicitly excludes; not a dependency of this ticket, but the intended
next step once fase 1 has real evidence to benchmark against.

## Approved design references

- `docs/mockups/onboarding-restaurant-workflow-v1.png` — governs the
  four-step Onboarding Restaurant workflow shown below: single-URL
  intake, in-progress analysis with a visible checklist and a "Veilig
  verwerkt" trust panel, the reviewable restaurant-concept-plus-menus
  result (including the `Korte omschrijving`/confidence/source tags and
  an explicit "onbekende sectie" callout), and the future bulk-intake
  view (CSV drop zone, pasted-URL-list textarea, per-URL batch status
  table). **Its own top navigation bar still shows the full,
  not-yet-simplified module list (`Beheer`, `Nieuwe aanleveringen`,
  `Profielconcepten`, `Dekkingsoverzicht`, `Beoordelen`,
  `Onboarding Restaurant`) — this predates and is superseded by the
  second mockup below for navigation structure specifically; this
  mockup governs the workflow steps/content only, not the nav shell.**
- `docs/mockups/internal-navigation-workqueue-v1.png` — governs the
  simplified navigation shell: the BredaEats wordmark as the quiet
  internal home link, `Dekkingsoverzicht` and `Onboarding Restaurant` as
  the only top-level items, and a compact `Werkvoorraad` control
  exposing `Nieuwe aanleveringen`/`Profielconcepten`/`Beoordelen` with
  real, computed counts (shown directionally as 3/2/1, badge 6).
- Both mockups govern **layout, information hierarchy, and interaction
  intent only** — per `docs/mockups/README.md`'s own top-level note,
  neither is a pixel-perfect requirement, and neither implies source
  discovery, PDF extraction, AI structuring, bulk intake, batch
  processing, the simplified navigation, or publication have already
  been built. Future builders of this ticket must read both files
  directly before implementing any UI step — this reference is recorded
  here specifically so that requirement is discoverable from the ticket
  itself, not only from `docs/mockups/README.md`.

## Problem

BE-19 built a safe, auditable **intake and concept bridge** — one
receipt-bound analysis result becomes a durable `url_intakes` row, which
may become a reviewable `restaurant_profile_drafts` concept. It added no
extraction capability of its own: everything it durably records still
comes from BE-18's fase-1 extraction tier, which is deliberately narrow
by BE-18's own explicit design — schema.org JSON-LD only, present
directly on the fetched homepage, no PDF, no same-host link following,
no AI, no OCR, no browser rendering (`be-18-onboarding-menu-via-url.md`'s
own "Non-goals" section names every one of these explicitly). This
ticket closes that gap: it defines the product, data, and visual
contract for a general-purpose extraction layer capable of turning one
homepage URL into a reviewable restaurant concept and menu proposals
across HTML, linked HTML menus, and digital PDF menus — for thousands of
structurally different, previously-unseen restaurant websites, never a
fixed list of hardcoded per-site exceptions.

## Vaststaande productkeuzes (decided — not open questions)

The following are accepted product decisions for this ticket. They are
recorded here as settled, not re-presented as open questions in any
later implementation round:

1. Fase 1 supports public HTML, JSON-LD, linked HTML menus, and digital
   PDF menus. Scanned/image PDFs, OCR, and browser-rendered
   (JavaScript-dependent) sites are explicitly later work (see
   "Non-goals for fase 1" below).
2. AI may structure free HTML and PDF text — strictly via validated JSON
   output against a fixed schema, per-field source evidence, a
   confidence tier, and mandatory human review before anything is acted
   on. AI output is never free-form prose and never bypasses review.
3. `json_ld` / `pdf_text` / `ai_structured` (and, later, `ocr`) are
   values of a new `extraction_method` field — an **additive** property
   describing how a value was technically derived, never a new business
   `origin`. `restaurant_profile_draft_field_facts.origin` stays exactly
   `import` / `enrichment` / `url_intake`, per `restaurant-profile-drafts-schema.md`'s
   own three-independent-biconditional contract — untouched by this
   ticket. The originating record for anything this ticket produces
   remains the `url_intakes` row; AI is one possible processing step
   inside that same, unchanged origin.
4. No product-level limit on the number of PDFs discovered for one
   analysis. Only technical, per-analysis total budgets (time, bytes,
   memory, AI tokens, cost) bound the work — never a business-facing
   count cap presented as a technical one (matches this project's own
   existing convention, e.g. `safeOutboundFetch.js`'s `maxBytes`/
   `timeoutMs`, the OSM import script's `maxRecordsToStore`).
5. No automatic publication, no invented/guessed data, and no attempt to
   bypass a login wall, a CAPTCHA, robots.txt, or any other access
   control — unchanged, hard rules, identical in spirit to BE-17/BE-18/
   BE-19's own existing invariants.
6. Source discovery may explore a **bounded** same-host neighbourhood:
   at most one extra link hop beyond the fetched homepage, a small,
   fixed-size candidate set, a robots.txt check for every candidate, and
   the existing `safeOutboundFetch.js` guard for every single fetch —
   never a second hop from a discovered page, never a cross-host
   candidate. See "Amendment to the Governance exception" below for the
   exact, explicit correction this requires to already-published
   contract text.
7. Analysis runs durably outside the browser request. The browser polls
   status only; processing never depends on a tab staying open. See
   "Minimal durable analysis-job contract" below.
8. `safeOutboundFetch.js` remains the only network egress for HTML,
   discovered links, and PDFs — never a second, parallel fetcher.
9. A future external partner API is not built now, but traceability
   (`extraction_method`, source reference), confidence, validation, and
   versionability must already exist in the data this ticket produces,
   so a later API can consume it without a breaking retrofit.
10. The six-URL practice set (`debotanistbreda.nl`, `bobbisbar.nl`,
    `gauchosgrill.nl/breda`, `mrmoos.nl`, `demarktbreda.nl`,
    `breda.colonie.nl`) is an acceptance set only — never a source of
    hardcoded, site-specific branches in any implementation.

## Amendment to the Governance exception (`docs/api/url-intake-schema.md`)

**Status: recorded here as a decided product direction; the authoritative
contract text itself is amended in the same documentation round, directly
in `docs/api/url-intake-schema.md`'s own "Governance exception" section**
(a dated amendment paragraph, not a silent rewrite — matching
`restaurant-profile-drafts-schema.md`'s own "Amendment (2026-09-22,
BE-19)" precedent). That document's current, still-accurate-for-BE-18/19
bullet — *"Exactly one target URL per action — never a list, never a
crawl of discovered links"* — is explicitly superseded, not silently
contradicted by this ticket's own code once built, for the same-host
discovery case only: a fetch may now examine a small, fixed number of
same-host links found on an already-fetched page and fetch **each of
those, once**, under the exact same technical gates (robots.txt,
`safeOutboundFetch.js`, no further hop from any of them). Every other
part of the existing exception (one authenticated `internal` action, no
scheduling, no automatic trigger, no personal-data expansion, no
automatic publication) is unchanged.

## Minimal durable analysis-job contract

A new, small, additive table — **separate from** `url_intake_analysis_receipts`,
which keeps its own narrow, already-proven "kortlevend, eenmalig,
actor-/URL-gebonden" lifecycle unmixed with a longer-running background
process. A job precedes a receipt: a receipt is only ever issued once a
job's analysis has actually succeeded.

- `id` — app-generated UUIDv7, this project's existing identity
  convention.
- `actor_user_id`, `canonical_source_url` — same binding discipline as
  the existing receipt.
- `status` — a fixed, closed set: `pending` / `running` / `succeeded` /
  `failed`. No free-text status.
- `result_receipt_id` — nullable reference to the resulting
  `url_intake_analysis_receipts` row, set only once, only on `succeeded`
  — never guessed, never set speculatively.
- `error_reason` — nullable, from a fixed, closed vocabulary (e.g.
  `unsafe_url`, `robots_disallowed`, `unsupported_content_type`,
  `fetch_failed`, `pdf_extraction_failed`, `ai_structuring_failed`,
  `budget_exceeded`, `no_reliable_content_found`, `internal_error`) —
  never an internal error string surfaced to the reviewer (matches item
  5's "zonder interne foutdetails" requirement directly).
- **Idempotency**: a retried "Analyse starten" click (e.g. a flaky
  network response on the client) must attach to the *same* job, never
  spawn a duplicate — the exact mechanism (a client-supplied idempotency
  token vs. a short natural-key window on `actor_user_id`+
  `canonical_source_url`) is an implementation decision for the next
  documentation round, not fixed here; a fresh, deliberate re-analysis
  after a terminal `failed` state always creates a genuinely new job,
  never silently resurrects the old one.
- **Retries**: a bounded `attempt_count`, a fixed maximum, and an
  explicit terminal `failed` state once exhausted — never silent
  infinite retry, never a partial success reported as success (mirrors
  `production-db-migrate.yml`'s own "stops at the first failure, never a
  partial success" discipline, applied here to a data pipeline instead
  of a migration).
- `batch_id` — nullable, batch-ready from day one. Fase 1 never sets it
  (no UI creates a batch yet) — see "Batch-readiness" below for why the
  column exists now regardless.
- `created_at`/`updated_at`.

No worker, queue technology, or dashboard is decided or required by this
contract — a job can be processed inline, within the same request that
creates it, for fase 1's own UI; only the **contract** (this table plus
a small status-poll endpoint) needs to exist so the UI never depends on
one long synchronous request/response cycle, and so a later move to a
real background worker is additive, never a breaking rewrite of every
caller.

## Adapter contract, content-hash evidence, and confidence

Every extraction/structuring step — local PDF-text extraction, the
optional Claude adapter, and (later) OCR/browser-rendering — follows one
uniform contract: it returns either a validated result or a typed,
closed-vocabulary error result. Never a partial, unvalidated, or
free-text-error result reaching a reviewer.

- `extraction_method` values: `json_ld`, `html`, `pdf_text`,
  `ai_structured`, and, later, `ocr` — additive, per this ticket's own
  "Vaststaande productkeuzes" §3, never a new `origin`.
- Every populated field carries a content-hash reference to the exact
  source fragment it was derived from — never the full raw source
  duplicated, matching `url-intake-schema.md`'s existing data
  minimisation.
- **Confidence tiers (`hoog`/`middel`/`laag`, the same scale
  `docs/api/data-trust-model.md` already uses). A deterministic
  extractor, a valid content-hash, or the mere absence of model
  inference is never, by itself, sufficient for `hoog` — for any
  `extraction_method`, including `json_ld` and `html`. A field reaches
  `hoog` only when it has (1) a valid, field-specific content-hash
  source reference, (2) it passes the existing or an explicitly
  described server-side plausibility check (the same normalizer-based
  checks `src/lib/candidateNormalization.js` already applies, or an
  equivalent described alongside whichever field is being validated),
  and (3) it shows no context conflict — e.g. a chain/head-office
  address surfacing on a location-specific restaurant page. Without
  that validation, the field stays at most `middel` and is shown as a
  reviewable field, never as an automatically-trustworthy result.
  `pdf_text` without AI structuring is, on the same basis, at most
  `middel`. `ai_structured` output is likewise capped at `middel`
  regardless of what confidence the model itself reports, unless the
  same independent, server-side plausibility check confirms it — AI
  never self-assigns `hoog`. This is a documentation contract only; no
  validation logic is built by this ticket.**
- **Closed, per-adapter error vocabulary — a finer-grained set than the
  job-level `error_reason` already defined above, each rolling up into
  one of those existing job-level values, never a competing vocabulary**:
  - Local PDF-text extraction: `pdf_too_large`, `pdf_encrypted`,
    `pdf_corrupt`, `pdf_no_text_layer` (signals a scanned/image PDF —
    reported today as "not automatically readable"; the explicit,
    later trigger for fase 2 OCR, never guessed at in fase 1). All roll
    up to the job's own `pdf_extraction_failed`.
  - Claude adapter: `schema_violation`, `timeout`, `rate_limited`,
    `model_unavailable` — at most one bounded retry before rolling up
    to the job's own terminal `ai_structuring_failed`, reserved
    exclusively for a terminal AI-structuring failure of this kind
    after the retry is exhausted. A budget overrun in the Claude
    adapter is never reported as `ai_structuring_failed` — it rolls up
    explicitly to the job's own existing, separate `budget_exceeded`
    (defined above in "Minimal durable analysis-job contract"), the
    same value any other budget overrun in the job already uses, never
    a second, competing meaning for that value.
  - Later OCR/browser-rendering adapters: an analogous closed set,
    including `render_blocked` (bot-detection/CAPTCHA encountered) —
    always stops the job, never triggers a bypass attempt of any kind.
- **The Claude adapter is optional and switchable per job** (extends
  "Vaststaande productkeuzes" §2). If it is disabled, unavailable, or
  terminally fails, the job still completes using whatever deterministic
  (`json_ld`/`html`) results it already found, with a plain-language
  notice that AI structuring was unavailable — never a blank, invented,
  or silently-failed concept.

## Review-readiness threshold (documentation proposal)

Proposed default, recorded here as this ticket's own clear, reasonably
conservative starting point — not a vague open question restated
elsewhere: a field is shown as ready for ordinary review when it carries
a valid content-hash source reference **and** at least `middel`
confidence. Anything below that, or an AI-derived value that fails its
plausibility check, is shown as **"handmatige beoordeling nodig"** —
a distinct, per-field marker, never a reason to block review of the rest
of the concept (mirrors the approved mockup's existing "1 onbekende
sectie" pattern). The owner may adjust the exact cutoff; the shape of
the rule (evidence + confidence, degrading per-field, never
whole-concept) is fixed here.

## Cost limits and stop behavior (shape only — no invented figures)

- **Per URL**: a fixed, technical (never a business-facing count
  presented as one) budget on AI token usage, at most one bounded AI
  retry, a fixed cap on combined PDF size, and a fixed cap on total
  processing time. Exceeding any of these stops the job with
  `budget_exceeded` — never a partial or invented result, always a
  plain, actionable message (retry, or send for manual review).
- **Per batch**: a separate, larger total budget (the sum of its jobs'
  own per-URL budgets) plus an explicit circuit breaker — if too high a
  share of a batch's jobs fail or exceed budget, the batch pauses with a
  clear notice rather than continuing to spend against a likely
  systemic problem.
- **The exact numeric values for every limit above are an explicit,
  separate owner decision — not fixed by this ticket.** This section
  defines only the shape and the stop behavior.

## Privacy and vendor review before production use

Before any external processor — **including the fase-1 Claude adapter,
whenever it is actually sent real source material** — is used against
real, non-benchmark restaurant sources in production, the following
must be explicitly reviewed and confirmed, never assumed: a data
processing agreement with that vendor, its actual EU-processing
configuration, its retention/no-training commitment for submitted
content, and its own secret handling on BredaEats' side (environment-
scoped, never shared with the existing Supabase CI secrets). **This
ticket records the requirement, not the outcome — no claim is made
anywhere in this documentation that a DPA, EU-region configuration,
zero-retention agreement, or vendor approval already exists for any
processor, including Claude.** Each remains a separate, explicit,
pre-production decision, tracked in full by `be-21-restaurant-source-extraction-vendor-benchmark.md`.

## Batch-readiness (not built in fase 1)

The `batch_id` column above, plus a small, optional
`url_intake_batches` table (`id`, `actor_user_id`, `created_at`) it can
reference, are the only schema-level accommodation fase 1 makes for
future bulk intake. A batch is never a second scraper and never a
distinct write path: it bundles **progress, error, and result reporting
only** across many independent jobs, each with its own status, source
evidence, errors, retries, and review outcome — exactly the mockup's own
"Elke URL wordt afzonderlijk beoordeeld en fouten blokkeren de rest van
de batch niet" rule. CSV upload and a pasted URL-list are both later,
separate UI additions on top of the same per-job contract; fase 1's own
user interface shows exactly one URL field, per this ticket's own
"Vaststaande productkeuzes" and the current, unchanged `app/internal/onboarding-menu/page.js`
single-input pattern.

## Visual contract (fixed, for future builders)

- No restaurant/dish photography anywhere in this flow — no fetch,
  storage, upload, or display of any image. At most a neutral
  hospitality icon or monogram (matches `CLAUDE.md`'s existing
  no-photography principle and the precedent already set for
  `restaurant-profile-drafts-detail-v1.png`'s deliberate exclusion).
- Reuse the existing app style exactly — light warm-grey background,
  white rounded cards, dark navy text, calm forest-green accents, clear
  primary actions. No second design system, no new component library.
- Visible product name: `Onboarding Restaurant`. No existing route needs
  to change name or path in this documentation round.
- Single-URL entry: a short explanation, one input field, one primary
  action, and an explicit, visible statement that nothing is published
  automatically — exactly the first mockup panel's copy pattern ("Nog
  niets wordt gepubliceerd").
- Analysis progress: understandable steps and discovered source types,
  plus a visible, plain-language safety statement (same-host-only
  fetching, source evidence retained, review required) — never an
  internal error string, never a silent fallback.
- Review result: restaurant fields, source, confidence, menu contexts,
  and any menu section the system could not confidently categorize —
  the last shown as an explicit, reviewer-facing item to resolve, never
  silently dropped or silently guessed (matches the mockup's own
  "1 onbekende sectie" callout).
- The restaurant concept carries a reviewable `Korte omschrijving`,
  built only from demonstrable source evidence. It stays empty when the
  source provides insufficient evidence — never generic marketing copy
  invented to fill the field. Once approved, it becomes the same visible
  restaurant description an existing restaurant already has — never a
  second, parallel content type or field.
- **Note, not a decision for this ticket**: the mockup's restaurant-concept
  card illustrates additional rows (`E-mail`, `Openingstijden`) beyond
  `restaurant_profile_draft_field_facts`'s current, fixed
  `name`/`category`/`address`/`phone`/`website` allowlist
  (`src/lib/restaurantProfileDrafts.js`'s `ALLOWED_DRAFT_FIELD_NAMES`).
  This ticket does **not** decide to expand that allowlist — the mockup
  is directional per `docs/mockups/README.md`'s own top-level note, and
  any field-list expansion remains its own separate, explicit decision,
  the same posture `restaurant-profile-drafts-schema.md`'s own "Field
  allowlist growth" open decision already takes.
- Main navigation shows only `Dekkingsoverzicht` and `Onboarding
  Restaurant`. The BredaEats wordmark is the quiet internal home link;
  `Beheer` is not a separate top-level item. `Nieuwe aanleveringen`,
  `Profielconcepten`, and `Beoordelen` stay reachable through a compact,
  accessible `Werkvoorraad` control. Badges in that control show only
  real, computed counts — never a placeholder or a hardcoded number.
  **Decided (information architecture only, nothing built by this
  decision)**: today's separate `Moderation` module (owner-claim review,
  `src/lib/internalNav.js`'s existing `moderation` entry) keeps its
  existing route, `editor`-only role gate, authorization, and data model
  completely unchanged — it gets no own top-level nav item and folds
  functionally into the same `Werkvoorraad` → `Beoordelen` entry, shown
  with an understandable description such as `Menu's, profielen en
  eigenaarsclaims`. This is an information-architecture/navigation
  decision only, not a rename, merge, or rebuild of `Moderation` itself —
  its own `editor`-only server-side check keeps deciding who can actually
  act on a claim, per `014-navigation-and-orientation-standard.md`'s own
  item 4 ("role-driven navigation shows access; it never grants it"); an
  `internal`-only account may see `Beoordelen` without thereby gaining
  any claims access it does not already have. `Beoordelen`'s own count
  (like every `Werkvoorraad` count) may only ever be computed from real,
  currently-open items across the review types it groups — optionally
  combined into one number per review type — never a placeholder, and
  never claimed to already exist: no route, counter, role, or navigation
  change described in this bullet has been built by this documentation
  round.
- On small screens, this navigation collapses or scrolls accessibly —
  never compressed into unreadable chrome, per
  `014-navigation-and-orientation-standard.md`'s own item 5.

## Acceptance criteria

- [ ] Entering one URL: a single input field, one primary action, and
      an explicit "nothing is published automatically" statement are
      all present before any analysis starts.
- [ ] Analysis progress: a reviewer sees discovered source types and
      plain-language safety/status information while a job is
      `pending`/`running` — never an internal error string, never a
      blank wait with no feedback.
- [ ] Restaurant concept: every populated field shows its source and a
      confidence tier; a field with insufficient evidence is left empty,
      never guessed.
- [ ] `Korte omschrijving`: present only when demonstrable source
      evidence supports it, reviewable before approval, and becomes the
      exact same restaurant-description field an existing restaurant
      already has once approved — no second content type.
- [ ] Menu proposals: each discovered, confidently-named menu context is
      shown separately, reusing BE-17's existing, unchanged review path;
      no menu proposal is ever created for a `restaurant_match_type`
      other than a confirmed existing/newly-created restaurant identity
      (BE-19's hard boundary, unchanged).
- [ ] Unknown menu contexts: a section the system found but could not
      confidently categorize is shown as an explicit, reviewer-facing
      item — never silently dropped, never silently guessed into an
      invented context name.
- [ ] Werkvoorraad navigation: `Nieuwe aanleveringen`/`Profielconcepten`/
      `Beoordelen` remain reachable, with counts computed from real,
      current work items only — demonstrated against at least a
      non-zero and a zero-count state.
- [ ] Batch compatibility: the underlying job/receipt/`url_intakes`
      contract accepts a job created with or without a `batch_id`,
      proving a future batch UI needs no breaking change to this
      contract — without building any batch UI in fase 1.
- [ ] No photography: no image fetch, storage, upload, or display
      anywhere in this flow, verified by direct code/asset inspection.
- [ ] Mobile usability: every screen in the approved mockups renders
      without horizontal overflow or unreadable compression at
      approximately 390px, satisfying
      `014-navigation-and-orientation-standard.md`'s full checklist.

## Non-goals for fase 1 (explicitly out of scope)

- OCR for scanned/image-based PDFs or photographed menus.
- Browser-rendered (JavaScript-dependent) page support.
- Any automatic re-crawl or refresh of an already-onboarded restaurant.
- Any public/external API exposing this data.
- A built bulk-intake user interface (CSV upload, pasted URL list) —
  only the underlying per-job contract is made batch-ready now.
- Automatic publication of any kind — restaurant-concept creation and
  each menu proposal remain separate, explicit, human-reviewed actions.
- The vendor benchmark, comparison, and choice for OCR/browser-rendering
  itself — a separate, isolated concern, tracked entirely in
  `be-21-restaurant-source-extraction-vendor-benchmark.md`, never a
  fase-1 build step.

## Suggested order

1. This ticket's own documentation commit (this round), made and pushed,
   together with the accompanying, explicitly-dated amendment to
   `docs/api/url-intake-schema.md`'s "Governance exception" section.
2. A separate, later documentation round: the exact, implementable
   schema/API contract (new `docs/api/*.md` or an amendment to an
   existing one) for the analysis-job table, the `extraction_method`
   field, and the AI-structuring output schema — mirroring BE-19's own
   "ticket = rationale, `docs/api/*.md` = exact contract" split.
2b. An independent, read-only implementation-readiness review of both
    documents.
3. Migration, server logic, and UI, built exactly as scoped here — HTML/
   JSON-LD/linked-menu/PDF only, same-host discovery bounded to one
   extra hop, AI-structuring behind strict schema validation, no OCR, no
   browser rendering, no bulk UI.
4. The same independent pre-commit review, combined pre-push review,
   code push, and production check this project applies to every prior
   `BE-*` ticket — tracked in this ticket's own `## Voortgang` checklist
   above.
5. OCR, browser rendering, the bulk-intake UI, and any external API
   exposure each remain separate, later, explicitly-scoped tickets — not
   phases of this one. The isolated vendor benchmark that must precede
   any OCR/browser-rendering choice is `be-21-restaurant-source-extraction-vendor-benchmark.md`,
   dispatched only once fase 1 itself has real, working evidence to
   benchmark against.
