// BE-46 (#106, criterium 2) — POST /api/v1/kies: maakt een stemming van een
// lijstje en geeft de niet te raden code terug.
//
// Body: `{ dish_keys: [...], sluit_om }` met 1 tot 12 bestaande gerecht-id's
// (dezelfde id's als de deeplink, het anker en het lijstje) en een optionele
// sluitingstijd. Elke sleutel wordt via de bestaande deeplinkresolutie
// gecontroleerd; een onbekende sleutel is een 400, geen stille korting.
//
// Niets van de browser wordt opgeslagen: geen IP-adres, geen user agent, geen
// account. De logica staat in src/lib/kiesHandlers.js (met een nep-client
// getest); de echte afhankelijkheden in src/lib/kiesRouteDeps.js.
//
// Zonder de migratie (tabellen ontbreken) antwoordt de route met 503 en één
// nette melding; de UI toont "Samen kiezen is nog niet beschikbaar".

import { NextResponse } from 'next/server'
import { kiesHandlers } from '@/src/lib/kiesRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  // Een stemming is nooit cachebaar: de uitslag verandert bij elke stem.
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function POST(request) {
  const { status, body } = await kiesHandlers.createStemming(request)
  return NextResponse.json(body, { status, headers: NO_STORE })
}
