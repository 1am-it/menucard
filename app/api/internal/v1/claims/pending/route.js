// PLATFORM-07 — owner claim review queue. Editor-only, same boundary as
// PLATFORM-06's moderation queue (not owner, not internal — internal
// represents automated/system writes, not a human trust decision, and has
// no more business here than an owner does). Documented contract:
// docs/api/owner-claims-api.md.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import restaurantsData from '@/data/restaurants.json'

const LIST_LIMIT = 50

function isEditor(roles) {
  return roles.some((r) => r.role === 'editor')
}

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isEditor(auth.roles)) {
    return NextResponse.json({ error: 'Only editors can view the claims queue' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()
  const { data: claims, error } = await supabase
    .from('restaurant_claims')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(LIST_LIMIT)
  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const restaurantIds = [...new Set(claims.map((c) => c.restaurant_id))]
  let existingOwners = []
  if (restaurantIds.length > 0) {
    const { data, error: ownerError } = await supabase
      .from('staff_roles')
      .select('restaurant_id')
      .eq('role', 'owner')
      .in('restaurant_id', restaurantIds)
    if (ownerError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    existingOwners = data
  }
  const restaurantsWithOwner = new Set(existingOwners.map((o) => o.restaurant_id))

  // Multiple claimants on the same restaurant are surfaced side by side on
  // purpose (see the migration's index comment) — the queue does not hide
  // or auto-resolve that, it's an explicit editor decision.
  const items = claims.map((c) => ({
    claim: c,
    restaurantName: restaurantsData[c.restaurant_id]?.name || null,
    restaurantWebsite: restaurantsData[c.restaurant_id]?.website || null,
    hasExistingOwner: restaurantsWithOwner.has(c.restaurant_id),
  }))

  return NextResponse.json({ items })
}
