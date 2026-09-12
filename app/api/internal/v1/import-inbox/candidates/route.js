// MARKET-05A — Data-inbox candidate list. `internal`-only. Reads only
// `import_extraction_records` — already-minimized `extracted_fields`,
// never a raw source feature — plus which `import_run_id` each belongs
// to. `possible_duplicate`/`quality_status` are computed here, read-only,
// on every request (src/lib/importInbox.js) — never stored, never
// MARKET-05B's real deduplication logic. Never writes, never touches a
// canonical table, never a public route.
//
// **Update (2026-09-05): also resolves each candidate's `review_status`**
// (the append-only, human review decision — see
// supabase/migrations/0007_market05a_candidate_reviews.sql and
// candidates/[id]/reviews/route.js) from the latest
// `import_candidate_reviews` row per candidate, defaulting to `'new'`
// when none exists. This route still never writes anything, to this
// table or any other — recording a decision only ever happens via the
// separate `candidates/[id]/reviews` POST route.
//
// **Update (2026-09-05, later the same day): also resolves each
// candidate's `enriched_fields`/`enrichment_sources`** from
// `import_candidate_enrichments` (supabase/migrations/0008_market05a_candidate_enrichments.sql)
// — the raw `extracted_fields` with any `address`/`phone`/`website`
// overridden by its latest, effective enrichment. `quality_status`/
// `missing_fields` are now computed from this combined view, not the
// raw fields alone, so a manually-sourced value can move a candidate
// from "incomplete" to "complete." Entirely independent of
// `import_candidate_reviews` — this route never reads that table's
// `note` field or derives an enrichment from it.
//
// **Update (2026-09-06): also resolves each candidate's *current*
// `deferred_reason`** (the structured reason from that same latest
// review row, added by supabase/migrations/0009_market05a_candidate_reviews_deferred_reason.sql
// — see buildLatestDeferredReasonByCandidateId's own comment) — `null`
// unless the candidate's effective status is actually `'deferred'`
// right now. Built for the client-side "Triage overview" section on
// `/internal/import-inbox`; no new query, no write, no automatic
// classification of any kind.
//
// **Update (2026-09-06, later still) — MARKET-05C: also resolves each
// candidate's active Restaurant Profile Draft, if any** (`profile_draft`
// — `null` unless a `status = 'draft'` row already exists for it, per
// supabase/migrations/0010_market05c_restaurant_profile_drafts.sql). This
// route still never writes anything — creating a draft only ever happens
// via the separate `POST /api/internal/v1/profile-drafts` route.
//
// **Update (2026-09-12) — also resolves each candidate's most-recently-
// discarded Restaurant Profile Draft, if any** (`latest_discarded_draft`
// — `null` unless a `status = 'discarded'` row exists for it), for the
// candidate detail card's "Previous profile draft discarded" line. Still
// read-only: discarding a draft only ever happens via the separate
// `POST /api/internal/v1/profile-drafts/[id]/discard` route.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import {
  isInternalOnly,
  enrichAndFilterCandidates,
  buildReviewStatusByCandidateId,
  buildLatestDeferredReasonByCandidateId,
  buildEnrichmentSourceByCandidateId,
} from '@/src/lib/importInbox'
import {
  buildActiveProfileDraftByCandidateId,
  buildLatestDiscardedProfileDraftByCandidateId,
} from '@/src/lib/restaurantProfileDrafts'

// Same headroom reasoning as RECORD_LIMIT below — bounded, not
// pagination, revisit once volume materially exceeds this. One row per
// review *decision*, not per candidate, so this can exceed RECORD_LIMIT
// once candidates start accumulating more than one decision each.
const REVIEW_LIMIT = 4000

// One row per enrichment *fact* (one field, one value), not per
// candidate — same headroom reasoning as REVIEW_LIMIT above.
const ENRICHMENT_LIMIT = 4000

// One row per draft *lifecycle event* (a promotion or a discard), not
// per candidate — same headroom reasoning as REVIEW_LIMIT/ENRICHMENT_LIMIT
// above. See the query below for how ordering keeps this limit from ever
// hiding a candidate's *active* draft, and why the same, already-accepted
// "latest per candidate over the top-N most recent events" tradeoff
// REVIEW_LIMIT/ENRICHMENT_LIMIT already carry applies here too, deliberately
// — not a new or different risk.
const DRAFT_LIMIT = 4000

// v1 limitation, not silently ignored: enough headroom for every
// candidate the real, already-run dry-runs actually produced (500
// stored), with room to grow — revisit with real pagination once volume
// materially exceeds this.
const RECORD_LIMIT = 2000

function parseBooleanParam(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can view the import inbox' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('run_id') || undefined
  const category = searchParams.get('category') || undefined
  const name = searchParams.get('name') || undefined
  const possibleDuplicate = parseBooleanParam(searchParams.get('possible_duplicate'))
  const quality = searchParams.get('quality') || undefined
  const reviewStatus = searchParams.get('review_status') || undefined

  const supabase = getSupabaseAdmin()
  const { data: records, error: recordsError } = await supabase
    .from('import_extraction_records')
    .select('id, import_run_id, record_locator, retrieved_at, extracted_fields')
    .order('retrieved_at', { ascending: false })
    .limit(RECORD_LIMIT)
  if (recordsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  // MARKET-05A: every review row across every candidate, in one bounded
  // query — buildReviewStatusByCandidateId (pure, src/lib/importInbox.js)
  // reduces this to "latest decision per candidate_id" without a second
  // per-candidate round trip. `deferred_reason` (added 2026-09-06, for
  // the triage overview) is read from the same rows via
  // buildLatestDeferredReasonByCandidateId — no second query.
  const { data: reviews, error: reviewsError } = await supabase
    .from('import_candidate_reviews')
    .select('id, candidate_id, decided_at, status, deferred_reason')
    .order('decided_at', { ascending: false })
    .limit(REVIEW_LIMIT)
  if (reviewsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  const reviewStatusByCandidateId = buildReviewStatusByCandidateId(reviews)
  const deferredReasonByCandidateId = buildLatestDeferredReasonByCandidateId(reviews)

  // MARKET-05A: every enrichment row across every candidate, in one
  // bounded query — buildEnrichmentSourceByCandidateId (pure,
  // src/lib/importInbox.js) reduces this to "latest value per
  // (candidate, field)" without a second per-candidate round trip.
  const { data: enrichments, error: enrichmentsError } = await supabase
    .from('import_candidate_enrichments')
    .select('id, candidate_id, field_name, value, source_url, recorded_at, reviewer_id')
    .order('recorded_at', { ascending: false })
    .limit(ENRICHMENT_LIMIT)
  if (enrichmentsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  const enrichmentSourceByCandidateId = buildEnrichmentSourceByCandidateId(enrichments)

  // MARKET-05C: every draft header row (active AND discarded), in one
  // bounded query (DRAFT_LIMIT, added 2026-09-12 — this query briefly had
  // no limit at all while it was scoped to `status = 'draft'` only; once
  // widened to also read discarded rows for the "Previous profile draft
  // discarded" line, an explicit bound became necessary again, same as
  // every other query in this route) — buildActiveProfileDraftByCandidateId
  // reduces this to "the active draft per source_candidate_id, if any,"
  // and buildLatestDiscardedProfileDraftByCandidateId separately reduces
  // it to "the most-recently-discarded draft per source_candidate_id, if
  // any" — both pure, both in src/lib/restaurantProfileDrafts.js, neither
  // issuing a second query. Read-only: creating/discarding a draft only
  // ever happens via the separate profile-drafts route.
  //
  // Ordered `discarded_at` descending with nulls first, then `id`
  // descending: every *active* draft (`discarded_at` is null) sorts
  // ahead of every discarded one, so DRAFT_LIMIT can never cut off an
  // active draft — its own count is already bounded to at most one per
  // candidate that has ever been promoted (the migration's own partial
  // unique index), nowhere near this limit. The secondary `id` order
  // (`restaurant_profile_drafts.id` is an application-generated UUIDv7 —
  // see src/lib/uuidv7.js — whose byte order already matches creation
  // order) makes the full `(discarded_at, id)` ordering stable even
  // among rows that share the exact same `discarded_at`, the same
  // two-column-order convention this project's review/enrichment history
  // routes already use — without it, which of several exactly-tied rows
  // falls on either side of the limit boundary would not be guaranteed
  // consistent across requests. Discarded rows are then ordered
  // newest-first *across all candidates*, not scoped per candidate — a
  // plain, unscoped `.limit()` here would risk silently dropping a
  // specific candidate's own latest discarded row if enough more-recent
  // discards from *other* candidates filled the limit first. Scoping
  // this query to only the candidates on
  // the current page (`.in('source_candidate_id', ...)`) was considered
  // and rejected: with RECORD_LIMIT candidates, that filter can carry up
  // to 2000 UUIDs, and PostgREST/Supabase's own request-size limits are
  // not something this route can safely assume headroom for. Instead,
  // this accepts the exact same, already-shipped tradeoff
  // buildReviewStatusByCandidateId/buildEnrichmentSourceByCandidateId
  // above already make via REVIEW_LIMIT/ENRICHMENT_LIMIT (both are also
  // "latest per candidate" reductions over a globally newest-first,
  // limited query) — not a new or different risk, and, like those two,
  // a known v1 limitation rather than a silently ignored one: revisit
  // (e.g. a dedicated per-candidate "latest" database view) once real
  // discard volume materially exceeds this.
  const { data: drafts, error: draftsError } = await supabase
    .from('restaurant_profile_drafts')
    .select(
      'id, source_candidate_id, status, promoted_by, promoted_at, restarted_from_draft_id, possible_duplicate_of_draft_id, discarded_at, discard_note'
    )
    .order('discarded_at', { ascending: false, nullsFirst: true })
    .order('id', { ascending: false })
    .limit(DRAFT_LIMIT)
  if (draftsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  const profileDraftByCandidateId = buildActiveProfileDraftByCandidateId(drafts)
  const latestDiscardedDraftByCandidateId = buildLatestDiscardedProfileDraftByCandidateId(drafts)

  const { candidates, totalBeforeFilters } = enrichAndFilterCandidates(records, {
    runId,
    category,
    name,
    possibleDuplicate,
    quality,
    reviewStatusByCandidateId,
    reviewStatus,
    enrichmentSourceByCandidateId,
    deferredReasonByCandidateId,
    profileDraftByCandidateId,
    latestDiscardedDraftByCandidateId,
  })

  return NextResponse.json({
    candidates,
    total_before_filters: totalBeforeFilters,
    total_after_filters: candidates.length,
  })
}
