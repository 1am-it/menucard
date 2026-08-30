// Server-only data access / search layer (BE-02b).
//
// This module must never be imported from a 'use client' component — it
// reads the full restaurants/menus dataset into memory once per server
// process and exposes only bounded, filtered query results. It exists so
// that no new code needs to ship the full dataset to the browser; existing
// pages still import the JSON directly and are migrated to this layer in
// BE-04/BE-05, not here (see planning/decisions/004-server-side-search-before-restyle.md).
//
// Ranking/relevance beyond a minimal name-match-first ordering is out of
// scope here — that's BE-02c. Filters below are intentionally simple AND
// conditions, duplicated from the equivalent client-side helpers in
// app/page.js and app/menu/[id]/page.js rather than imported from them,
// since those are 'use client' modules. This duplication is expected to be
// removed once BE-04 rewires the homepage onto this service.

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'

const MEAL_TYPES = ['lunch', 'diner', 'borrel', 'specialiteiten']

const CUISINE_KEYWORDS = {
  'Amerikaans':      ['american', 'burger', 'bbq'],
  'Chinees':         ['chinese', 'chinees'],
  'Frans':           ['french', 'frans'],
  'Fusion':          ['fusion'],
  'Grill & Steak':   ['grill', 'steak'],
  'Indiaas':         ['indian', 'indiaas'],
  'Indonesisch':     ['indonesian', 'indonesisch'],
  'Italiaans':       ['italian', 'pizza', 'pasta'],
  'Mediterraan':     ['mediterranean', 'mediterraan', 'spanish', 'greek'],
  'Midden-Oosten':   ['midden-oosten', 'middle-eastern', 'arabic', 'turkish'],
  'Modern Europees': ['european', 'scandinavian', 'modern'],
  'Nederlands':      ['dutch', 'grand-cafe', 'allday', 'nl'],
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function getTodayKey() {
  const map = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
  return map[new Date().getDay()]
}

function getOpenStatus(restaurant, day) {
  const key = day || getTodayKey()
  const hours = restaurant.openingHours?.[key]
  if (!hours) return null
  if (key !== getTodayKey()) return 'open' // future/other day: only known-open info is hours presence
  const [openStr, closeStr] = hours.split('-')
  if (!openStr || !closeStr) return null
  const toMin = (str) => {
    const [h, m] = str.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return nowMin >= toMin(openStr) && nowMin < toMin(closeStr) ? 'open' : 'closed'
}

function isCurrentlyOpen(restaurant) {
  return getOpenStatus(restaurant) === 'open'
}

function matchesCuisine(restaurant, cuisines) {
  if (!cuisines.length) return true
  const keywords = (restaurant.cuisineKeywords || '').toLowerCase()
  const cuisine = (restaurant.cuisine || '').toLowerCase()
  return cuisines.some((c) => {
    const kws = CUISINE_KEYWORDS[c] || []
    return kws.some((kw) => keywords.includes(kw) || cuisine.includes(kw))
  })
}

// Build the flat dish index once per server process, per docs/api/dish-result-shape.md
function buildDishIndex() {
  const dishes = []
  for (const [menuKey, menu] of Object.entries(menusData)) {
    const parts = menuKey.split('-')
    const restaurantId = parts[0]
    const mealType = parts.slice(1).join('-')
    const restaurant = restaurantsData[restaurantId]
    if (!restaurant) continue

    ;(menu.categories || []).forEach((category, categoryIndex) => {
      ;(category.items || []).forEach((item, itemIndex) => {
        dishes.push({
          dishId: `${restaurantId}-${mealType}-${categoryIndex}-${itemIndex}`,
          name: item.name || '',
          description: item.desc || null,
          priceValue: item.priceValue ?? null,
          priceDisplay: item.price ?? 'op aanvraag',
          priceOnRequest: !!item.priceOnRequest,
          priceIsFrom: !!item.priceIsFrom,
          priceIsMultiple: !!item.priceIsMultiple,
          restaurantId,
          restaurantName: restaurant.name,
          mealType,
          category: category.name || '',
          tags: item.tags || [],
          allergens: item.allergens || [],
          distanceMeters: null, // no location data source yet, see dish-result-shape.md
          openStatus: null,     // computed per-request against the current/selected day, not cached
          menuLink: `/menu/${restaurantId}-${mealType}`,
          // internal-only, not part of the public shape, used for filtering:
          _restaurant: restaurant,
        })
      })
    })
  }
  return dishes
}

let dishIndex = null
function getDishIndex() {
  if (!dishIndex) dishIndex = buildDishIndex()
  return dishIndex
}

function textMatches(dish, q) {
  if (!q || q.length < 2) return true
  const needle = q.toLowerCase()
  return (
    dish.name.toLowerCase().includes(needle) ||
    (dish.description || '').toLowerCase().includes(needle) ||
    dish.restaurantName.toLowerCase().includes(needle) ||
    dish.tags.some((t) => t.toLowerCase().includes(needle))
  )
}

function priceMatches(dish, maxPrice) {
  if (maxPrice == null) return true
  // Never silently exclude data we can't reduce to one number — see
  // dish-result-shape.md "known limitations". Multi-price / on-request
  // items pass through; a real decision here belongs to BE-02c/BE-06.
  if (dish.priceOnRequest || dish.priceIsMultiple) return true
  if (dish.priceValue == null) return true
  return dish.priceValue <= maxPrice
}

function allergensMatch(dish, excludeIds) {
  if (!excludeIds.length) return true
  if (!Array.isArray(dish.allergens)) return true
  return !excludeIds.some((id) => dish.allergens.includes(id))
}

/**
 * @param {object} params
 * @param {string} [params.q]
 * @param {string} [params.meal] - one of MEAL_TYPES
 * @param {number} [params.maxPrice]
 * @param {string[]} [params.cuisines]
 * @param {string} [params.buurt]
 * @param {number[]} [params.excludeAllergens]
 * @param {string} [params.day] - 'ma'..'zo'
 * @param {boolean} [params.nowOpen]
 * @param {number} [params.cursor] - offset into the filtered result set
 * @param {number} [params.limit]
 */
export function searchDishes({
  q = '',
  meal = '',
  maxPrice = null,
  cuisines = [],
  buurt = '',
  excludeAllergens = [],
  day = '',
  nowOpen = false,
  cursor = 0,
  limit = DEFAULT_LIMIT,
} = {}) {
  const boundedLimit = Math.min(Math.max(1, limit || DEFAULT_LIMIT), MAX_LIMIT)
  const boundedCursor = Math.max(0, cursor || 0)

  let filtered = getDishIndex().filter((dish) => {
    if (meal && !MEAL_TYPES.includes(meal)) return false
    if (meal && dish.mealType !== meal) return false
    if (!textMatches(dish, q)) return false
    if (!priceMatches(dish, maxPrice)) return false
    if (!matchesCuisine(dish._restaurant, cuisines)) return false
    if (buurt && dish._restaurant.buurt !== buurt) return false
    if (!allergensMatch(dish, excludeAllergens)) return false
    if (nowOpen && !isCurrentlyOpen(dish._restaurant)) return false
    if (day && !nowOpen && !dish._restaurant.openingHours?.[day]) return false
    return true
  })

  // Minimal, temporary ordering: exact-ish name matches first, otherwise
  // stable dataset order. Real ranking rules are BE-02c's responsibility.
  if (q && q.length >= 2) {
    const needle = q.toLowerCase()
    filtered = [...filtered].sort((a, b) => {
      const aName = a.name.toLowerCase().includes(needle) ? 0 : 1
      const bName = b.name.toLowerCase().includes(needle) ? 0 : 1
      return aName - bName
    })
  }

  const total = filtered.length
  const page = filtered
    .slice(boundedCursor, boundedCursor + boundedLimit)
    .map((dish) => {
      const { _restaurant, ...publicShape } = dish
      return {
        ...publicShape,
        openStatus: getOpenStatus(_restaurant, day || undefined),
      }
    })

  const nextCursor = boundedCursor + boundedLimit < total ? boundedCursor + boundedLimit : null

  return {
    results: page,
    total,
    nextCursor,
    hasMore: nextCursor !== null,
  }
}
