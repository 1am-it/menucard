// BE-57 (#139, deel 1) — POST /api/v1/bekeken: één anonieme telling "bekeken".
//
// Body: `{ restaurant }`. Meer accepteert deze route niet: geen id, geen
// cookie, geen tijdstip, geen pad en geen gebruikersgegeven.
//
// Het antwoord is altijd 204 zonder inhoud — een geslaagde telling, een
// onbekend restaurant, een tweede bezoek binnen de seconde, een ontbrekende
// sleutel, een netwerkfout en een nog niet toegepaste migratie zien er voor de
// browser hetzelfde uit. De pagina wacht niet op dit antwoord.
//
// De controle, de limiet en het veilig falen staan in
// src/lib/restaurantViewHandlers.js (met een nep-client getest); de echte
// afhankelijkheden in src/lib/restaurantViewRouteDeps.js. Niets leest de
// tellers terug: de houderstatistieken hebben hun eigen route.

import { NextResponse } from 'next/server'
import { restaurantViewHandlers } from '@/src/lib/restaurantViewRouteDeps'

export async function POST(request) {
  const { status } = await restaurantViewHandlers.countRestaurantView(request)
  return new NextResponse(null, {
    status,
    headers: {
      // Een teller is nooit cachebaar en nooit een pagina.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
