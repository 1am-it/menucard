// MARKET-05A — Data-inbox candidate list. `internal`-only. Reads only
// `import_extraction_records` — already-minimized `extracted_fields`,
// never a raw source feature — plus which `import_run_id` each belongs
// to. `possible_duplicate`/`quality_status` are computed here, read-only,
// on every request (src/lib/importInbox.js) — never stored, never a
// review decision, never MARKET-05B's real deduplication logic. Never
// writes, never touches a canonical table, never a public route.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly, enrichAndFilterCandidates } from '@/src/lib/importInbox'

// v1 limitation, not silently ignored: enough headroom for every
// candidate the real, already-run dry-runs actually produced (500
// stored), with room to grow — revisit with real pagination once volume
// materially exceeds this.
const RECORD_LIMIT = 2000

function parseBooleanParam(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can view the import inbox' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('run_id') || undefined
  const category = searchParams.get('category') || undefined
  const name = searchParams.get('name') || undefined
  const possibleDuplicate = parseBooleanParam(searchParams.get('possible_duplicate'))
  const quality = searchParams.get('quality') || undefined

  const supabase = getSupabaseAdmin()
  const { data: records, error: recordsError } = await supabase
    .from('import_extraction_records')
    .select('id, import_run_id, record_locator, retrieved_at, extracted_fields')
    .order('retrieved_at', { ascending: false })
    .limit(RECORD_LIMIT)
  if (recordsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const { candidates, totalBeforeFilters } = enrichAndFilterCandidates(records, {
    runId,
    category,
    name,
    possibleDuplicate,
    quality,
  })

  return NextResponse.json({
    candidates,
    total_before_filters: totalBeforeFilters,
    total_after_filters: candidates.length,
  })
}
