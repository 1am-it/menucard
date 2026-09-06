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
  ALLOWED_DEFERRED_REASONS,
  formatDeferredReasonLabel,
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
  TRIAGE_SUMMARY_STATUSES,
  computeReviewStatusCounts,
  computeCandidateTriageBucket,
  filterCandidatesForTriage,
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

// Triage overview (added 2026-09-06) — one short, honest sentence per
// bucket computeCandidateTriageBucket can return. Deliberately never
// implies anything automatic: "approved_pending_canonical" only ever
// means "ready for a future, not-yet-built canonical-draft step"
// (MARKET-05B) — never that such a step is scheduled, running, or will
// ever happen without a separate, later, deliberate decision.
const TRIAGE_BUCKET_DESCRIPTIONS = {
  needs_enrichment: 'Still needs enrichment before it can move forward.',
  deferred: 'Deliberately postponed by a reviewer.',
  approved_pending_canonical: 'Internally approved — ready only for a future, not-yet-built canonical draft step.',
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

const selectStyle = {
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: 13,
}

// Presentation-only redesign (2026-09-06) — visual acceptance reference:
// docs/mockups/internal-candidate-triage-v1.png. Lightweight, stroke-only
// SVG icons (never emoji, never an icon font/library dependency) —
// mirrors docs/guides/design-reference.md's "lightweight icons" principle
// already used elsewhere in this app. Each renders at whatever size/color
// its containing `.di-*` CSS class sets via `currentColor`/`svg { width; height }`.
function IconDocument() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}
function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}
function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  )
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  )
}
function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 9 6 6m0-6-6 6" />
    </svg>
  )
}
function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
function IconInfo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-5M12 8h.01" />
    </svg>
  )
}
function IconPin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 2 .6 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.5 2.9.6a2 2 0 0 1 1.8 2Z" />
    </svg>
  )
}
function IconGlobe() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  )
}
function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

const TRIAGE_STATUS_ICONS = {
  new: IconDocument,
  needs_enrichment: IconPencil,
  approved_internal: IconCheck,
  deferred: IconClock,
  rejected: IconX,
}

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

  // Triage overview (added 2026-09-06) — a read-only, always-full-picture
  // summary of every candidate's *effective* review status, entirely
  // independent from the "Candidates" section's own browsing filters
  // below (category/name/duplicate/quality/reviewStatus) — those narrow
  // what a reviewer is currently looking at; this always reflects the
  // true counts for the selected run (or every run, if none is
  // selected), so switching a browsing filter can never silently shrink
  // a triage count. Scoped only by runIdFilter — its own GET call below
  // deliberately omits every other filter param. Never writes anything;
  // its own status/deferred-reason/search filters are applied entirely
  // client-side (filterCandidatesForTriage, src/lib/importInbox.js) over
  // this already-fetched, already-read-only data.
  const [triageCandidates, setTriageCandidates] = useState([])
  const [triageError, setTriageError] = useState(null)
  const [triageLoading, setTriageLoading] = useState(false)
  const [triageStatusFilter, setTriageStatusFilter] = useState('')
  const [triageDeferredReasonFilter, setTriageDeferredReasonFilter] = useState('')
  const [triageSearchTerm, setTriageSearchTerm] = useState('')
  // Set by "View in list" below; cleared once the target candidate's
  // card has actually rendered and been scrolled to (see the dedicated
  // effect further down) — never itself scrolls anything directly.
  const [pendingScrollCandidateId, setPendingScrollCandidateId] = useState(null)

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

  // Triage overview (added 2026-09-06) — the same read-only
  // `/candidates` GET the browsing section below already uses, but
  // deliberately scoped by `run_id` only (never
  // category/name/duplicate/quality/review_status), so the triage
  // summary always reflects the true picture for the selected run,
  // regardless of what the browsing filters below are currently set to.
  const loadTriageCandidates = useCallback(async (token, runId) => {
    setTriageLoading(true)
    setTriageError(null)
    try {
      const params = new URLSearchParams()
      if (runId) params.set('run_id', runId)
      const res = await fetch(`/api/internal/v1/import-inbox/candidates?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setTriageError(data.error || 'Failed to load the triage overview')
        setTriageCandidates([])
        return
      }
      setTriageCandidates(data.candidates || [])
    } catch {
      setTriageError('Failed to load the triage overview')
    } finally {
      setTriageLoading(false)
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

  // Triage overview — deliberately its own effect, keyed only on
  // runIdFilter, never on the browsing filters above.
  useEffect(() => {
    if (session) {
      loadTriageCandidates(session.access_token, runIdFilter)
    }
  }, [session, runIdFilter, loadTriageCandidates])

  // Triage overview — scrolls to and reveals a candidate's card once
  // "View in list" has cleared the browsing filters and the freshly
  // (re)loaded `candidates` array actually contains it. Never scrolls on
  // its own initiative; only ever runs after an explicit click sets
  // `pendingScrollCandidateId` below.
  useEffect(() => {
    if (!pendingScrollCandidateId) return
    if (!candidates.some((c) => c.id === pendingScrollCandidateId)) return
    const el = document.getElementById(`candidate-${pendingScrollCandidateId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPendingScrollCandidateId(null)
  }, [candidates, pendingScrollCandidateId])

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

  // Triage overview — "View in list": clears the browsing filters below
  // (never the run filter — triage is already scoped to it) so the
  // target candidate is guaranteed to appear there, expands its card
  // (loading its history exactly like an ordinary toggleExpand would),
  // and queues a scroll-into-view for once that card has actually
  // rendered (see the dedicated effect above). No fetch of anything
  // beyond the same read-only history any ordinary expand already
  // triggers; never records a decision or enrichment by itself.
  function jumpToCandidateFromTriage(candidateId) {
    setCategoryFilter('')
    setNameFilter('')
    setDuplicateFilter('')
    setQualityFilter('')
    setReviewStatusFilter('')
    setExpandedCandidateId(candidateId)
    if (session) {
      if (!reviewsByCandidateId[candidateId]) loadReviews(session.access_token, candidateId)
      if (!enrichmentsByCandidateId[candidateId]) loadEnrichments(session.access_token, candidateId)
    }
    setPendingScrollCandidateId(candidateId)
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
      await loadTriageCandidates(session.access_token, runIdFilter)
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
      [candidateId]: { status: '', rejectionReason: '', deferredReason: '', note: '', ...prev[candidateId], ...patch },
    }))
  }

  // MARKET-05A — records exactly one new decision (POST, never a PATCH/
  // PUT) via candidates/[id]/reviews. Client-side validation mirrors
  // src/lib/importInbox.js's validateReviewDecisionInput exactly — the
  // same function the API route itself uses — so a rejected submission
  // is never a surprise; the server-side check remains authoritative
  // regardless.
  async function submitDecision(candidateId) {
    const draft = decisionDraftByCandidateId[candidateId] || { status: '', rejectionReason: '', deferredReason: '', note: '' }
    const validation = validateReviewDecisionInput({
      status: draft.status,
      rejectionReason: draft.rejectionReason || undefined,
      deferredReason: draft.deferredReason || undefined,
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
          deferred_reason: validation.deferredReason,
          note: validation.note,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDecisionErrorByCandidateId((prev) => ({ ...prev, [candidateId]: data.error || 'Recording the decision failed' }))
        outcome = { ok: false }
        return
      }
      setDecisionDraftByCandidateId((prev) => ({ ...prev, [candidateId]: { status: '', rejectionReason: '', deferredReason: '', note: '' } }))
      await loadReviews(session.access_token, candidateId)
      await loadCandidates(session.access_token, {
        runId: runIdFilter,
        category: categoryFilter,
        name: nameFilter,
        duplicate: duplicateFilter,
        quality: qualityFilter,
        reviewStatus: reviewStatusFilter,
      })
      await loadTriageCandidates(session.access_token, runIdFilter)
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
    return (
      <div className="di-page">
        <main className="di-main" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </main>
      </div>
    )
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
    <div className="di-page">
      <main className="di-main">
      <div className="di-topbar">
        <h1 className="di-title">Candidate triage</h1>
        <button onClick={signOut} className="di-signout">
          Sign out
        </button>
      </div>

      <div className="di-banner di-banner-neutral">
        <span className="di-banner-icon">
          <IconInfo />
        </span>
        <span>
          Everything here is read-only history plus two append-only actions — <strong>Save decision</strong> and{' '}
          <strong>Save enrichment</strong> — each adding a new audit row, never editing or deleting one.
        </span>
      </div>

      <h2 className="di-section-title">Import runs</h2>

      {runsError && (
        <div className="di-banner di-banner-danger">
          <span className="di-banner-icon">
            <IconX />
          </span>
          <span>{runsError}</span>
        </div>
      )}

      {runsLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

      {!runsLoading && candidateState === 'no-runs' && !runsError && (
        <p style={{ color: 'var(--text-muted)' }}>No import runs yet.</p>
      )}

      {runs.length > 0 && (
        <div style={{ display: 'grid', gap: 12, marginBottom: 28 }}>
          {runs.map((run) => (
            <div key={run.id} className="di-run-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span
                  className={`di-chip ${
                    run.status === 'succeeded' ? 'di-chip--complete' : run.status === 'failed' ? 'di-chip--rejected' : 'di-chip--deferred'
                  }`}
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
                className={`di-run-toggle ${runIdFilter === run.id ? 'active' : ''}`}
              >
                {runIdFilter === run.id ? 'Showing this run only' : 'Show only this run'}
              </button>
            </div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <>
          <h2 className="di-section-title">Triage overview</h2>

          <div className="di-banner di-banner-neutral">
            <span className="di-banner-icon">
              <IconInfo />
            </span>
            <span>
              Read-only summary for {runIdFilter ? 'the selected run' : 'every run'}, independent from the "Candidates"
              filters below. "View details" only opens that candidate's existing, unchanged detail view further down —
              nothing here ever writes anything. Chain/franchise matching and service-model classification are separate,
              later features, not part of this.
            </span>
          </div>

          {triageError && (
            <div className="di-banner di-banner-danger">
              <span className="di-banner-icon">
                <IconX />
              </span>
              <span>{triageError}</span>
            </div>
          )}

          {triageLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

          {!triageLoading && !triageError && (
            <>
              <div className="di-summary">
                {(() => {
                  const counts = computeReviewStatusCounts(triageCandidates)
                  return TRIAGE_SUMMARY_STATUSES.map((status) => {
                    const active = triageStatusFilter === status
                    const Icon = TRIAGE_STATUS_ICONS[status]
                    return (
                      <button
                        key={status}
                        onClick={() => {
                          setTriageStatusFilter(active ? '' : status)
                          setTriageDeferredReasonFilter('')
                        }}
                        className={`di-summary-card ${active ? 'active' : ''}`}
                      >
                        <span className={`di-summary-icon di-summary-icon--${status}`}>
                          <Icon />
                        </span>
                        <span className="di-summary-body">
                          <span className="di-summary-label">{REVIEW_STATUS_LABELS[status]}</span>
                          <span className="di-summary-count">{counts[status]}</span>
                        </span>
                      </button>
                    )
                  })
                })()}
              </div>

              <div className="di-filterbar">
                <div className="di-filter-group di-search-wrap">
                  <span className="di-filter-label">Search</span>
                  <span className="di-search-icon">
                    <IconSearch />
                  </span>
                  <input
                    type="text"
                    placeholder="Search by business name, address, phone or website"
                    value={triageSearchTerm}
                    onChange={(e) => setTriageSearchTerm(e.target.value)}
                    className="di-input"
                  />
                </div>
                <div className="di-filter-group">
                  <span className="di-filter-label">Status</span>
                  <select
                    value={triageStatusFilter}
                    onChange={(e) => {
                      setTriageStatusFilter(e.target.value)
                      setTriageDeferredReasonFilter('')
                    }}
                    className="di-select"
                  >
                    <option value="">All statuses</option>
                    {TRIAGE_SUMMARY_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {REVIEW_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </div>
                {triageStatusFilter === 'deferred' && (
                  <div className="di-filter-group">
                    <span className="di-filter-label">Deferred reason</span>
                    <select
                      value={triageDeferredReasonFilter}
                      onChange={(e) => setTriageDeferredReasonFilter(e.target.value)}
                      className="di-select"
                    >
                      <option value="">All reasons</option>
                      {ALLOWED_DEFERRED_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {formatDeferredReasonLabel(r)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {(triageStatusFilter || triageDeferredReasonFilter || triageSearchTerm) && (
                  <button
                    onClick={() => {
                      setTriageStatusFilter('')
                      setTriageDeferredReasonFilter('')
                      setTriageSearchTerm('')
                    }}
                    className="di-clear-link"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {(() => {
                const triageFiltered = filterCandidatesForTriage(triageCandidates, {
                  statusFilter: triageStatusFilter,
                  deferredReasonFilter: triageStatusFilter === 'deferred' ? triageDeferredReasonFilter : '',
                  searchTerm: triageSearchTerm,
                })
                if (triageFiltered.length === 0) {
                  return <div className="di-empty" style={{ marginBottom: 28 }}>No candidates match the current triage filters.</div>
                }
                return (
                  <div className="di-rows" style={{ marginBottom: 28 }}>
                    {triageFiltered.map((c) => {
                      const bucket = computeCandidateTriageBucket(c)
                      const StatusIcon = TRIAGE_STATUS_ICONS[c.review_status]
                      return (
                        <div key={c.id} className="di-row">
                          <div>
                            <div className="di-row-name">{c.extracted_fields?.name || '(no name)'}</div>
                            <div className="di-row-contact">
                              <span className="di-row-contact-line">
                                <IconPin />
                                {c.normalized_fields?.address || '—'}
                              </span>
                              {c.normalized_fields?.phone && (
                                <span className="di-row-contact-line">
                                  <IconPhone />
                                  {c.normalized_fields.phone}
                                </span>
                              )}
                              <span className={`di-row-contact-line ${c.normalized_fields?.website ? '' : 'di-muted'}`}>
                                <IconGlobe />
                                {c.normalized_fields?.website || '—'}
                              </span>
                            </div>
                          </div>
                          <div>
                            <div className="di-row-col-label">Completeness</div>
                            <span className={`di-chip ${c.quality_status === 'complete' ? 'di-chip--complete' : 'di-chip--incomplete'}`}>
                              {c.quality_status === 'complete' ? 'Complete' : 'Incomplete'}
                            </span>
                          </div>
                          <div>
                            <div className="di-row-col-label">Latest review</div>
                            <span className={`di-chip di-chip--${c.review_status}`}>
                              {StatusIcon && <StatusIcon />}
                              {REVIEW_STATUS_LABELS[c.review_status] || c.review_status}
                            </span>
                            {bucket && (
                              <div className="di-row-reason">
                                {TRIAGE_BUCKET_DESCRIPTIONS[bucket]}
                                {bucket === 'deferred' && c.deferred_reason ? ` (${formatDeferredReasonLabel(c.deferred_reason)})` : ''}
                              </div>
                            )}
                          </div>
                          <button onClick={() => jumpToCandidateFromTriage(c.id)} className="di-view-btn">
                            View details
                            <IconChevronRight />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </>
          )}
        </>
      )}

      {runs.length > 0 && (
        <>
          <h2 className="di-section-title">Candidates</h2>

          <div className="di-filterbar">
            <div className="di-filter-group di-search-wrap">
              <span className="di-filter-label">Name</span>
              <span className="di-search-icon">
                <IconSearch />
              </span>
              <input
                type="text"
                placeholder="Search name…"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="di-input"
              />
            </div>
            <div className="di-filter-group">
              <span className="di-filter-label">Category</span>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="di-select">
                <option value="">All categories</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="di-filter-group">
              <span className="di-filter-label">Duplicates</span>
              <select value={duplicateFilter} onChange={(e) => setDuplicateFilter(e.target.value)} className="di-select">
                <option value="">Any duplicate status</option>
                <option value="true">Possible duplicates only</option>
                <option value="false">No possible duplicate</option>
              </select>
            </div>
            <div className="di-filter-group">
              <span className="di-filter-label">Completeness</span>
              <select value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)} className="di-select">
                <option value="">Any quality</option>
                <option value="complete">Complete</option>
                <option value="incomplete">Incomplete</option>
              </select>
            </div>
            <div className="di-filter-group">
              <span className="di-filter-label">Status</span>
              <select value={reviewStatusFilter} onChange={(e) => setReviewStatusFilter(e.target.value)} className="di-select">
                <option value="">Any review status</option>
                {REVIEW_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            {(categoryFilter || nameFilter || duplicateFilter || qualityFilter || reviewStatusFilter) && (
              <button
                onClick={() => {
                  setCategoryFilter('')
                  setNameFilter('')
                  setDuplicateFilter('')
                  setQualityFilter('')
                  setReviewStatusFilter('')
                }}
                className="di-clear-link"
              >
                Clear filters
              </button>
            )}
          </div>

          {showErrorBanner && (
            <div className="di-banner di-banner-warning">
              <span className="di-banner-icon">
                <IconX />
              </span>
              <span>
                The selected run {selectedRun.status === 'failed' ? 'failed' : 'completed only partially'} — see its error
                count above. Any candidates it did store are still listed below.
              </span>
            </div>
          )}

          {candidatesError && (
            <div className="di-banner di-banner-danger">
              <span className="di-banner-icon">
                <IconX />
              </span>
              <span>{candidatesError}</span>
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
                const draft = decisionDraftByCandidateId[c.id] || { status: '', rejectionReason: '', deferredReason: '', note: '' }
                const reviews = reviewsByCandidateId[c.id]
                return (
                  <div key={c.id} id={`candidate-${c.id}`} className="di-candidate-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                      <div className="di-row-name" style={{ marginBottom: 0 }}>{c.extracted_fields?.name || '(no name)'}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span className={`di-chip ${c.quality_status === 'complete' ? 'di-chip--complete' : 'di-chip--incomplete'}`}>
                          {c.quality_status === 'complete' ? 'Complete' : 'Incomplete'}
                        </span>
                        {c.possible_duplicate && <span className="di-chip di-chip--incomplete">possible duplicate</span>}
                        <span className={`di-chip di-chip--${c.review_status}`}>
                          {REVIEW_STATUS_LABELS[c.review_status] || c.review_status}
                        </span>
                      </div>
                    </div>
                    {c.review_status === 'deferred' && c.deferred_reason && (
                      <div className="di-row-reason" style={{ marginBottom: 4 }}>
                        Deferred reason: {formatDeferredReasonLabel(c.deferred_reason)}
                      </div>
                    )}
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
                    <button onClick={() => toggleExpand(c.id)} className={`di-link-btn ${expanded ? 'active' : ''}`}>
                      {expanded ? 'Hide details' : 'Details & review'}
                    </button>

                    {expanded && (
                      <div className="di-detail">
                        <div className="di-banner di-banner-info" style={{ marginBottom: 12 }}>
                          <span className="di-banner-icon">
                            <IconShield />
                          </span>
                          <span>
                            Read-only until you act: opening this never records anything, and closing it without choosing a
                            status or saving an enrichment leaves no trace.
                          </span>
                        </div>
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
                                {r.deferred_reason ? ` (${formatDeferredReasonLabel(r.deferred_reason)})` : ''}
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
                            onChange={(e) => updateDraft(c.id, { status: e.target.value, rejectionReason: '', deferredReason: '' })}
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
                          {draft.status === 'deferred' && (
                            <select
                              value={draft.deferredReason}
                              onChange={(e) => updateDraft(c.id, { deferredReason: e.target.value })}
                              style={selectStyle}
                            >
                              <option value="">Choose a deferred reason…</option>
                              {ALLOWED_DEFERRED_REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {formatDeferredReasonLabel(r)}
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
                            className="di-btn-primary"
                            style={{ justifySelf: 'start' }}
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
                            className="di-link-btn"
                            style={{
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

                        <div style={{ display: 'grid', gap: 14, maxWidth: 560 }}>
                          {(() => {
                            const fieldDraftFor = (fieldName) => (enrichmentDraftByCandidateId[c.id] || EMPTY_ENRICHMENT_DRAFT)[fieldName] || { value: '', sourceUrl: '' }
                            const useShared = (enrichmentDraftByCandidateId[c.id] || EMPTY_ENRICHMENT_DRAFT).useSharedSourceUrl
                            const sharedUrl = (enrichmentDraftByCandidateId[c.id] || EMPTY_ENRICHMENT_DRAFT).sharedSourceUrl
                            return (
                              <>
                                {/* Step 1: the source URL, first and most prominent — everything
                                    below is either derived from it (shared mode) or needs its own
                                    per-field source instead (individual mode). */}
                                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'grid', gap: 8 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>1. Source</div>
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
                                </div>

                                {/* Step 2: the three enrichable fields, as compact, consistent
                                    rows — value first, then its own source URL, only when the
                                    fields aren't already sharing the one source URL above. */}
                                <div style={{ display: 'grid', gap: 6 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>2. Fields</div>
                                  {ENRICHABLE_FIELDS.map((fieldName) => {
                                    const fieldDraft = fieldDraftFor(fieldName)
                                    return (
                                      <div
                                        key={fieldName}
                                        style={{
                                          display: 'grid',
                                          gridTemplateColumns: useShared ? '80px minmax(0, 1fr)' : '80px minmax(0, 1fr) minmax(0, 1fr)',
                                          gap: 6,
                                          alignItems: 'center',
                                        }}
                                      >
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
                                </div>
                              </>
                            )
                          })()}
                          {enrichmentErrorByCandidateId[c.id] && (
                            <div style={{ fontSize: 12, color: 'var(--danger)' }}>{enrichmentErrorByCandidateId[c.id]}</div>
                          )}
                          <button
                            onClick={() => submitEnrichment(c.id)}
                            disabled={enrichmentSubmittingId === c.id}
                            className="di-btn-primary"
                            style={{ justifySelf: 'start' }}
                          >
                            {enrichmentSubmittingId === c.id ? 'Saving…' : 'Save enrichment'}
                          </button>
                        </div>

                        <button onClick={() => toggleExpand(c.id)} className="di-link-btn" style={{ marginTop: 16 }}>
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
    </div>
  )
}
