'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

const DESTINATIONS = [
  { href: '/search', label: 'Zoeken' },
  { href: '/alle-restaurants', label: 'Alle restaurants' },
]

export default function PrimaryNav() {
  const pathname = usePathname()

  return (
    <nav className="primary-nav" aria-label="Hoofdnavigatie">
      {DESTINATIONS.map((destination) => (
        <Link
          key={destination.href}
          href={destination.href}
          className="primary-nav-link"
          aria-current={pathname === destination.href ? 'page' : undefined}
        >
          {destination.label}
        </Link>
      ))}
    </nav>
  )
}
