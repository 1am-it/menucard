// BE-46 (#106, criterium 2) — GET /api/v1/kies/<code>: de gerechten van de
// stemming (naam, prijs, restaurant, beschrijving uit de statische data), de
// sluitingstijd en de uitslag, met de roepnamen erbij.
//
// Een onbekende code is een 404. Zonder de migratie (tabellen ontbreken)
// antwoordt de route met 503 en één nette melding.
//
// Niets wordt gecachet: elke stem verandert de uitslag.

import { NextResponse } from 'next/server'
import { kiesHandlers } from '@/src/lib/kiesRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function GET(request, { params }) {
  const { code } = await params
  const { status, body } = await kiesHandlers.readStemmingRequest(request, { code })
  return NextResponse.json(body, { status, headers: NO_STORE })
}
