'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_OTP_TYPES,
  DEFAULT_OTP_TYPE,
  resolveActivationType,
  normalizeEmail,
  normalizeCode,
  validateActivationForm,
  activationValidationMessage,
  resolveActivationOutcome,
  performActivation,
} = require('./activationFlow');

// ─── resolveActivationType — from a non-secret query param, never form input ─

test('resolveActivationType: reads a valid type from the query string', () => {
  assert.deepEqual(ALLOWED_OTP_TYPES, ['recovery', 'invite']);
  assert.equal(resolveActivationType('?type=recovery'), 'recovery');
  assert.equal(resolveActivationType('?type=invite'), 'invite');
});

test('resolveActivationType: defaults to recovery when the parameter is missing', () => {
  assert.equal(DEFAULT_OTP_TYPE, 'recovery');
  assert.equal(resolveActivationType(''), 'recovery');
  assert.equal(resolveActivationType(undefined), 'recovery');
  assert.equal(resolveActivationType('?foo=bar'), 'recovery');
});

test('resolveActivationType: defaults to recovery for any unrecognized value — never partially trusted', () => {
  assert.equal(resolveActivationType('?type=signup'), 'recovery');
  assert.equal(resolveActivationType('?type=magiclink'), 'recovery');
  assert.equal(resolveActivationType('?type='), 'recovery');
});

test('resolveActivationType: never throws on malformed input', () => {
  assert.doesNotThrow(() => resolveActivationType(null));
  assert.doesNotThrow(() => resolveActivationType(42));
  assert.equal(resolveActivationType(null), 'recovery');
});

// ─── normalizeEmail / normalizeCode ────────────────────────────────────

test('normalizeEmail / normalizeCode: trim and never throw on non-string input', () => {
  assert.equal(normalizeEmail('  a@b.com  '), 'a@b.com');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeCode('  123456  '), '123456');
  assert.equal(normalizeCode(null), '');
});

// ─── validateActivationForm / activationValidationMessage ─────────────

test('validateActivationForm: accepts a syntactically fine email and a non-empty code', () => {
  const result = validateActivationForm('developer@1am-it.com', '123456');
  assert.deepEqual(result, { valid: true, email: 'developer@1am-it.com', code: '123456' });
});

test('validateActivationForm: rejects a missing or clearly-invalid email', () => {
  assert.deepEqual(validateActivationForm('', '123456'), { valid: false, reason: 'invalid-email' });
  assert.deepEqual(validateActivationForm('not-an-email', '123456'), { valid: false, reason: 'invalid-email' });
  assert.deepEqual(validateActivationForm(null, '123456'), { valid: false, reason: 'invalid-email' });
});

test('validateActivationForm: rejects a missing or whitespace-only code', () => {
  assert.deepEqual(validateActivationForm('developer@1am-it.com', ''), { valid: false, reason: 'missing-code' });
  assert.deepEqual(validateActivationForm('developer@1am-it.com', '   '), { valid: false, reason: 'missing-code' });
});

test('validateActivationForm: trims both fields before validating/returning them', () => {
  const result = validateActivationForm('  developer@1am-it.com  ', '  123456  ');
  assert.deepEqual(result, { valid: true, email: 'developer@1am-it.com', code: '123456' });
});

test('activationValidationMessage: returns a distinct, non-empty message per reason', () => {
  assert.match(activationValidationMessage('invalid-email'), /email/i);
  assert.match(activationValidationMessage('missing-code'), /code/i);
  assert.equal(activationValidationMessage('something-else'), '');
});

// ─── resolveActivationOutcome ────────────────────────────────────────

test('resolveActivationOutcome: no error is success', () => {
  assert.deepEqual(resolveActivationOutcome(null), { ok: true });
  assert.deepEqual(resolveActivationOutcome(undefined), { ok: true });
});

test('resolveActivationOutcome: any error maps to exactly one generic, safe message — never the raw error, code, or email', () => {
  const outcome = resolveActivationOutcome({
    name: 'AuthApiError',
    message: 'Token has expired or is invalid. email=developer@1am-it.com token=123456',
    status: 403,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, 'That code is invalid or has expired. Please request a new one.');
  assert.equal(outcome.message.includes('developer@1am-it.com'), false);
  assert.equal(outcome.message.includes('123456'), false);
  assert.equal(outcome.message.includes('403'), false);
});

test('resolveActivationOutcome: an error with no message/name at all still resolves safely, never throws', () => {
  assert.doesNotThrow(() => resolveActivationOutcome({}));
  const outcome = resolveActivationOutcome({});
  assert.equal(outcome.ok, false);
  assert.ok(outcome.message.length > 0);
});

// ─── performActivation — real flows, expired/invalid code, and the
// "never crash" regression guarantee ──────────────────────────────────

test('performActivation: a valid recovery code resolves ok:true', async () => {
  const fakeAuth = { verifyOtp: async () => ({ data: {}, error: null }) };
  const outcome = await performActivation(fakeAuth, { email: 'developer@1am-it.com', token: '123456', type: 'recovery' });
  assert.deepEqual(outcome, { ok: true });
});

test('performActivation: a valid invite code resolves ok:true', async () => {
  const fakeAuth = { verifyOtp: async () => ({ data: {}, error: null }) };
  const outcome = await performActivation(fakeAuth, { email: 'developer@1am-it.com', token: '654321', type: 'invite' });
  assert.deepEqual(outcome, { ok: true });
});

test('performActivation: an expired/invalid code maps to the safe generic message', async () => {
  const fakeAuth = {
    verifyOtp: async () => ({ data: null, error: { message: 'Token has expired or is invalid', status: 403 } }),
  };
  const outcome = await performActivation(fakeAuth, { email: 'developer@1am-it.com', token: '000000', type: 'recovery' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, 'That code is invalid or has expired. Please request a new one.');
});

test('performActivation: verifyOtp REJECTING (thrown inside the async function) never propagates — resolves safely instead', async () => {
  const fakeAuth = {
    verifyOtp: async () => {
      throw new Error('SecurityError: Failed to read the localStorage property from Window');
    },
  };
  await assert.doesNotReject(async () => {
    const outcome = await performActivation(fakeAuth, { email: 'developer@1am-it.com', token: '123456', type: 'recovery' });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.message, 'That code is invalid or has expired. Please request a new one.');
  });
});

test('performActivation: verifyOtp throwing SYNCHRONOUSLY (not even returning a promise) never propagates', async () => {
  const fakeAuth = {
    verifyOtp: () => {
      throw new TypeError('unexpected client failure');
    },
  };
  const outcome = await performActivation(fakeAuth, { email: 'developer@1am-it.com', token: '123456', type: 'recovery' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, 'That code is invalid or has expired. Please request a new one.');
});

test('performActivation: passes email, token, and type through to verifyOtp exactly as given', async () => {
  let capturedArgs = null;
  const fakeAuth = {
    verifyOtp: async (args) => {
      capturedArgs = args;
      return { data: {}, error: null };
    },
  };
  await performActivation(fakeAuth, { email: 'developer@1am-it.com', token: '123456', type: 'invite' });
  assert.deepEqual(capturedArgs, { email: 'developer@1am-it.com', token: '123456', type: 'invite' });
});

// ─── Structural regression: verifyOtp is only ever reachable from a
// real, explicit click — never from resolving the type, and never from
// validating the form. ────────────────────────────────────────────────

test('regression: resolving the type and validating the form never themselves call or require a Supabase client', () => {
  // resolveActivationType and validateActivationForm both take only
  // plain strings and return plain objects — there is no Supabase
  // client parameter anywhere in that path, so it is structurally
  // impossible for either to invoke verifyOtp. Only performActivation
  // ever does, and it requires an explicit auth client argument neither
  // of the other two ever has access to.
  assert.equal(resolveActivationType.length, 1, 'resolveActivationType takes only the raw query string — no auth client');
  assert.equal(validateActivationForm.length, 2, 'validateActivationForm takes only email/code — no auth client');

  const type = resolveActivationType('?type=recovery');
  const form = validateActivationForm('developer@1am-it.com', '123456');
  assert.equal(type, 'recovery');
  assert.equal(form.valid, true);
  // Nothing above could have called verifyOtp — performActivation (the
  // only function that does) was never referenced, let alone invoked.
});
