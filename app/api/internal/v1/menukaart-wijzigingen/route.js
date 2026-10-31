// BE-58 deel 1 (#143) — GET /api/internal/v1/menukaart-wijzigingen.
//
// De interne controlelijst "Wijzigingen van houders", naast de werkvoorraad van
// BE-55. `?status=in_controle|goedgekeurd|afgewezen` (standaard: de open
// wijzigingen). Alleen `authenticateInternalRequest` met de rol `internal`;
// een `owner` of `editor` krijgt 403. De regels staan in
// src/lib/snelAanpassenHandlers.js.

import { NextResponse } from 'next/server'
import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { status, body } = await snelAanpassenHandlers.interneLijst(request)
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}
