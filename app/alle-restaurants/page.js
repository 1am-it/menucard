'use client'
import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'
import PrimaryNav from '@/src/components/PrimaryNav'
import MobileTabBar from '@/src/components/MobileTabBar'
import RestaurantListCard from '@/src/components/RestaurantListCard'
import Wordmark from '@/src/components/Wordmark'
import Emoji from '@/src/components/Emoji'
import {
  DEFAULT_SORT,
  normalizeSort,
  sortRestaurants,
  filterRestaurants,
  countWithMenu,
  cuisineChips,
} from '@/src/lib/restaurantBrowse'

// BE-28b (#68) — "Alle restaurants" in de goedgekeurde frisse stijl.
//
// Referentie: docs/mockups/be-28-fresh-style-v1/alle-restaurants-desktop.html
// en alle-restaurants-390-antraciet.html (canvas v17, owner decision
// 2026-10-25), plus de BE-28-regels (antraciet met witte knoppen, emoji's
// overal). De pagina blijft dezelfde route en dezelfde bestaande data:
// GET /api/restaurants (src/services/restaurantIndex.js), nog steeds alleen
// restaurantniveau en nooit data/menus.json.
//
// De standaardsortering "Met menukaart eerst" en "A–Z" staan in
// src/lib/restaurantBrowse.js, net als het filteren, tellen en het
// kaartmodel (getest in src/lib/restaurantBrowse.test.js). De keukenchips
// komen uit de echte keukenlabels van de geladen restaurants; een keuken
// zonder bekende familie houdt zijn eigen naam en krijgt het neutrale 🍽️.
//
// De hele lijst wordt in één keer geladen (bestaande `limit`, maximaal 50 per
// pagina, herhaald tot `hasMore` false is) zodat sorteren en de telling
// "N met menukaart" over de echte, volledige set gaan en niet alleen over de
// eerste pagina. Geen nieuwe API, geen nieuwe data.

const PAGE_LIMIT = 50
const MAX_PAGES = 20

function parseQ(searchParams) {
  return searchParams.get('q') || ''
}

function withPlural(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`
}

export default function AlleRestaurantsPage() {
  return (
    <Suspense fallback={null}>
      <AlleRestaurantsPageInner />
    </Suspense>
  )
}

function AlleRestaurantsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const q = parseQ(searchParams)
  const sort = normalizeSort(searchParams.get('sort'))

  const [inputValue, setInputValue] = useState(q)
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [onlyWithMenu, setOnlyWithMenu] = useState(false)
  const [activeCuisine, setActiveCuisine] = useState(null)

  const requestId = useRef(0)

  useEffect(() => {
    setInputValue(q)
  }, [q])

  const runSearch = useCallback(async (query) => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)

    try {
      let all = []
      let cursor = 0
      let pages = 0
      let apiTotal = 0

      while (pages < MAX_PAGES) {
        const params = new URLSearchParams()
        if (query) params.set('q', query)
        if (cursor) params.set('cursor', String(cursor))
        params.set('limit', String(PAGE_LIMIT))

        const res = await fetch(`/api/restaurants?${params.toString()}`)
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const data = await res.json()
        if (id !== requestId.current) return

        all = all.concat(Array.isArray(data.results) ? data.results : [])
        apiTotal = typeof data.total === 'number' ? data.total : all.length
        pages += 1

        if (!data.hasMore || data.nextCursor == null) break
        cursor = data.nextCursor
      }

      setResults(all)
      setTotal(apiTotal)
    } catch (e) {
      if (id !== requestId.current) return
      setError('Laden is niet gelukt. Probeer het opnieuw.')
    } finally {
      if (id !== requestId.current) return
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    runSearch(q)
    setOnlyWithMenu(false)
    setActiveCuisine(null)
  }, [q, runSearch])

  const buildHref = useCallback((nextQuery, nextSort) => {
    const params = new URLSearchParams()
    if (nextQuery) params.set('q', nextQuery)
    if (nextSort === 'az') params.set('sort', 'az')
    const qs = params.toString()
    return qs ? `/alle-restaurants?${qs}` : '/alle-restaurants'
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    router.replace(buildHref(inputValue.trim(), sort), { scroll: false })
  }

  const handleSortChange = (e) => {
    router.replace(buildHref(q, e.target.value), { scroll: false })
  }

  const chips = useMemo(() => cuisineChips(results), [results])

  const visible = useMemo(
    () => sortRestaurants(filterRestaurants(results, { onlyWithMenu, family: activeCuisine }), sort),
    [results, onlyWithMenu, activeCuisine, sort]
  )

  const filtersActive = onlyWithMenu || Boolean(activeCuisine)
  const visibleWithMenu = countWithMenu(visible)
  const totalWithMenu = countWithMenu(results)

  const resetFilters = () => {
    setOnlyWithMenu(false)
    setActiveCuisine(null)
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

      <main className="ar-page page-with-tabbar">
        <div className="ar-hero">
          <div className="ar-heading">
            <div className="ar-heading-copy">
              <h1 className="ar-title">
                Alle restaurants <Emoji glyph="🍽️" />
              </h1>
              <p className="ar-sub">
                Elk bekend restaurant in Breda, ook als we de menukaart nog niet hebben.
              </p>
            </div>
            <label className="ar-sort-label">
              Sorteren
              <select className="ar-sort" value={sort} onChange={handleSortChange}>
                <option value={DEFAULT_SORT}>📋 Met menukaart eerst</option>
                <option value="az">A–Z</option>
              </select>
            </label>
          </div>

          <form onSubmit={handleSubmit} className="search-field ar-search" role="search">
            <Emoji glyph="🔍" />
            <label htmlFor="ar-q" className="vh">Zoek op naam of buurt</label>
            <input
              id="ar-q"
              type="text"
              className="search-input"
              placeholder="Zoek op naam of buurt"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </form>

          <div className="ar-chips">
            <button
              type="button"
              className="chip"
              aria-pressed={onlyWithMenu}
              onClick={() => setOnlyWithMenu((value) => !value)}
            >
              <Emoji glyph="📋" /> Met menukaart
            </button>
            {chips.map((chip) => (
              <button
                key={chip.family}
                type="button"
                className="chip"
                aria-pressed={activeCuisine === chip.family}
                onClick={() => setActiveCuisine((value) => (value === chip.family ? null : chip.family))}
              >
                <Emoji glyph={chip.emoji} /> {chip.family}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="empty-state">
            <h3>Er ging iets mis</h3>
            <p>{error}</p>
          </div>
        ) : loading ? (
          <div className="empty-state">
            <p>Laden…</p>
          </div>
        ) : results.length === 0 ? (
          <div className="empty-state">
            <h3>Geen restaurants gevonden</h3>
            <p>{q ? `Niets gevonden voor "${q}".` : 'Er zijn geen restaurants om te tonen.'}</p>
          </div>
        ) : (
          <>
            <p className="ar-count">
              {filtersActive
                ? `${visible.length} van ${withPlural(total, 'restaurant', 'restaurants')} · ${visibleWithMenu} met menukaart`
                : `${withPlural(total, 'restaurant', 'restaurants')} · ${totalWithMenu} met menukaart`}
            </p>

            {visible.length === 0 ? (
              <div className="empty-state">
                <h3>Geen restaurants met deze filters</h3>
                <p>Pas je keuze aan om meer restaurants te zien.</p>
                <button type="button" className="chip" onClick={resetFilters}>
                  Filters wissen ×
                </button>
              </div>
            ) : (
              <div className="ar-grid">
                {visible.map((restaurant) => (
                  <RestaurantListCard key={restaurant.restaurantId} restaurant={restaurant} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <MobileTabBar />
    </>
  )
}
