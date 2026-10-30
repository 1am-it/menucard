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
  OTP_TYPE_SMS,
  OWNER_SIGN_IN_MESSAGES,
  SMS_LOGIN_FLAG,
  isSmsLoginEnabled,
  requestEmailCode,
  requestOwnerSignInCode,
  validateCode,
  validateEmail,
  validatePhone,
  verifyEmailCode,
  verifyOwnerSignInCode,
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

// ── BE-47 (#111): dezelfde flow voor houders, met `shouldCreateUser: false` ──

const PHONE = '+31 6 12345678';

test('ownerSignIn: de vlag staat standaard uit en opent alleen op precies 1', () => {
  assert.equal(SMS_LOGIN_FLAG, 'NEXT_PUBLIC_OWNER_SMS_LOGIN');
  for (const off of [undefined, null, '', '0', 'true', 'yes', 0, false]) {
    assert.equal(isSmsLoginEnabled(off), false, `${String(off)} must leave sms off`);
  }
  assert.equal(isSmsLoginEnabled('1'), true);
  assert.equal(isSmsLoginEnabled(true), true);
});

test('ownerSignIn: validatePhone wants a plausible number and keeps the typed form', () => {
  assert.equal(validatePhone('').reason, 'missing');
  assert.equal(validatePhone('12345').reason, 'format');
  assert.equal(validatePhone('abcdefgh').reason, 'format');
  assert.match(validatePhone('12345').message, /geldig telefoonnummer/);
  assert.deepEqual(validatePhone(` ${PHONE} `), { valid: true, phone: PHONE });
});

test('ownerSignIn: the e-mail code never creates an account (shouldCreateUser: false)', async () => {
  const auth = fakeAuth();
  const result = await requestOwnerSignInCode(auth, { email: ` ${EMAIL} ` });
  assert.equal(result.ok, true);
  assert.equal(result.channel, 'email');
  assert.equal(result.email, EMAIL);
  assert.equal(result.notice, OWNER_SIGN_IN_MESSAGES.codeSentEmail);
  assert.deepEqual(auth.calls, [
    { method: 'signInWithOtp', credentials: { email: EMAIL, options: { shouldCreateUser: false } } },
  ]);
});

test('ownerSignIn: the neutral notice reveals nothing about the address', async () => {
  // The same call for a known and an unknown address: GoTrue answers 200 for
  // both, so the screen must show the same text and never "bestaat niet".
  const known = await requestOwnerSignInCode(fakeAuth(), { email: EMAIL });
  const unknown = await requestOwnerSignInCode(fakeAuth(), { email: 'onbekend@example.invalid' });
  assert.equal(known.notice, unknown.notice);
  assert.doesNotMatch(known.notice, /bestaat|onbekend|geen account/i);
  assert.match(known.notice, /als dit e-mailadres bij ons bekend is/i);
});

test('ownerSignIn: without the flag there is no phone path at all', async () => {
  const auth = fakeAuth();
  const request = await requestOwnerSignInCode(auth, { channel: 'sms', phone: PHONE });
  assert.deepEqual(request, { ok: false, message: OWNER_SIGN_IN_MESSAGES.smsDisabled });
  const verify = await verifyOwnerSignInCode(auth, { channel: 'sms', phone: PHONE, code: CODE });
  assert.deepEqual(verify, { ok: false, message: OWNER_SIGN_IN_MESSAGES.smsDisabled });
  assert.deepEqual(auth.calls, [], 'nothing may reach Supabase without the flag');
});

test('ownerSignIn: with the flag the flow sends and verifies sms with type "sms"', async () => {
  const auth = fakeAuth();
  const request = await requestOwnerSignInCode(auth, {
    channel: 'sms',
    phone: PHONE,
    smsLoginFlag: '1',
  });
  assert.equal(request.ok, true);
  assert.equal(request.channel, 'sms');
  assert.equal(request.phone, PHONE);
  assert.equal(request.notice, OWNER_SIGN_IN_MESSAGES.codeSentPhone);

  const verify = await verifyOwnerSignInCode(auth, {
    channel: 'sms',
    phone: PHONE,
    code: CODE,
    smsLoginFlag: '1',
  });
  assert.equal(verify.ok, true);
  assert.equal(verify.channel, 'sms');
  assert.equal(OTP_TYPE_SMS, 'sms');
  assert.deepEqual(auth.calls[0], {
    method: 'signInWithOtp',
    credentials: { phone: PHONE, options: { shouldCreateUser: false } },
  });
  assert.deepEqual(auth.calls[1], { method: 'verifyOtp', credentials: { phone: PHONE, token: CODE, type: 'sms' } });
});

test('ownerSignIn: a rejected code gives Dutch text, never Supabase wording', async () => {
  const auth = fakeAuth({
    verifyOtp: () => ({ data: null, error: { code: 'otp_expired', status: 403, message: 'Token has expired' } }),
  });
  const result = await verifyOwnerSignInCode(auth, { email: EMAIL, code: CODE });
  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.invalidEmailCode);
  assert.doesNotMatch(result.message, /token|expired/i);
});

test('ownerSignIn: an empty code never reaches Supabase', async () => {
  const auth = fakeAuth();
  const result = await verifyOwnerSignInCode(auth, { email: EMAIL, code: '  ' });
  assert.equal(result.ok, false);
  assert.deepEqual(auth.calls, []);
});

test('ownerSignIn: a verify without a session never pretends to be signed in', async () => {
  const auth = fakeAuth({ verifyOtp: () => ({ data: {}, error: null }) });
  const result = await verifyOwnerSignInCode(auth, { email: EMAIL, code: CODE });
  assert.deepEqual(result, { ok: false, message: MESSAGES.generic });
});

test('ownerSignIn: the claim flow keeps its own, account-creating behaviour', async () => {
  // The owner branch must not change BE-48's claim: no shouldCreateUser there.
  const auth = fakeAuth();
  await requestEmailCode(auth, { email: EMAIL });
  assert.deepEqual(auth.calls[0], { method: 'signInWithOtp', credentials: { email: EMAIL } });
});

