'use client'
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'
import PrimaryNav from '@/src/components/PrimaryNav'
import RestaurantBrowseCard from '@/src/components/RestaurantBrowseCard'

// BE-11 Fase 1 — first real, server-first "Alle restaurants" browse
// vertical slice. Deliberately a new, additive route (not `/restaurants`,
// which stays exactly as-is for existing deep links per
// planning/decisions/007-homepage-shift.md).
//
// Now permanently linked from the shared PrimaryNav (see
// src/components/PrimaryNav.js and the BE-11 ticket's "Primary
// navigation" section) — this page and /search are the only two routes
// that mount it in this first navigation slice; every other route
// (homepage, /restaurants, and every detail page) is deliberately
// excluded, not merely not-yet-wired.
//
// Consumes GET /api/restaurants (src/services/restaurantIndex.js) —
// restaurant-level only, never data/menus.json. See
// docs/api/restaurant-summary-shape.md for the full contract and its
// documented, deliberate gaps (no cuisine/buurt/day/nowOpen filter yet,
// no price-level filter, no GPS/distance).

function parseQ(searchParams) {
  return searchParams.get('q') || ''
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
  const qKey = searchParams.toString()

  const [inputValue, setInputValue] = useState(q)
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  const requestId = useRef(0)

  useEffect(() => {
    setInputValue(q)
  }, [q])

  const runSearch = useCallback(async (query, cursor) => {
    const id = ++requestId.current
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (cursor) params.set('cursor', String(cursor))

    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/restaurants?${params.toString()}`)
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const data = await res.json()
      if (id !== requestId.current) return

      setResults((prev) => (cursor ? [...prev, ...data.results] : data.results))
      setTotal(data.total)
      setNextCursor(data.nextCursor)
      setHasMore(data.hasMore)
    } catch (e) {
      if (id !== requestId.current) return
      setError('Laden is niet gelukt. Probeer het opnieuw.')
    } finally {
      if (id !== requestId.current) return
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    runSearch(q, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey])

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = inputValue.trim()
    router.replace(trimmed ? `/alle-restaurants?q=${encodeURIComponent(trimmed)}` : '/alle-restaurants', { scroll: false })
  }

  const handleLoadMore = () => {
    if (nextCursor == null) return
    runSearch(q, nextCursor)
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="logo">Breda<span>Eats</span></Link>
          <div className="header-right">
            <PrimaryNav />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="results-section">
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>Alle restaurants</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
          Elk bekend restaurant in Breda — ook restaurants die nog geen menukaart hebben.
        </p>

        <form onSubmit={handleSubmit} style={{ marginBottom: 16, maxWidth: 420 }}>
          <input
            type="text"
            className="search-input"
            placeholder="Zoek op naam of buurt"
            aria-label="Zoek op naam of buurt"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        </form>

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
            <div className="results-header">
              <span className="results-count">
                {total} restaurant{total !== 1 ? 's' : ''} gevonden
              </span>
            </div>

            <div className="restaurant-grid">
              {results.map((restaurant) => (
                <RestaurantBrowseCard key={restaurant.restaurantId} restaurant={restaurant} />
              ))}
            </div>

            {hasMore && (
              <div className="load-more-wrap">
                <button
                  className="detail-menu-btn-outline load-more-btn"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Laden…' : 'Meer restaurants laden ↓'}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  )
}
