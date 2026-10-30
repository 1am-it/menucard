// BE-46 (#106, criterium 3) — GET /api/cron/kies-opruimen: één keer per dag
// (vercel.json) verwijdert deze route elke stemming ouder dan zeven dagen,
// inclusief de stemmen (on delete cascade in supabase/migrations/0022).
//
// Beveiligd zoals de bestaande cronroutes (app/api/cron/osm-breda): CRON_SECRET
// wordt gecontroleerd wanneer hij bestaat; zonder secret blijft de route
// bereikbaar. Het antwoord is `{ ok }` plus het aantal verwijderde stemmingen,
// nooit een rij of een roepnaam.
//
// Ontbreekt de migratie, dan antwoordt de route 503 en `{ ok: false }`: er valt
// dan niets op te ruimen. Logica (getest): src/lib/kiesHandlers.js.

import { NextResponse } from 'next/server'
import { kiesHandlers } from '@/src/lib/kiesRouteDeps'
import { cronAuthorized } from '@/src/lib/osmWarm'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const authorized = cronAuthorized({
    secret: process.env.CRON_SECRET,
    authorization: request.headers.get('authorization'),
  })
  if (!authorized) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  const { status, body } = await kiesHandlers.cleanupStemmingen()
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
