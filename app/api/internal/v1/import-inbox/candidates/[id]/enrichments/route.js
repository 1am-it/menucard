// MARKET-05A — internal candidate enrichment audit log. `internal`-only,
// same guard as every other Data-inbox route. GET lists the full,
// append-only enrichment history for one candidate (newest first) —
// never filtered down to "the current value," since there is no
// current-value column here (see
// supabase/migrations/0008_market05a_candidate_enrichments.sql's own
// header comment). POST records one or more field enrichments in a
// single call via the record_candidate_enrichments() RPC — always an
// insert, nothing else; the database itself grants no other write on
// this table at all, for any role. Documented contract:
// docs/api/import-inbox-api.md.
//
// Deliberately independent of the separate review-decision audit table
// and its free-text note field (see 0007_market05a_candidate_reviews.sql)
// — this route never reads either. Enrichment and review decisions are
// two separate actions on two separate tables — recording an enrichment
// here never changes a review's status, and a note written for a review
// is never parsed into a structured enrichment. A reviewer who
// previously wrote a value into such a note must deliberately re-enter
// it through this route's own form.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly, validateEnrichmentRequestInput, enrichmentValidationMessage } from '@/src/lib/importInbox'

export async function GET(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can view candidate enrichments' }, { status: 403 })
  }

  const { id } = await params

  const supabase = getSupabaseAdmin()
  const { data: enrichments, error } = await supabase
    .from('import_candidate_enrichments')
    .select('id, candidate_id, reviewer_id, field_name, value, source_url, recorded_at')
    .eq('candidate_id', id)
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ enrichments })
}

export async function POST(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can record candidate enrichments' }, { status: 403 })
  }

  const { id } = await params

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validateEnrichmentRequestInput(body && body.fields)
  if (!validation.valid) {
    return NextResponse.json({ error: enrichmentValidationMessage(validation.reason) }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  // The RPC does exactly one INSERT ... SELECT ... RETURNING — every
  // field from this one submission is written atomically, in a single
  // transaction; nothing here ever calls a mutating method other than
  // this one RPC.
  const { data, error } = await supabase.rpc('record_candidate_enrichments', {
    p_candidate_id: id,
    p_actor_user_id: auth.userId,
    p_fields: validation.fields.map((f) => ({ field_name: f.fieldName, value: f.value, source_url: f.sourceUrl })),
  })

  if (error) {
    const notFound = error.code === 'P0002' || /candidate not found/i.test(error.message || '')
    return NextResponse.json({ error: notFound ? 'Candidate not found' : 'Recording the enrichment failed' }, { status: notFound ? 404 : 500 })
  }

  return NextResponse.json({ enrichments: data }, { status: 201 })
}
