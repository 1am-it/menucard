'use client'

// BE-63 (#155, ronde 3) — de inhoud van het instellingenpaneel en het mobiele
// menu, in één component die pas bij het openen wordt geladen.
//
// Waarom hier en niet in PublicHeaderActions: het paneel sleept de themakeuze,
// de deelvoorkeur, het BE-61-venster en de teller mee. Zolang die in de kop
// zelf stonden, zat dat alles in de eerste lading van élke publieke pagina en
// groeiden die pagina's boven hun grens (review ronde 2). De kop laadt dit
// bestand daarom met `next/dynamic` op het moment dat iemand op de
// instellingenknop of de menuknop tikt.
//
// Twee varianten, één paneel:
//
//   - `settings` (desktop, instellingenknop): Weergave en "Delen via" (BE-61);
//   - `menu` (mobiel, menuknop): het blok "Heb je een restaurant?" met
//     Inloggen en Claim je zaak, de zin voor bezoekers, de weergave,
//     "Delen via" en "Mijn lijstje" met de teller.
//
// Beide liggen in een portaal boven de tabbalk (.share-layer heeft z-index 150,
// .mobile-tabbar 120) en houden de focus binnen het paneel: focus erin, Tab
// blijft binnen, Esc sluit en de focus keert terug naar de knop die het opende.
// De themakeuze gebruikt dezelfde opslagsleutel en THEME_INIT_SCRIPT als de rest
// van de app; kleuren komen alleen uit tokens.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  SHARE_SETTINGS_LABEL,
  clearSharePreference,
  readSharePreference,
  sharePreferenceSummary,
  writeSharePreference,
} from '@/src/lib/sharePreference'
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  applyThemeChoice,
  readThemePreference,
  writeThemePreference,
} from '@/src/lib/themePreference'
import { SAVED_LIST_EVENT, safeBrowserStorage, savedListCount } from '@/src/lib/savedListStorage'
import './public-header-menu.css'

// Het BE-61-venster komt pas in beeld na een tik op "Delen via" (zelfde keuze
// als in ShareSettingsButton).
const ShareDialog = dynamic(
  () => import('@/src/components/ShareDialog').then((module) => module.ShareDialog),
  { ssr: false }
)

export const SETTINGS_PANEL_TITLE = 'Instellingen'
export const MENU_TITLE = 'Menu'
export const MENU_CLOSE_LABEL = 'Sluiten'
export const VIEW_TITLE = 'Weergave'
export const LIST_LABEL = 'Mijn lijstje'
// De teksten uit het goedgekeurde ontwerp (uitkomst 3) en de opdracht.
export const RESTAURANT_BLOCK_TITLE = 'Heb je een restaurant?'
export const RESTAURANT_BLOCK_TEXT = 'Log in om je menukaart, prijzen en daghap bij te werken.'
export const LOGIN_LABEL = 'Inloggen'
export const CLAIM_LABEL = 'Claim je zaak'
export const VISITOR_NOTE = 'Als bezoeker heb je geen account nodig.'

function prefersLightNow() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

export default function PublicHeaderPanel({ variant = 'settings', onClose, returnFocusTo }) {
  const isMenu = variant === 'menu'
  const [theme, setTheme] = useState(DEFAULT_THEME)
  const [shareValue, setShareValue] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [saved, setSaved] = useState(0)
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  // De nieuwste callbacks, zonder de effecten opnieuw te starten.
  const onCloseRef = useRef(onClose)
  const returnFocusToRef = useRef(returnFocusTo)
  onCloseRef.current = onClose
  returnFocusToRef.current = returnFocusTo

  useEffect(() => {
    const storage = safeBrowserStorage()
    setTheme(readThemePreference(storage) || DEFAULT_THEME)
    setShareValue(readSharePreference(storage))
    const read = () => setSaved(savedListCount(storage))
    read()
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    window.addEventListener(SAVED_LIST_EVENT, read)
    return () => window.removeEventListener(SAVED_LIST_EVENT, read)
  }, [])

  // Focus erin, Tab binnen het paneel, Esc sluit en de focus terug naar de knop
  // die het paneel opende.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || typeof document === 'undefined') return undefined
    const focusables = () => [...panel.querySelectorAll('button, [href]')].filter((element) => !element.disabled)
    const first = closeRef.current || focusables()[0]
    if (first && typeof first.focus === 'function') first.focus()
    else panel.focus()

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (onCloseRef.current) onCloseRef.current()
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
      const opener = returnFocusToRef.current && returnFocusToRef.current.current
      try {
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
      } catch (error) {
        // De knop bestaat niet meer: dan valt er niets terug te zetten.
      }
    }
  }, [])

  function chooseTheme(value) {
    setTheme(value)
    writeThemePreference(safeBrowserStorage(), value)
    applyThemeChoice(value, prefersLightNow())
  }

  function openShare() {
    setShareValue(readSharePreference(safeBrowserStorage()))
    setShareOpen(true)
  }

  function saveShare(preference) {
    const storage = safeBrowserStorage()
    if (preference) writeSharePreference(storage, preference)
    else clearSharePreference(storage)
    setShareValue(readSharePreference(storage))
    setShareOpen(false)
  }

  function close() {
    if (onCloseRef.current) onCloseRef.current()
  }

  if (typeof document === 'undefined') return null



  return createPortal(
    <div
      className={`share-layer pha-layer${isMenu ? ' pha-layer--sheet' : ''}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        className={`share-panel pha-panel${isMenu ? ' pha-panel--sheet' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={isMenu ? MENU_TITLE : SETTINGS_PANEL_TITLE}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="pha-panel-head">
          <span className="pha-panel-title">{isMenu ? MENU_TITLE : SETTINGS_PANEL_TITLE}</span>
          <button type="button" className="pha-close" aria-label={MENU_CLOSE_LABEL} ref={closeRef} onClick={close}>
            <svg
              className="pha-close-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {isMenu ? (
          <div className="pha-restaurant">
            <span className="pha-restaurant-title">{RESTAURANT_BLOCK_TITLE}</span>
            <p className="pha-restaurant-text">{RESTAURANT_BLOCK_TEXT}</p>
            <div className="pha-restaurant-actions">
              <Link href="/inloggen" className="share-btn share-btn-primary pha-block-action">
                {LOGIN_LABEL}
              </Link>
              <Link href="/mijn-restaurant/claimen" className="share-btn pha-block-action">
                {CLAIM_LABEL}
              </Link>
            </div>
            <p className="pha-visitor-note">{VISITOR_NOTE}</p>
          </div>
        ) : null}


        <div className="pha-group">
          <span className="pha-group-title" id="pha-weergave">
            {VIEW_TITLE}
          </span>
          <div className="theme-switch" role="group" aria-labelledby="pha-weergave">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`theme-btn ${theme === option.value ? 'active' : ''}`}
                aria-pressed={theme === option.value}
                onClick={() => chooseTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pha-group">
          <button
            type="button"
            className="pha-share"
            aria-haspopup="dialog"
            aria-expanded={shareOpen}
            onClick={openShare}
          >
            <span className="pha-share-text">
              <span className="pha-share-label">{SHARE_SETTINGS_LABEL}</span>
              <span className="pha-share-value">{sharePreferenceSummary(shareValue)}</span>
            </span>
            <svg
              className="pha-chevron"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>

        {isMenu ? (
          <Link href="/mijn-lijstje" className="pha-row">
            <span className="pha-row-label">{LIST_LABEL}</span>
            <span className="pha-row-value">
              <span aria-hidden="true">{saved}</span>
              <span className="visually-hidden">
                {saved === 1 ? '1 gerecht bewaard' : `${saved} gerechten bewaard`}
              </span>
            </span>
          </Link>
        ) : (
          <div className="share-actions">
            <button type="button" className="share-btn" onClick={close}>
              {MENU_CLOSE_LABEL}
            </button>
          </div>
        )}
      </div>

      {shareOpen ? (
        <ShareDialog
          open={shareOpen}
          mode="settings"
          value={shareValue}
          onSave={saveShare}
          onClose={() => setShareOpen(false)}
          idPrefix="instellingen-deel"
        />
      ) : null}
    </div>,
    document.body
  )
}
