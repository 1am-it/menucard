// BE-55 stap B (#135) — /api/v1/daghap/publiek.
//
//   GET ?restaurant_id=<id>   het aanbod dat een gast van dít restaurant nu mag
//                             zien: alleen `online`, alleen niet-verlopen, en
//                             alleen de velden voor de weergave.
//
// Geen sessie: dit is de publieke kant. Daarom ook geen account, status of
// filterreden in het antwoord, geen lijst over meerdere restaurants en geen
// lange cache: verlopen aanbod mag nooit uit een cache terugkomen. De logica
// staat in src/lib/daghapHandlers.js (met een nep-client getest).
//
// Zonder de migratie antwoordt de route met 503 en één nette melding; de
// restaurant- en menupagina tonen dan geen blok "Vandaag".

import { NextResponse } from 'next/server'
import { daghapHandlers } from '@/src/lib/daghapRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
}

export async function GET(request) {
  const { status, body } = await daghapHandlers.publiekAanbod(request)
  return NextResponse.json(body, { status, headers: NO_STORE })
}
