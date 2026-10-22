// #59 fase 2 — POST: één prompt voor alle open punten (max. 10 regels). Het is
// geen bulkbesluit: elk antwoord wordt apart gecontroleerd.
// Logic: src/lib/manualMenuImportHandlers.js.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await manualMenuImportHandlers.openPointsPrompt(request, id)
  return NextResponse.json(body, { status })
}
