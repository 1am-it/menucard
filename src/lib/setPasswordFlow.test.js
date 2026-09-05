'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_PASSWORD_LENGTH,
  parseHashParams,
  hasAuthErrorInHash,
  hashLooksLikeAuthLink,
  determineInitialViewState,
  validateNewPassword,
  passwordValidationMessage,
  resolveUpdatePasswordOutcome,
} = require('./setPasswordFlow');

// ─── parseHashParams ────────────────────────────────────────────────────

test('parseHashParams: empty/missing hash never throws, returns {}', () => {
  assert.deepEqual(parseHashParams(''), {});
  assert.deepEqual(parseHashParams('#'), {});
  assert.deepEqual(parseHashParams(undefined), {});
  assert.deepEqual(parseHashParams(null), {});
});

test('parseHashParams: parses a real Supabase recovery-link hash', () => {
  const hash = '#access_token=abc.def.ghi&expires_in=3600&refresh_token=xyz&token_type=bearer&type=recovery';
  const parsed = parseHashParams(hash);
  assert.equal(parsed.access_token, 'abc.def.ghi');
  assert.equal(parsed.type, 'recovery');
  assert.equal(parsed.token_type, 'bearer');
});

test('parseHashParams: parses a real Supabase error hash (expired/used link)', () => {
  const hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  const parsed = parseHashParams(hash);
  assert.equal(parsed.error, 'access_denied');
  assert.equal(parsed.error_code, 'otp_expired');
  assert.equal(parsed.error_description, 'Email link is invalid or has expired');
});

test('parseHashParams: tolerates malformed percent-encoding without throwing', () => {
  assert.doesNotThrow(() => parseHashParams('#error_description=%E0%A4%A'));
});

// ─── hasAuthErrorInHash / hashLooksLikeAuthLink ────────────────────────

test('hasAuthErrorInHash', () => {
  assert.equal(hasAuthErrorInHash({}), false);
  assert.equal(hasAuthErrorInHash({ error: 'access_denied' }), true);
  assert.equal(hasAuthErrorInHash(null), false);
});

test('hashLooksLikeAuthLink', () => {
  assert.equal(hashLooksLikeAuthLink({}), false);
  assert.equal(hashLooksLikeAuthLink({ access_token: 'x' }), true);
  assert.equal(hashLooksLikeAuthLink({ type: 'invite' }), true);
  assert.equal(hashLooksLikeAuthLink({ token_hash: 'x' }), true);
  assert.equal(hashLooksLikeAuthLink(null), false);
});

// ─── determineInitialViewState ─────────────────────────────────────────

test('determineInitialViewState: an error in the hash is always invalid, even with a session', () => {
  assert.equal(determineInitialViewState({ hashParams: { error: 'access_denied' }, hasSession: true }), 'invalid');
  assert.equal(determineInitialViewState({ hashParams: { error: 'access_denied' }, hasSession: false }), 'invalid');
});

test('determineInitialViewState: a real session with no error is ready', () => {
  assert.equal(determineInitialViewState({ hashParams: { access_token: 'x', type: 'recovery' }, hasSession: true }), 'ready');
  assert.equal(determineInitialViewState({ hashParams: {}, hasSession: true }), 'ready');
});

test('determineInitialViewState: a link-shaped hash with no session yet is checking, not invalid', () => {
  assert.equal(determineInitialViewState({ hashParams: { access_token: 'x', type: 'recovery' }, hasSession: false }), 'checking');
  assert.equal(determineInitialViewState({ hashParams: { type: 'invite' }, hasSession: false }), 'checking');
});

test('determineInitialViewState: no hash and no session (a bare visit) is invalid, never an indefinite spinner', () => {
  assert.equal(determineInitialViewState({ hashParams: {}, hasSession: false }), 'invalid');
  assert.equal(determineInitialViewState({ hashParams: undefined, hasSession: false }), 'invalid');
});

// ─── validateNewPassword / passwordValidationMessage ──────────────────

test('validateNewPassword: rejects a too-short password', () => {
  const result = validateNewPassword('short1', 'short1');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'too-short');
  assert.match(passwordValidationMessage(result.reason), new RegExp(String(MIN_PASSWORD_LENGTH)));
});

test('validateNewPassword: rejects empty password', () => {
  const result = validateNewPassword('', '');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'too-short');
});

test('validateNewPassword: rejects a mismatched confirmation', () => {
  const result = validateNewPassword('longenough1', 'longenough2');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'mismatch');
  assert.equal(passwordValidationMessage(result.reason), 'Passwords do not match.');
});

test('validateNewPassword: accepts a long-enough, matching password', () => {
  const result = validateNewPassword('longenough1', 'longenough1');
  assert.equal(result.valid, true);
  assert.equal(result.reason, null);
});

test('validateNewPassword: exactly MIN_PASSWORD_LENGTH characters is accepted', () => {
  const pw = 'a'.repeat(MIN_PASSWORD_LENGTH);
  const result = validateNewPassword(pw, pw);
  assert.equal(result.valid, true);
});

test('validateNewPassword: one character under MIN_PASSWORD_LENGTH is rejected', () => {
  const pw = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
  const result = validateNewPassword(pw, pw);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'too-short');
});

// ─── resolveUpdatePasswordOutcome (server-side error handling) ────────

test('resolveUpdatePasswordOutcome: no error is a clean success', () => {
  assert.deepEqual(resolveUpdatePasswordOutcome(null), { ok: true });
  assert.deepEqual(resolveUpdatePasswordOutcome(undefined), { ok: true });
});

test('resolveUpdatePasswordOutcome: a weak-password error maps to a specific, still-safe message', () => {
  const outcome = resolveUpdatePasswordOutcome({ name: 'AuthWeakPasswordError', message: 'Password should contain at least one character of each: abc, ABC, 123' });
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /requirements/);
  // Never leaks Supabase's own raw message.
  assert.equal(outcome.message.includes('ABC'), false);
});

test('resolveUpdatePasswordOutcome: a weakPassword field (without the exact error name) is also recognized', () => {
  const outcome = resolveUpdatePasswordOutcome({ message: 'Some wrapper', weakPassword: { reasons: ['length'] } });
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /requirements/);
});

test('resolveUpdatePasswordOutcome: any other error maps to one fully generic message, never the raw error text', () => {
  const outcome = resolveUpdatePasswordOutcome({ name: 'AuthSessionMissingError', message: 'Auth session missing! user_id=abc123 token=deadbeef', status: 401 });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message.includes('deadbeef'), false);
  assert.equal(outcome.message.includes('abc123'), false);
  assert.equal(outcome.message.includes('401'), false);
  assert.equal(outcome.message, 'Something went wrong setting your password. Please request a new invitation link and try again.');
});

test('resolveUpdatePasswordOutcome: an error with no message/name at all still gets the generic message, never throws', () => {
  assert.doesNotThrow(() => resolveUpdatePasswordOutcome({}));
  const outcome = resolveUpdatePasswordOutcome({});
  assert.equal(outcome.ok, false);
  assert.ok(outcome.message.length > 0);
});
