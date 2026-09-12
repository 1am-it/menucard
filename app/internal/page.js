'use client'

// PLATFORM-11 (Phase 2) — the single, role-aware /internal home page every
// successful internal sign-in now lands on (see app/internal/login/page.js
// and planning/specs/tickets/platform-11-role-aware-internal-navigation-home.md's
// "Design decision — login destination and role-based access").
//
// Session-gated only — reaching this page requires nothing beyond a
// signed-in session, exactly like every other internal page (same
// getSupabaseBrowser().auth.getSession() check, same redirect to
// /internal/login otherwise). It never itself decides which
// `staff_roles` a visitor needs; it resolves the session's actual roles
// via the new, minimal, read-only GET /api/internal/v1/me (a thin
// reshaping of authenticateInternalRequest, the same check every other
// internal route already uses) and shows only the module links those
// roles already unlock — the union of every role's sections for a
// multi-role account. An account with no usable role (zero staff_roles
// rows, or defensively only unrecognized values) sees an explicit "no
// internal access" status with sign out as its only action — never an
// automatic redirect into any module. `owner` never gets an invented
// destination while no owner-gated internal page exists.
//
// This page grants no access itself — every existing module route keeps
// enforcing its own unchanged server-side role check regardless of what
// renders here.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { resolveVisibleModules, isOwnerRole, hasAnyKnownRole } from '@/src/lib/internalNav'

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

export default function InternalHomePage() {
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
    return <main style={{ ...SHELL_STYLE, color: 'var(--text-muted)' }}>Loading…</main>
  }

  const modules = resolveVisibleModules(roles)
  const showOwnerSection = isOwnerRole(roles)
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
        <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>Internal</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
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
            <span style={{ width: 18, height: 18, display: 'flex', flexShrink: 0, color: 'var(--text-muted)', marginTop: 1 }}>
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
              {m.label}
              <span style={{ width: 16, height: 16, display: 'flex', flexShrink: 0, color: 'var(--text-muted)' }}>
                <IconArrowRight />
              </span>
            </a>
          ))}

          {showOwnerSection && (
            <div
              style={{
                padding: 18,
                borderRadius: 'var(--radius-lg)',
                border: '1px dashed var(--border)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Owner tools</div>
              <p style={{ margin: 0, fontSize: 13 }}>
                Nothing to open yet — no owner-facing internal page exists.
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
