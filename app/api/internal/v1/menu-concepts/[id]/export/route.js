// BE-27 "Maak review-PR" — POST: export an internally approved, complete
// menu concept to one ordinary GitHub review pull request (idempotent per
// version). Never merges or publishes; merging by hand is the publication.
// Logic: src/lib/menuConceptExport.js.

import { NextResponse } from 'next/server'
import { menuConceptExportHandler } from '@/src/lib/menuConceptReviewRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { id } = await params
  const { status, body } = await menuConceptExportHandler.exportToReviewPr(request, id)
  return NextResponse.json(body, { status })
}
