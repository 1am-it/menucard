'use strict';

// BE-32 (#75) — the cached Overpass request. A fake fetch proves the method,
// the User-Agent, the 24-hour revalidation and the honest failure path; no
// network request is made by this test.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { fetchOverpassBusinesses, OSM_UNREACHABLE } = require('./osmOverpass');
const { OVERPASS_ENDPOINT, OVERPASS_ENDPOINTS, OVERPASS_USER_AGENT, OSM_CACHE_SECONDS, OSM_ATTRIBUTION, buildOverpassQuery } = require('./osmSource');

function fakeFetch({ json = { elements: [] }, ok = true, throws = false } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw new Error('network down');
    return {
      ok,
      status: ok ? 200 : 502,
      json: async () => {
        if (json === 'not json') throw new Error('invalid json');
        return json;
      },
    };
  };
  return { impl, calls };
}

test('osm fetch: one uncached GET to the public Overpass API with our own User-Agent (the route caches only successes)', async () => {
  const { impl, calls } = fakeFetch({
    json: { elements: [{ type: 'node', id: 1, lat: 51.5, lon: 4.7, tags: { amenity: 'restaurant', name: 'Voorbeeld' } }] },
  });
  const result = await fetchOverpassBusinesses({ fetchImpl: impl, now: () => new Date('2026-10-27T08:12:00.000Z') });
  assert.equal(result.ok, true);
  assert.equal(result.businesses.length, 1);
  assert.equal(result.fetchedAt, '2026-10-27T08:12:00.000Z');
  assert.equal(result.attribution, OSM_ATTRIBUTION);
  assert.equal(calls.length, 1, 'exactly one request, never one per restaurant');
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, OVERPASS_ENDPOINT);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.headers['User-Agent'], OVERPASS_USER_AGENT);
  assert.equal(result.cacheSeconds, OSM_CACHE_SECONDS);
  assert.equal(url.searchParams.get('data'), buildOverpassQuery());
});

test('osm fetch: a failing API is an honest reason, never an exception and never inventing data', async () => {
  for (const options of [{ throws: true }, { ok: false }, { json: 'not json' }]) {
    const { impl } = fakeFetch(options);
    const result = await fetchOverpassBusinesses({ fetchImpl: impl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, OSM_UNREACHABLE);
    assert.equal(result.businesses, undefined);
  }
});

test('osm fetch: a busy main server falls back to the mirror, and only all-failing is unreachable', async () => {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.startsWith(OVERPASS_ENDPOINTS[0])) return { ok: false, status: 502, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ elements: [] }) };
  };
  const result = await fetchOverpassBusinesses({ fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].startsWith(OVERPASS_ENDPOINTS[1]));
  const down = await fetchOverpassBusinesses({ fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(down.ok, false);
  assert.equal(down.reason, OSM_UNREACHABLE);
});
