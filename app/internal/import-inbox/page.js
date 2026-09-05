'use client'

// MARKET-05A — Data-inbox: read-only internal review of raw import
// candidates, entirely before any normalization, matching, or canonical
// merge (see planning/specs/tickets/market-05-normalization-deduplication.md's
// "MARKET-05A" section for the full design). Same authenticated-API
// pattern as every other internal page (src/lib/supabaseBrowser.js for
// the session, /api/internal/v1/... for all data) — no direct Supabase
// data access from the browser. `internal`-only: an `editor`- or
// `owner`-only session, or a session with no staff_roles row at all,
// gets 403 from the API and never sees any of this page's data.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'

// Mirrors ops/scripts/import-breda-osm.config.js's own
// ALLOWED_AMENITY_VALUES — the fixed, complete set of categories this
// pipeline can ever produce today. Kept as an independent, hardcoded
// list here rather than importing across the app/ops boundary; update
// both places together if that list ever changes.
const CATEGORY_OPTIONS = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub']

const cardStyle = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
  background: 'var(--bg-card)',
}

const selectStyle = {
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: 13,
}

const badgeStyle = (bg, color) => ({
  fontSize: 12,
  padding: '3px 8px',
  borderRadius: 999,
  background: bg,
  color,
})

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}

export default function ImportInboxPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [runs, setRuns] = useState([])
  const [runsError, setRunsError] = useState(null)
  const [runsLoading, setRunsLoading] = useState(false)

  const [candidates, setCandidates] = useState([])
  const [totalBeforeFilters, setTotalBeforeFilters] = useState(0)
  const [candidatesError, setCandidatesError] = useState(null)
  const [candidatesLoading, setCandidatesLoading] = useState(false)

  const [runIdFilter, setRunIdFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [nameFilter, setNameFilter] = useState('')
  const [duplicateFilter, setDuplicateFilter] = useState('')
  const [qualityFilter, setQualityFilter] = useState('')

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/internal/login')
      } else {
        setSession(data.session)
      }
    })
  }, [router])

  const loadRuns = useCallback(async (token) => {
    setRunsLoading(true)
    setRunsError(null)
    try {
      const res = await fetch('/api/internal/v1/import-inbox/runs', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setRunsError(data.error || 'Failed to load import runs')
        setRuns([])
        return
      }
      setRuns(data.runs || [])
    } catch {
      setRunsError('Failed to load import runs')
    } finally {
      setRunsLoading(false)
    }
  }, [])

  const loadCandidates = useCallback(async (token, filters) => {
    setCandidatesLoading(true)
    setCandidatesError(null)
    try {
      const params = new URLSearchParams()
      if (filters.runId) params.set('run_id', filters.runId)
      if (filters.category) params.set('category', filters.category)
      if (filters.name) params.set('name', filters.name)
      if (filters.duplicate) params.set('possible_duplicate', filters.duplicate)
      if (filters.quality) params.set('quality', filters.quality)

      const res = await fetch(`/api/internal/v1/import-inbox/candidates?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setCandidatesError(data.error || 'Failed to load candidates')
        setCandidates([])
        setTotalBeforeFilters(0)
        return
      }
      setCandidates(data.candidates || [])
      setTotalBeforeFilters(data.total_before_filters || 0)
    } catch {
      setCandidatesError('Failed to load candidates')
    } finally {
      setCandidatesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) {
      loadRuns(session.access_token)
    }
  }, [session, loadRuns])

  useEffect(() => {
    if (session) {
      loadCandidates(session.access_token, {
        runId: runIdFilter,
        category: categoryFilter,
        name: nameFilter,
        duplicate: duplicateFilter,
        quality: qualityFilter,
      })
    }
  }, [session, runIdFilter, categoryFilter, nameFilter, duplicateFilter, qualityFilter, loadCandidates])

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  if (session === undefined) {
    return <main style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>Loading…</main>
  }

  const selectedRun = runIdFilter ? runs.find((r) => r.id === runIdFilter) || null : null
  const filtersActive = Boolean(categoryFilter || nameFilter || duplicateFilter || qualityFilter)

  // Same decision src/lib/importInbox.js's classifyInboxState makes,
  // inlined here rather than re-imported into a 'use client' bundle for
  // one small conditional — the API responses (record_counts, status,
  // candidates.length) are what's actually under test, not this render
  // branch itself.
  let candidateState = 'has-candidates'
  if (runs.length === 0) {
    candidateState = 'no-runs'
  } else if (candidates.length === 0) {
    candidateState = filtersActive || runIdFilter ? 'no-filter-matches' : 'run-has-no-candidates'
  }
  const showErrorBanner = Boolean(selectedRun && (selectedRun.status === 'failed' || selectedRun.status === 'partial'))

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '32px 20px',
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Data-inbox — import candidates</h1>
        <button
          onClick={signOut}
          style={{
            fontSize: 13,
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 10px',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          Sign out
        </button>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 0, marginBottom: 24 }}>
        Read-only. Nothing on this page can write to <code>import_runs</code>, <code>import_extraction_records</code>, or
        any canonical table. "Possible duplicate" and quality status are computed on every load — never stored, never a
        review decision.
      </p>

      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Import runs</h2>

      {runsError && (
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', marginBottom: 16, fontSize: 14 }}>
          {runsError}
        </div>
      )}

      {runsLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

      {!runsLoading && candidateState === 'no-runs' && !runsError && (
        <p style={{ color: 'var(--text-muted)' }}>No import runs yet.</p>
      )}

      {runs.length > 0 && (
        <div style={{ display: 'grid', gap: 12, marginBottom: 28 }}>
          {runs.map((run) => (
            <div key={run.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span
                  style={badgeStyle(
                    run.status === 'succeeded'
                      ? 'var(--green-faint)'
                      : run.status === 'failed'
                        ? 'var(--danger-bg)'
                        : 'var(--warning-bg)',
                    run.status === 'succeeded' ? 'var(--green)' : run.status === 'failed' ? 'var(--danger)' : 'var(--warning)'
                  )}
                >
                  {run.status}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{run.started_at}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {run.data_origin_source_name || 'Unknown source'}
                {run.access_provider_source_name ? ` via ${run.access_provider_source_name}` : ''}
                {run.source_version ? ` · ${run.source_version}` : ''}
              </div>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                Duration: {formatDuration(run.duration_seconds)} · Fetched: {run.record_counts?.fetched ?? '—'} · Stored:{' '}
                {run.record_counts?.stored ?? '—'} · Skipped: {run.record_counts?.skipped ?? '—'} · Errored:{' '}
                {run.record_counts?.errored ?? '—'}
              </div>
              {(run.status === 'failed' || run.status === 'partial') && run.error_log && run.error_log.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>
                  {run.error_log.length} error(s) recorded for this run.
                </div>
              )}
              <button
                onClick={() => setRunIdFilter(runIdFilter === run.id ? '' : run.id)}
                style={{
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: runIdFilter === run.id ? 'var(--green-faint)' : 'transparent',
                  color: runIdFilter === run.id ? 'var(--green)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {runIdFilter === run.id ? 'Showing this run only' : 'Show only this run'}
              </button>
            </div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Candidates</h2>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={selectStyle}>
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search name…"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              style={{ ...selectStyle, minWidth: 160 }}
            />
            <select value={duplicateFilter} onChange={(e) => setDuplicateFilter(e.target.value)} style={selectStyle}>
              <option value="">Any duplicate status</option>
              <option value="true">Possible duplicates only</option>
              <option value="false">No possible duplicate</option>
            </select>
            <select value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)} style={selectStyle}>
              <option value="">Any quality</option>
              <option value="complete">Complete</option>
              <option value="incomplete">Incomplete</option>
            </select>
          </div>

          {showErrorBanner && (
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', marginBottom: 16, fontSize: 14 }}>
              The selected run {selectedRun.status === 'failed' ? 'failed' : 'completed only partially'} — see its error
              count above. Any candidates it did store are still listed below.
            </div>
          )}

          {candidatesError && (
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', marginBottom: 16, fontSize: 14 }}>
              {candidatesError}
            </div>
          )}

          {candidatesLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

          {!candidatesLoading && candidateState === 'run-has-no-candidates' && !candidatesError && (
            <p style={{ color: 'var(--text-muted)' }}>This run produced no stored candidates.</p>
          )}

          {!candidatesLoading && candidateState === 'no-filter-matches' && !candidatesError && (
            <p style={{ color: 'var(--text-muted)' }}>
              No candidates match the current filters ({totalBeforeFilters} total before filtering).
            </p>
          )}

          {candidates.length > 0 && (
            <div style={{ display: 'grid', gap: 12 }}>
              {candidates.map((c) => (
                <div key={c.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{c.extracted_fields?.name || '(no name)'}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={badgeStyle(c.quality_status === 'complete' ? 'var(--green-faint)' : 'var(--warning-bg)', c.quality_status === 'complete' ? 'var(--green)' : 'var(--warning)')}>
                        {c.quality_status}
                      </span>
                      {c.possible_duplicate && <span style={badgeStyle('var(--warning-bg)', 'var(--warning)')}>possible duplicate</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {c.extracted_fields?.category || '—'}
                    {c.extracted_fields?.address ? ` · ${c.extracted_fields.address}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {c.extracted_fields?.phone ? `${c.extracted_fields.phone} · ` : ''}
                    {c.extracted_fields?.website || ''}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
                    {c.record_locator} · imported {c.retrieved_at}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}
