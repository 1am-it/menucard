// PLATFORM-07 — public claim submission. Deliberately NOT under
// /api/internal/v1/ — reachable by any authenticated user, no staff_roles
// row required. The editor-only review side lives at
// /api/internal/v1/claims/... instead. Documented contract:
// docs/api/owner-claims-api.md.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateAnyUser } from '@/src/lib/claimAuth'
import { computeDomainMatch } from '@/src/utils/domainMatch'
import restaurantsData from '@/data/restaurants.json'

export async function POST(request) {
  const auth = await authenticateAnyUser(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const restaurantId = body?.restaurantId
  if (!restaurantId || typeof restaurantId !== 'string') {
    return NextResponse.json({ error: 'restaurantId is required' }, { status: 400 })
  }

  // Server-side validation against the real dataset — never trust that a
  // client-supplied id refers to an actual restaurant.
  const restaurant = restaurantsData[restaurantId]
  if (!restaurant) {
    return NextResponse.json({ error: 'Unknown restaurant' }, { status: 404 })
  }

  const supabase = getSupabaseAdmin()

  // Already the verified owner of this restaurant — no point filing
  // another claim.
  const existingRole = await supabase
    .from('staff_roles')
    .select('id')
    .eq('user_id', auth.userId)
    .eq('role', 'owner')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (existingRole.error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  if (existingRole.data) {
    return NextResponse.json(
      { error: 'You are already the verified owner of this restaurant', alreadyOwner: true },
      { status: 409 }
    )
  }

  // A repeat submission while a claim is already pending is not an error —
  // hand back the existing claim so the UI can show its status gracefully
  // instead of a broken/duplicate-looking failure.
  const existingPending = await supabase
    .from('restaurant_claims')
    .select('*')
    .eq('user_id', auth.userId)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
    .maybeSingle()
  if (existingPending.error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  if (existingPending.data) {
    return NextResponse.json({ claim: existingPending.data, alreadyExists: true })
  }

  const domainMatch = computeDomainMatch(auth.email, restaurant.website)

  const { data, error } = await supabase
    .from('restaurant_claims')
    .insert({
      restaurant_id: restaurantId,
      user_id: auth.userId,
      claim_email: auth.email,
      domain_match: domainMatch,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to submit claim' }, { status: 500 })

  return NextResponse.json({ claim: data }, { status: 201 })
}
