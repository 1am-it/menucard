// Brontriage (BE-24) — POST /api/internal/v1/source-triage/proposals/[id]/decision.
// `internal`-only. Accepts or rejects an OPEN proposal through the
// decide_source_triage_proposal RPC (0015) — the only write. Accepting
// records a human decision; it changes no published data and starts no
// analysis. Logic: src/lib/sourceTriageHandlers.js.

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

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await handlers.decideProposal(request, id)
  return NextResponse.json(body, { status })
}
