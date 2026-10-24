// #59 fase 2 — POST: stap 2 van de handmatige AI-import. Het geplakte antwoord
// is onbetrouwbare data: groottegrens, codeblokextractie, dezelfde validator en
// de bundelbinding. Logic: src/lib/manualMenuImportHandlers.js.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const { status, body } = await manualMenuImportHandlers.importAnswer(request)
  return NextResponse.json(body, { status })
}
