// #59 fase 2 — GET: de bestaande statische restaurantlijst, zodat de
// medewerker op naam kiest in plaats van een nummer te typen (Lead-review
// 6350337273, K3). Alleen interne rollen; het antwoord bevat niet meer dan id,
// naam en buurt. Logic: src/lib/manualMenuImportHandlers.js.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { status, body } = await manualMenuImportHandlers.listRestaurants(request)
  return NextResponse.json(body, { status })
}
