'use strict';

// BE-66 (#162) — het gedrag van de verzendstub, zonder browser.
//
// Dezelfde functie die de browsercheck injecteert, draait hier met Node's eigen
// Response en URL. Zo is bewezen dat alleen `POST /auth/v1/otp` wordt
// afgevangen, dat de stub niets naar buiten laat en dat hij een onverwachte
// auth-route vastlegt in plaats van stil te slagen.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { AUTH_ORIGIN, be66OtpStubScript, be66Settings, installBe66OtpStub } = require('./be66-otp-stub');

const APP = 'http://localhost:3189';

function install(realFetch) {
  global.window = {
    location: { href: `${APP}/inloggen`, origin: APP, pathname: '/inloggen' },
    fetch: typeof realFetch === 'function' ? realFetch : null,
  };
  return installBe66OtpStub(be66Settings({}));
}

test('de stub vangt alleen POST /auth/v1/otp af en antwoordt met een leeg succes', async () => {
  const stub = install();
  assert.equal(stub.otpCount(), 0);
  const response = await global.window.fetch(`${AUTH_ORIGIN}/auth/v1/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'houder@example.invalid', create_user: false }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {});
  assert.equal(stub.otpCount(), 1);
  assert.deepEqual(stub.calls[0], {
    kind: 'otp',
    method: 'POST',
    path: '/auth/v1/otp',
    url: `${AUTH_ORIGIN}/auth/v1/otp`,
  });
  assert.deepEqual(stub.violations, []);
});

test('een andere auth-route wordt vastgelegd en niet beantwoord als succes', async () => {
  const stub = install();
  const response = await global.window.fetch(`${AUTH_ORIGIN}/auth/v1/token?grant_type=password`, { method: 'POST' });
  assert.equal(response.status, 404);
  assert.equal(stub.otpCount(), 0);
  assert.equal(stub.violations.length, 1);
  assert.equal(stub.violations[0].kind, 'unexpected_auth_route');
});

test('verkeer naar de app gaat door, een externe bestemming niet', async () => {
  let doorgegeven = 0;
  const stub = install((input) => {
    doorgegeven += 1;
    return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
  const eigen = await global.window.fetch(`${APP}/api/internal/v1/me`);
  assert.equal(eigen.status, 200);
  assert.equal(doorgegeven, 1);

  await assert.rejects(global.window.fetch('https://example.invalid/otp', { method: 'POST' }), /fixture_network_blocked/);
  assert.equal(stub.violations.length, 1);
  assert.equal(stub.violations[0].kind, 'external_origin');
});

test('de scriptbron draagt de fictieve auth-origin en verwijst naar /auth/v1/otp', () => {
  const source = be66OtpStubScript({});
  assert.match(source, /127\.0\.0\.1:9/);
  assert.match(source, /\/auth\/v1\/otp/);
  assert.match(source, /window\.__BE66__/);
  assert.equal(be66Settings({ authOrigin: 'http://localhost:9999' }).authOrigin, 'http://localhost:9999');
  assert.equal(be66Settings({}).authOrigin, AUTH_ORIGIN);
});
