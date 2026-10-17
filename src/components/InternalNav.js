'use client'

// PLATFORM-11 (Phase 2/3), restructured for BE-20 — shared, role-aware
// internal navigation shell. Mounted individually on /internal and every
// existing authenticated internal page (never via app/internal/layout.js,
// which stays a Server Component wrapping /internal/login and the
// pre-session activation pages too, where no nav should render). Resolves
// the caller's roles via the existing, unchanged, read-only
// GET /api/internal/v1/me. This component only decides what to *show*; it
// grants no access. Every existing route keeps enforcing its own
// unchanged server-side authorization regardless of what renders here.
//
// Accepts the same optional `roles` prop as before: a caller that already
// resolved its own roles passes them straight through so the page's roles
// and the nav's roles are never two independent fetches racing each
// other; every other page omits the prop and this component fetches its
// own, exactly as before.
//
// Issue #53: the primary navigation is three plain links —
// `Werkvoorraad`, `Nieuwe import`, `Beheer` — resolved from
// src/lib/internalNav.js. Everything else (history, reference data) lives
// on the Beheer overview; Onboarding Restaurant is only offered
// contextually from an import result.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { resolveVisibleModules, groupModulesByPlacement, isCurrentModule, isOwnerRole, hasAnyKnownRole } from '@/src/lib/internalNav'
// The same shared Licht/Donker toggle every public header already uses
// (theme-design-tokens.md: "the same component reused in every page's
// header"; decision 006 + BE-09: an explicit per-browser choice stored as
// `bredaeats_theme`, dark when nothing is stored, no OS-preference
// following). Mounted once here so every internal page gets it — no
// internal-only theme logic.
import ThemeToggle from '@/src/components/ThemeToggle'
import { WordmarkInline } from '@/src/components/Wordmark'

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
  const { primary } = groupModulesByPlacement(modules)
  const showOwnerNote = roles !== undefined && isOwnerRole(roles)
  const noAccess = roles !== undefined && !hasAnyKnownRole(roles)

  return (
    <nav aria-label="Internal navigation" className="internal-nav">
      <a
        href="/internal"
        className="internal-nav-home"
        aria-label="Onze Menukaarten, naar het interne overzicht"
        aria-current={pathname === '/internal' ? 'page' : undefined}
      >
        <WordmarkInline />
      </a>

      {primary.map((m) => (
        <a
          key={m.id}
          href={m.href}
          className="internal-nav-link"
          aria-current={isCurrentModule(pathname, m, primary) ? 'page' : undefined}
        >
          {m.label}
        </a>
      ))}

      {showOwnerNote && <span className="internal-nav-note">Owner tools — not available yet</span>}
      {noAccess && <span className="internal-nav-note">No internal access for this account</span>}
      <div className="internal-nav-theme">
        <ThemeToggle />
      </div>
      <button type="button" onClick={signOut} className="internal-nav-signout">
        Sign out
      </button>
    </nav>
  )
}
