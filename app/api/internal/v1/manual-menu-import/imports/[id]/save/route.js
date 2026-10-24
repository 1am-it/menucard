// #59 fase 2 — POST: Concept opslaan als intern concept via de bestaande route.
// Alleen na alle menselijke stappen; niets publiceren of bevestigen.
// Logic: src/lib/manualMenuImportHandlers.js.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await manualMenuImportHandlers.save(request, id)
  return NextResponse.json(body, { status })
}
