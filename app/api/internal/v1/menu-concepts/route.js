// BE-17 Menuconcepten beoordelen — GET: the latest version of every internal
// menu concept, waiting ones first. Internal only; read only.
// Logic: src/lib/menuConceptReviewHandlers.js.

import { NextResponse } from 'next/server'
import { menuConceptReviewHandlers } from '@/src/lib/menuConceptReviewRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { status, body } = await menuConceptReviewHandlers.list(request)
  return NextResponse.json(body, { status })
}
