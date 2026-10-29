// BE-44 (#105, criterium 5) — POST /api/v1/tellers: één anonieme telling.
//
// Body: `{ dish, event }` met `event` uit `gedeeld`, `bewaard` of
// `reserveren`. Meer accepteert deze route niet: geen id, geen cookie, geen
// tijdstip en geen gebruikersgegeven.
//
// Het antwoord is altijd 204 zonder inhoud — een geslaagde telling, een
// onbekend gerecht, een onbekende gebeurtenis, een tweede klik binnen de
// seconde, een ontbrekende sleutel, een netwerkfout en een nog niet toegepaste
// migratie zien er voor de browser hetzelfde uit. De knop wacht niet op dit
// antwoord (fire-and-forget) en breekt er dus nooit op.
//
// De controle, de limiet en het veilig falen staan in
// src/lib/dishCounterHandlers.js (met een nep-client getest); de echte
// afhankelijkheden in src/lib/dishCounterRouteDeps.js. Niets leest de tellers
// terug: er is bewust geen GET.

import { NextResponse } from 'next/server'
import { dishCounterHandlers } from '@/src/lib/dishCounterRouteDeps'

export async function POST(request) {
  const { status } = await dishCounterHandlers.countDishEvent(request)
  return new NextResponse(null, {
    status,
    headers: {
      // Een teller is nooit cachebaar en nooit een pagina.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
