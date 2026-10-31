// BE-55 stap B, deel 4 (#135) — /api/internal/v1/daghap/<id>/verwijderen.
//
//   POST  het aanbod gaat offline en komt niet terug; het blijft staan voor de
//         geschiedenis en krijgt de regel `verwijderd`.
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
  const { status, body } = await daghapBeheerHandlers.verwijderAanbod(request, { id })
  return NextResponse.json(body, { status, headers: NO_STORE })
}
