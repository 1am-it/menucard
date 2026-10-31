'use client'

// BE-65 (#157, uitkomst 3 en 4) — de balk na het bewaren, op de home en in
// /search.
//
// "n gerechten bewaard · Stuur je lijstje, met of zonder stemmen" met de knop
// "Versturen". Het aantal staat ook bij "Mijn lijstje" en de balk ligt boven de
// tabbalk (BE-28) en is te sluiten.
//
// Afspraken uit de opdracht:
// - de balk verschijnt zodra er minstens één gerecht bewaard is;
// - "Versturen" opent het venster "Stuur je lijstje" (ronde 4). Dat venster
//   laadt pas bij het openen via `next/dynamic`, zodat de eerste lading van / en
//   /search er niet mee groeit;
// - sluiten gebeurt met een knop met `aria-label` en geldt voor deze sessie
//   (`sessionStorage`, in try/catch: zonder opslag komt de balk bij de volgende
//   pagina gewoon terug, dat is beter dan een fout);
// - de stand komt uit de kleine lezer (src/lib/savedListRead.js), dus dezelfde
//   opslag als de bewaarknop en zonder de zware lijstmodule in de eerste lading.
//
// Waarom deze teksten niet uit dishList.js komen: die module is bewust niet in
// de eerste lading van / en /search (Lead-besluit ronde 2). De vorm is gelijk;
// savedDishesBar.test.js toetst hem tegen dishCountLabel() in dishList.js, zodat
// er geen tweede waarheid ontstaat.

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  SAVED_LIST_EVENT_NAME,
  browserStorage,
  savedBarText,
  savedCount,
} from '@/src/lib/savedListRead'
import './saved-dishes-bar.css'

// BE-65 (#157, ronde 4) — het venster komt pas binnen als "Versturen" gaat: de
// dynamische import start bij de eerste keer renderen, en dat gebeurt alleen als
// `sending` waar is.
const SavedListSendDialog = dynamic(() => import('./SavedListSendDialog'), { loading: () => null })

const BAR_HIDDEN_KEY = 'bredaeats_balk_gesloten'
const BAR_CLOSE_LABEL = 'Sluit de balk met bewaarde gerechten'
const BAR_SEND_LABEL = 'Versturen'

/** Is de balk in deze sessie gesloten? Zonder opslag: nee, nooit een fout. */
function readHidden(storage) {
  if (!storage || typeof storage.getItem !== 'function') return false
  try {
    return storage.getItem(BAR_HIDDEN_KEY) === '1'
  } catch (error) {
    return false
  }
}

function writeHidden(storage, hidden) {
  if (!storage || typeof storage.setItem !== 'function') return false
  try {
    if (hidden) storage.setItem(BAR_HIDDEN_KEY, '1')
    else storage.removeItem(BAR_HIDDEN_KEY)
    return true
  } catch (error) {
    return false
  }
}

/** `sessionStorage`, of null als er geen venster is of de browser hem weigert. */
function sessionStore() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch (error) {
    return null
  }
}

export default function SavedDishesBar() {
  const [count, setCount] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [ready, setReady] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const sync = () => setCount(savedCount(browserStorage()))
    sync()
    setHidden(readHidden(sessionStore()))
    setReady(true)
    window.addEventListener(SAVED_LIST_EVENT_NAME, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SAVED_LIST_EVENT_NAME, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const handleClose = useCallback(() => {
    setHidden(true)
    writeHidden(sessionStore(), true)
  }, [])

  // Vóór de eerste meting niets: geen balk die na het laden weer wegspringt.
  if (!ready || hidden || count < 1) return null

  return (
    <>
      <aside className="saved-bar" aria-label="Bewaarde gerechten">
        <p className="saved-bar-text">{savedBarText(count)}</p>
        <button
          type="button"
          className="saved-bar-send"
          aria-haspopup="dialog"
          aria-expanded={sending}
          onClick={() => setSending(true)}
        >
          {BAR_SEND_LABEL}
        </button>
        <button
          type="button"
          className="saved-bar-close"
          aria-label={BAR_CLOSE_LABEL}
          onClick={handleClose}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </aside>
      {/* Het venster "Stuur je lijstje": pas geladen en getoond na een tik op
          "Versturen" (ronde 4). */}
      {sending ? <SavedListSendDialog open onClose={() => setSending(false)} /> : null}
    </>
  )
}

export { BAR_CLOSE_LABEL, BAR_HIDDEN_KEY, BAR_SEND_LABEL, readHidden, writeHidden }

