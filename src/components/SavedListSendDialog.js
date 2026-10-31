'use client'

// BE-65 (#157, uitkomst 4) — het venster "Stuur je lijstje" achter "Versturen".
//
// Het paneel komt van onderen (portal naar <body>, net als het BE-61-deelvenster)
// en ligt boven de tabbalk. Op een breed scherm is het een klein venster van
// hooguit 440 px. De focus gaat er bij het openen in, Tab blijft binnen, Esc
// sluit en de focus keert terug naar "Versturen" — dezelfde regels als
// useDialogFocus in src/components/ShareDialog.js.
//
// Wat er in staat:
//   - de gekozen gerechten (naam en prijs) uit de bestaande lijstje-opslag;
//   - twee keuzekaarten als echte radio's in een fieldset, met "Gewoon delen"
//     als standaard;
//   - drie deelmanieren in één rij: de favorieten uit "Delen via" en "Meer…".
//
// Wat een tik op een deelmanier doet (alle beslissingen staan in
// src/lib/savedListSend.js):
//   - "Gewoon delen": dezelfde link en dezelfde teller als ListShareButton
//     (`listShareHref` + `absoluteShareUrl`, zonder nieuwe telling);
//   - "Laat stemmen": eerst de stemlink via de bestaande API
//     (POST /api/v1/kies, zoals KiesStartButton), daarna die link delen; mislukt
//     het maken, dan blijft het bij de bestaande melding en gaat er niets weg.
//
// Er gaat geen tekst van ons mee in het bericht (eigenaarsbesluit 28 oktober):
// alleen de link, bij e-mail ook het onderwerp.
//
// Dit bestand wordt pas geladen als het venster opengaat: SavedDishesBar
// importeert het met `next/dynamic` en toont het alleen bij een tik op
// "Versturen" (Lead-review ronde 4).

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { dishCountLabel, listShareHref, readSavedList, safeBrowserStorage } from '@/src/lib/dishList'
import { absoluteShareUrl } from '@/src/lib/dishShare'
import { SHARED_EVENT, sendDishCounter } from '@/src/lib/dishCounters'
import { performShare, readSharePreference } from '@/src/lib/sharePreference'
import {
  SEND_CLOSE_LABEL,
  SEND_DISHES_TITLE,
  SEND_MODE_QUESTION,
  SEND_PLAIN_HINT,
  SEND_PLAIN_LABEL,
  SEND_PLAIN_MODE,
  SEND_TITLE,
  SEND_TOO_MANY_MESSAGE,
  SEND_VOTE_HINT,
  SEND_VOTE_LABEL,
  SEND_VOTE_MODE,
  createVoteLink,
  normalizeSendMode,
  sendMethodLabel,
  sendMethods,
  tooManyForVote,
  voteTitle,
} from '@/src/lib/savedListSend'
// BE-52 (#128): de opmaak van dit venster staat naast de component.
import './saved-list-send.css'

/** Een gekozen webmanier openen met een echte, tijdelijke link. */
function openShareLink(link) {
  if (typeof document === 'undefined' || !document.body) return
  const anchor = document.createElement('a')
  anchor.href = link
  anchor.rel = 'noopener noreferrer'
  if (/^https?:/i.test(link)) anchor.target = '_blank'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function currentTheme() {
  return typeof document === 'undefined' || !document.documentElement
    ? null
    : document.documentElement.getAttribute('data-theme')
}

/**
 * Focus in het paneel, Esc sluit, Tab blijft erbinnen en de focus keert terug
 * naar de knop die het paneel opende. Zelfde regels als de BE-61-vensters.
 */
function useDialogFocus(open, panelRef, onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const opener = document.activeElement
    const focusables = () => {
      const panel = panelRef.current
      if (!panel) return []
      return [...panel.querySelectorAll('button, input, [href], select, textarea')]
        .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true')
    }
    const first = focusables()[0]
    if (first) first.focus()
    else if (panelRef.current) panelRef.current.focus()

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        items[0].focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      try {
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
      } catch (error) {
        // De knop bestaat niet meer: dan valt er niets terug te zetten.
      }
    }
  }, [open, panelRef])
}

/** De laag eromheen: een klik naast het paneel sluit het, net als Esc. */
function SendLayer({ onClose, children }) {
  // Een portal naar <body>: de pagina heeft een eigen stapelvolgorde en de
  // balk staat vast; zonder portal zou het paneel daarbinnen hangen.
  if (typeof document === 'undefined' || !document.body) return null
  return createPortal(
    <div
      className="saved-send-layer"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

export default function SavedListSendDialog({ open, onClose }) {
  const [entries, setEntries] = useState([])
  const [mode, setMode] = useState(SEND_PLAIN_MODE)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const panelRef = useRef(null)
  useDialogFocus(open, panelRef, onClose)

  // Bij elk openen: de lijst uit de bestaande opslag, de standaardkeuze en een
  // lege melding. Zo kan een eerdere fout niet blijven staan.
  useEffect(() => {
    if (!open) return
    setEntries(readSavedList(safeBrowserStorage()))
    setMode(SEND_PLAIN_MODE)
    setMessage('')
    setBusy(false)
  }, [open])

  const tooMany = tooManyForVote(entries.length)
  const methods = sendMethods(readSharePreference(safeBrowserStorage()))

  const handleMethod = useCallback(async (method) => {
    if (busy) return
    const theme = currentTheme()
    if (tooManyForVote(entries.length) && normalizeSendMode(mode) === SEND_VOTE_MODE) {
      setMessage(SEND_TOO_MANY_MESSAGE)
      return
    }
    const navigatorRef = typeof navigator === 'undefined' ? null : navigator
    const shareInput = {
      method,
      title: null,
      clipboard: navigatorRef ? navigatorRef.clipboard : null,
      share: navigatorRef && typeof navigatorRef.share === 'function'
        ? navigatorRef.share.bind(navigatorRef)
        : null,
      open: openShareLink,
    }
    setMessage('')
    if (normalizeSendMode(mode) === SEND_VOTE_MODE) {
      setBusy(true)
      const created = await createVoteLink({ dishKeys: entries.map((entry) => entry.id), theme })
      setBusy(false)
      // Mislukt het maken, dan alleen de bestaande melding en géén deelactie.
      if (!created.ok) {
        setMessage(created.message)
        return
      }
      shareInput.title = voteTitle(entries.length)
      // Zoals KiesShareButton: elk gedeeld gerecht van de stemming telt mee.
      shareInput.count = () => {
        for (const entry of entries) void sendDishCounter({ dish: entry.id, event: SHARED_EVENT })
      }
      shareInput.href = created.href
    } else {
      // Precies ListShareButton: dezelfde lijstlink, dezelfde titel en geen
      // nieuwe telling.
      shareInput.href = listShareHref({ values: entries })
      shareInput.title = `Mijn lijstje · ${dishCountLabel(entries.length)}`
    }
    const url = absoluteShareUrl({
      href: shareInput.href,
      origin: typeof window === 'undefined' || !window.location ? undefined : window.location.origin,
      theme,
    })
    const result = await performShare({ ...shareInput, url })
    setMessage(result.message || '')
  }, [busy, entries, mode])

  if (!open) return null

  return (
    <SendLayer onClose={onClose}>
      <div
        className="saved-send-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-send-titel"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="saved-send-head">
          <h2 className="saved-send-title" id="saved-send-titel">{SEND_TITLE}</h2>
          <button
            type="button"
            className="saved-send-close"
            aria-label={SEND_CLOSE_LABEL}
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>

        <h3 className="saved-send-subtitle">{SEND_DISHES_TITLE}</h3>
        <ul className="saved-send-list">
          {entries.map((entry) => (
            <li className="saved-send-dish" key={entry.id}>
              <span className="saved-send-dish-name">{entry.name}</span>
              <span className="saved-send-dish-price">{entry.price}</span>
            </li>
          ))}
        </ul>

        <fieldset className="saved-send-modes">
          <legend className="saved-send-legend">{SEND_MODE_QUESTION}</legend>
          <label className={`saved-send-mode${mode === SEND_PLAIN_MODE ? ' is-checked' : ''}`}>
            <input
              type="radio"
              className="saved-send-radio"
              name="saved-send-wijze"
              value={SEND_PLAIN_MODE}
              checked={mode === SEND_PLAIN_MODE}
              onChange={() => setMode(SEND_PLAIN_MODE)}
            />
            <span className="saved-send-mode-title">{SEND_PLAIN_LABEL}</span>
            <span className="saved-send-mode-hint">{SEND_PLAIN_HINT}</span>
          </label>
          <label className={`saved-send-mode${mode === SEND_VOTE_MODE ? ' is-checked' : ''}`}>
            <input
              type="radio"
              className="saved-send-radio"
              name="saved-send-wijze"
              value={SEND_VOTE_MODE}
              checked={mode === SEND_VOTE_MODE}
              onChange={() => setMode(SEND_VOTE_MODE)}
            />
            <span className="saved-send-mode-title">{SEND_VOTE_LABEL}</span>
            <span className="saved-send-mode-hint">{SEND_VOTE_HINT}</span>
          </label>
        </fieldset>
        {mode === SEND_VOTE_MODE && tooMany ? (
          <p className="saved-send-note">{SEND_TOO_MANY_MESSAGE}</p>
        ) : null}

        <div className="saved-send-actions" role="group" aria-label="Delen via">
          {methods.map((method) => (
            <button
              key={method}
              type="button"
              className="saved-send-method"
              onClick={() => handleMethod(method)}
              disabled={busy}
            >
              {sendMethodLabel(method)}
            </button>
          ))}
        </div>
        <p className="saved-send-status" role="status">{message}</p>
      </div>
    </SendLayer>
  )
}
