// BE-58 deel 1 (#143) — GET /api/v1/menukaart/overlay?restaurant=<id>.
//
// Alleen de goedgekeurde wijzigingen van dat ene restaurant plus het
// bevestigingslabel. Publiek, dus alleen weergavevelden (geen account, geen
// status, geen beoordelaar) en kort cachebaar: de pagina's lezen dit per
// restaurant, nooit de hele tabel. De statische menudata blijft ongewijzigd.

import { NextResponse } from 'next/server'
import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { status, body } = await snelAanpassenHandlers.publiekeOverlay(request)
  return NextResponse.json(body, {
    status,
    headers: status === 200
      ? { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' }
      : { 'Cache-Control': 'no-store' },
  })
}
