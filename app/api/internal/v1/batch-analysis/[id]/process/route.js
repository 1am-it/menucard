// BE-25 fase 2 — POST: process exactly one job of this batch, called only by
// the starter's open batch page (claim_next_source_analysis_job, 0016). The
// fetch goes through the shared src/lib/sourceAnalysisPipeline.js only.
// There is no worker or schedule: closing the page pauses the batch.

import { NextResponse } from 'next/server'
import { batchAnalysisHandlers } from '@/src/lib/batchAnalysisRouteDeps'

export const dynamic = 'force-dynamic'
// One analysis (entry page, at most five same-host candidates, digital
// PDFs) stays well within this; the 3-minute lease covers an overrun.
export const maxDuration = 60

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await batchAnalysisHandlers.processNext(request, id)
  return NextResponse.json(body, { status })
}
