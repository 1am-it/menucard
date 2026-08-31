// PLATFORM-06 — approve a pending change. Editor-only. Delegates to the
// approve_pending_change() Postgres function (supabase/migrations/0002_pending_changes.sql)
// so the field_provenance write and the pending_changes status update
// happen in one transaction — not two separately-failable JS calls.
// Documented contract: docs/api/internal-moderation-api.md.

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
    return NextResponse.json({ error: 'Only editors can approve pending changes' }, { status: 403 })
  }

  const { id } = await params
  const pendingId = Number(id)
  if (!Number.isInteger(pendingId)) {
    return NextResponse.json({ error: 'Invalid pending change id' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.rpc('approve_pending_change', {
    p_pending_id: pendingId,
    p_actor_user_id: auth.userId,
  })

  if (error) {
    const notFound = error.code === 'P0002' || /not found or already decided/i.test(error.message || '')
    return NextResponse.json({ error: error.message || 'Approve failed' }, { status: notFound ? 404 : 500 })
  }

  return NextResponse.json({ record: data })
}
