// #59 fase 2 — POST: stap 1 van de handmatige AI-import. Leest de bronnen via
// de bestaande veilige route, legt de bundel vast en geeft de prompt één keer
// terug. De prompt wordt niet gelogd en niet in de browser opgeslagen.
// Logic: src/lib/manualMenuImportHandlers.js.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const { status, body } = await manualMenuImportHandlers.createBundle(request)
  return NextResponse.json(body, { status })
}
