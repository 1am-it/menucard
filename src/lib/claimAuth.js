// Auth guard for the public /api/claims/* endpoints (PLATFORM-07).
//
// Deliberately lighter than src/lib/internalAuth.js's
// authenticateInternalRequest: it verifies the caller's Supabase Auth
// session but does NOT require an existing staff_roles row — any
// authenticated user may submit or check their own claim. Kept as its own
// file rather than extending internalAuth.js, so PLATFORM-05/06's
// already-verified staff-only guard stays untouched.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'

export async function authenticateAnyUser(request) {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return { ok: false, status: 401, error: 'Missing bearer token' }
  }

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch (e) {
    console.error(e)
    return { ok: false, status: 500, error: 'Internal API is not configured' }
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    return { ok: false, status: 401, error: 'Invalid or expired session' }
  }

  // email/user id come only from the verified session — never from any
  // client-supplied field, per PLATFORM-07's explicit requirement.
  return { ok: true, userId: data.user.id, email: data.user.email }
}
