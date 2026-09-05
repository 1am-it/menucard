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
import {
  ALLOWED_REVIEW_STATUSES,
  ALLOWED_REJECTION_REASONS,
  validateReviewDecisionInput,
  reviewValidationMessage,
  ENRICHABLE_FIELDS,
  validateEnrichmentRequestInput,
  enrichmentValidationMessage,
  shouldCollapseCandidateCardAfterAction,
  shouldOfferSharedSourceUrlAsWebsite,
  applySharedSourceUrlAsWebsite,
  isReviewDecisionSubmittable,
  hasVerifiedWebsiteForSuggestions,
} from '@/src/lib/importInbox'

// Mirrors ops/scripts/import-breda-osm.config.js's own
// ALLOWED_AMENITY_VALUES — the fixed, complete set of categories this
// pipeline can ever produce today. Kept as an independent, hardcoded
// list here rather than importing across the app/ops boundary; update
// both places together if that list ever changes.
const CATEGORY_OPTIONS = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub']

const REVIEW_STATUS_OPTIONS = ['new', ...ALLOWED_REVIEW_STATUSES]

const REVIEW_STATUS_LABELS = {
  new: 'New',
  needs_enrichment: 'Needs enrichment',
  approved_internal: 'Approved (internal only)',
  rejected: 'Rejected',
  deferred: 'Deferred',
}

const REJECTION_REASON_LABELS = {
  not_a_restaurant: 'Not a restaurant',
  duplicate: 'Duplicate',
  permanently_closed: 'Permanently closed',
  insufficient_data: 'Insufficient data',
  other: 'Other',
}

const ENRICHABLE_FIELD_LABELS = {
  address: 'Address',
  phone: 'Phone',
  website: 'Website',
}

const EMPTY_ENRICHMENT_DRAFT = {
  address: { value: '', sourceUrl: '' },
  phone: { value: '', sourceUrl: '' },
  website: { value: '', sourceUrl: '' },
  useSharedSourceUrl: false,
  sharedSourceUrl: '',
}

const SUGGESTION_STATUS_LABELS = {
  new: 'New',
  match: 'Confirms current value',
  needs_review: 'Needs review',
  no_data: 'Not found',
}

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
  const [reviewStatusFilter, setReviewStatusFilter] = useState('')

  // MARKET-05A: per-candidate review detail view. Keyed by candidate id
  // so switching between candidates never loses another one's already-
  // fetched history or in-progress draft decision.
  const [expandedCandidateId, setExpandedCandidateId] = useState(null)
  const [reviewsByCandidateId, setReviewsByCandidateId] = useState({})
  const [reviewsLoadingId, setReviewsLoadingId] = useState(null)
  const [reviewsErrorId, setReviewsErrorId] = useState(null)
  const [decisionDraftByCandidateId, setDecisionDraftByCandidateId] = useState({})
  const [decisionSubmittingId, setDecisionSubmittingId] = useState(null)
  const [decisionErrorByCandidateId, setDecisionErrorByCandidateId] = useState({})

  // MARKET-05A — per-candidate enrichment detail view. Entirely
  // independent state from the review-decision state above: enrichment
  // and review decisions are two separate actions on two separate
  // tables (see src/lib/importInbox.js's own note on this).
  const [enrichmentsByCandidateId, setEnrichmentsByCandidateId] = useState({})
  const [enrichmentsLoadingId, setEnrichmentsLoadingId] = useState(null)
  const [enrichmentsErrorId, setEnrichmentsErrorId] = useState(null)
  const [enrichmentDraftByCandidateId, setEnrichmentDraftByCandidateId] = useState({})
  const [enrichmentSubmittingId, setEnrichmentSubmittingId] = useState(null)
  const [enrichmentErrorByCandidateId, setEnrichmentErrorByCandidateId] = useState({})

  // MARKET-05A — "Suggest data from website." Only ever triggered by an
  // explicit button click (see requestSuggestions below) — never on
  // expand, never on a timer. A result only ever pre-fills the
  // enrichment draft above; nothing here writes anything by itself.
  const [suggestionsByCandidateId, setSuggestionsByCandidateId] = useState({})
  const [suggestionsLoadingId, setSuggestionsLoadingId] = useState(null)
  const [suggestionsErrorByCandidateId, setSuggestionsErrorByCandidateId] = useState({})

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
      if (filters.reviewStatus) params.set('review_status', filters.reviewStatus)

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

  // MARKET-05A — fetches one candidate's full, append-only review
  // history (newest first). Never mutates anything; the decision form
  // below is the only thing that ever writes, via a separate POST.
  const loadReviews = useCallback(async (token, candidateId) => {
    setReviewsLoadingId(candidateId)
    setReviewsErrorId(null)
    try {
      const res = await fetch(`/api/internal/v1/import-inbox/candidates/${candidateId}/reviews`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setReviewsErrorId(candidateId)
        return
      }
      setReviewsByCandidateId((prev) => ({ ...prev, [candidateId]: data.reviews || [] }))
    } catch {
      setReviewsErrorId(candidateId)
    } finally {
      setReviewsLoadingId((current) => (current === candidateId ? null : current))
    }
  }, [])

  // MARKET-05A — fetches one candidate's full, append-only enrichment
  // history (newest first). Never mutates anything; the enrichment form
  // below is the only thing that ever writes, via a separate POST.
  const loadEnrichments = useCallback(async (token, candidateId) => {
    setEnrichmentsLoadingId(candidateId)
    setEnrichmentsErrorId(null)
    try {
      const res = await fetch(`/api/internal/v1/import-inbox/candidates/${candidateId}/enrichments`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setEnrichmentsErrorId(candidateId)
        return
      }
      setEnrichmentsByCandidateId((prev) => ({ ...prev, [candidateId]: data.enrichments || [] }))
    } catch {
      setEnrichmentsErrorId(candidateId)
    } finally {
      setEnrichmentsLoadingId((current) => (current === candidateId ? null : current))
    }
  }, [])

  // MARKET-05A — "Suggest data from website." Uses only the candidate's
  // already-stored website (the server route itself re-derives this —
  // this call never sends a URL). On success, pre-fills the enrichment
  // draft's value + source URL for every suggested field that isn't
  // "no_data" — the reviewer still has to review and click "Save
  // enrichment" per field; nothing is written here.
  async function requestSuggestions(candidateId) {
    setSuggestionsLoadingId(candidateId)
    setSuggestionsErrorByCandidateId((prev) => ({ ...prev, [candidateId]: null }))
    try {
      const res = await fetch(`/api/internal/v1/import-inbox/candidates/${candidateId}/suggest-from-website`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setSuggestionsErrorByCandidateId((prev) => ({ ...prev, [candidateId]: data.error || 'Failed to get suggestions' }))
        return
      }
      setSuggestionsByCandidateId((prev) => ({ ...prev, [candidateId]: data }))
      if (data.suggestions) {
        setEnrichmentDraftByCandidateId((prev) => {
          const current = prev[candidateId] || EMPTY_ENRICHMENT_DRAFT
          const next = { ...current }
          for (const fieldName of ENRICHABLE_FIELDS) {
            const suggestion = data.suggestions[fieldName]
            if (suggestion && suggestion.status !== 'no_data') {
              next[fieldName] = { value: suggestion.value || '', sourceUrl: suggestion.source_url || '' }
            }
          }
          return { ...prev, [candidateId]: next }
        })
      }
    } catch {
      setSuggestionsErrorByCandidateId((prev) => ({ ...prev, [candidateId]: 'Failed to get suggestions' }))
    } finally {
      setSuggestionsLoadingId((current) => (current === candidateId ? null : current))
    }
  }

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
        reviewStatus: reviewStatusFilter,
      })
    }
  }, [session, runIdFilter, categoryFilter, nameFilter, duplicateFilter, qualityFilter, reviewStatusFilter, loadCandidates])

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  // MARKET-05A — expand/collapse one candidate's detail view. Fetches its
  // review and enrichment history lazily, only on first expand, not on
  // every render.
  function toggleExpand(candidateId) {
    const next = expandedCandidateId === candidateId ? null : candidateId
    setExpandedCandidateId(next)
    if (next && !reviewsByCandidateId[next] && session) {
      loadReviews(session.access_token, next)
    }
    if (next && !enrichmentsByCandidateId[next] && session) {
      loadEnrichments(session.access_token, next)
    }
  }

  function updateEnrichmentFieldDraft(candidateId, fieldName, patch) {
    setEnrichmentDraftByCandidateId((prev) => {
      const current = prev[candidateId] || EMPTY_ENRICHMENT_DRAFT
      return {
        ...prev,
        [candidateId]: { ...current, [fieldName]: { ...current[fieldName], ...patch } },
      }
    })
  }

  // Merges directly into the top-level draft (useSharedSourceUrl /
  // sharedSourceUrl) — distinct from updateEnrichmentFieldDraft above,
  // which merges into one of the three per-field {value, sourceUrl}
  // sub-objects instead.
  function updateEnrichmentTopLevelDraft(candidateId, patch) {
    setEnrichmentDraftByCandidateId((prev) => {
      const current = prev[candidateId] || EMPTY_ENRICHMENT_DRAFT
      return { ...prev, [candidateId]: { ...current, ...patch } }
    })
  }

  // UX fix (decided 2026-09-05) — "Use this source URL as the website."
  // Fills only the Website field's *value* with the already-typed shared
  // source URL (src/lib/importInbox.js's own applySharedSourceUrlAsWebsite)
  // — no fetch, no write. The reviewer still has to click "Save
  // enrichment" for anything to actually be recorded; the
  // suggest-from-website button only becomes active afterward, once that
  // save has completed and the candidate list has reloaded with the new
  // website on file (see hasVerifiedWebsiteForSuggestions below).
  function useSharedSourceUrlAsWebsite(candidateId, sharedSourceUrl) {
    setEnrichmentDraftByCandidateId((prev) => {
      const current = prev[candidateId] || EMPTY_ENRICHMENT_DRAFT
      return { ...prev, [candidateId]: applySharedSourceUrlAsWebsite(current, sharedSourceUrl) }
    })
  }

  // MARKET-05A — records one or more field enrichments in a single POST
  // via candidates/[id]/enrichments. Only fields where the reviewer
  // filled in *both* a value and a source URL are submitted — a field
  // left entirely blank is simply not part of this submission, never an
  // error. Client-side validation mirrors
  // src/lib/importInbox.js's validateEnrichmentRequestInput exactly —
  // the same function the API route itself uses.
  async function submitEnrichment(candidateId) {
    const draft = enrichmentDraftByCandidateId[candidateId] || EMPTY_ENRICHMENT_DRAFT
    // When "use one source URL for all fields" is checked, that single
    // URL is applied to every *filled-in* field's source URL at submit
    // time — the reviewer never has to retype the same URL three times.
    const effectiveSourceUrl = (fieldName) => (draft.useSharedSourceUrl ? draft.sharedSourceUrl || '' : draft[fieldName]?.sourceUrl || '')
    const fields = ENRICHABLE_FIELDS.filter((fieldName) => (draft[fieldName]?.value || '').trim() || effectiveSourceUrl(fieldName).trim()).map(
      (fieldName) => ({
        field_name: fieldName,
        value: draft[fieldName]?.value || '',
        source_url: effectiveSourceUrl(fieldName),
      })
    )

    const validation = validateEnrichmentRequestInput(fields)
    if (!validation.valid) {
      setEnrichmentErrorByCandidateId((prev) => ({ ...prev, [candidateId]: enrichmentValidationMessage(validation.reason) }))
      return
    }

    setEnrichmentSubmittingId(candidateId)
    setEnrichmentErrorByCandidateId((prev) => ({ ...prev, [candidateId]: null }))
    let outcome
    try {
      const res = await fetch(`/api/internal/v1/import-inbox/candidates/${candidateId}/enrichments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: validation.fields.map((f) => ({ field_name: f.fieldName, value: f.value, source_url: f.sourceUrl })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEnrichmentErrorByCandidateId((prev) => ({ ...prev, [candidateId]: data.error || 'Recording the enrichment failed' }))
        outcome = { ok: false }
        return
      }
      setEnrichmentDraftByCandidateId((prev) => ({ ...prev, [candidateId]: EMPTY_ENRICHMENT_DRAFT }))
      await loadEnrichments(session.access_token, candidateId)
      await loadCandidates(session.access_token, {
        runId: runIdFilter,
        category: categoryFilter,
        name: nameFilter,
        duplicate: duplicateFilter,
        quality: qualityFilter,
        reviewStatus: reviewStatusFilter,
      })
      outcome = { ok: true }
    } catch {
      setEnrichmentErrorByCandidateId((prev) => ({ ...prev, [candidateId]: 'Recording the enrichment failed' }))
      outcome = { ok: false }
    } finally {
      setEnrichmentSubmittingId((current) => (current === candidateId ? null : current))
    }
    if (shouldCollapseCandidateCardAfterAction(outcome)) {
      setExpandedCandidateId((current) => (current === candidateId ? null : current))
    }
  }

  function updateDraft(candidateId, patch) {
    setDecisionDraftByCandidateId((prev) => ({
      ...prev,
      [candidateId]: { status: '', rejectionReason: '', note: '', ...prev[candidateId], ...patch },
    }))
  }

  // MARKET-05A — records exactly one new decision (POST, never a PATCH/
  // PUT) via candidates/[id]/reviews. Client-side validation mirrors
  // src/lib/importInbox.js's validateReviewDecisionInput exactly — the
  // same function the API route itself uses — so a rejected submission
  // is never a surprise; the server-side check remains authoritative
  // regardless.
  async function submitDecision(candidateId) {
    const draft = decisionDraftByCandidateId[candidateId] || { status: '', rejectionReason: '', note: '' }
    const validation = validateReviewDecisionInput({
      status: draft.status,
      rejectionReason: draft.rejectionReason || undefined,
      note: draft.note || undefined,
    })
    if (!validation.valid) {
      setDecisionErrorByCandidateId((prev) => ({ ...prev, [candidateId]: reviewValidationMessage(validation.reason) }))
      return
    }

    setDecisionSubmittingId(candidateId)
    setDecisionErrorByCandidateId((prev) => ({ ...prev, [candidateId]: null }))
    let outcome
    try {
      const res = await fetch(`/api/internal/v1/import-inbox/candidates/${candidateId}/reviews`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: validation.status,
          rejection_reason: validation.rejectionReason,
          note: validation.note,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDecisionErrorByCandidateId((prev) => ({ ...prev, [candidateId]: data.error || 'Recording the decision failed' }))
        outcome = { ok: false }
        return
      }
      setDecisionDraftByCandidateId((prev) => ({ ...prev, [candidateId]: { status: '', rejectionReason: '', note: '' } }))
      await loadReviews(session.access_token, candidateId)
      await loadCandidates(session.access_token, {
        runId: runIdFilter,
        category: categoryFilter,
        name: nameFilter,
        duplicate: duplicateFilter,
        quality: qualityFilter,
        reviewStatus: reviewStatusFilter,
      })
      outcome = { ok: true }
    } catch {
      setDecisionErrorByCandidateId((prev) => ({ ...prev, [candidateId]: 'Recording the decision failed' }))
      outcome = { ok: false }
    } finally {
      setDecisionSubmittingId((current) => (current === candidateId ? null : current))
    }
    if (shouldCollapseCandidateCardAfterAction(outcome)) {
      setExpandedCandidateId((current) => (current === candidateId ? null : current))
    }
  }

  if (session === undefined) {
    return <main style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>Loading…</main>
  }

  const selectedRun = runIdFilter ? runs.find((r) => r.id === runIdFilter) || null : null
  const filtersActive = Boolean(categoryFilter || nameFilter || duplicateFilter || qualityFilter || reviewStatusFilter)

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
        Nothing here can ever write to <code>import_runs</code>, <code>import_extraction_records</code>, or any canonical
        or public table. "Possible duplicate" and quality status are computed on every load from the raw data plus any
        manual enrichments — never stored on the raw record. Recording a review decision or an enrichment below only ever
        adds a new row to its own separate, append-only audit log — the raw import record itself is never changed, and a
        correction is always a new entry, never an edit. "Approved (internal only)" means ready for internal enrichment
        only — never public publication, never a MenuCard — and is entirely independent from recording an enrichment:
        neither one ever sets the other automatically.
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
            <select value={reviewStatusFilter} onChange={(e) => setReviewStatusFilter(e.target.value)} style={selectStyle}>
              <option value="">Any review status</option>
              {REVIEW_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {REVIEW_STATUS_LABELS[s]}
                </option>
              ))}
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
              {candidates.map((c) => {
                const expanded = expandedCandidateId === c.id
                const draft = decisionDraftByCandidateId[c.id] || { status: '', rejectionReason: '', note: '' }
                const reviews = reviewsByCandidateId[c.id]
                return (
                  <div key={c.id} style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{c.extracted_fields?.name || '(no name)'}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={badgeStyle(c.quality_status === 'complete' ? 'var(--green-faint)' : 'var(--warning-bg)', c.quality_status === 'complete' ? 'var(--green)' : 'var(--warning)')}>
                          {c.quality_status}
                        </span>
                        {c.possible_duplicate && <span style={badgeStyle('var(--warning-bg)', 'var(--warning)')}>possible duplicate</span>}
                        <span
                          style={badgeStyle(
                            c.review_status === 'approved_internal'
                              ? 'var(--green-faint)'
                              : c.review_status === 'rejected'
                                ? 'var(--danger-bg)'
                                : c.review_status === 'new'
                                  ? 'var(--bg-card)'
                                  : 'var(--warning-bg)',
                            c.review_status === 'approved_internal'
                              ? 'var(--green)'
                              : c.review_status === 'rejected'
                                ? 'var(--danger)'
                                : c.review_status === 'new'
                                  ? 'var(--text-muted)'
                                  : 'var(--warning)'
                          )}
                        >
                          {REVIEW_STATUS_LABELS[c.review_status] || c.review_status}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      {c.extracted_fields?.category || '—'}
                      {c.normalized_fields?.address ? ` · ${c.normalized_fields.address}` : ''}
                      {c.enrichment_sources?.address && (
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                          {' '}
                          (enriched via {c.enrichment_sources.address.source_url}, {c.enrichment_sources.address.recorded_at})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.normalized_fields?.phone ? `${c.normalized_fields.phone} · ` : ''}
                      {c.normalized_fields?.website || ''}
                      {c.normalization?.phone && c.normalization.phone.valid === false && (
                        <span style={{ fontSize: 11, color: 'var(--warning)' }}> (phone format not recognized — shown as entered)</span>
                      )}
                      {c.enrichment_sources?.phone && (
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}> (phone enriched via {c.enrichment_sources.phone.source_url})</span>
                      )}
                      {c.enrichment_sources?.website && (
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}> (website enriched via {c.enrichment_sources.website.source_url})</span>
                      )}
                    </div>
                    {c.missing_fields && c.missing_fields.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>Missing: {c.missing_fields.join(', ')}</div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, marginBottom: 8 }}>
                      {c.record_locator} · imported {c.retrieved_at}
                    </div>
                    <button
                      onClick={() => toggleExpand(c.id)}
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: expanded ? 'var(--green-faint)' : 'transparent',
                        color: expanded ? 'var(--green)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      {expanded ? 'Hide details' : 'Details & review'}
                    </button>

                    {expanded && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                          Opening this detail view is read-only — it only loads history, never records anything. Closing it
                          without choosing a status or saving an enrichment leaves no trace: nothing is written unless you
                          explicitly click "Save decision" or "Save enrichment" below.
                        </p>
                        <h3 style={{ fontSize: 13, margin: '0 0 8px', color: 'var(--text-secondary)' }}>Review history</h3>
                        {reviewsLoadingId === c.id && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}
                        {reviewsErrorId === c.id && (
                          <p style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load review history.</p>
                        )}
                        {reviewsLoadingId !== c.id && reviews && reviews.length === 0 && (
                          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No review decisions recorded yet — currently "new".</p>
                        )}
                        {reviews && reviews.length > 0 && (
                          <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
                            {reviews.map((r) => (
                              <div key={r.id} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                <strong>{REVIEW_STATUS_LABELS[r.status] || r.status}</strong>
                                {r.rejection_reason ? ` (${REJECTION_REASON_LABELS[r.rejection_reason] || r.rejection_reason})` : ''}
                                {' · '}
                                {r.decided_at}
                                {r.note ? <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{r.note}</div> : null}
                              </div>
                            ))}
                          </div>
                        )}

                        <h3 style={{ fontSize: 13, margin: '0 0 8px', color: 'var(--text-secondary)' }}>Record a decision</h3>
                        <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
                          <select
                            value={draft.status}
                            onChange={(e) => updateDraft(c.id, { status: e.target.value, rejectionReason: '' })}
                            style={selectStyle}
                          >
                            <option value="">Choose a status…</option>
                            {ALLOWED_REVIEW_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {REVIEW_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                          {draft.status === 'rejected' && (
                            <select
                              value={draft.rejectionReason}
                              onChange={(e) => updateDraft(c.id, { rejectionReason: e.target.value })}
                              style={selectStyle}
                            >
                              <option value="">Choose a rejection reason…</option>
                              {ALLOWED_REJECTION_REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {REJECTION_REASON_LABELS[r]}
                                </option>
                              ))}
                            </select>
                          )}
                          <textarea
                            placeholder="Optional internal note…"
                            value={draft.note}
                            onChange={(e) => updateDraft(c.id, { note: e.target.value })}
                            rows={2}
                            style={{ ...selectStyle, resize: 'vertical', fontFamily: 'inherit' }}
                          />
                          {decisionErrorByCandidateId[c.id] && (
                            <div style={{ fontSize: 12, color: 'var(--danger)' }}>{decisionErrorByCandidateId[c.id]}</div>
                          )}
                          {!isReviewDecisionSubmittable(draft) && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Choose a status to enable saving a decision.</div>
                          )}
                          <button
                            onClick={() => submitDecision(c.id)}
                            disabled={decisionSubmittingId === c.id || !isReviewDecisionSubmittable(draft)}
                            style={{
                              fontSize: 13,
                              padding: '6px 12px',
                              borderRadius: 8,
                              border: 'none',
                              background: 'var(--green)',
                              color: '#fff',
                              fontWeight: 600,
                              cursor: isReviewDecisionSubmittable(draft) ? 'pointer' : 'not-allowed',
                              opacity: isReviewDecisionSubmittable(draft) ? 1 : 0.6,
                              justifySelf: 'start',
                            }}
                          >
                            {decisionSubmittingId === c.id ? 'Saving…' : 'Save decision'}
                          </button>
                        </div>

                        <h3 style={{ fontSize: 13, margin: '20px 0 8px', color: 'var(--text-secondary)' }}>Enrichment history</h3>
                        {enrichmentsLoadingId === c.id && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}
                        {enrichmentsErrorId === c.id && (
                          <p style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load enrichment history.</p>
                        )}
                        {enrichmentsLoadingId !== c.id &&
                          enrichmentsByCandidateId[c.id] &&
                          enrichmentsByCandidateId[c.id].length === 0 && (
                            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No manual enrichments recorded yet.</p>
                          )}
                        {enrichmentsByCandidateId[c.id] && enrichmentsByCandidateId[c.id].length > 0 && (
                          <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
                            {enrichmentsByCandidateId[c.id].map((e) => (
                              <div key={e.id} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                <strong>{ENRICHABLE_FIELD_LABELS[e.field_name] || e.field_name}</strong>: {e.value}
                                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                                  Source: {e.source_url} · {e.recorded_at}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 8px' }}>
                          <h3 style={{ fontSize: 13, margin: 0, color: 'var(--text-secondary)' }}>Enrich missing business info</h3>
                          <button
                            onClick={() => requestSuggestions(c.id)}
                            disabled={suggestionsLoadingId === c.id || !hasVerifiedWebsiteForSuggestions(c)}
                            title={!hasVerifiedWebsiteForSuggestions(c) ? 'Save a verified website first to enable suggestions.' : undefined}
                            style={{
                              fontSize: 12,
                              padding: '4px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: hasVerifiedWebsiteForSuggestions(c) ? 'var(--text-secondary)' : 'var(--text-faint)',
                              cursor: hasVerifiedWebsiteForSuggestions(c) ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {suggestionsLoadingId === c.id ? 'Fetching…' : 'Suggest data from website'}
                          </button>
                        </div>
                        {!hasVerifiedWebsiteForSuggestions(c) && (
                          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                            Save a verified website first to enable suggestions.
                          </p>
                        )}
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                          Fill in a value and its source URL for one or more fields. A field left blank is not submitted.
                          A correction is recorded as a new entry — nothing here is ever edited or deleted.
                        </p>

                        {suggestionsErrorByCandidateId[c.id] && (
                          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{suggestionsErrorByCandidateId[c.id]}</div>
                        )}
                        {suggestionsByCandidateId[c.id] && suggestionsByCandidateId[c.id].robots_txt_status === 'disallowed' && (
                          <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 8 }}>
                            This page is disallowed by the site's robots.txt and was not fetched.
                          </div>
                        )}
                        {suggestionsByCandidateId[c.id] && suggestionsByCandidateId[c.id].robots_txt_status === 'unconfirmed' && (
                          <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 8 }}>
                            robots.txt could not be confirmed for this site — no suggestion was made.
                          </div>
                        )}
                        {suggestionsByCandidateId[c.id]?.warnings?.length > 0 && (
                          <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 8 }}>
                            {suggestionsByCandidateId[c.id].warnings.map((w, i) => (
                              <div key={i}>⚠ {w}</div>
                            ))}
                          </div>
                        )}
                        {suggestionsByCandidateId[c.id]?.suggestions && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                            Suggestions from {suggestionsByCandidateId[c.id].source_url} have been filled into the form
                            below — nothing is saved until you click "Save enrichment."
                            <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
                              {ENRICHABLE_FIELDS.map((fieldName) => {
                                const s = suggestionsByCandidateId[c.id].suggestions[fieldName]
                                if (!s || s.status === 'no_data') return null
                                return (
                                  <div key={fieldName}>
                                    {ENRICHABLE_FIELD_LABELS[fieldName]}: {SUGGESTION_STATUS_LABELS[s.status] || s.status}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
                          {(() => {
                            const fieldDraftFor = (fieldName) => (enrichmentDraftByCandidateId[c.id] || EMPTY_ENRICHMENT_DRAFT)[fieldName] || { value: '', sourceUrl: '' }
                            const useShared = (enrichmentDraftByCandidateId[c.id] || EMPTY_ENRICHMENT_DRAFT).useSharedSourceUrl
                            const sharedUrl = (enrichmentDraftByCandidateId[c.id] || EMPTY_ENRICHMENT_DRAFT).sharedSourceUrl
                            return (
                              <>
                                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={useShared}
                                    onChange={(e) => updateEnrichmentTopLevelDraft(c.id, { useSharedSourceUrl: e.target.checked })}
                                  />
                                  Use one source URL for all filled-in fields
                                </label>
                                {useShared && (
                                  <input
                                    type="text"
                                    placeholder="Source URL used for every filled-in field below…"
                                    value={sharedUrl}
                                    onChange={(e) => updateEnrichmentTopLevelDraft(c.id, { sharedSourceUrl: e.target.value })}
                                    style={selectStyle}
                                  />
                                )}
                                {shouldOfferSharedSourceUrlAsWebsite({
                                  useSharedSourceUrl: useShared,
                                  sharedSourceUrl: sharedUrl,
                                  websiteValue: fieldDraftFor('website').value,
                                }) && (
                                  <button
                                    type="button"
                                    onClick={() => useSharedSourceUrlAsWebsite(c.id, sharedUrl)}
                                    style={{
                                      fontSize: 12,
                                      padding: '4px 10px',
                                      borderRadius: 8,
                                      border: '1px solid var(--border)',
                                      background: 'transparent',
                                      color: 'var(--text-secondary)',
                                      cursor: 'pointer',
                                      justifySelf: 'start',
                                    }}
                                  >
                                    Use this source URL as the website
                                  </button>
                                )}
                                {ENRICHABLE_FIELDS.map((fieldName) => {
                                  const fieldDraft = fieldDraftFor(fieldName)
                                  return (
                                    <div key={fieldName} style={{ display: 'grid', gap: 4 }}>
                                      <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ENRICHABLE_FIELD_LABELS[fieldName]}</label>
                                      <input
                                        type="text"
                                        placeholder={`New ${ENRICHABLE_FIELD_LABELS[fieldName].toLowerCase()} value…`}
                                        value={fieldDraft.value}
                                        onChange={(e) => updateEnrichmentFieldDraft(c.id, fieldName, { value: e.target.value })}
                                        style={selectStyle}
                                      />
                                      {!useShared && (
                                        <input
                                          type="text"
                                          placeholder="Source URL (e.g. the restaurant's own website)…"
                                          value={fieldDraft.sourceUrl}
                                          onChange={(e) => updateEnrichmentFieldDraft(c.id, fieldName, { sourceUrl: e.target.value })}
                                          style={selectStyle}
                                        />
                                      )}
                                    </div>
                                  )
                                })}
                              </>
                            )
                          })()}
                          {enrichmentErrorByCandidateId[c.id] && (
                            <div style={{ fontSize: 12, color: 'var(--danger)' }}>{enrichmentErrorByCandidateId[c.id]}</div>
                          )}
                          <button
                            onClick={() => submitEnrichment(c.id)}
                            disabled={enrichmentSubmittingId === c.id}
                            style={{
                              fontSize: 13,
                              padding: '6px 12px',
                              borderRadius: 8,
                              border: 'none',
                              background: 'var(--green)',
                              color: '#fff',
                              fontWeight: 600,
                              cursor: 'pointer',
                              justifySelf: 'start',
                            }}
                          >
                            {enrichmentSubmittingId === c.id ? 'Saving…' : 'Save enrichment'}
                          </button>
                        </div>

                        <button
                          onClick={() => toggleExpand(c.id)}
                          style={{
                            fontSize: 12,
                            padding: '4px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'transparent',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            marginTop: 16,
                          }}
                        >
                          Back to candidates
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </main>
  )
}
