// BE-17 Menuconcepten beoordelen — POST: a reviewer's correction as a new,
// immutable internal concept version (expected version required; blockers
// recomputed on the server). Nothing is published.
// Logic: src/lib/menuConceptReviewHandlers.js.

import { NextResponse } from 'next/server'
import { menuConceptReviewHandlers } from '@/src/lib/menuConceptReviewRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await menuConceptReviewHandlers.saveVersion(request, id)
  return NextResponse.json(body, { status })
}
