'use client'

// #62 — /internal is no longer a tile page ("De tegelpagina 'Beheer' vervalt als
// bestemming", contract criterion 3). It now sends every signed-in visitor on by
// the one tested landing rule (resolveLandingHref): the visible open-work
// section with the most real open work wins, equal counts keep the contract's
// fixed order, and zero open work lands on Dekking. The login page uses the same
// rule, and the logo reaches it through this route, so there is exactly one
// definition.
//
// Roles and access are unchanged: this page decides nothing itself and grants
// nothing. An account without a usable role keeps the same explicit "no internal
// access" status with sign out as its only action, and an owner-only account
// keeps the existing "nothing to open yet" note instead of being redirected into
// a route that would deny it. Every module route still enforces its own
// unchanged server-side authorization.
//
// Only the existing, read-only GET /api/internal/v1/me and
// GET /api/internal/v1/workqueue-counts are called. A failed counts call never
// produces an invented destination: the pure rule falls back to Dekking.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import {
  resolveVisibleModules,
  resolveLandingHref,
  isOwnerRole,
  hasAnyKnownRole,
} from '@/src/lib/internalNav'

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
  const [status, setStatus] = useState('loading') // loading | redirecting | no-access | owner
  const [error, setError] = useState(null)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/internal/login')
      else setSession(data.session)
    })
  }, [router])

  useEffect(() => {
    if (!session) return undefined
    let cancelled = false
    const token = session.access_token

    async function resolve() {
      setError(null)
      try {
        const meRes = await fetch('/api/internal/v1/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const me = await meRes.json().catch(() => ({}))
        if (cancelled) return
        if (!meRes.ok) {
          setError(me.error || 'Failed to resolve your internal access')
          return
        }
        const roles = Array.isArray(me.roles) ? me.roles : []
        if (resolveVisibleModules(roles).length === 0) {
          setStatus(hasAnyKnownRole(roles) && isOwnerRole(roles) ? 'owner' : 'no-access')
          return
        }

        let counts = null
        try {
          const countsRes = await fetch('/api/internal/v1/workqueue-counts', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          })
          const body = await countsRes.json().catch(() => ({}))
          if (countsRes.ok && body && body.counts && typeof body.counts === 'object') counts = body.counts
        } catch {
          counts = null
        }
        if (cancelled) return

        const href = resolveLandingHref(roles, counts)
        if (!href) {
          setStatus(hasAnyKnownRole(roles) ? 'owner' : 'no-access')
          return
        }
        setStatus('redirecting')
        router.replace(href)
      } catch {
        if (!cancelled) setError('Failed to resolve your internal access')
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
  }, [session, router])

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }


  const signOutButton = (
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
      Uitloggen
    </button>
  )

  if (session === undefined || status === 'loading' || status === 'redirecting') {
    return (
      <main className="cov-dashboard" style={{ ...SHELL_STYLE, color: 'var(--text-secondary)' }} role="status">
        Laden…
      </main>
    )
  }

  if (error) {
    return (
      <main className="cov-dashboard" style={SHELL_STYLE}>
        <div
          role="alert"
          style={{
            marginTop: 20,
            padding: 18,
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
        {signOutButton}
      </main>
    )
  }

  if (status === 'owner') {
    return (
      <main className="cov-dashboard" style={SHELL_STYLE}>
        <div
          style={{
            marginTop: 20,
            padding: 18,
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Beheerdersfuncties</div>
          <p style={{ margin: 0, fontSize: 13 }}>Nog niets te openen — er is nog geen interne pagina voor de beheerder.</p>
        </div>
        <div style={{ marginTop: 16 }}>{signOutButton}</div>
      </main>
    )
  }

  return (
    <main className="cov-dashboard" style={SHELL_STYLE}>
      <div
        role="status"
        style={{
          marginTop: 20,
          padding: 20,
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
        }}
      >
        <strong style={{ color: 'var(--text-primary)' }}>Dit account heeft geen interne toegang.</strong>
        <p style={{ marginTop: 8, marginBottom: 16, fontSize: 14, color: 'var(--text-secondary)' }}>
          Je account heeft geen interne rol. Denk je dat dit niet klopt? Neem contact op met een beheerder —
          verder is er vanaf hier niets te doen.
        </p>
        {signOutButton}
      </div>
    </main>
  )
}
