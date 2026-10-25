// BE-30 (#72) — het enige advies-endpoint bij "Rubriekindeling controleren".
// POST met { job_id }: één AI-aanroep voor alle onzekere rubrieken van deze
// bronversie, als suggestie. De AI beslist en bewaart niets als besluit; de mens
// bevestigt via de bestaande bevestigingsroute.
// Logic: src/lib/menuStructureAdviceHandlers.js. Provider call:
// src/lib/menuExtractionAnthropicCall.js (dezelfde als "Lees met AI").
//
// De call stopt zelf na 60 s; de functie heeft ruimte voor de validatie en de
// additieve opslag. Er is geen achtergrondproces en geen geheugen tussen
// verzoeken.

import { NextResponse } from 'next/server'
import { menuStructureAdviceHandlers } from '@/src/lib/menuStructureAdviceRouteDeps'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request) {
  const { status, body } = await menuStructureAdviceHandlers.advise(request)
  return NextResponse.json(body, { status })
}
