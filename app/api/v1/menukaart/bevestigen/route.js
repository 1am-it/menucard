// BE-58 deel 1 (#143) — POST /api/v1/menukaart/bevestigen.
//
// De houder bevestigt dat zijn kaart klopt. Het label geldt 90 dagen; de
// beslissing en de geschiedenis staan in src/lib/snelAanpassenHandlers.js.

import { NextResponse } from 'next/server'
import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const { status, body } = await snelAanpassenHandlers.bevestigMenukaart(request)
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}
