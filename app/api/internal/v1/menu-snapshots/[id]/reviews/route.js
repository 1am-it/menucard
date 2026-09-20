// BE-17 — internal Onboarding Menu review route. `editor`-only for
// recording a decision; readable by `internal` or `editor`, mirroring
// the parent list route's own read access. GET returns the full,
// append-only review history for one snapshot (newest first) — never
// filtered down to "the current one," since there is no current-row
// concept here (see
// supabase/migrations/0011_be17_menu_snapshot_foundation.sql's own
// header comment for menu_snapshot_reviews). POST records exactly one
// new decision via a plain `.insert()` — never an update, never a
// delete; the database itself has no update/delete grant on this table
// at all, for any role (0012_be17_menu_snapshot_grant_correction.sql).
//
// Creating a proposal (POST /api/internal/v1/menu-snapshots, `internal`
// only) and recording a review decision (this route, `editor` only) are
// two separate routes, two separate role checks, two separate database
// writes — even when the same account holds both roles in phase 1,
// nothing here ever combines the two into one action.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { validateSnapshotReviewInput, snapshotReviewValidationMessage } from '@/src/lib/menuSnapshotProposals'

// Same one-line definition as
// app/api/internal/v1/moderation/pending/route.js and
// app/api/internal/v1/claims/pending/route.js — kept deliberately in
// sync, not a subtly different copy.
function isEditor(roles) {
  return Array.isArray(roles) && roles.some((r) => r && r.role === 'editor')
}

export async function GET(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles) && !isEditor(auth.roles)) {
    return NextResponse.json({ error: 'Only internal or editor staff can view snapshot reviews' }, { status: 403 })
  }

  const { id } = await params

  const supabase = getSupabaseAdmin()
  const { data: reviews, error } = await supabase
    .from('menu_snapshot_reviews')
    .select('id, snapshot_id, reviewer_id, decided_at, decision, reason, note')
    .eq('snapshot_id', id)
    .order('decided_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ reviews })
}

export async function POST(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isEditor(auth.roles)) {
    return NextResponse.json({ error: 'Only editor staff can record a snapshot review decision' }, { status: 403 })
  }

  const { id } = await params

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validateSnapshotReviewInput({
    decision: body && body.decision,
    reason: body && body.reason,
    note: body && body.note,
  })
  if (!validation.valid) {
    return NextResponse.json({ error: snapshotReviewValidationMessage(validation.reason) }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('menu_snapshot_reviews')
    .insert({
      snapshot_id: id,
      reviewer_id: auth.userId,
      decision: validation.decision,
      reason: validation.reason,
      note: validation.note,
    })
    .select('id, snapshot_id, reviewer_id, decided_at, decision, reason, note')
    .single()

  if (error) {
    const notFound = error.code === '23503'
    return NextResponse.json(
      { error: notFound ? 'Snapshot not found' : 'Recording the review failed' },
      { status: notFound ? 404 : 500 }
    )
  }

  return NextResponse.json({ review: data }, { status: 201 })
}
