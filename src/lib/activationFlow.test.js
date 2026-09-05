'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_OTP_TYPES,
  validateActivationParams,
  parseActivationHash,
  resolveActivationOutcome,
  performActivation,
} = require('./activationFlow');

// ─── validateActivationParams / parseActivationHash ────────────────────

test('validateActivationParams: accepts both allowed types', () => {
  assert.deepEqual(ALLOWED_OTP_TYPES, ['recovery', 'invite']);
  assert.deepEqual(validateActivationParams({ token_hash: 'abc', type: 'recovery' }), {
    valid: true,
    tokenHash: 'abc',
    type: 'recovery',
  });
  assert.deepEqual(validateActivationParams({ token_hash: 'abc', type: 'invite' }), {
    valid: true,
    tokenHash: 'abc',
    type: 'invite',
  });
});

test('validateActivationParams: rejects a missing token_hash', () => {
  assert.deepEqual(validateActivationParams({ type: 'recovery' }), { valid: false });
  assert.deepEqual(validateActivationParams({ token_hash: '', type: 'recovery' }), { valid: false });
});

test('validateActivationParams: rejects a missing type', () => {
  assert.deepEqual(validateActivationParams({ token_hash: 'abc' }), { valid: false });
});

test('validateActivationParams: rejects any type outside the allowed list — never partially trusted', () => {
  assert.deepEqual(validateActivationParams({ token_hash: 'abc', type: 'signup' }), { valid: false });
  assert.deepEqual(validateActivationParams({ token_hash: 'abc', type: 'magiclink' }), { valid: false });
  assert.deepEqual(validateActivationParams({ token_hash: 'abc', type: 'email_change' }), { valid: false });
});

test('validateActivationParams: rejects empty/undefined input without throwing', () => {
  assert.deepEqual(validateActivationParams({}), { valid: false });
  assert.deepEqual(validateActivationParams(null), { valid: false });
  assert.deepEqual(validateActivationParams(undefined), { valid: false });
});

test('parseActivationHash: a valid recovery link hash', () => {
  const result = parseActivationHash('#token_hash=synthetic-non-secret-hash&type=recovery');
  assert.deepEqual(result, { valid: true, tokenHash: 'synthetic-non-secret-hash', type: 'recovery' });
});

test('parseActivationHash: a valid invite link hash', () => {
  const result = parseActivationHash('#token_hash=synthetic-non-secret-hash&type=invite');
  assert.deepEqual(result, { valid: true, tokenHash: 'synthetic-non-secret-hash', type: 'invite' });
});

test('parseActivationHash: an empty/missing hash is invalid, not a crash', () => {
  assert.deepEqual(parseActivationHash(''), { valid: false });
  assert.deepEqual(parseActivationHash(undefined), { valid: false });
  assert.deepEqual(parseActivationHash('#'), { valid: false });
});

test('parseActivationHash: a hash carrying an explicit Supabase error (already-consumed/expired link) is invalid', () => {
  const result = parseActivationHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.deepEqual(result, { valid: false });
});

test('parseActivationHash: ignores a redirect_to parameter entirely — never part of the validated result', () => {
  const result = parseActivationHash('#token_hash=abc&type=recovery&redirect_to=https://evil.example/phish');
  assert.deepEqual(result, { valid: true, tokenHash: 'abc', type: 'recovery' });
  assert.equal('redirectTo' in result, false);
  assert.equal('redirect_to' in result, false);
});

test('parseActivationHash: a querystring-shaped token (no leading "#") is never picked up as valid', () => {
  // Confirms this page only reads real URL-fragment key/value pairs — a
  // bare querystring fragment like "?token_hash=x&type=recovery" (no
  // leading "#", as if a token were ever mistakenly delivered as a query
  // string, which this project deliberately does not use) must not be
  // silently accepted: the leading "?" becomes part of the first key,
  // so it never matches "token_hash" exactly.
  const result = parseActivationHash('?token_hash=x&type=recovery');
  assert.deepEqual(result, { valid: false });
});

// ─── resolveActivationOutcome ────────────────────────────────────────

test('resolveActivationOutcome: no error is success', () => {
  assert.deepEqual(resolveActivationOutcome(null), { ok: true });
  assert.deepEqual(resolveActivationOutcome(undefined), { ok: true });
});

test('resolveActivationOutcome: any error maps to exactly one generic, safe message — never the raw error', () => {
  const outcome = resolveActivationOutcome({
    name: 'AuthApiError',
    message: 'Token has expired or is invalid. user_id=abc123',
    status: 403,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, 'This activation link is invalid or has expired. Please request a new one.');
  assert.equal(outcome.message.includes('abc123'), false);
  assert.equal(outcome.message.includes('403'), false);
});

test('resolveActivationOutcome: an error with no message/name at all still resolves safely, never throws', () => {
  assert.doesNotThrow(() => resolveActivationOutcome({}));
  const outcome = resolveActivationOutcome({});
  assert.equal(outcome.ok, false);
  assert.ok(outcome.message.length > 0);
});

// ─── performActivation — regression coverage: verifyOtp must never
// crash the page, whether it rejects, throws, or returns something
// unexpected. ─────────────────────────────────────────────────────────

test('performActivation: a successful verifyOtp resolves ok:true', async () => {
  const fakeAuth = { verifyOtp: async () => ({ data: {}, error: null }) };
  const outcome = await performActivation(fakeAuth, { tokenHash: 'abc', type: 'recovery' });
  assert.deepEqual(outcome, { ok: true });
});

test('performActivation: verifyOtp resolving with an error maps to the safe generic message', async () => {
  const fakeAuth = { verifyOtp: async () => ({ data: null, error: { message: 'Token has expired', status: 403 } }) };
  const outcome = await performActivation(fakeAuth, { tokenHash: 'abc', type: 'recovery' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, 'This activation link is invalid or has expired. Please request a new one.');
});

test('performActivation: verifyOtp REJECTING (thrown inside the async function) never propagates — resolves safely instead', async () => {
  const fakeAuth = {
    verifyOtp: async () => {
      throw new Error('SecurityError: Failed to read the localStorage property from Window');
    },
  };
  await assert.doesNotReject(async () => {
    const outcome = await performActivation(fakeAuth, { tokenHash: 'abc', type: 'recovery' });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.message, 'This activation link is invalid or has expired. Please request a new one.');
  });
});

test('performActivation: verifyOtp throwing SYNCHRONOUSLY (not even returning a promise) never propagates', async () => {
  const fakeAuth = {
    verifyOtp: () => {
      throw new TypeError('unexpected client failure');
    },
  };
  const outcome = await performActivation(fakeAuth, { tokenHash: 'abc', type: 'recovery' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, 'This activation link is invalid or has expired. Please request a new one.');
});

test('performActivation: passes token_hash and type through to verifyOtp exactly as given', async () => {
  let capturedArgs = null;
  const fakeAuth = {
    verifyOtp: async (args) => {
      capturedArgs = args;
      return { data: {}, error: null };
    },
  };
  await performActivation(fakeAuth, { tokenHash: 'the-token-hash', type: 'invite' });
  assert.deepEqual(capturedArgs, { token_hash: 'the-token-hash', type: 'invite' });
});
