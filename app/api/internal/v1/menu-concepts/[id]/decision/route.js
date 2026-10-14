// BE-17 Menuconcepten beoordelen — POST: approve internally or reject with a
// fixed reason (expected version required; idempotent). Approval stays
// internal: nothing is exported or published.
// Logic: src/lib/menuConceptReviewHandlers.js.

import { NextResponse } from 'next/server'
import { menuConceptReviewHandlers } from '@/src/lib/menuConceptReviewRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await menuConceptReviewHandlers.decide(request, id)
  return NextResponse.json(body, { status })
}
