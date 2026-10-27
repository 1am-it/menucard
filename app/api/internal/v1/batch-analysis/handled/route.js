// BE-31 herstel (#74) — "Oude resultaten opruimen".
//
// POST met { job_ids: [...] }: sluit de gekozen bestaande batchresultaten af als
// "afgehandeld door <medewerker> op <datum>". Niets wordt gewist: het resultaat,
// de receipt, de batchrij en een eventueel voorstel blijven staan. De
// vastlegging gaat additief naar de bestaande
// `restaurant_source_analysis_jobs.field_evidence` (zoals BE-30), dus er is
// geen migratie nodig.
//
// Logic: src/lib/batchResultHandling.js.

import { NextResponse } from 'next/server'
import { batchResultHandlingHandlers } from '@/src/lib/batchResultHandlingRouteDeps'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const { status, body } = await batchResultHandlingHandlers.markHandled(request)
  return NextResponse.json(body, { status })
}
