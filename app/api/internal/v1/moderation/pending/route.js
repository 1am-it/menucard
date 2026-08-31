// PLATFORM-06 — moderation queue listing. Editor-only (not owner, not
// internal-as-viewer — see planning/specs/tickets/platform-06-moderation-review-queue.md).
// Pairs each pending row with its current field_provenance counterpart, if
// any, so the UI can show old vs. new side by side. Read-only; never
// writes. Documented contract: docs/api/internal-moderation-api.md.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'

const LIST_LIMIT = 50

function isEditor(roles) {
  return roles.some((r) => r.role === 'editor')
}

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isEditor(auth.roles)) {
    return NextResponse.json({ error: 'Only editors can view the moderation queue' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const restaurantId = searchParams.get('restaurantId')

  const supabase = getSupabaseAdmin()
  let pendingQuery = supabase
    .from('pending_changes')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(LIST_LIMIT)
  if (restaurantId) pendingQuery = pendingQuery.eq('restaurant_id', restaurantId)

  const { data: pending, error: pendingError } = await pendingQuery
  if (pendingError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const restaurantIds = [...new Set(pending.map((p) => p.restaurant_id))]
  let current = []
  if (restaurantIds.length > 0) {
    const { data, error } = await supabase.from('field_provenance').select('*').in('restaurant_id', restaurantIds)
    if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    current = data
  }

  const items = pending.map((p) => ({
    pending: p,
    current:
      current.find(
        (c) => c.restaurant_id === p.restaurant_id && c.field_name === p.field_name && c.field_ref === p.field_ref
      ) || null,
  }))

  return NextResponse.json({ items })
}
