'use strict';

// BE-48 (#112) — the internal API guard, with the second step enforced on the
// server.
//
// This is the tested implementation behind src/lib/internalAuth.js (which stays
// the single import path for every route and only injects the real Supabase
// client). Everything that decides access lives here:
//
//  - the bearer token is verified by Supabase's own `getUser` — a role or
//    restaurant_id claimed by the client is never trusted;
//  - the assurance level (`aal`) is read from the *payload* of that already
//    verified token. Its middle segment is base64url-decoded and never
//    validated as a signature, because `getUser` already proved the token;
//  - an account with the `internal` or `editor` role is refused with 403
//    ("Tweede inlogstap vereist") as long as the token is still `aal1`, so a
//    browser that bypasses the login screen gains nothing;
//  - an account with only `owner` rows keeps working on `aal1`: restaurant
//    holders get their own route in BE-47 (#111) and are not forced into an
//    authenticator app here.
//
// A token whose payload cannot be decoded is never a crash: it simply has no
// readable level, which fails closed for the roles that need a second step.

const SECOND_FACTOR_ROLES = Object.freeze(['internal', 'editor']);
const SECOND_FACTOR_ERROR = 'Tweede inlogstap vereist';
const SECOND_FACTOR_REASON = 'aal2_required';

/**
 * Decodes one base64url JWT segment into text. Returns `null` for anything that
 * is not valid base64url/UTF-8 — never throws.
 */
function decodeSegment(segment) {
  if (typeof segment !== 'string' || segment.length === 0) return null;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    return null;
  }
}

/**
 * The payload of a JWT as an object, or `null` when it is missing, truncated,
 * not JSON, or not an object. No signature check: the caller only passes a
 * token that Supabase has already verified.
 */
function readTokenPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const text = decodeSegment(parts[1]);
  if (!text) return null;
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

/** The `aal` claim of a verified token (`'aal1'`, `'aal2'`), or `null`. */
function readAssuranceLevel(token) {
  const payload = readTokenPayload(token);
  if (!payload) return null;
  return typeof payload.aal === 'string' && payload.aal.length > 0 ? payload.aal : null;
}

/** True when at least one resolved staff role requires the second step. */
function rolesRequireSecondFactor(roles) {
  if (!Array.isArray(roles)) return false;
  return roles.some((row) => row && SECOND_FACTOR_ROLES.includes(row.role));
}

/**
 * True when this request must still be refused: a role that needs the second
 * step, with a token that is not (yet) `aal2`.
 */
function secondFactorMissing(roles, assuranceLevel) {
  return rolesRequireSecondFactor(roles) && assuranceLevel !== 'aal2';
}


function readBearerToken(request) {
  if (!request || !request.headers || typeof request.headers.get !== 'function') return null;
  let header = null;
  try {
    header = request.headers.get('authorization');
  } catch (error) {
    return null;
  }
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Builds the guard with an injected Supabase client factory, so the whole
 * decision path (401 without token, verified token, roles, `aal`) is testable
 * with a fictional client and without a database.
 */
function createInternalAuth({ getSupabase } = {}) {
  if (typeof getSupabase !== 'function') {
    throw new TypeError('createInternalAuth requires a getSupabase function');
  }

  /**
   * The authenticated caller, or `{ ok: false, status, error }`:
   * 401 without/with an unusable token, 403 without any staff role, 403 while a
   * second factor is still required, 500 for a server-side problem.
   */
  async function authenticateInternalRequest(request) {
    const token = readBearerToken(request);
    if (!token) {
      return { ok: false, status: 401, error: 'Missing bearer token' };
    }

    let supabase;
    try {
      supabase = getSupabase();
    } catch (error) {
      // Misconfiguration (missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) is an
      // operator-facing problem, not a caller error — still a clean JSON body,
      // but log the real cause server-side for whoever debugs the deployment.
      console.error(error);
      return { ok: false, status: 500, error: 'Internal API is not configured' };
    }

    let userData = null;
    let userError = null;
    try {
      const result = await supabase.auth.getUser(token);
      userData = result && result.data;
      userError = result && result.error;
    } catch (error) {
      userError = error;
    }
    if (userError || !userData || !userData.user) {
      return { ok: false, status: 401, error: 'Invalid or expired session' };
    }

    const userId = userData.user.id;
    let roles = null;
    try {
      const result = await supabase.from('staff_roles').select('role, restaurant_id').eq('user_id', userId);
      if (result && result.error) {
        return { ok: false, status: 500, error: 'Failed to resolve staff role' };
      }
      roles = result && result.data;
    } catch (error) {
      return { ok: false, status: 500, error: 'Failed to resolve staff role' };
    }
    if (!roles || roles.length === 0) {
      return { ok: false, status: 403, error: 'No staff role assigned for this account' };
    }

    // BE-48 (#112): the second step is enforced here, not only in the browser.
    const assuranceLevel = readAssuranceLevel(token);
    if (secondFactorMissing(roles, assuranceLevel)) {
      return { ok: false, status: 403, error: SECOND_FACTOR_ERROR, reason: SECOND_FACTOR_REASON };
    }

    return { ok: true, userId, roles };
  }

  return { authenticateInternalRequest };
}

// Whether `roles` (from authenticateInternalRequest) may act on
// `restaurantId`, and — for writes — the source/confidence that must be
// recorded, derived strictly from the role per data-trust-model.md's
// status-label mapping (owner -> high, editor -> high, imported -> low).
// A caller with multiple roles gets the strongest applicable one.
// Unchanged by BE-48: the second step only decides *whether* a caller is
// admitted, never what a role may do.
function getAccessForRestaurant(roles, restaurantId) {
  if (roles.some((r) => r.role === 'editor')) {
    return { allowed: true, source: 'editor', confidence: 'high' };
  }
  if (roles.some((r) => r.role === 'owner' && r.restaurant_id === restaurantId)) {
    return { allowed: true, source: 'owner', confidence: 'high' };
  }
  if (roles.some((r) => r.role === 'internal')) {
    return { allowed: true, source: 'imported', confidence: 'low' };
  }
  return { allowed: false };
}

module.exports = {
  SECOND_FACTOR_ROLES,
  SECOND_FACTOR_ERROR,
  SECOND_FACTOR_REASON,
  decodeSegment,
  readTokenPayload,
  readAssuranceLevel,
  rolesRequireSecondFactor,
  secondFactorMissing,
  readBearerToken,
  createInternalAuth,
  getAccessForRestaurant,
};
