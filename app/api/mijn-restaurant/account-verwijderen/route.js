// BE-47 (#111), criterium 4 — POST /api/mijn-restaurant/account-verwijderen.
//
// Een dunne wikkel: de beslissingen (bearer-token, verse code via `verifyOtp`,
// alleen de eigen gebruiker, foutvertaling) staan in de geteste module
// src/lib/ownerAccountDeletion.js. Deze route kent geen eigen regel en neemt geen
// gebruikers-id uit het verzoek aan.
//
// De admin-client (service role) wordt hier geïnjecteerd en blijft server-only,
// net als bij elke andere interne route (src/lib/supabaseAdmin.js).

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { createAccountDeletionHandler } from '@/src/lib/ownerAccountDeletion'

export const dynamic = 'force-dynamic'

const handleDeleteOwnAccount = createAccountDeletionHandler({ getSupabase: getSupabaseAdmin })

export async function POST(request) {
  const outcome = await handleDeleteOwnAccount(request)
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
