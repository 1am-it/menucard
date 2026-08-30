'use client'
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'

// BE-03 — dish-first search results.
// BE-06 — filters + URL state added on top, see below.
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

// ─── BE-06 filter constants ─────────────────────────────────────────────────
// Duplicated from app/page.js rather than imported — that file is a separate
// 'use client' page, not a shared module, consistent with how BE-02b/BE-03
// already duplicate small constants during this migration.

const MEAL_OPTIONS = [
  { value: 'lunch', label: '🥗 Lunch' },
  { value: 'diner', label: '🍽 Diner' },
  { value: 'borrel', label: '🍸 Borrel' },
  { value: 'specialiteiten', label: '⭐ Specialiteiten' },
]

const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
const DAY_LABELS = { ma: 'Ma', di: 'Di', wo: 'Wo', do: 'Do', vr: 'Vr', za: 'Za', zo: 'Zo' }
const DAY_FULL = { ma: 'Maandag', di: 'Dinsdag', wo: 'Woensdag', do: 'Donderdag', vr: 'Vrijdag', za: 'Zaterdag', zo: 'Zondag' }

// Buckets chosen from the real dish price distribution (p25=€5, p50=€10,
// p75=€21.75, p90=€39) rather than the legacy restaurant-level €/€€/€€€
// buckets, since dish search filters on actual numeric dish prices.
const PRICE_OPTIONS = [
  { value: '10', label: 't/m €10' },
  { value: '20', label: 't/m €20' },
  { value: '40', label: 't/m €40' },
]

const CUISINES = ['Amerikaans', 'Chinees', 'Frans', 'Fusion', 'Grill & Steak', 'Indiaas', 'Indonesisch', 'Italiaans', 'Mediterraan', 'Midden-Oosten', 'Modern Europees', 'Nederlands']

const EU14 = [
  { id: 1,  icon: '🌾', name: 'Gluten' },
  { id: 2,  icon: '🦞', name: 'Schaaldieren' },
  { id: 3,  icon: '🥚', name: 'Eieren' },
  { id: 4,  icon: '🐟', name: 'Vis' },
  { id: 5,  icon: '🥜', name: "Pinda's" },
  { id: 6,  icon: '🫘', name: 'Soja' },
  { id: 7,  icon: '🥛', name: 'Melk' },
  { id: 8,  icon: '🌰', name: 'Noten' },
  { id: 9,  icon: '🥬', name: 'Selderij' },
  { id: 10, icon: '🌿', name: 'Mosterd' },
  { id: 11, icon: '🌱', name: 'Sesam' },
  { id: 12, icon: '🍇', name: 'Sulfiet' },
  { id: 13, icon: '🌻', name: 'Lupine' },
  { id: 14, icon: '🦑', name: 'Weekdieren' },
]

// Parses the current filter state from URL search params — the single
// source of truth. No parallel React state duplicates this, so back/forward,
// reload, and shared links all restore identically to whatever built the UI.
function parseFilters(searchParams) {
  return {
    q: searchParams.get('q') || '',
    meal: searchParams.get('meal') || '',
    maxPrice: searchParams.get('maxPrice') || '',
    cuisines: (searchParams.get('cuisine') || '').split(',').filter(Boolean),
    excl: (searchParams.get('excl') || '').split(',').filter(Boolean),
    day: searchParams.get('day') || '',
    nowOpen: searchParams.get('nowOpen') === '1',
  }
}

function hasActiveFilters(f) {
  return !!(f.meal || f.maxPrice || f.cuisines.length || f.excl.length || f.day || f.nowOpen)
}

function buildParams(f) {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.meal) p.set('meal', f.meal)
  if (f.maxPrice) p.set('maxPrice', f.maxPrice)
  if (f.cuisines.length) p.set('cuisine', f.cuisines.join(','))
  if (f.excl.length) p.set('excl', f.excl.join(','))
  if (f.day) p.set('day', f.day)
  if (f.nowOpen) p.set('nowOpen', '1')
  return p
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

  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const filtersKey = searchParams.toString()
  const active = hasActiveFilters(filters)

  const [inputValue, setInputValue] = useState(filters.q)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  const requestId = useRef(0)

  // Keep the (uncommitted) text input in sync when the URL's q changes from
  // outside typing — e.g. back/forward, a shared link, or a filter reset.
  // Typing itself never touches the URL until submit, so this never fights
  // the user mid-keystroke.
  useEffect(() => {
    setInputValue(filters.q)
  }, [filters.q])

  const runSearch = useCallback(async (f, cursor) => {
    const id = ++requestId.current
    const params = buildParams(f)
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

  // Single trigger for every way the URL can change: initial load, text
  // search submit, a filter toggle, a reset, or browser back/forward — all
  // of them change `filtersKey`, and this is the only place that fetches.
  useEffect(() => {
    if (!filters.q && !active) {
      setResults([]); setTotal(0); setNextCursor(null); setHasMore(false)
      return
    }
    runSearch(filters, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey])

  const pushFilters = useCallback((next) => {
    const qs = buildParams(next).toString()
    router.replace(qs ? `/search?${qs}` : '/search', { scroll: false })
  }, [router])

  const handleSubmit = (e) => {
    e.preventDefault()
    pushFilters({ ...filters, q: inputValue.trim() })
  }

  const setFilter = (key, value) => pushFilters({ ...filters, [key]: value })

  const toggleInList = (key, value) => {
    const list = filters[key]
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
    pushFilters({ ...filters, [key]: next })
  }

  const resetFilters = () => pushFilters({ q: filters.q, meal: '', maxPrice: '', cuisines: [], excl: [], day: '', nowOpen: false })

  const handleLoadMore = () => {
    if (nextCursor == null) return
    runSearch(filters, nextCursor)
  }

  const panelFilterCount = (filters.day ? 1 : 0) + (filters.maxPrice ? 1 : 0) + filters.cuisines.length + filters.excl.length

  const activeFilterTags = useMemo(() => {
    const tags = []
    if (filters.meal) tags.push({ key: 'meal', label: MEAL_OPTIONS.find((m) => m.value === filters.meal)?.label || filters.meal, onRemove: () => setFilter('meal', '') })
    if (filters.nowOpen) tags.push({ key: 'nowOpen', label: '🟢 Nu open', onRemove: () => setFilter('nowOpen', false) })
    if (filters.day) tags.push({ key: 'day', label: DAY_FULL[filters.day], onRemove: () => setFilter('day', '') })
    if (filters.maxPrice) tags.push({ key: 'price', label: `t/m €${filters.maxPrice}`, onRemove: () => setFilter('maxPrice', '') })
    filters.cuisines.forEach((c) => tags.push({ key: `cuisine-${c}`, label: c, onRemove: () => toggleInList('cuisines', c) }))
    filters.excl.forEach((id) => {
      const a = EU14.find((x) => String(x.id) === id)
      if (a) tags.push({ key: `excl-${id}`, label: `Zonder ${a.name}`, onRemove: () => toggleInList('excl', id) })
    })
    return tags
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey])

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="logo">Breda<span>Eats</span></Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ThemeToggle />
            <Link href="/" className="back-btn">← Home</Link>
          </div>
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

        {/* ── BE-06: always-visible quick filters ── */}
        <div className="meal-selector" style={{ marginTop: 12 }}>
          {MEAL_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`home-meal-btn ${filters.meal === m.value ? 'active' : ''}`}
              onClick={() => setFilter('meal', filters.meal === m.value ? '' : m.value)}
            >
              {m.label}
            </button>
          ))}
          <button
            type="button"
            className={`now-open-btn ${filters.nowOpen ? 'active' : ''}`}
            onClick={() => setFilter('nowOpen', !filters.nowOpen)}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: filters.nowOpen ? 'var(--green)' : 'var(--text-faint)', marginRight: 6 }} />
            Nu open
          </button>
          <button
            type="button"
            className={`filters-toggle-btn ${filtersOpen ? 'active' : ''}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
          >
            Filters {panelFilterCount > 0 && <span className="cat-count">{panelFilterCount}</span>}
          </button>
        </div>

        {/* ── BE-06: expandable filter panel — day, price, cuisine, allergens ── */}
        {filtersOpen && (
          <div className="filters-panel">
            <div className="filters-panel-group">
              <div className="filters-panel-label">Dag</div>
              <div className="day-selector">
                {DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`day-btn ${filters.day === d ? 'active' : ''}`}
                    onClick={() => setFilter('day', filters.day === d ? '' : d)}
                  >
                    {DAY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="filters-panel-group">
              <div className="filters-panel-label">Max. prijs</div>
              <div className="day-selector">
                {PRICE_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`mf-btn ${filters.maxPrice === p.value ? 'active' : ''}`}
                    onClick={() => setFilter('maxPrice', filters.maxPrice === p.value ? '' : p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filters-panel-group">
              <div className="filters-panel-label">Keuken</div>
              <div className="cuisine-chip-list">
                {CUISINES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`cuisine-chip ${filters.cuisines.includes(c) ? 'active' : ''}`}
                    onClick={() => toggleInList('cuisines', c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="filters-panel-group">
              <div className="filters-panel-label">Allergieën uitsluiten</div>
              <div className="allergen-chips" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                {EU14.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`allergen-chip ${filters.excl.includes(String(a.id)) ? 'active' : ''}`}
                    onClick={() => toggleInList('excl', String(a.id))}
                  >
                    {a.icon} {a.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeFilterTags.length > 0 && (
          <div className="active-filters-bar">
            {activeFilterTags.map((t) => (
              <span key={t.key} className="filter-tag">
                {t.label}
                <button onClick={t.onRemove} className="filter-tag-remove" aria-label="Verwijder filter">×</button>
              </span>
            ))}
            <button className="reset-btn" onClick={resetFilters}>Reset filters ×</button>
          </div>
        )}
      </section>

      <main className="results-section">
        {!filters.q && !active ? (
          <div className="empty-state">
            <h3>Waar heb je zin in?</h3>
            <p>Typ een gerecht, ingrediënt of keuken, of kies een filter hierboven.</p>
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
              {filters.q
                ? `Niets gevonden voor "${filters.q}"${active ? ' met deze filters' : ''}.`
                : 'Niets gevonden met deze filters.'}
              {' '}Probeer een andere zoekterm{active ? ' of pas de filters aan' : ''}.
            </p>
            {active && (
              <button className="detail-menu-btn-outline" onClick={resetFilters} style={{ marginTop: 12 }}>
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="results-header">
              <span className="results-count">
                {total} gerecht{total !== 1 ? 'en' : ''}
                {filters.q && ` gevonden voor "${filters.q}"`}
              </span>
            </div>

            <div className="dish-results-list">
              {results.map((dish) => (
                <DishResultRow key={dish.dishId} dish={dish} query={filters.q} />
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
