'use strict';

// BE-48 (#112) — het gedrag van de in-page Supabase-stub.
//
// De stub wordt in de browser geïnjecteerd, maar dezelfde functie is hier met
// Node's eigen Response, btoa en URL uit te voeren. Zo is bewezen dat de
// browsercheck echt aal1 → code → aal2 doorloopt, dat een fout wachtwoord en een
// foute code de Supabase-codes opleveren die de app vertaalt, en dat niets naar
// buiten kan. Geen netwerk, geen Supabase, geen browser.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { installBe48AuthStub } = require('./be48-stub-page');
const { DEFAULT_SETTINGS, be48Settings, authStubScript } = require('./be48-auth-stub');

const APP = 'http://localhost:3139';

// The page globals the stub uses. `btoa`, `Response` and `URL` already exist in
// Node; only window/location/localStorage are supplied here. The storage is a
// small real map, so the stub's own cleanup of a previous scenario's session is
// observable too.
function install(overrides, seed) {
  const store = new Map(Object.entries(seed || {}));
  global.window = {
    location: { href: `${APP}/internal/login`, origin: APP, pathname: '/internal/login' },
    localStorage: {
      setItem: (key, value) => store.set(key, String(value)),
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      removeItem: (key) => store.delete(key),
      key: (index) => (Array.from(store.keys())[index] === undefined ? null : Array.from(store.keys())[index]),
      get length() {
        return store.size;
      },
    },
    fetch: null,
  };
  const result = installBe48AuthStub(be48Settings(overrides));
  return { api: result, stored: store, fetch: global.window.fetch };
}

function jwtPayload(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
}

test('be48Settings: the defaults are a verified internal account without a linked app', () => {
  assert.equal(DEFAULT_SETTINGS.authOrigin, 'http://127.0.0.1:9');
  assert.deepEqual(DEFAULT_SETTINGS.roles, [{ role: 'internal', restaurant_id: null }]);
  assert.deepEqual(DEFAULT_SETTINGS.factors, []);
  // BE-48: the claim's e-mail code is its own code, never the app's code.
  assert.equal(DEFAULT_SETTINGS.emailCode, '654321');
  assert.notEqual(DEFAULT_SETTINGS.emailCode, DEFAULT_SETTINGS.totpCode);
  assert.equal(be48Settings({ emailCode: '' }).emailCode, DEFAULT_SETTINGS.emailCode);
  assert.equal(be48Settings({ emailCode: '000111' }).emailCode, '000111');

  const light = be48Settings({ theme: 'light' });
  assert.equal(light.theme, 'light');
  assert.equal(be48Settings({}).theme, 'dark');
  assert.equal(be48Settings({ theme: 'paars' }).theme, 'dark');
  // Bad shapes never reach the stub as something it cannot handle.
  assert.deepEqual(be48Settings({ roles: 'internal' }).roles, []);
  assert.deepEqual(be48Settings({ factors: null }).factors, []);
  // The defaults themselves are never mutated.
  assert.deepEqual(DEFAULT_SETTINGS.factors, []);
});

test('authStubScript: injects the stub function with the settings as one argument', () => {
  const script = authStubScript({ theme: 'light', roles: [{ role: 'owner', restaurant_id: '9001' }] });
  assert.match(script, /^\(function installBe48AuthStub\(settings\) \{/);
  assert.match(script, /"theme":"light"/);
  assert.match(script, /"role":"owner"/);
  // The injected code must stay self-contained browser code.
  assert.doesNotMatch(script, /\brequire\(/);
  assert.doesNotMatch(script, /module\.exports/);
  assert.doesNotMatch(script, /process\.env/);
});

test('the stub: the app read routes answer 403 until the second step is done', async () => {
  const { fetch } = install();
  const me = await fetch(`${APP}/api/internal/v1/me`, { method: 'GET' });
  assert.equal(me.status, 403);
  assert.deepEqual(await me.json(), { error: 'Tweede inlogstap vereist', reason: 'aal2_required' });

  const counts = await fetch(`${APP}/api/internal/v1/workqueue-counts`, { method: 'GET' });
  assert.equal(counts.status, 403);
});

test('the stub: a wrong password answers the Supabase invalid_credentials error', async () => {
  const { fetch } = install();
  const res = await fetch('http://127.0.0.1:9/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: 'medewerker@example.invalid', password: 'fout' }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error_code, 'invalid_credentials');
});

test('the stub: sign-in → link an app → code → aal2, including the JWT claims', async () => {
  const { fetch, api } = install();
  const signIn = await fetch('http://127.0.0.1:9/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: 'medewerker@example.invalid', password: 'goed-wachtwoord' }),
  });
  const session = await signIn.json();
  assert.equal(signIn.status, 200);
  assert.equal(jwtPayload(session.access_token).aal, 'aal1');
  assert.deepEqual(session.user.factors, []);

  const user = await (await fetch('http://127.0.0.1:9/auth/v1/user', { method: 'GET' })).json();
  assert.equal(user.email, 'medewerker@example.invalid');

  const enrolled = await (
    await fetch('http://127.0.0.1:9/auth/v1/factors', {
      method: 'POST',
      body: JSON.stringify({ factor_type: 'totp', friendly_name: 'Menucard' }),
    })
  ).json();
  assert.equal(enrolled.id, 'factor-fixture');
  assert.equal(enrolled.type, 'totp');
  assert.match(enrolled.totp.qr_code, /^<svg/);
  assert.equal(enrolled.totp.secret, 'JBSWY3DPEHPK3PXP');

  const challenge = await (
    await fetch('http://127.0.0.1:9/auth/v1/factors/factor-fixture/challenge', {
      method: 'POST',
      body: JSON.stringify({ factorId: 'factor-fixture' }),
    })
  ).json();
  assert.equal(challenge.id, 'challenge-1');

  const wrong = await fetch('http://127.0.0.1:9/auth/v1/factors/factor-fixture/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: 'challenge-1', code: '000000' }),
  });
  assert.equal(wrong.status, 422);
  assert.equal((await wrong.json()).error_code, 'mfa_verification_failed');
  assert.equal(api.assurance(), 'aal1');

  const verified = await fetch('http://127.0.0.1:9/auth/v1/factors/factor-fixture/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: 'challenge-1', code: '123456' }),
  });
  assert.equal(verified.status, 200);
  assert.equal(jwtPayload((await verified.json()).access_token).aal, 'aal2');
  assert.equal(api.assurance(), 'aal2');

  const me = await fetch(`${APP}/api/internal/v1/me`, { method: 'GET' });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { roles: [{ role: 'internal', restaurant_id: null }] });
  const counts = await fetch(`${APP}/api/internal/v1/workqueue-counts`, { method: 'GET' });
  assert.equal(counts.status, 200);
  assert.deepEqual(await counts.json(), { counts: DEFAULT_SETTINGS.counts });
});

test('the stub: a recovery code works and the wrong one answers otp_expired', async () => {
  const { fetch } = install();
  const recover = await fetch('http://127.0.0.1:9/auth/v1/recover', {
    method: 'POST',
    body: JSON.stringify({ email: 'medewerker@example.invalid' }),
  });
  assert.equal(recover.status, 200);

  const wrong = await fetch('http://127.0.0.1:9/auth/v1/verify', {
    method: 'POST',
    body: 'type=recovery&token=000000&email=medewerker%40example.invalid',
  });
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).error_code, 'otp_expired');

  const right = await fetch('http://127.0.0.1:9/auth/v1/verify', {
    method: 'POST',
    body: 'type=recovery&token=123456&email=medewerker%40example.invalid',
  });
  assert.equal(right.status, 200);
  assert.equal(jwtPayload((await right.json()).access_token).aal, 'aal1');
});

test('the stub: an owner-only account is authorized without a second step', async () => {
  const { fetch } = install({ roles: [{ role: 'owner', restaurant_id: '9001' }] });
  const me = await fetch(`${APP}/api/internal/v1/me`, { method: 'GET' });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { roles: [{ role: 'owner', restaurant_id: '9001' }] });
});

test('the stub: everything unknown is refused and recorded, never forwarded', async () => {
  const { fetch, api } = install();
  await assert.rejects(() => fetch('https://example.invalid/anything'), /fixture_network_blocked/);
  assert.deepEqual(api.violations, [
    { kind: 'external_origin', method: 'GET', url: 'https://example.invalid/anything' },
  ]);

  const unknownApi = await fetch(`${APP}/api/internal/v1/onbekend`, { method: 'GET' });
  assert.equal(unknownApi.status, 500);
  const unknownAuth = await fetch('http://127.0.0.1:9/auth/v1/onbekend', { method: 'POST' });
  assert.equal(unknownAuth.status, 404);
  assert.deepEqual(
    api.violations.map((entry) => entry.kind),
    ['external_origin', 'unknown_api_route', 'unknown_auth_route'],
  );
});

test('the stub: the real Supabase SDK accepts the sign-in, code and error shapes', async () => {
  // The contract between stub and app is the SDK's own HTTP parsing, so this
  // test drives @supabase/supabase-js itself against the stub — no browser, no
  // network, no real project.
  const { createClient } = require('@supabase/supabase-js');
  const { fetch } = install();
  const supabase = createClient('http://127.0.0.1:9', 'fixture-anon-key-not-a-secret', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const wrong = await supabase.auth.signInWithPassword({ email: 'medewerker@example.invalid', password: 'fout' });
  assert.equal(wrong.error.code, 'invalid_credentials');
  assert.equal(wrong.error.status, 400);

  const right = await supabase.auth.signInWithPassword({
    email: 'medewerker@example.invalid',
    password: 'goed-wachtwoord',
  });
  assert.equal(right.error, null);
  assert.equal(right.data.session.access_token.split('.').length, 3);

  const levels = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  assert.equal(levels.data.currentLevel, 'aal1');
  assert.equal(levels.data.nextLevel, 'aal1');

  const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  assert.equal(enrolled.error, null);
  assert.match(enrolled.data.totp.qr_code, /^data:image\/svg\+xml/);
  assert.equal(enrolled.data.totp.secret, 'JBSWY3DPEHPK3PXP');

  const challenge = await supabase.auth.mfa.challenge({ factorId: enrolled.data.id });
  assert.equal(challenge.error, null);

  const failedVerify = await supabase.auth.mfa.verify({
    factorId: enrolled.data.id,
    challengeId: challenge.data.id,
    code: '000000',
  });
  assert.equal(failedVerify.error.code, 'mfa_verification_failed');

  const verified = await supabase.auth.mfa.verify({
    factorId: enrolled.data.id,
    challengeId: challenge.data.id,
    code: '123456',
  });
  assert.equal(verified.error, null);
  const upgraded = await supabase.auth.getSession();
  assert.equal(jwtPayload(upgraded.data.session.access_token).aal, 'aal2');

  const recover = await supabase.auth.resetPasswordForEmail('medewerker@example.invalid');
  assert.equal(recover.error, null);
  const badRecovery = await supabase.auth.verifyOtp({ email: 'medewerker@example.invalid', token: '000000', type: 'recovery' });
  assert.equal(badRecovery.error.code, 'otp_expired');
  const recovery = await supabase.auth.verifyOtp({ email: 'medewerker@example.invalid', token: '123456', type: 'recovery' });
  assert.equal(recovery.error, null);
});

test('the stub: the theme is stored for the page and the calls are logged', async () => {
  const { fetch, stored, api } = install({ theme: 'light' });
  assert.equal(stored.get('bredaeats_theme'), 'light');
  await fetch(`${APP}/api/internal/v1/me`, { method: 'GET' });
  assert.deepEqual(
    api.calls.map((call) => `${call.method} ${call.path}`),
    ['GET /api/internal/v1/me'],
  );
});

test('the stub: a previous scenario can never leak its session into the next one', () => {
  const { stored } = install({ theme: 'dark' }, { 'sb-127-auth-token': '{"access_token":"oud"}', 'iets-anders': 'blijft' });
  assert.equal(stored.has('sb-127-auth-token'), false);
  assert.equal(stored.get('iets-anders'), 'blijft');
  assert.equal(stored.get('bredaeats_theme'), 'dark');
});
test('the stub: the claim code arrives through /otp and verifies as its own type', async () => {
  const { fetch, api } = install();
  const requested = await fetch('http://127.0.0.1:9/auth/v1/otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'eigenaar@example.invalid', create_user: true }),
  });
  assert.equal(requested.status, 200);
  // A resend is the same call again; the check counts them.
  await fetch('http://127.0.0.1:9/auth/v1/otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'eigenaar@example.invalid', create_user: true }),
  });
  assert.deepEqual(api.otpRequests, ['eigenaar@example.invalid', 'eigenaar@example.invalid']);

  const wrong = await fetch('http://127.0.0.1:9/auth/v1/verify', {
    method: 'POST',
    body: 'type=email&token=000000&email=eigenaar%40example.invalid',
  });
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).error_code, 'otp_expired');

  // The authenticator code must never work as an e-mail code, and the other way
  // round: the two codes are separate.
  const crossed = await fetch('http://127.0.0.1:9/auth/v1/verify', {
    method: 'POST',
    body: 'type=email&token=123456&email=eigenaar%40example.invalid',
  });
  assert.equal(crossed.status, 403);

  const right = await fetch('http://127.0.0.1:9/auth/v1/verify', {
    method: 'POST',
    body: 'type=email&token=654321&email=eigenaar%40example.invalid',
  });
  assert.equal(right.status, 200);
  assert.equal(jwtPayload((await right.json()).access_token).aal, 'aal1');

  const unknownType = await fetch('http://127.0.0.1:9/auth/v1/verify', {
    method: 'POST',
    body: 'type=magiclink&token=654321&email=eigenaar%40example.invalid',
  });
  assert.equal(unknownType.status, 403);
});

test('the stub: the claim routes answer a signed-in visitor without a second step', async () => {
  const { fetch, api } = install({ roles: [{ role: 'owner', restaurant_id: '6' }] });
  const mine = await fetch(`${APP}/api/claims/mine?restaurantId=6`, { method: 'GET' });
  assert.equal(mine.status, 200);
  assert.deepEqual(await mine.json(), { claims: [] });

  const submitted = await fetch(`${APP}/api/claims`, {
    method: 'POST',
    body: JSON.stringify({ restaurantId: '6' }),
  });
  assert.equal(submitted.status, 201);
  const claim = (await submitted.json()).claim;
  assert.equal(claim.status, 'pending');
  assert.equal(claim.restaurant_id, '6');
  assert.deepEqual(api.violations, []);
});

test('the stub: the SDK sends and verifies a claim code exactly like the page does', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const { fetch, api } = install({ roles: [{ role: 'owner', restaurant_id: '6' }] });
  const supabase = createClient('http://127.0.0.1:9', 'fixture-anon-key-not-a-secret', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const sent = await supabase.auth.signInWithOtp({
    email: 'eigenaar@example.invalid',
    options: { emailRedirectTo: `${APP}/claim/6` },
  });
  assert.equal(sent.error, null);
  assert.deepEqual(api.otpRequests, ['eigenaar@example.invalid']);

  const bad = await supabase.auth.verifyOtp({ email: 'eigenaar@example.invalid', token: '111111', type: 'email' });
  assert.equal(bad.error.code, 'otp_expired');
  assert.equal(bad.error.status, 403);

  const good = await supabase.auth.verifyOtp({
    email: 'eigenaar@example.invalid',
    token: DEFAULT_SETTINGS.emailCode,
    type: 'email',
  });
  assert.equal(good.error, null);
  assert.equal(good.data.session.user.email, 'eigenaar@example.invalid');
  assert.equal(jwtPayload(good.data.session.access_token).aal, 'aal1');
});

