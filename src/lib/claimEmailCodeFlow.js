'use strict';

// BE-48 (#112) — claiming a restaurant with a six-digit code from the e-mail.
//
// The claim page used to send a magic link only. A link breaks when a
// restaurant's virus scanner opens it first, and when the mail is read on a
// different device than the site. `app/claim/[restaurantId]/ClaimView.js`
// therefore asks Supabase for a code (`signInWithOtp`) and verifies it
// (`verifyOtp({ email, token, type: 'email' })`); the link keeps working in the
// same mail until the owner retires it (release plan, step 1).
//
// Like src/lib/internalMfaFlow.js, every decision and every Supabase call lives
// here so it can be unit-tested with a fictional client and without a browser.
// Nothing here throws or rejects: each function returns `{ ok, ... }` with Dutch
// text from src/lib/authErrors.js, never Supabase's own `error.message`.

const { MESSAGES, authErrorMessage } = require('./authErrors');

const CODE_LENGTH = 6;
// GoTrue verifies both a signup and a magic-link token with type 'email'.
const OTP_TYPE = 'email';
// Deliberately simple: the real check stays Supabase's. This only stops an
// obviously incomplete address from being sent.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Dutch text for the one claim failure that is not an auth error. */
const CLAIM_MESSAGES = Object.freeze({
  submitFailed: 'De claim kon niet worden verstuurd. Probeer het opnieuw.',
});

function genericMessage() {
  return MESSAGES.generic;
}

function emailCodeMessage(error) {
  return authErrorMessage(error, { context: 'email-code' }) || genericMessage();
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** A UX guard only — `requestEmailCode` sends nothing when this fails. */
function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return { valid: false, reason: 'missing', message: 'Vul je e-mailadres in.' };
  if (!EMAIL_PATTERN.test(email)) {
    return { valid: false, reason: 'format', message: 'Vul een geldig e-mailadres in, bijvoorbeeld naam@restaurant.nl.' };
  }
  return { valid: true, email };
}

/** Trims the typed code; it is always six digits from the e-mail. */
function normalizeCode(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** A UX guard only — Supabase's verify call remains the real check. */
function validateCode(value) {
  const code = normalizeCode(value);
  if (!code) return { valid: false, reason: 'missing', message: 'Vul de code uit de e-mail in.' };
  if (!new RegExp(`^[0-9]{${CODE_LENGTH}}$`).test(code)) {
    return { valid: false, reason: 'format', message: `De code bestaat uit ${CODE_LENGTH} cijfers.` };
  }
  return { valid: true, code };
}

/**
 * Asks Supabase to e-mail a one-time code (the same call also mails the link
 * while `emailRedirectTo` is set).
 *
 * Returns `{ ok: true, email }` with the trimmed address, or
 * `{ ok: false, message }` with Dutch text. Never throws.
 */
async function requestEmailCode(supabaseAuth, options) {
  const settings = options || {};
  const validation = validateEmail(settings.email);
  if (!validation.valid) return { ok: false, message: validation.message };

  const credentials = { email: validation.email };
  if (typeof settings.redirectTo === 'string' && settings.redirectTo) {
    // Kept on purpose: the link in the mail must keep working for now.
    credentials.options = { emailRedirectTo: settings.redirectTo };
  }

  try {
    const { error } = await supabaseAuth.signInWithOtp(credentials);
    if (error) return { ok: false, message: emailCodeMessage(error) };
    return { ok: true, email: validation.email };
  } catch (error) {
    return { ok: false, message: emailCodeMessage(error) };
  }
}

/**
 * Verifies the six-digit code and returns the resulting session, which the page
 * then uses exactly like a session from the magic link.
 *
 * Returns `{ ok: true, session }` or `{ ok: false, message }`. Never throws.
 */
async function verifyEmailCode(supabaseAuth, options) {
  const settings = options || {};
  const email = validateEmail(settings.email);
  if (!email.valid) return { ok: false, message: email.message };
  const code = validateCode(settings.code);
  if (!code.valid) return { ok: false, message: code.message };

  try {
    const { data, error } = await supabaseAuth.verifyOtp({
      email: email.email,
      token: code.code,
      type: OTP_TYPE,
    });
    if (error) return { ok: false, message: emailCodeMessage(error) };
    const session = data && data.session;
    if (!session || typeof session.access_token !== 'string') {
      return { ok: false, message: genericMessage() };
    }
    return { ok: true, session };
  } catch (error) {
    return { ok: false, message: emailCodeMessage(error) };
  }
}

module.exports = {
  CLAIM_MESSAGES,
  CODE_LENGTH,
  OTP_TYPE,
  genericMessage,
  emailCodeMessage,
  normalizeEmail,
  normalizeCode,
  validateEmail,
  validateCode,
  requestEmailCode,
  verifyEmailCode,
};
