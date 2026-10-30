// BE-55 stap B, deel 4 (#135) — /api/internal/v1/daghap/<id>/goedkeuren.
//
//   POST  het tegengehouden aanbod gaat weer online; de geschiedenis krijgt een
//         regel `goedgekeurd`. Verlopen aanbod komt niet terug (409).
//
// Achter de bestaande interne auth (rol `internal`). De logica staat in
// src/lib/daghapBeheerHandlers.js.

import { NextResponse } from 'next/server'
import { daghapBeheerHandlers } from '@/src/lib/daghapBeheerRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await daghapBeheerHandlers.keurGoed(request, { id })
  return NextResponse.json(body, { status, headers: NO_STORE })
}
