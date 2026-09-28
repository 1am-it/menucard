// BE-20 (fase 1) — the status-poll endpoint the "Minimal durable
// analysis-job contract" requires to exist (planning/specs/tickets/be-20-general-restaurant-source-extraction.md),
// even though fase 1's own POST /api/internal/v1/restaurant-analysis-jobs
// already processes a job fully synchronously before responding — this
// route is the seam a later background worker could attach to without
// any caller needing to change. `internal`-only, GET-only.
//
// Scoped to the requesting account's own jobs only
// (`actor_user_id = auth.userId`) — never another reviewer's job, even
// though every `internal` account already shares visibility into most
// other review queues in this project; a job is a personal, in-flight
// analysis request before it becomes a shared, durable url_intakes row,
// so this narrower scoping is deliberate here specifically.

import { NextResponse } from 'next/server'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'

export async function GET(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can view a restaurant source analysis job' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data: job, error } = await supabase
    .from('restaurant_source_analysis_jobs')
    .select('id, status, error_reason, result_receipt_id, field_evidence, created_at, updated_at')
    .eq('id', id)
    .eq('actor_user_id', auth.userId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      error_reason: job.error_reason,
      result_receipt_id: job.result_receipt_id,
      field_evidence: job.status === 'succeeded' ? job.field_evidence : null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    },
  })
}
