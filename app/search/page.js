'use client'
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

// BE-03 — dish-first search results.
//
// This is a standalone route, not wired into the homepage yet (that's
// BE-04). It consumes the existing, unchanged /api/search endpoint
// (BE-02b/BE-02c) and does not modify any existing page.

const TAG_LABELS = {
  aanbevolen:  'Aanbevolen',
  dagspecial:  'Dagspecial',
  vegetarisch: 'Vegetarisch',
  vegan:       'Vegan',
  halal:       'Halal',
  glutenvrij:  'Glutenvrij',
}

// Display-only heuristic: does the query show up anywhere a user would
// actually see it on this row (name/description/tags)? If not — i.e. the
// only reason this dish matched is its restaurant's name (ranking tier 4,
// see docs/api/dish-search-ranking.md) — say so, so the result doesn't look
// unexplained. This never re-orders or re-filters results; the server's
// order is authoritative.
function isWeakMatch(dish, query) {
  if (!query || query.length < 2) return false
  const needle = query.toLowerCase()
  const visibleTextMatches =
    dish.name.toLowerCase().includes(needle) ||
    (dish.description || '').toLowerCase().includes(needle) ||
    dish.tags.some((t) => t.toLowerCase().includes(needle))
  return !visibleTextMatches
}

function formatPrice(dish) {
  if (dish.priceOnRequest) return 'op aanvraag'
  if (dish.priceIsFrom) return `vanaf ${dish.priceDisplay}`
  return dish.priceDisplay
}

function DishResultRow({ dish, query }) {
  const weakMatch = isWeakMatch(dish, query)
  return (
    <div className="menu-card dish-result-card">
      <div className="card-top">
        <div className="td-name">{dish.name}</div>
        <div className={`td-price ${dish.priceOnRequest ? 'no-price' : ''}`}>
          {formatPrice(dish)}
        </div>
      </div>

      <div className="dish-result-restaurant">
        {dish.restaurantName}
        {dish.openStatus === 'open' && <span className="dish-result-status is-open"> · Nu open</span>}
        {dish.openStatus === 'closed' && <span className="dish-result-status is-closed"> · Gesloten</span>}
        {dish.distanceMeters != null && (
          <span className="dish-result-distance"> · {Math.round(dish.distanceMeters)} m</span>
        )}
        {weakMatch && <span className="dish-result-match-hint"> · gevonden via restaurantnaam</span>}
      </div>

      {dish.description && <div className="td-desc">{dish.description}</div>}

      {dish.tags?.length > 0 && (
        <div className="item-tags">
          {dish.tags.map((t) => (
            <span key={t} className={`item-tag tag-${t}`}>{TAG_LABELS[t] || t}</span>
          ))}
        </div>
      )}

      <Link href={dish.menuLink} className="detail-menu-btn-outline dish-result-link">
        Bekijk menu →
      </Link>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  )
}

function SearchPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get('q') || ''

  const [inputValue, setInputValue] = useState(urlQuery)
  const [activeQuery, setActiveQuery] = useState(urlQuery)
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [hasSearched, setHasSearched] = useState(!!urlQuery)

  const requestId = useRef(0)

  const runSearch = useCallback(async (query, cursor) => {
    const id = ++requestId.current
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (cursor) params.set('cursor', String(cursor))

    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/search?${params.toString()}`)
      if (!res.ok) throw new Error(`Search request failed (${res.status})`)
      const data = await res.json()
      if (id !== requestId.current) return // stale response, ignore

      setResults((prev) => (cursor ? [...prev, ...data.results] : data.results))
      setTotal(data.total)
      setNextCursor(data.nextCursor)
      setHasMore(data.hasMore)
    } catch (e) {
      if (id !== requestId.current) return
      setError('Zoeken is niet gelukt. Probeer het opnieuw.')
    } finally {
      if (id !== requestId.current) return
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    if (!urlQuery) return
    setHasSearched(true)
    setActiveQuery(urlQuery)
    runSearch(urlQuery, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery])

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = inputValue.trim()
    setHasSearched(true)
    setActiveQuery(trimmed)
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search')
    runSearch(trimmed, 0)
  }

  const handleLoadMore = () => {
    if (nextCursor == null) return
    runSearch(activeQuery, nextCursor)
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="logo">Breda<span>Eats</span></Link>
          <Link href="/" className="back-btn">← Home</Link>
        </div>
      </header>

      <section className="search-page-hero">
        <form className="search-field search-page-field" onSubmit={handleSubmit}>
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input flagship"
            placeholder="Zoek steak, sushi, risotto, vegan…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          {inputValue && (
            <button type="button" className="search-clear" onClick={() => setInputValue('')}>×</button>
          )}
        </form>
      </section>

      <main className="results-section">
        {!hasSearched ? (
          <div className="empty-state">
            <h3>Waar heb je zin in?</h3>
            <p>Typ een gerecht, ingrediënt of keuken hierboven.</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <h3>Er ging iets mis</h3>
            <p>{error}</p>
          </div>
        ) : loading ? (
          <div className="empty-state">
            <p>Zoeken…</p>
          </div>
        ) : results.length === 0 ? (
          <div className="empty-state">
            <h3>Geen gerechten gevonden</h3>
            <p>
              {activeQuery
                ? `Niets gevonden voor "${activeQuery}". Probeer een andere zoekterm.`
                : 'Typ een zoekterm om te beginnen.'}
            </p>
          </div>
        ) : (
          <>
            <div className="results-header">
              <span className="results-count">
                {total} gerecht{total !== 1 ? 'en' : ''}
                {activeQuery && ` gevonden voor "${activeQuery}"`}
              </span>
            </div>

            <div className="dish-results-list">
              {results.map((dish) => (
                <DishResultRow key={dish.dishId} dish={dish} query={activeQuery} />
              ))}
            </div>

            {hasMore && (
              <div className="load-more-wrap">
                <button
                  className="detail-menu-btn-outline load-more-btn"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Laden…' : 'Meer resultaten laden ↓'}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  )
}
