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

// ─── Regression (2026-09-05): /internal/activate showed "invalid or has
// expired" immediately, before any click, for a real password-reset
// link whose fragment was a syntactically valid
// #token_hash=...&type=recovery. Root cause: parseHashParams
// (setPasswordFlow.js, reused here) did not trim whitespace/newlines
// around a parsed key or value — a stray one (plausible from a
// hand-edited email template's href line-wrapping) silently broke the
// exact "token_hash"/"recovery" match. Reproduced and fixed using only
// synthetic, non-secret values — never the real, exposed link. ────────

test('parseActivationHash (regression): a valid recovery fragment is accepted with no pre-click error, even with corrupting whitespace present', () => {
  // Every variant below must be exactly as valid as a perfectly clean
  // fragment — this is the actual bug: it wasn't.
  const variants = [
    '#token_hash=synthetic-non-secret-hash&type=recovery',
    '# token_hash=synthetic-non-secret-hash&type=recovery',
    '#token_hash=synthetic-non-secret-hash&type=recovery\n',
    '#\ntoken_hash=synthetic-non-secret-hash&type=recovery',
  ];
  for (const hash of variants) {
    const result = parseActivationHash(hash);
    assert.deepEqual(
      result,
      { valid: true, tokenHash: 'synthetic-non-secret-hash', type: 'recovery' },
      `expected a valid recovery link for ${JSON.stringify(hash)}`
    );
  }
});

test('parseActivationHash (regression): a valid invite fragment is accepted with no pre-click error, even with corrupting whitespace present', () => {
  const variants = [
    '#token_hash=synthetic-non-secret-hash&type=invite',
    '#token_hash=synthetic-non-secret-hash &type=invite',
    '#token_hash=synthetic-non-secret-hash&type=invite\n',
  ];
  for (const hash of variants) {
    const result = parseActivationHash(hash);
    assert.deepEqual(
      result,
      { valid: true, tokenHash: 'synthetic-non-secret-hash', type: 'invite' },
      `expected a valid invite link for ${JSON.stringify(hash)}`
    );
  }
});

test('parseActivationHash (regression): missing/unrecognized parameters still correctly show the safe "invalid" outcome — the fix did not make validation too lenient', () => {
  assert.deepEqual(parseActivationHash('#type=recovery'), { valid: false }); // no token_hash
  assert.deepEqual(parseActivationHash('#token_hash=abc123'), { valid: false }); // no type
  assert.deepEqual(parseActivationHash('#token_hash=abc123&type=signup'), { valid: false }); // disallowed type
  assert.deepEqual(parseActivationHash('#error=access_denied&error_code=otp_expired'), { valid: false }); // real expired-link shape
  assert.deepEqual(parseActivationHash(''), { valid: false }); // bare visit
});

test('regression: reaching a valid "ready" result never itself calls or requires a Supabase client — verifyOtp is only reachable from a click', () => {
  // parseActivationHash's whole call chain (parseHashParams ->
  // validateActivationParams) takes only a string and returns a plain
  // object — there is no Supabase client parameter anywhere in that
  // path, so it is structurally impossible for parsing/validating the
  // fragment to invoke verifyOtp. Only performActivation ever does, and
  // it requires an explicit auth client argument that the mount-time
  // parse path never has access to.
  assert.equal(parseActivationHash.length, 1, 'parseActivationHash takes only the raw hash string — no auth client');
  assert.equal(validateActivationParams.length, 1, 'validateActivationParams takes only parsed params — no auth client');

  const result = parseActivationHash('#token_hash=synthetic-non-secret-hash&type=recovery');
  assert.equal(result.valid, true);
  // Nothing above could have called verifyOtp — performActivation (the
  // only function that does) was never referenced, let alone invoked.
});
