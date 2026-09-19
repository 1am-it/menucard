'use client'
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'
import PrimaryNav from '@/src/components/PrimaryNav'
import RestaurantBrowseCard from '@/src/components/RestaurantBrowseCard'

// BE-03 — dish-first search results.
// BE-06 — filters + URL state added on top, see below.
//
// This is a standalone route, not wired into the homepage yet (that's
// BE-04). It consumes the existing, unchanged /api/search endpoint
// (BE-02b/BE-02c) and does not modify any existing page.
//
// BE-11 Fase 2 — this page also, in parallel, and only for a meaningful
// free-text query (2+ trimmed characters — see MEANINGFUL_QUERY_MIN_LENGTH
// below), queries GET /api/restaurants (src/services/restaurantIndex.js,
// same endpoint /alle-restaurants already uses) and renders its results as
// a second, separately-headed "Restaurants gevonden" group alongside the
// dish-results section (BE-16's "Gerechten gegroepeerd per restaurant" —
// BE-15's own, differently-named "Gerechten gevonden" section is retired,
// see below). dishSearch.js's own ranking is unchanged by this — its
// URL/filter semantics are exactly as BE-02b/BE-02c/BE-06 left them. See
// docs/api/restaurant-summary-shape.md "Name-token match for group
// ordering" for the rule that decides which group is shown first.
//
// BE-16 — every restaurant with at least one matching dish is always one
// restaurant group; there is no longer a separate section of flat,
// individual dish cards for restaurants with few matches. See
// planning/specs/tickets/be-16-uniform-restaurant-grouped-dish-search-results.md.

// BE-16 — the menu-*card* title form (matching `app/menu/[id]/MenuView.js`'s
// own MEAL_CONFIG.title strings already shown on `/menu/[id]` itself), used
// for the grouped section's menu-subgroup headings below. Duplicated rather
// than imported, same reasoning as elsewhere in this file (MenuView.js is a
// separate 'use client' module).
const MENU_TITLE_LABELS = {
  lunch:          'Lunchkaart',
  diner:          'Dinerkaart',
  borrel:         'Borrelkaart',
  specialiteiten: 'Specialiteiten',
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

// Same minimum-length convention dishSearch.js and restaurantIndex.js both
// already use for their own `q` handling. Below this, GET /api/restaurants
// is not queried at all — per BE-11 Fase 2 §3, a bare or near-empty query
// (or a page with only existing dish filters active) must never trigger a
// restaurant fetch, let alone show a restaurant group.
const MEANINGFUL_QUERY_MIN_LENGTH = 2
const RESTAURANT_RESULTS_LIMIT = 12

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

// BE-12 — additive-only deep link into a dish's exact position on its
// menu. Built entirely from public dish fields (dishId, name, category —
// see docs/api/dish-result-shape.md) via URLSearchParams, the same
// mechanism buildParams() above already uses — never a hand-built string.
// `fromQuery` is only added when there is a real, current text query.
// This never changes `dish.menuLink` itself or any existing filter/URL
// semantics on /menu/[id] — see MenuView.js's own, entirely separate
// `?q=` handling. BE-16 reuses this exact, unmodified function for a
// group's secondary example-dish links (see `buildExampleDishHref` below)
// — the underlying deep-link mechanism is identical either way.
function buildDishMenuHref(dish, query) {
  const params = new URLSearchParams()
  params.set('dish', dish.dishId)
  params.set('name', dish.name)
  params.set('cat', dish.category)
  if (query) params.set('fromQuery', query)
  return `${dish.menuLink}?${params.toString()}`
}

// BE-15 — a group's primary "view all matches" action: additive combination
// of the two already-existing, already-safe parameters `?q=`/`fromQuery`,
// never a new parameter or mechanism. Deliberately never sets
// `dish`/`name`/`cat`, so `resolveDishTarget()` on `/menu/[id]` always
// returns null for this link — no item is scrolled to, focused, or
// highlighted.
function buildGroupMenuHref(menu, query) {
  const params = new URLSearchParams()
  if (query) {
    params.set('q', query)
    params.set('fromQuery', query)
  }
  const qs = params.toString()
  return qs ? `${menu.menuLink}?${qs}` : menu.menuLink
}

// BE-16 — a menu subgroup's secondary, exact BE-12 link for one specific
// example dish. Reuses `buildDishMenuHref` unmodified, merging in the
// subgroup's own `menuLink` (examples themselves don't carry one, to avoid
// duplicating it per example in the API response).
function buildExampleDishHref(example, menu, query) {
  return buildDishMenuHref({ ...example, menuLink: menu.menuLink }, query)
}

// BE-16 — "two examples within the same visible menu subgroup happen to
// share a name" (e.g. the real q=Höpler fixture: three identically-named
// "Höpler - Seeblick" wines in one Borrelkaart subgroup, distinguished
// only by category). Scoped to the subgroup's own (already capped at 3)
// examples array — not the whole page — since that is the only set a
// visitor ever sees side by side. Mirrors BE-12 §1.1's original
// same-restaurant collision rule, now scoped one level narrower (same
// menu subgroup instead of same restaurant).
function hasExampleNameCollision(example, examples) {
  return examples.some((other) => other !== example && other.name === example.name)
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
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [lowCoverage, setLowCoverage] = useState(null)

  // BE-15 — the additive `group=restaurant` response mode's own state,
  // named distinctly from `restaurantResults`/`restaurantTotal`/etc. below
  // (BE-11 Fase 2's unrelated restaurant *name*/buurt-match group) to avoid
  // any confusion between the two separate "restaurant" concepts on this
  // page. `groupsTotal`/`groupsNextCursor`/`groupsHasMore` paginate
  // restaurant groups, never raw dishes — see dishSearch.js's own
  // "Server-side aggregation" comment.
  const [groups, setGroups] = useState([])
  const [groupsTotal, setGroupsTotal] = useState(0)
  const [groupsNextCursor, setGroupsNextCursor] = useState(null)
  const [groupsHasMore, setGroupsHasMore] = useState(false)

  // BE-11 Fase 2 — the parallel restaurant group. Entirely independent
  // request/loading/error state from the dish search above: the two fetch
  // in parallel and settle independently, so a slow one never blocks the
  // other from rendering.
  const [restaurantResults, setRestaurantResults] = useState([])
  const [restaurantTotal, setRestaurantTotal] = useState(0)
  const [restaurantNextCursor, setRestaurantNextCursor] = useState(null)
  const [restaurantHasMore, setRestaurantHasMore] = useState(false)
  const [restaurantLoading, setRestaurantLoading] = useState(false)
  const [restaurantLoadingMore, setRestaurantLoadingMore] = useState(false)
  const [restaurantError, setRestaurantError] = useState(null)
  const [uniqueNameMatch, setUniqueNameMatch] = useState(false)

  const requestId = useRef(0)
  const restaurantRequestId = useRef(0)

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
    // BE-15 — always request the additive grouped mode; the existing
    // ungrouped shape stays available to any other caller that omits this
    // parameter (see dishSearch.js). `cursor`/`limit` below now paginate
    // restaurant groups, not raw dishes, per the ticket's decided
    // architecture.
    params.set('group', 'restaurant')
    if (cursor) params.set('cursor', String(cursor))

    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/search?${params.toString()}`)
      if (!res.ok) throw new Error(`Search request failed (${res.status})`)
      const data = await res.json()
      if (id !== requestId.current) return // stale response, ignore

      // BE-16 — every restaurant with a match is now its own group, so the
      // server's own `results` field is always `[]` in this mode (kept
      // server-side only for API-response-shape stability — see
      // dishSearch.js). The page never reads it: `groups` is the sole,
      // paginated unit, appended on "load more", exactly like the
      // pre-existing dish-level pagination this replaces.
      setGroups((prev) => (cursor ? [...prev, ...(data.restaurantGroups || [])] : (data.restaurantGroups || [])))
      setGroupsTotal(data.total)
      setGroupsNextCursor(data.nextCursor)
      setGroupsHasMore(data.hasMore)
      if (!cursor) setLowCoverage(data.lowCoverage || null)
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
      setGroups([]); setGroupsTotal(0); setGroupsNextCursor(null); setGroupsHasMore(false); setLowCoverage(null)
      return
    }
    runSearch(filters, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey])

  // BE-11 Fase 2 — separate fetch against GET /api/restaurants, gated only
  // on the free-text query itself (never on the existing dish filters,
  // which this endpoint has no concept of — see docs/api/restaurant-
  // summary-shape.md "Known limitations"). Deliberately keyed on
  // `filters.q` alone, not `filtersKey`: toggling a meal/price/cuisine/day/
  // allergen/"nu open" filter with no text query must never trigger this
  // fetch (BE-11 Fase 2 §3), and must never re-trigger it again once a
  // query is already present, since none of those filters change the
  // restaurant result for the same query text.
  const runRestaurantSearch = useCallback(async (q) => {
    const id = ++restaurantRequestId.current
    const params = new URLSearchParams({ q, limit: String(RESTAURANT_RESULTS_LIMIT) })

    setRestaurantLoading(true)
    setRestaurantError(null)

    try {
      const res = await fetch(`/api/restaurants?${params.toString()}`)
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const data = await res.json()
      if (id !== restaurantRequestId.current) return

      setRestaurantResults(data.results)
      setRestaurantTotal(data.total)
      setRestaurantNextCursor(data.nextCursor)
      setRestaurantHasMore(data.hasMore)
      setUniqueNameMatch(!!data.uniqueNameMatch)
    } catch (e) {
      if (id !== restaurantRequestId.current) return
      setRestaurantError('Restaurants laden is niet gelukt.')
    } finally {
      if (id !== restaurantRequestId.current) return
      setRestaurantLoading(false)
    }
  }, [])

  useEffect(() => {
    const trimmedQ = filters.q.trim()
    if (trimmedQ.length < MEANINGFUL_QUERY_MIN_LENGTH) {
      restaurantRequestId.current++ // invalidate any in-flight request
      setRestaurantResults([]); setRestaurantTotal(0); setRestaurantNextCursor(null)
      setRestaurantHasMore(false); setRestaurantLoading(false); setRestaurantError(null)
      setUniqueNameMatch(false)
      return
    }
    runRestaurantSearch(trimmedQ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q])

  const handleRestaurantLoadMore = () => {
    if (restaurantNextCursor == null) return
    const trimmedQ = filters.q.trim()
    if (trimmedQ.length < MEANINGFUL_QUERY_MIN_LENGTH) return
    const id = restaurantRequestId.current
    const params = new URLSearchParams({ q: trimmedQ, limit: String(RESTAURANT_RESULTS_LIMIT), cursor: String(restaurantNextCursor) })
    setRestaurantLoadingMore(true)
    fetch(`/api/restaurants?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        return res.json()
      })
      .then((data) => {
        if (id !== restaurantRequestId.current) return
        setRestaurantResults((prev) => [...prev, ...data.results])
        setRestaurantNextCursor(data.nextCursor)
        setRestaurantHasMore(data.hasMore)
      })
      .catch(() => {
        if (id !== restaurantRequestId.current) return
        setRestaurantError('Meer restaurants laden is niet gelukt.')
      })
      .finally(() => {
        if (id !== restaurantRequestId.current) return
        setRestaurantLoadingMore(false)
      })
  }

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

  // BE-15 — "Meer resultaten laden" now loads more restaurant groups
  // (never more raw dishes — `results`, the leftover individual dishes, is
  // always already complete), reusing the exact same button/pattern.
  const handleLoadMore = () => {
    if (groupsNextCursor == null) return
    runSearch(filters, groupsNextCursor)
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

  // BE-11 Fase 2 group-ordering + combined-state derivation. See
  // docs/api/restaurant-summary-shape.md "Name-token match for group
  // ordering" for the underlying rule computed server-side in
  // hasUniqueRestaurantNameMatch() — this page only reads the boolean
  // already returned by GET /api/restaurants, never re-derives it from a
  // paginated result list.
  const meaningfulQuery = filters.q.trim().length >= MEANINGFUL_QUERY_MIN_LENGTH
  const restaurantsPending = meaningfulQuery && restaurantLoading
  const restaurantsFirst = meaningfulQuery && uniqueNameMatch && restaurantResults.length > 0

  // BE-16 — this only ever renders the loading spinner or the "nothing
  // found" empty state now: every matching dish lives inside `groupedSection`
  // below, so there is no separate individual-results branch left here.
  const dishesGroup = loading ? (
    <div className="empty-state">
      <p>Zoeken…</p>
    </div>
  ) : groups.length === 0 ? (
    restaurantsPending ? (
      // Dishes are already known to be empty, but the parallel restaurant
      // fetch for this same query hasn't settled yet — wait for it rather
      // than momentarily declaring "Geen gerechten gevonden" only to
      // possibly replace that message a moment later once restaurants
      // arrive (BE-11 Fase 2 §11: honest copy for every combination).
      <div className="empty-state">
        <p>Zoeken…</p>
      </div>
    ) : (
      <div className="empty-state">
        {/* BE-11 Fase 2 — deliberately not a heading (see app/globals.css's
            .empty-state-title comment): this status message can appear
            directly under the "Restaurants gevonden" <h2> and must not
            introduce a stray, out-of-order <h3> alongside the restaurant
            name <h3>s that group already contains. */}
        <p className="empty-state-title">{meaningfulQuery && restaurantResults.length > 0 ? 'Geen gerechten gevonden' : 'Niets gevonden'}</p>
        <p>
          {meaningfulQuery && restaurantResults.length > 0 ? (
            restaurantsFirst ? (
              // The restaurant group already rendered directly above this
              // message (restaurantsFirst) — repeating "wel N restaurant(en)
              // gevonden" here would just restate what's already visible.
              <>Geen gerechten gevonden voor &quot;{filters.q}&quot;.</>
            ) : (
              <>Geen gerechten gevonden voor &quot;{filters.q}&quot; — wel {restaurantTotal} restaurant{restaurantTotal !== 1 ? 's' : ''} gevonden met deze naam of buurt.</>
            )
          ) : (
            <>
              {filters.q
                ? `Niets gevonden voor "${filters.q}"${active ? ' met deze filters' : ''}.`
                : 'Niets gevonden met deze filters.'}
              {' '}Probeer een ander gerecht, restaurant of buurt{active ? ', of pas de filters aan' : ''}.
            </>
          )}
        </p>
        {lowCoverage && (
          <p className="low-coverage-note">
            {filters.cuisines.length === 1
              ? `We hebben momenteel nog geen gedigitaliseerde menukaart voor restaurants in de categorie "${filters.cuisines[0]}": ${lowCoverage.missingMenuDataCount} van de ${lowCoverage.relevantRestaurantCount} restaurants in Breda met deze keuken staat wel geregistreerd, maar heeft nog geen menu in onze data.`
              : `Dit kan ook komen doordat we nog niet van alle Breda-restaurants een menukaart hebben: ${lowCoverage.missingMenuDataCount} van de ${lowCoverage.relevantRestaurantCount} relevante restaurants heeft nog geen gedigitaliseerde menukaart.`}
          </p>
        )}
        {active && (
          <button className="detail-menu-btn-outline" onClick={resetFilters} style={{ marginTop: 12 }}>
            Reset filters
          </button>
        )}
      </div>
    )
  ) : null

  // BE-16 — the grouped section, only ever rendered when it has actual
  // groups, matching the "only when non-empty" rule in the decided heading
  // hierarchy. A restaurant is always one <h3> group; every one of its
  // relevant menus is always the same <h4> subgroup shape, uniform for one,
  // three, or twenty matches — never re-sorted, counts and examples come
  // straight from the server in relevance order. Each shown example is its
  // own real, secondary, exact BE-12 link (see buildExampleDishHref above);
  // `+N meer` is plain, non-interactive text. Exactly one further, primary
  // action per subgroup opens the filtered menu, never highlighting a dish
  // (see buildGroupMenuHref above).
  const groupedSection = groups.length > 0 && (
    <section aria-labelledby="gerechten-gegroepeerd-heading" style={{ marginTop: 24 }}>
      <div className="results-header">
        <h2 className="results-count" id="gerechten-gegroepeerd-heading">
          Gerechten gegroepeerd per restaurant
        </h2>
      </div>

      <div className="dish-group-list">
        {groups.map((group) => (
          <div key={group.restaurantId} className="menu-card dish-group-card">
            <h3 className="dish-group-restaurant-name">{group.restaurantName}</h3>
            {group.menus.map((menu) => {
              const remaining = menu.count - menu.examples.length
              return (
                <div key={menu.mealType} className="dish-group-menu">
                  <h4 className="dish-group-menu-title">
                    {MENU_TITLE_LABELS[menu.mealType] || menu.mealType}
                    {' — '}
                    {menu.count} {menu.count === 1 ? 'gerecht' : 'gerechten'}
                  </h4>
                  {menu.examples.length > 0 && (
                    <p className="dish-group-examples">
                      {menu.examples.map((example, i) => {
                        const collision = hasExampleNameCollision(example, menu.examples)
                        const label = collision ? `${example.name} (${example.category})` : example.name
                        return (
                          <span key={example.dishId}>
                            {i > 0 && ' · '}
                            <Link href={buildExampleDishHref(example, menu, filters.q)} className="dish-group-example-link">
                              {label}
                            </Link>
                            {/* BE-12 §1.2/BE-13, restored for BE-16 — a
                                neutral, honest hint, only for an example
                                that matched purely via an internal,
                                non-public field (never the raw sup/wine
                                text itself — see dishSearch.js's
                                isWeakMatch()). A normal, visibly-matching
                                example gets no hint at all. */}
                            {example.weakMatch && <span className="dish-result-match-hint"> · Gevonden in aanvullende menudetails</span>}
                          </span>
                        )
                      })}
                      {remaining > 0 && <span className="dish-group-more"> +{remaining} meer</span>}
                    </p>
                  )}
                  <Link href={buildGroupMenuHref(menu, filters.q)} className="detail-menu-btn-outline dish-group-link">
                    Bekijk alle {menu.count} op de kaart →
                  </Link>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {groupsHasMore && (
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
    </section>
  )

  // Only ever rendered when it has actual results (BE-11 Fase 2 §5/§11):
  // no bare "0 restaurants" block, no placeholder while loading — it
  // simply doesn't exist yet, and appears once its own fetch resolves.
  const restaurantsGroup = meaningfulQuery && restaurantResults.length > 0 && (
    <section aria-labelledby="restaurants-gevonden-heading" style={{ marginTop: 24 }}>
      <div className="results-header">
        <h2 className="results-count" id="restaurants-gevonden-heading">
          Restaurants gevonden{' '}
          <span className="results-count-detail">
            ({restaurantTotal} voor &quot;{filters.q}&quot;)
          </span>
        </h2>
      </div>

      {active && (
        // BE-11 Fase 2 honesty fix: the active-filters chip bar sits right
        // above this group, and a restaurant card visibly lists its own
        // meal types/price regardless of the current meal/price/day/
        // allergen filter — GET /api/restaurants has no such parameter at
        // all (see docs/api/restaurant-summary-shape.md "Known
        // limitations"). Without this note, a viewer could reasonably
        // read the nearby filter chips as applying here too.
        <p className="results-group-note">Filters gelden alleen voor gerechtresultaten, niet voor restaurants.</p>
      )}

      <div className="restaurant-grid">
        {restaurantResults.map((restaurant) => (
          <RestaurantBrowseCard key={restaurant.restaurantId} restaurant={restaurant} headingLevel={3} />
        ))}
      </div>

      {restaurantError && <p className="low-coverage-note">{restaurantError}</p>}

      {restaurantHasMore && (
        <div className="load-more-wrap">
          <button
            className="detail-menu-btn-outline load-more-btn"
            onClick={handleRestaurantLoadMore}
            disabled={restaurantLoadingMore}
          >
            {restaurantLoadingMore ? 'Laden…' : 'Meer restaurants laden ↓'}
          </button>
        </div>
      )}
    </section>
  )

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

      {/* BE-11 Fase 2 — a real page title for assistive tech (decision 014
          item 1: "a real page title, not only a generic site name"). Kept
          visually hidden rather than a new visible headline, so the
          existing visual design is unchanged; the header logo remains the
          visible brand mark for sighted users. This is also what makes
          "Gerechten gegroepeerd per restaurant"/"Restaurants gevonden" valid <h2>s below —
          they now nest under a real <h1> instead of floating with no
          page-level heading above them. */}
      <h1 className="vh">Zoeken</h1>

      <section className="search-page-hero">
        <form className="search-field search-page-field" onSubmit={handleSubmit}>
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input flagship"
            placeholder="Zoek steak, sushi, een restaurant of een buurt…"
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
            {/* BE-11 Fase 2 — <h2> (not <h3>), nested directly under this
                page's own <h1> above, closing the last h1→h3 heading-level
                skip on this page. Reuses .empty-state-title (not a bare
                <h2> or the shared .empty-state h3 selector) so this stays
                visually identical without also restyling <h2>s inside
                .empty-state elsewhere in the app (e.g. app/menu/[id]/
                MenuView.js's unrelated "Menu niet gevonden" state, which
                relies on the browser's default h2 size). */}
            <h2 className="empty-state-title">Waar heb je zin in?</h2>
            <p>Typ een gerecht, ingrediënt, restaurantnaam of buurt, of kies een filter hierboven.</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <h2 className="empty-state-title">Er ging iets mis</h2>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {/* BE-15 — fixed position, always immediately here, regardless
                of BE-11 Fase 2's own order-flip logic below (that logic is
                untouched — see the ticket's "Section placement and heading
                hierarchy" decision). */}
            {!loading && groupedSection}
            {restaurantsFirst ? (
              <>
                {restaurantsGroup}
                {dishesGroup}
              </>
            ) : (
              <>
                {dishesGroup}
                {restaurantsGroup}
              </>
            )}
          </>
        )}
      </main>
    </>
  )
}
