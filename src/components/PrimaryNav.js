'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Emoji from '@/src/components/Emoji'
import { SAVED_LIST_EVENT, readSavedList, safeBrowserStorage } from '@/src/lib/dishList'
import './primary-nav.css'

// BE-11 — permanent, text-only primary navigation: the two coequal public
// entry points, `Zoeken` (dish/ingredient/restaurant/buurt/street/address
// search) and `Alle restaurants` (restaurant-level browse, including
// restaurants with no menu data yet). See planning/specs/tickets/be-11-
// public-menu-discovery-intent-aware-results.md's "Primary navigation"
// section for the full, decided design — this component implements
// exactly that, nothing more.
//
// First-slice scope, deliberately narrow: mounted only on /search and
// /alle-restaurants. Every other route — the homepage (which already has
// its own `Restaurants` link to `/restaurants`), `/restaurants` itself
// (its existing mode-switch is a different, in-page view toggle this
// component does not touch or replace), and every detail page
// (`/restaurant/[id]`, `/menu/[id]`, `/nvwa/[id]`, which carry their own
// page-specific back-link and correctly show neither destination as
// current) — is excluded on purpose, not by omission. See the ticket
// section above for the full reasoning.
//
// Same aria-current pattern as the existing src/components/InternalNav.js
// (`aria-current={pathname === m.href ? 'page' : undefined}`) —
// usePathname() is the only signal this component uses to decide active
// state, never query-string content, so any /search result (with or
// without filters/a query) still marks `Zoeken` current.
//
// No icon, no emoji, no icon library, no new dependency — plain text
// labels only, per the ticket's explicit "Neither carries an icon"
// decision.

// BE-28 (#65) — dezelfde twee bestemmingen, nu met een decoratief
// systeem-emoji uit <Emoji/> (aria-hidden). De labels blijven exact
// "Zoeken" / "Alle restaurants"; het emoji draagt geen betekenis en er is
// nog steeds geen icoonbibliotheek, afbeelding of nieuwe dependency.

const DESTINATIONS = [
  { href: '/search', label: 'Zoeken', glyph: '🔍' },
  { href: '/alle-restaurants', label: 'Alle restaurants', glyph: '🍽️' },
  // BE-63 (#155): het derde item uit het goedgekeurde ontwerp. De teller is het
  // aantal bewaarde gerechten in dit browserlijstje (BE-44), geen servergetal.
  { href: '/mijn-lijstje', label: 'Mijn lijstje', glyph: '⭐', count: true },
]

export default function PrimaryNav() {
  const pathname = usePathname()
  // Zonder opslag of vóór het mounten is de teller 0; de lijst zelf blijft
  // werken. Het eigen `bredaeats:bewaard`-event houdt de teller gelijk met de
  // bewaarknop op dezelfde pagina.
  const [saved, setSaved] = useState(0)

  useEffect(() => {
    const storage = safeBrowserStorage()
    const read = () => setSaved(readSavedList(storage).length)
    read()
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    window.addEventListener(SAVED_LIST_EVENT, read)
    return () => window.removeEventListener(SAVED_LIST_EVENT, read)
  }, [])

  return (
    <nav className="primary-nav" aria-label="Hoofdnavigatie">
      {DESTINATIONS.map((destination) => (
        <Link
          key={destination.href}
          href={destination.href}
          className="primary-nav-link"
          aria-current={pathname === destination.href ? 'page' : undefined}
        >
          <Emoji glyph={destination.glyph} />
          {destination.label}
          {destination.count ? (
            <>
              <span className="primary-nav-count" aria-hidden="true">{saved}</span>
              <span className="visually-hidden">{saved === 1 ? '1 gerecht bewaard' : `${saved} gerechten bewaard`}</span>
            </>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
