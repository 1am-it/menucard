// MARKET-05A — internal candidate review audit log. `internal`-only,
// same guard as every other Data-inbox route. GET lists the full,
// append-only review history for one candidate (newest first) — never
// filtered down to "the current one," since there is no current-row
// concept here (see supabase/migrations/0007_market05a_candidate_reviews.sql's
// own header comment). POST records exactly one new decision via the
// record_import_candidate_review() RPC — never an update, never a
// delete; the database itself has no update/delete grant on this table
// at all, for any role. Documented contract: docs/api/import-inbox-api.md.
//
// `approved_internal` means ready for internal enrichment only — this
// route, like every other file in this feature, never writes to a
// canonical or public table; no such table exists yet for this data in
// this project.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly, validateReviewDecisionInput, reviewValidationMessage } from '@/src/lib/importInbox'

export async function GET(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can view candidate reviews' }, { status: 403 })
  }

  const { id } = await params

  const supabase = getSupabaseAdmin()
  const { data: reviews, error } = await supabase
    .from('import_candidate_reviews')
    .select('id, candidate_id, reviewer_id, decided_at, status, rejection_reason, deferred_reason, note')
    .eq('candidate_id', id)
    .order('decided_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ reviews })
}

export async function POST(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can record candidate reviews' }, { status: 403 })
  }

  const { id } = await params

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validateReviewDecisionInput({
    status: body && body.status,
    rejectionReason: body && body.rejection_reason,
    note: body && body.note,
    deferredReason: body && body.deferred_reason,
  })
  if (!validation.valid) {
    return NextResponse.json({ error: reviewValidationMessage(validation.reason) }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  // The RPC does exactly one insert — see
  // supabase/migrations/0009_market05a_candidate_reviews_deferred_reason.sql
  // (extends supabase/migrations/0007_market05a_candidate_reviews.sql's
  // original version). This file never calls a mutating method other
  // than this one RPC.
  const { data, error } = await supabase.rpc('record_import_candidate_review', {
    p_candidate_id: id,
    p_actor_user_id: auth.userId,
    p_status: validation.status,
    p_rejection_reason: validation.rejectionReason,
    p_note: validation.note,
    p_deferred_reason: validation.deferredReason,
  })

  if (error) {
    const notFound = error.code === 'P0002' || /candidate not found/i.test(error.message || '')
    return NextResponse.json({ error: notFound ? 'Candidate not found' : 'Recording the review failed' }, { status: notFound ? 404 : 500 })
  }

  return NextResponse.json({ review: data }, { status: 201 })
}
