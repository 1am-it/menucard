import { NextResponse } from 'next/server'
import { searchRestaurants } from '@/src/services/restaurantIndex'

function parseIntOr(value, fallback) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

// BE-11 Fase 1 — restaurant-level browse index. Deliberately minimal:
// only `q` (name/buurt/address text) plus pagination. No meal, price,
// allergen, cuisine, buurt-exact, day, or "now open" filter yet — see
// docs/api/restaurant-summary-shape.md "Known limitations" for what this
// endpoint intentionally does not do yet.
export async function GET(request) {
  const { searchParams } = new URL(request.url)

  const q = searchParams.get('q') || ''
  const cursor = parseIntOr(searchParams.get('cursor'), 0)
  const limit = parseIntOr(searchParams.get('limit'), undefined)

  const result = searchRestaurants({ q, cursor, limit })

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}
