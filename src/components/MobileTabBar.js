'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Emoji from '@/src/components/Emoji'

// BE-28 — zwevende menubalk onderin op de telefoon (390 en 320 px).
//
// Alleen de twee bestaande publieke bestemmingen, dezelfde als de bestaande
// PrimaryNav: /search (Zoeken) en /alle-restaurants (Restaurants). Geen
// nieuwe route, geen nieuwe functie. De balk is met CSS verborgen boven
// 720 px en verschijnt daarom alleen op de telefoon; de gewone header blijft
// op desktop de navigatie.
//
// aria-current komt net als in PrimaryNav uitsluitend uit usePathname(),
// nooit uit query-parameters, zodat elke /search-variant "Zoeken" actief
// houdt. De emoji's zijn decoratief (Emoji zet aria-hidden); het label
// ernaast draagt de betekenis.

const DESTINATIONS = [
  { href: '/search', label: 'Zoeken', glyph: '🔍' },
  { href: '/alle-restaurants', label: 'Restaurants', glyph: '🍽️' },
]

export default function MobileTabBar() {
  const pathname = usePathname()

  return (
    <nav className="mobile-tabbar" aria-label="Hoofdmenu">
      {DESTINATIONS.map((destination) => (
        <Link
          key={destination.href}
          href={destination.href}
          className="mobile-tab-link"
          aria-current={pathname === destination.href ? 'page' : undefined}
        >
          <Emoji glyph={destination.glyph} />
          {destination.label}
        </Link>
      ))}
    </nav>
  )
}
