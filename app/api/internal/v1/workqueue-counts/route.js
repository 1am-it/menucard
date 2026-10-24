// #62 — GET /api/internal/v1/workqueue-counts. Read-only, authenticated with the
// same authenticateInternalRequest every internal route already uses; returns
// only the counts of the sections the caller may open. A count that cannot be
// computed is `null` (the navigation then shows no number), never a fake 0.
// No migration, no write, no external request, no AI. Logic (tested):
// src/lib/workqueueCountsHandlers.js.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { createWorkqueueCountsHandlers } from '@/src/lib/workqueueCountsHandlers'

export const dynamic = 'force-dynamic'

const handlers = createWorkqueueCountsHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
})

export async function GET(request) {
  const { status, body } = await handlers.getCounts(request)
  return NextResponse.json(body, { status })
}
