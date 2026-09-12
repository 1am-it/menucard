// MARKET-05C — Restaurant Profile Drafts. `internal`-only, same guard as
// every other Data-inbox route (see docs/api/restaurant-profile-drafts-schema.md's
// "Roles & access control"). POST is the *only* way to create a draft —
// one explicit action per call, always via the
// promote_candidate_to_profile_draft() RPC
// (supabase/migrations/0010_market05c_restaurant_profile_drafts.sql).
// Never touches a canonical/public table, never writes to
// staff_roles/restaurant_claims, never publishes anything — a draft is
// purely internal.
//
// Duplicate handling (schema contract's own "Duplicate handling"
// section): the possible-duplicate heuristic (name + ≤100m distance,
// src/lib/restaurantProfileDrafts.js's findPossibleDuplicateDraftId,
// reusing importInbox.js's already-tested computePossibleDuplicateIds
// primitives) runs here, in application code, *before* calling the RPC —
// never inside the database function itself. A detected duplicate is
// never auto-merged or auto-blocked: this route returns a distinct,
// structured 409 asking the caller to explicitly confirm before
// proceeding (`confirm_possible_duplicate_of_draft_id` echoed back on the
// next call) — visible and auditable (recorded as
// `possible_duplicate_of_draft_id` on the created draft), never silent.
//
// Restart linkage: this route looks up the most recently discarded draft
// for the same candidate (if any) and passes its id as
// `p_restarted_from_draft_id` — the RPC itself validates that reference
// before trusting it (see the migration's own comment). Nothing here
// requires the caller to know about a prior discarded draft's id.
//
// GET (added 2026-09-12, next step after the production smoke test) — the
// read-only list /internal/profile-drafts renders. Lists every draft,
// active AND discarded, plus each one's source candidate's name (for
// display only — never its full field set, to avoid duplicating
// import-inbox's own candidate cards). This handler only ever reads — it
// issues no create, mutate, or remove call of any kind.
//
// **Update (2026-09-12, later still) — bounded query follow-up.** The
// single, unfiltered `restaurant_profile_drafts` read above briefly had
// no limit at all. Restored via two separate queries instead of one
// plain `.limit()`: active drafts are always fetched in full (see
// DISCARDED_DRAFT_LIMIT's own comment below for why that's safe), and
// only the discarded side — this table's unbounded, ever-growing history
// — carries a named limit. The page's own "N active / M discarded"
// summary uses `total_discarded` (an exact count, independent of that
// limit), so it can never understate how many discarded drafts actually
// exist, even once real volume exceeds DISCARDED_DRAFT_LIMIT.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import {
  findPossibleDuplicateDraftId,
  buildDraftFieldsByDraftId,
  buildProfileDraftOverviewRows,
} from '@/src/lib/restaurantProfileDrafts'
import { generateUuidV7 } from '@/src/lib/uuidv7'

const DRAFT_OVERVIEW_COLUMNS =
  'id, source_candidate_id, status, promoted_at, discarded_at, discard_note, possible_duplicate_of_draft_id, restarted_from_draft_id'

// One row per discard *event*; nothing here is ever deleted (discard is
// permanent — see the schema contract's own "Discard is permanent"
// section), so unlike active drafts this side of the table only ever
// grows. Ordered `discarded_at` descending, then `id` descending
// (`restaurant_profile_drafts.id` is an application-generated UUIDv7 —
// see src/lib/uuidv7.js — whose byte order already matches creation
// order, the same reasoning buildLatestDiscardedProfileDraftByCandidateId's
// own tie-break already relies on), before this limit is applied — the
// same `(timestamp, id)` two-column-order convention this project's
// review/enrichment history routes already use. Without that second key,
// two rows sharing the exact same `discarded_at` sitting right at the
// limit boundary would have no guaranteed, stable inclusion order across
// requests. With it, a truncation — if real discard volume ever grows
// enough to reach it — only ever drops the OLDEST discarded rows,
// deterministically, never the most recent ones, and never affects
// `total_discarded` (a separate, exact count). Known v1 limitation, not
// silently ignored: revisit (e.g. real pagination) once discard volume
// materially exceeds this. Deliberately generous relative to this
// table's real growth rate — each row requires a deliberate,
// one-at-a-time internal promote-then-discard action, so this is far
// larger headroom than RECORD_LIMIT gives the much higher-volume raw
// import candidate list in the sibling route.
const DISCARDED_DRAFT_LIMIT = 2000

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can view Restaurant Profile Drafts' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()

  // Active drafts: always fetched in full, never limited. At most one
  // per candidate that has ever been promoted (the migration's own
  // partial unique index) — the same small, inherently-bounded set this
  // file's own POST handler below already fetches unconditionally (see
  // its "possible-duplicate check" query) — so a candidate's current
  // active draft can never be hidden by DISCARDED_DRAFT_LIMIT, which
  // only ever applies to the query below.
  const { data: activeDraftRows, error: activeDraftsError } = await supabase
    .from('restaurant_profile_drafts')
    .select(DRAFT_OVERVIEW_COLUMNS)
    .eq('status', 'draft')
  if (activeDraftsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const { data: discardedDraftRows, error: discardedDraftsError } = await supabase
    .from('restaurant_profile_drafts')
    .select(DRAFT_OVERVIEW_COLUMNS)
    .eq('status', 'discarded')
    .order('discarded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(DISCARDED_DRAFT_LIMIT)
  if (discardedDraftsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  // Exact total, independent of DISCARDED_DRAFT_LIMIT — `head: true`
  // returns only the count, never the rows themselves, so this stays a
  // cheap, index-backed query even as the table grows well past the
  // limit above.
  const { count: totalDiscarded, error: discardedCountError } = await supabase
    .from('restaurant_profile_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'discarded')
  if (discardedCountError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const draftRows = [...(activeDraftRows || []), ...(discardedDraftRows || [])]

  const candidateIds = [...new Set(draftRows.map((row) => row.source_candidate_id).filter(Boolean))]
  const candidateNameById = {}
  if (candidateIds.length > 0) {
    const { data: candidateRows, error: candidatesError } = await supabase
      .from('import_extraction_records')
      .select('id, extracted_fields')
      .in('id', candidateIds)
    if (candidatesError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    for (const row of candidateRows || []) {
      candidateNameById[row.id] = (row.extracted_fields && row.extracted_fields.name) || null
    }
  }

  return NextResponse.json({
    drafts: buildProfileDraftOverviewRows(draftRows, candidateNameById),
    total_discarded: totalDiscarded || 0,
  })
}

export async function POST(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can create Restaurant Profile Drafts' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const candidateId = body && body.candidate_id
  if (typeof candidateId !== 'string' || candidateId.trim().length === 0) {
    return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 })
  }
  const confirmPossibleDuplicateOfDraftId =
    typeof (body && body.confirm_possible_duplicate_of_draft_id) === 'string' ? body.confirm_possible_duplicate_of_draft_id : null

  const supabase = getSupabaseAdmin()

  const { data: candidateRow, error: candidateError } = await supabase
    .from('import_extraction_records')
    .select('id, extracted_fields')
    .eq('id', candidateId)
    .maybeSingle()
  if (candidateError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  if (!candidateRow) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

  // Possible-duplicate check — every candidate that already backs an
  // *active* draft (never a discarded one — a settled "no" does not keep
  // generating warnings for unrelated candidates), across two queries
  // (never N+1: one for the active drafts, one for their source
  // candidates' fields).
  const { data: activeDraftRows, error: activeDraftsError } = await supabase
    .from('restaurant_profile_drafts')
    .select('id, source_candidate_id')
    .eq('status', 'draft')
  if (activeDraftsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const otherActiveDraftRows = (activeDraftRows || []).filter((row) => row.source_candidate_id !== candidateId)
  let activeDraftCandidates = []
  if (otherActiveDraftRows.length > 0) {
    const { data: otherCandidateRows, error: otherCandidatesError } = await supabase
      .from('import_extraction_records')
      .select('id, extracted_fields')
      .in(
        'id',
        otherActiveDraftRows.map((row) => row.source_candidate_id)
      )
    if (otherCandidatesError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    const extractedFieldsByCandidateId = {}
    for (const row of otherCandidateRows || []) extractedFieldsByCandidateId[row.id] = row.extracted_fields
    activeDraftCandidates = otherActiveDraftRows.map((row) => ({
      draftId: row.id,
      extractedFields: extractedFieldsByCandidateId[row.source_candidate_id],
    }))
  }

  const possibleDuplicateDraftId = findPossibleDuplicateDraftId(candidateRow.extracted_fields, activeDraftCandidates)
  if (possibleDuplicateDraftId && possibleDuplicateDraftId !== confirmPossibleDuplicateOfDraftId) {
    return NextResponse.json(
      {
        error: 'This candidate looks like a possible duplicate of an already-promoted draft. Confirm to promote anyway.',
        possible_duplicate: true,
        possible_duplicate_of_draft_id: possibleDuplicateDraftId,
      },
      { status: 409 }
    )
  }

  // Restart linkage — the most recently discarded draft for this exact
  // candidate, if any. The RPC validates this reference itself before
  // trusting it; this route never assumes it is correct.
  const { data: discardedDraftRows, error: discardedDraftsError } = await supabase
    .from('restaurant_profile_drafts')
    .select('id, discarded_at')
    .eq('source_candidate_id', candidateId)
    .eq('status', 'discarded')
    .order('discarded_at', { ascending: false })
    .limit(1)
  if (discardedDraftsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  const restartedFromDraftId = discardedDraftRows && discardedDraftRows[0] ? discardedDraftRows[0].id : null

  const draftId = generateUuidV7()

  const { data: draft, error: promoteError } = await supabase.rpc('promote_candidate_to_profile_draft', {
    p_draft_id: draftId,
    p_candidate_id: candidateId,
    p_actor_user_id: auth.userId,
    p_possible_duplicate_of_draft_id: possibleDuplicateDraftId,
    p_restarted_from_draft_id: restartedFromDraftId,
  })

  if (promoteError) {
    if (promoteError.code === 'P0002') return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    if (promoteError.code === 'P0010') {
      return NextResponse.json({ error: 'Candidate is not approved_internal — only approved candidates can be promoted' }, { status: 409 })
    }
    if (promoteError.code === 'P0011') {
      return NextResponse.json({ error: 'An active Restaurant Profile Draft already exists for this candidate' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Creating the draft failed' }, { status: 500 })
  }

  const { data: factRows, error: factsError } = await supabase
    .from('restaurant_profile_draft_field_facts')
    .select('id, draft_id, field_name, value, origin, source_enrichment_id, recorded_by, recorded_at')
    .eq('draft_id', draftId)
  if (factsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ draft, fields: buildDraftFieldsByDraftId(factRows)[draftId] || {} }, { status: 201 })
}
