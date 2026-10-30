// BE-55 stap B, deel 4 (#135) — /api/internal/v1/daghap/plaatsrecht.
//
//   POST  `{ restaurant_id, user_id, actie: 'afnemen' | 'teruggeven' }`: een
//         houder mag geen aanbod meer plaatsen, of mag het weer. Beide acties
//         schrijven een geschiedenisregel (recht_afgenomen / recht_teruggegeven).
//
// Achter de bestaande interne auth (rol `internal`). De logica staat in
// src/lib/daghapBeheerHandlers.js.

import { NextResponse } from 'next/server'
import { daghapBeheerHandlers } from '@/src/lib/daghapBeheerRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function POST(request) {
  const { status, body } = await daghapBeheerHandlers.wijzigPlaatsrecht(request)
  return NextResponse.json(body, { status, headers: NO_STORE })
}
