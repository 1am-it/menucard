'use client'

// BE-46 (#106, criterium 4) — de knop "Samen kiezen" in "Mijn lijstje".
//
// Eén tik opent een blad met de vraag "Tot wanneer mag er gestemd worden?".
// Geen tijd betekent geen sluitingstijd; een tijd betekent vandaag om die tijd,
// of morgen als die tijd vandaag al voorbij is (sluitOmFromTime). Daarna maakt
// "Maak de stemlink" de stemming via POST /api/v1/kies en staat de link klaar:
// "Open de stemlink" en delen via de bestaande deelroute van BE-49
// (KiesShareButton).
//
// Zonder de migratie antwoordt de server met de ene nette melding
// ("Samen kiezen is nog niet beschikbaar"); dit blad toont die en niets anders.
// Er gaat geen IP-adres, user agent of account mee — alleen de id's van het
// lijstje en, als de maker dat wil, een sluitingstijd.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { SHARE_CANCEL_LABEL } from '@/src/lib/sharePreference'
import {
  KIES_ENDPOINT,
  KIES_LABEL,
  KIES_MAX_DISHES,
  KIES_NOT_AVAILABLE_MESSAGE,
  KIES_OPEN_LINK_LABEL,
  KIES_SLUIT_HINT,
  KIES_SLUIT_NONE_LABEL,
  KIES_SLUIT_TITLE,
  KIES_STARTED_MESSAGE,
  KIES_START_LABEL,
  kiesHref,
  sluitOmFromTime,
} from '@/src/lib/kiesStemming'
import KiesShareButton from '@/src/components/KiesShareButton'

const START_FAILED_MESSAGE = 'De stemlink is niet gemaakt. Probeer het opnieuw.'
const TOO_MANY_MESSAGE = `Samen kiezen kan met hooguit ${KIES_MAX_DISHES} gerechten.`

export default function KiesStartButton({ dishes = [] }) {
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState(null)
  const [sluitOm, setSluitOm] = useState(null)
  const [message, setMessage] = useState('')
  const buttonRef = useRef(null)
  const panelRef = useRef(null)

  const tooMany = dishes.length > KIES_MAX_DISHES

  const close = useCallback(() => {
    setOpen(false)
    if (buttonRef.current && typeof buttonRef.current.focus === 'function') buttonRef.current.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    if (panelRef.current && typeof panelRef.current.focus === 'function') panelRef.current.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  const handleStart = useCallback(async () => {
    setBusy(true)
    setMessage('')
    const sluitOmValue = time ? sluitOmFromTime(time) : null
    try {
      const response = await fetch(KIES_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dish_keys: dishes.map((dish) => dish.id),
          sluit_om: sluitOmValue,
        }),
        // Geen cookie en geen herkomst: net als de teller is dit anoniem.
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      })
      const body = await response.json().catch(() => ({}))
      if (response.ok && body && body.code) {
        setCode(body.code)
        setSluitOm(body.sluitOm || null)
        setMessage(KIES_STARTED_MESSAGE)
      } else if (response.status === 503) {
        setMessage(body && body.message ? body.message : KIES_NOT_AVAILABLE_MESSAGE)
      } else {
        setMessage(START_FAILED_MESSAGE)
      }
    } catch (error) {
      setMessage(START_FAILED_MESSAGE)
    } finally {
      setBusy(false)
    }
  }, [dishes, time])

  if (dishes.length === 0) return null

  const href = code ? kiesHref(code) : null
  const title = `Kies mee: ${dishes.length} ${dishes.length === 1 ? 'gerecht' : 'gerechten'}`

  return (
    <div className="kies-start">
      <button
        type="button"
        ref={buttonRef}
        className="lijst-primary-btn kies-start-btn"
        onClick={() => {
          setCode(null)
          setMessage('')
          setOpen(true)
        }}
        disabled={tooMany}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {KIES_LABEL}
      </button>
      {tooMany ? <p className="lijst-skipped">{TOO_MANY_MESSAGE}</p> : null}
      {open ? (
        <div className="share-layer kies-layer">
          <div
            className="share-panel kies-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kies-sluit-titel"
            tabIndex={-1}
            ref={panelRef}
          >
            {code ? (
              <StartedPanel
                href={href}
                sluitOm={sluitOm}
                message={message}
                title={title}
                dishKeys={dishes.map((dish) => dish.id)}
                onClose={close}
              />
            ) : (
              <ClosingTimeForm
                time={time}
                onTime={setTime}
                busy={busy}
                message={message}
                onStart={handleStart}
                onClose={close}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** De eerste stap: de sluitingstijd kiezen en de stemming maken. */
function ClosingTimeForm({ time, onTime, busy, message, onStart, onClose }) {
  return (
    <>
      <h2 className="share-panel-title" id="kies-sluit-titel">{KIES_SLUIT_TITLE}</h2>
      <p className="share-panel-hint">{KIES_SLUIT_HINT}</p>
      <label className="kies-time-label" htmlFor="kies-sluit-tijd">Sluitingstijd</label>
      <input
        id="kies-sluit-tijd"
        className="kies-time-input"
        type="time"
        value={time}
        onChange={(event) => onTime(event.target.value)}
      />
      <p className="share-panel-hint">{time ? '' : KIES_SLUIT_NONE_LABEL}</p>
      <div className="share-actions">
        <button type="button" className="share-btn" onClick={onClose}>{SHARE_CANCEL_LABEL}</button>
        <button type="button" className="share-btn share-btn-primary" onClick={onStart} disabled={busy}>
          {KIES_START_LABEL}
        </button>
      </div>
      <p className="lijst-status" role="status">{message}</p>
    </>
  )
}

/** De tweede stap: de link staat klaar en kan meteen gedeeld worden. */
function StartedPanel({ href, sluitOm, message, title, dishKeys, onClose }) {
  return (
    <>
      <h2 className="share-panel-title" id="kies-sluit-titel">{KIES_LABEL}</h2>
      <p className="kies-started" role="status">{message}</p>
      <p className="kies-started-link">
        <Link href={href} className="lijst-link">{KIES_OPEN_LINK_LABEL}</Link>
      </p>
      {sluitOm ? (
        <p className="share-panel-hint">
          Stemmen tot{' '}
          <time dateTime={sluitOm}>
            {new Date(sluitOm).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
          </time>
        </p>
      ) : (
        <p className="share-panel-hint">{KIES_SLUIT_NONE_LABEL}</p>
      )}
      <div className="kies-panel-actions">
        <KiesShareButton href={href} title={title} dishKeys={dishKeys} />
        <button type="button" className="share-btn" onClick={onClose}>{SHARE_CANCEL_LABEL}</button>
      </div>
    </>
  )
}

