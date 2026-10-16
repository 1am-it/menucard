'use client'

// Werkvoorraad (issue #53) — the role-aware landing page for the daily,
// concrete human actions: the modules with placement 'work' in
// src/lib/internalNav.js, each linking to its existing route. Nieuwe import
// is its own primary navigation item and is not repeated here; Beheer holds
// overview, history and reference data.
//
// Session-gated only, like /internal: it resolves the session's roles via
// the read-only GET /api/internal/v1/me and only decides what to show.
// Every linked route keeps its own unchanged server-side authorization.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { resolveVisibleModules, groupModulesByPlacement, hasAnyKnownRole } from '@/src/lib/internalNav'

function IconArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

const SHELL_STYLE = {
  maxWidth: 960,
  margin: '0 auto',
  padding: '0 20px 64px',
  fontFamily: 'system-ui, sans-serif',
  color: 'var(--text-primary)',
  background: 'var(--bg)',
  minHeight: '100vh',
}

export default function WerkvoorraadPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [roles, setRoles] = useState(undefined) // undefined = loading, [] once resolved (possibly empty)
  const [error, setError] = useState(null)

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
    setError(null)
    try {
      const res = await fetch('/api/internal/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to resolve your internal access')
        setRoles([])
        return
      }
      setRoles(data.roles || [])
    } catch {
      setError('Failed to resolve your internal access')
      setRoles([])
    }
  }, [])

  useEffect(() => {
    if (session) loadRoles(session.access_token)
  }, [session, loadRoles])

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  if (session === undefined || roles === undefined) {
    return <main style={{ ...SHELL_STYLE, color: 'var(--text-secondary)' }}>Loading…</main>
  }

  // Beheer lists overview, history and reference modules only; the daily
  // actions live in Werkvoorraad and Nieuwe import (top navigation).
  const modules = groupModulesByPlacement(resolveVisibleModules(roles)).work
  const noAccess = !hasAnyKnownRole(roles)
  // No modules and no nav destinations exist for this account, so the
  // status box below is the page's only navigation-adjacent content —
  // it carries the page's one sign-out action itself, and the shared nav
  // (which would otherwise duplicate it) is not rendered alongside it.
  const showNoAccessStatus = noAccess && !error
  const roleLabels = [...new Set(roles.map((r) => r.role))]
  const email = session?.user?.email || null

  return (
    <main style={SHELL_STYLE}>
      {!showNoAccessStatus && <InternalNav accessToken={session.access_token} roles={roles} />}

      <div style={{ paddingTop: 28, marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>Werkvoorraad</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
          {email ? `Signed in as ${email}` : 'Signed in'}
          {roleLabels.length > 0 ? ` · roles: ${roleLabels.join(', ')}` : ''}
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: 14,
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--danger-border)',
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            marginBottom: 20,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {showNoAccessStatus && (
        <div
          role="status"
          style={{
            padding: 20,
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ width: 18, height: 18, display: 'flex', flexShrink: 0, color: 'var(--text-secondary)', marginTop: 1 }}>
              <IconLock />
            </span>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>No internal access for this account.</strong>
              <p style={{ marginTop: 8, marginBottom: 16, fontSize: 14, color: 'var(--text-secondary)' }}>
                Your account has no internal role assigned. If you believe this is a mistake, contact an
                administrator — there is nothing else to do from here.
              </p>
              <button
                type="button"
                onClick={signOut}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {!noAccess && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          {modules.map((m) => (
            <a
              key={m.id}
              href={m.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: 18,
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                {m.label}
                {m.subtitle && (
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>{m.subtitle}</span>
                )}
              </span>
              <span style={{ width: 16, height: 16, display: 'flex', flexShrink: 0, color: 'var(--text-secondary)' }}>
                <IconArrowRight />
              </span>
            </a>
          ))}

          {modules.length === 0 && (
            <p role="status" style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
              Geen werk beschikbaar voor dit account.
            </p>
          )}
        </div>
      )}
    </main>
  )
}
