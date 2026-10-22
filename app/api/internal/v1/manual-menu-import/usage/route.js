// #59 fase 2 — GET: export van het app-AI-gebruik (alleen metagegevens).
// Schema en bouw: src/lib/manualMenuImportUsage.js. De tellingen komen uit
// opgeslagen concepten met importProvenance, dus hetzelfde document als
// ops/scripts/export-app-ai-usage.js. Gelezen door DevDashboardTower als
// alleen-lezen bron.

import { NextResponse } from 'next/server'
import { manualMenuImportHandlers } from '@/src/lib/manualMenuImportRouteDeps'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { status, body } = await manualMenuImportHandlers.usage(request)
  return NextResponse.json(body, { status })
}
