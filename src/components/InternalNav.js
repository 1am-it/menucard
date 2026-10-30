'use client'

// #62 — shared, role-aware internal navigation shell. Mounted individually on
// every existing authenticated internal page (never via app/internal/layout.js,
// which stays a Server Component wrapping /internal/login and the pre-session
// activation pages too, where no nav should render). Resolves the caller's roles
// via the existing, unchanged, read-only GET /api/internal/v1/me and the real
// workqueue numbers via GET /api/internal/v1/workqueue-counts. This component
// only decides what to *show*; it grants no access. Every existing route keeps
// enforcing its own unchanged server-side authorization.
//
// Issue #62's structure (contract criteria 1, 2 and 5):
//  - inline: the logo (always the landing rule, through /internal), "Dekking",
//    "Werkvoorraad (N)", "+ Restaurant of menu toevoegen", Licht/Donker and
//    Uitloggen;
//  - the Werkvoorraad menu is a real button with aria-expanded (never a
//    hover-only or CSS-only menu), followed by a panel with the counted
//    "Open werk" rows sorted by real numbers, one separating line, then
//    Stadsoverzicht and Restaurantgegevens (concept), and on a telephone the
//    same Licht/Donker and Uitloggen at the bottom;
//  - on a narrow screen the bar keeps the logo, Dekking, "Werk (N)" and a "+"
//    button of at least 44 px; the full labels live in the menu.
//
// Keyboard and screen reader: the trigger is a native button (Enter/Space
// toggle), Escape closes the panel and returns focus to that button, a click
// outside closes it, and every item is a normal link with aria-current on the
// current route. The two action blocks (bar vs. menu bottom) are the same two
// controls rendered once per breakpoint; the inactive copy is `display: none`,
// so it is never in the accessibility tree and never a duplicate tab stop.
//
// Counts are one request per shell load. If it fails, no number is shown at all
// — never a fabricated 0 — while the menu itself keeps working.

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import {
  resolveVisibleModules,
  groupModulesByPlacement,
  sortOpenWork,
  resolveOpenWorkTotal,
  isOwnerRole,
  hasAnyKnownRole,
} from '@/src/lib/internalNav'
// The same shared Licht/Donker toggle every public header already uses
// (theme-design-tokens.md; decision 006 + BE-09: an explicit per-browser choice
// stored as `bredaeats_theme`, dark when nothing is stored, no OS-preference
// following). Mounted here so every internal page gets it — no internal-only
// theme logic.
import AccountMenuButton from '@/src/components/AccountMenuButton'
import ThemeToggle from '@/src/components/ThemeToggle'
import { WordmarkInline } from '@/src/components/Wordmark'

const COUNT_API = '/api/internal/v1/workqueue-counts'
const PANEL_ID = 'internal-nav-workqueue-panel'

// The current destination: the page itself or one of its subpages (e.g.
// Bronnen beoordelen / Batchanalyse), so orientation stays on the parent item
// (decision 014).
function isCurrent(pathname, href) {
  return pathname === href || (typeof pathname === 'string' && pathname.startsWith(`${href}/`))
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m6 9 6 6 6-6" />
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

// One icon per workqueue module id — a fixed, closed lookup, never a
// default/fallback glyph, so a module added later without a matching entry here
// fails visibly (no icon rendered) rather than showing a misleading placeholder.
const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
}

const WORKQUEUE_ICONS = {
  'menu-concepts': (
    <svg {...iconProps}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  ),
  'source-triage': (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  'import-inbox': (
    <svg {...iconProps}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  ),
  moderation: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  'source-workqueue': (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  'profile-drafts': (
    <svg {...iconProps}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  // BE-45 (#114): de tellers — een eenvoudige staafgrafiek, geen beeldmerk.
  tellers: (
    <svg {...iconProps}>
      <path d="M3 3v18h18" />
      <path d="M8 17v-5" />
      <path d="M13 17V7" />
      <path d="M18 17v-8" />
    </svg>
  ),
};


export default function InternalNav({ accessToken, roles: rolesProp }) {
  const pathname = usePathname()
  const router = useRouter()
  const [rolesState, setRolesState] = useState(undefined) // undefined = loading, [] once resolved (possibly empty)
  const [counts, setCounts] = useState(undefined) // undefined = loading, null = failed, object = resolved
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const wrapperRef = useRef(null)

  // Which copy of Licht/Donker + Uitloggen is mounted: the bar's on a wide
  // screen, the menu's at the bottom on a telephone. Exactly one exists at a
  // time, so two independent toggles can never disagree after a resize and a
  // screen reader or the tab order never meets a duplicate. The 640 px CSS rule
  // only keeps the first paint stable; this listener is not theme logic.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(max-width: 640px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

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
  const modules = roles === undefined ? [] : resolveVisibleModules(roles)
  const { primary, openWork, secondary } = groupModulesByPlacement(modules)
  const openWorkRows = sortOpenWork(openWork, counts || null)
  const total = resolveOpenWorkTotal(openWorkRows)
  // BE-47 (#111): an owner has a real destination now — /mijn-restaurant — so the
  // old static "Beheerdersfuncties — nog niet beschikbaar" note became a link.
  const showOwnerLink = roles !== undefined && isOwnerRole(roles)
  const noAccess = roles !== undefined && !hasAnyKnownRole(roles)

  // One request per shell load, only for an account that actually has open
  // work sections to count. A failure is kept as `null`, never turned into 0.
  const openWorkCount = openWork.length
  useEffect(() => {
    if (!accessToken || openWorkCount === 0) return undefined
    let cancelled = false
    async function loadCounts() {
      try {
        const res = await fetch(COUNT_API, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        setCounts(res.ok && data && data.counts && typeof data.counts === 'object' ? data.counts : null)
      } catch {
        if (!cancelled) setCounts(null)
      }
    }
    loadCounts()
    return () => {
      cancelled = true
    }
  }, [accessToken, openWorkCount])

  // Escape closes the panel and returns focus to its trigger; a click outside
  // closes it without moving focus. Both listeners only exist while open.
  useEffect(() => {
    if (!open) return undefined
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      setOpen(false)
      if (triggerRef.current) triggerRef.current.focus()
    }
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  // A client-side navigation from inside the panel should not leave it stuck
  // open on the next page.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  return (
    <nav aria-label="Interne navigatie" className="internal-nav" ref={wrapperRef}>
      <a
        href="/internal"
        className="internal-nav-home"
        aria-label="Onze Menukaarten, naar het meeste open werk of Dekking"
      >
        <WordmarkInline />
      </a>

      {primary.map((m) => (
        <a
          key={m.id}
          href={m.href}
          className="internal-nav-link"
          aria-current={isCurrent(pathname, m.href) ? 'page' : undefined}
        >
          {m.label}
        </a>
      ))}

      {openWork.length > 0 && (
        <div className="internal-nav-workqueue">
          <button
            ref={triggerRef}
            type="button"
            className="internal-nav-workqueue-trigger"
            aria-expanded={open}
            aria-controls={PANEL_ID}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="internal-nav-workqueue-title">
              <span className="internal-nav-workqueue-title-full">Werkvoorraad</span>
              <span className="internal-nav-workqueue-title-short">Werk</span>
              {total !== null && <span className="internal-nav-workqueue-total">({total})</span>}
            </span>
            <IconChevron />
          </button>

          {open && (
            <div className="internal-nav-workqueue-panel" id={PANEL_ID}>
              <p className="internal-nav-workqueue-heading" id="internal-nav-open-work">
                Open werk
              </p>
              <ul className="internal-nav-workqueue-list" aria-labelledby="internal-nav-open-work">
                {openWorkRows.map(({ module, count }) => (
                  <li key={module.id}>
                    <a
                      href={module.href}
                      className="internal-nav-workqueue-item"
                      aria-current={isCurrent(pathname, module.href) ? 'page' : undefined}
                    >
                      <span className="internal-nav-workqueue-item-icon">{WORKQUEUE_ICONS[module.id]}</span>
                      <span className="internal-nav-workqueue-item-text">
                        <span className="internal-nav-workqueue-item-label">{module.label}</span>
                        {module.subtitle && <span className="internal-nav-workqueue-item-subtitle">{module.subtitle}</span>}
                      </span>
                      {count !== null && (
                        <span className="internal-nav-workqueue-item-count" aria-label={`${count} open`}>
                          {count}
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>

              {secondary.length > 0 && (
                <>
                  <hr className="internal-nav-workqueue-separator" />
                  <ul className="internal-nav-workqueue-list" aria-label="Stad en restaurantgegevens">
                    {secondary.map((m) => (
                      <li key={m.id}>
                        <a
                          href={m.href}
                          className="internal-nav-workqueue-item"
                          aria-current={isCurrent(pathname, m.href) ? 'page' : undefined}
                        >
                          <span className="internal-nav-workqueue-item-icon">{WORKQUEUE_ICONS[m.id]}</span>
                          <span className="internal-nav-workqueue-item-text">
                            <span className="internal-nav-workqueue-item-label">{m.label}</span>
                            {m.subtitle && <span className="internal-nav-workqueue-item-subtitle">{m.subtitle}</span>}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="internal-nav-workqueue-actions">
                {narrow && (
                  <>
                    <ThemeToggle />
                    <button type="button" onClick={signOut} className="internal-nav-signout">
                      Uitloggen
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <a
        href="/internal/toevoegen"
        className="internal-nav-add"
        aria-label="Restaurant of menu toevoegen"
        aria-current={isCurrent(pathname, '/internal/toevoegen') ? 'page' : undefined}
      >
        <span className="internal-nav-add-plus" aria-hidden="true">
          +
        </span>
        <span className="internal-nav-add-text">Restaurant of menu toevoegen</span>
      </a>

      {showOwnerLink && (
        <a className="internal-nav-link" href="/mijn-restaurant">
          Mijn restaurant
        </a>
      )}
      {noAccess && <span className="internal-nav-note">Dit account heeft geen interne toegang</span>}

      {/* BE-59 (#146) — hetzelfde accountmenu als op de publieke pagina's. Op
          interne pagina's staat daar ook "Bekijk de site" in (de keuze daarvoor
          komt uit het pad, zie src/lib/accountMenu.js). */}
      <AccountMenuButton />

      {!narrow && (
        <div className="internal-nav-actions">
          <ThemeToggle />
          <button type="button" onClick={signOut} className="internal-nav-signout">
            Uitloggen
          </button>
        </div>
      )}
    </nav>
  )
}
