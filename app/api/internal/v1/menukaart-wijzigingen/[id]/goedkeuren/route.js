// BE-58 deel 1 (#143) — POST /api/internal/v1/menukaart-wijzigingen/<id>/goedkeuren.
//
// Een interne beoordelaar (rol `internal`) keurt een open wijziging goed. Een
// goedgekeurde wijziging telt ook als bevestiging van de kaart. De regels en de
// geschiedenis staan in src/lib/snelAanpassenHandlers.js.

import { NextResponse } from 'next/server'
import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await snelAanpassenHandlers.keurGoed(request, { id })
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}
