// BE-67 (#164, uitkomst 3) — /api/v1/daghap/<id>/uitverkocht: Op = op.
//
//   PATCH  `{ uitverkocht: true }`  zet het aanbod op "uitverkocht voor vandaag";
//          `{ uitverkocht: false }` is "Toch weer beschikbaar".
//
// Dezelfde autorisatie als PATCH/DELETE op /api/v1/daghap/<id>: eerst de sessie
// (401), dan het houderschap van het restaurant van dít aanbod (403) en het
// plaatsrecht (403). De stand is een datum in Europe/Amsterdam en vervalt dus
// vanzelf de volgende dag. De logica staat in src/lib/daghapHandlers.js
// (uitverkochtAanbod, met een nep-client getest).
//
// Zonder de migratie (0026) bestaat de kolom niet en antwoordt de route 503 met
// één nette melding; de knop breekt dan niet.

import { NextResponse } from 'next/server'
import { daghapHandlers } from '@/src/lib/daghapRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function PATCH(request, { params }) {
  const { id } = await params
  const { status, body } = await daghapHandlers.uitverkochtAanbod(request, { id })
  return NextResponse.json(body, { status, headers: NO_STORE })
}
