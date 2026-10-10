// BE-25 fase 2 — POST: "Bevestig bron" / "Bevestig {n} bronnen". Per
// high-certainty result one accepted BE-24 proposal (0015 RPCs), after the
// starter's inline confirmation. Publishes nothing and changes no
// restaurant data.

import { NextResponse } from 'next/server'
import { batchAnalysisHandlers } from '@/src/lib/batchAnalysisRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await batchAnalysisHandlers.confirmSources(request, id)
  return NextResponse.json(body, { status })
}
