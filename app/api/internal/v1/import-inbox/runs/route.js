// MARKET-05A — Data-inbox import overview. `internal`-only (not editor,
// not owner — see planning/specs/tickets/market-05-normalization-deduplication.md's
// "Access control — decided 2026-09-05"). Read-only: lists every
// `import_runs` row with its data-origin/access-provider source names
// resolved. Never writes, never touches `pending_changes`, never a
// canonical/public route. Not reachable by the public.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly, buildRunSummary } from '@/src/lib/importInbox'

const LIST_LIMIT = 200

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can view the import inbox' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()
  const { data: runs, error: runsError } = await supabase
    .from('import_runs')
    .select(
      'id, status, started_at, completed_at, record_counts, error_log, source_locator, source_version, data_origin_source_id, access_provider_source_id'
    )
    .order('started_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (runsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const sourceIds = [
    ...new Set(runs.flatMap((r) => [r.data_origin_source_id, r.access_provider_source_id]).filter(Boolean)),
  ]

  let sourceNamesById = {}
  if (sourceIds.length > 0) {
    const { data: sources, error: sourcesError } = await supabase.from('sources').select('id, name').in('id', sourceIds)
    if (sourcesError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    sourceNamesById = Object.fromEntries(sources.map((s) => [s.id, s.name]))
  }

  const items = runs.map((run) => buildRunSummary(run, sourceNamesById))
  return NextResponse.json({ runs: items })
}
