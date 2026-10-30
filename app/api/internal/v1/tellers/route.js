// BE-45 (#114, criterium 1) — GET /api/internal/v1/tellers.
//
// `?periode=vandaag|7|30` (een ongeldige periode valt terug op 7). Alleen de rol
// `internal` (`authenticateInternalRequest`, zie
// src/lib/internalAuth.js); een `editor` of `owner` krijgt 403. Leest
// `dish_counters` met de bestaande server-admin-client en telt per `dish_key`
// op over de UTC-dagen van de periode. Gerechtnaam en restaurant komen uit de
// bestaande deeplinkresolutie, niet uit de database.
//
// Niets hier schrijft, en niets is cachebaar: de tellers veranderen de hele dag.
// De rekenregels staan in src/lib/dishCounterReport.js en de handler in
// src/lib/dishCounterReportHandlers.js (beide met `node --test` getest); deze
// route is alleen de bedrading en de no-store-header.

import { NextResponse } from 'next/server'
import { dishCounterReportHandlers } from '@/src/lib/dishCounterReportRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { status, body } = await dishCounterReportHandlers.getTellers(request)
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
