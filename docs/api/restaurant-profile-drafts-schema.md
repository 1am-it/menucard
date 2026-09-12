# Restaurant Profile Drafts — Schema & API Contract (MARKET-05C)

**Status (2026-09-06, later still): design reviewed and confirmed;
implementation not started.** This is a documentation/schema contract,
matching the convention `MARKET-01`/`02`/`03` used for their own shape
contracts (`docs/api/market-entity-schema.md`,
`canonical-restaurant-menu-schema.md`, `source-registry-schema.md`) — no
code, migration, or Supabase change exists yet. A product review the same
day confirmed the design decisions in "Resolved decisions" below,
including a correction to `source_candidate_id`'s uniqueness (found during
that review, fixed here — see "Discard is permanent; restart is a new
row"). Any `create table`/RPC signature below is **illustrative of the
intended shape**, not a migration file; implementing it is a separate,
later, explicitly-approved step, per this project's own `MARKET-04`/`05A`
precedent (schema documented and approved first, migration written and
applied as its own reviewed step) — and per this review's own explicit
sequencing decision (see "Resolved decisions," item 6).

See `planning/specs/tickets/market-05-normalization-deduplication.md`'s own
`## MARKET-05C — Restaurant Profile Drafts` section for the ticket-level
objective, user story, and acceptance criteria. This file is the exact,
implementable shape.

**Status correction (2026-09-06, later still — discard/duplicate
follow-up round): the line above is stale.** Implementation has since
started and progressed through two rounds — see "Implementation"
immediately below (promotion built) and "Implementation (2026-09-06,
later still — discard/duplicate follow-up round)" further down (discard
built, one real schema bug found and fixed via local validation, the
duplicate flow verified). Migration `0010` is still not applied live.

**Status correction (2026-09-12): the line above is also stale.**
Migration `0010` has since been applied to production, as its own
separate, explicitly-approved release (see
`planning/decisions/013-production-migration-pipeline.md`'s production
migration pipeline for how), followed by the MARKET-05C app-code release
and a controlled production smoke test for one real candidate — see
"Implementation (2026-09-12) — Restaurant Profile Drafts overview" below
for the next step taken after that smoke test.

## Implementation (2026-09-06, later still — same day)

**Built, not yet applied live.** Migration
`supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`
implements both tables, both indexes, and the `promote_candidate_to_profile_draft`/
`discard_profile_draft` RPCs exactly as this contract describes, with one
correction (below) to a genuine gap in this contract's own text. Locally
validated end to end in a disposable, throwaway Postgres container (0001
through 0010 applied in sequence) — every guarantee below was actually
exercised, not just read: the happy path, the effective-status guard
(`P0010`), the active-draft guard (`P0011`, both via the pre-check and via
a genuine `unique_violation` race), the restart-link guard (`P0012`),
discard and double-discard (`P0013`), a real restart after discard
(verifying the old row stays untouched and the new row's
`restarted_from_draft_id` points at it, and that a field enriched *after*
the first promotion is correctly picked up with `origin = 'enrichment'`
on the restart), the column-scoped update grant (an attempt to update
`source_candidate_id` directly is refused; `discard_note` succeeds), the
complete absence of any update/delete privilege on the field-facts
ledger, and `anon`/`authenticated` RLS denial on both tables — never
against the live Supabase project.

**Correction to this contract's own RPC signature.** The "Promotion &
sync flow" section above never listed a `p_draft_id` parameter on
`promote_candidate_to_profile_draft` — an oversight: this contract's own
`id` column description says the id is application-generated (UUIDv7),
but a caller-supplied id has to reach the function *somehow*, and no
other mechanism was named. Implemented as the RPC's first parameter:
`promote_candidate_to_profile_draft(p_draft_id, p_candidate_id,
p_actor_user_id, p_possible_duplicate_of_draft_id default null,
p_restarted_from_draft_id default null)`. This does not change the
design — application-generated UUIDv7, never `gen_random_uuid()`, exactly
as already stated — it only completes a mechanical detail the original
text left implicit.

**What was built this round**:
- Both tables, both indexes, both RPCs, RLS posture, and grants — exactly
  as specified above (plus the one correction just noted).
- `src/lib/restaurantProfileDrafts.js` — the pure decision logic
  (`findPossibleDuplicateDraftId`, `buildDraftFieldsByDraftId`,
  `buildActiveProfileDraftByCandidateId`,
  `canPromoteCandidateToProfileDraft`), mirroring
  `src/lib/importInbox.js`'s own established shape.
- `src/lib/uuidv7.js` — the application-side UUIDv7 generator, extracted
  as its own small module (functionally identical to
  `ops/scripts/capture-market-boundary.js`'s own, which is left
  untouched) for reuse by the new route below.
- `POST /api/internal/v1/profile-drafts` — the only way to create a
  draft, `internal`-only, computing the possible-duplicate check and the
  restart linkage in application code before calling the RPC, exactly as
  this contract describes.
- `GET /api/internal/v1/import-inbox/candidates` extended to attach each
  candidate's active draft (`profile_draft`), read-only — see
  `docs/api/import-inbox-api.md`'s own matching addition.
- `/internal/import-inbox`'s `approved_internal` detail view gained an
  explicit "Create Restaurant Profile Draft" action: disabled while
  submitting (never double-clickable — the partial unique index backs
  this up physically either way), shows "Restaurant Profile Draft already
  created" once one exists (never a second button), and renders the
  possible-duplicate warning with "Promote anyway"/"Cancel" — never a
  silent auto-merge — exactly per "Duplicate handling" above.

**What was deliberately not built this round** (per this round's own
explicit scope, not a contract change):
- `record_profile_draft_field_sync` — the sync RPC this contract
  describes under "Promotion & sync flow." Left entirely unbuilt this
  round, per explicit instruction — re-syncing a field after a later
  enrichment remains impossible through the UI until a future round adds
  it. The append-only field-facts ledger and the "no automatic sync"
  invariant it depends on are both fully in place and tested; only the
  RPC/route/UI for triggering a sync are missing.
- A `discard` API route or UI button. `discard_profile_draft` exists and
  is tested at the RPC level (see above), but nothing under
  `/internal/*` or `/api/internal/v1/*` calls it yet — for this round, a
  draft can only be discarded via direct, manual database access, not
  through the product. Restart-after-discard is fully implemented and
  tested at the RPC level regardless, since the promotion RPC's own
  restart-linkage validation does not depend on how a draft came to be
  discarded.
- Any UI for browsing a draft's own field-fact history — the "Restaurant
  Profile Draft already created" message names only that a draft exists
  and when it was promoted, not its current field values. `GET`-ing a
  single draft's full detail is not part of this round's scope.

## Implementation (2026-09-06, later still — discard/duplicate follow-up round)

**Built, migration `0010` updated in place (still not applied live).**
Two gaps closed:

1. **Discard is now a full internal product action, not just an RPC.**
   `POST /api/internal/v1/profile-drafts/[id]/discard` — `internal`-only,
   same gate as every other route in this contract — calls only
   `discard_profile_draft`, validates a discard reason first
   (`src/lib/restaurantProfileDrafts.js`'s `validateDiscardRequestInput`),
   and is the only way this feature's own UI ever discards a draft. The
   `/internal/import-inbox` `approved_internal` detail view gained a
   "Discard Restaurant Profile Draft" action that reveals a confirm form
   (a mandatory reason, a distinct "Confirm discard" click — never the
   first click) — see `canDiscardCandidateDraft`. A successful discard
   reloads the candidate list, so the "Create Restaurant Profile Draft"
   button reappears only once `profile_draft` is genuinely `null` again —
   nothing here ever starts a restart on its own.
2. **A short discard reason is now mandatory, not optional** — this
   contract's own "Open decisions" had left free-text-vs-enum open, but
   never said the field could be skipped. `discard_note` is now required
   and non-blank whenever `status = 'discarded'`, enforced both by
   `discard_profile_draft` (a friendly, typed `P0014` before ever
   attempting the update) and by the table's own constraint (see the
   corrected shape below).

**A real bug found and fixed during this round's own local Postgres
validation, before any of this reached even a disposable database
permanently.** The header table's original single check —
`(status = 'discarded') = (discarded_by is not null and discarded_at is
not null and discard_note is not null and btrim(discard_note) <> '')` —
looks airtight but is not: because the right-hand side is one big `and`,
`status = 'draft'` only requires *at least one* of the three sub-conditions
to be false, not all three. A direct
`update restaurant_profile_drafts set discard_note = 'x' where id = ...`
against an *active* (`status = 'draft'`) row was verified to succeed
against that original check (`discarded_by`/`discarded_at` stayed `null`,
which alone satisfied the biconditional). Fixed by replacing the one
combined check with **three independent per-column biconditionals** —
`(status = 'discarded') = (discarded_by is not null)`,
`(status = 'discarded') = (discarded_at is not null)`, and
`(status = 'discarded') = (discard_note is not null and btrim(discard_note)
<> '')` — each tying its own column to the discarded state on its own,
closing the gap: none of the three can be set while `status = 'draft'`,
and all three are required the moment it becomes `'discarded'`. Verified,
both before (reproducing the bug) and after (confirming the fix), in a
disposable Postgres container.

**The "Promote anyway" duplicate flow was checked, not changed** — it
already matched this contract exactly: the server (never the client)
recomputes the possible-duplicate check on every call, including the
confirmation call, and only proceeds once the caller's confirmation
matches what the server itself just found; the confirmed relationship is
stored via the already-designed `possible_duplicate_of_draft_id` column,
making "who promoted despite which possible duplicate, and when" a plain
query away (`promoted_by`/`promoted_at`/`possible_duplicate_of_draft_id`
on the same row) — verified end to end in the same disposable container.
No automatic merge, block, or name-based chain classification was added —
none was needed; the existing warn-and-allow-with-audit design already
covers this.

**Tests**: `src/lib/restaurantProfileDrafts.test.js` grew from 40 to 60 —
new unit tests for `validateDiscardRequestInput`/`discardValidationMessage`/
`canDiscardCandidateDraft`, and new structural safety-net tests for the
migration's three-biconditional fix (with an explicit regression guard
against the old, buggy combined-check shape reappearing), the
`discard_profile_draft` RPC's own guard ordering, the new discard route,
the promote route's server-side-recomputation guarantee, and the page's
discard confirm-form gating. Full suite: 495 tests passing.

## Implementation (2026-09-12) — Restaurant Profile Drafts overview

Built as the next step after migration `0010` went live, the app-code
release above was shipped separately, and a controlled production smoke
test (one real candidate, promote → visual confirm → discard with a
mandatory reason → visual confirm) completed successfully. A small,
`internal`-only, **read-only by default** overview so staff can see every
draft — active and discarded — without opening each source candidate
individually on `/internal/import-inbox`.

- **`GET /api/internal/v1/profile-drafts`** (added alongside the existing
  `POST` in the same route file) — lists every `restaurant_profile_drafts`
  row, active and discarded, plus each one's source candidate's name
  (resolved via one bounded `import_extraction_records` query, never a
  per-row round trip). `internal`-only, the same
  `authenticateInternalRequest` + `isInternalOnly` gate as every other
  Data-inbox/profile-drafts route. Strictly read-only: no `.insert()`,
  `.update()`, `.delete()`, or RPC call anywhere in the handler —
  confirmed both by direct review and by a structural safety-net test
  that greps the handler's own source for exactly those forbidden calls.
- **`src/lib/restaurantProfileDrafts.js`'s `buildProfileDraftOverviewRows`**
  — the pure reducer behind the list: unlike
  `buildActiveProfileDraftByCandidateId` (which deliberately keeps only
  the active draft per candidate, for the import-inbox candidate cards),
  this keeps every row, resolves `possible_duplicate_of_draft_id` and
  `restarted_from_draft_id` to the *other* draft's candidate name (never
  a bare id alone), and sorts newest-first by `promoted_at`.
- **`/internal/profile-drafts`** — the page itself, reusing the existing
  `.di-*` design system and the exact session/auth pattern every other
  internal page already uses (`getSupabaseBrowser()` for the session,
  a bearer-token `fetch` for data, no direct Supabase access from the
  browser). A top banner states plainly that a draft is internal-only and
  never appears on a public restaurant page automatically. Each card
  shows: candidate name, active/discarded status, creation timestamp, a
  possible-duplicate note (candidate name of the *other* draft) when
  flagged, a restart note (candidate name of the discarded draft it
  restarted) when applicable, discard timestamp + a short note preview
  when discarded, and the draft's own id (for cross-referencing, e.g.
  against `$GITHUB_STEP_SUMMARY`-style audit trails or a support
  conversation) — never its full field-fact ledger
  (name/category/address/phone/website), which already lives on the
  source candidate's own card in the import-review queue; repeating it
  here would be exactly the duplicate information this overview is
  scoped to avoid.

**Deliberately unchanged, by explicit scope**: no create, discard, sync,
or publish action exists on this page. Promoting a candidate or
discarding a draft still only happens on `/internal/import-inbox`'s
existing `approved_internal` detail view — every card here links out to
it ("Open in Import Inbox") rather than duplicating that flow. No legacy
public-restaurant linkage, merge, or write of any kind was added; this
overview only ever reads `restaurant_profile_drafts` and
`import_extraction_records.extracted_fields.name`.

**Tests**: `src/lib/restaurantProfileDrafts.test.js` grew from 60 to 69
— 5 new unit tests for `buildProfileDraftOverviewRows` (candidate-name
resolution, duplicate/restart-link resolution to the *other* draft's
name, missing-name handling, empty input, and an explicit assertion that
no per-field fact ever appears on a row) and 4 new structural safety-net
tests (the `GET` handler is internal-only and issues no mutating/RPC
call; the page never `POST`s or links to a `/discard` endpoint directly;
the page states the internal-only/never-auto-published guarantee in its
own text; the page uses the same session/auth pattern as every other
internal page, never a direct Supabase query from the browser). Full
suite: 504 tests passing.

**Visual check**: reviewed in a disposable local preview at desktop
(1280px) and mobile (390px) widths, in both the light and dark theme —
desktop rendered cleanly in both themes. The mobile screenshot from this
session's own headless-browser tooling showed clipped content, but a
follow-up, code-independent diagnostic (a plain, unrelated test page)
reproduced the identical clipping, isolating it to a local headless
Edge/Windows DPI-scaling artifact in this tooling — not a defect in the
page's CSS, which reuses the exact `.di-*` responsive classes and
`max-width: 720px` breakpoint already shipped on `/internal/import-inbox`.
Recorded here as a residual, unconfirmed item: a real mobile check (a
phone, or real browser dev tools) is still worth doing before treating
this page's small-viewport layout as fully proven.

**Update (2026-09-12, later — mobile verification closed out): the
residual item above is resolved.** The earlier clipping was confirmed to
be specific to the `--window-size` CLI-flag path of that session's
headless-browser tooling, not to browser-level mobile viewport emulation
in general. Re-verified via the Chrome DevTools Protocol's
`Emulation.setDeviceMetricsOverride` (`mobile: true`, `deviceScaleFactor: 1`,
390×844) — the same device-emulation mechanism real browser-automation
tools use, a different code path from the flag that showed the artifact,
run against the OS's own Edge binary with no new dependency added. Also
re-confirmed the same `diag.html` page that first reproduced the
artifact now renders correctly full-width under this method, isolating
the original clipping conclusively to the earlier tool invocation rather
than to anything device- or CSS-related.

Result, same disposable preview and sample data as above, both themes,
both widths:

- **No horizontal overflow or clipped element** at either 390px or
  1280px, in either theme — every card, the banner, and the topbar span
  the full available width and wrap correctly.
- **Statuses are readable**: the green "Active" / muted "Discarded"
  chips keep clear contrast against both the dark and light card
  background.
- **The one primary action** ("Open in Import Inbox") stays a clearly
  sized, comfortably tappable button-style link at 390px, never cramped
  against the card edge.
- **No collapsible section exists on this specific page** (unlike
  Import Inbox's own "Details & review" expand/collapse) — this page is
  a flat, read-only list by design, so this checklist item does not
  apply here; nothing was found to break because there is nothing to
  collapse.
- **No form exists on this page** (also by design — every mutation stays
  on Import Inbox); the two interactive elements ("Sign out", "Open in
  Import Inbox") remain well-spaced and reachable at 390px.
- **Light/dark theme parity confirmed**: identical layout and copy in
  both themes, with only the expected token-driven color swap (card
  background, chip colors, banner tint) — no theme-specific breakage.

Mobile is now considered genuinely verified, not merely asserted — this
was re-checked with a method demonstrated (via the same `diag.html`
control) to be free of the earlier artifact, rather than by re-running
the same suspect tooling and hoping for a different result.

## Presentation rebuild (2026-09-12, later still) — candidate detail card

A **visual/UX-only** rebuild of the existing candidate detail card on
`/internal/import-inbox` (the "Details & review" expanded view for one
candidate), driven by two new visual references:
`docs/mockups/restaurant-profile-drafts-v1.png` (page layout/Import Inbox
context) and `docs/mockups/restaurant-profile-drafts-detail-v1.png` (the
compact status overview, primary action, accordions, and history
timeline). No database field, migration, API route, mutation,
authorization rule, or business rule changed — every change below is
presentation/information-hierarchy only, verified by rerunning the full
existing test suite unchanged in intent (only relocated/rewritten where
the assertions checked exact JSX text or position that moved).

**Correction (2026-09-12, later still — commit preparation): only the
first of the two mockups above was committed.**
`restaurant-profile-drafts-detail-v1.png` contains restaurant
photography, which does not fit this project's text-first/no-photography
UI principle (see `CLAUDE.md`) — it was excluded from the commit, stays
in the local working tree unreferenced, and `docs/mockups/README.md` no
longer lists it as a governing design reference. The implementation
choices this mockup informed (the compact status overview, primary
action, accordions, and history timeline) are unaffected by its exclusion
— photography itself was never built, per this same principle — and
remain accurately described below.

**What changed, in `app/internal/import-inbox/page.js`:**

- A **compact status row** (three always-visible items once a candidate's
  detail is expanded): candidate status (`review_status`), completeness
  (`quality_status`/`missing_fields`), and Restaurant Profile Draft
  lineage. All three values already existed — this only gives them one
  consistent, scannable presentation (icon + label + one-line sublabel),
  replacing two previously separate, easy-to-miss lines ("Internally
  approved only. This does not publish…" and "Restaurant Profile Draft
  already created (…)").
- A **compact audit reference** ("View audit details") — shown whenever a
  candidate has an active or a discarded draft, linking to the
  already-built, read-only `/internal/profile-drafts` overview (no new
  page, no new route).
- The existing "Create Restaurant Profile Draft"/duplicate-confirmation/
  discard flow is now the one clear primary action in this area — moved
  into place, restyled, but **every condition, state variable, API call,
  and confirmation step is unchanged** (`canPromoteCandidateToProfileDraft`,
  `canDiscardCandidateDraft`, the 409-duplicate flow, the mandatory
  discard-reason textarea, all identical).
- The former flat stack of "Review history" / "Record a decision" /
  "Enrichment history" / "Enrich missing business info" is now three
  native `<details>`/`<summary>` accordions — **Review decision**,
  **Enrichment**, **History & sources** — using the platform's own
  disclosure element (no new dependency, full keyboard/focus support for
  free). The decision and enrichment *forms* are unchanged, field for
  field. The two separate history lists (review decisions, enrichment
  facts) are merged into one newest-first, human-readable timeline inside
  "History & sources" (`buildCandidateHistoryTimeline`, new pure function
  in `src/lib/importInbox.js`) — each entry shows a short date and a
  plain-language title/description prominently, with the full raw
  timestamp and, for enrichment entries, the source URL, still present
  but de-emphasized (smaller, muted text) rather than hidden.
- The candidate's most-recently-**discarded** Restaurant Profile Draft is
  now also visible (as "Previous draft discarded" in the status row) —
  previously only the *active* draft was resolved by
  `GET /api/internal/v1/import-inbox/candidates`. This required widening
  that route's existing `restaurant_profile_drafts` query (no longer
  filtered to `status = 'draft'` alone; `discarded_at`/`discard_note` were
  added to the `select`) and adding a second pure reducer,
  `buildLatestDiscardedProfileDraftByCandidateId`, alongside the existing
  `buildActiveProfileDraftByCandidateId` — both read-only, same query, no
  new round trip. `buildDraftLineageSummary` (also new, in
  `src/lib/restaurantProfileDrafts.js`) decides which of the two "wins"
  for display (an active draft always wins over discard history).
- Restaurant/dish photography from the mockups was **not** built —
  explicitly out of scope per this project's text-first principle and the
  task's own instruction; neither is the mockups' "Bewerken"/Edit button,
  since no such action exists in the current app.

**Deliberately unchanged**: internal-only authorization
(`authenticateInternalRequest` + `isInternalOnly`), append-only audit
behavior, the duplicate-draft warn-and-confirm flow, the mandatory
discard-reason requirement, and every existing validation function
(`validateReviewDecisionInput`, `validateEnrichmentRequestInput`,
`isReviewDecisionSubmittable`, `hasVerifiedWebsiteForSuggestions`, etc.) —
none were touched. No new theme/styling layer: every new class (`.di-status-*`,
`.di-accordion-*`, `.di-timeline-*`) lives in the same `app/globals.css`
"INTERNAL TOOLING" block and uses only existing CSS custom properties.

**Tests**: `src/lib/importInbox.test.js` gained 6 new unit tests for
`buildCandidateHistoryTimeline` (merge order, field preservation, tie-
break, malformed/missing-timestamp rows, empty input) and had 5 existing
structural safety-net tests updated to match the relocated/rewritten
markup (same intent — e.g. "the explanation is gated on
`review_status === 'approved_internal'`, inside the expanded view" —
just pointed at the new location/wording). `src/lib/restaurantProfileDrafts.test.js`
gained 9 new unit tests (`buildLatestDiscardedProfileDraftByCandidateId`,
`buildDraftLineageSummary`) and 5 new structural safety-net tests (no
photo/image element anywhere on the page; the status row is built from
already-existing data only; the audit link is gated and targets the
existing overview page, never a new route; exactly three native
accordions exist, in order, with "History & sources" open by default; the
promote/discard flow still targets only the two existing routes), plus 2
existing tests updated for the widened candidates-route query and the
relocated "active draft" text. Full suite: **522 tests passing** (up from
504).

**Build**: `npm run build` succeeds (Next.js 15.5.15, no new
dependencies).

**Visual check**: reviewed via a disposable, non-committed local preview
(the same CDP-based, dependency-free method proven in the mobile-
verification round above) at 1280px and 390px, in both the light and dark
theme, covering three states: an approved candidate with an active draft,
an approved candidate whose only draft is a discarded one (verifying the
new "Previous draft discarded" status item and audit link), and a
`needs_enrichment` candidate with no draft (verifying the status row/audit
link degrade gracefully when there is nothing to show). In all cases: no
horizontal overflow or clipped element at either width; the compact status
row wraps to one column per item on mobile with no cramped text; the one
primary action (create/discard/promote-anyway, whichever applies) reads
as the single clear call to action; all three accordions expand/collapse
via native keyboard and pointer interaction with a visible focus ring;
chips, borders, icons, and the timeline's connecting line keep correct
contrast in both themes with only the expected token-driven color swap.

## What this is

A small, internal-only staging layer that lets a member of staff **turn one
already-reviewed import candidate into a durable, named draft record** —
one deliberate step past `MARKET-05A`'s read-only candidate review, and one
long step before any public restaurant page, canonical merge (`MARKET-02`/
the original `MARKET-05B`), or owner-facing Restaurant Onboarding.

It exists to answer one narrow question: *"we've decided this one
candidate is a real, internally-approved restaurant — where does that
decision live, and how do we keep working with it, without either
inventing a second review workflow or waiting for the full canonical/
publication pipeline to exist first?"*

## Pipeline position

Extends the authoritative table in
`market-05-normalization-deduplication.md`'s own `MARKET-05A` section
(added here as a new row, that file's own copy is the addition-dated one):

| Layer | Reads from | Writes | Never |
|---|---|---|---|
| `ImportRun`/`ImportExtractionRecord` (`MARKET-04`) | Registered `Source` | `ImportExtractionRecord`s | Canonical tables, public snapshots |
| `MARKET-05A` (candidate review) | `ImportExtractionRecord`s | `import_candidate_reviews`, `import_candidate_enrichments` | Canonical tables, drafts, any public route |
| **`MARKET-05C` (this contract)** | **One `ImportExtractionRecord` whose *effective* `import_candidate_reviews` status is `approved_internal`, plus its `import_candidate_enrichments`** | **`restaurant_profile_drafts`, `restaurant_profile_draft_field_facts`** | **Canonical tables, `staff_roles`, `restaurant_claims`, `field_provenance`, `data/restaurants.json`/`data/menus.json`, any public route** |
| `MARKET-05B` (cross-source normalization & dedup — original scope, unchanged) | `ImportExtractionRecord`s across sources | Canonical candidate records | Mutates raw extraction records; bypasses moderation |
| Restaurant Onboarding (future, owner-facing, `PLATFORM-07`-triggered) | A promoted draft (once that linkage is designed) | `restaurant_claims`, `staff_roles` | Nothing here decides this yet — see "Relationship to Restaurant Onboarding" below |

**Why this does not depend on or wait for `MARKET-05B`.** `MARKET-05B`'s
job is matching/merging candidates **across different sources** into one
canonical record — blocked today by `MARKET-04` hard gate 3B (the OSM
Collective-vs-Derivative-Database legal review). A Restaurant Profile
Draft never merges two candidates: `restaurant_profile_drafts.source_candidate_id`
names exactly one `import_extraction_records` row, permanently. Promoting
a single, already-reviewed, single-source candidate performs no
cross-source merge at all, so gate 3B does not apply to it. This ticket
does **not** attempt, replace, or pre-empt `MARKET-05B`'s eventual real
deduplication/matching logic — see "Duplicate handling" below for the one,
much narrower thing it does do about duplicates.

## Entities

### `restaurant_profile_drafts` — one row per promoted candidate (identity/header)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` primary key | App-generated (UUIDv7, matching `MARKET-04A`'s existing convention for identity-bearing entities — `generateUuidV7()` in `ops/scripts/capture-market-boundary.js`), not Postgres's `gen_random_uuid()`. **Deliberately not `bigint identity`** — unlike `import_candidate_reviews`/`enrichments` (pure audit-log rows), a draft is itself a persistent, referenceable identity, the same category as `markets`/`import_runs`. |
| `market_id` | `uuid not null references markets(id)` | Derived once at promotion time from `import_extraction_records.import_run_id → import_runs.market_id`, then stored — a candidate's run/market never changes, so this is a snapshot for query convenience, not a second source of truth. |
| `source_candidate_id` | `uuid not null references import_extraction_records(id)` | **Not** a plain column-level `unique` (corrected 2026-09-06, later still — see "Discard is permanent; restart is a new row" below) — a `draft`-scoped partial unique index enforces "at most one *active* draft per candidate," while still permitting a fresh, deliberate promotion after an earlier draft for the same candidate was discarded. |
| `status` | `text not null default 'draft' check (status in ('draft', 'discarded'))` | Deliberately two values only. `draft` is the only "active" state in this phase — there is no `published`/`live` value here; publication does not exist yet (see "Explicit boundaries"). |
| `promoted_by` | `uuid not null references auth.users(id)` | Who ran the promotion — always a real, authenticated `internal` account (see "Roles & access control"). |
| `promoted_at` | `timestamptz not null default now()` | |
| `restarted_from_draft_id` | `uuid references restaurant_profile_drafts(id)` | Set only when this draft is a deliberate re-promotion of a candidate whose earlier draft was discarded (self-referencing, must point at a `discarded` draft with the same `source_candidate_id` — validated by the promotion RPC, not a table constraint, since that check spans two rows). Null for a candidate's first-ever draft. See "Discard is permanent; restart is a new row." |
| `possible_duplicate_of_draft_id` | `uuid references restaurant_profile_drafts(id)` | Set only when promotion proceeded despite a flagged possible duplicate (self-referencing; null the overwhelming majority of the time). Never auto-resolved — see "Duplicate handling." |
| `discarded_by` | `uuid references auth.users(id)` | Null unless `status = 'discarded'`. |
| `discarded_at` | `timestamptz` | Null unless `status = 'discarded'`. |
| `discard_note` | `text check (discard_note is null or char_length(discard_note) <= 2000)` | Free text, same bound as `import_candidate_reviews.note` — optional context, never a fixed reason enum in this first version (see Open decisions). |
| `created_at` | `timestamptz not null default now()` | |

Invariant: `check ((status = 'discarded') = (discarded_by is not null and discarded_at is not null))` — the same symmetric-check pattern `import_candidate_reviews`/`market_boundary_versions` already use for their own optional-but-coupled columns.

**Uniqueness is a partial index, not a plain column constraint:**
`create unique index ... on restaurant_profile_drafts (source_candidate_id) where status = 'draft'` — the exact same pattern `0003_restaurant_claims.sql`'s
`idx_restaurant_claims_one_pending_per_user` already established for an
identical shape of problem ("block an accidental duplicate *active* row,
never block a legitimate fresh attempt after the earlier one was
resolved"). See "Discard is permanent; restart is a new row" immediately
below for why a plain `unique` column constraint — this contract's
original 2026-09-06 draft — was wrong.

**Discarding is the only mutation this table's header ever needs.**
`discard`-related columns get a narrow, column-scoped `update` grant (never
a blanket table update) — mirroring `import_runs`' own
`grant update (status, completed_at, record_counts, error_log, checkpoint)`
precedent exactly. `id`, `market_id`, `source_candidate_id`, `promoted_by`,
`promoted_at`, `restarted_from_draft_id` are never updatable, by any role,
once written.

### Discard is permanent; restart is a new row

**Resolved design decision (2026-09-06, later still — locked before any
implementation).** A discarded draft is never deleted, never mutated back
to `status = 'draft'`, and never silently regenerated by anything in this
system. It stays exactly as it was at the moment of discard, permanently
queryable by `source_candidate_id`, for as long as the table exists — the
same "never erase, only supersede" posture as every append-only table in
this pipeline, extended here to a header row's own terminal state.

If staff later decide a discarded candidate should have a draft after
all, **that is a brand-new, explicit `promote_candidate_to_profile_draft`
call** — the exact same action, and the exact same `approved_internal`
precondition, as any other promotion. Nothing about a discard automatically
or silently recreates a draft; nothing watches for a status change and
re-promotes on its own. The new row gets a new `id`, a new `promoted_by`/
`promoted_at`, and `restarted_from_draft_id` set to the discarded draft's
`id` — an explicit, permanent forward-link (mirroring `import_runs.retried_from_run_id`'s
own precedent for "this is a deliberate do-over of that other row, never
its replacement"). The discarded row itself is completely untouched by
this — both rows coexist forever, one `discarded`, one `draft`, both
carrying the same `source_candidate_id`.

This is exactly why `source_candidate_id`'s uniqueness (above) had to be
a `where status = 'draft'` **partial** index rather than a plain column
constraint: a plain `unique` would have made a legitimate, deliberate
restart structurally impossible after the first discard, not merely
"not automatic" — an error in this contract's original same-day draft,
caught and corrected here before any implementation began.

### `restaurant_profile_draft_field_facts` — append-only value ledger

One row per **fact** (one field, one value, one origin), never one row per
draft — the exact same shape discipline `import_candidate_enrichments`
already established for the layer directly beneath it.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint generated always as identity primary key` | Audit-log row, same category as `import_candidate_reviews`/`enrichments`. |
| `draft_id` | `uuid not null references restaurant_profile_drafts(id)` | |
| `field_name` | `text not null check (field_name in ('name', 'category', 'address', 'phone', 'website'))` | **Fixed set — deliberately identical scope to what `MARKET-05A` already collects.** No menu, price, photo, marketing, or owner-contact field exists in this list, physically, not just by convention — see "Explicit boundaries." |
| `value` | `text not null` | The effective display value at the moment this fact was recorded (mirrors `import_candidate_enrichments.value`'s own "one field, one value" shape). |
| `origin` | `text not null check (origin in ('import', 'enrichment'))` | **Never a third value.** See "Field-level provenance" below — this is the whole point of the invariant "every draft value traces to import or enrichment." |
| `source_enrichment_id` | `bigint references import_candidate_enrichments(id)` | Required exactly when `origin = 'enrichment'`, forbidden when `origin = 'import'`: `check ((origin = 'import') = (source_enrichment_id is null))`, the same symmetric-check idiom used throughout this project (e.g. `import_candidate_reviews`'s `rejected`/`rejection_reason` pair). |
| `recorded_by` | `uuid not null references auth.users(id)` | The `internal` account that triggered promotion or a later sync (see "Promotion flow") — **never** the original candidate's `reviewer_id`; a fact records who *synced it into the draft*, not who originally enriched the candidate (that attribution already lives on the referenced `import_candidate_enrichments` row and is never duplicated here). |
| `recorded_at` | `timestamptz not null default now()` | |

Index: `(draft_id, field_name, recorded_at desc)` — identical shape to
`idx_import_candidate_enrichments_candidate_field`, supporting the same
"every fact for this field, newest first" access pattern.

**No `source_candidate_id` column here.** It would always equal the
parent draft's own `source_candidate_id` in this phase (no cross-candidate
merge exists yet), so storing it again per-fact would be a redundant value
that could theoretically drift from its parent — omitted deliberately, not
an oversight.

**"Current effective value" is derived, never stored.** Exactly
`import_candidate_enrichments`' own philosophy: the latest row by
`recorded_at` for a given `(draft_id, field_name)` pair is the field's
current value — never a mutable "current value" column on the draft or
anywhere else. A pure function mirroring
`buildEnrichmentSourceByCandidateId`/`pickLatestEnrichmentRow` (e.g.
`buildDraftFieldsByDraftId`) is the intended implementation, reusing the
exact tie-break rule (`recorded_at`, then higher `id`) already tested for
those two functions.

**Append-only, physically enforced.** Same grant posture as
`import_candidate_enrichments`: `select, insert` only, to `service_role` —
no `update`/`delete` grant at all, for any role, ever, regardless of any
future application bug. A later correction is always a **new** row, never
an edit of an old one.

## Field-level provenance

Every `restaurant_profile_draft_field_facts` row's value must be traceable
to exactly one of:

1. **`origin = 'import'`** — copied verbatim, at promotion or sync time,
   from `import_extraction_records.extracted_fields` (via the source
   candidate named on the parent draft). No `source_enrichment_id`.
2. **`origin = 'enrichment'`** — copied from one specific, already-existing
   `import_candidate_enrichments` row (`source_enrichment_id`), which
   itself already carries `source_url`/`recorded_at`/`reviewer_id` per
   `MARKET-05A`'s own contract. A draft never re-states or duplicates that
   provenance inline — it references the row, the same "reference, never a
   copy" discipline `MARKET-02`'s `source_references[]` design already
   uses for its own, later, larger canonical schema.

**There is no third origin, and deliberately no free-form "manual
correction on the draft" path.** If a value needs correcting after
promotion, the correction happens exactly where `MARKET-05A` already lets
it happen — a new `import_candidate_enrichments` row on the **original
candidate**, through the existing, unchanged `/internal/import-inbox`
enrichment form — and is then explicitly synced into the draft (see
"Promotion & sync flow"). This keeps the invariant airtight at all times,
past and present: **every value a Restaurant Profile Draft has ever shown
traces to something that already existed in `import_extraction_records` or
`import_candidate_enrichments` before the draft fact was written.** No
second, parallel place to "just type a corrected phone number" is
introduced by this feature.

This is a deliberate simplification relative to `docs/api/data-trust-model.md`'s
full `source`/`confidence`/`verifiedAt`/`verifiedBy` vocabulary (`owner`/
`community`/`editor`/`imported`/`unknown`) and `MARKET-02`'s
`FieldAssertion`, both designed for the **later**, post-onboarding
canonical/public record where owner and community sources genuinely exist.
Neither applies here — a draft has no owner, no claim, no public
visibility — so reusing that full vocabulary now would imply trust tiers
that cannot yet be true. `origin` (`import`/`enrichment`) is intentionally
a narrow subset that a future migration step (Onboarding's own ticket, not
this one) could map onto that fuller vocabulary — `import → imported`,
`enrichment → editor` — without needing to invent new meaning
retroactively.

## Promotion & sync flow

Every write is one explicit action by one authenticated `internal`
account. Nothing here is scheduled, batch, or triggered by any other
event.

### `promote_candidate_to_profile_draft(p_candidate_id, p_actor_user_id, p_possible_duplicate_of_draft_id default null, p_restarted_from_draft_id default null)`

**Correction (2026-09-06, later still — implementation round): this
signature was missing `p_draft_id`.** The application-generated id (see
the `id` column above) has to reach this function somehow, and this
section never named how. Implemented with `p_draft_id` as the first
parameter — see "Implementation" at the top of this file for the full
reasoning; this does not change the design, only completes a mechanical
detail this section left implicit.

Single-purpose RPC, mirroring `record_import_candidate_review`'s /
`approve_pending_change`'s existing pattern (`security invoker`, fixed
`search_path`, one transaction):

1. Re-derive the candidate's **effective** review status server-side
   (latest `import_candidate_reviews` row for `p_candidate_id`) — must be
   `approved_internal`, or raise a typed error. **Never trusts a
   client-sent status.**
2. Confirm no **`draft`-status** row already references this candidate
   (belt-and-suspenders alongside the partial unique index, for a clean
   error message instead of a raw constraint violation) — a `discarded`
   row for the same candidate is expected and never blocks this.
3. If `p_restarted_from_draft_id` is provided, confirm it names an
   existing `discarded` draft whose own `source_candidate_id` matches
   `p_candidate_id` — a caller-provided value is never trusted without
   this check (the same discipline every other RPC in this project applies
   to its own inputs).
4. Insert the draft header row (`status = 'draft'`, `promoted_by`,
   `promoted_at = now()`, `possible_duplicate_of_draft_id` and
   `restarted_from_draft_id` as passed in and validated above).
5. Read the candidate's current effective values (raw `extracted_fields`
   for `name`/`category`; latest-enrichment-or-raw for `address`/`phone`/
   `website`, i.e. the exact same derivation `computeEnrichedFields`
   already performs) and insert one `restaurant_profile_draft_field_facts`
   row per populated field, tagging `origin`/`source_enrichment_id`
   correctly per field.
6. All of 2–5 in one transaction — either the whole promotion succeeds, or
   none of it is written.

**Duplicate-heuristic computation happens in application code, not SQL.**
The caller (the new API route) is expected to run the existing, already-
tested `computePossibleDuplicateIds` heuristic (name + ≤100m haversine
distance) across "the candidate about to be promoted" and "every candidate
that already backs an *active* (`status = 'draft'`) draft" — a discarded
draft is a settled "no" and does not keep generating duplicate warnings
for unrelated candidates — and pass the result as
`p_possible_duplicate_of_draft_id` — reusing the one already-tested
implementation rather than re-deriving geo-matching logic inside a stored
procedure. The RPC's own job stays purely transactional.

### `record_profile_draft_field_sync(p_draft_id, p_actor_user_id, p_field_name)`

Re-derives the named field's current effective value from the **source
candidate** (same derivation as step 4 above, for one field). If it
differs from the draft's own current effective value for that field,
inserts one new fact row (`origin = 'enrichment'`, the latest matching
`import_candidate_enrichments` row's id). **No-op, explicitly reported as
"already up to date," if unchanged** — never inserts an identical
duplicate fact. This is the **only** way a draft's field value ever
changes after promotion, and it is never automatic: nothing watches for
new enrichments and syncs them on its own. A later "candidate has newer
data since last sync" indicator (read-only, computed by comparing
timestamps) is a reasonable follow-on UI affordance, not a silent
auto-sync — see Open decisions.

### `discard_profile_draft(p_draft_id, p_actor_user_id, p_note)`

Sets `status = 'discarded'`, `discarded_by`, `discarded_at = now()`,
`discard_note`. Valid only from `status = 'draft'`. Never deletes the row
or any of its field facts — a discarded draft's full history remains
readable, the same "never erase, only supersede" posture as every other
table in this pipeline.

## Duplicate handling

Two distinct duplicate risks, handled two different ways:

1. **The same candidate with two *active* drafts at once.** Physically
   prevented: the `where status = 'draft'` partial unique index on the
   header table. Not a warning, not an override — structurally impossible.
   A deliberate restart after an explicit discard is not this case — see
   "Discard is permanent; restart is a new row."
2. **Two different, already-`approved_internal` candidates that are
   probably the same real restaurant** (e.g. found via two different
   `ImportRun`s of the same source, or — once a second source ever exists
   — two different sources; the latter is exactly `MARKET-05B`'s eventual
   job, not reproduced here). Handled as a **visible warning, not a silent
   block and not a silent allow**: the promotion API computes the
   possible-duplicate check (above) and, if it finds one, returns a
   structured response asking the caller to confirm before proceeding.
   Confirming records `possible_duplicate_of_draft_id` on the new draft —
   a permanent, visible flag for whoever later does real reconciliation
   (`MARKET-05B`, or a dedicated follow-on), never auto-merged, auto-
   rejected, or hidden.

## Roles & access control

`internal` only — create, view, and modify (sync/discard) — identical
posture to `MARKET-05A`'s own `import_candidate_reviews`/`enrichments`,
for the same reason already documented there: `editor` is
restaurant-scoped (`staff_roles.restaurant_id`), and a draft has no
`staff_roles` row pointing at it and cannot have one yet — nothing creates
one in this phase (see "Explicit boundaries"). `owner` does not exist for
a draft at all: no claim, no verification, no owner session is ever
created or referenced here. This mirrors
`app/api/internal/v1/import-inbox/*`'s exact `authenticateInternalRequest`
+ `isInternalOnly(roles)` gate — no new auth mechanism.

RLS: enabled on both tables, zero policies for `anon`/`authenticated`/
`editor`/`owner` — matching `import_extraction_records`'/
`import_candidate_reviews`'s posture exactly (defense-in-depth only; the
internal API always calls as `service_role`, which bypasses RLS).

## Audit trail

- **Creation**: the draft header row itself (`promoted_by`/`promoted_at`)
  plus the initial batch of field-facts rows it's created together with,
  in one transaction — this **is** the creation audit record; no separate
  "promotion event log" table is introduced, avoiding a redundant third
  table that would just restate the header row's own fields.
- **Later corrections**: every `record_profile_draft_field_sync` call adds
  a new, permanent field-facts row — the full history of every value a
  field has ever held, and exactly which enrichment (or the original
  import) produced each one, is always readable by querying that field's
  facts in order. Nothing is ever overwritten.
- **Discard**: `discarded_by`/`discarded_at`/`discard_note` on the header
  — a single, well-scoped, column-restricted mutation (the one deliberate
  exception to "this table is otherwise immutable"), the same posture
  `pending_changes`/`restaurant_claims` already use for their own
  terminal-state transition.

## Explicit boundaries

Everything below is a hard, structural exclusion for this contract, not
merely an implementation choice deferred to "later":

- **No automatic promotion.** `promote_candidate_to_profile_draft` is only
  ever invoked by one explicit API call from one explicit UI action by an
  authenticated `internal` user — nothing scheduled, batched, or triggered
  by a review decision itself (recording `approved_internal` on a
  candidate does **not** promote it; that remains two entirely separate,
  human-triggered actions, the same "review and enrichment are independent
  actions" discipline `MARKET-05A` already established for its own two
  actions).
- **No public restaurant page, route, or API.** Nothing under `/internal/*`
  gains a public counterpart here; no `app/restaurant/[id]`-style route is
  added or changed; `data/restaurants.json`/`data/menus.json` are never
  read or written by anything in this contract.
- **No menu, price, photo, or marketing data.** `field_name`'s check
  constraint physically excludes them — there is no column, no JSON key,
  no code path in this design that could carry one.
- **No owner contact.** No email, phone-for-the-owner, or any
  claim-adjacent identity data is ever stored by this feature.
  `restaurant_claims`/`staff_roles` are never read or written by anything
  in this contract.
- **No onboarding.** No claim, verification step, or owner session is
  created, referenced, or implied. `platform-07-owner-claim-identity-verification.md`'s
  own "Out of scope" section already names "new-restaurant onboarding" as
  future scope unrelated to claim verification itself — this contract
  does not build that future scope either, it only leaves room for it (see
  below).

## Relationship to a future Restaurant Onboarding

Not designed here — named only so the eventual design has somewhere
concrete to attach to. A plausible future shape, **not decided or built by
this contract**:

- A `restaurant_profile_drafts.id` is a reasonable candidate to become the
  `restaurant_id` a future claim (`restaurant_claims.restaurant_id`,
  currently `text`, matching `data/restaurants.json`'s own string keys —
  note the type mismatch against this contract's `uuid`, an open migration
  detail for whoever designs Onboarding, not resolved here) would
  eventually reference, once Onboarding exists and a business claims that
  draft.
- Nothing in this contract grants that linkage automatically. A draft
  reaching `status = 'draft'` is never itself a trigger for anything
  owner-facing — Onboarding would need its own explicit step (analogous to
  today's `restaurant_claims` flow) that a human, on the business side,
  initiates.
- Whether a claimed draft ever needs a distinct status value beyond
  `draft`/`discarded` (e.g. `claimed`) is explicitly **not decided here** —
  see Open decisions.

## Resolved decisions (2026-09-06, later still — confirmed before implementation)

Product review of this contract confirmed the following, locking them in
before any migration/RPC/API/UI is built:

1. **Ticket identity**: `MARKET-05C` accepted as its own ticket, distinct
   from `MARKET-05B` — this contract is the source of truth for `05C`,
   committed as documentation before any implementation step.
2. **Duplicate-draft response**: **warn-and-allow-with-audit**
   (`possible_duplicate_of_draft_id`), not a hard block — judged safe at
   the current, small dataset size; a hard block would risk trapping a
   reviewer on two genuinely different restaurants that happen to share a
   name/location (e.g. two branches of a chain), and real deduplication
   remains `MARKET-05B`'s job, not reproduced here.
3. **Promotion stays exclusively for `approved_internal`, with no
   automatic sync and no publication of any kind** — reconfirmed as
   non-negotiable, not merely a default.
4. **Sync stays fully explicit.** After a new enrichment is recorded on
   the source candidate, an internal user must deliberately choose to
   sync it into the draft (e.g. a "sync latest facts" action) — which
   always writes a **new** field-fact row, never overwrites or edits an
   existing one. A passive "candidate has newer data since last sync"
   indicator remains a reasonable follow-on affordance (still no write on
   its own) but the write itself is never silent or automatic.
5. **Discard is permanent; restart is always a new, deliberate action.**
   See "Discard is permanent; restart is a new row" above for the full
   design — a discarded draft is never deleted, never resurrected in
   place, and never silently regenerated; a later change of mind is a
   brand-new `promote_candidate_to_profile_draft` call, producing a new
   row with `restarted_from_draft_id` set. This required correcting
   `source_candidate_id`'s uniqueness from a plain column constraint (this
   contract's original same-day draft) to a `where status = 'draft'`
   partial unique index, matching `restaurant_claims`'s own
   one-pending-per-user precedent.
6. **Implementation sequencing**: migration, RPC, API routes, and the
   internal "promote" UI action are built as **one separate, later,
   explicitly-authorized step** — not part of this design round. This
   document is committed as documentation/schema contract only, matching
   the `MARKET-01`–`03` precedent of shipping the contract before the
   implementation.

## Open decisions

Recommended choices are marked; none are irreversible, all are cheap to
change before any code exists.

1. **Discard reason taxonomy**: free-text `discard_note` (this contract's
   default) vs. a fixed enum like `rejection_reason`'s. **Recommended**:
   free text for `05C`'s first version — revisit once real discard
   patterns exist to categorize, the same reasoning `import_candidate_reviews.note`
   already applied.
2. **Draft `id` generation**: app-generated UUIDv7 (this contract's
   default, matching `markets`/`import_runs`) vs. Postgres `identity`.
   **Recommended**: UUIDv7 — a draft is an identity-bearing entity, not an
   audit-log row.
3. **Field allowlist growth**: whether `restaurant_profile_draft_field_facts.field_name`
   should ever cover more than `name`/`category`/`address`/`phone`/
   `website` (e.g. `opening_hours`, ahead of any menu/price data).
   **Not decided here** — deliberately scoped to exactly what `MARKET-05A`
   already collects; expanding it is a separate, later, explicit decision
   as this project's convention already requires for such lists (see
   `import_candidate_enrichments.field_name`'s own comment).
4. **Role granularity**: whether `internal` should eventually split into a
   narrower role once this surface grows (e.g. distinct from raw-import
   reviewing). **Recommended**: no — reuse `internal` exactly as
   `MARKET-05A` does; revisit only if real usage demands separation.
5. **Claimed-draft status**: whether a future Onboarding needs a new
   `restaurant_profile_drafts.status` value (e.g. `claimed`) or an entirely
   separate table. **Not decided here** — explicitly Onboarding's own
   design question.

## Out of scope for this contract

- Any canonical (`MARKET-02`), publication (`MARKET-06`), or public
  read-path change.
- `MARKET-05B`'s actual cross-source matching/deduplication algorithm.
- Restaurant Onboarding's actual design (claim linkage, verification,
  owner editing) — named above only as a forward-compatibility note.
- Any code, migration, RLS policy, or Supabase change of any kind — see
  "Status" at the top of this file.
