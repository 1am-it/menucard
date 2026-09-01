// PLATFORM-07 — a claimant checking their own claim status. Filtered
// server-side by the verified session's user id — never by a
// client-supplied id. Documented contract: docs/api/owner-claims-api.md.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateAnyUser } from '@/src/lib/claimAuth'

export async function GET(request) {
  const auth = await authenticateAnyUser(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const restaurantId = searchParams.get('restaurantId')

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('restaurant_claims')
    .select('*')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
  if (restaurantId) query = query.eq('restaurant_id', restaurantId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ claims: data })
}
