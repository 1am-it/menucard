'use client'

// PLATFORM-11 (Phase 2/3) — shared, role-aware internal navigation shell.
// Mounted individually on /internal and every existing authenticated
// internal page (never via app/internal/layout.js, which stays a Server
// Component wrapping /internal/login and the pre-session activation pages
// too, where no nav should render). Resolves the caller's roles via the
// new, minimal, read-only GET /api/internal/v1/me — itself just a thin
// reshaping of authenticateInternalRequest, the exact same check every
// other internal route already uses. This component only decides what to
// *show*; it grants no access. Every existing route keeps enforcing its
// own unchanged server-side authorization regardless of what renders here.
//
// Accepts an optional `roles` prop: app/internal/page.js already resolves
// its own roles (for the module cards and the no-access status) and
// passes them straight through here, so the page's roles and the nav's
// roles are never two independent fetches racing each other — every other
// page (which has no reason to resolve roles itself) omits the prop and
// this component fetches its own, exactly as before.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { resolveVisibleModules, isOwnerRole, hasAnyKnownRole } from '@/src/lib/internalNav'

export default function InternalNav({ accessToken, roles: rolesProp }) {
  const pathname = usePathname()
  const router = useRouter()
  const [rolesState, setRolesState] = useState(undefined) // undefined = loading, [] once resolved (possibly empty)

  useEffect(() => {
    if (rolesProp !== undefined) return // the caller already resolved roles — never fetch a second time
    let cancelled = false
    async function loadRoles() {
      try {
        const res = await fetch('/api/internal/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const data = await res.json()
        if (cancelled) return
        setRolesState(res.ok ? data.roles || [] : [])
      } catch {
        if (!cancelled) setRolesState([])
      }
    }
    if (accessToken) loadRoles()
    return () => {
      cancelled = true
    }
  }, [accessToken, rolesProp])

  const roles = rolesProp !== undefined ? rolesProp : rolesState

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  const modules = roles === undefined ? [] : resolveVisibleModules(roles)
  const showOwnerNote = roles !== undefined && isOwnerRole(roles)
  const noAccess = roles !== undefined && !hasAnyKnownRole(roles)

  return (
    <nav aria-label="Internal navigation" className="internal-nav">
      <a
        href="/internal"
        className="internal-nav-home"
        aria-current={pathname === '/internal' ? 'page' : undefined}
      >
        Internal
      </a>
      {modules.map((m) => (
        <a
          key={m.id}
          href={m.href}
          className="internal-nav-link"
          aria-current={pathname === m.href ? 'page' : undefined}
        >
          {m.label}
        </a>
      ))}
      {showOwnerNote && <span className="internal-nav-note">Owner tools — not available yet</span>}
      {noAccess && <span className="internal-nav-note">No internal access for this account</span>}
      <button type="button" onClick={signOut} className="internal-nav-signout">
        Sign out
      </button>
    </nav>
  )
}
