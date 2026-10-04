// Bronwerkvoorraad — GET /api/internal/v1/source-workqueue. Read-only,
// `internal`-only. Builds the internal source workqueue from data that
// already exists: BE-20's `restaurant_source_analysis_jobs` (0014), their
// `url_intake_analysis_receipts` (0013) and the static restaurant list
// (data/restaurants.json). It never starts an analysis, never fetches an
// external URL, never writes, and never publishes anything — select only.
//
// All classification lives in src/lib/sourceWorkqueue.js (pure, tested).
// The response carries only what the page shows: name, wijk, domain, the
// two statuses, the one action, the queue and the check time — never a
// full URL, an HTTP status, an error reason, a log or a score.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { matchRestaurantByHostname } from '@/src/lib/restaurantHostMatch'
import { buildSourceWorkqueue } from '@/src/lib/sourceWorkqueue'
import restaurantsData from '@/data/restaurants.json'

// A real, technical bound — far above Breda's restaurant count times a
// handful of checks each. Ordered newest first, so the bound only ever
// drops the oldest checks; the response says so when it is reached.
const JOB_LIMIT = 2000

const JOB_COLUMNS =
  'id, canonical_source_url, status, error_reason, result_receipt_id, created_at, updated_at, unknown_menu_contexts:field_evidence->unknown_menu_contexts'
// The two JSON-path selects (`alias:column->key`, standard PostgREST
// syntax) read only the menu parts of `field_evidence`/`candidate_summary`,
// never the full evidence or restaurant fields.
const RECEIPT_COLUMNS = 'id, restaurant_match_type, matched_restaurant_id, menus:candidate_summary->menus'

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Alleen interne medewerkers kunnen de bronwerkvoorraad bekijken.' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()

  // Same server-side market lookup every BE-19/BE-20 record already uses —
  // never hardcoded, never client-supplied.
  const { data: marketRow, error: marketError } = await supabase.from('markets').select('id').eq('slug', 'breda').maybeSingle()
  if (marketError || !marketRow) {
    return NextResponse.json({ error: 'De bronwerkvoorraad kon niet worden geladen.' }, { status: 500 })
  }

  const { data: jobs, error: jobsError } = await supabase
    .from('restaurant_source_analysis_jobs')
    .select(JOB_COLUMNS)
    .eq('market_id', marketRow.id)
    .order('created_at', { ascending: false })
    .limit(JOB_LIMIT)
  if (jobsError) {
    return NextResponse.json({ error: 'De bronwerkvoorraad kon niet worden geladen.' }, { status: 500 })
  }

  const receiptIds = [...new Set((jobs || []).map((j) => j.result_receipt_id).filter(Boolean))]
  let receipts = []
  if (receiptIds.length > 0) {
    const { data, error } = await supabase.from('url_intake_analysis_receipts').select(RECEIPT_COLUMNS).in('id', receiptIds)
    if (error) {
      return NextResponse.json({ error: 'De bronwerkvoorraad kon niet worden geladen.' }, { status: 500 })
    }
    receipts = data || []
  }

  const queue = buildSourceWorkqueue({
    restaurants: restaurantsData,
    jobs: jobs || [],
    receipts,
    matchHostname: (url) => matchRestaurantByHostname(restaurantsData, url),
  })

  return NextResponse.json({
    city: 'Breda',
    rows: queue.rows.map((r) => ({
      restaurant_id: r.restaurantId,
      name: r.name,
      wijk: r.wijk,
      domain: r.domain,
      source: r.source,
      menu: r.menu,
      action: r.action,
      queue: r.queue,
      priority: r.priority,
      checked_at: r.checkedAt,
    })),
    not_in_queue: queue.notInQueue.map((r) => ({ restaurant_id: r.restaurantId, name: r.name, wijk: r.wijk, reason: r.reason })),
    counts: queue.counts,
    unattributed_checks: queue.unattributedChecks,
    job_limit_reached: (jobs || []).length >= JOB_LIMIT,
  })
}
