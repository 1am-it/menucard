'use client'

// Werkvoorraad (issue #53) — the staff landing page with one list of
// concrete human tasks, not module navigation. Each row names the
// restaurant/item, the task, why attention is needed and exactly one next
// action that opens the existing record (or the deep-link adapter that
// legacy screen now understands).
//
// Data comes only from the existing read-only internal APIs, through the
// pure model in src/lib/internalWorkqueue.js. The page itself resolves the
// session's roles via GET /api/internal/v1/me and only fetches what those
// roles may see; every provider keeps its own unchanged server-side
// authorization. A failed provider is reported as partial/error and is
// never shown as "no work".
//
// This first round replaces the five module cards. Beheer's sections and
// the shorter publication navigation are later rounds in the same approved
// contract.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { hasAnyKnownRole } from '@/src/lib/internalNav'
import { buildWorkqueue, resolveWorkqueueProviders } from '@/src/lib/internalWorkqueue'

const PROVIDER_ENDPOINTS = {
  'source-workqueue': '/api/internal/v1/source-workqueue',
  'source-triage': '/api/internal/v1/source-triage',
  'menu-concepts': '/api/internal/v1/menu-concepts',
  'profile-drafts': '/api/internal/v1/profile-drafts',
  moderation: '/api/internal/v1/moderation/pending',
  claims: '/api/internal/v1/claims/pending',
}

// The candidate list is one API per review status (the endpoint accepts a
// single `review_status` value). Fetching the three genuine pending states
// separately avoids silently cutting older pending candidates off a larger
// unfiltered page.
const CANDIDATE_STATUSES = ['new', 'needs_enrichment', 'approved_internal']
const LOAD_ERROR = 'De gegevens konden niet worden geladen.'

async function fetchJson(url, token) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, data: null, error: body.error || LOAD_ERROR }
    return { ok: true, data: body, error: null }
  } catch {
    return { ok: false, data: null, error: LOAD_ERROR }
  }
}

async function fetchImportCandidates(token) {
  const results = await Promise.all(
    CANDIDATE_STATUSES.map((status) =>
      fetchJson(`/api/internal/v1/import-inbox/candidates?review_status=${status}`, token)
    )
  )
  const loaded = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  if (loaded.length === 0) {
    return { ok: false, data: null, error: failed[0]?.error || LOAD_ERROR }
  }
  const candidates = loaded.flatMap((r) => (r.data && r.data.candidates) || [])
  return {
    ok: failed.length === 0,
    partial: failed.length > 0,
    data: { candidates },
    error: failed.length > 0 ? 'Niet alle importstatussen konden worden geladen.' : null,
  }
}

async function fetchProviders(token, roles) {
  const definitions = resolveWorkqueueProviders(roles)
  const entries = await Promise.all(
    definitions.map(async (definition) => {
      if (definition.id === 'import-candidates') {
        return [definition.id, await fetchImportCandidates(token)]
      }
      const result = await fetchJson(PROVIDER_ENDPOINTS[definition.id], token)
      // The source-triage API answers 200 even when proposal storage is
      // unavailable; that is partial information, not "no proposals".
      if (definition.id === 'source-triage' && result.ok && result.data && result.data.proposals_available === false) {
        return [definition.id, { ...result, partial: true, error: 'Bronvoorstellen zijn tijdelijk niet beschikbaar.' }]
      }
      return [definition.id, result]
    })
  )
  return Object.fromEntries(entries)
}

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

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

export default function WerkvoorraadPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [roles, setRoles] = useState(undefined) // undefined = loading, [] once resolved (possibly empty)
  const [providerResults, setProviderResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

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

  const load = useCallback(async (token) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/internal/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(data.error || 'Je interne toegang kon niet worden vastgesteld.')
        setRoles([])
        setProviderResults({})
        return
      }
      const nextRoles = data.roles || []
      setRoles(nextRoles)
      setProviderResults(await fetchProviders(token, nextRoles))
    } catch {
      setLoadError('Je interne toegang kon niet worden vastgesteld.')
      setRoles([])
      setProviderResults({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) load(session.access_token)
  }, [session, load, reloadKey])

  async function signOut() {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.replace('/internal/login')
  }

  const model = useMemo(
    () => (providerResults ? buildWorkqueue({ roles: roles || [], providers: providerResults }) : null),
    [providerResults, roles]
  )
  const noAccess = Array.isArray(roles) && !hasAnyKnownRole(roles)
  // With no known role there is no task data to show; that status box carries
  // the page's one sign-out action itself, so the shared nav (which would
  // duplicate it) is not rendered alongside it.
  const showNoAccessStatus = noAccess && !loadError
  const roleLabels = [...new Set((roles || []).map((r) => r.role))]
  const email = session?.user?.email || null

  if (session === undefined || roles === undefined) {
    return (
      <div className="di-page">
        <main className="di-main" style={{ color: 'var(--text-secondary)' }}>
          Laden…
        </main>
      </div>
    )
  }

  const knownTasks = model ? model.counts.total : 0
  const showList = model && !noAccess && !loadError && knownTasks > 0
  const showEmpty = model && !noAccess && !loadError && model.status === 'empty'

  return (
    <div className="di-page">
      <main className="di-main">
        {!showNoAccessStatus && <InternalNav accessToken={session.access_token} roles={roles} />}

        <div className="wq-head">
          <div>
            <h1 className="di-title">Werkvoorraad</h1>
            <p className="wq-subtitle">Wat nu jouw aandacht nodig heeft.</p>
            <p className="wq-identity">
              {email ? `Ingelogd als ${email}` : 'Ingelogd'}
              {roleLabels.length > 0 ? ` · rollen: ${roleLabels.join(', ')}` : ''}
            </p>
          </div>
          {model && !noAccess && !loadError && (
            <span className="wq-count">
              {knownTasks} open {knownTasks === 1 ? 'taak' : 'taken'}
            </span>
          )}
        </div>

        {loadError && (
          <div className="di-banner di-banner-danger" role="alert">
            <span>{loadError}</span>
          </div>
        )}

        {model && model.status === 'partial' && !loadError && (
          <div className="di-banner di-banner-neutral" role="status">
            <span>
              <strong>De werkvoorraad is mogelijk onvolledig.</strong>{' '}
              {model.incompleteProviders.map((p) => p.label).join(', ')}{' '}
              {model.incompleteProviders.length === 1 ? 'kon' : 'konden'} niet volledig worden geladen. Er wordt
              niets als afgerond gemeld.{' '}
              <button
                type="button"
                className="wq-retry"
                onClick={() => setReloadKey((key) => key + 1)}
                disabled={loading}
              >
                {loading ? 'Laden…' : 'Opnieuw laden'}
              </button>
            </span>
          </div>
        )}

        {model && model.status === 'error' && !loadError && (
          <div className="di-banner di-banner-danger" role="alert">
            <span>
              <strong>De werkvoorraad kon niet worden geladen.</strong> Probeer het opnieuw; er wordt niets als
              afgerond gemeld.{' '}
              <button
                type="button"
                className="wq-retry"
                onClick={() => setReloadKey((key) => key + 1)}
                disabled={loading}
              >
                {loading ? 'Laden…' : 'Opnieuw laden'}
              </button>
            </span>
          </div>
        )}

        {showNoAccessStatus && (
          <div role="status" className="wq-noaccess">
            <span className="wq-noaccess-icon">
              <IconLock />
            </span>
            <div>
              <strong>Geen interne toegang voor dit account.</strong>
              <p>
                Aan dit account is geen interne rol toegekend. Neem contact op met een beheerder als dat niet klopt —
                er is vanaf hier niets anders te doen.
              </p>
              <button type="button" onClick={signOut} className="wq-retry">
                Uitloggen
              </button>
            </div>
          </div>
        )}

        {!model && !loadError && <p className="wq-loading">Laden…</p>}

        {showList && (
          <>
            <div className="wq-list-head" aria-hidden="true">
              <span>Restaurant en taak</span>
              <span>Waarom jouw controle nodig is</span>
              <span>Volgende actie</span>
            </div>
            <ul className="wq-tasks" aria-label="Open taken">
              {model.tasks.map((task) => {
                const date = formatDate(task.recordedAt)
                return (
                  <li key={task.id} className="wq-task">
                    <div>
                      <h2>{task.restaurantName}</h2>
                      <p className="wq-kind">{task.title}</p>
                    </div>
                    <div>
                      <p className="wq-reason">{task.reason}</p>
                      {(task.secondary || date) && (
                        <p className="wq-secondary">{[task.secondary, date].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <a className="wq-action" href={task.href}>
                      {task.actionLabel}
                      <span className="wq-action-icon" aria-hidden="true">
                        <IconArrowRight />
                      </span>
                    </a>
                  </li>
                )
              })}
            </ul>
            <p className="wq-footnote">Niets wordt automatisch bevestigd of gepubliceerd.</p>
          </>
        )}

        {showEmpty && (
          <div className="wq-empty" role="status">
            <strong>Geen openstaand werk.</strong>
            <p>Nieuwe aanvragen verschijnen hier zodra ze jouw controle nodig hebben.</p>
          </div>
        )}
      </main>
    </div>
  )
}
