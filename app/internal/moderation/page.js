'use client'

// PLATFORM-06 — moderation queue UI. Reads the browser's Supabase Auth
// session (login-only client, src/lib/supabaseBrowser.js) purely to get an
// access_token, then calls /api/internal/v1/moderation/... with it —
// exactly the same authenticated-API pattern as every other internal
// route. No direct Supabase data access from the browser.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'

export default function ModerationQueuePage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [items, setItems] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)

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

  const loadQueue = useCallback(async (token) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/internal/v1/moderation/pending', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load queue')
        setItems([])
        return
      }
      setItems(data.items || [])
    } catch {
      setError('Failed to load queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) loadQueue(session.access_token)
  }, [session, loadQueue])

  async function decide(pendingId, action) {
    setBusyId(pendingId)
    setError(null)
    try {
      const res = await fetch(`/api/internal/v1/moderation/${pendingId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: action === 'reject' ? JSON.stringify({}) : undefined,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `Failed to ${action}`)
        return
      }
      await loadQueue(session.access_token)
    } finally {
      setBusyId(null)
    }
  }

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  if (session === undefined) {
    return <main style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>Loading…</main>
  }

  return (
    <main
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '32px 20px',
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Moderation queue</h1>
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

      {error && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

      {!loading && items.length === 0 && !error && <p style={{ color: 'var(--text-muted)' }}>No pending changes.</p>}

      <div style={{ display: 'grid', gap: 14 }}>
        {items.map(({ pending, current }) => (
          <div
            key={pending.id}
            style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg-card)' }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Restaurant {pending.restaurant_id} · {pending.field_name}
              {pending.field_ref ? ` · ${pending.field_ref}` : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Current ({current?.source ?? 'none'})</div>
                <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>
                  {current ? JSON.stringify(current.value, null, 2) : '—'}
                </pre>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Proposed ({pending.proposed_source})</div>
                <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>
                  {JSON.stringify(pending.proposed_value, null, 2)}
                </pre>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => decide(pending.id, 'approve')}
                disabled={busyId === pending.id}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--green)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Approve
              </button>
              <button
                onClick={() => decide(pending.id, 'reject')}
                disabled={busyId === pending.id}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
