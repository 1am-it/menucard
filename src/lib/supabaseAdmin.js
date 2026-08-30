// Server-only Supabase client for the PLATFORM-* internal API (PLATFORM-05).
//
// Uses the service-role key, which bypasses Row Level Security entirely.
// This module must never be imported from a 'use client' component or any
// code path that could ship it to the browser — only route handlers under
// app/api/internal/v1/ are intended callers. Mirrors the server-only
// convention already established in src/services/dishSearch.js.

import { createClient } from '@supabase/supabase-js'

let cachedClient = null

export function getSupabaseAdmin() {
  if (cachedClient) return cachedClient

  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.local.example).'
    )
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedClient
}
