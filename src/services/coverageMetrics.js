import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'

// Below this many restaurants in a group, a percentage is misleading —
// show a raw count instead. See PLATFORM-01's acceptance criteria.
const SAMPLE_THRESHOLD = 3

function pct(count, total) {
  if (total === 0) return null
  return Math.round((count / total) * 1000) / 10
}

function breakdown(restaurantIds, menuRestaurantIds, fieldName) {
  const groups = {}
  for (const id of restaurantIds) {
    const key = restaurantsData[id][fieldName] || 'Onbekend'
    if (!groups[key]) groups[key] = { label: key, total: 0, withMenuData: 0 }
    groups[key].total += 1
    if (menuRestaurantIds.has(id)) groups[key].withMenuData += 1
  }
  return Object.values(groups)
    .map((g) => ({
      ...g,
      pct: g.total >= SAMPLE_THRESHOLD ? pct(g.withMenuData, g.total) : null,
    }))
    .sort((a, b) => b.total - a.total)
}

// Reads only the current static data sources (data/restaurants.json,
// data/menus.json). No persistence, no network calls, no trust/provenance
// awareness — PLATFORM-03 hasn't landed yet, so these are presence checks,
// not verified-data checks.
export function computeCoverageMetrics() {
  const restaurantIds = Object.keys(restaurantsData)
  const totalRestaurants = restaurantIds.length

  // data/restaurants.json also carries a legacy, pre-BE-02a `menus` field
  // per restaurant that is never read by /api/search or /menu/[id] — the
  // canonical, search-indexed source is data/menus.json, keyed as
  // "<restaurantId>-<mealType>". Coverage is measured against that source.
  const menuRestaurantIds = new Set(Object.keys(menusData).map((k) => k.split('-')[0]))

  const withBasicInfo = restaurantIds.filter((id) => {
    const r = restaurantsData[id]
    return Boolean(r.name && r.address && r.hours && r.cuisine)
  })

  const withMenuData = restaurantIds.filter((id) => menuRestaurantIds.has(id))
  const withoutMenuData = restaurantIds.filter((id) => !menuRestaurantIds.has(id))

  const withConfirmedReservation = restaurantIds.filter(
    (id) => restaurantsData[id].reservation?.verified === true
  )

  let totalItems = 0
  let pricedItems = 0
  for (const key of Object.keys(menusData)) {
    for (const cat of menusData[key].categories || []) {
      for (const item of cat.items || []) {
        totalItems += 1
        if (item.priceOnRequest || typeof item.priceValue === 'number') pricedItems += 1
      }
    }
  }

  return {
    city: 'Breda',
    totals: { restaurants: totalRestaurants },
    metrics: {
      basicInfo: {
        count: withBasicInfo.length,
        total: totalRestaurants,
        pct: pct(withBasicInfo.length, totalRestaurants),
      },
      menuData: {
        count: withMenuData.length,
        total: totalRestaurants,
        pct: pct(withMenuData.length, totalRestaurants),
        restaurantIds: withMenuData,
        missingRestaurantIds: withoutMenuData,
      },
      priceCoverage: {
        count: pricedItems,
        total: totalItems,
        pct: pct(pricedItems, totalItems),
      },
      reservationConfirmed: {
        count: withConfirmedReservation.length,
        total: totalRestaurants,
        pct: pct(withConfirmedReservation.length, totalRestaurants),
      },
    },
    byCuisine: breakdown(restaurantIds, menuRestaurantIds, 'cuisine'),
    byBuurt: breakdown(restaurantIds, menuRestaurantIds, 'buurt'),
    sampleThreshold: SAMPLE_THRESHOLD,
  }
}
