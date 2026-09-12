'use client'

// MARKET-05C — Restaurant Profile Drafts overview (added 2026-09-12, the
// next step after the production smoke test — see
// docs/api/restaurant-profile-drafts-schema.md's own "Implementation"
// section for the full design). Read-only by design: lists every draft,
// active and discarded, so staff can see what already exists without
// opening each source candidate individually on /internal/import-inbox.
// It never creates, discards, syncs, or publishes a draft itself — those
// actions still only happen on /internal/import-inbox's existing
// approved_internal detail view, linked from every row below. Same
// authenticated-API pattern as every other internal page
// (src/lib/supabaseBrowser.js for the session,
// /api/internal/v1/profile-drafts for data) — no direct Supabase access
// from the browser. `internal`-only, identical gate to every other
// Data-inbox/profile-drafts surface.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'

const STATUS_LABELS = {
  draft: 'Active',
  discarded: 'Discarded',
}

// Same bound as the discard form's own placeholder guidance — a note can
// be up to 2000 characters (MAX_DISCARD_NOTE_LENGTH in
// src/lib/restaurantProfileDrafts.js); this overview shows only a short
// preview so one long note can never push a row's other facts off
// screen. The full note is always still readable via "Open in Import
// Inbox".
const DISCARD_NOTE_PREVIEW_LENGTH = 140

function formatTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function previewNote(note) {
  if (!note) return null
  if (note.length <= DISCARD_NOTE_PREVIEW_LENGTH) return note
  return `${note.slice(0, DISCARD_NOTE_PREVIEW_LENGTH)}…`
}

export default function ProfileDraftsOverviewPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [drafts, setDrafts] = useState([])
  // True total, from the API — independent of DISCARDED_DRAFT_LIMIT on
  // the route (app/api/internal/v1/profile-drafts/route.js). Every
  // *active* draft is always present in `drafts` in full, but the
  // discarded ones are bounded to the most recent N, so the summary
  // below must never be derived from `drafts.filter(...)` for the
  // discarded count — that would silently understate the real total
  // once discard volume exceeds the route's own limit.
  const [totalDiscarded, setTotalDiscarded] = useState(0)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

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

  const loadDrafts = useCallback(async (token) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/internal/v1/profile-drafts', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load Restaurant Profile Drafts')
        setDrafts([])
        setTotalDiscarded(0)
        return
      }
      setDrafts(data.drafts || [])
      setTotalDiscarded(data.total_discarded || 0)
    } catch {
      setError('Failed to load Restaurant Profile Drafts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) loadDrafts(session.access_token)
  }, [session, loadDrafts])

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
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

  const activeCount = drafts.filter((d) => d.status === 'draft').length
  const discardedShownCount = drafts.filter((d) => d.status === 'discarded').length
  // `drafts` only ever omits *discarded* rows (the route always fetches
  // every active one) — a true mismatch here means the route's own
  // DISCARDED_DRAFT_LIMIT was reached, so the list below is showing the
  // most recent ones, not all of them.
  const discardedTruncated = discardedShownCount < totalDiscarded

  return (
    <div className="di-page">
      <main className="di-main">
        <div className="di-topbar">
          <h1 className="di-title">Restaurant Profile Drafts</h1>
          <button onClick={signOut} className="di-signout">
            Sign out
          </button>
        </div>

        <div className="di-banner di-banner-info" style={{ marginBottom: 16 }}>
          <span>
            Read-only overview — internal only. A Restaurant Profile Draft never appears on a public restaurant
            page automatically, and nothing on this page creates, discards, or syncs one. Promoting a candidate,
            discarding a draft, or reviewing its full detail still only happens on{' '}
            <a href="/internal/import-inbox" style={{ color: 'inherit', textDecoration: 'underline' }}>
              Import Inbox
            </a>
            .
          </span>
        </div>

        {error && (
          <div className="di-banner di-banner-danger" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

        {!loading && drafts.length === 0 && !error && (
          <p style={{ color: 'var(--text-muted)' }}>No Restaurant Profile Drafts yet.</p>
        )}

        {!loading && drafts.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            {activeCount} active · {totalDiscarded} discarded
          </div>
        )}

        {!loading && discardedTruncated && (
          <div className="di-banner di-banner-neutral" style={{ marginBottom: 16 }}>
            <span>
              Showing the {discardedShownCount} most recently discarded of {totalDiscarded} total — older discarded
              drafts still exist and are not deleted, just not listed here.
            </span>
          </div>
        )}

        <div className="di-rows">
          {drafts.map((d) => (
            <div key={d.id} className="di-candidate-card">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}
              >
                <div className="di-row-name" style={{ marginBottom: 0 }}>
                  {d.candidate_name || '(unnamed candidate)'}
                </div>
                <span className={`di-chip ${d.status === 'draft' ? 'di-chip--approved_internal' : 'di-chip--muted'}`}>
                  {STATUS_LABELS[d.status] || d.status}
                </span>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                Created {formatTimestamp(d.promoted_at)}
              </div>

              {d.possible_duplicate_of && (
                <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                  Possibly a duplicate of {d.possible_duplicate_of.candidate_name || 'another draft'} — flagged at
                  creation, never auto-merged.
                </div>
              )}

              {d.restarted_from && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Restarted after an earlier discarded draft for {d.restarted_from.candidate_name || 'this candidate'}.
                </div>
              )}

              {d.status === 'discarded' && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  Discarded {formatTimestamp(d.discarded_at)}
                  {previewNote(d.discard_note) ? ` — "${previewNote(d.discard_note)}"` : ''}
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>Draft ID: {d.id}</div>

              <a href="/internal/import-inbox" className="di-link-btn" style={{ marginTop: 10, display: 'inline-block' }}>
                Open in Import Inbox
              </a>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
