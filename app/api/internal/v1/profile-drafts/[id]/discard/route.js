// MARKET-05C — Restaurant Profile Drafts: discard. `internal`-only, same
// guard as every other Data-inbox/profile-drafts route. The *only* way to
// discard a draft — always via the discard_profile_draft() RPC
// (supabase/migrations/0010_market05c_restaurant_profile_drafts.sql) —
// never an update this route issues itself. Valid only against an
// *active* (`status = 'draft'`) draft; a discarded draft is never
// deleted, overwritten, or mutated further, and none of its field facts
// are ever touched — the RPC's own UPDATE only ever targets the header
// row's discard-related columns.
//
// A short internal discard reason is mandatory (added 2026-09-06, later
// still — discard/duplicate follow-up round): validated here first
// (src/lib/restaurantProfileDrafts.js's validateDiscardRequestInput), for
// a clear `400` before ever reaching the RPC — the migration's own check
// constraint and the RPC's own explicit guard remain the authoritative
// enforcement regardless.
//
// Discarding never automatically starts a restart. A later re-promotion
// of the same candidate is always a brand-new, explicit
// POST /api/internal/v1/profile-drafts call, producing a new draft id —
// this route has no opinion on that and does not trigger it.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { validateDiscardRequestInput, discardValidationMessage } from '@/src/lib/restaurantProfileDrafts'

export async function POST(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can discard Restaurant Profile Drafts' }, { status: 403 })
  }

  const { id } = await params

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validateDiscardRequestInput({ note: body && body.note })
  if (!validation.valid) {
    return NextResponse.json({ error: discardValidationMessage(validation.reason) }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  // The RPC does exactly one row change, scoped to status = 'draft' —
  // never a second attempt, never a removal. This route issues no
  // mutating Supabase call of its own — only this one RPC.
  const { data, error } = await supabase.rpc('discard_profile_draft', {
    p_draft_id: id,
    p_actor_user_id: auth.userId,
    p_note: validation.note,
  })

  if (error) {
    if (error.code === 'P0013') {
      return NextResponse.json({ error: 'Draft not found or already discarded' }, { status: 409 })
    }
    if (error.code === 'P0014') {
      return NextResponse.json({ error: discardValidationMessage('missing-note') }, { status: 400 })
    }
    return NextResponse.json({ error: 'Discarding the draft failed' }, { status: 500 })
  }

  return NextResponse.json({ draft: data })
}
