// BE-55 stap B (#135) — /api/v1/daghap/<id>/meld.
//
//   POST   een gast meldt dit aanbod, zonder account. De body is
//          `{ apparaat }`: een willekeurig kenmerk uit de browser van de gast
//          (localStorage), nooit het IP-adres. Per apparaat telt de melding één
//          keer en na drie meldingen gaat het aanbod op `in_controle`.
//
// Niets van de gast wordt opgeslagen: alleen het aanbod en het apparaatkenmerk.
// De logica staat in src/lib/daghapHandlers.js (met een nep-client getest).
// Zonder de migratie antwoordt de route met 503 en één nette melding.

import { NextResponse } from 'next/server'
import { daghapHandlers } from '@/src/lib/daghapRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await daghapHandlers.meldAanbod(request, { id })
  return NextResponse.json(body, { status, headers: NO_STORE })
}
