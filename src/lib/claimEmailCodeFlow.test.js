'use strict';

// BE-48 (#112) — de claim met een code uit de e-mail, met een nep-client.
//
// De claimpagina zelf is een browsercomponent; alle beslissingen en alle
// Supabase-aanroepen zitten in src/lib/claimEmailCodeFlow.js. Deze test bewijst
// met een fictieve client dat de codeflow de juiste aanroepen doet
// (`signInWithOtp`, daarna `verifyOtp({ email, token, type: 'email' })`), dat een
// foute of verlopen code Nederlandse tekst geeft, dat de neutrale afzending geen
// foutmelding toont en dat nergens Supabase's eigen `error.message` op het scherm
// kan komen. Geen browser, geen netwerk, geen Supabase.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CLAIM_MESSAGES,
  CODE_LENGTH,
  OTP_TYPE,
  requestEmailCode,
  validateCode,
  validateEmail,
  verifyEmailCode,
} = require('./claimEmailCodeFlow');
const { MESSAGES } = require('./authErrors');

const EMAIL = 'eigenaar@example.invalid';
const CODE = '654321';

function fakeAuth(handlers) {
  const calls = [];
  const reply = handlers || {};
  return {
    calls,
    async signInWithOtp(credentials) {
      calls.push({ method: 'signInWithOtp', credentials });
      return reply.signInWithOtp ? reply.signInWithOtp(credentials) : { data: {}, error: null };
    },
    async verifyOtp(credentials) {
      calls.push({ method: 'verifyOtp', credentials });
      return reply.verifyOtp
        ? reply.verifyOtp(credentials)
        : { data: { session: { access_token: 'fixture-token' } }, error: null };
    },
  };
}

test('claimEmailCodeFlow: validateEmail rejects a missing or incomplete address', () => {
  assert.deepEqual(validateEmail(''), { valid: false, reason: 'missing', message: 'Vul je e-mailadres in.' });
  assert.equal(validateEmail('   ').reason, 'missing');
  assert.equal(validateEmail('eigenaar@').reason, 'format');
  assert.equal(validateEmail('eigenaar.example.invalid').reason, 'format');
  assert.match(validateEmail('eigenaar@').message, /geldig e-mailadres/);
  // A surrounding space is typing, not an invalid address.
  assert.deepEqual(validateEmail('  eigenaar@example.invalid  '), { valid: true, email: EMAIL });
});

test('claimEmailCodeFlow: validateCode wants exactly six digits', () => {
  assert.equal(validateCode('').reason, 'missing');
  assert.equal(validateCode('12345').reason, 'format');
  assert.equal(validateCode('1234567').reason, 'format');
  assert.equal(validateCode('12345a').reason, 'format');
  assert.match(validateCode('12345').message, new RegExp(`${CODE_LENGTH} cijfers`));
  assert.deepEqual(validateCode(' 654321 '), { valid: true, code: CODE });
});

test('claimEmailCodeFlow: requestEmailCode sends the code and keeps the link working', async () => {
  const auth = fakeAuth();
  const result = await requestEmailCode(auth, { email: ` ${EMAIL} `, redirectTo: 'https://menucard.test/claim/6' });

  assert.deepEqual(result, { ok: true, email: EMAIL });
  assert.equal(auth.calls.length, 1);
  assert.deepEqual(auth.calls[0].credentials, {
    email: EMAIL,
    options: { emailRedirectTo: 'https://menucard.test/claim/6' },
  });
});

test('claimEmailCodeFlow: requestEmailCode sends nothing for an address it cannot use', async () => {
  const auth = fakeAuth();
  const result = await requestEmailCode(auth, { email: 'geen-adres' });
  assert.equal(result.ok, false);
  assert.match(result.message, /geldig e-mailadres/);
  assert.deepEqual(auth.calls, []);
});

test('claimEmailCodeFlow: requestEmailCode omits emailRedirectTo when there is none', async () => {
  const auth = fakeAuth();
  await requestEmailCode(auth, { email: EMAIL });
  assert.deepEqual(auth.calls[0].credentials, { email: EMAIL });
});

test('claimEmailCodeFlow: an e-mail rate limit becomes the Dutch rate-limit sentence', async () => {
  const auth = fakeAuth({
    signInWithOtp: () => ({
      data: null,
      error: { code: 'over_email_send_rate_limit', status: 429, message: 'Email rate limit exceeded' },
    }),
  });
  const result = await requestEmailCode(auth, { email: EMAIL });
  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.rateLimited);
  assert.doesNotMatch(result.message, /rate limit/i);
});

test('claimEmailCodeFlow: a thrown network error is Dutch and never the raw message', async () => {
  const auth = fakeAuth({
    signInWithOtp: () => {
      throw new TypeError('Failed to fetch https://project.supabase.co/auth/v1/otp');
    },
  });
  const result = await requestEmailCode(auth, { email: EMAIL });
  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.network);
  assert.doesNotMatch(result.message, /supabase|fetch/i);
});

test('claimEmailCodeFlow: verifyEmailCode uses the e-mail OTP type and returns the session', async () => {
  const auth = fakeAuth();
  const result = await verifyEmailCode(auth, { email: EMAIL, code: ` ${CODE} ` });

  assert.equal(result.ok, true);
  assert.equal(result.session.access_token, 'fixture-token');
  assert.deepEqual(auth.calls[0], {
    method: 'verifyOtp',
    credentials: { email: EMAIL, token: CODE, type: OTP_TYPE },
  });
  assert.equal(OTP_TYPE, 'email');
});

test('claimEmailCodeFlow: the local code check sends nothing to Supabase', async () => {
  const auth = fakeAuth();
  for (const code of ['', '12', 'abcdef']) {
    const result = await verifyEmailCode(auth, { email: EMAIL, code });
    assert.equal(result.ok, false);
    assert.match(result.message, /code/i);
  }
  assert.deepEqual(auth.calls, []);
});

test('claimEmailCodeFlow: a wrong or expired code is Dutch, not the Supabase message', async () => {
  const auth = fakeAuth({
    verifyOtp: () => ({
      data: null,
      error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' },
    }),
  });
  const result = await verifyEmailCode(auth, { email: EMAIL, code: CODE });
  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.invalidEmailCode);
  assert.match(result.message, /nieuwe code/);
  assert.doesNotMatch(result.message, /token|expired/i);
});

test('claimEmailCodeFlow: a 403 without a known code is still a rejected code', async () => {
  const auth = fakeAuth({ verifyOtp: () => ({ data: null, error: { status: 403, message: 'Forbidden' } }) });
  const result = await verifyEmailCode(auth, { email: EMAIL, code: CODE });
  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.invalidEmailCode);
});

test('claimEmailCodeFlow: an unrecognised failure gets the safe default text', async () => {
  const auth = fakeAuth({
    verifyOtp: () => ({
      data: null,
      error: { code: 'unexpected_failure', status: 500, message: 'Database error saving new user' },
    }),
  });
  const result = await verifyEmailCode(auth, { email: EMAIL, code: CODE });
  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.generic);
  assert.doesNotMatch(result.message, /database/i);
});

test('claimEmailCodeFlow: a verify without a session never pretends to be signed in', async () => {
  const auth = fakeAuth({ verifyOtp: () => ({ data: {}, error: null }) });
  const result = await verifyEmailCode(auth, { email: EMAIL, code: CODE });
  assert.deepEqual(result, { ok: false, message: MESSAGES.generic });
});

test('claimEmailCodeFlow: the claim failure text is Dutch and free of API wording', () => {
  assert.match(CLAIM_MESSAGES.submitFailed, /claim/i);
  assert.doesNotMatch(CLAIM_MESSAGES.submitFailed, /failed|error/i);
});
