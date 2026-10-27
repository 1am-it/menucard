// #62 — GET /api/internal/v1/workqueue-counts. Read-only, authenticated with the
// same authenticateInternalRequest every internal route already uses; returns
// only the counts of the sections the caller may open. A count that cannot be
// computed is `null` (the navigation then shows no number), never a fake 0.
// No migration, no write, no external request, no AI. Logic (tested):
// src/lib/workqueueCountsHandlers.js.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { createWorkqueueCountsHandlers } from '@/src/lib/workqueueCountsHandlers'
import { createSourceTriageHandlers } from '@/src/lib/sourceTriageHandlers'
import { createSourceReviewCounter } from '@/src/lib/sourceReviewCount'
import { batchAnalysisHandlers } from '@/src/lib/batchAnalysisRouteDeps'
import restaurantsData from '@/data/restaurants.json'

export const dynamic = 'force-dynamic'

// BE-31 (#74): the Bronnen number is the number of tasks that screen shows. It
// reuses the existing read handlers instead of a new query, so a count can never
// disagree with the list the click opens. Read only.
const triageHandlers = createSourceTriageHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
  generateId: generateUuidV7,
})

function sourceReviewCount(request) {
  const counter = createSourceReviewCounter({
    getTriage: async () => {
      const { status, body } = await triageHandlers.getTriage(request)
      return status === 200 ? body : null
    },
    getBatchOverview: async (batchId) => {
      const { status, body } = await batchAnalysisHandlers.getOverview(request, batchId)
      return status === 200 ? body : null
    },
  })
  return counter()
}

const handlers = createWorkqueueCountsHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  sourceReviewCount,
})

export async function GET(request) {
  const { status, body } = await handlers.getCounts(request)
  return NextResponse.json(body, { status })
}
