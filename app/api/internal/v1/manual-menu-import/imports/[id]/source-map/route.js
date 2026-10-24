// #59 / variant 5 (Lead order 6382953597) — POST: één pagina van één bron met
// de markeringen. Alleen lezen: de capture komt uit het verzegelde
// toestandstoken van de vorige stap, één pagina per verzoek (lazy).
// Logic: src/lib/manualMenuImportHandlers.js.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await manualMenuImportHandlers.sourceCard(request, id)
  return NextResponse.json(body, { status })
}
