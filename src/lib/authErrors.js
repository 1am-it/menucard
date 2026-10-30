'use strict';

// BE-48 (#112) — één vertaalfunctie voor elke Supabase-authfout.
//
// Until now every screen decided its own text, and the internal login showed
// Supabase's own English `error.message` ("Inloggen lukte niet. Invalid login
// credentials"). The contract (criterion 5) asks for one function that turns a
// Supabase auth error into safe Dutch text, chosen by the error's own `code`,
// `status` or `name` — never by showing `error.message`, which can describe
// session/token internals or echo the entered address.
//
// The function is deliberately context-aware for one case only: a rejected
// one-time code means something different for an authenticator app
// ("Probeer de nieuwste code uit je app") than for a code in an e-mail ("Vraag
// een nieuwe code aan"). Every other message is shared.
//
// CommonJS and dependency-free, like this directory's other decision logic
// (setPasswordFlow.js, activationFlow.js): it runs directly under `node --test`
// and interoperates with the ESM pages that import it through Next.js.

/** Context names a caller can pass to `authErrorMessage`. */
const AUTH_ERROR_CONTEXT = Object.freeze({
  signin: 'signin',
  totp: 'totp',
  emailCode: 'email-code',
  password: 'password',
});

const MESSAGES = Object.freeze({
  invalidCredentials: 'E-mailadres of wachtwoord klopt niet. Controleer ze en probeer het opnieuw.',
  invalidTotpCode: 'Die code klopt niet of is verlopen. Probeer de nieuwste code uit je app.',
  invalidEmailCode: 'Deze code is ongeldig of verlopen. Vraag een nieuwe code aan.',
  rateLimited: 'Te veel pogingen. Wacht een paar minuten en probeer het opnieuw.',
  network: 'We konden de server niet bereiken. Controleer je internetverbinding en probeer het opnieuw.',
  weakPassword: 'Dat wachtwoord voldoet niet aan de eisen van deze site. Kies een ander wachtwoord.',
  sessionExpired: 'Je sessie is verlopen. Log opnieuw in.',
  passwordFallback:
    'Er ging iets mis bij het instellen van je wachtwoord. Vraag een nieuwe uitnodiging aan en probeer het opnieuw.',
  generic: 'Er ging iets mis. Probeer het opnieuw.',
});

const CREDENTIAL_CODES = Object.freeze([
  'invalid_credentials',
  'invalid_grant',
  'invalid_login_credentials',
  'invalid_password',
]);

const CODE_CODES = Object.freeze([
  'otp_expired',
  'invalid_otp',
  'otp_disabled',
  'mfa_verification_failed',
  'mfa_challenge_expired',
  'mfa_challenge_not_found',
  'invalid_totp',
  'totp_code_invalid',
]);

const RATE_LIMIT_CODES = Object.freeze([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
  'too_many_requests',
  'rate_limit_exceeded',
]);

const SESSION_EXPIRED_CODES = Object.freeze(['session_not_found', 'session_expired', 'refresh_token_not_found']);

const NETWORK_CODES = Object.freeze(['request_timeout', 'fetch_error', 'network_error']);

function codeOf(error) {
  return error && typeof error.code === 'string' ? error.code.toLowerCase() : '';
}

function isNetworkError(error) {
  const name = error && typeof error.name === 'string' ? error.name : '';
  if (name === 'AuthRetryableFetchError' || name === 'TypeError' || name === 'AbortError') return true;
  if (error && typeof TypeError === 'function' && error instanceof TypeError) return true;
  if (error && error.status === 0) return true;
  return NETWORK_CODES.includes(codeOf(error));
}

function isRateLimited(error) {
  if (!error) return false;
  if (error.status === 429) return true;
  return RATE_LIMIT_CODES.includes(codeOf(error));
}

function isWeakPassword(error) {
  if (!error) return false;
  return error.name === 'AuthWeakPasswordError' || Boolean(error.weakPassword);
}

function isSessionExpired(error) {
  if (!error) return false;
  if (error.name === 'AuthSessionMissingError') return true;
  return SESSION_EXPIRED_CODES.includes(codeOf(error));
}

/**
 * The reason behind a Supabase auth failure: `'network'`, `'rate-limited'`,
 * `'weak-password'`, `'session-expired'`, `'invalid-credentials'`,
 * `'invalid-code'`, `'unknown'`, or `null` when there was no error at all.
 *
 * Only structural fields (`code`, `status`, `name`) are used. The raw
 * `error.message` is never read, so nothing from it can reach a screen.
 */
function classifyAuthError(error) {
  if (!error) return null;
  if (isNetworkError(error)) return 'network';
  if (isRateLimited(error)) return 'rate-limited';
  if (isWeakPassword(error)) return 'weak-password';
  if (isSessionExpired(error)) return 'session-expired';

  const code = codeOf(error);
  if (CREDENTIAL_CODES.includes(code)) return 'invalid-credentials';
  if (CODE_CODES.includes(code)) return 'invalid-code';
  // Supabase answers an expired/consumed one-time token with 403. A password
  // sign-in never gets one, so the context still decides the wording below.
  if (error.status === 403) return 'invalid-code';
  return 'unknown';
}

function messageFor(reason, context) {
  switch (reason) {
    case 'network':
      return MESSAGES.network;
    case 'rate-limited':
      return MESSAGES.rateLimited;
    case 'weak-password':
      return MESSAGES.weakPassword;
    case 'session-expired':
      // On the set-password screen the caller has no usable password yet, so
      // "log opnieuw in" would be a dead end: there the actionable text (ask for
      // a new link) is the right one.
      return context === AUTH_ERROR_CONTEXT.password ? MESSAGES.passwordFallback : MESSAGES.sessionExpired;
    case 'invalid-credentials':
      return MESSAGES.invalidCredentials;
    case 'invalid-code':
      if (context === AUTH_ERROR_CONTEXT.totp) return MESSAGES.invalidTotpCode;
      if (context === AUTH_ERROR_CONTEXT.signin) return MESSAGES.invalidCredentials;
      return MESSAGES.invalidEmailCode;
    default:
      return context === AUTH_ERROR_CONTEXT.password ? MESSAGES.passwordFallback : MESSAGES.generic;
  }
}

/**
 * Dutch text for a Supabase auth failure. Returns `null` when there was no
 * error (the call succeeded), and a safe default text for anything it does not
 * recognize — never Supabase's own message.
 *
 * `context` picks the wording for a rejected one-time code and the fallback:
 * `'signin'`, `'totp'`, `'email-code'` or `'password'`.
 */
function authErrorMessage(error, options) {
  const reason = classifyAuthError(error);
  if (!reason) return null;
  const context = options && typeof options.context === 'string' ? options.context : AUTH_ERROR_CONTEXT.signin;
  return messageFor(reason, context);
}

module.exports = {
  AUTH_ERROR_CONTEXT,
  MESSAGES,
  classifyAuthError,
  authErrorMessage,
};
