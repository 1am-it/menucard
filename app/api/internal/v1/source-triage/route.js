// Brontriage (BE-24) — GET /api/internal/v1/source-triage. Read only,
// `internal`-only. BE-23's workqueue (same queries, same classifier,
// unchanged) plus the stored source proposals and their audit events.
// Never fetches an external URL, never starts an analysis, never writes.
// All logic lives in src/lib/sourceTriageHandlers.js (tested); this file
// only wires in the real dependencies.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { createSourceTriageHandlers } from '@/src/lib/sourceTriageHandlers'
import restaurantsData from '@/data/restaurants.json'

const handlers = createSourceTriageHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
  generateId: generateUuidV7,
})

export async function GET(request) {
  const { status, body } = await handlers.getTriage(request)
  return NextResponse.json(body, { status })
}
