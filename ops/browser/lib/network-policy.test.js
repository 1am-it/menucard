'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FIXTURE_API_ROUTES,
  defaultAppOrigins,
  classifyRequest,
  createNetworkGuard,
  enableFetchGuard,
} = require('./network-policy');

const APP_ORIGINS = defaultAppOrigins(3137);
const BASE_URL = 'http://localhost:3137/internal/source-triage/batch';

function classify(url, method = 'GET') {
  return classifyRequest(url, {
    appOrigins: APP_ORIGINS,
    fixtureRoutes: FIXTURE_API_ROUTES,
    baseUrl: BASE_URL,
    method,
  });
}

test('external URLs and protocol-relative external URLs fail closed', () => {
  const external = classify('https://unapproved.invalid/api/anything');
  assert.equal(external.allowed, false);
  assert.equal(external.reason, 'external_origin');

  const protocolRelative = classify('//unapproved.invalid/api/anything');
  assert.equal(protocolRelative.allowed, false);
  assert.equal(protocolRelative.reason, 'external_origin');
  assert.equal(protocolRelative.protocolRelative, true);
});

test('unknown local API and write routes fail closed', () => {
  assert.equal(classify('/api/internal/v1/menu-concepts', 'POST').reason, 'method_not_allowed');
  assert.equal(classify('/api/internal/v1/menu-concepts/concept-v2-0002', 'POST').reason, 'method_not_allowed');
  assert.equal(classify('/api/internal/v1/menu-concepts/concept-v2-0002/decision', 'POST').reason, 'unknown_api_route');
  assert.equal(classify('/api/internal/v1/menu-concepts/concept-v2-0002/versions', 'GET').reason, 'unknown_api_route');
  assert.equal(classify('/api/internal/v1/menu-concepts/').reason, 'unknown_api_route');
  assert.equal(classify('/api/internal/v1/me', 'POST').reason, 'method_not_allowed');
  assert.equal(classify('/api/internal/v1/batch-analysis', 'POST').reason, 'method_not_allowed');
  assert.equal(classify('/_next/static/chunk.js', 'POST').reason, 'method_not_allowed');
  assert.equal(classify('ftp://localhost/file').reason, 'unsupported_protocol');
});

test('BE-57: alleen de bezoekteller is als schrijfroute toegestaan', () => {
  const beacon = classify('/api/v1/bekeken', 'POST');
  assert.equal(beacon.allowed, true);
  assert.equal(beacon.kind, 'fixture_api');
  assert.equal(beacon.routeId, 'bekeken');
  // Lezen bestaat niet op deze route, en een tweede schrijfpad blijft onbekend.
  assert.equal(classify('/api/v1/bekeken', 'GET').reason, 'method_not_allowed');
  assert.equal(classify('/api/v1/bekeken/anders', 'POST').reason, 'unknown_api_route');
  assert.equal(classify('/api/v1/gedeeld', 'POST').reason, 'unknown_api_route');
});

test('only explicit local app and fixture routes are allowed', () => {
  assert.equal(classify('/_next/static/chunk.js').kind, 'app_resource');
  assert.equal(classify('/internal/source-triage/batch?fixture=review').kind, 'app_resource');
  assert.equal(classify('/internal/menu-concepts').kind, 'app_resource');
  assert.equal(classify('/internal/menu-concepts/concept-v2-0002').kind, 'app_resource');
  assert.equal(classify('/api/internal/v1/me').kind, 'fixture_api');
  assert.equal(classify('/api/internal/v1/batch-analysis').kind, 'fixture_api');
  assert.equal(classify('/api/internal/v1/batch-analysis/process', 'POST').kind, 'fixture_api');
  const triage = classify('/api/internal/v1/source-triage');
  assert.equal(triage.kind, 'fixture_api');
  assert.equal(triage.routeId, 'source-triage');
  assert.equal(classify('/api/internal/v1/source-triage', 'POST').reason, 'method_not_allowed');
  assert.equal(classify('/api/internal/v1/source-triage/proposals', 'POST').reason, 'unknown_api_route');
  const list = classify('/api/internal/v1/menu-concepts');
  assert.equal(list.kind, 'fixture_api');
  assert.equal(list.routeId, 'menu-concepts-list');
  const detail = classify('/api/internal/v1/menu-concepts/concept-v1-0001');
  assert.equal(detail.kind, 'fixture_api');
  assert.equal(detail.routeId, 'menu-concepts-detail');
  assert.equal(classify('/auth/v1/token?grant_type=password', 'POST').kind, 'fixture_api');
  assert.equal(classify('data:text/plain,fixture').kind, 'inline');
  assert.equal(classify('ws://localhost:3137/_next/webpack-hmr').kind, 'websocket');
  assert.equal(classify('ws://unapproved.invalid/socket').reason, 'external_origin');
});

test('the guard separates app-phase violations from the deliberate negative probe', () => {
  const guard = createNetworkGuard({ appOrigins: APP_ORIGINS, fixtureRoutes: FIXTURE_API_ROUTES, baseUrl: BASE_URL });
  guard.record('fetch', 'https://unapproved.invalid/x', 'GET', guard.classify('https://unapproved.invalid/x'));
  assert.equal(guard.appViolations().length, 1);
  assert.equal(guard.negativeViolations().length, 0);
  guard.setPhase('negative-probe');
  guard.record('fetch', '//unapproved.invalid/x', 'GET', guard.classify('//unapproved.invalid/x'));
  assert.equal(guard.appViolations().length, 1);
  assert.equal(guard.negativeViolations().length, 1);
  assert.equal(guard.negativeViolations()[0].protocolRelative, true);
});

test('the CDP fetch guard continues local traffic and fails external traffic', async () => {
  const calls = [];
  const handlers = new Map();
  const cdp = {
    on(method, handler) {
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
    async send(method, params) {
      calls.push({ method, params });
    },
    emit(method, params) {
      const handler = handlers.get(method);
      if (handler) handler(params);
    },
  };
  const guard = createNetworkGuard({ appOrigins: APP_ORIGINS, fixtureRoutes: FIXTURE_API_ROUTES, baseUrl: BASE_URL });
  await enableFetchGuard(cdp, guard);
  assert.equal(calls[0].method, 'Fetch.enable');

  cdp.emit('Fetch.requestPaused', {
    requestId: 'allowed-1',
    resourceType: 'Script',
    request: { url: 'http://localhost:3137/_next/static/chunk.js', method: 'GET' },
  });
  cdp.emit('Fetch.requestPaused', {
    requestId: 'blocked-1',
    resourceType: 'Image',
    request: { url: 'https://unapproved.invalid/pixel.png', method: 'GET' },
  });
  cdp.emit('Fetch.requestPaused', {
    requestId: 'allowed-detail-1',
    resourceType: 'Fetch',
    request: { url: 'http://localhost:3137/api/internal/v1/menu-concepts/concept-v2-0002', method: 'GET' },
  });
  cdp.emit('Fetch.requestPaused', {
    requestId: 'blocked-2',
    resourceType: 'XHR',
    request: { url: 'http://localhost:3137/api/internal/v1/menu-concepts', method: 'POST' },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const continued = calls.filter((call) => call.method === 'Fetch.continueRequest').map((call) => call.params.requestId);
  const failed = calls.filter((call) => call.method === 'Fetch.failRequest').map((call) => call.params.requestId);
  assert.deepEqual(continued, ['allowed-1', 'allowed-detail-1']);
  assert.deepEqual(failed, ['blocked-1', 'blocked-2']);
  assert.equal(guard.appViolations().length, 2);
  assert.deepEqual(guard.appViolations().map((entry) => entry.reason).sort(), ['external_origin', 'method_not_allowed']);
});
