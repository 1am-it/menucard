'use client'

// BE-63 (#155, uitkomst 1 en 2; ronde 3) — de ene rechterkant van de publieke kop.
//
// In de eerste lading staan hier alleen wat meteen zichtbaar moet zijn:
//
//   - "Voor restaurants" naar /voor-restaurants (de pagina zelf komt in BE-64);
//   - "Inloggen" naar /inloggen, omlijnd, rond en 44 px hoog; is er een
//     Supabase-sessiesleutel, dan staat op die plek het bestaande accountmenu
//     (BE-59) en verdwijnt de knop;
//   - één ronde instellingenknop (44 × 44, desktop) en één ronde menuknop
//     (44 × 44, telefoon) die het paneel openen.
//
// Het paneel zelf — de weergave (Licht / Donker / Automatisch), "Delen via" (het
// BE-61-venster), het blok "Heb je een restaurant?" en "Mijn lijstje" — zit in
// src/components/PublicHeaderPanel.js en wordt pas geladen als iemand de knop
// indrukt (ronde 2: dat alles zat in de eerste lading van elke pagina en brak
// het laadbudget). De themakeuze in de eerste lading blijft daarom bij het
// bestaande THEME_INIT_SCRIPT in app/layout.js.
//
// De losse ThemeToggle en ShareSettingsButton blijven bestaan voor de interne
// kop (InternalNav) en /mijn-restaurant; daar verandert dit ticket niets.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import AccountMenuButton from '@/src/components/AccountMenuButton'
import { hasSupabaseSessionKey } from '@/src/lib/accountSession'
import './public-header-actions.css'

// Het hele paneel komt pas in beeld na een tik; tot die tijd is het niet
// gedownload.
const PublicHeaderPanel = dynamic(() => import('@/src/components/PublicHeaderPanel'), { ssr: false })

const SETTINGS_BUTTON_LABEL = 'Instellingen: thema en delen'
const MENU_BUTTON_LABEL = 'Menu'

export default function PublicHeaderActions() {
  // Ingelogd of gast: pas na het mounten bekend, zodat de server geen sessie
  // hoeft te raden. Tot die tijd staat de gewone "Inloggen"-knop er.
  const [signedIn, setSignedIn] = useState(false)
  // null = dicht; 'settings' = het instellingenpaneel; 'menu' = het mobiele menu.
  const [open, setOpen] = useState(null)
  const settingsRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    // Dezelfde goedkope blik als AccountMenuButton: alleen kijken of er een
    // sessiesleutel staat, zonder extra module in de eerste lading. Zonder
    // opslag (privémodus, beleid) blijft "Inloggen" gewoon staan.
    try {
      setSignedIn(hasSupabaseSessionKey(window.localStorage))
    } catch (error) {
      setSignedIn(false)
    }
  }, [])

  function close() {
    setOpen(null)
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
        aria-expanded={open === 'settings'}
        aria-label={SETTINGS_BUTTON_LABEL}
        ref={settingsRef}
        onClick={() => setOpen('settings')}
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
      <button
        type="button"
        className="pha-menu"
        aria-haspopup="dialog"
        aria-expanded={open === 'menu'}
        aria-label={MENU_BUTTON_LABEL}
        ref={menuRef}
        onClick={() => setOpen('menu')}
      >
        <svg
          className="pha-menu-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open ? (
        <PublicHeaderPanel
          variant={open}
          onClose={close}
          returnFocusTo={open === 'menu' ? menuRef : settingsRef}
        />
      ) : null}
    </div>
  )
}
