// BE-17 Menuconcepten beoordelen — GET: one concept version with its
// lineage, the original extraction, the current menu and the source status.
// Internal only; read only. Logic: src/lib/menuConceptReviewHandlers.js.

import { NextResponse } from 'next/server'
import { menuConceptReviewHandlers } from '@/src/lib/menuConceptReviewRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { id } = await params
  const { status, body } = await menuConceptReviewHandlers.detail(request, id)
  return NextResponse.json(body, { status })
}
