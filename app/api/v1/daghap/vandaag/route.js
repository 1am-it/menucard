// BE-55 stap B, deel 4 (#135) — /api/v1/daghap/vandaag.
//
//   GET   "Daghappen vandaag" voor de home: maximaal drie aanbiedingen in
//         willekeurige volgorde, alleen de weergavevelden en het restaurant
//         voor de link. Geen volledige lijst naar de browser, geen sessie.
//
// Niets cachebaar: verlopen aanbod mag nooit uit een cache terugkomen. De
// logica staat in src/lib/daghapHandlers.js (met een nep-client getest);
// zonder de migratie antwoordt de route met 503.

import { NextResponse } from 'next/server'
import { daghapHandlers } from '@/src/lib/daghapRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
}

export async function GET(request) {
  const { status, body } = await daghapHandlers.publiekVandaag(request)
  return NextResponse.json(body, { status, headers: NO_STORE })
}
