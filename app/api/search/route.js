import { NextResponse } from 'next/server'
import { searchDishes } from '@/src/services/dishSearch'
import { daghapHandlers } from '@/src/lib/daghapRouteDeps'

function parseIntOr(value, fallback) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

function parseFloatOr(value, fallback) {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)

  const q = searchParams.get('q') || ''
  const meal = searchParams.get('meal') || ''
  const maxPrice = searchParams.has('maxPrice')
    ? parseFloatOr(searchParams.get('maxPrice'), null)
    : null
  const cuisines = (searchParams.get('cuisine') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const buurt = searchParams.get('buurt') || ''
  const excludeAllergens = (searchParams.get('excl') || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter(Number.isFinite)
  const day = searchParams.get('day') || ''
  const nowOpen = searchParams.get('nowOpen') === '1' || searchParams.get('nowOpen') === 'true'
  const cursor = parseIntOr(searchParams.get('cursor'), 0)
  const limit = parseIntOr(searchParams.get('limit'), undefined)
  // BE-15 — passed through as-is; searchDishes() itself falls back to the
  // default, ungrouped response for any value other than 'restaurant'.
  const group = searchParams.get('group') || ''
  // BE-55 stap B, deel 5 (#135) — het filter "Vandaag". Alleen dan haalt deze
  // route één kleine lijstvraag op (restaurant_id, soort, naam) en geeft die
  // map aan searchDishes; de browser krijgt nooit een lijst, alleen het label
  // bij de restaurants die hij al ziet. Zonder migratie of zonder Supabase
  // blijft de zoekfunctie werken en is er simpelweg geen treffer.
  const vandaag = searchParams.get('vandaag') === '1' || searchParams.get('vandaag') === 'true'
  let aanbod = null
  if (vandaag) {
    try {
      const { status, body } = await daghapHandlers.zoekAanbod()
      if (status === 200 && body && body.aanbod && typeof body.aanbod === 'object') aanbod = body.aanbod
    } catch (error) {
      aanbod = null
    }
  }

  const result = searchDishes({
    q,
    meal,
    maxPrice,
    cuisines,
    buurt,
    excludeAllergens,
    day,
    nowOpen,
    cursor,
    limit,
    group,
    vandaag,
    aanbod,
  })

  return NextResponse.json(result, {
    headers: {
      // Een Vandaag-treffer hangt van het actuele aanbod af; die mag niet uit
      // een gedeelde cache komen. Alle andere zoekopdrachten houden hun
      // bestaande cachekop.
      'Cache-Control': vandaag
        ? 'no-store'
        : 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}
