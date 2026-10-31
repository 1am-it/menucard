// BE-58 deel 1 (#143) — POST en GET /api/v1/menukaart/wijzigingen.
//
// POST: een houder dient een prijs- of beschikbaarheidswijziging in; die staat
// op `in_controle` tot de interne controle beslist. GET: zijn eigen lijst met
// het resterende dagmaximum. Alle regels (eigenaarschap, plaatsrecht, grenzen,
// 30 per dag, geschiedenis) staan in src/lib/snelAanpassenHandlers.js; deze
// route is alleen de bedrading en de no-store-header.

import { NextResponse } from 'next/server'
import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'

export const dynamic = 'force-dynamic'

function antwoord({ status, body }) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}

export async function GET(request) {
  return antwoord(await snelAanpassenHandlers.eigenWijzigingen(request))
}

export async function POST(request) {
  return antwoord(await snelAanpassenHandlers.diendeWijzigingIn(request))
}
