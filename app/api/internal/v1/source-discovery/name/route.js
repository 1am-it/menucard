// BE-34 (#81, criterion 2) — /api/internal/v1/source-discovery/name, `internal`-only.
//
// POST → "✨ Zoek op internet: <naam>, Breda" for a restaurant that is not in our
// list yet. It is the same engine and the same AI search layer as "Vind bronnen":
// the same client, the same monthly budget, the same refused delivery/booking
// platforms and the same source requirement. The answer is a proposal (name,
// address, website, menu link and provenance); nothing is created, confirmed or
// published. The human opens the existing onboarding from it.
//
// The role check, the budget gate and the validation live in
// src/lib/sourceDiscoveryHandlers.js (tested with fakes); the real dependencies —
// internal auth, the safe fetch, the existing AI client and the cached OSM answer
// — are wired in src/lib/sourceDiscoveryRouteDeps.js.

import { NextResponse } from 'next/server'
import { sourceDiscoveryHandlers } from '@/src/lib/sourceDiscoveryRouteDeps'

export const dynamic = 'force-dynamic'
// The provider's own web search plus one homepage read stay well inside the
// 300 s that the existing AI route already proved to be available.
export const maxDuration = 300

export async function POST(request) {
  const { status, body } = await sourceDiscoveryHandlers.searchByName(request)
  return NextResponse.json(body, { status })
}
