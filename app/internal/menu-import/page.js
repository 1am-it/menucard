'use client'

// #59 fase 2 — handmatige AI-import in drie stappen.
// Ontwerp: docs/mockups/manual-ai-import-v3.html; spec:
// planning/specs/tickets/menu-extraction-manual-ai-import.md.
//
// De app roept zelf geen AI aan. Stap 1 maakt een prompt uit de vastgepinde
// instructie en de veilig gelezen bronnen, stap 2 neemt het geplakte antwoord
// als onbetrouwbare data aan en stap 3 laat een mens elke afwijking nalopen.
// Er is geen accepteer-alles en opslaan kan pas zonder open punten. De prompt
// en het antwoord worden niet in de browseropslag bewaard en er wordt nooit
// JSON uit het antwoord getoond.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import AiMenuReadBlock from '@/src/components/AiMenuReadBlock'
import MenuSourceMap from '@/src/components/MenuSourceMap'
import { aiHandoffKeyFromSearch, takeAiRead } from '@/src/lib/aiReadFlow'

const API = '/api/internal/v1/manual-menu-import'
const AI_API = '/api/internal/v1/menu-ai-import'
const AI_CHOICES = ['ChatGPT', 'Claude', 'Gemini', 'Copilot']
const MISSING_REASONS = [
  ['niet_in_bron', 'Niet in de bron gevonden'],
  ['scan_onleesbaar', 'Scan of afbeelding onleesbaar'],
  ['bron_gewijzigd', 'Bron is intussen gewijzigd'],
  ['verkeerde_kaart', 'Hoort bij een andere kaart of vestiging'],
  ['anders', 'Anders, zie toelichting'],
]

function bytesOf(text) {
  if (typeof TextEncoder === 'undefined') return text.length
  return new TextEncoder().encode(text).length
}

function clockOf(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function sourceLine(source) {
  if (source.status === 'blocked') return 'robots.txt staat ophalen niet toe'
  if (source.status === 'failed') return 'niet opgehaald'
  return source.hasText ? 'gaat mee in de prompt' : 'voeg het bestand zelf toe'
}

function stateBadge(row) {
  if (row.state === 'valid') return { tone: 'positive', label: 'in orde' }
  if (row.state === 'error') return { tone: 'blocked', label: 'staat niet in de bron' }
  if (row.state === 'unverifiable') return { tone: 'old', label: row.label || 'uit scan, controleer' }
  // W6: no price in the source. The human decides; the dish is never stored
  // with a made-up amount.
  if (row.state === 'review') return { tone: 'old', label: row.label || 'prijs onbekend' }
  if (row.code === 'price_variant') return { tone: 'old', label: 'twee prijzen' }
  if (row.code === 'supplement_as_main_price') return { tone: 'old', label: 'is een toeslag' }
  return { tone: 'old', label: 'niet op te slaan' }
}

export default function ManualMenuImportPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined)
  const [restaurantQuery, setRestaurantQuery] = useState('')
  const [restaurantChoices, setRestaurantChoices] = useState([])
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)
  const [pendingRestaurantId, setPendingRestaurantId] = useState('')
  const [urls, setUrls] = useState('')
  const [bundle, setBundle] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [expired, setExpired] = useState(false)
  const [aiChoice, setAiChoice] = useState('Claude')
  const [aiOther, setAiOther] = useState('')
  const [answer, setAnswer] = useState('')
  const [pasteSummary, setPasteSummary] = useState(null)
  const [stateToken, setStateToken] = useState('')
  const [validUntil, setValidUntil] = useState(null)
  const [report, setReport] = useState(null)
  const [review, setReview] = useState(null)
  const [received, setReceived] = useState(null)
  const [reasonFor, setReasonFor] = useState(null)
  const [reasonCode, setReasonCode] = useState('niet_in_bron')
  const [reasonNote, setReasonNote] = useState('')
  const [correctFor, setCorrectFor] = useState(null)
  const [correction, setCorrection] = useState({ name: '', description: '', price: '', path: '' })
  const [variantChoice, setVariantChoice] = useState({})
  const [askFor, setAskFor] = useState(null)
  const [askPrompt, setAskPrompt] = useState('')
  const [askAnswer, setAskAnswer] = useState('')
  const [allPrompt, setAllPrompt] = useState('')
  const [allAnswer, setAllAnswer] = useState('')
  const [saved, setSaved] = useState(null)
  // U1/U2 (review 6376543234): een afgekeurd antwoord levert hooguit vijf
  // leesbare punten plus één kopieerbare herstelvraag. Alleen deze stap bewaart
  // dat; er komt geen nieuwe opslag of toestandsvorm bij.
  const [answerProblems, setAnswerProblems] = useState(null)
  // W1/W5 (Lead review 6380804419): "Lees met AI" is an extra way in on this
  // page. The server decides whether AI is configured and what this month
  // already cost; the page only shows it and passes one click through.
  const [aiStatus, setAiStatus] = useState(null)
  const [aiStatusError, setAiStatusError] = useState(false)
  const [aiPhase, setAiPhase] = useState('idle')
  const [aiResult, setAiResult] = useState(null)
  const [aiError, setAiError] = useState(null)
  const [aiJobId, setAiJobId] = useState('')
  // BE-34 (#81, criterion 3): one confirmation for "Alles nagelopen" on the
  // dishes of an image reading. It names the exact number; nothing is decided
  // before that click.
  const [bulkConfirm, setBulkConfirm] = useState(false)
  // Y2 (Lead review 6381657192): with AI configured the reading is the primary
  // route and the manual three-step import is collapsed behind one link. A
  // finished reading keeps those steps collapsed; the review card only opens
  // after the explicit "Nalopen" click (or after a manual check).
  const [manualOpen, setManualOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  // Variant 5 (Lead order 6382953597): the review opens as the list and shows
  // the original card with markings on request. One page of one source is
  // fetched only when the human looks at it.
  const [viewMode, setViewMode] = useState('list')
  const [mapCard, setMapCard] = useState(null)
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState(null)
  const [mapSource, setMapSource] = useState('')
  const [mapPage, setMapPage] = useState(1)
  const [openMark, setOpenMark] = useState('')
  const [focusMark, setFocusMark] = useState('')
  const autoStarted = useRef(false)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/internal/login')
      else setSession(data.session)
    })
    const params = new URLSearchParams(window.location.search)
    // BE-34 (#81, criterion 1): "Bekijk en controleer" in a result row hands one
    // finished reading to this screen. It is the same sealed state token, report
    // and review this page already works with; it is read once and removed, so a
    // reload shows the same screen as closing and reopening it. Nothing is read
    // again and no second AI call is made.
    const handoffKey = aiHandoffKeyFromSearch(window.location.search)
    if (handoffKey) {
      const handoff = takeAiRead(window.sessionStorage, handoffKey)
      if (handoff) {
        setAiResult(handoff)
        setReport(handoff.import || null)
        setReview(handoff.review || null)
        setReceived(handoff.import && handoff.import.summary ? handoff.import.summary : null)
        setStateToken(handoff.state)
        setValidUntil(handoff.validUntil || null)
        setAiPhase('done')
        setReviewOpen(true)
      }
    }
    const id = params.get('restaurant')
    const name = params.get('name')
    if (id && name) setSelectedRestaurant({ id, name })
    else if (id) setPendingRestaurantId(id)
    if (params.get('url')) setUrls(params.get('url'))
    // W1: a failing analysis job opens this page as the allowed source.
    if (params.get('job')) setAiJobId(params.get('job'))
  }, [router])

  const token = session && session.access_token
  const aiName = aiChoice === 'Anders' ? aiOther.trim() : aiChoice
  const restaurantId = selectedRestaurant ? selectedRestaurant.id : ''
  const restaurantName = selectedRestaurant ? selectedRestaurant.name : ''
  // While the server status is still loading the manual flow stays visible; it
  // only collapses once the server confirms that AI is available. Without a key
  // or flag the manual flow is exactly the old one and stays directly visible.
  const aiConfigured = Boolean(aiStatus && aiStatus.enabled)
  const aiNotConfigured = Boolean(aiStatusError || (aiStatus && !aiStatus.enabled))
  const manualVisible = !aiConfigured || manualOpen
  const reviewVisible = !aiConfigured || manualOpen || reviewOpen
  // BB3 (Lead review 6384867373): the step numbers follow the steps the human
  // actually sees. With AI the visible order is Bron kiezen (1), the AI card (2)
  // and Nalopen en opslaan (3); the manual route, when it is opened, takes 2 and
  // 3 and the review becomes 4. Without AI the old numbering is unchanged.
  const aiStep = manualVisible ? null : 2
  const reviewStep = aiConfigured && !manualVisible ? 3 : aiConfigured ? 4 : 3

  const api = useCallback(
    async (path, body, method = 'POST') => {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, status: res.status, error: data.error || 'Er ging iets mis.', reason: data.reason, data }
      return { ok: true, data }
    },
    [token]
  )

  function handleFailure(result) {
    setError(result.error)
    // U1/U2: alleen een afgekeurd antwoord met leesbare punten vult het
    // herstelblok. Ontbreekt die uitleg, dan blijft het bij de gewone melding.
    const groups = result.data && Array.isArray(result.data.problemSummary) ? result.data.problemSummary : []
    const question = result.data && typeof result.data.recoveryQuestion === 'string' ? result.data.recoveryQuestion : ''
    const problems = result.data && Array.isArray(result.data.problems) ? result.data.problems : []
    const omitted = result.data && Number.isInteger(result.data.problemSummaryOmitted) ? result.data.problemSummaryOmitted : 0
    // Het inklapbare detail toont dezelfde regels die de validator teruggaf,
    // inclusief de regelgebonden fouten uit de groepen. Niets technisch komt in
    // de hoofdtekst.
    const technical = [
      ...new Set([
        ...problems,
        ...(Array.isArray(groups) ? groups.flatMap((group) => (group && Array.isArray(group.technical) ? group.technical : [])) : []),
      ]),
    ].filter((entry) => typeof entry === 'string')
    setAnswerProblems(
      groups.length > 0
        ? {
            groups: groups.slice(0, 5).filter((group) => group && typeof group.text === 'string'),
            question,
            omitted,
            technical,
          }
        : null
    )
    // Een verlopen of ongeldig token is geen technische fout: de medewerker
    // maakt gewoon een nieuwe prompt. De knop daarvoor staat in de melding.
    if (typeof result.reason === 'string' && result.reason.startsWith('state_')) setExpired(true)
  }

  function adoptStep(data) {
    if (data && typeof data.state === 'string') setStateToken(data.state)
    if (data && data.validUntil) setValidUntil(data.validUntil)
    setExpired(false)
  }

  // K3: zoeken op naam in de bestaande statische restaurantlijst. De server
  // levert alleen id, naam en buurt; de pagina laadt nooit de hele dataset.
  useEffect(() => {
    if (!session) return undefined
    const query = restaurantQuery.trim()
    if (query.length < 2 || (selectedRestaurant && selectedRestaurant.name === restaurantQuery)) {
      setRestaurantChoices([])
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const res = await fetch(`${API}/restaurants?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }).catch(() => null)
      if (cancelled || !res) return
      const data = await res.json().catch(() => ({}))
      if (cancelled) return
      setRestaurantChoices(res.ok && Array.isArray(data.restaurants) ? data.restaurants : [])
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [restaurantQuery, token, session, selectedRestaurant])

  // Een link met alleen een restaurantnummer: de naam komt uit dezelfde lijst,
  // zodat de medewerker nooit een leeg of zelfbedacht restaurant ziet.
  useEffect(() => {
    if (!session || !pendingRestaurantId || selectedRestaurant) return undefined
    let cancelled = false
    fetch(`${API}/restaurants?id=${encodeURIComponent(pendingRestaurantId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !data.restaurant) return
        setSelectedRestaurant(data.restaurant)
        setRestaurantQuery(data.restaurant.name)
        setPendingRestaurantId('')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [session, pendingRestaurantId, selectedRestaurant, token])

  function chooseRestaurant(choice) {
    setSelectedRestaurant(choice)
    setRestaurantQuery(choice.name)
    setRestaurantChoices([])
    setError(null)
  }

  function changeRestaurantQuery(value) {
    setRestaurantQuery(value)
    if (selectedRestaurant && value !== selectedRestaurant.name) setSelectedRestaurant(null)
  }

  function acceptPastedText(text) {
    const value = typeof text === 'string' ? text : ''
    if (value.trim() === '') return
    setAnswer(value)
    setPasteSummary({ chars: value.length, bytes: bytesOf(value) })
    setReceived(null)
  }

  function clearPasted() {
    setAnswer('')
    setPasteSummary(null)
  }

  async function makePrompt() {
    setBusy(true)
    setError(null)
    setMessage(null)
    setBundle(null)
    setPrompt('')
    setReport(null)
    setReview(null)
    setSaved(null)
    setStateToken('')
    setValidUntil(null)
    setExpired(false)
    setAnswerProblems(null)
    const list = urls.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5)
    const result = await api('/bundles', { restaurant_id: restaurantId, urls: list })
    if (!result.ok) handleFailure(result)
    else {
      setBundle(result.data.bundle)
      setPrompt(result.data.prompt.text)
      adoptStep(result.data)
      setMessage('Prompt gemaakt. Kopieer hem en plak hem in de AI.')
    }
    setBusy(false)
  }

  async function copyPrompt() {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setMessage('Prompt gekopieerd. Er is niets opgeslagen in de browser.')
    } catch {
      setMessage('Kopiëren lukte niet automatisch. Open de prompt hieronder en kopieer hem zelf.')
    }
  }

  // U2: de herstelvraag is gewone tekst, dus altijd zelf te selecteren. De knop
  // kopieert precies dezelfde tekst; mislukt dat, dan zegt de melding wat te doen.
  async function copyRecoveryQuestion() {
    const question = answerProblems && answerProblems.question
    if (!question) return
    try {
      await navigator.clipboard.writeText(question)
      setMessage('Herstelvraag gekopieerd. Plak hem in dezelfde AI en vraag om het volledige antwoord opnieuw.')
    } catch {
      setMessage('Kopiëren lukte niet automatisch. Selecteer de herstelvraag hierboven en kopieer hem zelf.')
    }
  }

  async function checkAnswer() {
    setBusy(true)
    setError(null)
    setMessage(null)
    setAnswerProblems(null)
    const result = await api('/imports', { state: stateToken, bundle_hash: bundle.bundleHash, ai_name: aiName, answer })
    if (!result.ok) handleFailure(result)
    else {
      setReport(result.data.import)
      setReview(result.data.review)
      setReceived(result.data.import.summary)
      adoptStep(result.data)
      setAnswer('')
      setPasteSummary(null)
      // A finished manual check opens the review card, as before. With AI this
      // is the explicit manual route; a normal AI reading opens it only through
      // "Nalopen" (Y2).
      setReviewOpen(true)
    }
    setBusy(false)
  }

  /**
   * BE-34 (#81, criterion 3): "Alles nagelopen" for the dishes of an image
   * reading. The number that was shown goes to the server; the server decides
   * with its own count and records one human decision per dish. There is no
   * "alles accepteren": rows with their own point (a price variant, an evidence
   * error) keep their own step.
   */
  async function sendBulkReview() {
    const offer = review && review.bulkReview ? review.bulkReview : null
    if (!offer || !offer.available) return
    setBusy(true)
    setError(null)
    setMessage(null)
    const result = await api(`/imports/${report.importId}/decisions`, {
      state: stateToken,
      decision: { action: 'confirm_all_unverifiable', count: offer.count },
    })
    if (!result.ok) handleFailure(result)
    else {
      setReview(result.data.review)
      adoptStep(result.data)
      setBulkConfirm(false)
      setMessage(
        `${offer.count} ${offer.count === 1 ? 'gerecht' : 'gerechten'} nagelopen. Dat staat per gerecht vast; aanpassen kan nog via "Wijzig". Opslaan blijft een aparte stap.`,
      )
    }
    setBusy(false)
  }

  /**
   * "Wijzig" on one of those dishes: the human reopens that single row, so the
   * existing correction form decides it. Nothing else changes.
   */
  async function reopenRow(row) {
    setBusy(true)
    setError(null)
    setMessage(null)
    const result = await api(`/imports/${report.importId}/decisions`, {
      state: stateToken,
      decision: { action: 'reopen', rowId: row.id },
    })
    if (!result.ok) handleFailure(result)
    else {
      setReview(result.data.review)
      adoptStep(result.data)
      openCorrection(row)
      setMessage('Deze regel staat weer open. Pas aan of bevestig opnieuw; opslaan blijft een aparte stap.')
    }
    setBusy(false)
  }

  async function sendDecision(decision) {
    setBusy(true)
    setError(null)
    const result = await api(`/imports/${report.importId}/decisions`, { state: stateToken, decision })
    if (!result.ok) handleFailure(result)
    else {
      setReview(result.data.review)
      adoptStep(result.data)
      setReasonFor(null)
      setCorrectFor(null)
    }
    setBusy(false)
  }

  /**
   * Variant 1 (Lead order 6382189724): one choice on one source line that no
   * dish covers. The server compares again from its own capture; the screen
   * sends only the line id and the choice.
   */
  async function sendUncovered(line, action) {
    setBusy(true)
    setError(null)
    setMessage(null)
    const result = await api(`/imports/${report.importId}/decisions`, { state: stateToken, decision: { action, lineId: line.id } })
    if (!result.ok) handleFailure(result)
    else {
      if (result.data.import) setReport(result.data.import)
      setReview(result.data.review)
      adoptStep(result.data)
      setMessage(
        action === 'add_uncovered'
          ? 'De regel staat nu als gerecht in het concept. Stel naam en menukopje bij waar nodig; opslaan blijft een aparte stap.'
          : 'Deze regel telt als geen gerecht. De keuze blijft bij het concept bewaard.'
      )
      // De kaart opnieuw lezen met het nieuwe token: hetzelfde beeld als de server.
      if (viewMode === 'map') loadCard(mapSource, mapPage, result.data.state)
    }
    setBusy(false)
  }

  /**
   * Variant 5 (Lead order 6382953597): one page of one source, on request. The
   * server compares again from its own capture; the screen only shows the page.
   */
  async function loadCard(sourceId, page, token = stateToken) {
    if (!report || !token || !sourceId) return
    setMapLoading(true)
    setMapError(null)
    const result = await api(`/imports/${report.importId}/source-map`, { state: token, source_id: sourceId, page })
    if (!result.ok) {
      setMapCard(null)
      setMapError(result.error || 'De kaartpagina kon niet worden geladen.')
    } else {
      setMapCard(result.data.card)
      setMapSource(sourceId)
      setMapPage(result.data.card.page.number)
    }
    setMapLoading(false)
  }

  function showMap(sourceId, page, markId) {
    const map = review && review.sourceMap
    if (!map || map.available !== true) return
    const fallback = map.sources[0] ? map.sources[0].id : ''
    const nextSource = sourceId || mapSource || fallback
    const nextPage = Number.isInteger(page) && page > 0 ? page : 1
    setViewMode('map')
    setMapSource(nextSource)
    setMapPage(nextPage)
    setOpenMark(markId || '')
    setFocusMark(markId || '')
    if (!mapCard || mapCard.source.id !== nextSource || mapCard.page.number !== nextPage) {
      loadCard(nextSource, nextPage)
    }
  }

  /** "Bekijk op kaart" bij een gerecht: dezelfde regel, gemarkeerd en in beeld. */
  function openMarkOnMap(row) {
    const map = review && review.sourceMap
    if (!map || map.available !== true) return
    const mark = (map.marks || []).find((entry) => entry.rowId === row.id)
    if (!mark) return
    showMap(mark.sourceId, mark.page, mark.id)
  }

  /** Z4: "Neem € x over" — de server leest de prijs zelf uit de kaart. */
  async function sendTakePrice(mark) {
    setBusy(true)
    setError(null)
    setMessage(null)
    const result = await api(`/imports/${report.importId}/decisions`, {
      state: stateToken,
      decision: { action: 'take_source_price', lineId: mark.id, rowId: mark.rowId },
    })
    if (!result.ok) handleFailure(result)
    else {
      setReview(result.data.review)
      adoptStep(result.data)
      setMessage(
        `De prijs van de kaart (${mark.priceText}) staat nu bij dit gerecht. Bij opslaan krijgt het concept die prijs; opslaan blijft een aparte stap.`,
      )
      // De kaart opnieuw lezen met het nieuwe token, zodat het paneel de
      // overgenomen prijs toont en niet de stand van vóór de beslissing.
      if (viewMode === 'map') loadCard(mapSource, mapPage, result.data.state)
    }
    setBusy(false)
  }

  /** Z4: "Wijzig" opent het bestaande correctieformulier in de lijst. */
  function correctFromMap(mark) {
    const row = review && Array.isArray(review.rows) ? review.rows.find((entry) => entry.id === mark.rowId) : null
    if (!row) return
    setViewMode('list')
    setOpenMark('')
    openCorrection(row)
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        const element = document.getElementById(`mai-row-${row.id}`)
        if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center', behavior: 'instant' })
      }, 0)
    }
  }

  // BE-33 (#79): "Nalopen in de lijst" from the image card goes to the same
  // review row, in the list where the human decides. Nothing is decided here.
  function showRowFromMap(rowId) {
    setViewMode('list')
    setOpenMark('')
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        const element = document.getElementById(`mai-row-${rowId}`)
        if (!element) return
        if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
        if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center', behavior: 'instant' })
        if (typeof element.focus === 'function') element.focus({ preventScroll: true })
      }, 0)
    }
  }

  // Na "Bekijk op kaart" of een paginawissel: de gemarkeerde regel in beeld.
  useEffect(() => {
    if (!mapCard || !focusMark) return
    const element = document.querySelector(`[data-mark-id="${focusMark}"]`)
    if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [mapCard, focusMark])

  function openReason(row) {
    setReasonFor(row.id)
    setReasonCode('niet_in_bron')
    setReasonNote('')
  }

  function openCorrection(row) {
    setCorrectFor(row.id)
    setCorrection({ name: row.name || '', description: row.description || '', price: '', path: row.pathLabel || '' })
  }

  async function submitCorrection(row) {
    const corrected = { name: correction.name, description: correction.description }
    if (correction.price.trim() !== '') corrected.price = correction.price
    if (correction.path.trim() !== '') corrected.path = correction.path.split('›').map((label) => label.trim()).filter(Boolean)
    await sendDecision({ rowId: row.id, action: 'correct', corrected })
  }

  async function askAi(row) {
    setBusy(true)
    setError(null)
    setAskFor(row.id)
    setAskAnswer('')
    const result = await api(`/imports/${report.importId}/follow-up`, { state: stateToken, row_id: row.id })
    if (!result.ok) {
      handleFailure(result)
      setAskFor(null)
    } else {
      setAskPrompt(result.data.prompt.text)
      if (result.data.validUntil) setValidUntil(result.data.validUntil)
    }
    setBusy(false)
  }

  async function submitAsk(row) {
    setBusy(true)
    setError(null)
    const result = await api(`/imports/${report.importId}/follow-up`, { state: stateToken, row_id: row.id, answer: askAnswer })
    if (!result.ok) handleFailure(result)
    else {
      setReport(result.data.import)
      setReview(result.data.review)
      adoptStep(result.data)
      setAskFor(null)
      setAskPrompt('')
      setAskAnswer('')
      setMessage('Het antwoord is gecontroleerd. Alleen deze regel is bijgewerkt; jij beslist daarna.')
    }
    setBusy(false)
  }

  async function askAllOpen() {
    setBusy(true)
    setError(null)
    setAllPrompt('')
    setAllAnswer('')
    const result = await api(`/imports/${report.importId}/open-points`, { state: stateToken })
    if (!result.ok) handleFailure(result)
    else {
      setAllPrompt(result.data.prompt.text)
      if (result.data.validUntil) setValidUntil(result.data.validUntil)
    }
    setBusy(false)
  }

  async function submitAllOpen() {
    setBusy(true)
    setError(null)
    const result = await api(`/imports/${report.importId}/open-points`, { state: stateToken, answer: allAnswer })
    if (!result.ok) handleFailure(result)
    else {
      setReport(result.data.import)
      setReview(result.data.review)
      adoptStep(result.data)
      setAllPrompt('')
      setAllAnswer('')
      setMessage('De antwoorden zijn per regel gecontroleerd. Jij beslist daarna per regel.')
    }
    setBusy(false)
  }

  async function saveConcept() {
    setBusy(true)
    setError(null)
    const result = await api(`/imports/${report.importId}/save`, { state: stateToken })
    if (!result.ok) handleFailure(result)
    else {
      setSaved(result.data.concept)
      setMessage(
        result.data.concept && result.data.concept.unchanged
          ? `Het concept is ongewijzigd (versie ${result.data.concept.version}). Publiceren blijft een aparte stap.`
          : `Concept opgeslagen als versie ${result.data.concept && result.data.concept.version}. Het wacht op interne controle. Publiceren blijft een aparte stap.`
      )
    }
    setBusy(false)
  }

  // W5 + Y2: the "Nalopen" button of the AI reading opens the existing review
  // step. The card is mounted first, then scrolled to on the next frame.
  function focusReview() {
    setReviewOpen(true)
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      const target = document.getElementById('mai-s3')
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (target && typeof target.focus === 'function') target.focus()
    })
  }

  // Y2: "Liever zelf invoeren of plakken" expands the old manual steps in place.
  function toggleManual() {
    setManualOpen((open) => !open)
  }

  // W1/W3/W4: does the server offer AI, and what did this month already cost?
  // BB3 (Lead review 6384867373): the same read refreshes the month line after
  // every reading, so a call of one cent shows up at once instead of leaving
  // "€ 0,00 van € 10,00" on screen. It lives above `readWithAi`, because that
  // callback depends on it.
  const loadAiStatus = useCallback(async () => {
    if (!token) return null
    try {
      const res = await fetch(AI_API, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const data = res.ok ? await res.json() : null
      if (!data) {
        setAiStatusError(true)
        return null
      }
      setAiStatus(data)
      setAiStatusError(false)
      return data
    } catch {
      setAiStatusError(true)
      return null
    }
  }, [token])

  useEffect(() => {
    loadAiStatus()
  }, [loadAiStatus])

  /**
   * W2/W5: one click on "Lees met AI". The route only accepts an existing
   * capture (the sealed bundle of step 1) or an existing analysis job — a URL is
   * never sent. There is no automatic retry, so a failure never costs twice.
   */
  const readWithAi = useCallback(
    async ({ jobId = '' } = {}) => {
      setBusy(true)
      setAiError(null)
      setError(null)
      setMessage(null)
      setAiPhase('reading')
      setReviewOpen(false)
      try {
        let payload
        if (jobId) {
          payload = { job_id: jobId, ...(restaurantId ? { restaurant_id: restaurantId } : {}) }
        } else {
          const list = urls.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5)
          if (!restaurantId || list.length === 0) {
            setAiPhase('idle')
            setAiError('Kies eerst een restaurant en een bron-URL.')
            return
          }
          const created = await api('/bundles', { restaurant_id: restaurantId, urls: list })
          if (!created.ok) {
            handleFailure(created)
            setAiPhase('error')
            setAiError(created.error)
            return
          }
          setBundle(created.data.bundle)
          setPrompt(created.data.prompt.text)
          adoptStep(created.data)
          payload = { state: created.data.state }
        }
        const res = await fetch(AI_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setAiPhase('error')
          setAiError(data.error || 'De AI-lezing lukte niet.')
          // BB3: a refused call can still have cost money, so the month line is
          // taken from the answer and then confirmed by the server.
          if (data.monthly) {
            setAiStatus((current) => (current ? { ...current, monthly: data.monthly } : current))
          }
          await loadAiStatus()
          return
        }
        setAiResult(data)
        setReport(data.import)
        setReview(data.review)
        setReceived(data.import.summary)
        adoptStep(data)
        setAiPhase('done')
        // BB3 (Lead review 6384867373): a reading of one cent must be visible in
        // "AI deze maand" at once. The answer already carries the new total; the
        // server read right after it confirms the durable state.
        if (data.monthly) {
          setAiStatus((current) => (current ? { ...current, monthly: data.monthly } : current))
        }
        await loadAiStatus()
        // Y2: the result is reported by the AI card itself. A second page-level
        // banner would duplicate it above the source card, so it is not set.
      } catch {
        setAiPhase('error')
        setAiError('De AI-lezing lukte niet. Ga verder met de handmatige import.')
      } finally {
        setBusy(false)
      }
    },
    [api, loadAiStatus, restaurantId, token, urls]
  )

  // From the batch screen: the analysis job is the allowed source, so the
  // reading starts once for that job after the click that brought us here.
  useEffect(() => {
    if (!token || !aiJobId || autoStarted.current) return
    autoStarted.current = true
    readWithAi({ jobId: aiJobId })
  }, [token, aiJobId, readWithAi])

  const openRows = useMemo(
    () => (review && Array.isArray(review.rows) ? review.rows.filter((row) => !row.resolved) : []),
    [review]
  )
  const doneRows = useMemo(
    () =>
      review && Array.isArray(review.rows)
        ? review.rows.filter((row) => row.resolved && row.outcome !== 'exclude' && row.outcome !== 'exclude_supplement')
        : [],
    [review]
  )

  // Y2: the source choice belongs to both routes. With AI it is its own card
  // before the reading; without AI these fields stay inside step 1 exactly as
  // before, so the old manual flow is unchanged.
  const sourceFields = (
    <>
      <div className="mai-field">
        <label className="bta-label" htmlFor="mai-restaurant">
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
              }}
            >
              Wijzig
            </button>
          </div>
        ) : (
          <>
            <input
              id="mai-restaurant"
              className="mai-input"
              type="search"
              value={restaurantQuery}
              onChange={(event) => changeRestaurantQuery(event.target.value)}
              autoComplete="off"
              placeholder="Typ de naam van het restaurant"
              aria-describedby="mai-restaurant-help"
            />
            <p id="mai-restaurant-help" className="bta-muted">
              Kies uit de bestaande restaurantlijst. Deze kaart hoort bij dit restaurant en deze vestiging.
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
              <p className="bta-muted">Geen restaurant gevonden met deze naam.</p>
            ) : null}
          </>
        )}
      </div>
      <div className="mai-field">
        <label className="bta-label" htmlFor="mai-urls">
          Bron-URL&apos;s (één per regel, maximaal 5)
        </label>
        <textarea
          id="mai-urls"
          className="bta-textarea mai-urls"
          value={urls}
          onChange={(event) => setUrls(event.target.value)}
          spellCheck="false"
        />
        <p className="bta-muted">Gebruik de pagina waar de menukaart staat, niet alleen de homepage.</p>
      </div>
    </>
  )


  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main bta-main">Laden…</main>
      </div>
    )
  }

  return (
    <div className="di-page">
      <main className="di-main bta-main">
        <InternalNav accessToken={session.access_token} />
        <nav aria-label="Kruimelpad" className="bta-breadcrumb">
          <span>Werkvoorraad</span>
          <span aria-hidden="true">/</span>
          <span>Bronnen beoordelen</span>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Menu importeren</span>
        </nav>
        <div className="bta-header">
          <div className="bta-title-row">
            <h1 className="di-title">Menu importeren met AI</h1>
            <span className="bta-tag">Alleen intern</span>
          </div>
          <p className="bta-muted">
            {restaurantName || 'Restaurant'} · drie stappen · het antwoord van de AI is een voorstel, geen bewijs
          </p>
        </div>

        {/* Y2: without a key or flag the page keeps the old manual flow and
            says so quietly, without a card or a disabled button. */}
        {aiNotConfigured ? (
          <p className="mai-why" role="status">
            AI is niet ingesteld.
          </p>
        ) : null}

        {error ? (
          <div className="di-banner di-banner-danger" role="alert">
            <span>{error}</span>
            {expired ? (
              <button
                type="button"
                className="di-btn-primary mai-btn"
                onClick={makePrompt}
                disabled={busy || !restaurantId || !urls.trim()}
              >
                Opnieuw maken
              </button>
            ) : null}
          </div>
        ) : null}
        {message ? (
          <div className="di-banner di-banner-info" role="status">
            <span>{message}</span>
          </div>
        ) : null}
        {/* U1/U2: wat de AI moet herstellen, in gewone taal, met één
            kopieerbare vervolgvraag. De technische regels staan ingeklapt. */}
        {answerProblems ? (
          <section className="mai-panel mai-problems" aria-labelledby="mai-problems-title">
            <h2 id="mai-problems-title" className="mai-panel-title">
              Wat de AI moet herstellen
            </h2>
            <ol className="mai-problem-list">
              {answerProblems.groups.map((group, index) => (
                <li key={`${group.code}-${index}`}>{group.text}</li>
              ))}
            </ol>
            {answerProblems.omitted > 0 ? (
              <p className="bta-muted">
                Er zijn nog {answerProblems.omitted} andere soorten problemen; die staan in de technische details.
              </p>
            ) : null}
            {answerProblems.question ? (
              <>
                <label className="bta-label" htmlFor="mai-recovery">
                  Vervolgvraag aan de AI (kopieer en plak in dezelfde AI)
                </label>
                <textarea
                  id="mai-recovery"
                  className="mai-input mai-recovery"
                  readOnly
                  rows={6}
                  value={answerProblems.question}
                />
                <div className="mai-actions">
                  <button type="button" className="di-btn-primary mai-btn" onClick={copyRecoveryQuestion} disabled={busy}>
                    Kopieer herstelvraag
                  </button>
                  <p className="bta-muted">Plak het nieuwe antwoord daarna opnieuw in stap 2.</p>
                </div>
              </>
            ) : null}
            {answerProblems.technical.length > 0 ? (
              <details className="mai-details">
                <summary>Technische details</summary>
                <ul className="mai-done-list">
                  {answerProblems.technical.map((entry, index) => (
                    <li key={`technical-${index}`}>
                      <code>{entry}</code>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}

        <div className="mai-steps">
          {aiConfigured ? (
            <>
              <section className="bta-card" aria-labelledby="mai-bron">
                <div className="mai-step-head">
                  <span className="step-num" aria-hidden="true">
                    1
                  </span>
                  <h2 id="mai-bron" className="mai-step-title">
                    Bron kiezen
                  </h2>
                </div>
                {sourceFields}
              </section>

              {/* Y2: the AI reading is a standalone card right after the
                  source choice, never inside the manual "Prompt maken" step. */}
              <AiMenuReadBlock
                status={aiStatus}
                statusError={aiStatusError}
                phase={aiPhase}
                result={aiResult}
                error={aiError}
                busy={busy}
                step={aiStep}
                canRead={Boolean(restaurantId) || Boolean(aiJobId)}
                hint="Kies eerst een restaurant en een bron-URL."
                manualOpen={manualOpen}
                onManual={toggleManual}
                onRead={() => readWithAi({ jobId: aiJobId })}
                onReview={focusReview}
              />
            </>
          ) : null}

          {manualVisible ? (
            <div id="mai-manual" className="mai-steps mai-manual">
                <section className="bta-card" aria-labelledby="mai-s1">
                  <div className="mai-step-head">
                    <span className="step-num" aria-hidden="true">
                      {aiConfigured ? 2 : 1}
                    </span>
                    <h2 id="mai-s1" className="mai-step-title">
                      Prompt maken
                    </h2>
                  </div>
                  {aiConfigured ? null : sourceFields}

              <div className="mai-actions">
                <button type="button" className="di-btn-primary" onClick={makePrompt} disabled={busy || !restaurantId || !urls.trim()}>
                  Prompt maken
                </button>
                <span className="bta-muted">De app haalt de bronnen veilig op en zet de tekst in de prompt.</span>
              </div>

              {bundle ? (
                <>
                  <ul className="mai-source-list" aria-label="Bronnen in deze prompt">
                    {bundle.sources.map((source) => (
                      <li key={source.id} className={`mai-source ${source.hasText ? 'mai-source--ok' : 'mai-source--ask'}`}>
                        <span className="mai-source-mark" aria-hidden="true">
                          {source.hasText ? '✓' : '!'}
                        </span>
                        <span className="mai-source-name">
                          {source.id} · {source.kind === 'pdf' ? 'PDF' : source.kind === 'html' ? 'website' : 'bron'}
                        </span>
                        <span className="mai-source-line">{sourceLine(source)}</span>
                        <span className="mai-source-url">{source.url}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mai-actions">
                    <button type="button" className="di-btn-primary" onClick={copyPrompt}>
                      Kopieer prompt
                    </button>
                    <span className="bta-muted">Plak de prompt in de AI. Voeg een scan zelf toe; de rest gaat mee.</span>
                  </div>
                  {validUntil ? (
                    <p className="mai-validity">
                      Geldig tot {clockOf(validUntil)}. Daarna maak je gewoon een nieuwe prompt.
                    </p>
                  ) : null}
                  <details className="mai-details">
                    <summary>Technische details</summary>
                    <dl className="bta-facts">
                      <div>
                        <dt>Instructie</dt>
                        <dd>
                          {bundle.protocol.file} · v{bundle.protocol.version} · {bundle.protocol.hash.slice(0, 12)}…
                        </dd>
                      </div>
                      <div>
                        <dt>Schemaversie</dt>
                        <dd>
                          {bundle.protocol.schemaVersion} · {bundle.schemaVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>Exportbundel</dt>
                        <dd>
                          {bundle.bundleId} · {bundle.bundleHash.slice(0, 12)}…
                        </dd>
                      </div>
                      <div>
                        <dt>Geldig tot</dt>
                        <dd>{new Date(bundle.expiresAt).toLocaleString('nl-NL')}</dd>
                      </div>
                    </dl>
                    <details className="mai-details">
                      <summary>Bekijk de prompt</summary>
                      <pre className="mai-prompt" tabIndex="0">
                        {prompt}
                      </pre>
                    </details>
                    <p className="bta-muted">De prompt wordt niet gelogd en niet in de browseropslag bewaard.</p>
                  </details>
                </>
              ) : null}
            </section>


            <section className="bta-card" aria-labelledby="mai-s2">
              <div className="mai-step-head">
                <span className="step-num" aria-hidden="true">
                  {aiConfigured ? 3 : 2}
                </span>
                <h2 id="mai-s2" className="mai-step-title">
                  Antwoord plakken
                </h2>
              </div>
              <div className="mai-field">
                <label className="bta-label" htmlFor="mai-ai">
                  Welke AI gebruikte je?
                </label>
                <select
                  id="mai-ai"
                  className="mai-select"
                  value={aiChoice}
                  onChange={(event) => setAiChoice(event.target.value)}
                  aria-describedby="mai-ai-help"
                >
                  {AI_CHOICES.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                  <option value="Anders">Anders</option>
                </select>
                {aiChoice === 'Anders' ? (
                  <input
                    className="mai-input"
                    type="text"
                    value={aiOther}
                    maxLength={80}
                    placeholder="Vul de naam zelf in"
                    onChange={(event) => setAiOther(event.target.value)}
                    aria-label="Naam van de AI"
                  />
                ) : null}
                <p id="mai-ai-help" className="bta-muted">
                  Zelf ingevuld. De app kan niet zien welke AI je gebruikte; daarom staat er later &quot;zelfgerapporteerd&quot;.
                </p>
              </div>

              {received ? (
                <p className="mai-received" role="status">
                  ✓ Antwoord ontvangen: {received.menus} {received.menus === 1 ? 'menukaart' : 'menukaarten'}, {received.items}{' '}
                  {received.items === 1 ? 'gerecht' : 'gerechten'}
                </p>
              ) : null}

              <div className="mai-field">
                <label className="bta-label" htmlFor="mai-answer">
                  Plak hier het volledige antwoord
                </label>
                {pasteSummary ? (
                  <div className="mai-pasted">
                    <span role="status">
                      ✓ Antwoord geplakt ({pasteSummary.chars} tekens)
                    </span>
                    <button type="button" className="stg-btn-secondary mai-btn" onClick={clearPasted}>
                      Wissen
                    </button>
                  </div>
                ) : (
                  <textarea
                    id="mai-answer"
                    className="bta-textarea"
                    defaultValue=""
                    onPaste={(event) => {
                      const text = event.clipboardData ? event.clipboardData.getData('text') : ''
                      if (text) {
                        event.preventDefault()
                        acceptPastedText(text)
                      }
                    }}
                    onChange={(event) => {
                      const text = event.target.value
                      event.target.value = ''
                      if (text) acceptPastedText(text)
                    }}
                    spellCheck="false"
                    placeholder="Plak het hele antwoord. De app haalt het codeblok er zelf uit."
                    aria-describedby="mai-answer-help"
                  />
                )}
                <p id="mai-answer-help" className="bta-muted">
                  {pasteSummary ? `${pasteSummary.bytes} bytes` : 'Maximaal 1 MiB'} · groter dan de grens wordt niet gelezen. De app
                  toont nooit JSON uit het antwoord.
                </p>
              </div>
              <div className="mai-actions">
                <button
                  type="button"
                  className="di-btn-primary"
                  onClick={checkAnswer}
                  disabled={busy || !bundle || !answer.trim() || !aiName}
                >
                  Controleren
                </button>
                <span className="bta-muted">
                  Lukt het codeblok niet, dan zegt de app gewoon: kopieer alleen het codeblok. Je krijgt nooit een technische parsefout.
                </span>
              </div>
            </section>
            </div>
          ) : null}

          {reviewVisible ? (
            <section className="bta-card" aria-labelledby="mai-s3">
              <div className="mai-step-head">
                <span className="step-num" aria-hidden="true">
                  {reviewStep}
                </span>
                <h2 id="mai-s3" className="mai-step-title">
                  Nalopen en opslaan
                </h2>
              </div>

              {!review ? (
                <p className="bta-muted">Controleer eerst een antwoord. Daarna staan hier alleen de regels die aandacht vragen.</p>
              ) : (
                <>
                  <p className="mai-summary" role="status">
                    {review.summary.items} {review.summary.items === 1 ? 'gerecht' : 'gerechten'} · {review.summary.valid} in orde ·{' '}
                    {review.summary.pending} nalopen
                  </p>
                  {/* W6: which reading produced this review, with its own cost. */}
                  {aiResult ? (
                    <p className="mai-origin" role="status">
                      <span className="bta-tag">Gelezen door AI</span>
                      <span className="bta-muted">
                        {aiResult.ai && aiResult.ai.label ? aiResult.ai.label : 'AI-lezing'}
                        {aiResult.cost && aiResult.cost.known
                          ? ` · kosten € ${(aiResult.cost.eurCents / 100).toFixed(2).replace('.', ',')}`
                          : ' · kosten niet gemeten'}
                      </span>
                    </p>
                  ) : null}
                  {/* V2 (review 6377050602): wat het systeem zelf heeft bijgesteld.
                      Een telling of status die uit het antwoord zelf volgt, in
                      gewone taal. Niets wordt stil aangepast. */}
                  {Array.isArray(review.notices) && review.notices.length > 0 ? (
                    <div className="mai-notices" role="status">
                      <p className="mai-notices-title">Door het systeem bijgesteld</p>
                      <ul className="mai-notice-list">
                        {review.notices.map((notice) => (
                          <li key={notice}>{notice}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {/* Variant 5 (Lead order 6382953597): Lijst | Kaart. De kaart
                      toont de bron met markeringen; de lijst blijft de vaste
                      nalopen-weergave. Kleur is nooit de enige drager. */}
                  {review.sourceMap && review.sourceMap.available ? (
                    <div className="mai-view-toggle" role="group" aria-label="Weergave van de controle">
                      <button
                        type="button"
                        className={`mai-view-btn${viewMode === 'list' ? ' mai-view-btn--active' : ''}`}
                        aria-pressed={viewMode === 'list'}
                        onClick={() => {
                          setViewMode('list')
                          setOpenMark('')
                          setFocusMark('')
                        }}
                      >
                        Lijst
                      </button>
                      <button
                        type="button"
                        className={`mai-view-btn${viewMode === 'map' ? ' mai-view-btn--active' : ''}`}
                        aria-pressed={viewMode === 'map'}
                        onClick={() => showMap()}
                      >
                        Kaart
                      </button>
                    </div>
                  ) : null}
                  {viewMode === 'map' && review.sourceMap && review.sourceMap.available ? (
                    <MenuSourceMap
                      map={review.sourceMap}
                      card={mapCard}
                      cardError={mapError}
                      loading={mapLoading}
                      sourceId={mapSource || (review.sourceMap.sources[0] ? review.sourceMap.sources[0].id : '')}
                      page={mapPage}
                      openMarkId={openMark}
                      focusMarkId={focusMark}
                      busy={busy}
                      onSelectSource={(id) => showMap(id, 1, '')}
                      onPage={(page) => showMap(mapSource, page, '')}
                      onOpenMark={(id) => setOpenMark(openMark === id ? '' : id)}
                      onAdd={(mark) => sendUncovered({ id: mark.id }, 'add_uncovered')}
                      onNotDish={(mark) => sendUncovered({ id: mark.id }, 'uncovered_not_dish')}
                      onTakePrice={sendTakePrice}
                      onCorrect={correctFromMap}
                      onShowRow={showRowFromMap}
                    />
                  ) : null}
                  {viewMode === 'list' ? (
                    <>
                  {/* Variant 1 (Lead order 6382189724): the deterministic,
                      free comparison with the original menu. It sits above the
                      nalopen list, never below it. */}
                  {review.uncovered ? (
                    review.uncovered.available === false ? (
                      <p className="mai-uncovered-unavailable" role="status">
                        {review.uncovered.message}
                      </p>
                    ) : review.uncovered.total > 0 ? (
                      <section className="mai-uncovered" aria-labelledby="mai-uncovered-title">
                        <p id="mai-uncovered-title" className="mai-uncovered-title">
                          {review.uncovered.total}{' '}
                          {review.uncovered.total === 1
                            ? 'regel met een prijs staat niet in het concept'
                            : 'regels met een prijs staan niet in het concept'}
                        </p>
                        <ul className="mai-uncovered-list">
                          {review.uncovered.lines.map((line) => (
                            <li key={line.id} className="mai-uncovered-row">
                              <p className="mai-quote">“{line.text}”</p>
                              <p className="mai-why">
                                Pagina {line.sourceLabel} · {line.locator}
                                {line.section ? ` · onder ${line.section}` : ' · menukopje onbekend'}
                              </p>
                              <div className="mai-row-actions">
                                <button
                                  type="button"
                                  className="di-btn-primary mai-btn"
                                  disabled={busy}
                                  aria-label={`Toevoegen: ${line.text}`}
                                  onClick={() => sendUncovered(line, 'add_uncovered')}
                                >
                                  Toevoegen
                                </button>
                                <button
                                  type="button"
                                  className="stg-btn-secondary mai-btn"
                                  disabled={busy}
                                  aria-label={`Geen gerecht: ${line.text}`}
                                  onClick={() => sendUncovered(line, 'uncovered_not_dish')}
                                >
                                  Geen gerecht
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                        {review.uncovered.omitted > 0 ? <p className="mai-why">{review.uncovered.omittedLabel}</p> : null}
                        <p className="mai-uncovered-free">Gratis: geen extra AI-aanroep nodig</p>
                      </section>
                    ) : null
                  ) : null}
                  <p className="bta-muted">
                    Alleen de regels die aandacht vragen staan open. De regels die in orde zijn, zitten ingeklapt. Er is geen
                    &quot;alles accepteren&quot;.
                  </p>

                  {/* BE-34 (#81, criterion 3): the dishes of an image reading can
                      be closed with one explicit confirmation that names the
                      number. Each dish keeps its own decision; rows with their
                      own point keep their own step. */}
                  {review.bulkReview && review.bulkReview.available ? (
                    <div className="mai-actions mai-bulk">
                      {!bulkConfirm ? (
                        <>
                          <button
                            type="button"
                            className="stg-btn-secondary mai-btn"
                            disabled={busy}
                            onClick={() => setBulkConfirm(true)}
                          >
                            {review.bulkReview.buttonLabel}
                          </button>
                          <span className="bta-muted">{review.bulkReview.hint}</span>
                        </>
                      ) : (
                        <div className="di-banner di-banner-neutral" role="group" aria-label="Alles nagelopen bevestigen">
                          <p className="mai-why">{review.bulkReview.confirmLabel}</p>
                          <div className="mai-row-actions">
                            <button
                              type="button"
                              className="di-btn-primary mai-btn"
                              disabled={busy}
                              onClick={sendBulkReview}
                            >
                              {review.bulkReview.confirmAction}
                            </button>
                            <button
                              type="button"
                              className="stg-btn-secondary mai-btn"
                              disabled={busy}
                              onClick={() => setBulkConfirm(false)}
                            >
                              Annuleer
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="mai-actions">
                    <button type="button" className="stg-btn-secondary mai-btn" disabled={busy || openRows.filter((row) => row.askAi).length === 0} onClick={askAllOpen}>
                      Vraag AI over alle open punten
                    </button>
                    <span className="bta-muted">
                      Eén vraag over de punten waar de AI iets kan toevoegen. Elk antwoord wordt apart gecontroleerd; er is geen
                      &quot;alles overnemen&quot;.
                    </span>
                  </div>

                  {allPrompt ? (
                    <div className="mai-panel">
                      <p className="mai-panel-title">Vraag AI over alle open punten</p>
                      <pre className="mai-prompt" tabIndex="0">
                        {allPrompt}
                      </pre>
                      <textarea
                        className="bta-textarea"
                        value={allAnswer}
                        onChange={(event) => setAllAnswer(event.target.value)}
                        placeholder="Plak hier het antwoord over deze regels"
                        aria-label="Antwoord over alle open punten"
                      />
                      <div className="mai-row-actions">
                        <button type="button" className="di-btn-primary mai-btn" disabled={busy || !allAnswer.trim()} onClick={submitAllOpen}>
                          Controleren
                        </button>
                        <button type="button" className="stg-btn-secondary mai-btn" onClick={() => setAllPrompt('')}>
                          Annuleer
                        </button>
                      </div>
                      <p className="mai-why">Maximaal 10 regels per vraag. Een antwoord dat een andere regel raakt, wordt geweigerd.</p>
                    </div>
                  ) : null}

                  <ul className="mai-review-list">
                    {openRows.map((row) => {
                      const badge = stateBadge(row)
                      const variants = Array.isArray(row.priceVariants) ? row.priceVariants : []
                      // W6: a row without any price gets "Prijs onbekend" as its
                      // explicit choice; "Klopt" would silently keep it unpriced.
                      const priceMissing = row.code === 'price_unknown' || row.code === 'price_on_request'
                      // Variant 5: the same dish on the card with its marking.
                      const rowMark =
                        review.sourceMap && review.sourceMap.available
                          ? (review.sourceMap.marks || []).find((mark) => mark.rowId === row.id) || null
                          : null
                      return (
                        <li
                          key={row.id}
                          id={`mai-row-${row.id}`}
                          className={`mai-review-row ${row.state === 'error' ? 'mai-review-row--blocked' : ''}`}
                        >
                          <div className="mai-review-head">
                            <span className="mai-review-name">
                              {row.name} <span className="mai-review-price">{row.priceText}</span>
                            </span>
                            <span className={`status-badge status-badge--${badge.tone}`}>
                              <span>{badge.label}</span>
                            </span>
                          </div>
                          <p className="mai-why">
                            {row.pathLabel}
                            {row.locator ? ` · ${row.locator}` : ''}
                          </p>
                          {/* BE-33 (#79, criterion 3): the origin of a dish read
                              from an image is its own visible sentence. */}
                          {row.provenance ? <p className="mai-provenance">{row.provenance}</p> : null}
                          {row.quote ? <p className="mai-quote">“{row.quote}”</p> : null}
                          {rowMark ? (
                            <div className="mai-row-actions">
                              <button
                                type="button"
                                className="stg-btn-secondary mai-btn"
                                disabled={busy}
                                aria-label={`Bekijk ${row.name || 'dit gerecht'} op de kaart`}
                                onClick={() => openMarkOnMap(row)}
                              >
                                Bekijk op kaart
                              </button>
                            </div>
                          ) : null}

                          {row.code === 'price_variant' ? (
                            <div className="mai-row-actions">
                              <select
                                className="mai-select"
                                aria-label={`Kies de prijs voor ${row.name}`}
                                value={variantChoice[row.id] === undefined ? '' : String(variantChoice[row.id])}
                                onChange={(event) => setVariantChoice({ ...variantChoice, [row.id]: event.target.value })}
                              >
                                <option value="">Kies een prijs</option>
                                {variants.map((variant, index) => (
                                  <option key={`${row.id}-${index}`} value={String(index)}>
                                    {variant.label || `Prijs ${index + 1}`}
                                    {Number.isInteger(variant.amountMinorUnits)
                                      ? ` € ${(variant.amountMinorUnits / 100).toFixed(2).replace('.', ',')}`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="di-btn-primary mai-btn"
                                disabled={busy || variantChoice[row.id] === undefined || variantChoice[row.id] === ''}
                                onClick={() =>
                                  sendDecision({ rowId: row.id, action: 'choose_price', variantIndex: Number(variantChoice[row.id]) })
                                }
                              >
                                Kies
                              </button>
                              <button
                                type="button"
                                className="stg-btn-secondary mai-btn"
                                disabled={busy}
                                onClick={() => sendDecision({ rowId: row.id, action: 'drop' })}
                              >
                                Weglaten
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="mai-row-actions">
                                {priceMissing ? (
                                  <button
                                    type="button"
                                    className="di-btn-primary mai-btn"
                                    disabled={busy}
                                    onClick={() => sendDecision({ rowId: row.id, action: 'price_unknown' })}
                                  >
                                    Prijs onbekend
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="di-btn-primary mai-btn"
                                    disabled={busy}
                                    onClick={() => (row.state === 'error' ? openReason(row) : sendDecision({ rowId: row.id, action: 'confirm' }))}
                                  >
                                    Klopt
                                  </button>
                                )}
                                <button type="button" className="stg-btn-secondary mai-btn" disabled={busy} onClick={() => openCorrection(row)}>
                                  Wijzig
                                </button>
                                <button
                                  type="button"
                                  className="stg-btn-secondary mai-btn"
                                  disabled={busy}
                                  onClick={() => sendDecision({ rowId: row.id, action: 'drop' })}
                                >
                                  Weglaten
                                </button>
                                {row.askAi ? (
                                  <button
                                    type="button"
                                    className="stg-btn-secondary mai-btn"
                                    disabled={busy}
                                    onClick={() => askAi(row)}
                                    aria-expanded={askFor === row.id}
                                  >
                                    Vraag AI
                                  </button>
                                ) : null}
                              </div>
                              <p className="mai-why">
                                {row.askAi
                                  ? 'Het antwoord van Vraag AI wordt opnieuw gecontroleerd en vervangt alleen deze regel. Jij beslist daarna.'
                                  : 'Hier is geen Vraag AI: de keuze is aan jou.'}
                              </p>
                            </>
                          )}


                          {reasonFor === row.id ? (
                            <div className="mai-panel">
                              <p className="mai-panel-title">Waarom staat deze regel er toch?</p>
                              <select
                                className="mai-select"
                                value={reasonCode}
                                onChange={(event) => setReasonCode(event.target.value)}
                                aria-label="Reden"
                              >
                                {MISSING_REASONS.map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="mai-input"
                                type="text"
                                maxLength={300}
                                value={reasonNote}
                                onChange={(event) => setReasonNote(event.target.value)}
                                placeholder="Korte toelichting (verplicht)"
                                aria-label="Korte toelichting"
                              />
                              <div className="mai-row-actions">
                                <button
                                  type="button"
                                  className="di-btn-primary mai-btn"
                                  disabled={busy || !reasonNote.trim()}
                                  onClick={() => sendDecision({ rowId: row.id, action: 'confirm', reasonCode, note: reasonNote })}
                                >
                                  Reden opslaan
                                </button>
                                <button type="button" className="stg-btn-secondary mai-btn" onClick={() => setReasonFor(null)}>
                                  Annuleer
                                </button>
                              </div>
                              <p className="mai-why">De reden wordt met de herkomst bewaard.</p>
                            </div>
                          ) : null}

                          {correctFor === row.id ? (
                            <div className="mai-panel">
                              <p className="mai-panel-title">Wijzig deze regel</p>
                              <input
                                className="mai-input"
                                type="text"
                                value={correction.name}
                                maxLength={200}
                                onChange={(event) => setCorrection({ ...correction, name: event.target.value })}
                                placeholder="Naam"
                                aria-label="Naam"
                              />
                              <input
                                className="mai-input"
                                type="text"
                                value={correction.price}
                                onChange={(event) => setCorrection({ ...correction, price: event.target.value })}
                                placeholder="Prijs, bijvoorbeeld 12,50"
                                aria-label="Prijs"
                              />
                              <input
                                className="mai-input"
                                type="text"
                                value={correction.description}
                                maxLength={1000}
                                onChange={(event) => setCorrection({ ...correction, description: event.target.value })}
                                placeholder="Omschrijving"
                                aria-label="Omschrijving"
                              />
                              <input
                                className="mai-input"
                                type="text"
                                value={correction.path}
                                onChange={(event) => setCorrection({ ...correction, path: event.target.value })}
                                placeholder="Pad van het menukopje, bijvoorbeeld Lunch › Bites"
                                aria-label="Pad van het menukopje"
                              />
                              <div className="mai-row-actions">
                                <button type="button" className="di-btn-primary mai-btn" disabled={busy} onClick={() => submitCorrection(row)}>
                                  Correctie opslaan
                                </button>
                                <button type="button" className="stg-btn-secondary mai-btn" onClick={() => setCorrectFor(null)}>
                                  Annuleer
                                </button>
                              </div>
                            </div>
                          ) : null}


                          {askFor === row.id ? (
                            <div className="mai-panel">
                              <p className="mai-panel-title">Vraag AI over deze regel</p>
                              <p className="bta-muted">Eén korte vraag over alleen deze regel, met dezelfde bron erbij.</p>
                              <pre className="mai-prompt" tabIndex="0">
                                {askPrompt}
                              </pre>
                              <textarea
                                className="bta-textarea"
                                value={askAnswer}
                                onChange={(event) => setAskAnswer(event.target.value)}
                                placeholder="Plak hier het antwoord over deze regel"
                                aria-label="Antwoord over deze regel"
                              />
                              <div className="mai-row-actions">
                                <button
                                  type="button"
                                  className="di-btn-primary mai-btn"
                                  disabled={busy || !askAnswer.trim()}
                                  onClick={() => submitAsk(row)}
                                >
                                  Controleren
                                </button>
                                <button type="button" className="stg-btn-secondary mai-btn" onClick={() => setAskFor(null)}>
                                  Annuleer
                                </button>
                              </div>
                              <p className="mai-why">Maximaal 1 vervolgvraag per regel.</p>
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>

                  <details className="mai-details">
                    <summary>
                      {doneRows.length} {doneRows.length === 1 ? 'regel' : 'regels'} in orde of afgehandeld (bekijk)
                    </summary>
                    <ul className="mai-done-list">
                      {doneRows.map((row) => {
                        // Variant 5: ook een regel die in orde is, is op de kaart
                        // terug te vinden.
                        const doneMark =
                          review.sourceMap && review.sourceMap.available
                            ? (review.sourceMap.marks || []).find((mark) => mark.rowId === row.id) || null
                            : null
                        return (
                          <li key={row.id}>
                            {row.name} · <b>{row.priceText}</b>
                            {row.outcome === 'keep_corrected' ? ' · gecorrigeerd' : ''}
                            {row.outcome === 'keep_confirmed' ? ' · bevestigd' : ''}
                            {row.outcome === 'keep_bulk_reviewed' ? ' · nagelopen' : ''}
                            {row.provenance ? ` · ${row.provenance}` : ''}
                            {row.outcome === 'keep_bulk_reviewed' ? (
                              // BE-34 (#81): adjusting one dish stays possible
                              // after "Alles nagelopen": reopening this row is a
                              // human action of its own.
                              <button
                                type="button"
                                className="stg-btn-secondary mai-btn"
                                disabled={busy}
                                aria-label={`Wijzig ${row.name || 'dit gerecht'}`}
                                onClick={() => reopenRow(row)}
                              >
                                Wijzig
                              </button>
                            ) : null}
                            {doneMark ? (
                              <button
                                type="button"
                                className="stg-btn-secondary mai-btn"
                                aria-label={`Bekijk ${row.name || 'dit gerecht'} op de kaart`}
                                onClick={() => openMarkOnMap(row)}
                              >
                                Bekijk op kaart
                              </button>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                    <p className="bta-muted">Deze regels hoef je niet meer na te lopen. Ze zijn wel gecontroleerd.</p>
                  </details>
                    </>
                  ) : null}


                  <details className="mai-details">
                    <summary>Technische details</summary>
                    <dl className="bta-facts">
                      <div>
                        <dt>Instructie</dt>
                        <dd>
                          {report.technical.protocolVersion} · {report.technical.protocolHash.slice(0, 12)}…
                        </dd>
                      </div>
                      <div>
                        <dt>Schemaversies</dt>
                        <dd>
                          {report.technical.instructionSchemaVersion} · {report.technical.schemaVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>Exportbundel</dt>
                        <dd>{report.bundleHash.slice(0, 16)}…</dd>
                      </div>
                      <div>
                        <dt>Bronnen</dt>
                        <dd>{report.technical.sources.map((source) => `${source.id} · ${source.sha256.slice(0, 8)}…`).join(' · ')}</dd>
                      </div>
                      <div>
                        <dt>AI-naam</dt>
                        <dd>{report.aiName} · zelfgerapporteerd en onbewezen</dd>
                      </div>
                      <div>
                        <dt>Geïmporteerd</dt>
                        <dd>{new Date(report.importedAt).toLocaleString('nl-NL')}</dd>
                      </div>
                    </dl>
                    <p className="bta-muted">
                      Deze gegevens worden vastgelegd en gecontroleerd. Je hoeft ze niet te lezen om verder te kunnen.
                    </p>
                  </details>

                  <div className="mai-actions">
                    <button
                      type="button"
                      className="di-btn-primary"
                      disabled={busy || !review.canSave || Boolean(saved)}
                      aria-describedby="mai-save-reason"
                      onClick={saveConcept}
                    >
                      Opslaan als concept
                    </button>
                    <p id="mai-save-reason" className="mai-why">
                      {saved
                        ? 'Opgeslagen als intern concept. Publiceren blijft een aparte stap.'
                        : review.saveBlockReason ||
                          'Alle punten zijn nagelopen. Opslaan maakt een intern concept. Publiceren blijft een aparte stap.'}
                    </p>
                    {/* W6: the separate publish step is always named, also while
                        points are still open. */}
                    <p className="mai-why">Publiceren blijft een aparte stap.</p>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>
      </main>
    </div>
  )
}

