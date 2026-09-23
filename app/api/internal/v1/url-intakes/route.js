// BE-19 — redeems an analysis receipt into a durable url_intakes row, via
// the new, single-purpose create_url_intake_from_receipt() RPC
// (supabase/migrations/0013_be19_url_intakes.sql). `internal`-only, same
// authorization pattern as every other route in this project.
//
// Used directly by the EXACT-MATCH flow (an existing restaurant — no
// new restaurant concept is ever created here). The
// unmatched-restaurant flow instead goes through
// app/api/internal/v1/profile-drafts/route.js, which redeems a receipt
// as its own first internal step before promoting — this route is not
// called twice for the same receipt in that case.
//
// Never trusts anything the client claims about the analysis itself
// (restaurant match, extracted fields) — the RPC re-derives and
// re-validates everything from the receipt row the server itself
// already wrote. This route only ever passes through: the receipt id,
// the caller's own authenticated user id, the caller's stated source
// URL (canonicalized here, exactly like the read-url route already
// does, for the RPC's own URL-binding check), and a freshly recomputed
// hash of the receipt's own stored analysis — never anything the client
// could have fabricated.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { canonicalizeSourceUrl } from '@/src/lib/urlIntakes'
import { computeAnalysisResultHash } from '@/src/lib/urlIntakeReceiptHash'
import { generateUuidV7 } from '@/src/lib/uuidv7'

export async function POST(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can create a URL intake' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const receiptId = body && typeof body.receipt_id === 'string' ? body.receipt_id.trim() : ''
  if (!receiptId) {
    return NextResponse.json({ error: 'receipt_id is required' }, { status: 400 })
  }
  const canonical = canonicalizeSourceUrl(body && body.source_url)
  if (!canonical) {
    return NextResponse.json({ error: 'A valid source_url is required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { data: receiptRow, error: receiptError } = await supabase
    .from('url_intake_analysis_receipts')
    .select('actor_user_id, canonical_source_url, restaurant_match_type, matched_restaurant_id, candidate_summary')
    .eq('id', receiptId)
    .maybeSingle()
  if (receiptError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  if (!receiptRow) {
    return NextResponse.json({ error: 'Deze analyse is niet meer geldig. Lees de URL opnieuw uit.' }, { status: 409 })
  }

  const expectedHash = computeAnalysisResultHash({
    actorUserId: receiptRow.actor_user_id,
    canonicalSourceUrl: receiptRow.canonical_source_url,
    restaurantMatchType: receiptRow.restaurant_match_type,
    matchedRestaurantId: receiptRow.matched_restaurant_id,
    candidateSummary: receiptRow.candidate_summary,
  })

  const urlIntakeId = generateUuidV7()

  const { data, error } = await supabase.rpc('create_url_intake_from_receipt', {
    p_url_intake_id: urlIntakeId,
    p_receipt_id: receiptId,
    p_actor_user_id: auth.userId,
    p_canonical_source_url: canonical.canonicalUrl,
    p_expected_analysis_result_hash: expectedHash,
  })

  if (error) {
    if (['P0020', 'P0021', 'P0022', 'P0023', 'P0024'].includes(error.code)) {
      return NextResponse.json({ error: 'Deze analyse is niet meer geldig. Lees de URL opnieuw uit.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Creating the URL intake failed' }, { status: 500 })
  }

  return NextResponse.json({ url_intake: data }, { status: 201 })
}
