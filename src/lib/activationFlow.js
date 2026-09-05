// Pure decision logic for /internal/activate — the scanner-resistant
// step that must exist *before* /internal/set-password.
//
// Why this page exists: Supabase's default email link
// (`{{ .ConfirmationURL }}`) points straight at Supabase's own
// `/auth/v1/verify` endpoint and verifies the one-time token on a plain
// GET request, with no user interaction at all. Per Supabase's own
// documentation (supabase.com/docs/guides/auth/auth-email-templates):
// "Certain email providers may have spam detection or other security
// features that prefetch URL links from incoming emails" — an automated
// scanner visiting the link consumes the single-use token before the
// real recipient ever clicks it, which is exactly what was observed live
// against this project's own invite links. The fix, per that same
// documentation's recommended pattern: route the email link through a
// page of our own that does nothing on load, and only calls
// `supabase.auth.verifyOtp()` (a POST — never triggerable by a passive
// GET-only scanner) after a real, explicit button click.
//
// The token is carried **only in the URL fragment**
// (`#token_hash=...&type=...`), deliberately not as a query string —
// unlike a query string, a URL fragment is never sent to any server at
// all (not Supabase's, not this app's), so the token never appears in
// any server or proxy log in the first place, not even ours. No
// `redirect_to` parameter is accepted from the URL — the only
// destination after a successful activation is hardcoded to
// `/internal/set-password` on the page itself, never a URL-supplied
// value, closing off an avoidable open-redirect surface.
//
// Deliberately CommonJS, same reasoning as setPasswordFlow.js (which
// this module reuses `parseHashParams` from) — directly testable via
// this project's existing `node --test` tooling, no new dependency,
// interoperates fine with Next.js's ESM 'use client' page that imports
// it.

'use strict';

const { parseHashParams } = require('./setPasswordFlow');

/** The only two Supabase OTP types this page ever accepts — matches the
 * two real flows that lead here: accepting an invite, or resetting a
 * password. Any other value (or none) is treated as an invalid link,
 * never partially trusted or guessed at. */
const ALLOWED_OTP_TYPES = ['recovery', 'invite'];

/**
 * Validates an already-parsed hash-params object down to exactly
 * `{ valid: true, tokenHash, type }` or `{ valid: false }` — never
 * throws, never partially accepts a malformed or unrecognized-type link.
 */
function validateActivationParams(hashParams) {
  const params = hashParams || {};
  const tokenHash = params.token_hash;
  const type = params.type;
  if (!tokenHash || !type || !ALLOWED_OTP_TYPES.includes(type)) {
    return { valid: false };
  }
  return { valid: true, tokenHash, type };
}

/**
 * The one function the page calls on mount: parses the raw URL hash
 * string directly into a validation result. Reading and validating the
 * fragment here never calls Supabase and never creates a session —
 * `parseHashParams` is a pure string parser (already proven never to
 * throw, see setPasswordFlow.test.js) and `validateActivationParams`
 * above is a pure property check; there is no Supabase SDK call on this
 * path at all, unlike the click handler below.
 */
function parseActivationHash(hash) {
  return validateActivationParams(parseHashParams(hash));
}

/**
 * Maps any `supabase.auth.verifyOtp(...)` result to exactly one safe,
 * generic outcome — never the raw Supabase error, never a token or other
 * technical detail. `error` may be `null`/`undefined` (success) or any
 * thrown/rejected value; both are handled without inspecting *why* it
 * failed, matching this page's own "never reveal technical detail" rule.
 */
function resolveActivationOutcome(error) {
  if (!error) {
    return { ok: true };
  }
  return {
    ok: false,
    message: 'This activation link is invalid or has expired. Please request a new one.',
  };
}

/**
 * Calls `supabaseAuth.verifyOtp({ token_hash, type })` and resolves to a
 * safe outcome — **never throws, never rejects**, regardless of what the
 * underlying client does. Mirrors `detectSessionViewState`'s own
 * defensive contract in setPasswordFlow.js, added there after a real
 * production crash on the sibling page — the exact same class of failure
 * (an unhandled exception from a Supabase SDK call escaping a React
 * effect/handler and crashing the whole page) must not be reintroduced
 * here.
 */
async function performActivation(supabaseAuth, { tokenHash, type }) {
  try {
    const { error } = await supabaseAuth.verifyOtp({ token_hash: tokenHash, type });
    return resolveActivationOutcome(error);
  } catch (err) {
    return resolveActivationOutcome(err);
  }
}

module.exports = {
  ALLOWED_OTP_TYPES,
  validateActivationParams,
  parseActivationHash,
  resolveActivationOutcome,
  performActivation,
};
