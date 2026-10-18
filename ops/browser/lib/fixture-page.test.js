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

function loadFixture() {
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
    location: { href: BASE_URL, search: '?fixture=review' },
    fetch: async function nativeFetch(input, init) {
      nativeFetchCalls.push({ input, init });
      return new Response('native-app-resource', { status: 200 });
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fixtureBootstrap({ review: { detail: null } }, { appOrigins: APP_ORIGINS, baseUrl: BASE_URL }), context);

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
    /fixture_network_blocked: unknown_api_route/,
  );
  assert.equal(fixture.nativeFetchCalls.length, 0);
  assert.equal(fixture.context.__FIXTURE_NETWORK_VIOLATIONS__[0].reason, 'unknown_api_route');
});

test('an explicit fixture API route is answered without native traffic', async () => {
  const fixture = loadFixture();
  const response = await fixture.context.fetch('/api/internal/v1/me');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.roles[0].role, 'internal');
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
  assert.equal(reasons.join(','), 'external_origin,unknown_api_route');
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
