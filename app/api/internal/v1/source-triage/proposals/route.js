// Brontriage (BE-24) — POST /api/internal/v1/source-triage/proposals.
// `internal`-only. Records a source PROPOSAL (add a candidate URL, replace
// the source, or mark it unusable) through the create_source_triage_proposal
// RPC (0015) — the only write. The proposed URL is validated as text and is
// never fetched; nothing is analysed or published. Logic:
// src/lib/sourceTriageHandlers.js.

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

export async function POST(request) {
  const { status, body } = await handlers.createProposal(request)
  return NextResponse.json(body, { status })
}
