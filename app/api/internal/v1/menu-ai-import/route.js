// #59 / BE-21 (Lead review 6380804419) — "Lees met AI".
//   GET  : mag het blok de knop tonen (sleutel + vlag) en wat is er deze maand
//          al gebruikt (afgeleid uit duurzame AI-concepten).
//   POST : de enige serveraanroep. Accepteert uitsluitend het verzegelde
//          toestandstoken van een bestaande capture of het id van een bestaande
//          analyse-opdracht, nooit een URL uit de client.
// Logic: src/lib/menuAiReadHandlers.js. Provider call:
// src/lib/menuExtractionAnthropicCall.js (ongewijzigd).
//
// maxDuration 300 (Y1, Lead review 6381657192): the measured worst case of one
// reading was 46.8 s, so the earlier 60 s function (50 s call) cut a somewhat
// larger menu off after the tokens were already paid. Per Vercel's official
// duration documentation, 300 s is the default *and* maximum for a function on
// Hobby with Fluid compute (enabled by default for new projects since
// 2025-04-23) and is below the 800 s maximum on Pro/Enterprise. The call itself
// stops at 120 s (AI_LIMITS) and the job deadline is 150 s, leaving 150 s inside
// the function for validation and the existing concept write. No plan, project
// setting or vercel.json was changed. There is no background process and no
// in-memory state between requests.

import { NextResponse } from 'next/server'
import { menuAiReadHandlers } from '@/src/lib/menuAiReadRouteDeps'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request) {
  const { status, body } = await menuAiReadHandlers.status(request)
  return NextResponse.json(body, { status })
}

export async function POST(request) {
  const { status, body } = await menuAiReadHandlers.read(request)
  return NextResponse.json(body, { status })
}
