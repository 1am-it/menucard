'use client'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ThemeToggle from '@/src/components/ThemeToggle'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG_LABELS = {
  aanbevolen:  'Aanbevolen',
  dagspecial:  'Dagspecial',
  vegetarisch: 'Vegetarisch',
  vegan:       'Vegan',
  halal:       'Halal',
  glutenvrij:  'Glutenvrij',
}

const MEAL_CONFIG = {
  lunch:          { label: '🥗 Lunch',          title: 'Lunchkaart' },
  diner:          { label: '🍽 Diner',          title: 'Dinerkaart' },
  borrel:         { label: '🍸 Borrel',         title: 'Borrelkaart' },
  specialiteiten: { label: '⭐ Specialiteiten', title: 'Specialiteiten' },
}

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

const DIET_TAGS = [
  { key: 'vegetarisch', icon: '🌿', label: 'Vegetarisch' },
  { key: 'vegan',       icon: '🌱', label: 'Vegan' },
  { key: 'halal',       icon: '☪️',  label: 'Halal' },
  { key: 'glutenvrij',  icon: '🌾', label: 'Glutenvrij' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePrice(priceStr) {
  if (!priceStr) return null
  const match = priceStr.replace(',', '.').match(/[\d.]+/)
  return match ? parseFloat(match[0]) : null
}

function highlight(text, query) {
  if (!query || query.length < 2) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

function itemMatchesQuery(item, q) {
  if (!q || q.length < 2) return true
  const search = q.toLowerCase()
  return (
    (item.name || '').toLowerCase().includes(search) ||
    (item.desc || '').toLowerCase().includes(search) ||
    (item.sup  || '').toLowerCase().includes(search) ||
    (item.wine || '').toLowerCase().includes(search)
  )
}

function itemMatchesAllergens(item, excludeIds) {
  if (!excludeIds.length) return { safe: true, unknown: false }
  const allergens = item.allergens
  if (!Array.isArray(allergens)) return { safe: false, unknown: true }
  const hasExcluded = excludeIds.some(id => allergens.includes(id))
  return { safe: !hasExcluded, unknown: false }
}

function itemMatchesDiet(item, dietTags) {
  if (!dietTags.length) return true
  return dietTags.every(tag => (item.tags || []).includes(tag))
}

function itemMatchesPrice(item, maxPrice) {
  if (!maxPrice) return true
  const price = parsePrice(item.price)
  if (price === null) return true // 'op aanvraag' altijd tonen
  return price <= maxPrice
}

// ─── MenuItem Component ────────────────────────────────────────────────────────

function MenuItem({ item, query, excludeAllergens, isFiltering }) {
  const { safe, unknown } = itemMatchesAllergens(item, excludeAllergens)
  const hasAllergenFilter = excludeAllergens.length > 0

  return (
    <div className={`menu-card ${hasAllergenFilter && unknown ? 'mc-unknown' : ''} ${hasAllergenFilter && !safe ? 'mc-unsafe' : ''}`}>
      <div className="card-top">
        <div className="td-name">{highlight(item.name, query)}</div>
        <div className={`td-price ${!item.price ? 'no-price' : ''}`}>
          {item.price || 'op aanvraag'}
        </div>
      </div>

      {item.desc && (
        <div className="td-desc">{highlight(item.desc, query)}</div>
      )}
      {item.sup  && <div className="td-sup">+ {highlight(item.sup, query)}</div>}
      {item.wine && <div className="td-wine">🍷 {item.wine}</div>}

      {/* Allergen status badges */}
      {hasAllergenFilter && (
        <div className="mc-allergen-status">
          {unknown && (
            <span className="mc-badge mc-badge-unknown">
              ⚠ Allergeneninformatie onbekend
            </span>
          )}
          {!safe && !unknown && (
            <span className="mc-badge mc-badge-contains">
              Bevat geselecteerde allergenen
            </span>
          )}
        </div>
      )}

      {/* Allergen icons for contained allergens */}
      {Array.isArray(item.allergens) && item.allergens.length > 0 && (
        <div className="mc-allergen-icons">
          {item.allergens.map(id => {
            const a = EU14.find(x => x.id === id)
            if (!a) return null
            const isExcluded = excludeAllergens.includes(id)
            return (
              <span
                key={id}
                className={`mc-allergen-icon ${isExcluded ? 'excluded' : ''}`}
                title={a.name}
              >
                {a.icon}
              </span>
            )
          })}
        </div>
      )}

      {item.tags?.length > 0 && (
        <div className="item-tags">
          {item.tags.map(t => (
            <span key={t} className={`item-tag tag-${t}`}>{TAG_LABELS[t] || t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MenuPage() {
  const params       = useParams()
  const searchParams = useSearchParams()
  const id           = params.id

  // Read URL params (doorgegeven vanuit homepage)
  const urlQuery   = searchParams.get('q') || ''
  const urlExclude = searchParams.get('excl')
    ? searchParams.get('excl').split(',').map(Number).filter(Boolean)
    : []

  // Filter state — initialiseer vanuit URL
  const [query,           setQuery]           = useState(urlQuery)
  const [excludeAllergens, setExcludeAllergens] = useState(urlExclude)
  const [allergenOpen,    setAllergenOpen]    = useState(urlExclude.length > 0)
  const [dietTags,        setDietTags]        = useState([])
  const [maxPrice,        setMaxPrice]        = useState(0) // 0 = geen limiet
  const [activeSection,   setActiveSection]   = useState(0)

  // IntersectionObserver voor actieve sectie
  const sectionRefs = useRef([])
  useEffect(() => {
    const observers = sectionRefs.current.map((el, i) => {
      if (!el) return null
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(i) },
        { rootMargin: '-30% 0px -60% 0px' }
      )
      obs.observe(el)
      return obs
    })
    return () => observers.forEach(o => o?.disconnect())
  }, [id])

  const r = menusData[id]

  if (!r) return (
    <div className="empty-state" style={{ paddingTop: 80 }}>
      <h2>Menu niet gevonden</h2>
      <p>Controleer de URL of ga <Link href="/" style={{ color: 'var(--green)' }}>terug naar het overzicht</Link>.</p>
    </div>
  )

  const baseId    = id.split('-')[0]
  const mealType  = id.split('-').slice(1).join('-')
  const subtitle  = MEAL_CONFIG[mealType]?.title || r.subtitle || 'Menukaart'
  const restaurant = restaurantsData[baseId] || {}

  const availableMeals = ['lunch', 'diner', 'borrel', 'specialiteiten'].filter(
    m => menusData[`${baseId}-${m}`]
  )

  // Max price options based on actual prices in this menu
  const allPrices = useMemo(() => {
    const prices = []
    for (const cat of r.categories) {
      for (const item of cat.items) {
        const p = parsePrice(item.price)
        if (p) prices.push(p)
      }
    }
    return prices.sort((a, b) => a - b)
  }, [id])

  const priceMax = allPrices.length ? Math.ceil(allPrices[allPrices.length - 1]) : 100

  // Filter logic per category
  const isFiltering = query.length >= 2 || excludeAllergens.length > 0 || dietTags.length > 0 || maxPrice > 0

  const filteredCategories = useMemo(() => {
    return r.categories.map(cat => ({
      ...cat,
      items: cat.items.filter(item => {
        if (!itemMatchesQuery(item, query)) return false
        if (excludeAllergens.length > 0) {
          const { safe, unknown } = itemMatchesAllergens(item, excludeAllergens)
          // Toon onbekende items met waarschuwing, maar verberg items die aantoonbaar onveilig zijn
          if (!safe && !unknown) return false
        }
        if (!itemMatchesDiet(item, dietTags)) return false
        if (!itemMatchesPrice(item, maxPrice || null)) return false
        return true
      })
    })).filter(cat => cat.items.length > 0)
  }, [r, query, excludeAllergens, dietTags, maxPrice])

  const totalVisible = filteredCategories.reduce((n, c) => n + c.items.length, 0)
  const totalItems   = r.categories.reduce((n, c) => n + c.items.length, 0)

  const resetFilters = useCallback(() => {
    setQuery('')
    setExcludeAllergens([])
    setAllergenOpen(false)
    setDietTags([])
    setMaxPrice(0)
  }, [])

  const toggleDiet = useCallback((tag) => {
    setDietTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }, [])

  const toggleAllergen = useCallback((id) => {
    setExcludeAllergens(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }, [])

  const hasFilters = isFiltering

  return (
    <>
      {/* ── Header ── */}
      <header>
        <div className="header-inner">
          <Link href="/" className="logo">Breda<span>Eats</span></Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ThemeToggle />
            <Link href="/" className="back-btn">← Alle restaurants</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <div className="hero">
        <div className="hero-inner">
          <div>
            <div className="hero-eyebrow">{r.name || restaurant.name}</div>
            <h1 className="hero-title">{subtitle}</h1>

            {/* Meal type switch */}
            {availableMeals.length > 1 && (
              <div className="meal-switch">
                {availableMeals.map(m => (
                  <Link
                    key={m}
                    href={`/menu/${baseId}-${m}`}
                    className={`meal-btn ${m === mealType ? 'active' : ''}`}
                  >
                    {MEAL_CONFIG[m]?.label || m}
                  </Link>
                ))}
              </div>
            )}

            {/* Category navigation */}
            <div className="cat-nav">
              {r.categories.map((cat, i) => (
                <a
                  key={i}
                  href={`#cat-${i}`}
                  className={`cat-nav-item ${i === activeSection ? 'active' : ''}`}
                  onClick={() => setActiveSection(i)}
                >
                  {cat.name}
                </a>
              ))}
            </div>
          </div>

          {/* Restaurant panel */}
          <div className="restaurant-panel">
            <div>
              <div className="rp-label">Restaurant</div>
              <div className="rp-name">{r.name || restaurant.name}</div>
              <div className="rp-line">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((r.address || restaurant.address || '') + ', Breda')}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  📍 {r.address || restaurant.address}
                </a>
              </div>
              {(r.phone || restaurant.phone) && (
                <div className="rp-line">📞 {r.phone || restaurant.phoneDisplay || restaurant.phone}</div>
              )}
            </div>
            <div className="rp-btns">
              <a className="rp-btn-website" href={r.website || restaurant.website} target="_blank" rel="noopener">Website</a>
              <a className="rp-btn-reserveer" href={r.website || restaurant.website} target="_blank" rel="noopener">Reserveer</a>
            </div>
            {r.source && (
              <div className="rp-source">
                Bron: <a href={r.source} target="_blank" rel="noopener">
                  {r.source.replace('https://','').replace('http://','')}
                </a> · {r.scraped}
              </div>
            )}
            {r.notes && <div className="rp-note">{r.notes}</div>}
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="menu-filter-bar">
        <div className="menu-filter-inner">

          {/* Ingredient search */}
          <div className="mf-search-wrap">
            <span className="mf-search-icon">🔍</span>
            <input
              type="text"
              className="mf-search"
              placeholder="Zoek gerecht of ingrediënt..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query && (
              <button className="mf-clear" onClick={() => setQuery('')}>×</button>
            )}
          </div>

          {/* Allergen exclude */}
          <button
            className={`mf-btn ${allergenOpen || excludeAllergens.length > 0 ? 'active' : ''}`}
            onClick={() => setAllergenOpen(o => !o)}
          >
            🛡 Allergie{excludeAllergens.length > 0 ? ` (${excludeAllergens.length})` : ''}
          </button>

          {/* Diet toggles */}
          {DIET_TAGS.map(d => (
            <button
              key={d.key}
              className={`mf-btn ${dietTags.includes(d.key) ? 'active' : ''}`}
              onClick={() => toggleDiet(d.key)}
            >
              {d.icon} {d.label}
            </button>
          ))}

          {/* Price filter */}
          {allPrices.length > 0 && (
            <div className="mf-price-wrap">
              <span className="mf-price-label">
                Max prijs: {maxPrice > 0 ? `€${maxPrice}` : 'alles'}
              </span>
              <input
                type="range"
                min={0}
                max={priceMax}
                step={5}
                value={maxPrice}
                onChange={e => setMaxPrice(Number(e.target.value))}
                className="mf-price-slider"
              />
            </div>
          )}

          {/* Reset */}
          {hasFilters && (
            <button className="mf-reset" onClick={resetFilters}>Reset ×</button>
          )}
        </div>

        {/* Allergen panel */}
        {allergenOpen && (
          <div className="mf-allergen-panel">
            <div className="mf-allergen-title">
              Sluit gerechten uit die bevatten:
            </div>
            <div className="mf-allergen-chips">
              {EU14.map(a => (
                <button
                  key={a.id}
                  className={`allergen-chip ${excludeAllergens.includes(a.id) ? 'active' : ''}`}
                  onClick={() => toggleAllergen(a.id)}
                >
                  {a.icon} {a.name}
                  {excludeAllergens.includes(a.id) && <span className="chip-x"> ×</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results count + active filter tags */}
        {hasFilters && (
          <div className="mf-status-bar">
            <span className="mf-count">
              {totalVisible} van {totalItems} gerechten
              {query.length >= 2 && ` voor "${query}"`}
            </span>
            <div className="mf-active-tags">
              {excludeAllergens.map(id => {
                const a = EU14.find(x => x.id === id)
                return a ? (
                  <span key={id} className="mf-tag">
                    Zonder {a.name}
                    <button onClick={() => toggleAllergen(id)} className="mf-tag-x">×</button>
                  </span>
                ) : null
              })}
              {dietTags.map(tag => {
                const d = DIET_TAGS.find(x => x.key === tag)
                return d ? (
                  <span key={tag} className="mf-tag">
                    {d.icon} {d.label}
                    <button onClick={() => toggleDiet(tag)} className="mf-tag-x">×</button>
                  </span>
                ) : null
              })}
              {maxPrice > 0 && (
                <span className="mf-tag">
                  Max €{maxPrice}
                  <button onClick={() => setMaxPrice(0)} className="mf-tag-x">×</button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Menu items ── */}
      <main className="page-main">
        {filteredCategories.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
            <h3>Geen gerechten gevonden</h3>
            <p>Pas je filters aan of <button onClick={resetFilters} style={{ color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>reset alle filters</button>.</p>
          </div>
        ) : (
          filteredCategories.map((cat, i) => {
            // Find original index for anchor ID
            const origIdx = r.categories.findIndex(c => c.name === cat.name)
            return (
              <div
                key={i}
                className="cat-section"
                id={`cat-${origIdx}`}
                ref={el => sectionRefs.current[origIdx] = el}
              >
                <div className="cat-title">
                  {cat.name}
                  {isFiltering && (
                    <span className="cat-count">{cat.items.length} gerecht{cat.items.length !== 1 ? 'en' : ''}</span>
                  )}
                </div>
                <div className="menu-grid">
                  {cat.items.map((item, j) => (
                    <MenuItem
                      key={j}
                      item={item}
                      query={query}
                      excludeAllergens={excludeAllergens}
                      isFiltering={isFiltering}
                    />
                  ))}
                </div>
              </div>
            )
          })
        )}

        {/* NVWA link */}
        <div className="nvwa-teaser">
          <div>
            <div className="nvwa-teaser-title">🛡 Allergeneninformatie (NVWA)</div>
            <div className="nvwa-teaser-sub">Volledige EU-14 allergenenmatrix · EU Verordening 1169/2011</div>
          </div>
          <Link href={`/nvwa/${baseId}`} className="nvwa-teaser-btn">
            Bekijk matrix
          </Link>
        </div>
      </main>
    </>
  )
}
