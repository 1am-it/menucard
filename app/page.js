'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'

// BE-04 — dish-first homepage. Deliberately lightweight: it forwards into
// the BE-03/BE-06 /search experience rather than re-implementing a second
// results page. The pre-BE-04 restaurant-browsing homepage was relocated,
// not deleted — see app/restaurants/page.js and
// planning/decisions/007-homepage-shift.md.

const MEAL_SHORTCUTS = [
  { value: 'lunch', label: '🥗 Lunch' },
  { value: 'diner', label: '🍽 Diner' },
  { value: 'borrel', label: '🍸 Borrel' },
]

// A representative subset of the real cuisine list from
// src/services/dishSearch.js's CUISINE_KEYWORDS — not the mockup's
// illustrative labels (Sushi/Japans/Vegan/Internationaal aren't in that
// map), so every shortcut here actually produces results.
const CUISINE_SHORTCUTS = ['Italiaans', 'Mediterraan', 'Grill & Steak', 'Frans', 'Indonesisch', 'Chinees', 'Nederlands']

export default function HomePage() {
  const router = useRouter()
  const [query, setQuery] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = query.trim()
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search')
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="logo">Breda<span>Eats</span></Link>
          <div className="header-right">
            <ThemeToggle />
            <Link href="/restaurants" className="back-btn">Restaurants</Link>
          </div>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">
            Wat wil je vanavond <span style={{ color: 'var(--green)' }}>eten</span>?
          </h1>
          <p className="hero-sub">Zoek in de menukaarten van restaurants in Breda</p>

          <form className="hero-search-bar" onSubmit={handleSubmit}>
            <div className="search-field" style={{ flex: 1 }}>
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="search-input flagship"
                placeholder="Zoek steak, sushi, risotto, vegan…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
            <button type="submit" className="hero-search-btn">🔍 Zoeken</button>
          </form>

          <div className="meal-selector" style={{ justifyContent: 'center', marginTop: 16 }}>
            {MEAL_SHORTCUTS.map((m) => (
              <Link
                key={m.value}
                href={`/search?meal=${m.value}`}
                className="home-meal-btn"
                style={{ textDecoration: 'none', display: 'inline-block' }}
              >
                {m.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="filter-section" style={{ alignItems: 'center' }}>
        <div className="filters-panel-label">Populaire keukens</div>
        <div className="cuisine-chip-list" style={{ justifyContent: 'center' }}>
          {CUISINE_SHORTCUTS.map((c) => (
            <Link
              key={c}
              href={`/search?cuisine=${encodeURIComponent(c)}`}
              className="cuisine-chip"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              {c}
            </Link>
          ))}
        </div>
      </section>

      <section style={{ textAlign: 'center', padding: '40px 24px 64px' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 12 }}>
          Liever zelf rondkijken?
        </p>
        <Link href="/restaurants" className="detail-menu-btn-outline">
          Bekijk alle restaurants →
        </Link>
      </section>
    </>
  )
}
