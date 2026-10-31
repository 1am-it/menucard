'use client'

// BE-46 (#106, criterium 4, 5, 6 en 8) — de stemlink zelf.
//
// Eén pagina, drie stappen, volgens de goedgekeurde mockup:
//   1. roepnaam (geen account, geen e-mail, geen wachtwoord);
//   2. de kaartenstapel: één gerecht tegelijk, rechts "lekker", links "liever
//      niet", altijd ook twee knoppen en "Vorige stem ongedaan maken";
//   3. de uitslag: een echte lijst, met de favoriet en "Reserveer"/"Route".
//
// Swipen gaat met pointer-events, zonder dependency (criterium 5): de drempel is
// 30% van de kaartbreedte (swipeOutcome in src/lib/kiesStemming.js), tijdens
// het slepen is het label "Lekker →" of "← Liever niet" zichtbaar, verticaal
// scrollen blijft werken (`touch-action: pan-y` in de CSS), de beweging
// respecteert prefers-reduced-motion en de pijltjestoetsen doen hetzelfde als
// de knoppen.
//
// Wat de browser onthoudt staat in `localStorage` onder één sleutel
// (`bredaeats_kies`): het anonieme kenmerk van deze browser, de roepnaam en
// welke gerechten al beoordeeld zijn. Altijd in try/catch: zonder opslag werkt
// de pagina, alleen niet meer na een herlaadbeurt. Na het laatste gerecht en bij
// opnieuw openen staat de uitslag er meteen.
//
// Niets van dit alles gaat als identiteit naar de server: alleen `stemmer` (dat
// willekeurige kenmerk), de roepnaam en de stem.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import PublicHeaderActions from '@/src/components/PublicHeaderActions'
import Wordmark from '@/src/components/Wordmark'
import { safeBrowserStorage } from '@/src/lib/dishList'
import {
  KIES_CLOSED_MESSAGE,
  KIES_EMPTY_RESULT_MESSAGE,
  KIES_ENDPOINT,
  KIES_JOIN_LABEL,
  KIES_LEKKER_LABEL,
  KIES_LIEVER_NIET_LABEL,
  KIES_NOT_AVAILABLE_MESSAGE,
  KIES_RESERVE_LABEL,
  KIES_RESULT_FAVOURITE,
  KIES_RESULT_TITLE,
  KIES_ROEPNAAM_HINT,
  KIES_ROEPNAAM_LABEL,
  KIES_ROUTE_LABEL,
  KIES_UNDO_LABEL,
  KIES_VOTED_MESSAGE,
  KIES_VOTE_FAILED_MESSAGE,
  generateStemmerId,
  kiesLekkerShare,
  kiesProgressLabel,
  nextDishIndex,
  nextVotedDishes,
  normalizeRoepnaam,
  readKiesProgress,
  swipeFeedback,
  swipeOutcome,
  undoVotedDishes,
  writeKiesProgress,
} from '@/src/lib/kiesStemming'
// BE-62 — na het stemmen een rustige regel naar de home, zonder account. Het
// vlak komt pas als deze bezoeker echt gestemd heeft, dus het hoeft niet in de
// eerste lading van de pagina te zitten: vandaar `next/dynamic`.
const ZoekGerechtBlock = dynamic(() => import('@/src/components/ZoekGerechtBlock'), { ssr: false })
import {
  KIES_RETURN_BODY,
  KIES_RETURN_CTA,
  firstLekkerDishName,
  kiesReturnTitle,
} from '@/src/lib/returnVisit'
// BE-52 (#128): de eigen opmaak van deze pagina staat naast de view.
import '../kies.css'


const NOT_FOUND_MESSAGE = 'Deze stemlink bestaat niet (meer).'
const NAME_REQUIRED_MESSAGE = 'Vul een roepnaam van hoogstens 24 tekens in.'
const LOADING_MESSAGE = 'Bezig…'

/** Tijd in de eigen tijdzone van de bezoeker, alleen op het scherm. */
function timeLabel(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

// ─── Iconen ───────────────────────────────────────────────────────────────────
//
// De mockup toont een X bij "Liever niet", een vinkje bij "Lekker" en een
// terug-pijl bij "Vorige stem ongedaan maken". Kleine inline SVG's: geen
// dependency (contract, grenzen) en ze nemen de kleur van de knop over.

function CrossIcon() {
  return (
    <svg className="kies-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="kies-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg className="kies-btn-icon kies-undo-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 5L4 10l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 10h8a5.5 5.5 0 0 1 0 11H8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function KiesView({ code }) {
  const [stemming, setStemming] = useState(null)
  const [phase, setPhase] = useState('laden')
  const [progress, setProgress] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const cardRef = useRef(null)
  const dragRef = useRef({ id: null, startX: 0, active: false })

  const dishes = stemming && Array.isArray(stemming.dishes) ? stemming.dishes : []
  const votedKeys = progress && Array.isArray(progress.gestemd) ? progress.gestemd : []
  const index = phase === 'stemmen' ? nextDishIndex(dishes, votedKeys) : -1
  const currentDish = index >= 0 ? dishes[index] : null
  const canUndo = phase === 'stemmen' && votedKeys.length > 0
  const feedback = swipeFeedback({ dx, width: 1 })
  const sluitLabel = stemming ? timeLabel(stemming.sluitOm) : null
  // De dunne balk naast "Gerecht 2 van 4" (mockup, scherm 4): hoeveel van de
  // stapel is geweest, inclusief het gerecht dat nu vooraan staat.
  const stackShare = index >= 0 && dishes.length > 0
    ? Math.round(((index + 1) / dishes.length) * 100)
    : 0
  // BE-62 (#153) — de vraag na het stemmen hoort alleen bij een bezoeker die
  // zelf gestemd heeft; wie alleen meekijkt, ziet hem niet. De kop gebruikt het
  // eerste gerecht dat deze bezoeker "lekker" gaf, anders de terugvalregel.
  const hasOwnVotes = !!(progress && Array.isArray(progress.gestemd) && progress.gestemd.length > 0)
  const ownLekker = progress && Array.isArray(progress.lekker) ? progress.lekker : []
  const ownLekkerName = firstLekkerDishName({ dishes, lekker: ownLekker })

  /** De stemming ophalen en de eigen stand terugzetten (localStorage). */
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${KIES_ENDPOINT}/${code}`, {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      const body = await response.json().catch(() => ({}))
      if (response.status === 503) {
        setPhase('onbeschikbaar')
        return
      }
      if (!response.ok) {
        setPhase('fout')
        return
      }
      setStemming(body)
      const stored = readKiesProgress(safeBrowserStorage(), code)
      setProgress(stored)
      if (body.gesloten) {
        setPhase('uitslag')
        return
      }
      if (stored && stored.gestemd.length > 0 && nextDishIndex(body.dishes, stored.gestemd) === -1) {
        // Alles al beoordeeld: meteen de uitslag (contract, criterium 4).
        setPhase('uitslag')
        return
      }
      if (stored && stored.roepnaam) {
        setPhase('stemmen')
        return
      }
      setPhase('naam')
    } catch (error) {
      setPhase('fout')
    }
  }, [code])

  useEffect(() => {
    void load()
  }, [load])

  /** Eén stem naar de server, en de eigen voortgang bijwerken. */
  const submitVote = useCallback(async (dish, lekker) => {
    if (!dish || !progress || busy) return
    setBusy(true)
    setDx(0)
    try {
      const response = await fetch(`${KIES_ENDPOINT}/${code}/stem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stemmer: progress.stemmer,
          roepnaam: progress.roepnaam,
          dishKey: dish.id,
          lekker,
        }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      })
      const body = await response.json().catch(() => ({}))
      if (response.status === 503) {
        setPhase('onbeschikbaar')
        return
      }
      if (response.ok) {
        const nextProgress = {
          ...progress,
          ...nextVotedDishes(progress, { dishKey: dish.id, lekker }),
        }
        setProgress(nextProgress)
        writeKiesProgress(safeBrowserStorage(), code, nextProgress)
        if (body.uitslag) {
          setStemming((current) => (current
            ? { ...current, uitslag: body.uitslag, stemmers: body.stemmers, stemmen: body.stemmen }
            : current))
        }
        if (nextDishIndex(dishes, nextProgress.gestemd) === -1) {
          setMessage(KIES_VOTED_MESSAGE)
          setPhase('uitslag')
        } else {
          setMessage('')
        }
        return
      }
      if (response.status === 409 && body.error === 'closed') {
        setMessage(body.message || KIES_CLOSED_MESSAGE)
        setStemming((current) => (current && body.uitslag
          ? { ...current, uitslag: body.uitslag, stemmers: body.stemmers, stemmen: body.stemmen, gesloten: true }
          : current))
        setPhase('uitslag')
        return
      }
      setMessage(body.message || KIES_VOTE_FAILED_MESSAGE)
    } catch (error) {
      setMessage(KIES_VOTE_FAILED_MESSAGE)
    } finally {
      setBusy(false)
    }
  }, [busy, code, dishes, progress])


  /** De laatste stem van deze stemmer ongedaan maken. */
  const undoVote = useCallback(async () => {
    if (!progress || busy || progress.gestemd.length === 0) return
    setBusy(true)
    try {
      const response = await fetch(`${KIES_ENDPOINT}/${code}/stem`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stemmer: progress.stemmer }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      })
      const body = await response.json().catch(() => ({}))
      if (response.status === 503) {
        setPhase('onbeschikbaar')
        return
      }
      if (!response.ok) {
        setMessage(body.message || KIES_VOTE_FAILED_MESSAGE)
        return
      }
      if (body.undone) {
        const nextProgress = { ...progress, ...undoVotedDishes(progress) }
        setProgress(nextProgress)
        writeKiesProgress(safeBrowserStorage(), code, nextProgress)
        if (body.uitslag) {
          setStemming((current) => (current
            ? { ...current, uitslag: body.uitslag, stemmers: body.stemmers, stemmen: body.stemmen }
            : current))
        }
        setMessage('')
        setPhase('stemmen')
      }
    } catch (error) {
      setMessage(KIES_VOTE_FAILED_MESSAGE)
    } finally {
      setBusy(false)
    }
  }, [busy, code, progress])

  const handleJoin = useCallback((event) => {
    event.preventDefault()
    const roepnaam = normalizeRoepnaam(name)
    if (!roepnaam) {
      setNameError(NAME_REQUIRED_MESSAGE)
      return
    }
    const stemmer = (progress && progress.stemmer) || generateStemmerId()
    if (!stemmer) {
      setNameError(KIES_VOTE_FAILED_MESSAGE)
      return
    }
    const next = {
      stemmer,
      roepnaam,
      gestemd: progress ? progress.gestemd : [],
      lekker: progress && Array.isArray(progress.lekker) ? progress.lekker : [],
    }
    setProgress(next)
    writeKiesProgress(safeBrowserStorage(), code, next)
    setNameError('')
    setMessage('')
    setPhase('stemmen')
  }, [code, name, progress])

  // ─── Swipen ───────────────────────────────────────────────────────────────

  const pointerDown = useCallback((event) => {
    if (busy) return
    dragRef.current = { id: event.pointerId, startX: event.clientX, active: true }
    setDragging(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch (error) {
      // Zonder capture werkt slepen binnen de kaart nog steeds.
    }
  }, [busy])

  const pointerMove = useCallback((event) => {
    const drag = dragRef.current
    if (!drag.active || drag.id !== event.pointerId) return
    setDx(event.clientX - drag.startX)
  }, [])

  const finishDrag = useCallback((event, cancelled) => {
    const drag = dragRef.current
    if (!drag.active || drag.id !== event.pointerId) return
    dragRef.current = { id: null, startX: 0, active: false }
    setDragging(false)
    setDx(0)
    if (cancelled) return
    const width = cardRef.current ? cardRef.current.getBoundingClientRect().width : 0
    const outcome = swipeOutcome({ dx: event.clientX - drag.startX, width })
    if (!outcome || !currentDish) return
    void submitVote(currentDish, outcome === 'lekker')
  }, [currentDish, submitVote])

  const onKeyDown = useCallback((event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      void submitVote(currentDish, true)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      void submitVote(currentDish, false)
    }
  }, [currentDish, submitVote])


  return (
    <>
      <header>
        <div className="header-inner">
          <Wordmark />
          <div className="lijst-header-actions">
            <PublicHeaderActions />
            {/* BE-62: de terug-link is meteen het nav-landmark van deze pagina;
                zonder dat vond de a11y-audit hier geen navigatie. */}
            <nav className="kies-back" aria-label="Terug">
              <Link href="/mijn-lijstje" className="back-btn">← Mijn lijstje</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="kies-main">
        {phase === 'laden' ? <p className="kies-status" role="status">{LOADING_MESSAGE}</p> : null}

        {phase === 'onbeschikbaar' ? (
          <p className="kies-status kies-status-error" role="status">{KIES_NOT_AVAILABLE_MESSAGE}</p>
        ) : null}

        {phase === 'fout' ? (
          <>
            <p className="kies-status kies-status-error" role="status">{NOT_FOUND_MESSAGE}</p>
            <Link href="/mijn-lijstje" className="lijst-link">Naar mijn lijstje</Link>
          </>
        ) : null}

        {phase === 'naam' ? (
          <section className="kies-card kies-name">
            <h1 className="kies-title">{KIES_ROEPNAAM_LABEL}</h1>
            <p className="kies-hint">
              {dishes.length > 0 ? `${dishes.length} ${dishes.length === 1 ? 'gerecht' : 'gerechten'} om uit te kiezen.` : ''}
            </p>
            <form onSubmit={handleJoin} noValidate>
              <label className="kies-label" htmlFor="kies-roepnaam">{KIES_ROEPNAAM_LABEL}</label>
              <input
                id="kies-roepnaam"
                className="kies-input"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={24}
                autoComplete="nickname"
                aria-describedby="kies-roepnaam-hint"
              />
              <p className="kies-hint" id="kies-roepnaam-hint">{KIES_ROEPNAAM_HINT}</p>
              <p className="kies-status kies-status-error" role="status">{nameError}</p>
              <button type="submit" className="lijst-primary-btn kies-join">{KIES_JOIN_LABEL}</button>
            </form>
          </section>
        ) : null}

        {phase === 'stemmen' && currentDish ? (
          <section className="kies-stack" onKeyDown={onKeyDown} tabIndex={0} role="group" aria-label="Kaartenstapel">
            <div className="kies-progress-row">
              <p className="kies-progress" role="status">{kiesProgressLabel(index, dishes.length)}</p>
              <span className="kies-progress-bar" aria-hidden="true">
                <span className="kies-progress-fill" style={{ width: `${stackShare}%` }} />
              </span>
            </div>
            {sluitLabel ? <p className="kies-hint">{`Stemmen tot ${sluitLabel}`}</p> : null}

            <div className="kies-card-wrap">
              {/* De tweede kaart, iets kleiner en lager: de stapel uit de mockup. */}
              <div className="kies-card-ghost" aria-hidden="true" />
              <div
                ref={cardRef}
                className={`kies-card kies-dish-card${dragging ? ' is-dragging' : ''}`}
                style={{ transform: `translateX(${dx}px) rotate(${dx / 24}deg)` }}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={(event) => finishDrag(event, false)}
                onPointerCancel={(event) => finishDrag(event, true)}
              >
                {/* Het label staat op de kaart zelf, waar de mockup het toont. */}
                {feedback.label ? (
                  <span className={`kies-swipe-label kies-swipe-${feedback.direction}`} aria-hidden="true">
                    {feedback.label}
                  </span>
                ) : null}
                <span className="kies-rest">{currentDish.restaurant}</span>
                <h2 className="kies-dish">{currentDish.name}</h2>
                <span className="kies-price">{currentDish.price}</span>
                {currentDish.description ? <p className="kies-desc">{currentDish.description}</p> : null}
              </div>
            </div>

            <div className="kies-vote-actions">
              <button
                type="button"
                className="kies-vote-btn kies-vote-niet"
                onClick={() => void submitVote(currentDish, false)}
                disabled={busy}
                aria-label={`${KIES_LIEVER_NIET_LABEL}: ${currentDish.name}`}
              >
                <CrossIcon />
                <span>{KIES_LIEVER_NIET_LABEL}</span>
              </button>
              <button
                type="button"
                className="kies-vote-btn kies-vote-lekker"
                onClick={() => void submitVote(currentDish, true)}
                disabled={busy}
                aria-label={`${KIES_LEKKER_LABEL}: ${currentDish.name}`}
              >
                <CheckIcon />
                <span>{KIES_LEKKER_LABEL}</span>
              </button>
            </div>

            {/* Een tekstlink met een terug-pijl, geen grote knop (mockup). */}
            <button type="button" className="kies-undo" onClick={undoVote} disabled={!canUndo || busy}>
              <BackIcon />
              <span>{KIES_UNDO_LABEL}</span>
            </button>
            <p className="kies-status" role="status">{message}</p>
          </section>
        ) : null}


        {phase === 'uitslag' && stemming ? (
          <section className="kies-result">
            <h1 className="kies-title">{KIES_RESULT_TITLE}</h1>
            {sluitLabel ? <p className="kies-hint">{`Stemmen tot ${sluitLabel}`}</p> : null}
            <p className="kies-hint">
              {stemming.stemmers
                ? `${stemming.stemmers} ${stemming.stemmers === 1 ? 'stemmer' : 'stemmers'} · ${stemming.stemmen} ${stemming.stemmen === 1 ? 'stem' : 'stemmen'}`
                : ''}
            </p>
            <p className="kies-status" role="status">{message}</p>
            {Array.isArray(stemming.uitslag) && stemming.uitslag.length > 0 ? (
              <ul className="kies-uitslag">
                {stemming.uitslag.map((row, position) => {
                  const favourite = position === 0 && row.lekker > 0
                  return (
                    <li key={row.id} className={`kies-uitslag-row${favourite ? ' is-favoriet' : ''}`}>
                      <div className="kies-uitslag-top">
                        <span className="kies-uitslag-name">{row.name}</span>
                        <span className="kies-uitslag-price">{row.price}</span>
                      </div>
                      <span className="kies-uitslag-meta">{row.restaurant}</span>
                      <span className="kies-uitslag-count">
                        {`${row.lekker}× ${KIES_LEKKER_LABEL.toLowerCase()} · ${row.lieverNiet}× ${KIES_LIEVER_NIET_LABEL.toLowerCase()}`}
                      </span>
                      {/* De balk met het aandeel "lekker" (mockup, scherm 6). De
                          tekst hierboven zegt hetzelfde, dus de balk zelf is
                          decoratief voor schermlezers. */}
                      <span className="kies-uitslag-bar" aria-hidden="true">
                        <span className="kies-uitslag-bar-fill" style={{ width: `${kiesLekkerShare(row)}%` }} />
                      </span>
                      {row.kiezers.length > 0 ? <span className="kies-uitslag-names">{row.kiezers.join(', ')}</span> : null}
                      {favourite ? <span className="kies-favoriet">{KIES_RESULT_FAVOURITE}</span> : null}
                      {favourite ? (
                        <div className="kies-uitslag-actions">
                          {row.reserve ? (
                            <a
                              className="lijst-primary-btn"
                              href={row.reserve.href}
                              target={row.reserve.method === 'phone' ? undefined : '_blank'}
                              rel={row.reserve.method === 'phone' ? undefined : 'noopener noreferrer'}
                              aria-label={`${KIES_RESERVE_LABEL}: ${row.name}`}
                            >
                              {KIES_RESERVE_LABEL}
                            </a>
                          ) : null}
                          {row.route ? (
                            <a
                              className="share-btn"
                              href={row.route}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`${KIES_ROUTE_LABEL}: ${row.name}`}
                            >
                              {KIES_ROUTE_LABEL}
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="kies-hint">{KIES_EMPTY_RESULT_MESSAGE}</p>
            )}
            {/* BE-62, ontwerp punt 1 — rustig vlak onder de uitslag:
                "Jij koos <gerecht>. Zelf ook een lijstje maken?" */}
            {hasOwnVotes ? (
              <ZoekGerechtBlock
                title={kiesReturnTitle(ownLekkerName)}
                body={KIES_RETURN_BODY}
                cta={KIES_RETURN_CTA}
                variant="kies"
              />
            ) : null}
          </section>
        ) : null}
      </main>
    </>
  )
}

