// PLATFORM-11 — minimal, read-only role resolution for the shared internal
// navigation shell (src/components/InternalNav.js, app/internal/page.js).
//
// This is not a second, parallel way to determine a user's `staff_roles`:
// it calls authenticateInternalRequest exactly as every other internal
// route already does, and reshapes only one case. That function itself
// returns `{ ok: false, status: 403, error: 'No staff role assigned for
// this account' }` for a valid session with zero staff_roles rows — a
// legitimate "signed in, no internal access" state for navigation
// purposes, not a failure — so here that specific case becomes a normal
// 200 with an empty roles array instead of an error, letting /internal
// render its own explicit "no internal access" status (PLATFORM-11's
// decided design) rather than treating it as an API failure to bounce on.
// A missing/invalid/expired session (401) is returned unchanged.
//
// Strictly read-only: never inserts, updates, deletes, or upserts
// anything, and never queries staff_roles itself — that stays exclusively
// inside authenticateInternalRequest.

import { NextResponse } from 'next/server'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)

  if (auth.ok) {
    return NextResponse.json({ roles: auth.roles })
  }

  if (auth.status === 403) {
    return NextResponse.json({ roles: [] })
  }

  return NextResponse.json({ error: auth.error }, { status: auth.status })
}
