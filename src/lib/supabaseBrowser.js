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
//
// BE-47 (#111), criterium 3 — "lang ingelogd", zonder eigen tokenopslag:
// deze client is de enige plek waar de sessie leeft en hij gebruikt de
// standaard Supabase-opslag en het standaard verversen in de browser. In de
// praktijk (Supabase-standaardinstellingen) geldt: het access token is 1 uur
// geldig, het refresh token heeft geen vaste eindtijd zolang "Time-box user
// sessions" in het project uit staat en het token binnen de reuse-interval
// wordt gebruikt; de client ververst het access token zelf vóór het verloopt.
// Een houder blijft dus ingelogd tot hij zelf uitlogt of zijn account
// verwijdert — ook na een dag niet gebruiken — en niets daarvan komt in een
// eigen cookie of localStorage-sleutel van deze app terecht.

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
