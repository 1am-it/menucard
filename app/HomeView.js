'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'
import PrimaryNav from '@/src/components/PrimaryNav'
import MobileTabBar from '@/src/components/MobileTabBar'
import Wordmark from '@/src/components/Wordmark'
import Emoji from '@/src/components/Emoji'
import useClientNow from '@/src/components/useClientNow'
import { todayOpening } from '@/src/lib/openingStatus'

// BE-28 — de frisse, emoji-rijke home (#65, owner decision 2026-10-25).
// Referentie: docs/mockups/be-28-fresh-style-v1/home-licht.html en
// home-antraciet.html (canvas v14). Opbouw: zoekpaneel met "📍 Breda · echte
// menukaarten", emoji-titel, ronde zoekbalk en maaltijdchips; de tegelrij
// "Populair in Breda"; "Vanavond op de kaart" met alleen echte gerechten en
// prijzen uit de bestaande data (props, server-side geselecteerd in
// src/lib/publicTonight.js); en de regel "⚡ / 💶 / 📵".
//
// Geen nieuwe zoeklogica: elke chip en tegel linkt naar de bestaande
// /search-parameters (meal/cuisine) en de zoekbalk naar /search?q=.
// "🟢 Nu open" komt alleen uit de bestaande openingslogica
// (src/lib/openingStatus.js) met de browserklok — nooit uit een aanname.
// De emoji's zijn decoratief (aria-hidden via <Emoji/>).

const MEAL_SHORTCUTS = [
  { value: 'lunch', label: 'Lunch', glyph: '🥪' },
  { value: 'diner', label: 'Diner', glyph: '🍝' },
  { value: 'borrel', label: 'Borrel', glyph: '🍻' },
]

// Alleen keukens die in de bestaande zoeklogica bestaan
// (CUISINE_KEYWORDS in src/services/dishSearch.js), zodat elke tegel ook
// echt resultaten oplevert. Geen verzonnen keuken of gerecht.
const POPULAR_CUISINES = [
  { cuisine: 'Italiaans', glyph: '🍕' },
  { cuisine: 'Grill & Steak', glyph: '🥩' },
  { cuisine: 'Mediterraan', glyph: '🫒' },
  { cuisine: 'Indonesisch', glyph: '🍜' },
  { cuisine: 'Frans', glyph: '🥐' },
  { cuisine: 'Chinees', glyph: '🥡' },
]

const PROMISES = [
  { glyph: '⚡', text: 'Laadt snel, ook op 4G' },
  { glyph: '💶', text: 'Altijd met prijs' },
  { glyph: '📵', text: "Geen foto’s, wel info" },
]

export default function HomeView({ tonight = [] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  // Browserklok, net als op de restaurant- en menukaartpagina. Vóór de
  // eerste meting is `now` null: dan is er geen "Nu open"-label.
  const now = useClientNow()

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = query.trim()
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search')
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Wordmark />
          <div className="header-right">
            <PrimaryNav />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="page-with-tabbar">
        <section className="home-hero" aria-labelledby="home-title">
          <p className="home-eyebrow">
            <Emoji glyph="📍" /> Breda · echte menukaarten
          </p>
          <h1 className="home-title" id="home-title">
            Waar heb je vanavond zin in? <Emoji glyph="😋" />
          </h1>

          <form className="home-search" role="search" onSubmit={handleSubmit}>
            <label htmlFor="home-q" className="home-search-label">Zoek een gerecht</label>
            <Emoji glyph="🔍" />
            <input
              id="home-q"
              type="search"
              className="home-search-input"
              placeholder="Pizza, pasta, risotto…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="home-search-btn">Zoeken</button>
          </form>

          <div className="home-chips">
            {MEAL_SHORTCUTS.map((meal) => (
              <Link key={meal.value} href={`/search?meal=${meal.value}`} className="home-chip">
                <Emoji glyph={meal.glyph} />
                {meal.label}
              </Link>
            ))}
          </div>
        </section>

        <section className="home-section" aria-labelledby="populair-title">
          <h2 className="home-section-title" id="populair-title">
            Populair in Breda <Emoji glyph="🔥" />
          </h2>
          <div className="home-tile-grid">
            {POPULAR_CUISINES.map((tile) => (
              <Link
                key={tile.cuisine}
                href={`/search?cuisine=${encodeURIComponent(tile.cuisine)}`}
                className="home-tile"
              >
                <Emoji glyph={tile.glyph} className="home-tile-emoji" />
                <span>{tile.cuisine}</span>
              </Link>
            ))}
          </div>
        </section>


        {/* Alleen renderen als er echte gerechten met een echte prijs zijn
            (src/lib/publicTonight.js). Nooit een verzonnen gerecht of prijs,
            en geen lege sectie als de data het niet toelaat. */}
        {tonight.length > 0 && (
          <section className="home-section" aria-labelledby="vanavond-title">
            <div className="home-section-head">
              <h2 className="home-section-title" id="vanavond-title">
                Vanavond op de kaart <Emoji glyph="🔥" />
              </h2>
              <Link href="/search?meal=diner" className="home-all-link">Alles →</Link>
            </div>
            <ul className="tonight-list">
              {tonight.map((dish) => {
                const isOpen = !!now && !!dish.openingHours && todayOpening(dish.openingHours, now).state === 'open'
                return (
                  <li key={dish.dishId}>
                    <Link href={dish.menuLink} className="tonight-card">
                      <Emoji glyph={dish.emoji} className="tonight-emoji" />
                      <span className="tonight-main">
                        <span className="tonight-name">{dish.name}</span>
                        <span className="tonight-meta">
                          <span>{dish.restaurantName}</span>
                          {isOpen && (
                            <span className="open-label">
                              <Emoji glyph="🟢" />
                              Nu open
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="tonight-price">{dish.priceDisplay}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <p className="home-promise">
          {PROMISES.map((promise) => (
            <span key={promise.text}>
              <Emoji glyph={promise.glyph} /> {promise.text}
            </span>
          ))}
        </p>

        <div className="home-browse">
          <Link href="/alle-restaurants" className="detail-menu-btn-outline">
            Bekijk alle restaurants →
          </Link>
        </div>
      </main>

      <MobileTabBar />
    </>
  )
}
