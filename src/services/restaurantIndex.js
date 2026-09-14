// Server-only restaurant-level browse index (BE-11 Fase 1, first vertical
// slice).
//
// This module must never be imported from a 'use client' component — like
// src/services/dishSearch.js, it reads a dataset into memory once per
// server process and exposes only bounded, filtered, whitelisted results.
//
// Deliberately reads ONLY data/restaurants.json — never
// data/menus.json, and never the legacy `menus` blob embedded in
// individual restaurant records. This is the module's one hard
// invariant: `Alle restaurants` must show every known restaurant,
// including the ~84% that currently have no menu/dish data at all (see
// planning/specs/tickets/be-11-public-menu-discovery-intent-aware-results.md
// "Problem" for the dated coverage snapshot). Grouping
// src/services/dishSearch.js's dish-level results would silently exclude
// those restaurants — this module exists specifically so that never
// happens. For the same reason, this module does NOT import anything
// from dishSearch.js, even a small restaurant-only helper: requiring
// that module would execute its own top-level `require('.../menus.json')`
// and defeat the "reads only restaurants.json" guarantee. Small helpers
// (e.g. open-status) are duplicated locally instead — the same tradeoff
// dishSearch.js's own header comment already documents for its
// client-side-duplicated filter helpers.
//
// Deliberately CommonJS, same reasoning as dishSearch.js/importInbox.js/
// moderationFormatting.js — directly testable via this project's existing
// `node --test` tooling, no new dependency, interoperates fine with the
// ESM route handler (app/api/restaurants/route.js) that imports it.
//
// Contract documented in docs/api/restaurant-summary-shape.md — keep that
// file in sync with PUBLIC_RESTAURANT_FIELDS/getMatchTier() below.

'use strict'

const restaurantsData = require('../../data/restaurants.json')

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function getTodayKey() {
  const map = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
  return map[new Date().getDay()]
}

// Deliberately limited: today's status only, no day parameter — this
// first vertical slice has no day/meal filter at all. Duplicated from
// (not imported from) dishSearch.js's own getOpenStatus/isCurrentlyOpen —
// see the header comment above for why.
function getOpenStatus(restaurant) {
  const key = getTodayKey()
  const hours = restaurant.openingHours?.[key]
  if (!hours) return null
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

// Known, narrow exception — NOT a general "an address without a digit is
// invalid" rule (that would wrongly reject any legitimately number-less
// real address). This checks for one specific, confirmed data-entry
// pattern: the address field is literally just the restaurant's own name
// with ", Breda" -> "Breda" appended, i.e. no real address was ever
// entered and something defaulted to a self-referential placeholder.
// Restaurant id 10 ("Salon de Provence") is the one confirmed instance in
// the current dataset — see docs/api/restaurant-summary-shape.md "Known
// limitations" for the full data-quality note and the correction path
// (PLATFORM-07 owner claim / PLATFORM-08 community micro-task; this
// module never guesses or writes a replacement address).
function isValidAddress(address, restaurantName) {
  if (!address || typeof address !== 'string') return false
  const trimmed = address.trim()
  if (!trimmed) return false
  if (restaurantName) {
    const placeholder = `${restaurantName} Breda`.toLowerCase()
    if (trimmed.toLowerCase() === placeholder) return false
  }
  return true
}

function buildRestaurantIndex() {
  return Object.entries(restaurantsData).map(([restaurantId, restaurant]) => ({
    restaurantId,
    name: restaurant.name || '',
    cuisine: restaurant.cuisineLabel || restaurant.cuisine || '',
    priceLevel: restaurant.priceLevel ?? null,
    buurt: restaurant.buurt || null,
    menuLinks: Array.isArray(restaurant.menuLinks) ? restaurant.menuLinks : [],
    hasMenu: Array.isArray(restaurant.menuLinks) && restaurant.menuLinks.length > 0,
    // internal-only, never part of the public shape returned by
    // searchRestaurants() (see toPublicRestaurantShape() below).
    _validAddress: isValidAddress(restaurant.address, restaurant.name)
      ? restaurant.address
      : null,
    _restaurant: restaurant,
  }))
}

let restaurantIndex = null
function getRestaurantIndex() {
  if (!restaurantIndex) restaurantIndex = buildRestaurantIndex()
  return restaurantIndex
}

// Ranking tiers for the restaurant-level `q` parameter — deliberately
// modest and restaurant-scoped, mirroring (not sharing code with)
// dishSearch.js's getMatchTier() philosophy: lower tier = better match,
// null = excluded. Never matches on the invalid/placeholder address (see
// isValidAddress above) — a restaurant with a known-bad address is simply
// not reachable via address text, not silently matched anyway.
function getMatchTier(restaurant, needle) {
  const name = restaurant.name.toLowerCase()
  if (name === needle) return 0
  if (name.includes(needle)) return 1
  if ((restaurant.buurt || '').toLowerCase().includes(needle)) return 2
  if ((restaurant._validAddress || '').toLowerCase().includes(needle)) return 3
  return null
}

// Explicit whitelist of fields returned to callers of searchRestaurants(),
// per docs/api/restaurant-summary-shape.md. Deliberately a whitelist, not
// a blacklist of internal-only fields (_validAddress, _restaurant) — same
// reasoning as dishSearch.js's own PUBLIC_DISH_FIELDS/toPublicDishShape().
const PUBLIC_RESTAURANT_FIELDS = [
  'restaurantId', 'name', 'cuisine', 'priceLevel', 'buurt', 'address',
  'openStatus', 'menuLinks', 'hasMenu',
]

function toPublicRestaurantShape(restaurant) {
  const shape = {}
  for (const field of PUBLIC_RESTAURANT_FIELDS) shape[field] = restaurant[field]
  return shape
}

/**
 * @param {object} params
 * @param {string} [params.q] - free text against name, buurt, and valid
 *   address only. Never matches dish/menu content — this module has no
 *   access to it.
 * @param {number} [params.cursor] - offset into the filtered result set
 * @param {number} [params.limit]
 */
function searchRestaurants({ q = '', cursor = 0, limit = DEFAULT_LIMIT } = {}) {
  const boundedLimit = Math.min(Math.max(1, limit || DEFAULT_LIMIT), MAX_LIMIT)
  const boundedCursor = Math.max(0, cursor || 0)
  const trimmedQ = (q || '').trim()
  const hasQuery = trimmedQ.length >= 2 // same minimum-length convention as dishSearch.js
  const needle = hasQuery ? trimmedQ.toLowerCase() : null

  const candidates = getRestaurantIndex()
    .map((restaurant) => ({ restaurant, tier: hasQuery ? getMatchTier(restaurant, needle) : 0 }))
    .filter(({ tier }) => !hasQuery || tier !== null)

  // Ranking: lower tier first, then restaurant name alphabetically
  // (localeCompare, Dutch locale) — deterministic, no invented sort
  // value, consistent with this ticket's own non-goal against new
  // ranking/sort logic.
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return a.restaurant.name.localeCompare(b.restaurant.name, 'nl')
  })

  const total = candidates.length
  const page = candidates
    .slice(boundedCursor, boundedCursor + boundedLimit)
    .map(({ restaurant }) => ({
      ...toPublicRestaurantShape(restaurant),
      address: restaurant._validAddress,
      openStatus: getOpenStatus(restaurant._restaurant),
    }))

  const nextCursor = boundedCursor + boundedLimit < total ? boundedCursor + boundedLimit : null

  return {
    results: page,
    total,
    nextCursor,
    hasMore: nextCursor !== null,
  }
}

module.exports = { searchRestaurants, isValidAddress }
