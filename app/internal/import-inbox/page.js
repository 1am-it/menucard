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
  buildCandidateHistoryTimeline,
} from '@/src/lib/importInbox'
import {
  canPromoteCandidateToProfileDraft,
  canDiscardCandidateDraft,
  buildDraftLineageSummary,
} from '@/src/lib/restaurantProfileDrafts'

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
function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}
function IconChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
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

// Presentation-only redesign (2026-09-12) — visual acceptance reference:
// docs/mockups/restaurant-profile-drafts-detail-v1.png's "History &
// sources" accordion. The short, human-readable date shown prominently
// on each timeline row — the full raw timestamp is still shown, just
// de-emphasized (di-timeline-meta), never hidden. Falls back to the raw
// value for anything that doesn't parse, rather than showing "Invalid
// Date" — never expected in practice (every event comes from a real
// decided_at/recorded_at column), but a display helper should never
// throw on unexpected input.
function formatShortDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Turns one merged-timeline review event (src/lib/importInbox.js's own
 * buildCandidateHistoryTimeline) into a short title + optional one-line
 * description — reuses this page's own REVIEW_STATUS_LABELS/
 * REJECTION_REASON_LABELS/formatDeferredReasonLabel, exactly the same
 * labels the rest of this page already shows, so the timeline can never
 * disagree with them. */
function describeReviewTimelineEvent(event) {
  const reasonLabel = event.rejectionReason
    ? REJECTION_REASON_LABELS[event.rejectionReason] || event.rejectionReason
    : event.deferredReason
      ? formatDeferredReasonLabel(event.deferredReason)
      : null
  const statusLabel = event.status === 'approved_internal' ? 'Approved internally' : REVIEW_STATUS_LABELS[event.status] || event.status
  return {
    title: reasonLabel ? `${statusLabel} — ${reasonLabel}` : statusLabel,
    description: event.note || null,
  }
}

/** Same as describeReviewTimelineEvent above, for one merged-timeline
 * enrichment event. */
function describeEnrichmentTimelineEvent(event) {
  const fieldLabel = ENRICHABLE_FIELD_LABELS[event.fieldName] || event.fieldName
  return {
    title: `${fieldLabel} enriched`,
    description: event.value,
  }
}

export default function ImportInboxPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [runs, setRuns] = useState([])
  const [runsError, setRunsError] = useState(null)
  const [runsLoading, setRunsLoading] = useState(false)
  // Information-hierarchy update (2026-09-06) — "Import runs" moved
  // below the review sections as secondary context and made compact/
  // collapsible; collapsed by default so the daily review task (Review
  // Overview + Review queue) is what a reviewer sees first, without
  // scrolling past import administration. Never hides run info,
  // filtering, or "Show only this run" — only whether the list is
  // currently shown.
  const [importRunsExpanded, setImportRunsExpanded] = useState(false)

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
  // Information-hierarchy update (2026-09-06, later still) — the one
  // remaining candidate list's deferred-reason narrowing. Only ever
  // meaningful alongside reviewStatusFilter === 'deferred' (see the combined
  // filter bar below); applied client-side over the already-fetched
  // `candidates` array (never a new fetch/API param), same pattern as the
  // former triage overview's own client-side filtering.
  const [deferredReasonFilter, setDeferredReasonFilter] = useState('')

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

  // Review Overview's five status tiles (information-hierarchy update,
  // 2026-09-06, later still — was the "Triage overview") — a read-only,
  // always-full-picture count of every candidate's *effective* review
  // status, entirely independent of the one candidate list's own
  // combined filter bar below (search/status/deferred reason/category/
  // duplicate/quality) — those narrow what a reviewer is currently
  // looking at; this always reflects the true counts for the selected
  // run (or every run, if none is selected), so switching a filter can
  // never silently shrink a tile's count. Scoped only by runIdFilter —
  // its own GET call below deliberately omits every other filter param.
  // Never writes anything.
  const [triageCandidates, setTriageCandidates] = useState([])
  const [triageError, setTriageError] = useState(null)
  const [triageLoading, setTriageLoading] = useState(false)

  // MARKET-05C — "Create Restaurant Profile Draft." Entirely independent
  // of the review/enrichment state above: this is a separate, explicit
  // action, never triggered by a review decision itself. Keyed by
  // candidate id, same pattern as the review/enrichment submitting/error
  // state. `profileDraftDuplicateByCandidateId` holds a pending
  // possible-duplicate confirmation prompt (the flagged draft's id, or
  // undefined/null when there is none) — set only from a 409 response,
  // never guessed at client-side; confirming re-submits with that same id
  // echoed back, per docs/api/restaurant-profile-drafts-schema.md's own
  // "Duplicate handling."
  const [profileDraftSubmittingId, setProfileDraftSubmittingId] = useState(null)
  const [profileDraftErrorByCandidateId, setProfileDraftErrorByCandidateId] = useState({})
  const [profileDraftDuplicateByCandidateId, setProfileDraftDuplicateByCandidateId] = useState({})

  // MARKET-05C — "Discard Restaurant Profile Draft" (added 2026-09-06,
  // later still, discard/duplicate follow-up round). `discardPromptOpenId`
  // is the one candidate id (if any) currently showing the confirm form —
  // clicking "Discard..." only ever opens this form, never discards
  // directly; the form's own "Confirm discard" is the actual, separate
  // confirmation action, disabled until a non-empty reason is typed (see
  // canDiscardCandidateDraft's own doc comment — this is a UX gate only,
  // the RPC's own check constraint is what actually enforces the
  // requirement). `discardSuccessByCandidateId` shows the "discarded —
  // a restart is always a new promotion" message once, after success;
  // cleared the moment a new promotion attempt starts for that candidate.
  const [discardPromptOpenId, setDiscardPromptOpenId] = useState(null)
  const [discardNoteByCandidateId, setDiscardNoteByCandidateId] = useState({})
  const [discardSubmittingId, setDiscardSubmittingId] = useState(null)
  const [discardErrorByCandidateId, setDiscardErrorByCandidateId] = useState({})
  const [discardSuccessByCandidateId, setDiscardSuccessByCandidateId] = useState({})

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

  // Review Overview's status tiles — the same read-only `/candidates`
  // GET the one candidate list below already uses, but deliberately
  // scoped by `run_id` only (never search/status/deferred reason/
  // category/duplicate/quality), so the tile counts always reflect the
  // true picture for the selected run, regardless of what the list's
  // own filters are currently set to.
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
        setTriageError(data.error || 'Failed to load the review overview')
        setTriageCandidates([])
        return
      }
      setTriageCandidates(data.candidates || [])
    } catch {
      setTriageError('Failed to load the review overview')
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

  // Review Overview's status tiles — deliberately their own effect,
  // keyed only on runIdFilter, never on the one candidate list's own
  // filters above.
  useEffect(() => {
    if (session) {
      loadTriageCandidates(session.access_token, runIdFilter)
    }
  }, [session, runIdFilter, loadTriageCandidates])

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

  // MARKET-05C — records exactly one promotion via POST
  // /api/internal/v1/profile-drafts. `confirmPossibleDuplicateOfDraftId`
  // is only ever set when the reviewer has explicitly clicked "Promote
  // anyway" after seeing the duplicate warning below — never sent on the
  // first attempt. A 409 with `possible_duplicate: true` is not an error
  // to display; it stores the flagged draft id so the confirm prompt can
  // render, per the API's own documented duplicate-handling contract.
  // Disabled while submitting (see the button below) so a double click
  // can never fire two overlapping requests; the server's own partial
  // unique index physically prevents two active drafts either way.
  async function promoteToProfileDraft(candidateId, confirmPossibleDuplicateOfDraftId) {
    setProfileDraftSubmittingId(candidateId)
    setProfileDraftErrorByCandidateId((prev) => ({ ...prev, [candidateId]: null }))
    // A fresh promotion attempt supersedes any earlier "discarded" success
    // message for this exact candidate — never lingers once staff have
    // moved on to a genuine restart attempt.
    setDiscardSuccessByCandidateId((prev) => ({ ...prev, [candidateId]: false }))
    try {
      const res = await fetch('/api/internal/v1/profile-drafts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          candidate_id: candidateId,
          ...(confirmPossibleDuplicateOfDraftId ? { confirm_possible_duplicate_of_draft_id: confirmPossibleDuplicateOfDraftId } : {}),
        }),
      })
      const data = await res.json()
      if (res.status === 409 && data.possible_duplicate) {
        setProfileDraftDuplicateByCandidateId((prev) => ({ ...prev, [candidateId]: data.possible_duplicate_of_draft_id }))
        return
      }
      if (!res.ok) {
        setProfileDraftErrorByCandidateId((prev) => ({ ...prev, [candidateId]: data.error || 'Creating the draft failed' }))
        return
      }
      setProfileDraftDuplicateByCandidateId((prev) => ({ ...prev, [candidateId]: null }))
      await loadCandidates(session.access_token, {
        runId: runIdFilter,
        category: categoryFilter,
        name: nameFilter,
        duplicate: duplicateFilter,
        quality: qualityFilter,
        reviewStatus: reviewStatusFilter,
      })
    } catch {
      setProfileDraftErrorByCandidateId((prev) => ({ ...prev, [candidateId]: 'Creating the draft failed' }))
    } finally {
      setProfileDraftSubmittingId((current) => (current === candidateId ? null : current))
    }
  }

  // MARKET-05C — discards exactly one active draft via POST
  // /api/internal/v1/profile-drafts/{draftId}/discard. The "Confirm
  // discard" button that calls this is itself the explicit confirmation
  // step (see the disabled condition below, requiring a non-empty
  // reason) — this function never runs from the initial "Discard
  // Restaurant Profile Draft" click, only from that confirm form's own
  // submit. Reloading candidates afterward is what makes the "Create
  // Restaurant Profile Draft" button reappear (profile_draft becomes
  // null) — nothing here ever starts a restart itself; that always
  // requires a separate, later, explicit click on that button.
  async function discardProfileDraft(candidateId, draftId) {
    const note = (discardNoteByCandidateId[candidateId] || '').trim()
    if (!note) return
    setDiscardSubmittingId(candidateId)
    setDiscardErrorByCandidateId((prev) => ({ ...prev, [candidateId]: null }))
    try {
      const res = await fetch(`/api/internal/v1/profile-drafts/${draftId}/discard`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ note }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDiscardErrorByCandidateId((prev) => ({ ...prev, [candidateId]: data.error || 'Discarding the draft failed' }))
        return
      }
      setDiscardPromptOpenId((current) => (current === candidateId ? null : current))
      setDiscardNoteByCandidateId((prev) => ({ ...prev, [candidateId]: '' }))
      setDiscardSuccessByCandidateId((prev) => ({ ...prev, [candidateId]: true }))
      await loadCandidates(session.access_token, {
        runId: runIdFilter,
        category: categoryFilter,
        name: nameFilter,
        duplicate: duplicateFilter,
        quality: qualityFilter,
        reviewStatus: reviewStatusFilter,
      })
    } catch {
      setDiscardErrorByCandidateId((prev) => ({ ...prev, [candidateId]: 'Discarding the draft failed' }))
    } finally {
      setDiscardSubmittingId((current) => (current === candidateId ? null : current))
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
  const filtersActive = Boolean(categoryFilter || nameFilter || duplicateFilter || qualityFilter || reviewStatusFilter || deferredReasonFilter)

  // Information-hierarchy update (2026-09-06, later still) — the one
  // combined filter bar's deferred-reason control narrows the already-
  // fetched `candidates` array client-side (never a new fetch/API param,
  // same pattern the former triage overview used for its own filters).
  // Only meaningful alongside reviewStatusFilter === 'deferred'; the
  // dropdown itself is only rendered in that state, so a stale value
  // left over from a previous status can never silently apply here.
  const visibleCandidates =
    reviewStatusFilter === 'deferred' && deferredReasonFilter
      ? candidates.filter((c) => c.deferred_reason === deferredReasonFilter)
      : candidates

  // Same decision src/lib/importInbox.js's classifyInboxState makes,
  // inlined here rather than re-imported into a 'use client' bundle for
  // one small conditional — the API responses (record_counts, status,
  // candidates.length) are what's actually under test, not this render
  // branch itself.
  let candidateState = 'has-candidates'
  if (runs.length === 0) {
    candidateState = 'no-runs'
  } else if (visibleCandidates.length === 0) {
    candidateState = filtersActive || runIdFilter ? 'no-filter-matches' : 'run-has-no-candidates'
  }
  const showErrorBanner = Boolean(selectedRun && (selectedRun.status === 'failed' || selectedRun.status === 'partial'))

  return (
    <div className="di-page">
      <main className="di-main">
      <div className="di-topbar">
        <h1 className="di-title">Dashboard imported Restaurant Data</h1>
        <button onClick={signOut} className="di-signout">
          Sign out
        </button>
      </div>

      <div className="di-banner di-banner-neutral">
        <span className="di-banner-icon">
          <IconInfo />
        </span>
        <span>
          Raw imported data is never changed. <strong>Save decision</strong> and <strong>Save enrichment</strong> are
          the only two actions here, and each only ever adds a new append-only audit row — never an edit or a delete.
        </span>
      </div>

      {runs.length > 0 && (
        <>
          <h2 className="di-section-title">Review Overview</h2>

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
            <div className="di-summary">
              {(() => {
                const counts = computeReviewStatusCounts(triageCandidates)
                return TRIAGE_SUMMARY_STATUSES.map((status) => {
                  const active = reviewStatusFilter === status
                  const Icon = TRIAGE_STATUS_ICONS[status]
                  return (
                    <button
                      key={status}
                      onClick={() => {
                        setReviewStatusFilter(active ? '' : status)
                        setDeferredReasonFilter('')
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
          )}

          {/* One combined filter bar (information-hierarchy update,
              2026-09-06, later still) — replaces the former two separate,
              overlapping filter bars (a read-only overview search/status/
              deferred-reason bar that only ever fed a now-removed compact
              preview list, and this list's own name/category/duplicate/
              completeness/status bar). Every filter dimension that
              existed before still works exactly as before: category/
              name/duplicate/quality/reviewStatus are unchanged, sent to
              the same GET this list has always used; deferredReasonFilter
              is new *only* in the sense that it now has a list to narrow
              — applied client-side, never a new API param. */}
          <div className="di-filterbar">
            <div className="di-filter-group di-search-wrap">
              <span className="di-filter-label">Search</span>
              <span className="di-search-icon">
                <IconSearch />
              </span>
              <input
                type="text"
                placeholder="Search by business name…"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="di-input"
              />
            </div>
            <div className="di-filter-group">
              <span className="di-filter-label">Status</span>
              <select
                value={reviewStatusFilter}
                onChange={(e) => {
                  setReviewStatusFilter(e.target.value)
                  setDeferredReasonFilter('')
                }}
                className="di-select"
              >
                <option value="">Any review status</option>
                {REVIEW_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            {reviewStatusFilter === 'deferred' && (
              <div className="di-filter-group">
                <span className="di-filter-label">Deferred reason</span>
                <select
                  value={deferredReasonFilter}
                  onChange={(e) => setDeferredReasonFilter(e.target.value)}
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
            {(categoryFilter || nameFilter || duplicateFilter || qualityFilter || reviewStatusFilter || deferredReasonFilter) && (
              <button
                onClick={() => {
                  setCategoryFilter('')
                  setNameFilter('')
                  setDuplicateFilter('')
                  setQualityFilter('')
                  setReviewStatusFilter('')
                  setDeferredReasonFilter('')
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
            <p style={{ color: 'var(--text-muted)' }}>This run produced no imported candidates.</p>
          )}

          {!candidatesLoading && candidateState === 'no-filter-matches' && !candidatesError && (
            <p style={{ color: 'var(--text-muted)' }}>
              No imported candidates match the current filters ({totalBeforeFilters} total before filtering).
            </p>
          )}

          {visibleCandidates.length > 0 && (
            <div style={{ display: 'grid', gap: 12 }}>
              {visibleCandidates.map((c) => {
                const expanded = expandedCandidateId === c.id
                const draft = decisionDraftByCandidateId[c.id] || { status: '', rejectionReason: '', deferredReason: '', note: '' }
                const reviews = reviewsByCandidateId[c.id]
                // Progressive disclosure (2026-09-06, later still): the
                // always-visible row keeps only what's needed to triage —
                // name, category, completeness/missing fields, effective
                // status, deferred reason, contact details. Technical
                // origin, import time, normalization warnings, and
                // enrichment-source annotations move into the expanded
                // detail view below — nothing is dropped, only relocated
                // behind "Details & review".
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
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.normalized_fields?.phone ? `${c.normalized_fields.phone} · ` : ''}
                      {c.normalized_fields?.website || ''}
                    </div>
                    {c.missing_fields && c.missing_fields.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>Missing: {c.missing_fields.join(', ')}</div>
                    )}
                    <button onClick={() => toggleExpand(c.id)} className={`di-link-btn ${expanded ? 'active' : ''}`} style={{ marginTop: 8 }}>
                      {expanded ? 'Hide details' : 'Details & review'}
                    </button>

                    {expanded && (() => {
                      const draftLineage = buildDraftLineageSummary(c)
                      const StatusIcon = TRIAGE_STATUS_ICONS[c.review_status] || IconDocument
                      const statusTone =
                        c.review_status === 'approved_internal'
                          ? 'positive'
                          : c.review_status === 'rejected'
                            ? 'danger'
                            : c.review_status === 'needs_enrichment' || c.review_status === 'deferred'
                              ? 'warning'
                              : 'info'
                      const statusSublabel =
                        c.review_status === 'approved_internal'
                          ? 'Internal only — not published'
                          : c.review_status === 'needs_enrichment'
                            ? 'More data required'
                            : c.review_status === 'deferred'
                              ? formatDeferredReasonLabel(c.deferred_reason) || 'Postponed'
                              : c.review_status === 'rejected'
                                ? 'Removed from the pipeline'
                                : 'Not yet reviewed'
                      const timelineEvents = buildCandidateHistoryTimeline(reviews, enrichmentsByCandidateId[c.id])
                      return (
                        <div className="di-detail">
                          <div className="di-banner di-banner-info" style={{ marginBottom: 12 }}>
                            <span className="di-banner-icon">
                              <IconShield />
                            </span>
                            <span>
                              Read-only until you act: opening this never records anything, and closing it without choosing
                              a status or saving an enrichment leaves no trace.
                            </span>
                          </div>

                          {/* Compact status overview — visual reference:
                              docs/mockups/restaurant-profile-drafts-detail-v1.png. Three
                              always-visible facts about this candidate: its review status,
                              its data completeness, and its Restaurant Profile Draft
                              lineage. Presentation only — every value here already exists
                              on `c` (review_status/quality_status/missing_fields) or comes
                              from buildDraftLineageSummary (pure, src/lib/restaurantProfileDrafts.js);
                              nothing here decides whether an action is allowed. */}
                          <div className="di-status-row">
                            <div className="di-status-item">
                              <span className={`di-status-icon di-status-icon--${statusTone}`}>
                                <StatusIcon />
                              </span>
                              <span className="di-status-body">
                                <span className="di-status-label">{REVIEW_STATUS_LABELS[c.review_status] || c.review_status}</span>
                                <span className="di-status-sublabel">{statusSublabel}</span>
                              </span>
                            </div>
                            <div className="di-status-item">
                              <span className={`di-status-icon di-status-icon--${c.quality_status === 'complete' ? 'positive' : 'warning'}`}>
                                {c.quality_status === 'complete' ? <IconCheck /> : <IconInfo />}
                              </span>
                              <span className="di-status-body">
                                <span className="di-status-label">{c.quality_status === 'complete' ? 'Profile complete' : 'Incomplete'}</span>
                                <span className="di-status-sublabel">
                                  {c.quality_status === 'complete' ? 'All required data present' : `Missing: ${c.missing_fields.join(', ')}`}
                                </span>
                              </span>
                            </div>
                            <div className="di-status-item">
                              <span
                                className={`di-status-icon di-status-icon--${draftLineage.state === 'active' ? 'positive' : 'muted'}`}
                              >
                                {draftLineage.state === 'active' ? <IconCheck /> : <IconDocument />}
                              </span>
                              <span className="di-status-body">
                                <span className="di-status-label">
                                  {draftLineage.state === 'active'
                                    ? 'Profile draft created'
                                    : draftLineage.state === 'discarded'
                                      ? 'Previous draft discarded'
                                      : 'No draft yet'}
                                </span>
                                <span className="di-status-sublabel">
                                  {draftLineage.state === 'active'
                                    ? `Created ${draftLineage.promoted_at}`
                                    : draftLineage.state === 'discarded'
                                      ? 'No longer active'
                                      : 'Not yet created'}
                                </span>
                              </span>
                            </div>
                          </div>

                          {draftLineage.state !== 'none' && (
                            <a href="/internal/profile-drafts" className="di-link-btn" style={{ display: 'inline-block', marginBottom: 14 }}>
                              View audit details
                            </a>
                          )}

                          {c.review_status === 'approved_internal' && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
                              {canDiscardCandidateDraft(c) ? (
                                <div style={{ display: 'grid', gap: 8 }}>
                                  {discardPromptOpenId === c.id ? (
                                    <div style={{ display: 'grid', gap: 6, maxWidth: 420 }}>
                                      <textarea
                                        placeholder="Why are you discarding this draft? (required)"
                                        value={discardNoteByCandidateId[c.id] || ''}
                                        onChange={(e) => setDiscardNoteByCandidateId((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                        rows={2}
                                        style={{ ...selectStyle, resize: 'vertical', fontFamily: 'inherit' }}
                                      />
                                      {discardErrorByCandidateId[c.id] && (
                                        <div style={{ color: 'var(--danger)' }}>{discardErrorByCandidateId[c.id]}</div>
                                      )}
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                          onClick={() => discardProfileDraft(c.id, c.profile_draft.id)}
                                          disabled={discardSubmittingId === c.id || !(discardNoteByCandidateId[c.id] || '').trim()}
                                          className="di-btn-primary"
                                        >
                                          {discardSubmittingId === c.id ? 'Discarding…' : 'Confirm discard'}
                                        </button>
                                        <button
                                          onClick={() => {
                                            setDiscardPromptOpenId(null)
                                            setDiscardNoteByCandidateId((prev) => ({ ...prev, [c.id]: '' }))
                                            setDiscardErrorByCandidateId((prev) => ({ ...prev, [c.id]: null }))
                                          }}
                                          disabled={discardSubmittingId === c.id}
                                          className="di-link-btn"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setDiscardPromptOpenId(c.id)}
                                      className="di-link-btn"
                                      style={{ color: 'var(--danger)' }}
                                    >
                                      Discard Restaurant Profile Draft
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {discardSuccessByCandidateId[c.id] && (
                                    <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
                                      Restaurant Profile Draft discarded. A restart is always a new, explicit promotion
                                      — it will get a new draft id.
                                    </div>
                                  )}
                                  {profileDraftDuplicateByCandidateId[c.id] ? (
                                    <div style={{ display: 'grid', gap: 6 }}>
                                      <div style={{ color: 'var(--warning)' }}>
                                        This looks like a possible duplicate of an already-promoted draft. Promoting
                                        anyway is recorded and flagged for later review — it never merges the two.
                                      </div>
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                          onClick={() => promoteToProfileDraft(c.id, profileDraftDuplicateByCandidateId[c.id])}
                                          disabled={profileDraftSubmittingId === c.id}
                                          className="di-btn-primary"
                                        >
                                          {profileDraftSubmittingId === c.id ? 'Creating…' : 'Promote anyway'}
                                        </button>
                                        <button
                                          onClick={() => setProfileDraftDuplicateByCandidateId((prev) => ({ ...prev, [c.id]: null }))}
                                          disabled={profileDraftSubmittingId === c.id}
                                          className="di-link-btn"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    canPromoteCandidateToProfileDraft(c) && (
                                      <button
                                        onClick={() => promoteToProfileDraft(c.id)}
                                        disabled={profileDraftSubmittingId === c.id}
                                        className="di-btn-primary"
                                      >
                                        {profileDraftSubmittingId === c.id ? 'Creating…' : 'Create Restaurant Profile Draft'}
                                      </button>
                                    )
                                  )}
                                </>
                              )}
                              {profileDraftErrorByCandidateId[c.id] && (
                                <div style={{ color: 'var(--danger)', marginTop: 6 }}>{profileDraftErrorByCandidateId[c.id]}</div>
                              )}
                            </div>
                          )}

                          <div className="di-accordion">
                            <details className="di-accordion-item">
                              <summary className="di-accordion-trigger">
                                <span className="di-accordion-icon">
                                  <IconDocument />
                                </span>
                                <span className="di-accordion-heading">
                                  <span className="di-accordion-title">Review decision</span>
                                  <span className="di-accordion-subtitle">Record or update this candidate's review status.</span>
                                </span>
                                <span className="di-accordion-chevron">
                                  <IconChevronDown />
                                </span>
                              </summary>
                              <div className="di-accordion-body">
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
                              </div>
                            </details>

                            <details className="di-accordion-item">
                              <summary className="di-accordion-trigger">
                                <span className="di-accordion-icon">
                                  <IconPencil />
                                </span>
                                <span className="di-accordion-heading">
                                  <span className="di-accordion-title">Enrichment</span>
                                  <span className="di-accordion-subtitle">Recorded field values and adding new ones.</span>
                                </span>
                                <span className="di-accordion-chevron">
                                  <IconChevronDown />
                                </span>
                              </summary>
                              <div className="di-accordion-body">
                                {ENRICHABLE_FIELDS.some((f) => c.enrichment_sources?.[f]) ? (
                                  <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                                    {ENRICHABLE_FIELDS.filter((f) => c.enrichment_sources?.[f]).map((f) => (
                                      <div key={f} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        <strong>{ENRICHABLE_FIELD_LABELS[f]}</strong>: {c.enrichment_sources[f].value}
                                        <div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 2 }}>
                                          Source: {c.enrichment_sources[f].source_url}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
                                    No manual enrichments recorded yet.
                                  </p>
                                )}

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 8px' }}>
                                  {/* Deliberately not a heading element: this accordion's own
                                      summary ("Enrichment") is already the accessible name for
                                      this section, exactly like the numbered source/field
                                      sub-labels further below in this same form — a heading
                                      here would jump straight from this page's own h2 "Review
                                      Overview" with nothing in between, since no other part of
                                      an accordion body uses a heading either. */}
                                  <div style={{ fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--text-secondary)' }}>
                                    Enrich missing business info
                                  </div>
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
                              </div>
                            </details>

                            <details className="di-accordion-item" open>
                              <summary className="di-accordion-trigger">
                                <span className="di-accordion-icon">
                                  <IconClock />
                                </span>
                                <span className="di-accordion-heading">
                                  <span className="di-accordion-title">History &amp; sources</span>
                                  <span className="di-accordion-subtitle">An overview of what happened, in order.</span>
                                </span>
                                <span className="di-accordion-chevron">
                                  <IconChevronDown />
                                </span>
                              </summary>
                              <div className="di-accordion-body">
                                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 12 }}>
                                  {c.record_locator} · imported {c.retrieved_at}
                                  {c.normalization?.phone && c.normalization.phone.valid === false && (
                                    <div style={{ color: 'var(--warning)', marginTop: 4 }}>Phone format not recognized — shown as entered.</div>
                                  )}
                                </div>
                                {(reviewsLoadingId === c.id || enrichmentsLoadingId === c.id) && (
                                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
                                )}
                                {reviewsErrorId === c.id && (
                                  <p style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load review history.</p>
                                )}
                                {enrichmentsErrorId === c.id && (
                                  <p style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load enrichment history.</p>
                                )}
                                {reviewsLoadingId !== c.id && enrichmentsLoadingId !== c.id && timelineEvents.length === 0 && (
                                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No recorded history yet — currently "new".</p>
                                )}
                                {timelineEvents.length > 0 && (
                                  <div className="di-timeline">
                                    {timelineEvents.map((event) => {
                                      const { title, description } =
                                        event.kind === 'review' ? describeReviewTimelineEvent(event) : describeEnrichmentTimelineEvent(event)
                                      return (
                                        <div key={event.id} className="di-timeline-item">
                                          <div className="di-timeline-date">{formatShortDate(event.at)}</div>
                                          <div className="di-timeline-title">{title}</div>
                                          {description && <div className="di-timeline-desc">{description}</div>}
                                          <div className="di-timeline-meta">
                                            {event.at}
                                            {event.kind === 'enrichment' && event.sourceUrl ? ` · Source: ${event.sourceUrl}` : ''}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </details>
                          </div>

                          <button onClick={() => toggleExpand(c.id)} className="di-link-btn" style={{ marginTop: 16 }}>
                            Back to review queue
                          </button>
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Import runs — secondary context, moved below the two review
          sections and made compact/collapsible (2026-09-06) so the daily
          review task is what a reviewer sees first. Nothing about run
          info, filtering, or "Show only this run" is removed — only
          whether the full list is currently shown; collapsed by
          default. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, marginBottom: 12 }}>
        <h2 className="di-section-title" style={{ margin: 0 }}>
          Import runs{runs.length > 0 ? ` (${runs.length})` : ''}
        </h2>
        {runs.length > 0 && (
          <button onClick={() => setImportRunsExpanded((v) => !v)} className="di-link-btn">
            {importRunsExpanded ? 'Hide' : 'Show'}
            {importRunsExpanded ? <IconChevronDown /> : <IconChevronRight />}
          </button>
        )}
      </div>

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

      {runs.length > 0 && importRunsExpanded && (
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
      </main>
    </div>
  )
}
