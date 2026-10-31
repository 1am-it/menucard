// BE-57 (#139, deel 1) — GET /api/mijn-restaurant/<id>/cijfers.
//
// Een dunne wikkel: de volgorde (401, 404, 403, dan pas lezen), de
// privacydrempel en de stand "nog geen cijfers" staan in de geteste module
// src/lib/ownerStatsHandlers.js. Deze route kent geen eigen regel en neemt geen
// gebruikers-id uit het verzoek aan. De admin-client blijft server-only.
//
// Cache-Control no-store: dit zijn cijfers van één houder en één moment.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { createOwnerStatsHandlers } from '@/src/lib/ownerStatsHandlers'
import restaurantsData from '@/data/restaurants.json'

export const dynamic = 'force-dynamic'

const handlers = createOwnerStatsHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
})

export async function GET(request, context) {
  const { id } = await (context && context.params ? context.params : {})
  const outcome = await handlers.getOwnerStats(request, id)
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
