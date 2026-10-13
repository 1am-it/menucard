// BE-25 fase 2 — POST: "Opnieuw analyseren". One URL, after an explicit
// click, as a new one-URL batch through enqueue_source_reanalysis (0017):
// a fresh analysis instead of the 7-day reuse. `internal`-only; the same
// safeguards as starting a batch. Logic: src/lib/batchAnalysisHandlers.js.

import { NextResponse } from 'next/server'
import { batchAnalysisHandlers } from '@/src/lib/batchAnalysisRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const { status, body } = await batchAnalysisHandlers.reanalyze(request)
  return NextResponse.json(body, { status })
}
