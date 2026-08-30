// PLATFORM-05 — internal-only provenance API. Not reachable by the public:
// every request requires a valid Supabase Auth session resolving to a
// staff_roles row (src/lib/internalAuth.js). No consumer-facing route reads
// from this endpoint or from Supabase at all — see
// planning/decisions/010-platform-persistence-and-api.md. Documented
// request/response contract: docs/api/internal-provenance-api.md.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest, getAccessForRestaurant } from '@/src/lib/internalAuth'

const VALID_FIELD_NAMES = ['price', 'openingHours', 'reservationMethod', 'itemAvailability', 'allergens']

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const restaurantId = searchParams.get('restaurantId')
  if (!restaurantId) {
    return NextResponse.json({ error: 'restaurantId query parameter is required' }, { status: 400 })
  }

  const access = getAccessForRestaurant(auth.roles, restaurantId)
  if (!access.allowed) {
    return NextResponse.json({ error: 'Not authorized for this restaurant' }, { status: 403 })
  }

  const fieldName = searchParams.get('fieldName')
  if (fieldName && !VALID_FIELD_NAMES.includes(fieldName)) {
    return NextResponse.json({ error: `fieldName must be one of: ${VALID_FIELD_NAMES.join(', ')}` }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  let query = supabase.from('field_provenance').select('*').eq('restaurant_id', restaurantId)
  if (fieldName) query = query.eq('field_name', fieldName)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ records: data })
}

export async function POST(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const restaurantId = body?.restaurantId
  const fieldName = body?.fieldName
  const fieldRef = body?.fieldRef ?? ''
  const value = body?.value

  if (!restaurantId || !fieldName || value === undefined) {
    return NextResponse.json({ error: 'restaurantId, fieldName, and value are required' }, { status: 400 })
  }
  if (!VALID_FIELD_NAMES.includes(fieldName)) {
    return NextResponse.json({ error: `fieldName must be one of: ${VALID_FIELD_NAMES.join(', ')}` }, { status: 400 })
  }

  const access = getAccessForRestaurant(auth.roles, restaurantId)
  if (!access.allowed) {
    return NextResponse.json({ error: 'Not authorized for this restaurant' }, { status: 403 })
  }

  // source/confidence/verifiedAt/verifiedBy are derived entirely
  // server-side from the authenticated caller's resolved role — never
  // accepted from the request body. See src/lib/internalAuth.js and
  // docs/api/data-trust-model.md's status-label mapping. 'imported'
  // (the internal/system role) is never actively confirmed, so it carries
  // no verifiedAt/verifiedBy, matching that mapping exactly.
  const { source, confidence } = access
  const verifiedAt = source === 'imported' ? null : new Date().toISOString()
  const verifiedBy = source === 'imported' ? null : auth.userId

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('field_provenance')
    .upsert(
      {
        restaurant_id: restaurantId,
        field_name: fieldName,
        field_ref: fieldRef,
        value,
        source,
        confidence,
        verified_at: verifiedAt,
        verified_by: verifiedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'restaurant_id,field_name,field_ref' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Write failed' }, { status: 500 })

  return NextResponse.json({ record: data }, { status: 201 })
}
