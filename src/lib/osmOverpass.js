// BE-32 (#75) — the one server-side OpenStreetMap request.
//
// Public Overpass API, bounded to Breda. The main server is often at capacity
// (502/504), so the public mirrors are tried in order. The request itself is
// never cached: the route caches only a *successful* parsed answer for 24 hours
// (sourceDiscoveryRouteDeps), so a busy moment is never remembered for a day. The public API asks for an identifying User-Agent; ours names this
// feature, never a browser.
//
// Nothing here writes. On any failure the caller gets an honest
// `{ ok: false, reason: 'osm_unreachable' }` and the other layers keep working
// (criterion 1).
//
// Contract: planning/specs/tickets/be-32-source-discovery-osm-ai.md.

'use strict';

const {
  OVERPASS_ENDPOINTS,
  OVERPASS_USER_AGENT,
  OSM_CACHE_SECONDS,
  OSM_ATTRIBUTION,
  buildOverpassQuery,
  parseOverpassResponse,
} = require('./osmSource');

const OSM_UNREACHABLE = 'osm_unreachable';
const DEFAULT_TIMEOUT_MS = 25000;

/**
 * Fetches the Breda food businesses. `fetchImpl` is injectable so the
 * regressions never leave the machine; the real route passes global fetch.
 */
async function fetchOverpassBusinesses({ fetchImpl = fetch, now = () => new Date(), timeoutMs = DEFAULT_TIMEOUT_MS, endpoints = OVERPASS_ENDPOINTS } = {}) {
  const query = buildOverpassQuery();
  for (const endpoint of endpoints) {
    let payload;
    try {
      const response = await fetchImpl(`${endpoint}?${new URLSearchParams({ data: query }).toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent': OVERPASS_USER_AGENT,
          Accept: 'application/json',
        },
        cache: 'no-store',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      if (!response || response.ok !== true || typeof response.json !== 'function') continue;
      payload = await response.json();
    } catch {
      continue;
    }
    return {
      ok: true,
      businesses: parseOverpassResponse(payload),
      fetchedAt: now() instanceof Date ? now().toISOString() : new Date(now()).toISOString(),
      cacheSeconds: OSM_CACHE_SECONDS,
      attribution: OSM_ATTRIBUTION,
    };
  }
  return { ok: false, reason: OSM_UNREACHABLE, attribution: OSM_ATTRIBUTION };
}

module.exports = { fetchOverpassBusinesses, OSM_UNREACHABLE, DEFAULT_TIMEOUT_MS };
