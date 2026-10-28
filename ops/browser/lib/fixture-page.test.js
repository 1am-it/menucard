'use strict';

// Negative regressions for the in-page fixture guard. They run the real
// bootstrap in a Node VM with no network: a spy stands in for the native fetch,
// XHR.send, WebSocket and sendBeacon. Any unapproved request that reaches a
// native primitive fails the test loudly; the expected outcome is a concrete
// `fixture_network_blocked` error and a recorded violation.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { fixtureBootstrap } = require('./fixture-page');
const { defaultAppOrigins } = require('./network-policy');

const APP_ORIGINS = defaultAppOrigins(3137);
const BASE_URL = 'http://localhost:3137/internal/source-triage/batch?fixture=review';

function loadFixture(options = {}) {
  const nativeFetchCalls = [];
  const nativeXhrSends = [];
  const nativeWebSockets = [];
  const nativeEventSources = [];
  const nativeBeacons = [];

  class FakeXMLHttpRequest {
    constructor() {
      this.onerror = null;
      this.events = [];
    }
    open() {}
    send(body) {
      nativeXhrSends.push({ body });
    }
    dispatchEvent(event) {
      this.events.push(event.type);
    }
  }

  class FakeWebSocket {
    constructor(url) {
      nativeWebSockets.push(url);
    }
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;

  class FakeEventSource {
    constructor(url) {
      nativeEventSources.push(url);
    }
  }

  const context = {
    URL,
    URLSearchParams,
    Response,
    Event,
    JSON,
    Map,
    Date,
    String,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    console,
    XMLHttpRequest: FakeXMLHttpRequest,
    WebSocket: FakeWebSocket,
    EventSource: FakeEventSource,
    navigator: {
      sendBeacon(url, data) {
        nativeBeacons.push({ url, data });
        return true;
      },
    },
    location: { href: options.url || BASE_URL, search: options.search === undefined ? '?fixture=review' : options.search },
    fetch: async function nativeFetch(input, init) {
      nativeFetchCalls.push({ input, init });
      return new Response('native-app-resource', { status: 200 });
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fixtureBootstrap(options.scenarios || { review: { detail: null } }, { appOrigins: APP_ORIGINS, baseUrl: BASE_URL }), context);

  return {
    context,
    nativeFetchCalls,
    nativeXhrSends,
    nativeWebSockets,
    nativeEventSources,
    nativeBeacons,
  };
}

test('the bootstrap runs without a boot error and exposes the fixture', () => {
  const fixture = loadFixture();
  assert.equal(fixture.context.__FIXTURE_BOOT_ERROR__, undefined);
  assert.equal(fixture.context.__FIXTURE_ACTIVE__, 'review');
  assert.equal(fixture.context.__FIXTURE_NETWORK_VIOLATIONS__.length, 0);
});

test('an external fetch is blocked before the native fetch', async () => {
  const fixture = loadFixture();
  await assert.rejects(
    fixture.context.fetch('https://unapproved.invalid/api/anything'),
    /fixture_network_blocked: external_origin/,
  );
  assert.equal(fixture.nativeFetchCalls.length, 0);
  const violations = fixture.context.__FIXTURE_NETWORK_VIOLATIONS__;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'fetch');
  assert.equal(violations[0].reason, 'external_origin');
  assert.equal(fixture.context.__FIXTURE_NETWORK_BLOCKED__, true);
});

test('a protocol-relative external URL is blocked and marked as such', async () => {
  const fixture = loadFixture();
  await assert.rejects(
    fixture.context.fetch('//unapproved.invalid/api/anything'),
    /fixture_network_blocked: external_origin/,
  );
  assert.equal(fixture.nativeFetchCalls.length, 0);
  const violation = fixture.context.__FIXTURE_NETWORK_VIOLATIONS__[0];
  assert.equal(violation.reason, 'external_origin');
  assert.equal(violation.protocolRelative, true);
});

test('an unknown local API write is blocked before the native fetch', async () => {
  const fixture = loadFixture();
  await assert.rejects(
    fixture.context.fetch('/api/internal/v1/menu-concepts', { method: 'POST' }),
    /fixture_network_blocked: method_not_allowed/,
  );
  await assert.rejects(
    fixture.context.fetch('/api/internal/v1/unrelated-write', { method: 'POST' }),
    /fixture_network_blocked: unknown_api_route/,
  );
  assert.equal(fixture.nativeFetchCalls.length, 0);
  assert.equal(
    fixture.context.__FIXTURE_NETWORK_VIOLATIONS__.map((entry) => entry.reason).join(','),
    'method_not_allowed,unknown_api_route',
  );
});

test('an explicit fixture API route is answered without native traffic', async () => {
  const fixture = loadFixture();
  const response = await fixture.context.fetch('/api/internal/v1/me');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.roles[0].role, 'internal');
  assert.equal(fixture.nativeFetchCalls.length, 0);
});

test('concept list and detail GETs are answered from the fictional fixture', async () => {
  const scenarios = {
    concepts: {
      list: { items: [{ id: 'concept-v1-0001', restaurantName: 'Fictief Concept Lunch' }] },
      detail: { 'concept-v1-0001': { concept: { id: 'concept-v1-0001', restaurantName: 'Fictief Concept Lunch' } } },
    },
  };
  const fixture = loadFixture({
    scenarios,
    url: 'http://localhost:3137/internal/menu-concepts',
    search: '',
  });
  const list = await fixture.context.fetch('/api/internal/v1/menu-concepts');
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items[0].id, 'concept-v1-0001');
  const detail = await fixture.context.fetch('/api/internal/v1/menu-concepts/concept-v1-0001');
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).concept.restaurantName, 'Fictief Concept Lunch');
  const missing = await fixture.context.fetch('/api/internal/v1/menu-concepts/concept-unknown-9999');
  assert.equal(missing.status, 404);
  assert.equal(fixture.nativeFetchCalls.length, 0);
  assert.equal(fixture.context.__FIXTURE_NETWORK_VIOLATIONS__.length, 0);
});

test('the concept pages are chosen by path when a real click drops the fixture query', () => {
  const scenarios = { concepts: { list: { items: [] }, detail: {} } };
  const fixture = loadFixture({
    scenarios,
    url: 'http://localhost:3137/internal/menu-concepts/concept-v1-0001',
    search: '',
  });
  assert.equal(fixture.context.__FIXTURE_ACTIVE__, 'concepts');
});

test('BE-41: a detail id picks the concept dataset that really contains it', async () => {
  // Two concept datasets exist, so a card that links straight to its own
  // detail must land on the dataset that has that id — not on a 404.
  const scenarios = {
    concepts: { list: { items: [] }, detail: { 'concept-v1-0001': { concept: { id: 'concept-v1-0001' } } } },
    'concepts-publication': { list: { items: [] }, detail: { 'publicatie-klaar-0101': { concept: { id: 'publicatie-klaar-0101' } } } },
  };
  const publication = loadFixture({
    scenarios,
    url: 'http://localhost:3137/internal/menu-concepts/publicatie-klaar-0101',
    search: '',
  });
  assert.equal(publication.context.__FIXTURE_ACTIVE__, 'concepts-publication');
  const detail = await publication.context.fetch('/api/internal/v1/menu-concepts/publicatie-klaar-0101');
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).concept.id, 'publicatie-klaar-0101');

  const own = loadFixture({
    scenarios,
    url: 'http://localhost:3137/internal/menu-concepts/concept-v1-0001',
    search: '',
  });
  assert.equal(own.context.__FIXTURE_ACTIVE__, 'concepts');

  // An unknown id still answers from the default dataset, so the screen's own
  // "not found" state is what the check sees.
  const unknown = loadFixture({
    scenarios,
    url: 'http://localhost:3137/internal/menu-concepts/concept-missing-9999',
    search: '',
  });
  assert.equal(unknown.context.__FIXTURE_ACTIVE__, 'concepts');
  const missing = await unknown.context.fetch('/api/internal/v1/menu-concepts/concept-missing-9999');
  assert.equal(missing.status, 404);
});

test('concept writes stay blocked even though the read routes are allowed', async () => {
  const scenarios = { concepts: { list: { items: [] }, detail: {} } };
  const fixture = loadFixture({ scenarios });
  await assert.rejects(
    fixture.context.fetch('/api/internal/v1/menu-concepts', { method: 'POST' }),
    /fixture_network_blocked: method_not_allowed/,
  );
  await assert.rejects(
    fixture.context.fetch('/api/internal/v1/menu-concepts/concept-v1-0001', { method: 'POST' }),
    /fixture_network_blocked: method_not_allowed/,
  );
  await assert.rejects(
    fixture.context.fetch('/api/internal/v1/menu-concepts/concept-v1-0001/decision', { method: 'POST' }),
    /fixture_network_blocked: unknown_api_route/,
  );
  await assert.rejects(
    fixture.context.fetch('/api/internal/v1/menu-concepts/concept-v1-0001/versions', { method: 'GET' }),
    /fixture_network_blocked: unknown_api_route/,
  );
  assert.equal(fixture.nativeFetchCalls.length, 0);
});

test('XHR to an external URL or unknown API write is blocked', async () => {
  const fixture = loadFixture();
  const errors = [];
  const external = new fixture.context.XMLHttpRequest();
  external.onerror = () => errors.push('external');
  external.open('POST', 'https://unapproved.invalid/api/anything');
  external.send('{}');

  const write = new fixture.context.XMLHttpRequest();
  write.onerror = () => errors.push('write');
  write.open('POST', '/api/internal/v1/menu-concepts');
  write.send('{}');

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(errors.sort(), ['external', 'write']);
  assert.equal(fixture.nativeXhrSends.length, 0);
  const reasons = fixture.context.__FIXTURE_NETWORK_VIOLATIONS__.map((entry) => entry.reason).sort();
  assert.equal(reasons.join(','), 'external_origin,method_not_allowed');
});

test('XHR to a local app resource still reaches the native send', () => {
  const fixture = loadFixture();
  const xhr = new fixture.context.XMLHttpRequest();
  xhr.open('GET', '/_next/static/chunk.js');
  xhr.send();
  assert.equal(fixture.nativeXhrSends.length, 1);
  assert.equal(fixture.context.__FIXTURE_NETWORK_VIOLATIONS__.length, 0);
});

test('an external WebSocket is refused; a same-origin HMR socket is allowed', () => {
  const fixture = loadFixture();
  assert.throws(
    () => new fixture.context.WebSocket('ws://unapproved.invalid/socket'),
    /fixture_network_blocked: external_origin/,
  );
  assert.equal(fixture.nativeWebSockets.length, 0);
  new fixture.context.WebSocket('ws://localhost:3137/_next/webpack-hmr');
  assert.deepEqual(fixture.nativeWebSockets, ['ws://localhost:3137/_next/webpack-hmr']);
});

test('an external EventSource and sendBeacon are refused', () => {
  const fixture = loadFixture();
  assert.throws(
    () => new fixture.context.EventSource('https://unapproved.invalid/events'),
    /fixture_network_blocked: external_origin/,
  );
  assert.equal(fixture.nativeEventSources.length, 0);
  assert.equal(fixture.context.navigator.sendBeacon('https://unapproved.invalid/beacon', 'x'), false);
  assert.equal(fixture.nativeBeacons.length, 0);
  assert.equal(
    fixture.context.__FIXTURE_NETWORK_VIOLATIONS__.map((entry) => entry.kind).sort().join(','),
    'beacon,eventsource',
  );
});


test('a local app resource still uses the native fetch', async () => {
  const fixture = loadFixture();
  const response = await fixture.context.fetch('/_next/static/chunk.js');
  assert.equal(response.status, 200);
  assert.equal(fixture.nativeFetchCalls.length, 1);
  assert.equal(fixture.context.__FIXTURE_NETWORK_VIOLATIONS__.length, 0);
});
