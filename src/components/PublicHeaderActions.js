'use client'

// BE-63 (#155, uitkomst 1 en 2) — de ene rechterkant van de publieke kop.
//
// Vóór dit ticket bouwde elke publieke pagina de rechterkant zelf op met losse
// `ThemeToggle`- en `ShareSettingsButton`-knoppen en `AccountMenuButton`. Dat
// staat nu hier, één keer:
//
//   - "Voor restaurants" naar /voor-restaurants (de pagina zelf komt in BE-64);
//   - "Inloggen" naar /inloggen, omlijnd, rond en 44 px hoog; is er een
//     Supabase-sessiesleutel, dan staat op die plek het bestaande accountmenu
//     (BE-59) en verdwijnt de knop;
//   - één ronde instellingenknop (44 × 44) die een klein paneel opent met de
//     weergave (Licht / Donker / Automatisch) en "Delen via", dat het
//     goedgekeurde BE-61-venster opent en de huidige keuze als subtekst toont.
//
// De themakeuze volgt dezelfde opslagsleutel en hetzelfde startscript als
// ThemeToggle (app/layout.js); "Automatisch" legt 'auto' vast en volgt daarna
// het systeem (src/lib/themePreference.js). De deelkeuze blijft in
// localStorage via src/lib/sharePreference.js. Er gaat niets naar de server.
//
// De losse ThemeToggle en ShareSettingsButton blijven bestaan voor de interne
// kop (InternalNav) en /mijn-restaurant; daar verandert dit ticket niets.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { createPortal } from 'react-dom'
import AccountMenuButton from '@/src/components/AccountMenuButton'
import { hasSupabaseSessionKey } from '@/src/lib/accountSession'
import { safeBrowserStorage } from '@/src/lib/dishList'
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
import './public-header-actions.css'

// Het BE-61-venster komt pas in beeld na een tik op "Delen via" en wordt daarom
// pas dan geladen (dezelfde keuze als in ShareSettingsButton).
const ShareDialog = dynamic(
  () => import('@/src/components/ShareDialog').then((module) => module.ShareDialog),
  { ssr: false }
)

const SETTINGS_BUTTON_LABEL = 'Instellingen: thema en delen'
const SETTINGS_PANEL_TITLE = 'Instellingen'
const SETTINGS_CLOSE_LABEL = 'Sluiten'
const VIEW_TITLE = 'Weergave'

function prefersLightNow() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

export default function PublicHeaderActions() {
  // Ingelogd of gast: pas na het mounten bekend, zodat de server geen sessie
  // hoeft te raden. Tot die tijd staat de gewone "Inloggen"-knop er.
  const [signedIn, setSignedIn] = useState(false)
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState(DEFAULT_THEME)
  const [shareValue, setShareValue] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const panelRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    const storage = safeBrowserStorage()
    setSignedIn(hasSupabaseSessionKey(storage))
    setTheme(readThemePreference(storage) || DEFAULT_THEME)
    setShareValue(readSharePreference(storage))
  }, [])

  // Esc sluit, Tab blijft in het paneel en de focus keert terug naar de knop
  // die het paneel opende.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const opener = openerRef.current || document.activeElement
    const panel = panelRef.current
    const focusables = () => {
      if (!panel) return []
      return [...panel.querySelectorAll('button, [href]')].filter((element) => !element.disabled)
    }
    const first = focusables()[0]
    if (first) first.focus()
    else if (panel) panel.focus()

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
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
  }, [open])

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

  return (
    <div className="public-header-actions">
      <Link href="/voor-restaurants" className="pha-restaurants">Voor restaurants</Link>
      {signedIn ? null : (
        <Link href="/inloggen" className="pha-login">Inloggen</Link>
      )}
      <AccountMenuButton />
      <button
        type="button"
        className="pha-settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={SETTINGS_BUTTON_LABEL}
        ref={openerRef}
        onClick={() => setOpen(true)}
      >
        <svg
          className="pha-settings-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2.4" />
          <circle cx="10" cy="17" r="2.4" />
        </svg>
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="share-layer"
              role="presentation"
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false)
              }}
            >
              <div
                className="share-panel pha-panel"
                role="dialog"
                aria-modal="true"
                aria-label={SETTINGS_PANEL_TITLE}
                ref={panelRef}
                tabIndex={-1}
              >
                <div className="pha-group">
                  <span className="pha-group-title" id="instellingen-weergave">{VIEW_TITLE}</span>
                  <div className="theme-switch" role="group" aria-labelledby="instellingen-weergave">
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

                <div className="share-actions">
                  <button type="button" className="share-btn share-btn-quiet" onClick={() => setOpen(false)}>
                    {SETTINGS_CLOSE_LABEL}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

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
    </div>
  )
}
