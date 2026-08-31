// PLATFORM-06 — reject a pending change. Editor-only. Never touches
// field_provenance — a single UPDATE on pending_changes is already atomic
// on its own, so no RPC is needed here (unlike approve, which spans two
// tables). Documented contract: docs/api/internal-moderation-api.md.

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
    return NextResponse.json({ error: 'Only editors can reject pending changes' }, { status: 403 })
  }

  const { id } = await params
  const pendingId = Number(id)
  if (!Number.isInteger(pendingId)) {
    return NextResponse.json({ error: 'Invalid pending change id' }, { status: 400 })
  }

  let body = {}
  try {
    body = await request.json()
  } catch {
    // empty/absent body is fine - a rejection note is optional
  }
  const note = typeof body?.note === 'string' ? body.note.slice(0, 2000) : null

  const supabase = getSupabaseAdmin()
  // Not .single() - an update matching zero rows (already decided, or a
  // bad id) must not surface as a hard query error, only as "nothing
  // changed", which is what the empty-array check below distinguishes.
  const { data, error } = await supabase
    .from('pending_changes')
    .update({
      status: 'rejected',
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
      decision_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingId)
    .eq('status', 'pending')
    .select()

  if (error) return NextResponse.json({ error: 'Reject failed' }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Pending change not found or already decided' }, { status: 404 })
  }

  return NextResponse.json({ record: data[0] })
}
