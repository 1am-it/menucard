// Browser-only Supabase client (PLATFORM-06).
//
// Used exclusively for authentication (sign-in, session lookup) in the
// internal moderation UI — never for direct data reads/writes. All actual
// data access still goes through our own authenticated
// /api/internal/v1/... routes (src/lib/internalAuth.js,
// src/lib/supabaseAdmin.js), the same as before this ticket.
//
// Uses the publishable/anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY), which is
// designed to be public and safe in client-side bundles — protected by RLS
// and this API's own role checks, not by secrecy. This is categorically
// different from the service-role key in supabaseAdmin.js, which must
// never reach the browser.

import { createClient } from '@supabase/supabase-js'

let cachedClient = null

export function getSupabaseBrowser() {
  if (cachedClient) return cachedClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Supabase browser client is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.'
    )
  }

  cachedClient = createClient(url, anonKey)
  return cachedClient
}
