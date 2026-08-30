'use client'
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import ThemeToggle from '@/src/components/ThemeToggle'
import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ['ma','di','wo','do','vr','za','zo']
const DAY_LABELS = { ma:'Ma', di:'Di', wo:'Wo', do:'Do', vr:'Vr', za:'Za', zo:'Zo' }
const DAY_FULL_NL = { ma:'Maandag', di:'Dinsdag', wo:'Woensdag', do:'Donderdag', vr:'Vrijdag', za:'Zaterdag', zo:'Zondag' }

const BUURTEN = ['Binnenstad','Princenhage','Haagse Beemden','Mastbos','Blauwe Kei','Brabantpark','Heusdenhout','Station','Valkenberg','Wolfslaar']

const KEUKENS = ['Amerikaans','Chinees','Frans','Fusion','Grill & Steak','Indiaas','Indonesisch','Italiaans','Mediterraan','Midden-Oosten','Modern Europees','Nederlands']

const CUISINE_KEYWORDS = {
  'Amerikaans':    ['american','burger','bbq'],
  'Chinees':       ['chinese','chinees'],
  'Frans':         ['french','frans'],
  'Fusion':        ['fusion'],
  'Grill & Steak': ['grill','steak'],
  'Indiaas':       ['indian','indiaas'],
  'Indonesisch':   ['indonesian','indonesisch'],
  'Italiaans':     ['italian','pizza','pasta'],
  'Mediterraan':   ['mediterranean','mediterraan','spanish','greek'],
  'Midden-Oosten': ['midden-oosten','middle-eastern','arabic','turkish'],
  'Modern Europees':['european','scandinavian','modern'],
  'Nederlands':    ['dutch','grand-cafe','allday','nl'],
}

const SORT_OPTIONS = ['best','az','za']

// ─── EU-14 Allergenen ─────────────────────────────────────────────────────────

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


// ─── i18n ─────────────────────────────────────────────────────────────────────

const T = {
  nl: {
    headline: 'De slimste manier om uit eten te gaan',
    sub: 'Zie de menukaart vóór je reserveert',
    step1: 'Kies dag & maaltijdtype',
    step2: 'Blader door menukaarten',
    step3: 'Beslis & reserveer',
    dayHint: 'Kies een dag om te beginnen',
    mealHint: 'Kies nu een maaltijdtype',
    showMenus: 'Toon Menukaarten',
    showMenusLunch: 'Toon Lunchkaarten voor',
    showMenusDiner: 'Toon Dinerkaarten voor',
    showMenusBorrel: 'Toon Borrelkaarten voor',
    ingredientSearch: 'Zoek op ingrediënt of gerecht...',
    nameSearch: 'Zoek restaurant of adres...',
    allPrices: 'Alle prijzen',
    under25: 'Tot €25',
    mid: '€25 – €40',
    above40: 'Meer dan €40',
    allBuurten: 'Alle buurten',
    allKeukens: 'Alle keukens',
    bestRated: 'Best beoordeeld',
    az: 'Naam A–Z',
    za: 'Naam Z–A',
    sort: 'Sorteren',
    modeRestaurants: 'Restaurants',
    modeMenus: 'Menukaarten',
    reset: 'Reset filters',
    foundIn: 'Gevonden in',
    foundInCard: 'gevonden in',
    noResults: 'Geen restaurants gevonden met deze filters.',
    viewMenu: 'Bekijk menu',
    reserve: 'Reserveer',
    restaurants: 'restaurants',
    bestRatedToggle: 'Best beoordeeld',
    openToday: 'Open',
    closedToday: 'Gesloten',
    menuOverviewTitle: 'Menukaarten',
    scrapedOn: 'Bijgewerkt',
    lunchCard: 'Lunchkaart',
    dinerCard: 'Dinerkaart',
    borrelCard: 'Borrelkaart',
  },
  en: {
    headline: 'The smartest way to dine out',
    sub: 'See the menu before you book',
    step1: 'Choose day & meal type',
    step2: 'Browse menus',
    step3: 'Decide & reserve',
    dayHint: 'Choose a day to start',
    mealHint: 'Now choose a meal type',
    showMenus: 'Show Menus',
    showMenusLunch: 'Show Lunch menus for',
    showMenusDiner: 'Show Dinner menus for',
    showMenusBorrel: 'Show Drinks menus for',
    ingredientSearch: 'Search ingredient or dish...',
    nameSearch: 'Search restaurant or address...',
    allPrices: 'All prices',
    under25: 'Under €25',
    mid: '€25 – €40',
    above40: 'Over €40',
    allBuurten: 'All neighbourhoods',
    allKeukens: 'All cuisines',
    bestRated: 'Best rated',
    az: 'Name A–Z',
    za: 'Name Z–A',
    sort: 'Sort',
    modeRestaurants: 'Restaurants',
    modeMenus: 'Menus',
    reset: 'Reset filters',
    foundIn: 'Found in',
    foundInCard: 'found in',
    noResults: 'No restaurants found with these filters.',
    viewMenu: 'View menu',
    reserve: 'Reserve',
    restaurants: 'restaurants',
    bestRatedToggle: 'Best rated',
    openToday: 'Open',
    closedToday: 'Closed',
    menuOverviewTitle: 'Menus',
    scrapedOn: 'Updated',
    lunchCard: 'Lunch menu',
    dinerCard: 'Dinner menu',
    borrelCard: 'Drinks menu',
  },
}

// ─── Ingredient search index ───────────────────────────────────────────────────

function buildIngredientIndex() {
  const index = {} // restaurantId → [{name, mealType}]
  for (const [key, menu] of Object.entries(menusData)) {
    const parts = key.split('-')
    const restaurantId = parts[0]
    const mealType = parts.slice(1).join('-')
    if (!index[restaurantId]) index[restaurantId] = []
    for (const cat of (menu.categories || [])) {
      for (const item of (cat.items || [])) {
        index[restaurantId].push({
          name: item.name || '',
          desc: item.desc || '',
          sup: item.sup || '',
          wine: item.wine || '',
          allergens: item.allergens || [],
          mealType,
        })
      }
    }
  }
  return index
}

const INGREDIENT_INDEX = buildIngredientIndex()

function searchIngredients(query, excludeAllergens = [], mealType = '') {
  const hasQuery = query && query.length >= 2
  const hasAllergenFilter = excludeAllergens.length > 0
  if (!hasQuery && !hasAllergenFilter) return {}
  const q = hasQuery ? query.toLowerCase() : null
  const results = {}
  for (const [restaurantId, items] of Object.entries(INGREDIENT_INDEX)) {
    const matches = items.filter(item => {
      // Als maaltijdfilter actief: zoek alleen in die kaart
      if (mealType && item.mealType !== mealType) return false
      // Text match
      const textMatch = !q || (
        item.name.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.sup.toLowerCase().includes(q) ||
        item.wine.toLowerCase().includes(q)
      )
      // Allergen exclusion
      const allergenSafe = excludeAllergens.length === 0 ||
        !Array.isArray(item.allergens) ||
        !excludeAllergens.some(id => item.allergens.includes(id))
      return textMatch && allergenSafe
    })
    if (matches.length > 0) results[restaurantId] = matches
  }
  return results
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchesCuisine(restaurant, selectedCuisines) {
  if (selectedCuisines.length === 0) return true
  const keywords = (restaurant.cuisineKeywords || '').toLowerCase()
  const cuisine = (restaurant.cuisine || '').toLowerCase()
  return selectedCuisines.some(c => {
    const kws = CUISINE_KEYWORDS[c] || []
    return kws.some(kw => keywords.includes(kw) || cuisine.includes(kw))
  })
}

function getPriceLevel(restaurant) {
  return restaurant.priceLevel || 2
}

function matchesPrice(restaurant, priceFilter) {
  if (!priceFilter) return true
  const lvl = getPriceLevel(restaurant)
  if (priceFilter === 'under25') return lvl === 1
  if (priceFilter === 'mid') return lvl === 2
  if (priceFilter === 'above40') return lvl === 3
  return true
}

function isOpenOnDay(restaurant, day) {
  if (!day) return true
  return !!(restaurant.openingHours && restaurant.openingHours[day])
}

function hasMealType(restaurant, mealType) {
  if (!mealType) return true
  return (restaurant.menuLinks || []).some(l => l.id.endsWith(`-${mealType}`))
}

function getMenuLinksForMeal(restaurant, mealType) {
  if (!mealType) return restaurant.menuLinks || []
  return (restaurant.menuLinks || []).filter(l => l.id.endsWith(`-${mealType}`))
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY  = 'bredaeats_filters_v3'
const SCROLL_KEY   = 'bredaeats_scroll_v1'

function saveFilters(filters) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)) } catch {}
}

function loadFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}


// ─── Open/closed helpers ──────────────────────────────────────────────────────

function getTodayKey() {
  const map = ['zo','ma','di','wo','do','vr','za']
  return map[new Date().getDay()]
}

function getOpenStatus(restaurant, selectedDay) {
  const day = selectedDay || getTodayKey()
  const hours = restaurant.openingHours?.[day]
  if (!hours) return { open: false, label: 'Gesloten', closes: null }
  const closes = hours.split('-')[1] || null
  return { open: true, label: `Open`, closes }
}

function getCurrentTimeMinutes() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function isCurrentlyOpen(restaurant) {
  const todayKey = getTodayKey()
  const hours = restaurant.openingHours?.[todayKey]
  if (!hours) return false
  const [openStr, closeStr] = hours.split('-')
  if (!openStr || !closeStr) return false
  const toMin = str => {
    const [h, m] = str.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const now = getCurrentTimeMinutes()
  return now >= toMin(openStr) && now < toMin(closeStr)
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address + ', Breda')}`
}

function saveScrollNow() {
  try { sessionStorage.setItem('bredaeats_scroll_v1', String(window.scrollY)) } catch {}
}

function trackLead(restaurantId, restaurantName, type) {
  try {
    const key = 'bredaeats_leads'
    const existing = JSON.parse(localStorage.getItem(key) || '[]')
    existing.push({
      restaurantId,
      restaurantName,
      type, // 'whatsapp' | 'website' | 'menu'
      timestamp: new Date().toISOString(),
    })
    localStorage.setItem(key, JSON.stringify(existing.slice(-500)))
  } catch {}
}

function whatsappUrl(phone, restaurantName) {
  const clean = (phone || '').replace(/[^0-9+]/g, '')
  const nl = clean.startsWith('0') ? '+31' + clean.slice(1) : clean
  const msg = encodeURIComponent(
    `Hoi ${restaurantName}, ik zag jullie via BredaEats en wil graag een tafel reserveren. Kunnen jullie mij terugbellen of reageren?`
  )
  return `https://wa.me/${nl.replace('+','')}?text=${msg}`
}

const MEAL_LABEL = { lunch: 'Lunchkaart', diner: 'Dinerkaart', borrel: 'Borrelkaart', specialiteiten: 'Specialiteiten' }

// ─── Restaurant Card ──────────────────────────────────────────────────────────

function RestaurantCard({ restaurant, id, lang, selectedMeal, selectedDay, ingredientMatches, ingredientQuery, excludeAllergens }) {
  const t = T[lang]
  const openStatus = getOpenStatus(restaurant, selectedDay)
  const allLinks = restaurant.menuLinks || []
  const matchedItems = ingredientMatches[id] || []
  const matchCount = matchedItems.length

  // Bepaal de kaart waar de match in zit (voor dropdown + label)
  const matchMealType = matchedItems.length > 0 ? matchedItems[0].mealType : null
  const matchLink = matchMealType
    ? allLinks.find(l => l.id.endsWith(`-${matchMealType}`))
    : null

  // Dropdown: bij actief maaltijdfilter → die kaart, anders → kaart met match, anders → eerste
  const getDefaultLink = () => {
    if (selectedMeal) return allLinks.find(l => l.id.endsWith(`-${selectedMeal}`)) || allLinks[0]
    if (matchLink) return matchLink
    return allLinks[0]
  }
  const [selectedLink, setSelectedLink] = React.useState(getDefaultLink()?.id || '')

  // Als filter of match wijzigt, update dropdown mee
  React.useEffect(() => {
    setSelectedLink(getDefaultLink()?.id || '')
  }, [selectedMeal, matchMealType])

  const qs = (() => {
    const p = new URLSearchParams()
    if (ingredientMatches[id]?.length && ingredientQuery) p.set('q', ingredientQuery)
    if (excludeAllergens.length) p.set('excl', excludeAllergens.join(','))
    return p.toString()
  })()

  return (
    <div className="restaurant-card" style={{ '--card-accent': restaurant.color || 'var(--green)' }}>

      {/* Header */}
      <div className="rc-header">
        <div className="rc-header-top">
          {restaurant.badge && <span className="rc-badge">{restaurant.badge}</span>}
          <div className="rc-open-pill">
            <span className={`rc-open-dot ${openStatus.open ? 'open' : 'closed'}`} />
            <span className={`rc-open-label ${openStatus.open ? 'open' : 'closed'}`} style={{ fontSize: 11 }}>
              {openStatus.open ? `Open · ${openStatus.closes}` : 'Gesloten'}
            </span>
          </div>
        </div>
        <div className="rc-name">{restaurant.name}</div>
        <div className="rc-cuisine">{restaurant.cuisineLabel || restaurant.cuisine}</div>
      </div>

      {/* Body */}
      <div className="rc-body">
        <p className="rc-desc">{restaurant.cardDescription || restaurant.description}</p>

        {matchCount > 0 && (
          <div className="rc-matches">
            {matchMealType && !selectedMeal
              ? `${t.foundIn} ${MEAL_LABEL[matchMealType] || matchMealType} · ${matchCount} gerecht${matchCount !== 1 ? 'en' : ''}`
              : `${t.foundIn} · ${matchCount} gerecht${matchCount !== 1 ? 'en' : ''}`
            }
          </div>
        )}

        {/* Adres + prijs */}
        <div className="rc-contact">
          <a
            href={mapsUrl(restaurant.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="rc-address rc-address-link"
            title="Open in Google Maps"
          >
            📍 {restaurant.address}
          </a>
          {restaurant.phone && (
            <a
              href={`tel:${restaurant.phone}`}
              className="rc-phone"
            >
              📞 {restaurant.phoneDisplay || restaurant.phone}
            </a>
          )}
        </div>

        {/* Open status + tags */}
        {restaurant.tags?.length > 0 && (
          <div className="rc-tags">
            {restaurant.tags.slice(0, 2).map(tag => (
              <span key={tag} className="rc-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Footer: variant A — dropdown bovenste rij, WhatsApp + website onderste rij */}
      <div className="rc-footer rc-footer-a">

        {/* Rij 1: menu dropdown */}
        <div className="rc-footer-row1">
          {allLinks.length > 1 ? (
            <div className="rc-dropdown-wrap">
              <select
                className="rc-menu-select"
                value={selectedLink}
                onChange={e => setSelectedLink(e.target.value)}
              >
                {allLinks.map(link => (
                  <option key={link.id} value={link.id}>{link.label}</option>
                ))}
              </select>
              <span className="rc-select-chevron">▾</span>
              <Link
                href={`/menu/${selectedLink}${qs ? '?' + qs : ''}`}
                className="rc-menu-go-btn"
                onClick={() => { saveScrollNow(); trackLead(id, restaurant.name, 'menu') }}
              >
                Bekijk →
              </Link>
            </div>
          ) : allLinks.length === 1 ? (
            <Link
              href={`/menu/${allLinks[0].id}${qs ? '?' + qs : ''}`}
              className="rc-menu-btn"
              onClick={() => { saveScrollNow(); trackLead(id, restaurant.name, 'menu') }}
            >
              {allLinks[0].label}
            </Link>
          ) : (
            <Link href={`/restaurant/${id}`} className="rc-menu-btn rc-menu-btn--outline"
              onClick={() => { saveScrollNow(); trackLead(id, restaurant.name, 'menu') }}>
              {t.viewMenu}
            </Link>
          )}
        </div>

        {/* Rij 2: WhatsApp reserveer + website */}
        <div className="rc-footer-row2">
          {restaurant.phone && (
            <a
              href={whatsappUrl(restaurant.phone, restaurant.name)}
              target="_blank"
              rel="noopener noreferrer"
              className="rc-whatsapp-btn"
              onClick={() => trackLead(id, restaurant.name, 'whatsapp')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
              </svg>
              Reserveer via WhatsApp
            </a>
          )}
          {restaurant.website && (
            <a
              href={restaurant.website}
              target="_blank"
              rel="noopener noreferrer"
              className="rc-website-btn"
              title="Bezoek website"
              onClick={() => trackLead(id, restaurant.name, 'website')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Menu Overview Card ────────────────────────────────────────────────────────

function MenuCard({ menuKey, menu, restaurantId, restaurant }) {
  const mealType = menuKey.replace(`${restaurantId}-`, '')
  const icons = { lunch: '🥗', diner: '🍽', borrel: '🍸', specialiteiten: '⭐' }
  return (
    <Link href={`/menu/${menuKey}`} className="menu-overview-card">
      <div className="moc-icon">{icons[mealType] || '📋'}</div>
      <div className="moc-body">
        <div className="moc-name">{restaurant?.name}</div>
        <div className="moc-subtitle">{menu.subtitle}</div>
        <div className="moc-address">📍 {restaurant?.address}</div>
        {menu.scraped && <div className="moc-scraped">Bijgewerkt {menu.scraped}</div>}
      </div>
    </Link>
  )
}

// ─── Active Filter Tag ────────────────────────────────────────────────────────

function FilterTag({ label, onRemove }) {
  return (
    <span className="filter-tag">
      {label}
      <button onClick={onRemove} className="filter-tag-remove" aria-label="Verwijder filter">×</button>
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const resultsRef = useRef(null)
  const [lang, setLang] = useState('nl')
  const [mode, setMode] = useState('restaurants') // 'restaurants' | 'menus'

  // Guided flow
  const [selectedDay, setSelectedDay] = useState('')
  const [nowOpen, setNowOpen] = useState(false)
  const [selectedMeal, setSelectedMeal] = useState('')
  const [showMenusClicked, setShowMenusClicked] = useState(false)

  // Search
  const [ingredientQuery, setIngredientQuery] = useState('')
  const [excludeAllergens, setExcludeAllergens] = useState([])
  const [allergenModeOpen, setAllergenModeOpen] = useState(false)
  const [nameQuery, setNameQuery] = useState('')

  // Dropdowns
  const [priceFilter, setPriceFilter] = useState('')
  const [buurtFilter, setBuurtFilter] = useState('')
  const [selectedCuisines, setSelectedCuisines] = useState([])
  const [sortBy, setSortBy] = useState('best')
  const [bestRatedOnly, setBestRatedOnly] = useState(false)

  const t = T[lang]

  // Load persisted filters on mount + restore scroll position
  useEffect(() => {
    const saved = loadFilters()
    if (saved) {
      if (saved.lang)             setLang(saved.lang)
      if (saved.selectedDay)      setSelectedDay(saved.selectedDay)
      if (saved.selectedMeal)     setSelectedMeal(saved.selectedMeal)
      if (saved.priceFilter)      setPriceFilter(saved.priceFilter)
      if (saved.buurtFilter)      setBuurtFilter(saved.buurtFilter)
      if (saved.selectedCuisines) setSelectedCuisines(saved.selectedCuisines)
      if (saved.sortBy)           setSortBy(saved.sortBy)
      if (saved.bestRatedOnly)    setBestRatedOnly(saved.bestRatedOnly)
      if (saved.ingredientQuery)  setIngredientQuery(saved.ingredientQuery)
      if (saved.excludeAllergens) setExcludeAllergens(saved.excludeAllergens)
      if (saved.mode)             setMode(saved.mode)
      if (saved.nowOpen)           setNowOpen(saved.nowOpen)
    }
    // Restore scroll position after filters are applied
    try {
      const savedScroll = sessionStorage.getItem(SCROLL_KEY)
      if (savedScroll) {
        const y = parseInt(savedScroll, 10)
        // Small delay to let the DOM render with restored filters first
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo({ top: y, behavior: 'instant' })
            sessionStorage.removeItem(SCROLL_KEY)
          })
        })
      }
    } catch {}
  }, [])

  // Persist ALL filters on change (incl. ingredient search + allergens + mode)
  useEffect(() => {
    saveFilters({ lang, selectedDay, selectedMeal, priceFilter, buurtFilter, selectedCuisines, sortBy, bestRatedOnly, ingredientQuery, excludeAllergens, mode, nowOpen })
  }, [lang, selectedDay, selectedMeal, priceFilter, buurtFilter, selectedCuisines, sortBy, bestRatedOnly, ingredientQuery, excludeAllergens, mode])

  // Save scroll position when leaving page
  useEffect(() => {
    const saveScroll = () => {
      try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)) } catch {}
    }
    // Save on any navigation (Next.js router fires popstate/beforeunload)
    window.addEventListener('beforeunload', saveScroll)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveScroll()
    })
    return () => {
      window.removeEventListener('beforeunload', saveScroll)
    }
  }, [])

  // Ingredient search results
  const ingredientMatches = useMemo(() => searchIngredients(ingredientQuery, excludeAllergens, selectedMeal), [ingredientQuery, excludeAllergens, selectedMeal])

  // All restaurants as array
  const allRestaurants = useMemo(() =>
    Object.entries(restaurantsData).map(([id, r]) => ({ id, ...r })),
    []
  )

  // Filtering
  const filteredRestaurants = useMemo(() => {
    let list = allRestaurants

    // Nu open filter (dag + tijdstip)
    if (nowOpen) list = list.filter(r => isCurrentlyOpen(r))

    // Day filter (disabled als nowOpen actief is)
    if (selectedDay && !nowOpen) list = list.filter(r => isOpenOnDay(r, selectedDay))

    // Meal filter
    if (selectedMeal) list = list.filter(r => hasMealType(r, selectedMeal))

    // Ingredient search
    if (ingredientQuery.length >= 2) {
      list = list.filter(r => ingredientMatches[r.id])
    }

    // Name/address search
    if (nameQuery.length >= 1) {
      const q = nameQuery.toLowerCase()
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        (r.address || '').toLowerCase().includes(q)
      )
    }

    // Price filter
    list = list.filter(r => matchesPrice(r, priceFilter))

    // Buurt filter
    if (buurtFilter) list = list.filter(r => r.buurt === buurtFilter)

    // Cuisine filter (multi-select)
    list = list.filter(r => matchesCuisine(r, selectedCuisines))

    // Sort
    if (sortBy === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'za') list = [...list].sort((a, b) => b.name.localeCompare(a.name))
    else list = [...list].sort((a, b) => Number(a.id) - Number(b.id))

    return list
  }, [allRestaurants, selectedDay, selectedMeal, nowOpen, ingredientQuery, ingredientMatches, nameQuery, priceFilter, buurtFilter, selectedCuisines, sortBy])

  // Menu overview list (for "Menukaarten" mode)
  const filteredMenus = useMemo(() => {
    const restaurantIds = new Set(filteredRestaurants.map(r => r.id))
    return Object.entries(menusData)
      .filter(([key]) => {
        const restaurantId = key.split('-')[0]
        if (!restaurantIds.has(restaurantId)) return false
        if (selectedMeal) return key.endsWith(`-${selectedMeal}`)
        return true
      })
      .map(([key, menu]) => {
        const restaurantId = key.split('-')[0]
        return { key, menu, restaurantId, restaurant: restaurantsData[restaurantId] }
      })
  }, [filteredRestaurants, selectedMeal])

  // Active filters for display
  const activeFilters = useMemo(() => {
    const tags = []
    if (nowOpen) tags.push({ key: 'nowopen', label: '🟢 Nu open', onRemove: () => setNowOpen(false) })
    if (selectedDay && !nowOpen) tags.push({ key: 'day', label: DAY_FULL_NL[selectedDay] || selectedDay, onRemove: () => setSelectedDay('') })
    if (selectedMeal) tags.push({ key: 'meal', label: selectedMeal.charAt(0).toUpperCase() + selectedMeal.slice(1), onRemove: () => setSelectedMeal('') })
    if (ingredientQuery) tags.push({ key: 'ing', label: `"${ingredientQuery}"`, onRemove: () => setIngredientQuery('') })
    excludeAllergens.forEach(id => {
      const a = EU14.find(x => x.id === id)
      if (a) tags.push({ key: `excl-${id}`, label: `Zonder ${a.name}`, onRemove: () => setExcludeAllergens(prev => prev.filter(x => x !== id)) })
    })
    if (nameQuery) tags.push({ key: 'name', label: nameQuery, onRemove: () => setNameQuery('') })
    if (priceFilter) {
      const label = priceFilter === 'under25' ? t.under25 : priceFilter === 'mid' ? t.mid : t.above40
      tags.push({ key: 'price', label, onRemove: () => setPriceFilter('') })
    }
    if (buurtFilter) tags.push({ key: 'buurt', label: buurtFilter, onRemove: () => setBuurtFilter('') })
    selectedCuisines.forEach(c => tags.push({ key: `cuisine-${c}`, label: c, onRemove: () => setSelectedCuisines(prev => prev.filter(x => x !== c)) }))
    if (sortBy !== 'best') tags.push({ key: 'sort', label: sortBy === 'az' ? t.az : t.za, onRemove: () => setSortBy('best') })
    return tags
  }, [selectedDay, selectedMeal, nowOpen, ingredientQuery, excludeAllergens, nameQuery, priceFilter, buurtFilter, selectedCuisines, sortBy, t])

  const hasFilters = activeFilters.length > 0

  const resetAll = useCallback(() => {
    setSelectedDay('')
    setSelectedMeal('')
    setShowMenusClicked(false)
    setNowOpen(false)
    setIngredientQuery('')
    setExcludeAllergens([])
    setAllergenModeOpen(false)
    setNameQuery('')
    setPriceFilter('')
    setBuurtFilter('')
    setSelectedCuisines([])
    setSortBy('best')
    setBestRatedOnly(false)
  }, [])

  const toggleCuisine = useCallback((c) => {
    setSelectedCuisines(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }, [])

  const guidedReady = !!selectedMeal

  return (
    <>
      {/* ── Header ── */}
      <header className="site-header">
        <div className="header-inner">
          <div className="logo">Breda<span>Eats</span></div>
          <div className="header-right">
            <ThemeToggle />
            {/* Language switch */}
            <div className="lang-switch">
              <button className={`lang-btn ${lang === 'nl' ? 'active' : ''}`} onClick={() => setLang('nl')}>NL</button>
              <button className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>EN</button>
            </div>
            {/* Mode switch */}
            <div className="mode-switch">
              <button className={`mode-btn ${mode === 'restaurants' ? 'active' : ''}`} onClick={() => setMode('restaurants')}>
                🏠 {t.modeRestaurants}
              </button>
              <button className={`mode-btn ${mode === 'menus' ? 'active' : ''}`} onClick={() => setMode('menus')}>
                📋 {t.modeMenus}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero / Value prop ── */}
      <section className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">{t.headline}</h1>
          <p className="hero-sub">{t.sub}</p>
          <div className="hero-steps">
            <div className="hero-step"><span className="step-num">1</span>{t.step1}</div>
            <div className="hero-step-arrow">→</div>
            <div className="hero-step"><span className="step-num">2</span>{t.step2}</div>
            <div className="hero-step-arrow">→</div>
            <div className="hero-step"><span className="step-num">3</span>{t.step3}</div>
          </div>
        </div>
      </section>

      {/* ── Filter section ── */}
      <section className="filter-section">

        {/* 1. Day selector + Nu open */}
        <div className="filter-block">
          <div className="day-selector">
            {DAYS.map(day => (
              <button
                key={day}
                className={`day-btn ${selectedDay === day && !nowOpen ? 'active' : ''} ${nowOpen ? 'disabled' : ''}`}
                onClick={() => {
                  if (nowOpen) return
                  setSelectedDay(selectedDay === day ? '' : day)
                }}
                disabled={nowOpen}
              >
                {DAY_LABELS[day]}
              </button>
            ))}
            <div className="day-divider" />
            <button
              className={`now-open-btn ${nowOpen ? 'active' : ''}`}
              onClick={() => {
                setNowOpen(!nowOpen)
                if (!nowOpen) setSelectedDay('')
              }}
            >
              <span className={`rc-open-dot ${nowOpen ? 'open' : ''}`} style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: nowOpen ? 'var(--green)' : 'var(--text-faint)', marginRight: 5 }} />
              Nu open
            </button>
          </div>
          {!selectedDay && !nowOpen && (
            <div className="filter-hint">
              <span className="hint-arrow">↑</span> {t.dayHint}
            </div>
          )}
        </div>

        {/* 2. Meal type — altijd zichtbaar */}
        <div className="filter-block">
          <div className="meal-selector">
            {['lunch','diner','borrel'].map(meal => (
              <button
                key={meal}
                className={`home-meal-btn ${selectedMeal === meal ? 'active' : ''}`}
                onClick={() => setSelectedMeal(selectedMeal === meal ? '' : meal)}
              >
                {meal === 'lunch' ? '🥗' : meal === 'diner' ? '🍽' : '🍸'} {meal.charAt(0).toUpperCase() + meal.slice(1)}
              </button>
            ))}
          </div>
          {selectedDay && !selectedMeal && (
            <div className="filter-hint">
              <span className="hint-arrow">↑</span> {t.mealHint}
            </div>
          )}
        </div>

        {/* 3. Show menus CTA — smart: gefilterd label + scroll naar resultaten */}
        {guidedReady && (() => {
          const mealIcon = selectedMeal === 'lunch' ? '🥗' : selectedMeal === 'diner' ? '🍽' : '🍸'
          const mealName = selectedMeal === 'lunch' ? (lang === 'nl' ? 'Lunch' : 'Lunch')
                         : selectedMeal === 'diner' ? (lang === 'nl' ? 'Diner' : 'Dinner')
                         : (lang === 'nl' ? 'Borrel' : 'Drinks')
          const dayFull = DAY_FULL_NL[selectedDay] || selectedDay
          const btnLabel = lang === 'nl'
            ? `${mealIcon} Toon ${mealName}kaarten voor ${dayFull}`
            : `${mealIcon} Show ${mealName} menus for ${dayFull}`
          return (
            <div className="filter-block cta-block">
              <button
                className={`show-menus-btn ${showMenusClicked ? '' : 'pulse'}`}
                onClick={() => {
                  setShowMenusClicked(true)
                  setMode('restaurants')
                  setTimeout(() => {
                    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }, 50)
                }}
              >
                {btnLabel}
              </button>
            </div>
          )
        })()}

        {/* 4 & 5. Search fields */}
        <div className="filter-block search-row">
          <div className="search-field">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="search-input flagship"
              placeholder={t.ingredientSearch}
              value={ingredientQuery}
              onChange={e => setIngredientQuery(e.target.value)}
            />
            {ingredientQuery && (
              <button className="search-clear" onClick={() => setIngredientQuery('')}>×</button>
            )}
          </div>
          <div className="search-field">
            <span className="search-icon">📍</span>
            <input
              type="text"
              className="search-input"
              placeholder={t.nameSearch}
              value={nameQuery}
              onChange={e => setNameQuery(e.target.value)}
            />
            {nameQuery && (
              <button className="search-clear" onClick={() => setNameQuery('')}>×</button>
            )}
          </div>
        </div>



        {/* Allergen exclusion panel */}
        <div className="allergen-filter-bar">
          <button
            className={`allergen-toggle-btn ${allergenModeOpen ? 'active' : ''}`}
            onClick={() => setAllergenModeOpen(!allergenModeOpen)}
          >
            🛡 Ik heb een allergie {excludeAllergens.length > 0 && `(${excludeAllergens.length})`}
          </button>
          {allergenModeOpen && (
            <div className="allergen-chips">
              {EU14.map(a => (
                <button
                  key={a.id}
                  className={`allergen-chip ${excludeAllergens.includes(a.id) ? 'active' : ''}`}
                  onClick={() => setExcludeAllergens(prev =>
                    prev.includes(a.id) ? prev.filter(x => x !== a.id) : [...prev, a.id]
                  )}
                  title={`Sluit ${a.name} uit`}
                >
                  {a.icon} {a.name}
                  {excludeAllergens.includes(a.id) && <span className="chip-x"> ×</span>}
                </button>
              ))}
              {excludeAllergens.length > 0 && (
                <button className="allergen-chip-clear" onClick={() => setExcludeAllergens([])}>
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
        {/* 6–10. Sort bar (dropdowns + toggles) */}
        <div className="sort-bar">
          {/* 6. Best rated toggle */}
          <button
            className={`sort-toggle ${bestRatedOnly ? 'active' : ''}`}
            onClick={() => { setBestRatedOnly(!bestRatedOnly); if (!bestRatedOnly) setSortBy('best') }}
          >
            ⭐ {t.bestRatedToggle}
          </button>

          {/* 7. Price dropdown */}
          <select className="sort-select" value={priceFilter} onChange={e => setPriceFilter(e.target.value)}>
            <option value="">{t.allPrices}</option>
            <option value="under25">{t.under25}</option>
            <option value="mid">{t.mid}</option>
            <option value="above40">{t.above40}</option>
          </select>

          {/* 8. Buurt dropdown */}
          <select className="sort-select" value={buurtFilter} onChange={e => setBuurtFilter(e.target.value)}>
            <option value="">{t.allBuurten}</option>
            {BUURTEN.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          {/* 9. Cuisine multi-select */}
          <div className="cuisine-dropdown">
            <button className={`sort-select cuisine-trigger ${selectedCuisines.length > 0 ? 'has-value' : ''}`}>
              {selectedCuisines.length > 0 ? `${selectedCuisines.length} keukens` : t.allKeukens} ▾
            </button>
            <div className="cuisine-panel">
              {KEUKENS.map(k => (
                <label key={k} className="cuisine-option">
                  <input
                    type="checkbox"
                    checked={selectedCuisines.includes(k)}
                    onChange={() => toggleCuisine(k)}
                  />
                  {k}
                </label>
              ))}
            </div>
          </div>

          {/* 10. Sort dropdown */}
          <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="best">{t.bestRated}</option>
            <option value="az">{t.az}</option>
            <option value="za">{t.za}</option>
          </select>

          {/* Reset */}
          {hasFilters && (
            <button className="reset-btn" onClick={resetAll}>{t.reset} ×</button>
          )}
        </div>

        {/* 12. Active filters bar */}
        {activeFilters.length > 0 && (
          <div className="active-filters-bar">
            {activeFilters.map(f => (
              <FilterTag key={f.key} label={f.label} onRemove={f.onRemove} />
            ))}
          </div>
        )}
      </section>

      {/* ── Results ── */}
      <main className="results-section" ref={resultsRef}>
        <div className="results-header">
          <span className="results-count">
            {mode === 'restaurants'
              ? `${filteredRestaurants.length} ${t.restaurants}`
              : `${filteredMenus.length} ${t.modeMenus.toLowerCase()}`}
          </span>
        </div>

        {/* 11. Mode: Restaurants */}
        {mode === 'restaurants' && (
          <>
            {filteredRestaurants.length === 0 ? (
              <div className="no-results">{t.noResults}</div>
            ) : (
              <div className="restaurant-grid">
                {filteredRestaurants.map(r => (
                  <RestaurantCard
                    key={r.id}
                    id={r.id}
                    restaurant={r}
                    lang={lang}
                    selectedMeal={selectedMeal}
                    selectedDay={selectedDay}
                    ingredientMatches={ingredientMatches}
                    ingredientQuery={ingredientQuery}
                    excludeAllergens={excludeAllergens}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* 11. Mode: Menukaarten */}
        {mode === 'menus' && (
          <>
            {filteredMenus.length === 0 ? (
              <div className="no-results">{t.noResults}</div>
            ) : (
              <div className="menu-overview-grid">
                {filteredMenus.map(({ key, menu, restaurantId, restaurant }) => (
                  <MenuCard
                    key={key}
                    menuKey={key}
                    menu={menu}
                    restaurantId={restaurantId}
                    restaurant={restaurant}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

    </>
  )
}
