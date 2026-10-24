// #59 / BE-21 (Lead review 6380804419) — "Lees met AI".
//   GET  : mag het blok de knop tonen (sleutel + vlag) en wat is er deze maand
//          al gebruikt (afgeleid uit duurzame AI-concepten).
//   POST : de enige serveraanroep. Accepteert uitsluitend het verzegelde
//          toestandstoken van een bestaande capture of het id van een bestaande
//          analyse-opdracht, nooit een URL uit de client.
// Logic: src/lib/menuAiReadHandlers.js. Provider call:
// src/lib/menuExtractionAnthropicCall.js (ongewijzigd).
//
// maxDuration 60: dezelfde waarde als de bestaande batch-analysis-process-route.
// De call zelf stopt op 50 s (AI_LIMITS), zodat validatie en de conceptopslag
// binnen de functie vallen. Er is geen achtergrondproces en geen in-memory
// state tussen requests.

import { NextResponse } from 'next/server'
import { menuAiReadHandlers } from '@/src/lib/menuAiReadRouteDeps'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request) {
  const { status, body } = await menuAiReadHandlers.status(request)
  return NextResponse.json(body, { status })
}

export async function POST(request) {
  const { status, body } = await menuAiReadHandlers.read(request)
  return NextResponse.json(body, { status })
}
