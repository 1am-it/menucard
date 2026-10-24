// GET /api/health/db — daily Supabase keep-alive, called by the Vercel Cron in
// vercel.json. One head-only read, no data in the response. Logic (tested):
// src/lib/dbKeepAlive.js.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { createDbKeepAlive } from '@/src/lib/dbKeepAlive'

export const dynamic = 'force-dynamic'

const keepAlive = createDbKeepAlive({ getClient: getSupabaseAdmin })

export async function GET() {
  const { status, body } = await keepAlive.ping()
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
