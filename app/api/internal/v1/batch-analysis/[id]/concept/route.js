// BE-25 — Menukaartcontrole → concept. POST: save the internal menu concept
// of a confirmed source as a BE-17 menu snapshot proposal (needs review,
// never public). Starter-only, refused while blockers remain; nothing is
// published or fetched. Logic: src/lib/batchAnalysisHandlers.js.

import { NextResponse } from 'next/server'
import { batchAnalysisHandlers } from '@/src/lib/batchAnalysisRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await batchAnalysisHandlers.saveConcept(request, id)
  return NextResponse.json(body, { status })
}
