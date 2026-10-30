'use strict';

// BE-48 (#112) — de ene vertaalfunctie voor Supabase-authfouten.
//
// Bewijst de contracteis: bekende codes, 429/rate limit, netwerkfout en een
// onbekende fout krijgen elk een Nederlandse tekst, en nergens komt de ruwe
// `error.message` van Supabase op het scherm. Fictieve foutobjecten; geen
// netwerk, geen Supabase.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { MESSAGES, classifyAuthError, authErrorMessage } = require('./authErrors');

const SECRET = 'email=developer@example.invalid token=123456 user_id=abc123';

test('authErrorMessage: no error means no message (the call succeeded)', () => {
  assert.equal(authErrorMessage(null), null);
  assert.equal(authErrorMessage(undefined), null);
  assert.equal(classifyAuthError(null), null);
});

test('authErrorMessage: wrong credentials get the contract text, never Supabase English', () => {
  const error = { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' };
  assert.equal(classifyAuthError(error), 'invalid-credentials');
  assert.equal(
    authErrorMessage(error, { context: 'signin' }),
    'E-mailadres of wachtwoord klopt niet. Controleer ze en probeer het opnieuw.',
  );
  assert.equal(authErrorMessage(error, { context: 'signin' }).includes('Invalid'), false);
});

test('authErrorMessage: an expired or wrong code names the app for a TOTP code', () => {
  const error = { name: 'AuthApiError', code: 'mfa_verification_failed', status: 422, message: 'Invalid TOTP code entered' };
  assert.equal(classifyAuthError(error), 'invalid-code');
  assert.equal(
    authErrorMessage(error, { context: 'totp' }),
    'Die code klopt niet of is verlopen. Probeer de nieuwste code uit je app.',
  );
});

test('authErrorMessage: an expired e-mail code keeps the existing activation text', () => {
  const otpExpired = { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' };
  assert.equal(authErrorMessage(otpExpired, { context: 'email-code' }), MESSAGES.invalidEmailCode);
  assert.equal(authErrorMessage(otpExpired, { context: 'email-code' }), 'Deze code is ongeldig of verlopen. Vraag een nieuwe code aan.');
  // A bare 403 without a code is the same case in practice.
  assert.equal(authErrorMessage({ status: 403, message: SECRET }, { context: 'email-code' }), MESSAGES.invalidEmailCode);
});


test('authErrorMessage: 429 and Supabase rate-limit codes get the contract text in every context', () => {
  for (const context of ['signin', 'totp', 'email-code', 'password']) {
    assert.equal(
      authErrorMessage({ status: 429, message: SECRET }, { context }),
      'Te veel pogingen. Wacht een paar minuten en probeer het opnieuw.',
    );
    assert.equal(
      authErrorMessage({ code: 'over_email_send_rate_limit', status: 429 }, { context }),
      MESSAGES.rateLimited,
    );
  }
  assert.equal(classifyAuthError({ status: 429 }), 'rate-limited');
  assert.equal(classifyAuthError({ code: 'over_request_rate_limit', status: 429 }), 'rate-limited');
});

test('authErrorMessage: a network failure is recognized and stays generic', () => {
  assert.equal(classifyAuthError(new TypeError('Failed to fetch')), 'network');
  assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError', message: SECRET }), 'network');
  assert.equal(classifyAuthError({ code: 'request_timeout', message: SECRET }), 'network');
  assert.equal(authErrorMessage({ name: 'AuthRetryableFetchError', message: SECRET }), MESSAGES.network);
});

test('authErrorMessage: a weak password and an expired session have their own safe text', () => {
  assert.equal(
    authErrorMessage({ name: 'AuthWeakPasswordError', message: 'Password should contain at least one character of each: abc, ABC, 123' }, { context: 'password' }),
    MESSAGES.weakPassword,
  );
  assert.equal(authErrorMessage({ weakPassword: { reasons: ['length'] } }, { context: 'password' }), MESSAGES.weakPassword);
  assert.equal(authErrorMessage({ name: 'AuthSessionMissingError', message: SECRET }, { context: 'password' }), MESSAGES.passwordFallback);
  assert.equal(authErrorMessage({ name: 'AuthSessionMissingError', message: SECRET }, { context: 'signin' }), MESSAGES.sessionExpired);
});

test('authErrorMessage: an unknown error gets the safe default per context', () => {
  const unknown = { name: 'AuthApiError', code: 'something_new', status: 500, message: SECRET };
  assert.equal(classifyAuthError(unknown), 'unknown');
  assert.equal(authErrorMessage(unknown, { context: 'signin' }), MESSAGES.generic);
  assert.equal(authErrorMessage(unknown, { context: 'totp' }), MESSAGES.generic);
  assert.equal(authErrorMessage(unknown, { context: 'password' }), MESSAGES.passwordFallback);
  // No context at all is allowed too.
  assert.equal(authErrorMessage(unknown), MESSAGES.generic);
  assert.equal(authErrorMessage({}), MESSAGES.generic);
});


test('authErrorMessage: no message ever contains Supabase text, the address, the code or a status', () => {
  const errors = [
    { code: 'invalid_credentials', status: 400, message: SECRET },
    { code: 'otp_expired', status: 403, message: SECRET },
    { code: 'mfa_verification_failed', status: 422, message: SECRET },
    { status: 429, message: SECRET },
    { name: 'AuthRetryableFetchError', message: SECRET },
    { name: 'AuthWeakPasswordError', message: SECRET },
    { name: 'AuthSessionMissingError', message: SECRET },
    { message: SECRET },
  ];
  const contexts = ['signin', 'totp', 'email-code', 'password'];
  for (const error of errors) {
    for (const context of contexts) {
      const message = authErrorMessage(error, { context });
      assert.equal(typeof message, 'string');
      assert.ok(message.length > 0);
      for (const leak of ['developer@example.invalid', '123456', 'abc123', 'Invalid', 'Token has expired', '429', '403']) {
        assert.equal(message.includes(leak), false, `${context}: "${message}" lekt ${leak}`);
      }
    }
  }
});

test('authErrorMessage: every message is Dutch and ends with a full stop', () => {
  for (const message of Object.values(MESSAGES)) {
    assert.match(message, /^[A-ZÀ-Ý].*\.$/);
  }
  // The English Supabase words never appear in a message.
  for (const message of Object.values(MESSAGES)) {
    assert.doesNotMatch(message, /invalid|expired|token|password should/i);
  }
});
