'use client'

// BE-17 — Onboarding Menu: a small, internal-only workflow for capturing
// a restaurant's menu as a reviewable snapshot and recording a review
// decision on it. Same authenticated-API pattern as every other internal
// page (src/lib/supabaseBrowser.js for the session,
// /api/internal/v1/menu-snapshots for all data) — no direct Supabase
// data access from the browser, and every action below is re-authorized
// server-side regardless of what this page shows or hides.
//
// Deliberately a calm workflow, not an analytics dashboard: no filter
// bar, no summary tiles, no pagination — this pilot's own real data
// volume (one restaurant, one menu) does not need any of that yet. Every
// visual pattern below (page shell, banners, cards, chips, the
// accordion, the primary/secondary buttons, the empty state) is reused
// unchanged from app/internal/import-inbox/page.js and app/globals.css —
// no new design system, no new CSS class.
//
// Creating a proposal and recording a review decision are two separate
// actions against two separate routes (POST /api/internal/v1/menu-snapshots
// and POST /api/internal/v1/menu-snapshots/{id}/reviews), each with its
// own server-side role check (`internal` to propose, `editor` to
// review) — never combined into one action, even though the same
// account may hold both roles in phase 1.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import {
  ALLOWED_SOURCE_TYPES,
  ALLOWED_QUALITY_SCORES,
  ALLOWED_DECISIONS,
  ALLOWED_REJECTION_REASONS,
} from '@/src/lib/menuSnapshotProposals'

const selectStyle = {
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: 13,
}

const STATUS_LABELS = {
  unreviewed: 'Not yet reviewed',
  needs_review: 'Needs review',
  approved_internal: 'Approved (internal only)',
  rejected: 'Rejected',
  deferred: 'Deferred',
}

// Reuses only existing chip color modifiers from app/globals.css —
// `approved_internal`/`rejected`/`deferred` share their exact color
// meaning with the import-candidate pipeline; `unreviewed`/`needs_review`
// map onto the closest existing neutral/warning modifiers rather than a
// new one.
const STATUS_CHIP_CLASS = {
  unreviewed: 'di-chip--new',
  needs_review: 'di-chip--needs_enrichment',
  approved_internal: 'di-chip--approved_internal',
  rejected: 'di-chip--rejected',
  deferred: 'di-chip--deferred',
}

const REJECTION_REASON_LABELS = {
  source_unreliable: 'Source unreliable',
  content_mismatch: 'Content mismatch',
  duplicate_snapshot: 'Duplicate snapshot',
  insufficient_content: 'Insufficient content',
  other: 'Other',
}

function IconChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function IconDocument() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

const EMPTY_PROPOSAL_DRAFT = {
  restaurantId: '',
  menuContext: '',
  sourceUrl: '',
  sourceType: '',
  qualityScore: '',
  capturedContent: '',
}

const EMPTY_REVIEW_DRAFT = { decision: '', reason: '', note: '' }

export default function OnboardingMenuPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [roles, setRoles] = useState([])
  const [snapshots, setSnapshots] = useState(null)
  const [listError, setListError] = useState(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [proposalDraft, setProposalDraft] = useState(EMPTY_PROPOSAL_DRAFT)
  const [proposalError, setProposalError] = useState(null)
  const [proposalSubmitting, setProposalSubmitting] = useState(false)

  const [reviewDraftBySnapshotId, setReviewDraftBySnapshotId] = useState({})
  const [reviewErrorBySnapshotId, setReviewErrorBySnapshotId] = useState({})
  const [reviewSubmittingId, setReviewSubmittingId] = useState(null)

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

  const loadRoles = useCallback(async (token) => {
    try {
      const res = await fetch('/api/internal/v1/me', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setRoles(res.ok ? data.roles || [] : [])
    } catch {
      setRoles([])
    }
  }, [])

  const loadSnapshots = useCallback(async (token) => {
    setListError(null)
    try {
      const res = await fetch('/api/internal/v1/menu-snapshots', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (!res.ok) {
        setListError(data.error || 'Failed to load menu snapshots')
        setSnapshots([])
        return
      }
      setSnapshots(data.snapshots || [])
    } catch {
      setListError('Failed to load menu snapshots')
      setSnapshots([])
    }
  }, [])

  useEffect(() => {
    if (session) {
      loadRoles(session.access_token)
      loadSnapshots(session.access_token)
    }
  }, [session, loadRoles, loadSnapshots])

  const isInternal = roles.some((r) => r.role === 'internal')
  const isEditor = roles.some((r) => r.role === 'editor')

  async function submitProposal() {
    setProposalSubmitting(true)
    setProposalError(null)
    try {
      const res = await fetch('/api/internal/v1/menu-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          restaurant_id: proposalDraft.restaurantId,
          menu_context: proposalDraft.menuContext,
          source_url: proposalDraft.sourceUrl,
          source_type: proposalDraft.sourceType,
          quality_score: proposalDraft.qualityScore,
          captured_content: proposalDraft.capturedContent,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setProposalError(data.error || 'Failed to create the menu snapshot')
        return
      }
      setProposalDraft(EMPTY_PROPOSAL_DRAFT)
      setShowCreateForm(false)
      await loadSnapshots(session.access_token)
    } catch {
      setProposalError('Failed to create the menu snapshot')
    } finally {
      setProposalSubmitting(false)
    }
  }

  function updateReviewDraft(snapshotId, patch) {
    setReviewDraftBySnapshotId((prev) => ({ ...prev, [snapshotId]: { ...(prev[snapshotId] || EMPTY_REVIEW_DRAFT), ...patch } }))
  }

  async function submitReview(snapshotId) {
    const draft = reviewDraftBySnapshotId[snapshotId] || EMPTY_REVIEW_DRAFT
    setReviewSubmittingId(snapshotId)
    setReviewErrorBySnapshotId((prev) => ({ ...prev, [snapshotId]: null }))
    try {
      const res = await fetch(`/api/internal/v1/menu-snapshots/${snapshotId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ decision: draft.decision, reason: draft.reason || undefined, note: draft.note || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setReviewErrorBySnapshotId((prev) => ({ ...prev, [snapshotId]: data.error || 'Failed to record the review decision' }))
        return
      }
      setReviewDraftBySnapshotId((prev) => ({ ...prev, [snapshotId]: EMPTY_REVIEW_DRAFT }))
      await loadSnapshots(session.access_token)
    } catch {
      setReviewErrorBySnapshotId((prev) => ({ ...prev, [snapshotId]: 'Failed to record the review decision' }))
    } finally {
      setReviewSubmittingId(null)
    }
  }

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main" style={{ color: 'var(--text-muted)' }}>Loading…</main>
      </div>
    )
  }

  const proposalReady =
    proposalDraft.restaurantId.trim().length > 0 &&
    proposalDraft.menuContext.trim().length > 0 &&
    proposalDraft.sourceUrl.trim().length > 0 &&
    ALLOWED_SOURCE_TYPES.includes(proposalDraft.sourceType) &&
    ALLOWED_QUALITY_SCORES.includes(proposalDraft.qualityScore) &&
    proposalDraft.capturedContent.trim().length > 0

  return (
    <div className="di-page">
      <main className="di-main">
        <InternalNav accessToken={session.access_token} roles={roles} />

        <div className="di-topbar">
          <h1 className="di-title">Onboarding Menu</h1>
          {isInternal && (
            <button type="button" className="di-btn-primary" onClick={() => setShowCreateForm((v) => !v)}>
              {showCreateForm ? 'Cancel' : 'New proposal'}
            </button>
          )}
        </div>

        {!isInternal && !isEditor && (
          <div className="di-banner di-banner-warning">
            <span className="di-banner-icon"><IconDocument /></span>
            <span>Your account has neither the "internal" nor the "editor" role — menu snapshots cannot be shown.</span>
          </div>
        )}

        {isInternal && showCreateForm && (
          <div className="di-candidate-card" style={{ marginBottom: 16 }}>
            <div className="di-row-name">New menu snapshot proposal</div>
            <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
              <input
                placeholder="Restaurant id (e.g. 23)"
                value={proposalDraft.restaurantId}
                onChange={(e) => setProposalDraft((p) => ({ ...p, restaurantId: e.target.value }))}
                style={selectStyle}
              />
              <input
                placeholder="Menu context (e.g. 23-borrel)"
                value={proposalDraft.menuContext}
                onChange={(e) => setProposalDraft((p) => ({ ...p, menuContext: e.target.value }))}
                style={selectStyle}
              />
              <input
                placeholder="Source URL (https://…)"
                value={proposalDraft.sourceUrl}
                onChange={(e) => setProposalDraft((p) => ({ ...p, sourceUrl: e.target.value }))}
                style={selectStyle}
              />
              <select
                value={proposalDraft.sourceType}
                onChange={(e) => setProposalDraft((p) => ({ ...p, sourceType: e.target.value }))}
                style={selectStyle}
              >
                <option value="">Choose a source type…</option>
                {ALLOWED_SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select
                value={proposalDraft.qualityScore}
                onChange={(e) => setProposalDraft((p) => ({ ...p, qualityScore: e.target.value }))}
                style={selectStyle}
              >
                <option value="">Choose a quality score…</option>
                {ALLOWED_QUALITY_SCORES.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
              <textarea
                placeholder='Captured content as JSON, e.g. {"categories":[...]}'
                value={proposalDraft.capturedContent}
                onChange={(e) => setProposalDraft((p) => ({ ...p, capturedContent: e.target.value }))}
                rows={6}
                style={{ ...selectStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
              {proposalError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{proposalError}</div>}
              <button
                type="button"
                className="di-btn-primary"
                disabled={!proposalReady || proposalSubmitting}
                onClick={submitProposal}
                style={{ justifySelf: 'start' }}
              >
                {proposalSubmitting ? 'Saving…' : 'Create proposal'}
              </button>
            </div>
          </div>
        )}

        {listError && (
          <div className="di-banner di-banner-danger">
            <span className="di-banner-icon"><IconDocument /></span>
            <span>{listError}</span>
          </div>
        )}

        {snapshots && snapshots.length === 0 && !listError && (
          <div className="di-empty">No menu snapshots yet.</div>
        )}

        {snapshots && snapshots.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {snapshots.map((s) => {
              const draft = reviewDraftBySnapshotId[s.id] || EMPTY_REVIEW_DRAFT
              const reviewReady = ALLOWED_DECISIONS.includes(draft.decision) && (draft.decision !== 'rejected' || Boolean(draft.reason))
              return (
                <div key={s.id} className="di-candidate-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div className="di-row-name" style={{ marginBottom: 0 }}>
                      {s.restaurant_id} — {s.menu_context}
                    </div>
                    <span className={`di-chip ${STATUS_CHIP_CLASS[s.effective_status] || 'di-chip--muted'}`}>
                      {STATUS_LABELS[s.effective_status] || s.effective_status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {s.source_type} · quality: {s.quality_score} · version {s.version}
                  </div>

                  {isEditor && (
                    <div className="di-accordion">
                      <details className="di-accordion-item">
                        <summary className="di-accordion-trigger">
                          <span className="di-accordion-icon"><IconDocument /></span>
                          <span className="di-accordion-heading">
                            <span className="di-accordion-title">Review decision</span>
                            <span className="di-accordion-subtitle">Record a new decision for this snapshot.</span>
                          </span>
                          <span className="di-accordion-chevron"><IconChevronDown /></span>
                        </summary>
                        <div className="di-accordion-body">
                          <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
                            <select
                              value={draft.decision}
                              onChange={(e) => updateReviewDraft(s.id, { decision: e.target.value, reason: '' })}
                              style={selectStyle}
                            >
                              <option value="">Choose a decision…</option>
                              {ALLOWED_DECISIONS.map((d) => (
                                <option key={d} value={d}>{STATUS_LABELS[d] || d}</option>
                              ))}
                            </select>
                            {draft.decision === 'rejected' && (
                              <select
                                value={draft.reason}
                                onChange={(e) => updateReviewDraft(s.id, { reason: e.target.value })}
                                style={selectStyle}
                              >
                                <option value="">Choose a reason…</option>
                                {ALLOWED_REJECTION_REASONS.map((r) => (
                                  <option key={r} value={r}>{REJECTION_REASON_LABELS[r]}</option>
                                ))}
                              </select>
                            )}
                            <textarea
                              placeholder="Optional internal note…"
                              value={draft.note}
                              onChange={(e) => updateReviewDraft(s.id, { note: e.target.value })}
                              rows={2}
                              style={{ ...selectStyle, resize: 'vertical', fontFamily: 'inherit' }}
                            />
                            {reviewErrorBySnapshotId[s.id] && (
                              <div style={{ fontSize: 12, color: 'var(--danger)' }}>{reviewErrorBySnapshotId[s.id]}</div>
                            )}
                            <button
                              type="button"
                              className="di-btn-primary"
                              disabled={!reviewReady || reviewSubmittingId === s.id}
                              onClick={() => submitReview(s.id)}
                              style={{ justifySelf: 'start' }}
                            >
                              {reviewSubmittingId === s.id ? 'Saving…' : 'Save decision'}
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
