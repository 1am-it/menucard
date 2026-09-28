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
// BE-20's own restructuring: `Dekkingsoverzicht`/`Onboarding Restaurant`
// stay inline; `Beheer`/`Nieuwe aanleveringen`/`Profielconcepten`/
// `Beoordelen` move into a compact `Werkvoorraad` disclosure — a native
// `<details>/<summary>` element, not a custom-built menu widget: this
// gives click/Enter/Space toggling and basic focus handling for free,
// with no new dependency, matching this project's own existing
// `.di-accordion` precedent (app/globals.css). Escape-to-close and
// click-outside-to-close are the only behavior this file adds on top of
// the native element. Never hover-only — opening/closing is always an
// explicit click or key press.

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { resolveVisibleModules, groupModulesByPlacement, isOwnerRole, hasAnyKnownRole } from '@/src/lib/internalNav'

function IconWordmark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 2v7a2 2 0 0 0 2 2v11" />
      <path d="M6 2v4" />
      <path d="M9 2v4" />
      <path d="M18 2c-2 0-3 2-3 5s1 4 3 4v11" />
    </svg>
  )
}

function IconWorkqueue() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2" />
      <path d="M3 8l2 9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2l2-9" />
      <path d="M3 8h18" />
    </svg>
  )
}

/** One icon per workqueue module id — a fixed, closed lookup, never a
 * default/fallback glyph, so a module added later without a matching
 * entry here fails visibly (no icon rendered) rather than showing a
 * misleading placeholder. */
const WORKQUEUE_ICONS = {
  manage: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  'import-inbox': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  ),
  'profile-drafts': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  moderation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
}

export default function InternalNav({ accessToken, roles: rolesProp }) {
  const pathname = usePathname()
  const router = useRouter()
  const [rolesState, setRolesState] = useState(undefined) // undefined = loading, [] once resolved (possibly empty)
  const workqueueRef = useRef(null)

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

  // Close the Werkvoorraad panel on Escape (native <details> has no
  // built-in Escape handling) and on a click outside it — both restore
  // focus to the trigger itself, never leaving it stranded, per
  // 014-navigation-and-orientation-standard.md's own item 7. Native
  // click/Enter/Space toggling on <summary> needs no code here at all.
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      const details = workqueueRef.current
      if (!details || !details.open) return
      details.open = false
      const summary = details.querySelector('summary')
      if (summary) summary.focus()
    }
    function handleClickOutside(event) {
      const details = workqueueRef.current
      if (!details || !details.open) return
      if (!details.contains(event.target)) details.open = false
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('click', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [])

  // A client-side navigation from inside the panel should not leave it
  // stuck open on the next page.
  useEffect(() => {
    if (workqueueRef.current) workqueueRef.current.open = false
  }, [pathname])

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  const modules = roles === undefined ? [] : resolveVisibleModules(roles)
  const { primary, workqueue } = groupModulesByPlacement(modules)
  const showOwnerNote = roles !== undefined && isOwnerRole(roles)
  const noAccess = roles !== undefined && !hasAnyKnownRole(roles)

  return (
    <nav aria-label="Internal navigation" className="internal-nav">
      <a
        href="/internal"
        className="internal-nav-home"
        aria-current={pathname === '/internal' ? 'page' : undefined}
      >
        <IconWordmark />
        <span>BredaEats</span>
      </a>

      {primary.map((m) => (
        <a
          key={m.id}
          href={m.href}
          className="internal-nav-link"
          aria-current={pathname === m.href ? 'page' : undefined}
        >
          {m.label}
        </a>
      ))}

      {workqueue.length > 0 && (
        <details ref={workqueueRef} className="internal-nav-workqueue">
          <summary className="internal-nav-workqueue-trigger" aria-label="Werkvoorraad">
            <IconWorkqueue />
          </summary>
          <div className="internal-nav-workqueue-panel" role="menu">
            <div className="internal-nav-workqueue-heading">Werkvoorraad</div>
            {workqueue.map((m) => (
              <a
                key={m.id}
                href={m.href}
                role="menuitem"
                className="internal-nav-workqueue-item"
                aria-current={pathname === m.href ? 'page' : undefined}
              >
                <span className="internal-nav-workqueue-item-icon">{WORKQUEUE_ICONS[m.id]}</span>
                <span className="internal-nav-workqueue-item-text">
                  <span className="internal-nav-workqueue-item-label">{m.label}</span>
                  {m.subtitle && <span className="internal-nav-workqueue-item-subtitle">{m.subtitle}</span>}
                </span>
              </a>
            ))}
          </div>
        </details>
      )}

      {showOwnerNote && <span className="internal-nav-note">Owner tools — not available yet</span>}
      {noAccess && <span className="internal-nav-note">No internal access for this account</span>}
      <button type="button" onClick={signOut} className="internal-nav-signout">
        Sign out
      </button>
    </nav>
  )
}
