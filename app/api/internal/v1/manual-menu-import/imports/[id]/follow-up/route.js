// #59 fase 2 — POST: Vraag AI voor één regel (of het antwoord erop). Het
// antwoord gaat door dezelfde validatie en vervangt alleen dat voorstel.
// Logic: src/lib/manualMenuImportHandlers.js.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await manualMenuImportHandlers.followUp(request, id)
  return NextResponse.json(body, { status })
}
