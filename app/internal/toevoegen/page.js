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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import SourceResultRow from '@/src/components/SourceResultRow'
import useBatchProcessing from '@/src/components/useBatchProcessing'
import useAiReading from '@/src/components/useAiReading'
import { decideAddEntry, manualImportHref, MAX_BATCH_URLS } from '@/src/lib/internalAddEntry'
import { rowForBatchItem, stepHref, aiReadReady, confirmedCheckUrl, recheckUrlFor, CHECK_URL_SOURCE_LABELS, CHECK_COPY } from '@/src/lib/sourceReview'
import { discoveryRow, originLabel, costLine } from '@/src/lib/sourceDiscovery'
import { OSM_ATTRIBUTION } from '@/src/lib/osmSource'
import { ROW_SEARCHING, discoveryFailure } from '@/src/lib/discoveryProgress'

const RESTAURANTS_API = '/api/internal/v1/manual-menu-import/restaurants'
const BATCH_API = '/api/internal/v1/batch-analysis'
// BE-34 (#81): a search that takes longer than this is reported as "duurde te
// lang" instead of waiting forever.
const DISCOVERY_TIMEOUT_MS = 120000
// BE-32 (#75, criterion 2): the same engine as "Vind bronnen", for one restaurant.
const DISCOVERY_API = '/api/internal/v1/source-discovery'
// BE-34 (#81, criterion 2): the same engine for a name that is not in our list.
const NAME_API = '/api/internal/v1/source-discovery/name'
const TRIAGE_API = '/api/internal/v1/source-triage'
// BE-33 (#79): the existing AI status; it decides the image/scan row step only.
const AI_API = '/api/internal/v1/menu-ai-import'

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
  // BE-32 (#75, criterion 2): "✨ Zoek de bron voor mij" and the "Nieuw gevonden"
  // prefill (name, address and website already filled in).
  const [discovery, setDiscovery] = useState(null)
  const [discoveryBusy, setDiscoveryBusy] = useState(false)
  const [discoveryNotice, setDiscoveryNotice] = useState(null)
  // BE-34 (#81, criterion 4): a failed search keeps its own retry, next to the
  // plain-language reason; a validation error never shows one.
  const [discoveryFailed, setDiscoveryFailed] = useState(false)
  // BE-34 (#81, criterion 2): "✨ Zoek op internet: <naam>, Breda" for a name that
  // is not in our list. The answer is a proposal with its provenance and cost.
  const [nameSearch, setNameSearch] = useState({ busy: false, proposal: null, message: null, cost: null, monthly: null })
  const [prefill, setPrefill] = useState(null)
  // BE-33 (#79): AI availability for the image/scan row; null means "manual".
  const [aiStatus, setAiStatus] = useState(null)
  const debounce = useRef(null)

  useEffect(() => {
    // The prefill is read from the address bar only (no server render, no
    // storage): "＋ Toevoegen" in Nieuw gevonden fills the same fields.
    const params = new URLSearchParams(window.location.search)
    const naam = params.get('naam')
    const website = params.get('website')
    const adres = params.get('adres')
    const osm = params.get('osm')
    if (naam) setRestaurantQuery(naam)
    if (website) setUrls(website)
    if (naam || website || adres) setPrefill({ naam, website, adres, osm })
  }, [])

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/internal/login')
      else setSession(data.session)
    })
  }, [router])

  const token = session && session.access_token
  // BE-34 (#81): one click on "Lees met AI" in a result row starts the existing
  // server-side reading there; the row shows progress, outcome and, on failure,
  // "Handmatig toevoegen" as the next step.
  const aiRead = useAiReading({ token })

  // BE-33 (#79, criterion 1): the image/scan row may only offer the AI reading
  // when the same status endpoint says AI is on and the budget allows it.
  useEffect(() => {
    if (!token) return
    let live = true
    fetch(AI_API, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (live) setAiStatus(body || null)
      })
      .catch(() => {
        if (live) setAiStatus(null)
      })
    return () => {
      live = false
    }
  }, [token])

  // BE-35 (#84, criterion 1): here too the confirmed link leads the check. The
  // existing triage GET already knows the confirmed proposal of a restaurant
  // (with the provenance BE-32 wrote), so nothing new is asked or written.
  const [checkEntry, setCheckEntry] = useState(null)
  useEffect(() => {
    if (!token || !selectedRestaurant) {
      setCheckEntry(null)
      return undefined
    }
    let live = true
    const restaurantId = String(selectedRestaurant.id)
    fetch(TRIAGE_API, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!live) return
        const list = body && Array.isArray(body.restaurants) ? body.restaurants : []
        const found = list.find((item) => item && String(item.restaurant_id) === restaurantId) || null
        setCheckEntry(found ? { restaurantId, entry: found } : null)
      })
      .catch(() => {
        if (live) setCheckEntry(null)
      })
    return () => {
      live = false
    }
  }, [token, selectedRestaurant])
  // Only the entry of the restaurant that is chosen right now may decide the
  // link: a slower answer for a previous choice is ignored.
  const confirmedCheck = useMemo(
    () =>
      checkEntry && selectedRestaurant && checkEntry.restaurantId === String(selectedRestaurant.id)
        ? confirmedCheckUrl(checkEntry.entry)
        : null,
    [checkEntry, selectedRestaurant],
  )

  // The confirmed link fills an empty URL field; text the human typed is never
  // overwritten. The field stays theirs to change.
  useEffect(() => {
    if (!confirmedCheck || !confirmedCheck.url) return
    setUrls((prev) => (prev.trim() === '' ? confirmedCheck.url : prev))
  }, [confirmedCheck])

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

  // "Opnieuw controleren" (BE-31 review #6439131777) is the same existing
  // analysis for exactly this URL: same route, same body, same limits, and it
  // runs only while this page is open (useBatchProcessing below).
  // BE-35 (#84, criterion 2): the same rule as "Controleer" — the confirmed link
  // of this restaurant comes before the URL the row was checked on.
  async function recheck(row) {
    const entry =
      checkEntry && row && row.restaurant && String(row.restaurant.id) === checkEntry.restaurantId ? checkEntry.entry : null
    const url = recheckUrlFor(row, entry)
    const batchId = newBatchId()
    if (!url || !batchId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(BATCH_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId, urls: [url] }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'De controle kon niet worden gestart.')
        return
      }
      await loadBatch(body.batch.id)
    } catch {
      setError('De controle kon niet worden gestart.')
    } finally {
      setBusy(false)
    }
  }

  // BE-32 (#75): the same engine as Dekking, for exactly one restaurant. Every
  // result is a proposal; "Bevestig voorstel" uses the existing BE-24 decision
  // route and then puts the found link in the field — nothing is added here.
  async function findSource() {
    if (!token || !selectedRestaurant) return
    setDiscoveryBusy(true)
    setError(null)
    setDiscovery(null)
    setDiscoveryNotice(null)
    setDiscoveryFailed(false)
    let timer = null
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      // BE-34 (#81, criterion 4): one search that takes too long says "duurde te
      // lang" instead of waiting forever.
      if (controller) timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
      const res = await fetch(DISCOVERY_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_ids: [selectedRestaurant.id] }),
        ...(controller ? { signal: controller.signal } : {}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(discoveryFailure({ status: res.status, error: body.error }).message)
        setDiscoveryFailed(true)
        return
      }
      setDiscovery({
        results: Array.isArray(body.results) ? body.results : [],
        summary: body.summary || null,
        messages: Array.isArray(body.messages) ? body.messages : [],
        cost: body.cost || null,
        monthly: body.monthly || null,
      })
    } catch (error) {
      setError(discoveryFailure({ timedOut: Boolean(error && error.name === 'AbortError') }).message)
      setDiscoveryFailed(true)
    } finally {
      if (timer) clearTimeout(timer)
      setDiscoveryBusy(false)
    }
  }

  // BE-34 (#81, criterion 2): a name that is not in our list is looked up on the
  // internet through the same AI search layer as "Vind bronnen" — same client,
  // same budget gate, same refused platforms, and the cost is reported. Nothing
  // is created: the human opens the existing onboarding from the proposal.
  async function searchNewRestaurant() {
    const name = restaurantQuery.trim()
    if (!token || name.length < 2) return
    setNameSearch((prev) => ({ ...prev, busy: true, message: null, proposal: null }))
    try {
      const res = await fetch(NAME_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNameSearch({
          busy: false,
          proposal: null,
          message: body.error || 'Zoeken op internet lukte niet.',
          cost: null,
          monthly: null,
        })
        return
      }
      setNameSearch({
        busy: false,
        proposal: body.proposal || null,
        message: body.proposal ? null : body.message || 'Geen website gevonden.',
        cost: body.cost || null,
        monthly: body.monthly || null,
      })
      // The found link also fills the URL field, so the existing flow continues
      // without copy/paste; the field stays the human's to change.
      const found = body.proposal ? (body.proposal.menu ? body.proposal.menu.url : body.proposal.website.url) : null
      if (found && urls.trim() === '') setUrls(found)
    } catch {
      setNameSearch({ busy: false, proposal: null, message: 'Zoeken op internet lukte niet.', cost: null, monthly: null })
    }
  }

  async function confirmDiscoveryProposal(result) {
    const proposalId = result && result.proposal && result.proposal.id
    if (!token || !proposalId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${TRIAGE_API}/proposals/${encodeURIComponent(proposalId)}/decision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'accepted' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'Het voorstel kon niet worden bevestigd.')
        return
      }
      const url = (result.menu && result.menu.url) || (result.website && result.website.url) || ''
      if (url && urls.trim() === '') setUrls(url)
      setDiscoveryNotice(
        'Voorstel bevestigd. Er is niets automatisch gepubliceerd; de gevonden link staat in het veld, klik op Doorgaan om te controleren.',
      )
    } catch {
      setError('Het voorstel kon niet worden bevestigd.')
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
    // A proposal belongs to the name it was searched for.
    setNameSearch({ busy: false, proposal: null, message: null, cost: null, monthly: null })
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
                {/* BE-34 (#81, criterion 2): a name that is not in our list can be
                    looked up on the internet — the same AI search layer, with the
                    same budget, the same refused platforms and a visible cost. */}
                {restaurantQuery.trim().length >= 2 && restaurantChoices.length === 0 ? (
                  <div className="mai-discovery">
                    <button
                      type="button"
                      className="stg-btn-secondary mai-btn"
                      disabled={nameSearch.busy}
                      onClick={searchNewRestaurant}
                    >
                      {nameSearch.busy
                        ? '✨ Bezig…'
                        : `✨ Zoek op internet: ${restaurantQuery.trim().slice(0, 120)}, Breda`}
                    </button>
                    <p className="bta-muted" style={{ margin: 0 }}>
                      Dit gebruikt dezelfde AI-zoeklaag als &quot;Vind bronnen&quot;: bronvermelding verplicht, platforms
                      geweigerd, budget vooraf gecontroleerd en de kosten zichtbaar. Kaartgegevens: {OSM_ATTRIBUTION}.
                    </p>
                  </div>
                ) : null}
                {nameSearch.busy ? (
                  <p className="bta-muted cov-loading" role="status" aria-live="polite">
                    <span className="cov-spinner" aria-hidden="true" />
                    {ROW_SEARCHING} {restaurantQuery.trim().slice(0, 120)}, Breda
                  </p>
                ) : null}
                {nameSearch.message ? (
                  <div className="di-banner di-banner-neutral" role="status">
                    {nameSearch.message}
                  </div>
                ) : null}
                {nameSearch.proposal ? (
                  <section className="mai-discovery" aria-labelledby="add-name-proposal">
                    <p id="add-name-proposal" className="bta-label">
                      Voorstel uit de zoekactie
                    </p>
                    <p className="cov-check-name">{nameSearch.proposal.name}</p>
                    <p className="cov-check-meta">{nameSearch.proposal.address || 'Geen adres gevonden.'}</p>
                    <p className="cov-check-meta">
                      Website:{' '}
                      <a href={nameSearch.proposal.website.url} target="_blank" rel="noopener noreferrer">
                        {nameSearch.proposal.website.url}
                      </a>
                    </p>
                    <p className="cov-check-meta">
                      Menulink:{' '}
                      {nameSearch.proposal.menu ? (
                        <a href={nameSearch.proposal.menu.url} target="_blank" rel="noopener noreferrer">
                          {nameSearch.proposal.menu.url}
                        </a>
                      ) : (
                        'nog geen menulink gevonden; die volgt bij het controleren.'
                      )}
                    </p>
                    <p className="cov-check-meta">Herkomst: {nameSearch.proposal.originLabel || 'zoekactie'}</p>
                    {nameSearch.proposal.quote ? <p className="mai-quote">“{nameSearch.proposal.quote}”</p> : null}
                    <p className="cov-check-meta">
                      {costLine({
                        costEurCents: nameSearch.cost ? nameSearch.cost.eurCents : null,
                        monthly: nameSearch.monthly,
                      })}
                    </p>
                    <a className="di-btn-primary mai-btn" href={nameSearch.proposal.onboardingHref}>
                      Toevoegen als nieuw restaurant
                    </a>
                    <p className="bta-muted" style={{ margin: 0 }}>
                      Er wordt niets automatisch aangemaakt: je bevestigt op de volgende stap zelf. Daar start ook de
                      controle van de menukaart; daarna kun je in dezelfde rij &quot;Lees met AI&quot; gebruiken.
                    </p>
                  </section>
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
            {/* BE-35 (#84, criterion 1): a confirmed link is what "Controleer"
                uses here too, and the screen says so before the click. */}
            {confirmedCheck && confirmedCheck.url ? (
              <p className="bta-muted cov-check-why">
                Bevestigde link: {confirmedCheck.url} ({CHECK_URL_SOURCE_LABELS[confirmedCheck.from] || 'bevestigd'}) ·
                die gebruikt &quot;Controleer&quot;.
              </p>
            ) : null}
          </div>

          {/* BE-32 (#75, criterion 2): the mockup's "Geen link bij de hand?" box. */}
          <div className="mai-discovery">
            <p className="bta-muted" style={{ margin: 0 }}>
              Geen link bij de hand? OpenStreetMap, eigen website, daarna AI.
            </p>
            <button
              type="button"
              className="stg-btn-secondary mai-btn"
              disabled={discoveryBusy || !selectedRestaurant}
              onClick={findSource}
            >
              {discoveryBusy ? '✨ Bezig…' : '✨ Zoek de bron voor mij'}
            </button>
            {/* BE-34 (#81, criterion 4): the app shows what it is doing, and a
                failure keeps the reason in plain language plus one retry. */}
            {discoveryBusy ? (
              <p className="bta-muted cov-loading" role="status" aria-live="polite" style={{ margin: 0 }}>
                <span className="cov-spinner" aria-hidden="true" />
                {ROW_SEARCHING}
                {selectedRestaurant ? ` ${selectedRestaurant.name}` : ''}
              </p>
            ) : null}
            {discoveryFailed && !discoveryBusy ? (
              <button type="button" className="stg-btn-secondary mai-btn" onClick={findSource}>
                Opnieuw proberen
              </button>
            ) : null}
            <p className="bta-muted" style={{ margin: 0 }}>
              {selectedRestaurant
                ? 'Alles wat je krijgt is een voorstel; jij bevestigt het per rij.'
                : 'Kies eerst het restaurant hierboven.'}{' '}
              Kaartgegevens: {OSM_ATTRIBUTION}.
            </p>
          </div>

          {prefill && (prefill.adres || prefill.naam) ? (
            <p className="bta-muted">
              Ingevuld uit OpenStreetMap{prefill.naam ? `: ${prefill.naam}` : ''}
              {prefill.adres ? ` · ${prefill.adres}` : ''}. Controleer de gegevens voordat je verdergaat; er is nog
              niets toegevoegd.
            </p>
          ) : null}

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

        {discovery ? (
          <section className="brn-detail-card" style={{ marginTop: 20 }} aria-labelledby="add-discovery-title">
            <h2 id="add-discovery-title" className="brn-detail-title">
              Gevonden bron · dezelfde rijen als in Dekking
            </h2>
            {discovery.summary ? <p className="brn-batch-summary">{discovery.summary}</p> : null}
            <p className="brn-batch-summary">
              {discovery.cost && Number.isInteger(discovery.cost.eurCents)
                ? `Kosten AI: ${discovery.cost.eurCents} cent van je maandbudget.`
                : 'Kosten AI: niets gemeten voor deze zoekactie.'}
            </p>
            {discovery.messages.map((text) => (
              <p key={text} className="brn-batch-summary">
                {text}
              </p>
            ))}
            {discoveryNotice ? (
              <div className="di-banner di-banner-info" role="status">
                {discoveryNotice}
              </div>
            ) : null}
            <ol className="srr-list" aria-label="Gevonden bron">
              {discovery.results.map((result) => {
                const row = discoveryRow(result)
                return (
                  <SourceResultRow
                    key={result.restaurantId}
                    row={row}
                    onConfirm={() => confirmDiscoveryProposal(result)}
                    busy={busy}
                  />
                )
              })}
            </ol>
            <p className="brn-notice">
              {CHECK_COPY.nothingPublished} Kaartgegevens: {OSM_ATTRIBUTION}.
            </p>
          </section>
        ) : null}

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
                const row = rowForBatchItem(item, { batchId: activeBatch.batch.id, now: new Date(), aiReady: aiReadReady(aiStatus), aiStatus })
                const returnTo = `/internal/toevoegen?batch=${encodeURIComponent(activeBatch.batch.id)}`
                return (
                  <SourceResultRow
                    key={`${item.position}-${item.jobId || item.key}`}
                    row={row}
                    position={item.position}
                    href={stepHref(row, { batchId: activeBatch.batch.id, returnTo })}
                    onConfirm={confirmRow}
                    onRecheck={recheck}
                    onAiRead={aiRead.read}
                    onOpenAiRead={aiRead.open}
                    aiRead={aiRead.stateFor(row)}
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
