# MARKET-11 — Internal Import Batch Operations and Scalable Review Queue

## Status

Proposed, **not started**. Documentation/roadmap definition only — no UI,
API, database, migration, or code exists yet for anything described here.

## Depends on

`MARKET-05A` (Data-inbox / `/internal/import-inbox`, built and live),
`MARKET-05C` (Restaurant Profile Drafts, built and live), and
`PLATFORM-05` (the `internal`/`editor`/`owner` role model and
`authenticateInternalRequest`/`isInternalOnly` guard both already reuse
unchanged). This ticket adds no new surface — it scales and extends two
that already exist.

## Problem

`/internal/import-inbox` and `/internal/profile-drafts` were both built
and validated against a small, real dataset (the two Breda dry-runs: 500
candidates; one real live `ImportRun`; one real Restaurant Profile
Draft). Both already carry documented, honest "v1 limitation, revisit
once volume exceeds this" bounds rather than pretending to scale
further than they do:

- `GET /api/internal/v1/import-inbox/candidates` fetches at most
  `RECORD_LIMIT` (2000) `import_extraction_records` rows, at most
  `REVIEW_LIMIT`/`ENRICHMENT_LIMIT`/`DRAFT_LIMIT` (4000 each) rows from
  the three audit/draft tables it joins in application code, and applies
  every filter (`run_id`, `category`, `name`, `possible_duplicate`,
  `quality`, `review_status`) with plain JavaScript `.filter()` over that
  already-bounded set (`src/lib/importInbox.js`'s
  `enrichAndFilterCandidates`) — never a database `WHERE` clause. The
  "Review Overview" status tiles (`computeReviewStatusCounts`) are
  computed the same way, over the same bounded set.
- `computePossibleDuplicateIds` is an O(n²) pairwise comparison across
  every candidate currently in view — cheap at hundreds of rows,
  genuinely expensive well before it reaches thousands.
- `GET /api/internal/v1/profile-drafts` was just fixed
  (`fix(internal): bound profile drafts overview query`) to fetch every
  active draft in full plus the `DISCARDED_DRAFT_LIMIT` (2000)
  most-recently-discarded ones, with a separate exact `total_discarded`
  count — correct, but still a single, unpaginated page load with no way
  to reach anything past that limit.
- Neither page has any bulk action, any sense of "how much of this batch
  is left," or any way to jump to the next candidate that actually needs
  a decision without scrolling back through the full list.

None of this was a defect when it was built — it matched the real data
that existed. It becomes a real problem the moment an import batch
grows from hundreds to thousands or tens of thousands of raw candidates
(the documented "room to grow" these limits were explicitly sized
against, per `RECORD_LIMIT`'s own comment: "enough headroom for every
candidate the real, already-run dry-runs actually produced... revisit
once volume materially exceeds this"). This ticket **is** that revisit.

## Objective

Let internal staff work through a large import batch (hundreds to tens
of thousands of raw candidates) efficiently and safely — see how much
work remains, move quickly between candidates that still need a
decision, and act on many similar candidates at once where it is
genuinely safe to do so — without ever loading a full dataset into the
browser, without ever bulk-publishing or bulk-promoting anything, and
without weakening any authorization or audit guarantee `MARKET-05A`/
`05C` already established.

## User story

As an internal reviewer working through a newly-imported batch of
several thousand raw candidates, I want to see how much of the batch
still needs attention, move straight to the next candidate that needs a
decision, and safely defer or flag many similar candidates at once, so
a large import doesn't become an unmanageable one-by-one scroll while
every action I take remains exactly as auditable as it is today.

## Non-goals (explicitly out of scope)

- **Bulk promotion to a Restaurant Profile Draft, or any form of bulk
  publication — never, under any phase of this ticket.** Promotion stays
  a deliberate, one-candidate-at-a-time action exactly as `MARKET-05C`
  already defined it.
- Real cross-source deduplication/matching logic (`MARKET-05B`) — this
  ticket is about review *throughput*, never about improving duplicate-
  detection *accuracy*. The existing possible-duplicate heuristic's
  meaning does not change; only how affordably it can be computed and
  displayed at scale is in scope.
- Automated or AI-assisted review decisions of any kind. Every decision,
  bulk or not, remains a deliberate human action.
- Any change to a public/consumer-facing page, `data/restaurants.json`/
  `data/menus.json`, or any canonical table.
- Any change to `MARKET-05A`/`05C`'s existing review-status vocabulary,
  enrichment field scope, discard rules, or draft lifecycle — this
  ticket reuses those contracts exactly, it does not renegotiate them.
- New external dependencies, unless Phase 4's own measurement step
  concludes one is genuinely required (see Phase 4) — and even then, the
  smallest dependency that solves the measured problem, not a general
  data-grid/virtualization framework adopted speculatively.

## Phased delivery

### Phase 1 — Scale foundation

The prerequisite for everything else: nothing in later phases is safe to
build on top of pages that already silently mis-scale.

- **Cursor/keyset pagination for `/internal/profile-drafts`.** Replaces
  the just-shipped `DISCARDED_DRAFT_LIMIT`/`total_discarded` stopgap with
  real pagination: a stable keyset (e.g. `(discarded_at, id)` for the
  discarded side, matching that query's existing sort) rather than an
  offset, so a page further into the list stays correct even as new
  drafts are discarded concurrently. Active drafts stay fetched in full,
  unpaginated, exactly as the just-shipped fix already established —
  their count is inherently small and bounded by the migration's own
  partial unique index, not by import volume.
- **Server-side search and filtering for Import Inbox on at least
  review status, completeness, and possible-duplicate status.** This is
  the hardest, most honestly-scoped item in this phase: `review_status`
  is not a stored column on `import_extraction_records` — it is resolved
  from a separate append-only table, latest-row-wins
  (`buildReviewStatusByCandidateId`); `quality_status` is computed from
  `extracted_fields` plus the latest enrichment per field; and
  `possible_duplicate` is the O(n²) pairwise hint above. "Server-side"
  here means the database (or a dedicated query shape) does the
  filtering — not that a query parameter merely narrows an
  already-`RECORD_LIMIT`-bounded, already-fully-fetched set the way it
  does today. The concrete mechanism (a queryable summary/materialized
  view, a two-stage query — first the matching candidate ids from the
  review/enrichment tables, then those specific
  `import_extraction_records` rows — or another shape) is **not decided
  by this ticket**; see Risks and Open questions.
- **Exact summary counts, with bounded loaded lists and a clear "Load
  more" action.** Extends the pattern the profile-drafts fix just
  established (an exact, independent count query, never derived from a
  possibly-bounded fetched array) to Import Inbox's own "Review
  Overview" tiles, which have the identical class of correctness risk
  today (computed client-side from the same `RECORD_LIMIT`/
  `REVIEW_LIMIT`-bounded fetch).
- **Hard constraint, restated for this phase specifically**: no offset
  pagination anywhere in this feature, and neither page ever loads every
  candidate or every draft into the browser by default, regardless of
  batch size.

### Phase 2 — Workflow

- **Import batch context**: source, date, per-review-status counts, and
  remaining work for one batch — built on the existing `import_runs`
  record (`data_origin_source_name`/`access_provider_source_name`/
  `started_at`/`record_counts`) plus the exact, run-scoped review-status
  counts Phase 1 makes possible. A "batch" is an existing `ImportRun`;
  this phase does not invent a new batch concept.
- **A simple "next candidate" flow**: after recording a decision, move
  directly to the next candidate still needing one under the reviewer's
  current filters, without returning to the list first. Reuses the
  existing decision/enrichment endpoints and their exact authorization
  and append-only audit behavior unchanged — this is a navigation layer
  only, never a new write path.
- **Per-internal-user filter and progress persistence, with no new
  external dependency.** Exact mechanism (client-side storage vs. a
  small row in the existing Supabase project) is an implementation
  choice, not fixed here — see Open questions — but it must not require
  adopting a new third-party service or state-management library.

### Phase 3 — Safe acceleration

- **Only safe bulk actions**: bulk-defer and bulk-mark-for-enrichment
  (`needs_enrichment`) against a selected or filtered set of candidates
  — the two examples this ticket is explicitly scoped to. **Bulk
  `approved_internal` is deliberately excluded from this phase**, not
  merely unlisted — it is the direct gateway to promotion, and this
  ticket treats it with the same extra caution `MARKET-05C` already
  applies to discard (mandatory reason, explicit separate confirm click,
  never the first click). Whether bulk-approval is ever safe enough to
  add is left as an explicit, later, separately-reviewed decision (see
  Open questions), not something this ticket authorizes.
- **Never bulk promotion to a Restaurant Profile Draft or any public
  publication** — restated as a hard boundary, not only a non-goal.
- **Every individual change from a bulk action still produces its own
  append-only audit row**, exactly as if it had been recorded one
  candidate at a time — a bulk action against 50 candidates is 50
  distinct `import_candidate_reviews` rows (same reviewer, same
  timestamp, same reason), never one summary log entry that obscures
  per-candidate provenance.
- **Clear confirmation before committing**: a bulk action must show
  exactly which candidates (count, and their identity) it will affect
  before it runs, matching the existing discard flow's own established
  "explicit, separate confirmation" pattern rather than a single
  click-and-done action.

### Phase 4 — Collaboration and optimization

- **Claim/assignment** to prevent two reviewers acting on the same
  candidate at the same time. Unlike everything above, this is
  genuinely new data-model surface — a claim is current, mutable, and
  expiring by nature, structurally different from an append-only
  decision row, and needs its own small, clearly-scoped table (the same
  way `restaurant_claims` — an owner's claim on a restaurant — is its
  own table, kept separate from the `field_provenance` table, rather
  than a new mutable column bolted onto an audit table).
  Expiry/timeout policy is not decided here (see Open questions).
- **Optional keyboard navigation** for moving between candidates and
  common actions — a client-side UX enhancement only, no new dependency.
- **Virtual list rendering, only if measurement shows it is actually
  needed.** Phase 1's pagination/"Load more" bound is the default
  mitigation for large lists; virtualization is not built speculatively
  ahead of evidence that a bounded, paginated list still renders too
  slowly in practice.

## Technical constraints (hard boundaries)

- **`internal`-only authorization, unchanged.** Every route this ticket
  touches or adds keeps the exact `authenticateInternalRequest` +
  `isInternalOnly(auth.roles)` gate every other `MARKET-05A`/`05C` route
  already uses — never relaxed for speed, never a new role or
  permission level introduced to work around it.
- **Append-only audit trail, unchanged and un-shortcut.** No phase of
  this ticket introduces a mutable "current state" column anywhere a
  decision is recorded — see Phase 3's own bulk-action constraint above.
  The one deliberate exception is Phase 4's claim/assignment concept,
  which is not a decision record and must not be modeled as one.
- **Text-first and performance-first, per `CLAUDE.md`, even though this
  is internal tooling.** Per
  `[[009-consumer-vs-internal-performance-budget]]`, this surface is
  exempt from the strict <250 KB consumer budget, but not from the
  underlying principles: avoid unnecessary payload, avoid large new
  dependencies, paginate large lists — which is exactly what "no offset
  pagination, no default full-dataset load" in Phase 1 already commits
  to.
- **No restaurant photography on initial page render, restated.** Per
  `[[002-text-first-no-images]]` and this project's own established
  practice of excluding restaurant photography from internal review
  surfaces even when a design reference includes it (see
  `docs/mockups/README.md`'s `restaurant-profile-drafts-detail-v1.png`
  entry), no phase of this ticket introduces a restaurant photo, a
  photo placeholder, or an image field on initial load of either page.
- **No automatic publication of any kind.** Restated as a hard boundary
  independent of the bulk-action non-goal above — nothing this ticket
  adds may cause a candidate or draft to reach a public/consumer-facing
  surface without the exact same explicit, one-at-a-time human action
  `MARKET-05C` already requires.
- **No linkage or merge with legacy public restaurant data**
  (`data/restaurants.json`/`data/menus.json`) — this stays exclusively
  `MARKET-05B`'s eventual, separate concern.
- **Mobile usability around `390px`.** Both pages already meet this
  today (verified, per this project's own established CDP-based,
  no-new-dependency visual-check method); every addition in this ticket
  — batch context, next-candidate flow, bulk-action controls, claim
  indicators — must be checked at the same width before being considered
  done, not assumed to degrade gracefully by default.

## Data model needs

Phases 1–3 need no new table: they change *how* existing data
(`import_extraction_records`, `import_candidate_reviews`,
`import_candidate_enrichments`, `restaurant_profile_drafts`) is queried
and presented, not what it means. Phase 4's claim/assignment is the one
genuinely new, small data-model addition this ticket anticipates — its
exact shape (a dedicated table vs. another mechanism, expiry handling)
is not designed here.

## Risks

- **A redesigned, server-side filtering mechanism silently changing what
  "possible duplicate," "complete," or a review status means** —
  mitigated by keeping every existing computed-field definition
  (`computeQualityStatus`, `computePossibleDuplicateIds`,
  `computeEffectiveReviewStatus`) exactly as it is; only how and when
  they are queried may change, never their meaning.
- **The O(n²) possible-duplicate hint becoming a genuine performance
  problem once real server-side filtering removes the current
  `RECORD_LIMIT` ceiling that accidentally bounds it today** — flagged
  explicitly as a Phase 1 design question (see Open questions), not
  assumed away.
- **Bulk actions encouraging rubber-stamped, less-careful review** —
  mitigated by scoping bulk actions to only the two named, low-stakes,
  reversible-in-spirit statuses (defer, needs-enrichment), and by
  deliberately excluding bulk approval and all bulk promotion.
- **A stale claim silently blocking a candidate from ever being
  reviewed again** if a reviewer's session ends without releasing it —
  needs an explicit expiry/timeout design before Phase 4 ships, not
  left implicit.
- **Virtualization built speculatively, adding complexity or
  accessibility regressions the actual data volume never justified** —
  mitigated by Phase 4's explicit "only if measurement shows it is
  needed" condition.
- **This ticket used as a rationale to relax `internal`-only gating or
  audit granularity "just for this feature"** — restated as
  categorically out of scope; every hard boundary above applies to every
  phase without exception.

## Open questions (explicitly not decided here)

- The concrete server-side query shape for Phase 1's review-status/
  completeness/duplicate filtering (materialized/queryable summary,
  two-stage id-then-fetch query, or another approach) — an
  implementation decision for whoever builds Phase 1, not fixed here.
- Whether the possible-duplicate hint needs a structurally different
  computation at true scale (e.g. bounded to same-run or same-batch
  comparisons only) or whether a smaller, explicitly-scoped comparison
  window remains an acceptable, documented v1 limitation of its own.
- Exact mechanism for per-user filter/progress persistence (client-side
  storage vs. a small Supabase-backed row) — not decided here.
- Exact claim/assignment expiry policy and how a stale or released claim
  is surfaced in the UI.
- Whether bulk `approved_internal` is ever revisited as a later,
  separately-reviewed safe action, and if so, under what additional
  confirmation requirements — explicitly deferred, not decided here.

## Acceptance criteria

- [ ] `/internal/profile-drafts` uses cursor/keyset pagination for the
      discarded side, with a "Load more" action — no offset pagination,
      no default full-history load.
- [ ] `/internal/import-inbox` supports genuine server-side filtering on
      at least review status, completeness, and possible-duplicate
      status — verified against a candidate set larger than
      `RECORD_LIMIT`, not only against today's small real dataset.
- [ ] Every summary count shown on either page (Review Overview tiles,
      active/discarded totals) is exact and independent of whatever
      limit currently bounds the detailed list beneath it.
- [ ] An import batch's context (source, date, per-status counts,
      remaining work) is visible without leaving the review flow.
- [ ] A reviewer can move to the next candidate needing a decision
      without manually returning to and re-scrolling the list.
- [ ] Filters and review progress persist per internal user without
      introducing a new external dependency.
- [ ] Only bulk-defer and bulk-mark-for-enrichment exist as bulk
      actions; no bulk approval, no bulk promotion, no bulk publication
      path exists anywhere in the UI or API.
- [ ] A bulk action requires an explicit, separate confirmation showing
      exactly what it will affect before it runs.
- [ ] A bulk action produces one append-only audit row per affected
      candidate — never a single combined log entry.
- [ ] Claim/assignment prevents two reviewers from being steered toward
      the same candidate at the same time, with a defined, non-permanent
      expiry.
- [ ] Keyboard navigation, if shipped, is additive — every action it
      exposes remains fully usable by mouse/touch alone.
- [ ] Virtual list rendering exists only if a documented measurement
      shows a bounded, paginated list still under-performs in practice.
- [ ] No restaurant photograph, photo placeholder, or image field
      appears on the initial render of either page.
- [ ] Both pages remain fully usable, with no horizontal overflow or
      clipped control, at approximately `390px`.
- [ ] `internal`-only authorization and the append-only audit guarantee
      are unchanged and re-verified (structural tests, matching this
      project's existing convention) for every new or modified route.

## Suggested order

Sits alongside `MARKET-05` in Wave 2 ("Import & sourcing infrastructure")
of `planning/architecture/market-data-foundation-plan.md` as an
operational-scale extension of `05A`/`05C`, not a new wave — it touches
no canonical, publication, or consumer-facing surface, so it neither
blocks nor is blocked by `MARKET-05B`, `06`, or later waves. Proposed as
the next `MARKET-*` ticket after `05A`/`05C`, to be picked up once a real
import batch large enough to need it is planned or already exists —
not scheduled.
