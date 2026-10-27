// BE-32 (#75) — the one server-side OpenStreetMap request.
//
// Public Overpass API, bounded to Breda, one request per 24 hours through the
// Next/fetch cache (`next.revalidate`), so a click never becomes a request to
// Overpass. The public API asks for an identifying User-Agent; ours names this
// feature, never a browser.
//
// Nothing here writes. On any failure the caller gets an honest
// `{ ok: false, reason: 'osm_unreachable' }` and the other layers keep working
// (criterion 1).
//
// Contract: planning/specs/tickets/be-32-source-discovery-osm-ai.md.

'use strict';

const {
  OVERPASS_ENDPOINT,
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
async function fetchOverpassBusinesses({ fetchImpl = fetch, now = () => new Date(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const query = buildOverpassQuery();
  let response;
  try {
    response = await fetchImpl(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': OVERPASS_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ data: query }).toString(),
      // Existing Next/fetch revalidation: one shared answer per day.
      next: { revalidate: OSM_CACHE_SECONDS, tags: ['osm-breda'] },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch {
    return { ok: false, reason: OSM_UNREACHABLE, attribution: OSM_ATTRIBUTION };
  }
  if (!response || response.ok !== true || typeof response.json !== 'function') {
    return { ok: false, reason: OSM_UNREACHABLE, attribution: OSM_ATTRIBUTION };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: OSM_UNREACHABLE, attribution: OSM_ATTRIBUTION };
  }
  return {
    ok: true,
    businesses: parseOverpassResponse(payload),
    fetchedAt: now() instanceof Date ? now().toISOString() : new Date(now()).toISOString(),
    cacheSeconds: OSM_CACHE_SECONDS,
    attribution: OSM_ATTRIBUTION,
  };
}

module.exports = { fetchOverpassBusinesses, OSM_UNREACHABLE, DEFAULT_TIMEOUT_MS };
