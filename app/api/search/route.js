import { NextResponse } from 'next/server'
import { searchDishes } from '@/src/services/dishSearch'

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
  })

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}
