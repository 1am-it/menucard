// BE-32 (#75) — POST /api/internal/v1/source-discovery/ignore.
//
// "Negeren" in "Nieuw gevonden" is remembered: one BE-24 proposal of kind
// `mark_unusable` on the OSM object's own key. No migration, no new table, and
// no effect on published data. The handler is the tested one from
// src/lib/sourceDiscoveryHandlers.js.

import { NextResponse } from 'next/server'
import { sourceDiscoveryHandlers } from '@/src/lib/sourceDiscoveryRouteDeps'

export async function POST(request) {
  const { status, body } = await sourceDiscoveryHandlers.ignoreNew(request)
  return NextResponse.json(body, { status })
}
