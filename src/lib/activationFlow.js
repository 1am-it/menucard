// Pure decision logic for /internal/activate — the scanner-resistant
// step that must exist *before* /internal/set-password.
//
// **Replaced 2026-09-05** (link-based fragment flow → email+code flow):
// the earlier design (a link with `#token_hash=...&type=...`, verified
// only after a button click) was itself found live to be insufficient —
// a real reset link reached this page already invalid *before* the
// human could ever click "Activate account," meaning whatever
// consumed it did so by more than a passive GET (the token was only
// ever in the URL fragment, never sent to any server at all — see the
// previous version of this file's own header comment for that design).
// This version removes the link/token from the email entirely. The
// email now contains only: a plain, static, tokenless link to this page
// (nothing on it is single-use or consumable — it may be opened any
// number of times by anyone, including a scanner, with zero effect) and
// a separate, human-readable one-time code (`{{ .Token }}`) the person
// types in by hand. There is no URL for anything automated to visit or
// interact with that could ever consume the code — only a real human,
// reading the email and typing the code into this form, can.
//
// `supabase.auth.verifyOtp({ email, token, type })` is what actually
// consumes the code — a POST, and only ever called from this page's
// submit handler, after a real, explicit click.
//
// Deliberately CommonJS, same reasoning as setPasswordFlow.js —
// directly testable via this project's existing `node --test` tooling,
// no new dependency, interoperates fine with the ESM 'use client' page
// that imports it.

'use strict';

/** The only two Supabase OTP types this page ever accepts — matches the
 * two real flows that lead here: accepting an invite, or resetting a
 * password. */
const ALLOWED_OTP_TYPES = ['recovery', 'invite'];

/** Used whenever the `type` query parameter is absent or unrecognized —
 * `recovery` (a password reset) is the more common admin-facing flow,
 * and guessing wrong here is never unsafe: `verifyOtp` itself is the
 * only thing that can ever decide whether a given email+code pair is
 * genuininely valid for the attempted type. A wrong guess simply fails
 * safely at that point, exactly like any other invalid code — it never
 * grants anything. */
const DEFAULT_OTP_TYPE = 'recovery';

/**
 * Resolves which OTP type this activation attempt is for — from the
 * non-secret `type` query parameter on the fixed link each email
 * template points at (e.g. `?type=invite`), **never** from free-form
 * user input (there is no type selector in the form below). Malformed
 * input, or a value outside `ALLOWED_OTP_TYPES`, safely falls back to
 * `DEFAULT_OTP_TYPE` — never throws.
 */
function resolveActivationType(search) {
  let raw = null;
  try {
    raw = new URLSearchParams(search || '').get('type');
  } catch (err) {
    raw = null;
  }
  return ALLOWED_OTP_TYPES.includes(raw) ? raw : DEFAULT_OTP_TYPE;
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim() : '';
}

function normalizeCode(code) {
  return typeof code === 'string' ? code.trim() : '';
}

/**
 * Minimal, client-side-only sanity checks — a UX guard only, never the
 * authoritative check (`verifyOtp` is). A syntactically fine-looking
 * email and a non-empty code can still be rejected by Supabase; this
 * only avoids an obviously-empty or clearly-malformed submit.
 */
function validateActivationForm(email, code) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = normalizeCode(code);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { valid: false, reason: 'invalid-email' };
  }
  if (!normalizedCode) {
    return { valid: false, reason: 'missing-code' };
  }
  return { valid: true, email: normalizedEmail, code: normalizedCode };
}

function activationValidationMessage(reason) {
  if (reason === 'invalid-email') return 'Enter the email address the code was sent to.';
  if (reason === 'missing-code') return 'Enter the code from the email.';
  return '';
}

/**
 * Maps any `supabase.auth.verifyOtp(...)` result to exactly one safe,
 * generic outcome — never the raw Supabase error, never the code, the
 * email, or any other account/technical detail. `error` may be
 * `null`/`undefined` (success) or any thrown/rejected value; both are
 * handled without inspecting *why* it failed.
 */
function resolveActivationOutcome(error) {
  if (!error) {
    return { ok: true };
  }
  return {
    ok: false,
    message: 'That code is invalid or has expired. Please request a new one.',
  };
}

/**
 * Calls `supabaseAuth.verifyOtp({ email, token, type })` and resolves to
 * a safe outcome — **never throws, never rejects**, regardless of what
 * the underlying client does. Mirrors `detectSessionViewState`'s own
 * defensive contract in `setPasswordFlow.js`, added there after a real
 * production crash on the sibling page — the exact same class of
 * failure (an unhandled exception from a Supabase SDK call escaping a
 * React handler and crashing the whole page) must not be reintroduced
 * here.
 */
async function performActivation(supabaseAuth, { email, token, type }) {
  try {
    const { error } = await supabaseAuth.verifyOtp({ email, token, type });
    return resolveActivationOutcome(error);
  } catch (err) {
    return resolveActivationOutcome(err);
  }
}

module.exports = {
  ALLOWED_OTP_TYPES,
  DEFAULT_OTP_TYPE,
  resolveActivationType,
  normalizeEmail,
  normalizeCode,
  validateActivationForm,
  activationValidationMessage,
  resolveActivationOutcome,
  performActivation,
};
