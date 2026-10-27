// GET /api/cron/osm-breda — BE-34 (#81, criterion 5): the nightly pre-fetch of
// the one cached OpenStreetMap answer for Breda, called by the second Vercel Cron
// in vercel.json. It writes nothing, publishes nothing and answers with `{ ok }`
// only. It runs the same unstable_cache function (tag `osm-breda`) that "Nieuw
// gevonden" uses, so daytime screens start warm and OSM is never asked more often
// than that cache allows. CRON_SECRET is checked when it exists; without it the
// route stays reachable and read-only. Logic (tested): src/lib/osmWarm.js.

import { NextResponse } from 'next/server'
import { warmOsmCache } from '@/src/lib/sourceDiscoveryRouteDeps'
import { cronAuthorized, warmResponse } from '@/src/lib/osmWarm'

export const dynamic = 'force-dynamic'
// One Overpass request with mirrors; the same call "Nieuw gevonden" makes.
export const maxDuration = 60

export async function GET(request) {
  const authorized = cronAuthorized({
    secret: process.env.CRON_SECRET,
    authorization: request.headers.get('authorization'),
  })
  if (!authorized) return NextResponse.json({ ok: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  const body = warmResponse(await warmOsmCache())
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
