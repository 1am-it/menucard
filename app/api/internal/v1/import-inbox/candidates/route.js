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

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import {
  isInternalOnly,
  enrichAndFilterCandidates,
  buildReviewStatusByCandidateId,
  buildEnrichmentSourceByCandidateId,
} from '@/src/lib/importInbox'

// Same headroom reasoning as RECORD_LIMIT below — bounded, not
// pagination, revisit once volume materially exceeds this. One row per
// review *decision*, not per candidate, so this can exceed RECORD_LIMIT
// once candidates start accumulating more than one decision each.
const REVIEW_LIMIT = 4000

// One row per enrichment *fact* (one field, one value), not per
// candidate — same headroom reasoning as REVIEW_LIMIT above.
const ENRICHMENT_LIMIT = 4000

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
  // per-candidate round trip.
  const { data: reviews, error: reviewsError } = await supabase
    .from('import_candidate_reviews')
    .select('id, candidate_id, decided_at, status')
    .order('decided_at', { ascending: false })
    .limit(REVIEW_LIMIT)
  if (reviewsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  const reviewStatusByCandidateId = buildReviewStatusByCandidateId(reviews)

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

  const { candidates, totalBeforeFilters } = enrichAndFilterCandidates(records, {
    runId,
    category,
    name,
    possibleDuplicate,
    quality,
    reviewStatusByCandidateId,
    reviewStatus,
    enrichmentSourceByCandidateId,
  })

  return NextResponse.json({
    candidates,
    total_before_filters: totalBeforeFilters,
    total_after_filters: candidates.length,
  })
}
