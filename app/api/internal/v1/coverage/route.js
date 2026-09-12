// PLATFORM-01 — internal Coverage Dashboard data.
//
// **Security fix (2026-09-12).** `/internal/coverage` previously rendered
// with no authentication at all — accepted at the time this ticket was
// scoped (PLATFORM-05, which introduced this project's internal-only
// authentication mechanism, didn't exist yet). See
// planning/specs/tickets/platform-01-coverage-baseline-dashboard.md's own
// dated correction. This route closes that gap by reusing the exact same,
// already-proven gate every other internal route already uses
// (authenticateInternalRequest + isInternalOnly('internal') — see
// src/lib/internalAuth.js/src/lib/importInbox.js), never a new role, a
// bypass, or a different authorization mechanism.
//
// Strictly read-only: recomputes coverage metrics from the current static
// data (src/services/coverageMetrics.js, unchanged by this fix) on every
// request — no database write, no mutation, no new dependency.

import { NextResponse } from 'next/server'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { computeCoverageMetrics } from '@/src/services/coverageMetrics'

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can view the coverage dashboard' }, { status: 403 })
  }

  return NextResponse.json(computeCoverageMetrics())
}
