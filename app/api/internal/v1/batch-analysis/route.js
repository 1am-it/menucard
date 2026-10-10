// BE-25 fase 2 — Batchanalyse. GET: the viewer's daily usage, recent
// batches and one batch in detail (?batch=<id>, else the viewer's own open
// batch). POST: "Analyse starten" — one batch of at most 10 URLs through
// enqueue_source_analysis_batch (0016). `internal`-only; logic in
// src/lib/batchAnalysisHandlers.js. Nothing here fetches or publishes.

import { NextResponse } from 'next/server'
import { batchAnalysisHandlers } from '@/src/lib/batchAnalysisRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const batchId = new URL(request.url).searchParams.get('batch')
  const { status, body } = await batchAnalysisHandlers.getOverview(request, batchId)
  return NextResponse.json(body, { status })
}

export async function POST(request) {
  const { status, body } = await batchAnalysisHandlers.createBatch(request)
  return NextResponse.json(body, { status })
}
