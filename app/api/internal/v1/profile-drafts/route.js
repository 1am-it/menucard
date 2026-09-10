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

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { findPossibleDuplicateDraftId, buildDraftFieldsByDraftId } from '@/src/lib/restaurantProfileDrafts'
import { generateUuidV7 } from '@/src/lib/uuidv7'

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
