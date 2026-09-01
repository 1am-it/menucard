// PLATFORM-07 — approve an owner claim. Editor-only. Delegates to the
// approve_restaurant_claim() Postgres function
// (supabase/migrations/0003_restaurant_claims.sql) so granting the owner
// role and flipping the claim's status happen in one transaction — not
// two separately-failable JS calls. Documented contract:
// docs/api/owner-claims-api.md.

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
    return NextResponse.json({ error: 'Only editors can approve claims' }, { status: 403 })
  }

  const { id } = await params
  const claimId = Number(id)
  if (!Number.isInteger(claimId)) {
    return NextResponse.json({ error: 'Invalid claim id' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.rpc('approve_restaurant_claim', {
    p_claim_id: claimId,
    p_actor_user_id: auth.userId,
  })

  if (error) {
    const notFound = error.code === 'P0002' || /not found or already decided/i.test(error.message || '')
    return NextResponse.json({ error: error.message || 'Approve failed' }, { status: notFound ? 404 : 500 })
  }

  return NextResponse.json({ claim: data })
}
