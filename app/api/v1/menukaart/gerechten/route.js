// BE-58 deel 2 (#143) — GET /api/v1/menukaart/gerechten?menuId=<id>.
//
// De houderpagina toont per gerecht de huidige prijs en de schakelaar
// "Tijdelijk niet beschikbaar". De statische kaart blijft de bron; deze route
// geeft alleen de gerechten van precies die ene kaart en de laatste bevestiging,
// en alleen aan de houder van dat restaurant (staff_roles owner + plaatsrecht).

import { NextResponse } from 'next/server'
import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { status, body } = await snelAanpassenHandlers.menuGerechten(request)
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}
