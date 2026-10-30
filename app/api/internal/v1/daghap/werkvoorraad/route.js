// BE-55 stap B, deel 4 (#135) — /api/internal/v1/daghap/werkvoorraad.
//
//   GET   de tegengehouden (in_controle) en gemelde aanbiedingen, met per rij
//         het aantal meldingen en de houder, plus de houders die nu geen
//         plaatsrecht meer hebben.
//
// Achter de bestaande interne auth (rol `internal`, TOTP-niveau als de andere
// /internal-pagina's). Niets cachebaar: dit is een interne werklijst.
// De logica staat in src/lib/daghapBeheerHandlers.js (met een nep-client
// getest); zonder de migratie antwoordt de route met 503 en één nette melding.

import { NextResponse } from 'next/server'
import { daghapBeheerHandlers } from '@/src/lib/daghapBeheerRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function GET(request) {
  const { status, body } = await daghapBeheerHandlers.getWerkvoorraad(request)
  return NextResponse.json(body, { status, headers: NO_STORE })
}
