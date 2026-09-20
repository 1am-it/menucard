'use client'

// BE-17/BE-18 — Onboarding Menu: a small, internal-only workflow for
// capturing a restaurant's menu as a reviewable snapshot and recording a
// review decision on it. Same authenticated-API pattern as every other
// internal page (src/lib/supabaseBrowser.js for the session,
// /api/internal/v1/... for all data) — no direct Supabase data access
// from the browser, and every action below is re-authorized server-side
// regardless of what this page shows or hides.
//
// BE-18 fase 1 replaces BE-17's original manual restaurant-ID/menu-
// context/JSON entry form with a URL-driven flow: the reviewer pastes
// only a menu source URL; the server reads it
// (app/api/internal/v1/onboarding-menu/read-url/route.js — HTML with
// reliable schema.org JSON-LD menu data only in this fase, never PDF),
// matches it to an existing restaurant, and this page shows a read-only
// preview per found menu with a checkbox. Only on explicit confirmation
// does this page call the existing, unchanged
// `POST /api/internal/v1/menu-snapshots` — once per selected menu, each
// call fully independent (no all-or-nothing transaction is ever
// claimed). Recording a review decision remains the separate, unchanged
// `editor`-only action it already was.
//
// Every visual pattern below (page shell, banners, cards, chips, the
// accordion, the primary/secondary buttons, the empty state) is reused
// unchanged from app/internal/import-inbox/page.js and app/globals.css —
// no new design system, no new CSS class.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { ALLOWED_DECISIONS, ALLOWED_REJECTION_REASONS } from '@/src/lib/menuSnapshotProposals'

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

// New, task-oriented labels this ticket introduces are Dutch, per
// BE-18's own recorded direction — the fixed module name "Onboarding
// Menu" and the "Beheer" shell name are unchanged.
const MENU_CREATE_STATUS_LABELS = {
  pending: 'Bezig…',
  success: 'Voorstel aangemaakt',
  exists: 'Al voorgesteld',
  error: 'Mislukt',
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

const EMPTY_REVIEW_DRAFT = { decision: '', reason: '', note: '' }

export default function OnboardingMenuPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  // undefined = still resolving roles (never render a "no access" state
  // for this); [] once resolved and genuinely empty. This mirrors
  // app/internal/page.js's own loading pattern exactly — fixes a
  // previously observed, non-blocking issue where this page briefly
  // showed "No internal access for this account" before roles finished
  // loading.
  const [roles, setRoles] = useState(undefined)
  const [snapshots, setSnapshots] = useState(null)
  const [listError, setListError] = useState(null)

  const [sourceUrlInput, setSourceUrlInput] = useState('')
  const [readingUrl, setReadingUrl] = useState(false)
  const [readError, setReadError] = useState(null)
  const [readResult, setReadResult] = useState(null)
  const [chosenRestaurantId, setChosenRestaurantId] = useState('')
  const [selectedMenuSlugs, setSelectedMenuSlugs] = useState({})
  const [menuStatusBySlug, setMenuStatusBySlug] = useState({})
  const [menuErrorBySlug, setMenuErrorBySlug] = useState({})
  const [creatingProposals, setCreatingProposals] = useState(false)

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

  const rolesLoaded = roles !== undefined
  const isInternal = rolesLoaded && roles.some((r) => r.role === 'internal')
  const isEditor = rolesLoaded && roles.some((r) => r.role === 'editor')

  async function readSourceUrl() {
    setReadingUrl(true)
    setReadError(null)
    setReadResult(null)
    setChosenRestaurantId('')
    setSelectedMenuSlugs({})
    setMenuStatusBySlug({})
    setMenuErrorBySlug({})
    try {
      const res = await fetch('/api/internal/v1/onboarding-menu/read-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: sourceUrlInput }),
      })
      const data = await res.json()
      if (!res.ok) {
        setReadError(data.error || 'Het uitlezen van deze URL is mislukt.')
        return
      }
      setReadResult(data)
      if (data.restaurant_match && data.restaurant_match.type === 'exact') {
        setChosenRestaurantId(data.restaurant_match.restaurant_id)
      }
      const initialSelection = {}
      for (const menu of data.menus || []) initialSelection[menu.contextSlug] = true
      setSelectedMenuSlugs(initialSelection)
    } catch {
      setReadError('Het uitlezen van deze URL is mislukt.')
    } finally {
      setReadingUrl(false)
    }
  }

  function isAlreadyProposed(menu) {
    if (!chosenRestaurantId || !snapshots) return false
    const menuContext = `${chosenRestaurantId}-${menu.contextSlug}`
    return snapshots.some((s) => s.restaurant_id === chosenRestaurantId && s.menu_context === menuContext)
  }

  async function submitOneMenu(menu) {
    setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'pending' }))
    setMenuErrorBySlug((prev) => ({ ...prev, [menu.contextSlug]: null }))
    try {
      const res = await fetch('/api/internal/v1/menu-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          restaurant_id: chosenRestaurantId,
          menu_context: `${chosenRestaurantId}-${menu.contextSlug}`,
          source_url: readResult.source_url,
          source_type: 'own_website',
          // Reviewer-facing content-quality confirmation is out of
          // scope for this URL-driven flow (per the product decision:
          // no technical field is ever asked of the reviewer) — 'medium'
          // reflects "read from a structured, machine-readable source,
          // not yet content-verified by a human," matching neither the
          // lowest nor the highest existing fixed level.
          quality_score: 'medium',
          captured_content: { name: menu.name, categories: menu.categories, source: readResult.source_url },
        }),
      })
      const data = await res.json()
      if (res.status === 409) {
        setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'exists' }))
        return
      }
      if (!res.ok) {
        setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'error' }))
        setMenuErrorBySlug((prev) => ({ ...prev, [menu.contextSlug]: data.error || 'Aanmaken mislukt.' }))
        return
      }
      setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'success' }))
    } catch {
      setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'error' }))
      setMenuErrorBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'Aanmaken mislukt.' }))
    }
  }

  async function submitSelectedMenus(menusToSubmit) {
    setCreatingProposals(true)
    // Sequential, not Promise.all: each menu's own result (bezig/gelukt/
    // al bestaand/mislukt) is shown as it resolves, and a menu that
    // fails never blocks or rolls back a menu that already succeeded —
    // there is no all-or-nothing transaction here, by design (each call
    // is its own, fully independent, unchanged snapshot-creation route).
    for (const menu of menusToSubmit) {
      await submitOneMenu(menu)
    }
    setCreatingProposals(false)
    await loadSnapshots(session.access_token)
  }

  // Guards the "Opnieuw proberen" retry path specifically: the main
  // create flow already requires a chosen restaurant before it is ever
  // reachable (see createReady), but a retry on one already-failed menu
  // is a separate, later action — if the restaurant choice has since
  // been cleared, this must say so plainly rather than firing a request
  // that the existing route would reject anyway.
  async function retryOneMenu(menu) {
    if (!chosenRestaurantId) {
      setMenuErrorBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'Kies eerst een restaurant voordat je het opnieuw probeert.' }))
      return
    }
    await submitOneMenu(menu)
    await loadSnapshots(session.access_token)
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

  const foundMenus = (readResult && readResult.menus) || []
  const selectableMenus = foundMenus.filter((m) => !isAlreadyProposed(m))
  const selectedMenus = selectableMenus.filter((m) => selectedMenuSlugs[m.contextSlug])
  const needsRestaurantChoice = readResult && readResult.restaurant_match && readResult.restaurant_match.type !== 'exact'
  const createReady = Boolean(chosenRestaurantId) && selectedMenus.length > 0 && !creatingProposals

  return (
    <div className="di-page">
      <main className="di-main">
        <InternalNav accessToken={session.access_token} roles={rolesLoaded ? roles : []} />

        <div className="di-topbar">
          <h1 className="di-title">Onboarding Menu</h1>
        </div>

        {rolesLoaded && !isInternal && !isEditor && (
          <div className="di-banner di-banner-warning">
            <span className="di-banner-icon"><IconDocument /></span>
            <span>Your account has neither the "internal" nor the "editor" role — menu snapshots cannot be shown.</span>
          </div>
        )}

        {isInternal && (
          <div className="di-candidate-card" style={{ marginBottom: 16 }}>
            <div className="di-row-name">Menu-URL uitlezen</div>
            <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
              <label htmlFor="onboarding-menu-source-url" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Menu-URL
              </label>
              <input
                id="onboarding-menu-source-url"
                placeholder="https://restaurant.nl/menukaart"
                value={sourceUrlInput}
                onChange={(e) => setSourceUrlInput(e.target.value)}
                style={selectStyle}
              />
              {readError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{readError}</div>}
              <button
                type="button"
                className="di-btn-primary"
                disabled={sourceUrlInput.trim().length === 0 || readingUrl}
                onClick={readSourceUrl}
                style={{ justifySelf: 'start' }}
              >
                {readingUrl ? 'Bezig met uitlezen…' : 'Lees URL uit'}
              </button>
            </div>

            {readResult && (
              <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
                <div className="di-banner di-banner-neutral">
                  <span className="di-banner-icon"><IconDocument /></span>
                  <span>Menukaart uitgelezen — {foundMenus.length} menu{foundMenus.length === 1 ? '' : "'s"} gevonden.</span>
                </div>

                {readResult.warning && (
                  <div className="di-banner di-banner-warning">
                    <span className="di-banner-icon"><IconDocument /></span>
                    <span>{readResult.warning}</span>
                  </div>
                )}

                {foundMenus.length > 0 && (
                  <div>
                    <label
                      htmlFor={needsRestaurantChoice ? 'onboarding-menu-restaurant' : undefined}
                      style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}
                    >
                      Restaurant
                    </label>
                    {needsRestaurantChoice ? (
                      <select
                        id="onboarding-menu-restaurant"
                        value={chosenRestaurantId}
                        onChange={(e) => setChosenRestaurantId(e.target.value)}
                        style={{ ...selectStyle, maxWidth: 320 }}
                      >
                        <option value="">Kies een restaurant…</option>
                        {readResult.restaurant_match.candidates.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ fontSize: 13 }}>
                        Gekoppeld aan: <strong>{readResult.restaurant_match.restaurant_name}</strong>
                      </div>
                    )}
                  </div>
                )}

                {foundMenus.map((menu) => {
                  const alreadyExists = isAlreadyProposed(menu)
                  const status = menuStatusBySlug[menu.contextSlug]
                  return (
                    <div key={menu.contextSlug} className="di-candidate-card">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={!alreadyExists && Boolean(selectedMenuSlugs[menu.contextSlug])}
                          disabled={alreadyExists || creatingProposals}
                          onChange={(e) => setSelectedMenuSlugs((prev) => ({ ...prev, [menu.contextSlug]: e.target.checked }))}
                          style={{ marginTop: 4 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                            <div className="di-row-name" style={{ marginBottom: 0 }}>{menu.name || 'Menu zonder naam'}</div>
                            {alreadyExists && <span className="di-chip di-chip--muted">Al voorgesteld</span>}
                            {!alreadyExists && status && (
                              <span className={`di-chip ${status === 'success' ? 'di-chip--approved_internal' : status === 'error' ? 'di-chip--rejected' : 'di-chip--new'}`}>
                                {MENU_CREATE_STATUS_LABELS[status]}
                              </span>
                            )}
                          </div>
                          {menuErrorBySlug[menu.contextSlug] && (
                            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{menuErrorBySlug[menu.contextSlug]}</div>
                          )}
                          <div className="di-accordion" style={{ marginTop: 8 }}>
                            <details className="di-accordion-item">
                              <summary className="di-accordion-trigger">
                                <span className="di-accordion-icon"><IconDocument /></span>
                                <span className="di-accordion-heading">
                                  <span className="di-accordion-title">Preview</span>
                                  <span className="di-accordion-subtitle">{menu.categories.length} categorie{menu.categories.length === 1 ? '' : "ën"}</span>
                                </span>
                                <span className="di-accordion-chevron"><IconChevronDown /></span>
                              </summary>
                              <div className="di-accordion-body">
                                {menu.categories.map((category) => (
                                  <div key={category.name} style={{ marginBottom: 10 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{category.name}</div>
                                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                                      {category.items.map((item, idx) => (
                                        <li key={`${item.name}-${idx}`}>
                                          {item.name}
                                          {item.price ? ` — ${item.price}` : ''}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                          {status === 'error' && (
                            <button
                              type="button"
                              className="di-link-btn"
                              onClick={() => retryOneMenu(menu)}
                              style={{ marginTop: 6 }}
                            >
                              Opnieuw proberen
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}

                {foundMenus.length > 0 && (
                  <div>
                    <button
                      type="button"
                      className="di-btn-primary"
                      disabled={!createReady}
                      onClick={() => submitSelectedMenus(selectedMenus)}
                    >
                      {creatingProposals
                        ? 'Bezig…'
                        : `Maak ${selectedMenus.length} menuvoorstel${selectedMenus.length === 1 ? '' : 'len'} voor review`}
                    </button>
                    {selectedMenus.length > 0 && !creatingProposals && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                        {selectedMenus.length} menuvoorstel{selectedMenus.length === 1 ? '' : 'len'} klaar voor review.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
