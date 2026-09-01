// PLATFORM-07 — reject an owner claim. Editor-only. Never grants a role —
// a single UPDATE on restaurant_claims is already atomic on its own, so no
// RPC is needed (unlike approve). Not .single() — an update matching zero
// rows (already decided, or a bad id) must surface as a clean 404, not a
// hard query error (the lesson from PLATFORM-06's reject bug, applied
// here from the start). Documented contract: docs/api/owner-claims-api.md.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'

function isEditor(roles) {
  return roles.some((r) => r.role === 'editor')
}

export async function POST(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isEditor(auth.roles)) {
    return NextResponse.json({ error: 'Only editors can reject claims' }, { status: 403 })
  }

  const { id } = await params
  const claimId = Number(id)
  if (!Number.isInteger(claimId)) {
    return NextResponse.json({ error: 'Invalid claim id' }, { status: 400 })
  }

  let body = {}
  try {
    body = await request.json()
  } catch {
    // empty/absent body is fine - a rejection note is optional
  }
  const note = typeof body?.note === 'string' ? body.note.slice(0, 2000) : null

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('restaurant_claims')
    .update({
      status: 'rejected',
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
      decision_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', claimId)
    .eq('status', 'pending')
    .select()

  if (error) return NextResponse.json({ error: 'Reject failed' }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Claim not found or already decided' }, { status: 404 })
  }

  return NextResponse.json({ claim: data[0] })
}
