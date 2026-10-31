// BE-55 stap A (#135) — /api/v1/daghap.
//
//   GET  ?restaurant_id=<id>   wat er van dat restaurant online staat (alleen
//                              voor de houder van dat restaurant);
//   POST                       een daghap of seizoensgerecht plaatsen.
//
// Body van de POST: `{ restaurant_id, soort, naam, prijs, beschrijving,
// labels, sluitingstijd | einddatum }`. De server controleert alles zelf: de
// sessie (401), het houderschap via de goedgekeurde claim (403), de regels uit
// het contract (400), de limieten (409/429) en het filter, dat een treffer op
// `in_controle` zet in plaats van online.
//
// Niets hiervan is cachebaar en niets is indexeerbaar: dit is de beheerroute
// van één restaurant, geen publieke pagina. De logica staat in
// src/lib/daghapHandlers.js (met een nep-client getest); de echte
// afhankelijkheden in src/lib/daghapRouteDeps.js.
//
// Zonder de migratie (tabellen ontbreken) antwoordt de route met 503 en één
// nette melding; de schermen blijven dus werken zonder 0023.

import { NextResponse } from 'next/server'
import { daghapHandlers } from '@/src/lib/daghapRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function GET(request) {
  const { status, body } = await daghapHandlers.lijstAanbod(request)
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function POST(request) {
  const { status, body } = await daghapHandlers.plaatsAanbod(request)
  return NextResponse.json(body, { status, headers: NO_STORE })
}
