// BE-58 deel 1 (#143) — POST /api/internal/v1/menukaart-wijzigingen/<id>/afwijzen.
//
// Een interne beoordelaar (rol `internal`) wijst een open wijziging af, met een
// verplichte reden. Beide komen in de geschiedenis. De regels staan in
// src/lib/snelAanpassenHandlers.js.

import { NextResponse } from 'next/server'
import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await snelAanpassenHandlers.wijsAf(request, { id })
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}
