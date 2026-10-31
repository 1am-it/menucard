'use client'

// BE-49 (#115, criterium 2, 4 en 6) — het blad "Hoe deel je meestal?" en het
// kleine deelmenu.
//
// Beide panelen delen één presentatie (`.share-layer` + `.share-panel`): op de
// telefoon een bottom sheet, op een breed scherm een klein dialoogvenster. Dat
// is één implementatie voor de eerste keer delen, het kleine menu met de
// favorieten en "Delen via" in de instellingen, zodat ze niet uit elkaar lopen.
//
// Toegankelijkheid (criterium 6): een echt dialoogvenster met `aria-modal`, de
// focus gaat erin bij openen (naar de eerste checkbox of de eerste knop), Tab
// blijft binnen het paneel, Esc sluit en de focus gaat terug naar de knop die
// het paneel opende. De checkboxes zijn echte `<input type="checkbox">`, met
// `accent-color` uit de tokens; er staat geen eigen kleur of icoon in de weg.
//
// De keuzes zelf (welke manieren, wat er bewaard wordt, welk gedrag) staan in
// src/lib/sharePreference.js; dit bestand is alleen de vorm.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './share-dialog.css'
import {
  MAX_SHARE_FAVORITES,
  SHARE_CANCEL_LABEL,
  SHARE_CLEAR_LABEL,
  SHARE_CLOSE_LABEL,
  SHARE_FAVORITES_LABEL,
  SHARE_HINT_FULL,
  SHARE_MENU_TITLE,
  SHARE_METHODS,
  SHARE_MORE_LABEL,
  SHARE_SAVE_LABEL,
  SHARE_SEGMENT_LEGEND,
  SHARE_SEGMENT_METHODS_LABEL,
  SHARE_SEGMENT_PHONE_LABEL,
  SHARE_SETTINGS_TITLE,
  SHARE_SHEET_HINT,
  SHARE_SHEET_TITLE,
  normalizeSharePreference,
  shareFavoriteCountLabel,
  shareMethodLabel,
} from '@/src/lib/sharePreference'

/**
 * Focus in het paneel, Esc sluit, Tab blijft binnen en de focus keert terug
 * naar de knop die het paneel opende (criterium 6).
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
function ShareLayer({ onClose, children }) {
  // Een portal naar <body>: de kop van de pagina heeft een backdrop-filter en
  // de kaarten leven in een grid; zonder portal zou een `position: fixed`-laag
  // daarbinnen aan dat element hangen in plaats van aan het venster.
  if (typeof document === 'undefined' || !document.body) return null
  return createPortal(
    <div
      className="share-layer"
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

// BE-61 (#152, ontwerp variant A) — de vijf manieren als inline-SVG in
// lijnstijl. Geen merklogo's en geen vaste kleur: `currentColor` volgt de
// tekstkleur van beide thema's, en de lijnen zijn `stroke`, niet `fill`.
const METHOD_PATHS = {
  // Een spraakwolkje.
  whatsapp: <path d="M20.5 11.8a8.3 8.3 0 0 1-12.2 7.3L3.6 20.4l1.3-4.6a8.3 8.3 0 1 1 15.6-4Z" />,
  // Twee schakels.
  copy: (
    <>
      <path d="M10 14 14 10" />
      <path d="M8.2 11.7 6.6 13.3a3.6 3.6 0 0 0 5.1 5.1l1.6-1.6" />
      <path d="m15.8 12.3 1.6-1.6a3.6 3.6 0 0 0-5.1-5.1L10.7 7.2" />
    </>
  ),
  // Een berichtvak.
  sms: (
    <>
      <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4 4v-4H4.5A1.5 1.5 0 0 1 3 14V7a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M7.5 12h.01M12 12h.01M16.5 12h.01" />
    </>
  ),
  // Een papieren vliegtuigje.
  telegram: (
    <>
      <path d="M20.8 4.2 3.6 10.8l5.7 2.3 2.4 5.9 2.4-4.3 4-6.9" />
      <path d="m9.3 13.1 8.2-8.4" />
    </>
  ),
  // Een envelop.
  email: (
    <>
      <path d="M4 6.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5Z" />
      <path d="m3.2 7.7 8.8 6.4 8.8-6.4" />
    </>
  ),
}

function ShareMethodIcon({ method }) {
  return (
    <svg
      className="share-fav-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {METHOD_PATHS[method] || METHOD_PATHS.copy}
    </svg>
  )
}

/**
 * Het blad "Hoe deel je meestal?" (criterium 2). `mode="settings"` toont
 * dezelfde keuzes vanuit "Delen via", met "Wissen" erbij (criterium 5).
 *
 * `onSave(kind)` krijgt `{ methods: [...] }`, `{ phone: true }` of null (niets
 * gekozen of gewist). De ouder bewaart en bepaalt wat er daarna gebeurt.
 */
export function ShareDialog({ open, mode = 'choose', value = null, onSave, onClose, idPrefix = 'deel' }) {
  const panelRef = useRef(null)
  const [methods, setMethods] = useState([])
  const [phone, setPhone] = useState(false)
  const current = normalizeSharePreference(value)
  const valueKey = current ? `${current.phone ? 'phone' : 'methods'}:${current.methods.join(',')}` : ''
  useDialogFocus(open, panelRef, onClose)

  useEffect(() => {
    if (!open) return
    const stored = normalizeSharePreference(value)
    setMethods(stored ? stored.methods : [])
    setPhone(Boolean(stored && stored.phone))
    // Alleen bij openen of een nieuwe bewaarde waarde: niet bij elke render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, valueKey])

  if (!open) return null

  const settings = mode === 'settings'
  const titleId = `${idPrefix}-titel`
  const hintId = `${idPrefix}-hint`
  const atLimit = methods.length >= MAX_SHARE_FAVORITES
  const nothing = !phone && methods.length === 0

  function toggleMethod(id) {
    setPhone(false)
    setMethods((chosen) => {
      if (chosen.includes(id)) return chosen.filter((entry) => entry !== id)
      if (chosen.length >= MAX_SHARE_FAVORITES) return chosen
      return [...chosen, id]
    })
  }

  // De schakelaar is een echte radiogroep (BE-61): één van de twee delen is
  // altijd gekozen, dus wisselen zet alleen de andere stand aan. De gekozen
  // favorieten blijven bewaard als je even naar het telefoonmenu kijkt.
  function chooseFavorites() {
    setPhone(false)
  }

  function choosePhone() {
    setPhone(true)
  }

  function submit(event) {
    event.preventDefault()
    if (phone) onSave({ phone: true })
    else if (methods.length > 0) onSave({ methods })
    else onSave(null)
  }

  return (
    <ShareLayer onClose={onClose}>
      <div
        className="share-panel share-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        ref={panelRef}
        tabIndex={-1}
      >
        <span className="share-grabber" aria-hidden="true" />
        <div className="share-head">
          <div className="share-head-text">
            <h2 className="share-panel-title" id={titleId}>{settings ? SHARE_SETTINGS_TITLE : SHARE_SHEET_TITLE}</h2>
            <p className="share-panel-hint" id={hintId}>{atLimit ? SHARE_HINT_FULL : SHARE_SHEET_HINT}</p>
          </div>
          <button type="button" className="share-close" aria-label={SHARE_CLOSE_LABEL} onClick={onClose}>
            <svg
              className="share-close-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M7 7l10 10M17 7 7 17" />
            </svg>
          </button>
        </div>
        <form className="share-form" onSubmit={submit}>
          <fieldset className="share-segment">
            <legend className="visually-hidden">{SHARE_SEGMENT_LEGEND}</legend>
            <label className={`share-segment-option${phone ? '' : ' is-active'}`}>
              <input
                type="radio"
                className="share-segment-input"
                name={`${idPrefix}-modus`}
                value="favorieten"
                checked={!phone}
                onChange={chooseFavorites}
              />
              <span className="share-segment-label">{SHARE_SEGMENT_METHODS_LABEL}</span>
            </label>
            <label className={`share-segment-option${phone ? ' is-active' : ''}`}>
              <input
                type="radio"
                className="share-segment-input"
                name={`${idPrefix}-modus`}
                value="telefoonmenu"
                checked={phone}
                onChange={choosePhone}
              />
              <span className="share-segment-label">{SHARE_SEGMENT_PHONE_LABEL}</span>
            </label>
          </fieldset>
          <div className="share-fav-head">
            <span className="share-fav-title">{SHARE_FAVORITES_LABEL}</span>
            <span className="share-fav-count">{shareFavoriteCountLabel(methods.length)}</span>
          </div>
          <fieldset className={`share-options${phone ? ' is-muted' : ''}`} disabled={phone}>
            <legend className="visually-hidden">Deelmanieren</legend>
            {SHARE_METHODS.map((method) => {
              const order = methods.indexOf(method.id)
              const checked = order >= 0
              return (
                <label key={method.id} className={`share-option share-fav-row${checked ? ' is-checked' : ''}`}>
                  <input
                    type="checkbox"
                    className="share-fav-input"
                    name="deelmanier"
                    value={method.id}
                    checked={checked}
                    disabled={!checked && atLimit}
                    onChange={() => toggleMethod(method.id)}
                  />
                  <span className="share-fav-icon-box">
                    <ShareMethodIcon method={method.id} />
                  </span>
                  <span className="share-option-label">{method.label}</span>
                  <span className={`share-fav-mark${checked ? ' is-chosen' : ''}`} aria-hidden="true">
                    {checked ? order + 1 : ''}
                  </span>
                </label>
              )
            })}
          </fieldset>
          <div className="share-actions">
            {settings ? (
              <button type="button" className="share-clear" onClick={() => onSave(null)}>
                {SHARE_CLEAR_LABEL}
              </button>
            ) : null}
            <button type="submit" className="share-btn share-btn-primary share-save" disabled={nothing}>
              {SHARE_SAVE_LABEL}
            </button>
          </div>
        </form>
      </div>
    </ShareLayer>
  )
}

/**
 * Het kleine menu met de gekozen favorieten en "Meer…" (criterium "Voorkeur met
 * 2 of 3 favorieten"). Dezelfde focusregels als het blad; "Meer…" valt in de
 * component terug op kopiëren als er geen systeemmenu is.
 */
export function ShareMenu({ open, methods = [], label = null, onPick, onMore, onClose, idPrefix = 'deel-menu' }) {
  const panelRef = useRef(null)
  useDialogFocus(open, panelRef, onClose)
  if (!open) return null
  const titleId = `${idPrefix}-titel`
  return (
    <ShareLayer onClose={onClose}>
      <div
        className="share-panel share-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        <h2 className="share-panel-title" id={titleId}>{label || SHARE_SETTINGS_TITLE}</h2>
        <div className="share-menu-list">
          {methods.map((method) => (
            <button key={method} type="button" className="share-menu-item" onClick={() => onPick(method)}>
              {shareMethodLabel(method)}
            </button>
          ))}
          <button type="button" className="share-menu-item share-menu-more" onClick={onMore}>
            {SHARE_MORE_LABEL}
          </button>
        </div>
        <div className="share-actions">
          <button type="button" className="share-btn share-btn-quiet" onClick={onClose}>
            {SHARE_CANCEL_LABEL}
          </button>
        </div>
      </div>
    </ShareLayer>
  )
}

