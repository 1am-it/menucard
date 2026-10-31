'use client'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PublicHeaderActions from '@/src/components/PublicHeaderActions'
import PublicFooter from '@/src/components/PublicFooter'
import MobileTabBar from '@/src/components/MobileTabBar'
import { getReservationActions, getReservationNote, isExternalReservation, isValidPhone, isValidUrl } from '@/src/utils/reservation'
import { resolveDishTarget, buildDishDeepLink } from '@/src/lib/dishDeepLink'
import { hasShareTheme, dishShareTitle } from '@/src/lib/dishShare'
import { buildEntry } from '@/src/lib/dishList'
import { RESERVATION_EVENT, sendDishCounter } from '@/src/lib/dishCounters'
import SavedListBar from '@/src/components/SavedListBar'
import Wordmark from '@/src/components/Wordmark'
import Emoji from '@/src/components/Emoji'
import EmojiText from '@/src/components/EmojiText'
import ExternalLinkIcon from '@/src/components/ExternalLinkIcon'
import StatusIcon from '@/src/components/StatusIcon'
import useClientNow from '@/src/components/useClientNow'
// BE-55 stap B (#135) — "Vandaag" op de menupagina; geen aanbod, geen blok.
import DaghapVandaag from '@/src/components/DaghapVandaag'
import { todayOpening, openingBadge } from '@/src/lib/openingStatus'
import { seasonLabelForMenu } from '@/src/lib/seasonCalendar'
import { EU14, MEAL_CONFIG, menuTitle, itemMatchesAllergens, MenuItem, MenuSection, MenuGroupHeadings, MenuConfirmation } from '@/src/components/MenuBody'
// BE-57 (#139): de anonieme teller "bekeken" voor dit restaurant, één keer per
// pagina en per sessie, na het laden en zonder dat deze pagina erop wacht.
import ViewBeacon from '@/src/components/ViewBeacon'

// ─── Constants ────────────────────────────────────────────────────────────────

// TAG_LABELS, MEAL_CONFIG and EU14 live in src/components/MenuBody.js, shared
// with the internal Publicatievoorbeeld.

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

// MenuItem and MenuSection: src/components/MenuBody.js (the shared menu body).

// ─── Main View ────────────────────────────────────────────────────────────────

export default function MenuView({ id, r, restaurant, availableMeals, bevestiging = null }) {
  const searchParams = useSearchParams()

  // Read URL params (doorgegeven vanuit homepage)
  const urlQuery   = searchParams.get('q') || ''
  const urlExclude = searchParams.get('excl')
    ? searchParams.get('excl').split(',').map(Number).filter(Boolean)
    : []

  // BE-12 — additive-only dish deep-link params. Read here, alongside the
  // existing `q`/`excl` params, but never assigned into `query`/
  // `excludeAllergens` or any other existing filter state — `?q=` keeps
  // its exact current, independent meaning and effect regardless of
  // whether these are present.
  const dishParam      = searchParams.get('dish')
  const nameParam      = searchParams.get('name')
  const catParam       = searchParams.get('cat')
  const fromQueryParam = searchParams.get('fromQuery')
  // BE-44 (#105) — de stand van een gedeelde link. Hij kiest alleen de kleuren
  // van de voorvertoningsafbeelding (og:image) en verandert het thema van deze
  // pagina niet; de pagina leest hem nergens anders voor. De aanwezigheid van
  // een geldige stand is tegelijk het teken dat iemand deze link deelde, en
  // dus wanneer de regel "Iemand deelde dit gerecht met je" hoort te staan.
  const standParam = searchParams.get('stand')

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

  if (!r) return (
    <div className="empty-state" style={{ paddingTop: 80 }}>
      <h2>Menu niet gevonden</h2>
      <p>Controleer de URL of ga <Link href="/" style={{ color: 'var(--accent)' }}>terug naar het overzicht</Link>.</p>
    </div>
  )

  const baseId    = id.split('-')[0]
  const mealType  = id.split('-').slice(1).join('-')
  const subtitle  = menuTitle(id, r)
  // BE-29 (#70) — het label "Seizoen" alleen als deze kaart het zelf zegt
  // (Wildkaart, Seizoenskaart of de rubriek "Seizoen"), nooit op basis van
  // een woord in een gerechtnaam.
  const menuSeason = seasonLabelForMenu(r)
  const primaryReservation = getReservationActions(restaurant)[0]

  // BE-12 — resolve the dish deep-link (if any) against this route's own,
  // unfiltered categories. `resolvedTargetItem` is the actual item object
  // reference — used below for a robust identity check per rendered item,
  // rather than re-matching indices against whatever the active filter
  // happens to be showing.
  const dishTarget = useMemo(
    () => resolveDishTarget(dishParam, nameParam, catParam, id, r.categories),
    [dishParam, nameParam, catParam, id, r]
  )
  const resolvedTargetItem = dishTarget ? r.categories[dishTarget.catIdx].items[dishTarget.itemIdx] : null

  // BE-44 (#105, criterium 5) — de anonieme teller voor een klik op de
  // reserveringslink. Er staat één reserveringsknop op de menukaart (bij het
  // restaurant, niet per gerecht), dus valt er alleen een gerecht aan te wijzen
  // als deze pagina met een geldige gerechtlink is geopend: dat is precies het
  // gerecht waar de bezoeker voor kwam. Zonder zo'n link wordt er niets
  // verstuurd — liever geen telling dan een telling op een willekeurig gerecht.
  // Fire-and-forget: de link opent gewoon, ook als de telling mislukt.
  const reservationDishKey = dishTarget ? `${id}-${dishTarget.catIdx}-${dishTarget.itemIdx}` : null
  function countReservationClick() {
    if (!reservationDishKey) return
    void sendDishCounter({ dish: reservationDishKey, event: RESERVATION_EVENT })
  }

  const highlightedItemRef = useRef(null)
  const [showPulse, setShowPulse] = useState(false)
  const [dishAnnouncement, setDishAnnouncement] = useState('')

  // Scroll, focus, temporary highlight, and an accessible announcement —
  // only when a dish target actually resolved. Runs once per resolved
  // target (keyed on the target itself, not on the unrelated `query`/
  // filter state), so typing in the filter box afterwards never re-fires
  // this. `prefers-reduced-motion` is respected for the scroll itself;
  // this is the first place in this codebase that checks it (no existing
  // convention to reuse or break).
  useEffect(() => {
    if (!dishTarget || !resolvedTargetItem) return
    const node = highlightedItemRef.current
    // BE-12 — handles a valid dish context arriving alongside a `?q=` (or
    // allergen/diet/price) filter that excludes the resolved item from
    // filteredCategories: existing `?q=` behavior stays authoritative, so
    // when that happens `innerRef` below is never attached to any DOM
    // node for this render, `node` stays null, and this effect does
    // nothing — no crash, no focus moved, no highlight, no announcement.
    // Verified live: `?q=` values that exclude the resolved target leave
    // this a no-op, exactly like an unresolved/invalid dish context does.
    if (!node) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' })
    node.focus()
    setShowPulse(true)
    setDishAnnouncement(`Gerecht gevonden: ${resolvedTargetItem.name}`)

    // BE-16 — 4000ms (was 2750ms/BE-12): the only deliberate change to this
    // effect. Keyboard focus (node.focus() above) is unaffected — it stays
    // exactly where it landed until the visitor moves it, independent of
    // this timer clearing only the highlight class.
    const timer = setTimeout(() => setShowPulse(false), 4000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dishTarget])

  // BE-12 — a safe, same-origin, self-constructed relative back-link to
  // the original search results, built only from URLSearchParams — never
  // a free `returnTo` value, `document.referrer`, or sessionStorage.
  // Shown whenever `fromQuery` is present, independent of whether the
  // dish itself validated (see be-12-dish-result-deep-link-scroll-
  // highlight.md's own query-contract table: `fromQuery` is usable on its
  // own to build this link).
  const backToSearchHref = fromQueryParam
    ? `/search?${new URLSearchParams({ q: fromQueryParam }).toString()}`
    : null

  // BE-05 — optional secondary info, shown only when actually available
  // (planning/specs/restaurant-menu.md). Reuses the same simple
  // "today's key has an hours entry" check already used on
  // app/restaurant/[id]/page.js's hero, for consistency across pages.
  const todayKey = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][new Date().getDay()]
  // Kleurtaal v2: "Nu open" only when open at this moment (browser clock,
  // after mount); opening hours today alone are a neutral line.
  const now = useClientNow()
  const todayBadge = openingBadge(now ? todayOpening(restaurant.openingHours, now) : null, restaurant.openingHours, todayKey)
  const cuisineLabel = restaurant.cuisineLabel || restaurant.cuisine || null

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
      <ViewBeacon restaurantId={baseId} />
      {/* ── Header ── */}
      <header>
        <div className="header-inner">
          <Wordmark />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', rowGap: 8 }}>
            <PublicHeaderActions />
            <Link href={`/restaurant/${baseId}`} className="back-btn">← {r.name || restaurant.name}</Link>
            {/* BE-12 — alongside, not replacing, the restaurant back-link
                above. Only present when fromQuery is present. Wrapping
                (flexWrap above) is required here since this second link's
                text is long enough to overflow on narrow viewports
                otherwise — verified: without it, this exact combination
                overflowed at 390px (per decision 014 item 5's "mobile
                never causes horizontal overflow" rule). */}
            {backToSearchHref && (
              <Link href={backToSearchHref} className="back-btn">
                ← Terug naar zoekresultaten voor &apos;{fromQueryParam}&apos;
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* BE-12 — visually hidden, announces the resolved dish once; never
          re-announces on later, unrelated filter/state changes since it's
          only ever set inside the dishTarget-scoped effect above. */}
      <div aria-live="polite" className="vh">{dishAnnouncement}</div>

      {/* ── Hero ── */}
      <div className="hero">
        <div className="hero-inner">
          <div>
            <div className="hero-eyebrow">{r.name || restaurant.name}</div>
            <h1 className="hero-title">{subtitle}</h1>
            <MenuConfirmation bevestiging={bevestiging} />
            {menuSeason && (
              <div>
                <span className="menu-season-label">
                  <Emoji glyph={menuSeason.emoji} /> {menuSeason.label}
                </span>
              </div>
            )}

            {/* Meal type switch */}
            {availableMeals.length > 1 && (
              <nav className="meal-switch" aria-label="Menukaarten">
                {availableMeals.map(m => (
                  <Link
                    key={m}
                    href={`/menu/${baseId}-${m}`}
                    className={`meal-btn ${m === mealType ? 'active' : ''}`}
                    aria-current={m === mealType ? 'page' : undefined}
                  >
                    <EmojiText value={MEAL_CONFIG[m]?.label || m} />
                  </Link>
                ))}
              </nav>
            )}

            {/* Category navigation */}
            <nav className="cat-nav" aria-label="Gerechten op deze kaart">
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
            </nav>
          </div>

          {/* Restaurant panel */}
          <div className="restaurant-panel">
            <div>
              <div className="rp-label">Restaurant</div>
              <div className="rp-name">{r.name || restaurant.name}</div>
              {cuisineLabel && <div className="rp-line">{cuisineLabel}</div>}
              {restaurant.openingHours && (
                <div className="rp-line">
                  <span className={`status-badge status-badge--${todayBadge.role}`}>
                    {todayBadge.role === 'positive' && <Emoji glyph="🟢" />}
                    <StatusIcon name={todayBadge.icon} size={13} />
                    {todayBadge.text}
                  </span>
                </div>
              )}
              <div className="rp-line">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((r.address || restaurant.address || '') + ', Breda')}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <Emoji glyph="📍" /> {r.address || restaurant.address}
                </a>
              </div>
              {(isValidPhone(r.phone) || isValidPhone(restaurant.phone)) && (
                <div className="rp-line"><Emoji glyph="📞" /> {isValidPhone(r.phone) ? r.phone : (restaurant.phoneDisplay || restaurant.phone)}</div>
              )}
            </div>
            <div className="rp-btns">
              {isValidUrl(r.website || restaurant.website) && (
                <a className="rp-btn-website" href={r.website || restaurant.website} target="_blank" rel="noopener">Website</a>
              )}
              {primaryReservation && (
                <a
                  className="rp-btn-reserveer"
                  href={primaryReservation.href}
                  target={isExternalReservation(primaryReservation) ? '_blank' : undefined}
                  rel={isExternalReservation(primaryReservation) ? 'noopener noreferrer' : undefined}
                  onClick={countReservationClick}
                >
                  {primaryReservation.label}
                  {isExternalReservation(primaryReservation) && <ExternalLinkIcon />}
                </a>
              )}
            </div>
            {primaryReservation && (
              <p className="reservation-note">{getReservationNote(primaryReservation, r.name || restaurant.name)}</p>
            )}
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

      {/* BE-55 (issue 135, herstel na review deel 2) — "Vandaag" direct onder
          de kop en boven de zoek- en filterbalk; het staat los van de filters
          en verdwijnt als er niets online staat. */}
      <div className="daghap-band">
        <DaghapVandaag restaurantId={id.split('-')[0]} />
      </div>

      {/* ── Filter bar ── */}
      <div className="menu-filter-bar">
        <div className="menu-filter-inner">

          {/* Ingredient search */}
          <div className="mf-search-wrap">
            <span className="mf-search-icon" aria-hidden="true">🔍</span>
            <input
              type="text"
              className="mf-search"
              placeholder="Zoek gerecht of ingrediënt..."
              aria-label="Zoek gerecht of ingrediënt"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query && (
              <button className="mf-clear" aria-label="Zoekveld wissen" onClick={() => setQuery('')}>×</button>
            )}
          </div>

          {/* Allergen exclude */}
          <button
            className={`mf-btn ${allergenOpen || excludeAllergens.length > 0 ? 'active' : ''}`}
            onClick={() => setAllergenOpen(o => !o)}
          >
            <Emoji glyph="🛡" /> Allergie{excludeAllergens.length > 0 ? ` (${excludeAllergens.length})` : ''}
          </button>

          {/* Diet toggles */}
          {DIET_TAGS.map(d => (
            <button
              key={d.key}
              className={`mf-btn ${dietTags.includes(d.key) ? 'active' : ''}`}
              onClick={() => toggleDiet(d.key)}
            >
              <Emoji glyph={d.icon} /> {d.label}
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
                aria-label="Maximale prijs"
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
                    <Emoji glyph={d.icon} /> {d.label}
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
      <main className="page-main page-with-tabbar">
        {filteredCategories.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 36, marginBottom: 12 }}><Emoji glyph="🔍" /></div>
            <h3>Geen gerechten gevonden</h3>
            <p>Pas je filters aan of <button onClick={resetFilters} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>reset alle filters</button>.</p>
          </div>
        ) : (
          filteredCategories.map((cat, i) => {
            // Find original index for anchor ID (name AND section path: a
            // nested menu may have "Voor" under both Lunch and Diner)
            const origIdx = r.categories.findIndex(c => c.name === cat.name && JSON.stringify(c.path || null) === JSON.stringify(cat.path || null))
            return (
              <div key={i} className="cat-block">
              <MenuGroupHeadings categories={filteredCategories} index={i} />
              <MenuSection
                id={`cat-${origIdx}`}
                sectionRef={el => sectionRefs.current[origIdx] = el}
                name={cat.name}
                count={isFiltering ? cat.items.length : undefined}
              >
                  {cat.items.map((item, j) => {
                    // BE-12 — identity check against the resolved target's
                    // actual item object, not index matching: robust
                    // regardless of whatever the current filter happens to
                    // be showing (filteredCategories never clones items).
                    const isResolvedTarget = item === resolvedTargetItem
                    // BE-29 — het anker van het gerecht is exact hetzelfde id
                    // als de dish-deeplink gebruikt (`<menukey>-<cat>-<item>`),
                    // zodat de home direct op dit gerecht kan landen. De
                    // originele index wordt uit de ongefilterde categorie
                    // gehaald; een actief filter verandert die niet.
                    const originalItemIndex = r.categories[origIdx] ? r.categories[origIdx].items.indexOf(item) : -1
                    const domId = originalItemIndex >= 0 ? `gerecht-${id}-${origIdx}-${originalItemIndex}` : undefined
                    // BE-44 (#105, criterium 1) — de deellink van dit gerecht is
                    // dezelfde BE-12-deeplink (`buildDishDeepLink`), zonder
                    // `fromQuery`: een ontvanger hoeft geen zoekopdracht van
                    // iemand anders te erven. De knop maakt hem bij de klik
                    // absoluut en zet de stand van dit moment erbij.
                    const shareHref = originalItemIndex >= 0 && origIdx >= 0
                      ? buildDishDeepLink({
                        menuLink: `/menu/${id}`,
                        dishId: `${id}-${origIdx}-${originalItemIndex}`,
                        name: item.name,
                        category: cat.name,
                      })
                      : null
                    // BE-44 (#105, criterium 4) — hetzelfde gerecht kan bewaard
                    // worden. De knop bewaart alleen wat de pagina al toont:
                    // naam, restaurant, prijs en de plek in de kaart.
                    const saveEntry = originalItemIndex >= 0 && origIdx >= 0
                      ? buildEntry({
                        menuId: id,
                        catIdx: origIdx,
                        itemIdx: originalItemIndex,
                        item,
                        category: cat.name,
                        restaurantName: r.name || restaurant.name,
                      })
                      : null
                    return (
                      <MenuItem
                        key={j}
                        item={item}
                        query={query}
                        excludeAllergens={excludeAllergens}
                        isResolvedTarget={isResolvedTarget}
                        showPulse={isResolvedTarget && showPulse}
                        highlightQuery={fromQueryParam}
                        innerRef={isResolvedTarget ? highlightedItemRef : undefined}
                        domId={domId}
                        category={cat.name}
                        menuTitle={subtitle}
                        sourceDate={r.scraped}
                        shareHref={shareHref}
                        shareTitle={dishShareTitle({ name: item.name, restaurantName: r.name })}
                        shareNote={isResolvedTarget && hasShareTheme(standParam)}
                        saveEntry={saveEntry}
                        dishKey={originalItemIndex >= 0 && origIdx >= 0 ? `${id}-${origIdx}-${originalItemIndex}` : null}
                      />
                    )
                  })}
              </MenuSection>
              </div>
            )
          })
        )}

        {/* NVWA link */}
        <div className="nvwa-teaser">
          <div>
            <div className="nvwa-teaser-title"><Emoji glyph="🛡" /> Allergeneninformatie (NVWA)</div>
            <div className="nvwa-teaser-sub">Volledige EU-14 allergenenmatrix · EU Verordening 1169/2011</div>
          </div>
          <Link href={`/nvwa/${baseId}`} className="nvwa-teaser-btn">
            Bekijk matrix
          </Link>
        </div>
      </main>

      {/* BE-44 (issue 105, criterium 4) — "<n> bewaard · Bekijken →" zodra er
          iets bewaard is; de balk staat boven de telefoonmenubalk. */}
      <SavedListBar />
      <PublicFooter />
      <MobileTabBar />
    </>
  )
}
