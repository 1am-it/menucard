// BE-55 stap A (#135) — /api/v1/daghap/<id>.
//
//   PATCH   wijzigen; een offline aanbod blijft offline, een verlopen aanbod
//           kan niet meer gewijzigd worden (409);
//   DELETE  offline halen; een tweede keer is geen fout.
//
// Beide routes controleren eerst de sessie (401), dan het houderschap van het
// restaurant van dít aanbod (403), daarna de regels en limieten uit het
// contract. Een onbekend aanbod is een 404.
//
// Zonder de migratie antwoordt de route met 503 en één nette melding. De
// logica staat in src/lib/daghapHandlers.js; de echte afhankelijkheden in
// src/lib/daghapRouteDeps.js.

import { NextResponse } from 'next/server'
import { daghapHandlers } from '@/src/lib/daghapRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function PATCH(request, { params }) {
  const { id } = await params
  const { status, body } = await daghapHandlers.wijzigAanbod(request, { id })
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function DELETE(request, { params }) {
  const { id } = await params
  const { status, body } = await daghapHandlers.offlineAanbod(request, { id })
  return NextResponse.json(body, { status, headers: NO_STORE })
}
