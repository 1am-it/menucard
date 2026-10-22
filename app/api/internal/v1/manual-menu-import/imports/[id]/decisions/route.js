// #59 fase 2 — POST: één menselijke beslissing per regel. Geen bulkbesluit.
// Logic: src/lib/manualMenuImportHandlers.js.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await manualMenuImportHandlers.decide(request, id)
  return NextResponse.json(body, { status })
}
