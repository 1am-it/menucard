'use client'

// #62 — the one entry "Restaurant of menu toevoegen" (contract criterion 4).
// One form: an optional restaurant search (empty means a new restaurant) and one
// or more URLs. The route is chosen by the tested, pure decideAddEntry
// (src/lib/internalAddEntry.js) and every follow-up reuses an existing screen or
// API — nothing new is invented:
//  - known restaurant + one URL  → the existing batch analysis (a failed or
//    empty read there already offers "Lees met AI", #59);
//  - new restaurant + one URL    → the existing Onboarding Restaurant flow with
//    the URL filled in;
//  - several URLs                → the existing batch analysis;
//  - "Liever zelf invoeren of plakken" → the existing manual import.
// Existing validation, limits and permissions stay exactly those of those
// screens: this page submits the same payload the batch page submits and shows
// the server's own error message instead of starting anything else.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import SourceResultRow from '@/src/components/SourceResultRow'
import useBatchProcessing from '@/src/components/useBatchProcessing'
import { decideAddEntry, manualImportHref, MAX_BATCH_URLS } from '@/src/lib/internalAddEntry'
import { rowForBatchItem, stepHref, CHECK_COPY } from '@/src/lib/sourceReview'

const RESTAURANTS_API = '/api/internal/v1/manual-menu-import/restaurants'
const BATCH_API = '/api/internal/v1/batch-analysis'

function newBatchId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null
}

export default function AddEntryPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined)
  const [restaurantQuery, setRestaurantQuery] = useState('')
  const [restaurantChoices, setRestaurantChoices] = useState([])
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)
  const [urls, setUrls] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fallbackHref, setFallbackHref] = useState(null)
  // BE-31 (#74): the result of the links appears under the form as the same
  // rows as Dekking and Bronnen beoordelen. The batch page is no longer a
  // destination you have to leave for.
  const [activeBatch, setActiveBatch] = useState(null)
  const debounce = useRef(null)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/internal/login')
      else setSession(data.session)
    })
  }, [router])

  const token = session && session.access_token

  // The rows of one batch, read through the existing GET. Used after a start and
  // by the ?batch= deeplink (also the way back from "Menukopjes controleren").
  const loadBatch = useCallback(
    async (batchId) => {
      if (!token || !batchId) return null
      try {
        const res = await fetch(`${BATCH_API}?batch=${encodeURIComponent(batchId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!res.ok) return null
        const body = await res.json().catch(() => null)
        if (!body || !body.detail) return null
        setActiveBatch(body.detail)
        return body
      } catch {
        return null
      }
    },
    [token],
  )

  useEffect(() => {
    if (!token) return
    const fromUrl = new URLSearchParams(window.location.search).get('batch')
    if (fromUrl) loadBatch(fromUrl)
  }, [token, loadBatch])

  const batchRunning = Boolean(activeBatch && activeBatch.batch && !activeBatch.batch.closed_at)
  useBatchProcessing({ token, batchId: activeBatch ? activeBatch.batch.id : null, enabled: batchRunning, onTick: loadBatch })

  // "Bevestig bron" in a result row is the same BE-25 confirmation route the
  // batch screen already uses; nothing is published and the row is re-read.
  async function confirmRow(row) {
    if (!activeBatch || !row || !row.jobId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${BATCH_API}/${encodeURIComponent(activeBatch.batch.id)}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: [row.jobId] }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'De bevestiging kon niet worden opgeslagen.')
        return
      }
      await loadBatch(activeBatch.batch.id)
    } catch {
      setError('De bevestiging kon niet worden opgeslagen.')
    } finally {
      setBusy(false)
    }
  }

  // Same search endpoint, same minimum length and the same guard against a
  // stale response as the existing manual import page.
  useEffect(() => {
    if (!token) return undefined
    if (selectedRestaurant && selectedRestaurant.name === restaurantQuery) {
      setRestaurantChoices([])
      return undefined
    }
    const query = restaurantQuery.trim()
    if (query.length < 2) {
      setRestaurantChoices([])
      return undefined
    }
    let cancelled = false
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`${RESTAURANTS_API}?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }).catch(() => null)
        if (cancelled || !res) return
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        setRestaurantChoices(res.ok && Array.isArray(data.restaurants) ? data.restaurants : [])
      } catch {
        if (!cancelled) setRestaurantChoices([])
      }
    }, 200)
    return () => {
      cancelled = true
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [restaurantQuery, token, selectedRestaurant])

  function chooseRestaurant(choice) {
    setSelectedRestaurant(choice)
    setRestaurantQuery(choice.name)
    setRestaurantChoices([])
    setError(null)
  }

  function changeRestaurantQuery(value) {
    setRestaurantQuery(value)
    setError(null)
    if (selectedRestaurant && value !== selectedRestaurant.name) setSelectedRestaurant(null)
  }

  const start = useCallback(
    async (event) => {
      event.preventDefault()
      setError(null)
      setFallbackHref(null)
      const decision = decideAddEntry({ restaurant: selectedRestaurant, urls })
      if (!decision.ok) {
        setError(decision.error)
        return
      }
      if (decision.kind === 'onboarding') {
        router.push(decision.href)
        return
      }

      // The existing analysis: exactly the payload and route the batch page
      // itself submits, so its own limits and checks stay authoritative.
      setBusy(true)
      const batchId = newBatchId()
      if (!batchId) {
        setBusy(false)
        setError('Deze browser kan geen analyse starten.')
        return
      }
      try {
        const res = await fetch(BATCH_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch_id: batchId, urls: decision.urls }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(body.error || 'De analyse kon niet worden gestart.')
          setFallbackHref(decision.href)
          return
        }
        await loadBatch(body.batch.id)
      } catch {
        setError('De analyse kon niet worden gestart.')
        setFallbackHref(decision.href)
      } finally {
        setBusy(false)
      }
    },
    [loadBatch, router, selectedRestaurant, token, urls],
  )

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main bta-main" role="status">
          Laden…
        </main>
      </div>
    )
  }

  return (
    <div className="di-page">
      <main className="di-main bta-main">
        <InternalNav accessToken={session.access_token} />
        <div className="bta-header">
          <div className="bta-title-row">
            <h1 className="di-title">Restaurant of menu toevoegen</h1>
            <span className="bta-tag">Alleen intern</span>
          </div>
          <p className="bta-muted">
            Eén ingang voor een nieuw restaurant, een nieuwe menukaart of meerdere URL&apos;s. De app kiest de bestaande
            route; er wordt niets automatisch gepubliceerd.
          </p>
        </div>

        <form onSubmit={start} aria-describedby="add-entry-help">
          <p id="add-entry-help" className="bta-muted">
            Kies een bestaand restaurant of laat het veld leeg voor een nieuw restaurant.
          </p>

          <div className="mai-field">
            <label className="bta-label" htmlFor="add-restaurant">
              Restaurant (zoek op naam)
            </label>
            {selectedRestaurant ? (
              <div className="mai-chosen">
                <span className="mai-chosen-name">
                  {selectedRestaurant.name}
                  {selectedRestaurant.buurt ? ` · ${selectedRestaurant.buurt}` : ''}
                </span>
                <button
                  type="button"
                  className="stg-btn-secondary mai-btn"
                  onClick={() => {
                    setSelectedRestaurant(null)
                    setRestaurantQuery('')
                    setRestaurantChoices([])
                    setError(null)
                  }}
                >
                  Wijzig
                </button>
              </div>
            ) : (
              <>
                <input
                  id="add-restaurant"
                  className="mai-input"
                  type="search"
                  value={restaurantQuery}
                  onChange={(event) => changeRestaurantQuery(event.target.value)}
                  autoComplete="off"
                  placeholder="Typ de naam van het restaurant"
                  aria-describedby="add-restaurant-help"
                />
                <p id="add-restaurant-help" className="bta-muted">
                  Laat leeg als het restaurant nog niet bestaat; dan opent de bestaande onboarding met de URL ingevuld.
                </p>
                {restaurantChoices.length > 0 ? (
                  <ul className="mai-choices" aria-label="Gevonden restaurants">
                    {restaurantChoices.map((choice) => (
                      <li key={choice.id}>
                        <button type="button" className="mai-choice" onClick={() => chooseRestaurant(choice)}>
                          {choice.name}
                          {choice.buurt ? ` · ${choice.buurt}` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {restaurantQuery.trim().length >= 2 && restaurantChoices.length === 0 ? (
                  <p className="bta-muted">Geen restaurant gevonden met deze naam. Laat het veld leeg voor een nieuw restaurant.</p>
                ) : null}
              </>
            )}
          </div>

          <div className="mai-field">
            <label className="bta-label" htmlFor="add-urls">
              URL&apos;s (één per regel, maximaal {MAX_BATCH_URLS})
            </label>
            <textarea
              id="add-urls"
              className="bta-textarea mai-urls"
              value={urls}
              onChange={(event) => {
                setUrls(event.target.value)
                setError(null)
                setFallbackHref(null)
              }}
              spellCheck="false"
              placeholder="https://restaurant.nl/menukaart"
            />
            <p className="bta-muted">
              Eén URL is genoeg. Meerdere URL&apos;s gaan naar de bestaande batchanalyse. Gebruik de pagina waar de
              menukaart staat, niet alleen de homepage.
            </p>
          </div>

          {error ? (
            <div className="di-banner di-banner-danger" role="alert">
              <span>{error}</span>
            </div>
          ) : null}

          {fallbackHref ? (
            <p className="bta-muted">
              <a href={fallbackHref}>Open de batchanalyse met deze URL&apos;s</a>
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button type="submit" className="di-btn-primary mai-btn" disabled={busy || urls.trim() === ''}>
              {busy ? 'Bezig…' : 'Doorgaan'}
            </button>
            <a className="stg-btn-secondary" href={manualImportHref(selectedRestaurant)}>
              Liever zelf invoeren of plakken
            </a>
          </div>
        </form>

        {activeBatch ? (
          <section className="brn-detail-card" style={{ marginTop: 20 }} aria-labelledby="add-result-title">
            <h2 id="add-result-title" className="brn-detail-title">
              Resultaat · dezelfde rijen als in Dekking
            </h2>
            <p className="brn-batch-summary">
              {activeBatch.batch.closed_at
                ? `${activeBatch.items.length} URL${activeBatch.items.length === 1 ? '' : "'s"} gecontroleerd.`
                : CHECK_COPY.running}{' '}
              Rond je dit niet af, dan blijft het als taak staan onder Werkvoorraad → Bronnen beoordelen.
            </p>
            <ol className="srr-list" aria-label="Resultaat van deze toevoeging">
              {activeBatch.items.map((item) => {
                const row = rowForBatchItem(item, { batchId: activeBatch.batch.id })
                const returnTo = `/internal/toevoegen?batch=${encodeURIComponent(activeBatch.batch.id)}`
                return (
                  <SourceResultRow
                    key={`${item.position}-${item.jobId || item.key}`}
                    row={row}
                    position={item.position}
                    href={stepHref(row, { batchId: activeBatch.batch.id, returnTo })}
                    onConfirm={confirmRow}
                    busy={busy}
                  />
                )
              })}
            </ol>
            <p className="brn-notice">{CHECK_COPY.nothingPublished}</p>
          </section>
        ) : null}
      </main>
    </div>
  )
}
