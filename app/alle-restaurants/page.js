'use client'
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'

// BE-11 Fase 1 — first real, server-first "Alle restaurants" browse
// vertical slice. Deliberately a new, additive route (not `/restaurants`,
// which stays exactly as-is for existing deep links per
// planning/decisions/007-homepage-shift.md), and deliberately not yet
// linked from the shared site header/primary navigation — wiring the
// final `Zoeken`/`Alle restaurants` primary nav is a separate, larger
// decision affecting every page's shared header, not a small vertical
// slice; see the BE-11 ticket's own "Open technical questions" and this
// page's own header, which stays a plain, self-contained page header
// (logo + theme toggle only) rather than a half-built nav change.
//
// Consumes GET /api/restaurants (src/services/restaurantIndex.js) —
// restaurant-level only, never data/menus.json. See
// docs/api/restaurant-summary-shape.md for the full contract and its
// documented, deliberate gaps (no cuisine/buurt/day/nowOpen filter yet,
// no price-level filter, no GPS/distance).

const PRICE_LEVEL_LABEL = { 1: 'laag', 2: 'gemiddeld', 3: 'hoog' }

// Menu-type ids are "{restaurantId}-{mealType}" — derive a clean label
// from the suffix rather than using menuLinks[].label, which carries an
// emoji prefix (e.g. "🥗 Lunchkaart") not appropriate for this light
// card's plain-text information row. See BE-11 ticket §2 (no emoji) and
// the earlier BE-11 technical-preparation note that this derivation was
// still needed.
const MEAL_TYPE_LABELS = {
  lunch: 'Lunch',
  diner: 'Diner',
  borrel: 'Borrel',
  specialiteiten: 'Specialiteiten',
}
function mealTypeLabel(menuLinkId, restaurantId) {
  const suffix = menuLinkId.slice(restaurantId.length + 1)
  return MEAL_TYPE_LABELS[suffix] || suffix
}

function parseQ(searchParams) {
  return searchParams.get('q') || ''
}

function RestaurantBrowseCard({ restaurant }) {
  const priceLabel = restaurant.priceLevel ? PRICE_LEVEL_LABEL[restaurant.priceLevel] : null
  const priceGlyph = restaurant.priceLevel ? '€'.repeat(restaurant.priceLevel) : null

  return (
    <article className="lrc-card">
      <div className="lrc-header">
        <h2 className="lrc-name">{restaurant.name}</h2>
        <div className="lrc-cuisine">
          {restaurant.cuisine}
          {priceGlyph && (
            <>
              <span aria-hidden="true"> · <span className="lrc-price-glyph">{priceGlyph}</span></span>
              <span className="vh">, prijsniveau: {priceLabel}</span>
            </>
          )}
        </div>
      </div>
      <div className="lrc-body">
        {restaurant.hasMenu && (
          <div className="lrc-menu-type-row" aria-label="Beschikbare menutypen">
            {restaurant.menuLinks.map((link) => (
              <span key={link.id} className="lrc-menu-type-pill">
                {mealTypeLabel(link.id, restaurant.restaurantId)}
              </span>
            ))}
          </div>
        )}
        <div className="lrc-meta">
          {restaurant.address ? (
            <span className="lrc-address">{restaurant.address}</span>
          ) : restaurant.buurt ? (
            // No valid address on file (see docs/api/restaurant-summary-
            // shape.md "Known limitations") — fall back to the buurt,
            // but say so explicitly ("Buurt: X") rather than showing a
            // bare neighbourhood name in the exact same slot/style a
            // real street address would occupy, which could otherwise
            // read as an unusually short address. The visible text is
            // the only accessible name here (no aria-label override),
            // so both are identical by construction.
            <span className="lrc-address">Buurt: {restaurant.buurt}</span>
          ) : null}
          {restaurant.openStatus && (
            <span className={`lrc-status is-${restaurant.openStatus}`}>
              {restaurant.openStatus === 'open' ? 'Open nu' : 'Gesloten'}
            </span>
          )}
        </div>
      </div>
      <div className="lrc-footer">
        {restaurant.hasMenu ? (
          <Link href={`/restaurant/${restaurant.restaurantId}`} className="lrc-primary-btn">
            Bekijk {restaurant.menuLinks.length} menukaart{restaurant.menuLinks.length !== 1 ? 'en' : ''}
          </Link>
        ) : (
          <>
            <Link href={`/restaurant/${restaurant.restaurantId}`} className="lrc-primary-btn">
              Bekijk restaurant
            </Link>
            <p className="lrc-secondary-note">Nog geen menukaart beschikbaar.</p>
          </>
        )}
      </div>
    </article>
  )
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
