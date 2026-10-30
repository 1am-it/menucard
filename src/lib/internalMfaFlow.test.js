'use strict';

// BE-48 (#112) — de stapkeuze na het wachtwoord en de MFA-aanroepen.
//
// De contracteis: de stapkeuze is een pure functie (geen factor → koppelen,
// factor → code, aal2 → door), de aanroepen verdragen elke fout zonder te
// crashen, en elke melding is Nederlands — nooit `error.message` van Supabase.
// Alles met een fictieve client; geen Supabase, geen netwerk, geen browser.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { MESSAGES } = require('./authErrors');
const { ME_API } = require('./internalMfaFlow');
const {
  decideMfaStep,
  pickTotpFactorId,
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
} = require('./internalMfaFlow');

const VERIFIED_TOTP = { id: 'factor-1', factor_type: 'totp', status: 'verified' };

function fakeAuth({ assurance, factors, enroll, challenge, verify, session } = {}) {
  const calls = [];
  return {
    calls,
    mfa: {
      getAuthenticatorAssuranceLevel: async () => {
        calls.push('assurance');
        if (assurance instanceof Error) throw assurance;
        return assurance === undefined
          ? { data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null }
          : assurance;
      },
      listFactors: async () => {
        calls.push('listFactors');
        if (factors instanceof Error) throw factors;
        return factors === undefined ? { data: { all: [VERIFIED_TOTP], totp: [VERIFIED_TOTP] }, error: null } : factors;
      },
      enroll: async (args) => {
        calls.push({ enroll: args });
        if (enroll instanceof Error) throw enroll;
        return enroll === undefined
          ? { data: { id: 'factor-new', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCDEF123456' } }, error: null }
          : enroll;
      },
      challenge: async (args) => {
        calls.push({ challenge: args });
        if (challenge instanceof Error) throw challenge;
        return challenge === undefined ? { data: { id: 'challenge-1' }, error: null } : challenge;
      },
      verify: async (args) => {
        calls.push({ verify: args });
        if (verify instanceof Error) throw verify;
        return verify === undefined ? { data: { access_token: 'aal2-token' }, error: null } : verify;
      },
    },
    getSession: async () => {
      calls.push('getSession');
      if (session instanceof Error) throw session;
      return session === undefined ? { data: { session: { access_token: 'aal2-token' } }, error: null } : session;
    },
  };
}

function fakeFetch(status, body) {
  const calls = [];
  return {
    calls,
    impl: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  };
}


// ─── pure stapkeuze ────────────────────────────────────────────────────────

test('decideMfaStep: an account without a factor links an app first', () => {
  assert.deepEqual(
    decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal1', factorId: null, secondFactorRequired: true }),
    { step: 'enroll' },
  );
});

test('decideMfaStep: an account with a verified factor asks for the code', () => {
  assert.deepEqual(
    decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2', factorId: 'factor-1', secondFactorRequired: true }),
    { step: 'challenge', factorId: 'factor-1' },
  );
});

test('decideMfaStep: an aal2 session goes straight on', () => {
  assert.deepEqual(decideMfaStep({ currentLevel: 'aal2', nextLevel: 'aal2', factorId: 'factor-1' }), { step: 'done' });
  assert.deepEqual(decideMfaStep({ currentLevel: 'aal2', nextLevel: null }), { step: 'done' });
});

test('decideMfaStep: an owner-only account (no second step required) goes straight on', () => {
  assert.deepEqual(
    decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal1', factorId: null, secondFactorRequired: false }),
    { step: 'done' },
  );
  // An unreadable answer never invents a screen; the server still enforces.
  assert.deepEqual(
    decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal1', factorId: null, secondFactorRequired: null }),
    { step: 'done' },
  );
  assert.deepEqual(decideMfaStep(), { step: 'done' });
});

test('decideMfaStep: a factor that cannot be identified is an error screen, never a silent skip', () => {
  assert.deepEqual(decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2', factorId: null }), { step: 'unavailable' });
});

test('pickTotpFactorId: only a verified TOTP factor is usable', () => {
  assert.equal(pickTotpFactorId([VERIFIED_TOTP]), 'factor-1');
  assert.equal(pickTotpFactorId({ all: [VERIFIED_TOTP], totp: [VERIFIED_TOTP] }), 'factor-1');
  assert.equal(pickTotpFactorId([{ id: 'u', factor_type: 'totp', status: 'unverified' }]), null);
  assert.equal(pickTotpFactorId([{ id: 'p', factor_type: 'phone', status: 'verified' }]), null);
  assert.equal(pickTotpFactorId([{ factor_type: 'totp', status: 'verified' }]), null);
  assert.equal(pickTotpFactorId(null, undefined, [], {}), null);
  // The first usable factor wins, whatever source it came from.
  assert.equal(pickTotpFactorId(null, [{ id: 'second', type: 'totp', status: 'verified' }]), 'second');
});

test('validateCode: six digits, nothing else', () => {
  assert.deepEqual(validateCode(' 123456 '), { valid: true, code: '123456' });
  assert.deepEqual(validateCode('12345'), { valid: false, reason: 'format' });
  assert.deepEqual(validateCode('1234567'), { valid: false, reason: 'format' });
  assert.deepEqual(validateCode('12345a'), { valid: false, reason: 'format' });
  assert.deepEqual(validateCode(''), { valid: false, reason: 'missing' });
  assert.deepEqual(validateCode(null), { valid: false, reason: 'missing' });
  assert.equal(normalizeCode(' 000000 '), '000000');
  assert.match(codeValidationMessage('missing'), /code/i);
  assert.match(codeValidationMessage('format'), /6 cijfers/);
});


// ─── de aanroepen met een fictieve client ──────────────────────────────────

test('readAssuranceLevels: reads both levels, and degrades safely on an error or a throw', async () => {
  assert.deepEqual(await readAssuranceLevels(fakeAuth()), { ok: true, currentLevel: 'aal1', nextLevel: 'aal2' });
  assert.deepEqual(await readAssuranceLevels(fakeAuth({ assurance: { data: null, error: { status: 500 } } })), {
    ok: false,
    currentLevel: null,
    nextLevel: null,
  });
  assert.deepEqual(await readAssuranceLevels(fakeAuth({ assurance: new Error('network down') })), {
    ok: false,
    currentLevel: null,
    nextLevel: null,
  });
  assert.deepEqual(await readAssuranceLevels(undefined), { ok: false, currentLevel: null, nextLevel: null });
});

test('readVerifiedFactorId: prefers the sign-in factors, falls back to listFactors', async () => {
  const withUserFactors = fakeAuth();
  assert.equal(await readVerifiedFactorId(withUserFactors, [{ id: 'from-user', factor_type: 'totp', status: 'verified' }]), 'from-user');
  assert.deepEqual(withUserFactors.calls, [], 'no extra call when the sign-in response already had it');

  const withoutFactors = fakeAuth();
  assert.equal(await readVerifiedFactorId(withoutFactors, undefined), 'factor-1');
  assert.deepEqual(withoutFactors.calls, ['listFactors']);

  const failing = fakeAuth({ factors: new Error('boom') });
  assert.equal(await readVerifiedFactorId(failing), null);
});

test('readSecondFactorRequirement: the /me answer decides, and never invents one', async () => {
  const required = fakeFetch(403, { error: 'Tweede inlogstap vereist', reason: 'aal2_required' });
  const first = await readSecondFactorRequirement({ accessToken: 'aal1-token', fetchImpl: required.impl });
  assert.deepEqual(first, { required: true, roles: null, status: 403 });
  assert.deepEqual(required.calls.map((call) => call.url), [ME_API]);
  assert.equal(required.calls[0].options.headers.Authorization, 'Bearer aal1-token');
  assert.equal(required.calls[0].options.cache, 'no-store');

  const internalRoles = fakeFetch(200, { roles: [{ role: 'internal' }] });
  assert.deepEqual(await readSecondFactorRequirement({ accessToken: 't', fetchImpl: internalRoles.impl }), {
    required: true,
    roles: [{ role: 'internal' }],
    status: 200,
  });

  const ownerOnly = fakeFetch(200, { roles: [{ role: 'owner', restaurant_id: '9001' }] });
  assert.deepEqual(await readSecondFactorRequirement({ accessToken: 't', fetchImpl: ownerOnly.impl }), {
    required: false,
    roles: [{ role: 'owner', restaurant_id: '9001' }],
    status: 200,
  });

  // A 403 without the second-step reason is the existing "no staff role" case.
  const noRole = fakeFetch(403, { roles: [] });
  assert.deepEqual(await readSecondFactorRequirement({ accessToken: 't', fetchImpl: noRole.impl }), {
    required: false,
    roles: [],
    status: 403,
  });

  const failed = fakeFetch(500, { error: 'boom' });
  assert.deepEqual(await readSecondFactorRequirement({ accessToken: 't', fetchImpl: failed.impl }), {
    required: null,
    roles: null,
    status: 500,
  });

  const throwing = { impl: async () => { throw new Error('network down'); } };
  assert.deepEqual(await readSecondFactorRequirement({ accessToken: 't', fetchImpl: throwing.impl }), {
    required: null,
    roles: null,
    status: null,
  });

  assert.deepEqual(await readSecondFactorRequirement({ accessToken: '', fetchImpl: failed.impl }), {
    required: null,
    roles: null,
    status: null,
  });
});

test('startEnrollment: returns the QR and the manual key, never the raw error', async () => {
  const ok = await startEnrollment(fakeAuth());
  assert.equal(ok.ok, true);
  assert.equal(ok.factorId, 'factor-new');
  assert.match(ok.qrCode, /^data:image\/svg\+xml/);
  assert.equal(ok.secret, 'ABCDEF123456');

  const secret = 'email=developer@example.invalid token=123456';
  const rejected = await startEnrollment(fakeAuth({ enroll: { data: null, error: { status: 422, code: 'mfa_factor_name_conflict', message: secret } } }));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.message, MESSAGES.generic);
  assert.equal(rejected.message.includes('123456'), false);

  const throwing = await startEnrollment(fakeAuth({ enroll: new TypeError('Failed to fetch') }));
  assert.equal(throwing.ok, false);
  assert.equal(throwing.message, MESSAGES.network);

  assert.equal((await startEnrollment(undefined)).ok, false);
});

test('startChallenge: passes the factor id and returns the challenge id', async () => {
  const auth = fakeAuth();
  const result = await startChallenge(auth, 'factor-1');
  assert.deepEqual(result, { ok: true, challengeId: 'challenge-1' });
  assert.deepEqual(auth.calls, [{ challenge: { factorId: 'factor-1' } }]);

  const rateLimited = await startChallenge(fakeAuth({ challenge: { data: null, error: { status: 429, message: 'over_email_send_rate_limit' } } }), 'factor-1');
  assert.equal(rateLimited.ok, false);
  assert.equal(rateLimited.message, MESSAGES.rateLimited);

  assert.equal((await startChallenge(fakeAuth(), null)).ok, false);
  assert.equal((await startChallenge(fakeAuth({ challenge: new Error('boom') }), 'factor-1')).ok, false);
});

test('verifyCode: a good code succeeds and a wrong code gives the contract text', async () => {
  const auth = fakeAuth();
  assert.deepEqual(await verifyCode(auth, { factorId: 'factor-1', challengeId: 'challenge-1', code: ' 123456 ' }), { ok: true });
  assert.deepEqual(auth.calls, [{ verify: { factorId: 'factor-1', challengeId: 'challenge-1', code: '123456' } }]);

  const wrong = await verifyCode(
    fakeAuth({ verify: { data: null, error: { status: 422, code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } } }),
    { factorId: 'factor-1', challengeId: 'challenge-1', code: '000000' },
  );
  assert.equal(wrong.ok, false);
  assert.equal(wrong.message, 'Die code klopt niet of is verlopen. Probeer de nieuwste code uit je app.');

  const expired = await verifyCode(
    fakeAuth({ verify: { data: null, error: { status: 403, code: 'mfa_challenge_expired', message: 'challenge expired' } } }),
    { factorId: 'factor-1', challengeId: 'challenge-1', code: '123456' },
  );
  assert.equal(expired.message, MESSAGES.invalidTotpCode);

  const rateLimited = await verifyCode(
    fakeAuth({ verify: { data: null, error: { status: 429, message: 'too many requests' } } }),
    { factorId: 'factor-1', challengeId: 'challenge-1', code: '123456' },
  );
  assert.equal(rateLimited.message, MESSAGES.rateLimited);

  const thrown = await verifyCode(fakeAuth({ verify: new TypeError('Failed to fetch') }), {
    factorId: 'factor-1',
    challengeId: 'challenge-1',
    code: '123456',
  });
  assert.equal(thrown.message, MESSAGES.network);
});

test('verifyCode: a malformed code is refused locally, without calling Supabase', async () => {
  const auth = fakeAuth();
  const result = await verifyCode(auth, { factorId: 'factor-1', challengeId: 'challenge-1', code: '12' });
  assert.equal(result.ok, false);
  assert.match(result.message, /6 cijfers/);
  assert.deepEqual(auth.calls, []);
});

test('verifyCode: a missing factor or challenge is a safe error, never a crash', async () => {
  const auth = fakeAuth();
  assert.equal((await verifyCode(auth, { factorId: null, challengeId: 'c', code: '123456' })).ok, false);
  assert.equal((await verifyCode(auth, { factorId: 'f', challengeId: null, code: '123456' })).ok, false);
  assert.equal((await verifyCode(undefined, { factorId: 'f', challengeId: 'c', code: '123456' })).ok, false);
  assert.deepEqual(auth.calls, []);
});

test('readAccessToken: returns the fresh token after the second step, or null', async () => {
  assert.equal(await readAccessToken(fakeAuth()), 'aal2-token');
  assert.equal(await readAccessToken(fakeAuth({ session: { data: { session: null } } })), null);
  assert.equal(await readAccessToken(fakeAuth({ session: new Error('storage blocked') })), null);
  assert.equal(await readAccessToken(undefined), null);
});

test('every failure text of this module is Dutch and never the Supabase message', async () => {
  const secret = 'token=abcdef email=developer@example.invalid';
  const failures = [
    await startEnrollment(fakeAuth({ enroll: { data: null, error: { status: 500, message: secret } } })),
    await startChallenge(fakeAuth({ challenge: { data: null, error: { status: 500, message: secret } } }), 'f'),
    await verifyCode(fakeAuth({ verify: { data: null, error: { status: 500, message: secret } } }), {
      factorId: 'f',
      challengeId: 'c',
      code: '123456',
    }),
  ];
  for (const failure of failures) {
    assert.equal(failure.ok, false);
    assert.equal(failure.message.includes('abcdef'), false);
    assert.equal(failure.message.includes('developer@example.invalid'), false);
    assert.match(failure.message, /^[A-ZÀ-Ý].*\.$/);
  }
});
