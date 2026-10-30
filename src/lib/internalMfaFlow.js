'use strict';

// BE-48 (#112) — the second-step decisions of the internal login.
//
// The login page only wires DOM and Supabase calls; every decision lives here,
// so it is unit-tested with a fictional client and without a browser:
//
//  - which screen comes after the password: no verified factor → "Beveilig je
//    account met een app" (enrol), a verified factor → "Code uit je app"
//    (challenge + verify), an already `aal2` session → straight on;
//  - whether the account actually needs the second step at all: an `internal`
//    or `editor` account does, an `owner`-only account does not (it gets its
//    own route in BE-47 / #111). The answer comes from the existing read-only
//    `/api/internal/v1/me`, which returns the same 403 the API guard returns —
//    no new endpoint was added;
//  - every failure becomes a Dutch sentence through src/lib/authErrors.js and
//    never the raw `error.message`; nothing here throws or rejects.
//
// "Dit apparaat 30 dagen onthouden" is deliberately absent: Supabase does not
// offer a safe, supported way to remember a device for a set number of days, so
// the option is left out instead of being faked.

const { MESSAGES, authErrorMessage } = require('./authErrors');
const { SECOND_FACTOR_REASON, rolesRequireSecondFactor } = require('./internalAuthCore');

const TOTP = 'totp';
const ME_API = '/api/internal/v1/me';
const CODE_LENGTH = 6;

function genericMessage() {
  return MESSAGES.generic;
}

function codeMessage(error) {
  return authErrorMessage(error, { context: 'totp' }) || genericMessage();
}

async function readJson(res) {
  try {
    return await res.json();
  } catch (error) {
    return null;
  }
}

// ─── pure decisions ────────────────────────────────────────────────────────

/** A factor is usable for the code screen only when it is a verified TOTP. */
function isVerifiedTotpFactor(factor) {
  if (!factor || typeof factor !== 'object') return false;
  const type = factor.factor_type || factor.type;
  return type === TOTP && factor.status === 'verified' && typeof factor.id === 'string' && factor.id.length > 0;
}

/**
 * The id of the first verified TOTP factor, looking through every given source
 * (a `user.factors` array, or a `listFactors()` result with `all`/`totp`).
 * Returns `null` when nothing usable is present.
 */
function pickTotpFactorId(...sources) {
  for (const source of sources) {
    const list = Array.isArray(source) ? source : source && Array.isArray(source.all) ? source.all : null;
    if (!list) continue;
    const found = list.find(isVerifiedTotpFactor);
    if (found) return found.id;
  }
  return null;
}

/**
 * What the login page shows after a correct password.
 *
 * - `'done'`        — nothing more to ask (already `aal2`, or no second step for
 *                     this account);
 * - `'challenge'`   — a verified factor exists: ask for the code from the app;
 * - `'enroll'`      — the account needs the second step but has no verified
 *                     factor yet: link an app first;
 * - `'unavailable'` — Supabase says a factor exists but its id cannot be read;
 *                     the page shows the safe error instead of guessing.
 */
function decideMfaStep({ currentLevel, nextLevel, factorId, secondFactorRequired } = {}) {
  if (currentLevel === 'aal2') return { step: 'done' };
  if (nextLevel === 'aal2') {
    return factorId ? { step: 'challenge', factorId } : { step: 'unavailable' };
  }
  if (secondFactorRequired === true) return { step: 'enroll' };
  return { step: 'done' };
}

/** Trims the typed code; digits only, as every authenticator app shows it. */
function normalizeCode(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** A UX guard only — Supabase's verify call remains the real check. */
function validateCode(value) {
  const code = normalizeCode(value);
  if (!code) return { valid: false, reason: 'missing' };
  if (!new RegExp(`^[0-9]{${CODE_LENGTH}}$`).test(code)) return { valid: false, reason: 'format' };
  return { valid: true, code };
}

function codeValidationMessage(reason) {
  if (reason === 'missing') return 'Vul de code uit je app in.';
  if (reason === 'format') return `De code bestaat uit ${CODE_LENGTH} cijfers.`;
  return '';
}


// ─── Supabase calls, never throwing ─────────────────────────────────────────

/** The current and next assurance level of this session. */
async function readAssuranceLevels(supabaseAuth) {
  try {
    const { data, error } = await supabaseAuth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return { ok: false, currentLevel: null, nextLevel: null };
    return {
      ok: true,
      currentLevel: typeof data.currentLevel === 'string' ? data.currentLevel : null,
      nextLevel: typeof data.nextLevel === 'string' ? data.nextLevel : null,
    };
  } catch (error) {
    return { ok: false, currentLevel: null, nextLevel: null };
  }
}

/**
 * The verified TOTP factor id, first from what the sign-in response already
 * told us, then from `mfa.listFactors()`. `null` when unknown.
 */
async function readVerifiedFactorId(supabaseAuth, ...sources) {
  const known = pickTotpFactorId(...sources);
  if (known) return known;
  try {
    const { data, error } = await supabaseAuth.mfa.listFactors();
    if (error || !data) return null;
    return pickTotpFactorId(data.totp, data.all);
  } catch (error) {
    return null;
  }
}


/**
 * Whether this account needs the second step, read from the existing
 * `/api/internal/v1/me`:
 * `required: true` (an internal/editor account still on aal1),
 * `required: false` (an owner-only account, or an account without staff roles),
 * `required: null` when the answer could not be read.
 *
 * `null` is never treated as "no second step" by the server: the API guard
 * refuses an internal/editor token on aal1 regardless of what this screen
 * decided, so an unreadable answer can only change the screen, never access.
 */
async function readSecondFactorRequirement({ accessToken, fetchImpl } = {}) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : typeof fetch === 'function' ? fetch : null;
  if (!accessToken || !doFetch) return { required: null, roles: null, status: null };
  try {
    const res = await doFetch(ME_API, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (res && res.ok) {
      const data = await readJson(res);
      const roles = data && Array.isArray(data.roles) ? data.roles : null;
      if (!roles) return { required: null, roles: null, status: res.status };
      return { required: rolesRequireSecondFactor(roles), roles, status: res.status };
    }
    if (res && res.status === 403) {
      const data = await readJson(res);
      if (data && data.reason === SECOND_FACTOR_REASON) return { required: true, roles: null, status: 403 };
      return { required: false, roles: [], status: 403 };
    }
    return { required: null, roles: null, status: res ? res.status : null };
  } catch (error) {
    return { required: null, roles: null, status: null };
  }
}

/**
 * Starts linking an authenticator app: the QR code (`data.totp.qr_code`, already
 * a data URL) and the manual key (`data.totp.secret`) both stay in the browser.
 */
async function startEnrollment(supabaseAuth) {
  if (!supabaseAuth || !supabaseAuth.mfa || typeof supabaseAuth.mfa.enroll !== 'function') {
    return { ok: false, message: genericMessage() };
  }
  try {
    const { data, error } = await supabaseAuth.mfa.enroll({ factorType: TOTP, friendlyName: 'Menucard' });
    if (error || !data || typeof data.id !== 'string' || data.id.length === 0) {
      return { ok: false, message: codeMessage(error) };
    }
    const totp = data.totp && typeof data.totp === 'object' ? data.totp : {};
    return {
      ok: true,
      factorId: data.id,
      qrCode: typeof totp.qr_code === 'string' && totp.qr_code.length > 0 ? totp.qr_code : null,
      secret: typeof totp.secret === 'string' && totp.secret.length > 0 ? totp.secret : null,
    };
  } catch (error) {
    return { ok: false, message: codeMessage(error) };
  }
}

/** Starts the challenge for an existing verified factor. */
async function startChallenge(supabaseAuth, factorId) {
  if (!supabaseAuth || !supabaseAuth.mfa || typeof supabaseAuth.mfa.challenge !== 'function' || !factorId) {
    return { ok: false, challengeId: null, message: genericMessage() };
  }
  try {
    const { data, error } = await supabaseAuth.mfa.challenge({ factorId });
    if (error || !data || typeof data.id !== 'string' || data.id.length === 0) {
      return { ok: false, challengeId: null, message: codeMessage(error) };
    }
    return { ok: true, challengeId: data.id };
  } catch (error) {
    return { ok: false, challengeId: null, message: codeMessage(error) };
  }
}

/**
 * Verifies the typed code against the challenge. On success Supabase has
 * already replaced the session with an `aal2` one, so the caller can continue
 * with the fresh access token.
 */
async function verifyCode(supabaseAuth, { factorId, challengeId, code } = {}) {
  const validation = validateCode(code);
  if (!validation.valid) {
    return { ok: false, message: codeValidationMessage(validation.reason) };
  }
  if (!supabaseAuth || !supabaseAuth.mfa || typeof supabaseAuth.mfa.verify !== 'function' || !factorId || !challengeId) {
    return { ok: false, message: genericMessage() };
  }
  try {
    const { error } = await supabaseAuth.mfa.verify({ factorId, challengeId, code: validation.code });
    if (error) return { ok: false, message: codeMessage(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: codeMessage(error) };
  }
}

/** The access token of the (possibly just upgraded) session, or `null`. */
async function readAccessToken(supabaseAuth) {
  try {
    const { data } = await supabaseAuth.getSession();
    const token = data && data.session && data.session.access_token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  TOTP,
  ME_API,
  CODE_LENGTH,
  genericMessage,
  isVerifiedTotpFactor,
  pickTotpFactorId,
  decideMfaStep,
  normalizeCode,
  validateCode,
  codeValidationMessage,
  readAssuranceLevels,
  readVerifiedFactorId,
  readSecondFactorRequirement,
  startEnrollment,
  startChallenge,
  verifyCode,
  readAccessToken,
};
