// BE-32 (#75) — /api/internal/v1/source-discovery, `internal`-only.
//
// GET  → "🆕 Nieuw gevonden": OSM businesses in Breda that we do not have and
//        that nobody ignored. Read only (one cached OSM request per day).
// POST → "✨ Vind bronnen" / "✨ Zoek de bron voor mij": the four layers for a
//        bounded set of restaurants. Every result is a BE-24 proposal; nothing
//        is added, confirmed or published.
//
// The role check, the layer order, the budget gate and the proposal write live
// in src/lib/sourceDiscoveryHandlers.js (tested with fakes). The real
// dependencies — internal auth, the safe fetch, the existing AI client and the
// existing proposal RPCs — are wired in src/lib/sourceDiscoveryRouteDeps.js.

import { NextResponse } from 'next/server'
import { sourceDiscoveryHandlers } from '@/src/lib/sourceDiscoveryRouteDeps'

export async function GET(request) {
  const { status, body } = await sourceDiscoveryHandlers.newRestaurants(request)
  return NextResponse.json(body, { status })
}

export async function POST(request) {
  const { status, body } = await sourceDiscoveryHandlers.findSources(request)
  return NextResponse.json(body, { status })
}
