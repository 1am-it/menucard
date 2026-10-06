'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'
import Wordmark from '@/src/components/Wordmark'

// BE-04 — dish-first homepage. Deliberately lightweight: it forwards into
// the BE-03/BE-06 /search experience rather than re-implementing a second
// results page. The pre-BE-04 restaurant-browsing homepage was relocated,
// not deleted — see app/restaurants/page.js and
// planning/decisions/007-homepage-shift.md.

// Lichte lijn-iconen i.p.v. emoji (Onze Menukaarten-richting, design-reference
// "Woordmerk en iconen"): aria-hidden, currentColor, geen externe asset.
const MEAL_ICON_PATHS = {
  lunch: 'M3 11h14a7 7 0 01-14 0zM10 4v3M7 5.5l.8 1.6M13 5.5l-.8 1.6',
  diner: 'M6 2.5v6M4 2.5v4a2 2 0 004 0v-4M6 8.5v9M14.5 17.5v-15c-1.8.8-3 2.8-3 5.5v3h3',
  borrel: 'M4 3h12l-6 7zM10 10v7M6.5 17h7',
}

const MEAL_SHORTCUTS = [
  { value: 'lunch', label: 'Lunch' },
  { value: 'diner', label: 'Diner' },
  { value: 'borrel', label: 'Borrel' },
]

function LineIcon({ d, size = 16 }) {
  return (
    <svg className="hero-icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  )
}

const SEARCH_ICON_PATH = 'M8.5 3a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM12.5 12.5L17 17'

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
          <Wordmark />
          <div className="header-right">
            <ThemeToggle />
            <Link href="/restaurants" className="back-btn">Restaurants</Link>
          </div>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">
            Wat wil je vanavond <span className="hero-title-mark">eten</span>?
          </h1>
          <p className="hero-sub">Zoek in de menukaarten van restaurants in Breda</p>

          <form className="hero-search-bar" onSubmit={handleSubmit}>
            <div className="search-field" style={{ flex: 1 }}>
              <span className="search-icon"><LineIcon d={SEARCH_ICON_PATH} /></span>
              <input
                type="text"
                className="search-input flagship"
                placeholder="Zoek steak, sushi, risotto, vegan…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
            <button type="submit" className="hero-search-btn">Zoeken</button>
          </form>

          <div className="meal-selector" style={{ justifyContent: 'center', marginTop: 16 }}>
            {MEAL_SHORTCUTS.map((m) => (
              <Link
                key={m.value}
                href={`/search?meal=${m.value}`}
                className="home-meal-btn"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <LineIcon d={MEAL_ICON_PATHS[m.value]} />
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
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
          Liever zelf rondkijken?
        </p>
        <Link href="/alle-restaurants" className="detail-menu-btn-outline">
          Bekijk alle restaurants →
        </Link>
      </section>
    </>
  )
}
