'use client'

// Issue #53 round 2 — Beheer. Four views over existing capabilities:
// Overzicht (the existing coverage data), Restaurants en bronnen (existing
// source-triage records), Importhistorie (existing URL batches + dataset
// runs) and Concepten en besluiten (recorded concepts/decisions/drafts).
//
// This page is session-gated only, exactly like every other internal page.
// It resolves the session's roles through the existing read-only
// GET /api/internal/v1/me. Only an `internal` account sees the four
// sections; an editor-only (or owner-only) account gets no internal-only
// administration data and no empty hub, just a pointer to Werkvoorraad.
// Every provider keeps its own unchanged server-side authorization, and
// nothing on this page writes, imports, approves or publishes.
//
// The four tabs are real URLs (`/internal?section=...`) so they remain
// shareable and Back works; old module URLs stay untouched and reachable.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { hasAnyKnownRole } from '@/src/lib/internalNav'
import { isInternalOnly } from '@/src/lib/importInbox'
import { sectionFromSearch } from '@/src/lib/internalBeheer'
import BeheerNav from '@/src/components/beheer/BeheerNav'
import OverviewPanel from '@/src/components/beheer/OverviewPanel'
import RestaurantsPanel from '@/src/components/beheer/RestaurantsPanel'
import ImportHistoryPanel from '@/src/components/beheer/ImportHistoryPanel'
import DecisionsPanel from '@/src/components/beheer/DecisionsPanel'

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export default function BeheerPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [roles, setRoles] = useState(undefined) // undefined = loading, [] once resolved (possibly empty)
  const [error, setError] = useState(null)
  const [section, setSection] = useState('overview')

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
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Je interne toegang kon niet worden vastgesteld.')
        setRoles([])
        return
      }
      setRoles(data.roles || [])
    } catch {
      setError('Je interne toegang kon niet worden vastgesteld.')
      setRoles([])
    }
  }, [])

  useEffect(() => {
    if (session) loadRoles(session.access_token)
  }, [session, loadRoles])

  // Read the requested section from the real URL and keep Back/Forward in
  // step. An unknown value fails closed to the default Overzicht.
  useEffect(() => {
    setSection(sectionFromSearch(window.location.search))
    const onPop = () => setSection(sectionFromSearch(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function selectSection(next) {
    setSection(next)
    const url = new URL(window.location.href)
    if (next === 'overview') url.searchParams.delete('section')
    else url.searchParams.set('section', next)
    window.history.pushState({}, '', url)
  }

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  if (session === undefined || roles === undefined) {
    return (
      <div className="di-page">
        <main className="di-main" style={{ color: 'var(--text-secondary)' }}>
          Laden…
        </main>
      </div>
    )
  }

  const noAccess = !hasAnyKnownRole(roles)
  const canManage = isInternalOnly(roles)
  // No known role: the status box carries the page's one sign-out action, so
  // the shared nav (which would duplicate it) is not rendered alongside it.
  const showNoAccessStatus = noAccess && !error
  const roleLabels = [...new Set(roles.map((r) => r.role))]
  const email = session?.user?.email || null

  return (
    <div className="di-page">
      <main className="di-main">
        {!showNoAccessStatus && <InternalNav accessToken={session.access_token} roles={roles} />}

        <div className="bh-page-head">
          <div>
            <h1 className="di-title">Beheer</h1>
            <p>Overzicht, historie en referentiegegevens.</p>
            <p className="bh-identity">
              {email ? `Ingelogd als ${email}` : 'Ingelogd'}
              {roleLabels.length > 0 ? ` · rollen: ${roleLabels.join(', ')}` : ''}
            </p>
          </div>
        </div>

        {error && (
          <div className="di-banner di-banner-danger" role="alert">
            <span>{error}</span>
          </div>
        )}

        {showNoAccessStatus && (
          <div role="status" className="bh-empty-state">
            <span className="bh-empty-icon">
              <IconLock />
            </span>
            <div>
              <strong>Geen interne toegang voor dit account.</strong>
              <p>
                Aan dit account is geen interne rol toegekend. Neem contact op met een beheerder als dat niet klopt —
                er is vanaf hier niets anders te doen.
              </p>
              <button type="button" className="bh-action bh-action--secondary" onClick={signOut}>
                Uitloggen
              </button>
            </div>
          </div>
        )}

        {!noAccess && !canManage && !error && (
          <div role="status" className="bh-empty-state">
            <div>
              <strong>Geen interne beheerinhoud voor dit account.</strong>
              <p>
                Beheer toont alleen overzichten en historie die voor interne medewerkers zijn bedoeld. Dagelijks werk
                staat in de Werkvoorraad.
              </p>
              <a className="bh-action" href="/internal/workqueue">
                Naar Werkvoorraad
              </a>
            </div>
          </div>
        )}

        {canManage && !error && (
          <>
            <BeheerNav section={section} onSelect={selectSection} />
            <OverviewPanel token={session.access_token} active={section === 'overview'} />
            <RestaurantsPanel token={session.access_token} active={section === 'restaurants'} />
            <ImportHistoryPanel token={session.access_token} active={section === 'imports'} />
            <DecisionsPanel token={session.access_token} active={section === 'decisions'} />
            <p className="bh-footnote">
              Gebruikers en rechten: nog geen beheerscherm beschikbaar. Hiervoor is een afzonderlijk beveiligd
              beheeronderdeel nodig; deze pagina toont daarom geen schijnbare beheermogelijkheid.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
