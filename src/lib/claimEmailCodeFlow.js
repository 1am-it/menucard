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
// BE-66 (#162): de vlag staat in een eigen, piepklein bestand, zodat het
// formulier hem kan lezen zonder deze hele logica in de eerste lading te halen.
const { SMS_LOGIN_FLAG, isSmsLoginEnabled } = require('./ownerSmsLogin');

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

// ── BE-47 (#111): dezelfde flow voor restauranthouders, nu ook per sms ───────
//
// Criterion 6 of the #111 contract asks for the *same* flow module to accept
// `{ phone }` next to `{ email }`, switched on with
// `NEXT_PUBLIC_OWNER_SMS_LOGIN=1` and off by default. Keeping it here means the
// owner sign-in cannot grow a second, subtly different code flow: the e-mail
// branch below reuses this file's own validation and error translation, with
// the two owner-only differences the contract asks for:
//   - `shouldCreateUser: false`, so an unknown address never becomes an account
//     (the claim flow in this same file deliberately *does* create one);
//   - a neutral notice, identical for a known and an unknown address, so neither
//     the screen nor the timing can reveal whether the address exists.
//
// The phone branch is not "off by accident": without the flag it refuses, and
// the pages only render a phone field when `isSmsLoginEnabled` is true, so
// there is no phone field anywhere in the default build.

const OTP_TYPE_SMS = 'sms';
// At least 8 digits, an optional leading +, and spaces/dashes as people type
// them. Supabase's own check remains the real one; this only stops an
// obviously incomplete number from being sent.
const PHONE_PATTERN = /^\+?[0-9][0-9 -]{6,18}$/;

/** Dutch text for the owner sign-in screens. Never reveals whether an account exists. */
const OWNER_SIGN_IN_MESSAGES = Object.freeze({
  codeSentEmail: 'Als dit e-mailadres bij ons bekend is, ontvang je nu een code van zes cijfers.',
  codeSentPhone: 'Als dit telefoonnummer bij ons bekend is, ontvang je nu een sms met een code van zes cijfers.',
  missingPhone: 'Vul je telefoonnummer in.',
  invalidPhone: 'Vul een geldig telefoonnummer in, bijvoorbeeld +31 6 12345678.',
  smsDisabled: 'Inloggen met een telefoonnummer staat nog uit. Log in met je e-mailadres.',
});

function normalizePhone(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** A UX guard only — Supabase's own verify call remains the real check. */
function validatePhone(value) {
  const phone = normalizePhone(value);
  if (!phone) return { valid: false, reason: 'missing', message: OWNER_SIGN_IN_MESSAGES.missingPhone };
  const digits = phone.replace(/[^0-9]/g, '');
  if (!PHONE_PATTERN.test(phone) || digits.length < 8) {
    return { valid: false, reason: 'format', message: OWNER_SIGN_IN_MESSAGES.invalidPhone };
  }
  return { valid: true, phone };
}

/** `'sms'` only when the caller explicitly asks for it; e-mail stays the default. */
function signInChannel(options) {
  return options && options.channel === 'sms' ? 'sms' : 'email';
}


/**
 * Asks Supabase for a one-time code for an *existing* account, by e-mail or (only
 * with the flag on) by sms. `shouldCreateUser: false` is the contract's explicit
 * requirement: an address without an account must not silently become one.
 *
 * Returns `{ ok: true, channel, email|phone, notice }` or `{ ok: false, message }`
 * with Dutch text. Never throws.
 */
async function requestOwnerSignInCode(supabaseAuth, options) {
  const settings = options || {};
  const channel = signInChannel(settings);
  const allowPhone = settings.allowPhone === true || isSmsLoginEnabled(settings.smsLoginFlag);

  try {
    if (channel === 'sms') {
      if (!allowPhone) return { ok: false, message: OWNER_SIGN_IN_MESSAGES.smsDisabled };
      const phone = validatePhone(settings.phone);
      if (!phone.valid) return { ok: false, message: phone.message };

      const { error } = await supabaseAuth.signInWithOtp({
        phone: phone.phone,
        options: { shouldCreateUser: false },
      });
      if (error) return { ok: false, message: emailCodeMessage(error) };
      return { ok: true, channel, phone: phone.phone, notice: OWNER_SIGN_IN_MESSAGES.codeSentPhone };
    }

    const email = validateEmail(settings.email);
    if (!email.valid) return { ok: false, message: email.message };

    const { error } = await supabaseAuth.signInWithOtp({
      email: email.email,
      options: { shouldCreateUser: false },
    });
    if (error) return { ok: false, message: emailCodeMessage(error) };
    return { ok: true, channel, email: email.email, notice: OWNER_SIGN_IN_MESSAGES.codeSentEmail };
  } catch (error) {
    return { ok: false, message: emailCodeMessage(error) };
  }
}

/**
 * Verifies the six-digit code the owner received by e-mail (`type: 'email'`) or
 * by sms (`type: 'sms'`, only with the flag on) and returns the session.
 *
 * Returns `{ ok: true, session }` or `{ ok: false, message }`. Never throws.
 */
async function verifyOwnerSignInCode(supabaseAuth, options) {
  const settings = options || {};
  const channel = signInChannel(settings);
  const allowPhone = settings.allowPhone === true || isSmsLoginEnabled(settings.smsLoginFlag);

  if (channel === 'sms' && !allowPhone) return { ok: false, message: OWNER_SIGN_IN_MESSAGES.smsDisabled };

  const code = validateCode(settings.code);
  if (!code.valid) return { ok: false, message: code.message };

  let credentials;
  if (channel === 'sms') {
    const phone = validatePhone(settings.phone);
    if (!phone.valid) return { ok: false, message: phone.message };
    credentials = { phone: phone.phone, token: code.code, type: OTP_TYPE_SMS };
  } else {
    const email = validateEmail(settings.email);
    if (!email.valid) return { ok: false, message: email.message };
    credentials = { email: email.email, token: code.code, type: OTP_TYPE };
  }

  try {
    const { data, error } = await supabaseAuth.verifyOtp(credentials);
    if (error) return { ok: false, message: emailCodeMessage(error) };
    const session = data && data.session;
    if (!session || typeof session.access_token !== 'string') {
      return { ok: false, message: genericMessage() };
    }
    return { ok: true, channel, session };
  } catch (error) {
    return { ok: false, message: emailCodeMessage(error) };
  }
}

module.exports = {
  CLAIM_MESSAGES,
  CODE_LENGTH,
  OTP_TYPE,
  OTP_TYPE_SMS,
  OWNER_SIGN_IN_MESSAGES,
  PHONE_PATTERN,
  SMS_LOGIN_FLAG,
  genericMessage,
  emailCodeMessage,
  isSmsLoginEnabled,
  normalizeEmail,
  normalizePhone,
  normalizeCode,
  validateEmail,
  validatePhone,
  validateCode,
  signInChannel,
  requestEmailCode,
  verifyEmailCode,
  requestOwnerSignInCode,
  verifyOwnerSignInCode,
};
