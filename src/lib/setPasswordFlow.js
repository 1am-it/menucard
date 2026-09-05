// Pure decision logic for /internal/set-password (PLATFORM-05/06 pattern
// family — the missing "accept invitation / reset password" step flagged
// while preparing MARKET-05A's Data-inbox internal account).
//
// Deliberately CommonJS, unlike this directory's other files
// (supabaseAdmin.js, supabaseBrowser.js, internalAuth.js all use ESM
// import/export) — those are only ever run through Next.js's own
// bundler, never directly by Node. This module holds no React/Next.js
// import and no side effect (no Supabase client, no DOM access) — CommonJS
// here is what lets it run directly under this project's existing
// `node --test` tooling (see setPasswordFlow.test.js), the same reasoning
// that already makes ops/scripts/*.js CommonJS while src/lib/*.js is ESM.
// Next.js's bundler interoperates CommonJS exports into an ES import
// (app/internal/set-password/page.js) without any extra step.
//
// This module never touches Supabase, the DOM, or React — it only takes
// already-read values (a session, a parsed URL hash, form input, a raw
// Supabase error) and returns a decision. The page component is the only
// place that actually calls the Supabase client or renders anything.

'use strict';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Parses a URL hash string (e.g. `location.hash`, including or excluding
 * the leading "#") into a plain object of decoded key/value pairs.
 * Supabase's implicit-grant recovery/invite links deliver
 * `access_token`/`type`/`error`/`error_code`/`error_description` this way
 * — never as a query string. Returns `{}` for an empty or malformed hash,
 * never throws.
 */
function parseHashParams(hash) {
  const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  if (!raw) return {};
  const params = {};
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const eqIndex = pair.indexOf('=');
    const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
    const rawValue = eqIndex === -1 ? '' : pair.slice(eqIndex + 1);
    let key;
    let value;
    try {
      key = decodeURIComponent(rawKey);
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch (err) {
      // A malformed percent-encoding must never throw and break the page
      // — treat it the same as an unrecognized/empty hash.
      continue;
    }
    if (key) params[key] = value;
  }
  return params;
}

/** True when Supabase itself reports the link as rejected (expired,
 * already used, malformed) — e.g. `#error=access_denied&error_code=otp_expired`.
 * This is the one case we can detect deterministically, without waiting
 * for the SDK's own async session detection. */
function hasAuthErrorInHash(hashParams) {
  return Boolean(hashParams && hashParams.error);
}

/** True when the hash carries *something* that looks like an
 * in-progress Supabase auth link (an implicit-grant access token, or a
 * `type=recovery`/`type=invite` marker) — used only to distinguish "still
 * waiting for the SDK to finish processing a real link" from "there was
 * never a link here at all" (e.g. someone navigated to this page
 * directly). Never itself proof that the link is valid — only Supabase
 * establishing a real session proves that. */
function hashLooksLikeAuthLink(hashParams) {
  if (!hashParams) return false;
  return Boolean(hashParams.access_token || hashParams.type || hashParams.token_hash);
}

/**
 * The page's initial view state, before any Supabase auth-state event has
 * had a chance to fire — `'invalid'` | `'ready'` | `'checking'`.
 *
 * - `hasAuthErrorInHash` wins immediately: Supabase itself already said
 *   this link is rejected — never shown as "checking."
 * - A session already established (whatever put it there — a
 *   just-verified recovery/invite link, per this page's only real entry
 *   point) means the form may be shown.
 * - Otherwise, only keep waiting (`'checking'`) if the hash still looks
 *   like an in-progress link; a bare visit with no session and no link
 *   markers at all is immediately `'invalid'` — never an indefinite
 *   spinner.
 */
function determineInitialViewState({ hashParams, hasSession }) {
  const params = hashParams || {};
  if (hasAuthErrorInHash(params)) return 'invalid';
  if (hasSession) return 'ready';
  if (hashLooksLikeAuthLink(params)) return 'checking';
  return 'invalid';
}

/**
 * Client-side password validation — a UX guard only, never the
 * authoritative policy (Supabase's own server-side password rules, set
 * in the project's Auth settings, are enforced independently and may be
 * stricter or different; see `resolveUpdatePasswordOutcome` below for
 * how a server-side rejection is handled).
 */
function validateNewPassword(password, confirmPassword) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, reason: 'too-short' };
  }
  if (password !== confirmPassword) {
    return { valid: false, reason: 'mismatch' };
  }
  return { valid: true, reason: null };
}

function passwordValidationMessage(reason) {
  if (reason === 'too-short') {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (reason === 'mismatch') {
    return 'Passwords do not match.';
  }
  return '';
}

/**
 * Turns the result of `supabase.auth.updateUser({ password })` into
 * exactly one of: success, a safe "password rejected" message, or a
 * safe, fully generic failure message — **never** the raw
 * `error.message`/`error.code`/`error.status` from Supabase, which can
 * describe session/token internals. `error` may be `null`/`undefined`
 * (Supabase reported no problem, or the call itself threw with no usable
 * error object) — both are handled without ever assuming which.
 */
function resolveUpdatePasswordOutcome(error) {
  if (!error) {
    return { ok: true };
  }
  if (error.name === 'AuthWeakPasswordError' || error.weakPassword) {
    return {
      ok: false,
      message: "That password doesn't meet this site's requirements — please choose a different one.",
    };
  }
  return {
    ok: false,
    message: 'Something went wrong setting your password. Please request a new invitation link and try again.',
  };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  parseHashParams,
  hasAuthErrorInHash,
  hashLooksLikeAuthLink,
  determineInitialViewState,
  validateNewPassword,
  passwordValidationMessage,
  resolveUpdatePasswordOutcome,
};
