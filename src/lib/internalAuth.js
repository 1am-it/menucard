// Auth guard for the internal API (PLATFORM-05).
//
// Verifies the caller's Supabase Auth session server-side via the
// Authorization header and looks up their staff_roles rows — never trusts
// a role or restaurant_id claimed by the client itself. Source/confidence
// for a write are derived here from the resolved role, per
// docs/api/data-trust-model.md's status-label mapping — never accepted
// from client input (see planning/specs/platform-trust-model.md's "never
// silently upgrade confidence" requirement).

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'

export async function authenticateInternalRequest(request) {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return { ok: false, status: 401, error: 'Missing bearer token' }
  }

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch (e) {
    // Misconfiguration (missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) is
    // an operator-facing problem, not a caller error — still return a
    // clean JSON body instead of letting it surface as an opaque 500 with
    // no message, but log the real cause server-side for whoever's
    // debugging deployment.
    console.error(e)
    return { ok: false, status: 500, error: 'Internal API is not configured' }
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: 'Invalid or expired session' }
  }

  const userId = userData.user.id
  const { data: roles, error: roleError } = await supabase
    .from('staff_roles')
    .select('role, restaurant_id')
    .eq('user_id', userId)

  if (roleError) {
    return { ok: false, status: 500, error: 'Failed to resolve staff role' }
  }
  if (!roles || roles.length === 0) {
    return { ok: false, status: 403, error: 'No staff role assigned for this account' }
  }

  return { ok: true, userId, roles }
}

// Whether `roles` (from authenticateInternalRequest) may act on
// `restaurantId`, and — for writes — the source/confidence that must be
// recorded, derived strictly from the role per data-trust-model.md's
// status-label mapping (owner -> high, editor -> high, imported -> low).
// A caller with multiple roles gets the strongest applicable one.
export function getAccessForRestaurant(roles, restaurantId) {
  if (roles.some((r) => r.role === 'editor')) {
    return { allowed: true, source: 'editor', confidence: 'high' }
  }
  if (roles.some((r) => r.role === 'owner' && r.restaurant_id === restaurantId)) {
    return { allowed: true, source: 'owner', confidence: 'high' }
  }
  if (roles.some((r) => r.role === 'internal')) {
    return { allowed: true, source: 'imported', confidence: 'low' }
  }
  return { allowed: false }
}
