'use strict';

// BE-71 (#176, besluit 021) — "Netjes ophalen": every request goes through the
// existing egress (src/lib/safeOutboundFetch.js via
// src/lib/restaurantSourceFetch.js), robots.txt is honoured, at most one link
// step with at most five candidates, at least two seconds of rest between two
// requests to the same host, and the user agent names itself.
//
// Every html/pdf response is cached under .local/menu-bootstrap-cache/
// (gitignored), so a second run fetches nothing again. A refused robots.txt is
// cached as a refusal, also so a second run never touches that site again.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fetchWebsiteSafely } = require('../../../src/lib/safeOutboundFetch');
const {
  checkRobotsForUrl,
  fetchSameSiteWithRedirects,
  describeRobotsBlock,
  RedirectPolicyError,
} = require('../../../src/lib/restaurantSourceFetch');

const USER_AGENT = 'OnzeMenukaarten-startvulling/1.0 (+[E-MAILADRES])';
const MIN_INTERVAL_MS = 2000;
const MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_CACHE_DIR = path.join('.local', 'menu-bootstrap-cache');
const MAX_CANDIDATES = 5;

function cacheKey(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 40);
}

function readCacheEntry(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Creates one polite fetcher. `fetchImpl`, `sleep`, `now` and `cacheDir` are
 * injectable so `node --test` runs without network or filesystem writes.
 */
function createSourceFetcher({ cacheDir = DEFAULT_CACHE_DIR, fetchImpl = fetchWebsiteSafely, sleep, now = Date.now, minIntervalMs = MIN_INTERVAL_MS } = {}) {
  const wait = typeof sleep === 'function' ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const lastRequestByHost = new Map();
  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });

  /** One paced request to the shared egress, with this run's user agent. */
  async function pacedFetch(url, options = {}) {
    const host = new URL(url).host;
    const previous = lastRequestByHost.get(host);
    if (previous !== undefined) {
      const remaining = minIntervalMs - (now() - previous);
      if (remaining > 0) await wait(remaining);
    }
    lastRequestByHost.set(host, now());
    return fetchImpl(url, { ...options, userAgent: USER_AGENT });
  }

  function robotsCheck(url) {
    return checkRobotsForUrl(url, { fetchImpl: pacedFetch });
  }

  function store(entry) {
    if (!cacheDir) return;
    try {
      fs.writeFileSync(path.join(cacheDir, `${cacheKey(entry.url)}.json`), JSON.stringify(entry));
    } catch {
      // A cache that cannot be written costs a re-fetch, never the run.
    }
  }

  function load(url) {
    if (!cacheDir) return null;
    return readCacheEntry(path.join(cacheDir, `${cacheKey(url)}.json`));
  }

  /**
   * Fetches one same-site page. Resolves `{ ok, url, finalUrl, contentType,
   * kind, bytes, text, fromCache }` or `{ ok: false, reason, detail }`;
   * `kind` is `html`, `pdf` or `other`.
   */
  async function getPage(url) {
    const cached = load(url);
    if (cached) {
      if (cached.ok === false) return { ...cached, fromCache: true };
      const bytes = Buffer.from(cached.bodyBase64, 'base64');
      return {
        ok: true,
        url,
        finalUrl: cached.finalUrl,
        contentType: cached.contentType,
        kind: cached.kind,
        bytes,
        text: cached.kind === 'html' ? bytes.toString('utf8') : null,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
      };
    }

    const gate = await robotsCheck(url);
    if (!gate.shouldFetchPage) {
      const entry = { ok: false, url, reason: 'robots', detail: describeRobotsBlock(gate), robotsStatus: gate.robotsStatus };
      store(entry);
      return entry;
    }

    let fetched;
    try {
      fetched = await fetchSameSiteWithRedirects(url, {
        fetchImpl: pacedFetch,
        fetchOptions: { encoding: 'buffer', maxBytes: MAX_BYTES },
        robotsCheck,
      });
    } catch (error) {
      const reason = error instanceof RedirectPolicyError ? 'redirect' : (error && error.reason) || 'fetch_failed';
      const entry = { ok: false, url, reason, detail: error && error.message ? String(error.message).slice(0, 200) : null };
      return entry;
    }

    const response = fetched.response;
    const contentType = response.contentType || '';
    const kind = contentType === 'application/pdf' ? 'pdf' : contentType === 'text/html' || contentType === 'application/xhtml+xml' ? 'html' : 'other';
    if (kind === 'other') return { ok: false, url, finalUrl: response.finalUrl, reason: 'unsupported_content_type', detail: contentType || null };
    const bytes = response.bytes || Buffer.from(String(response.body || ''), 'utf8');
    const entry = {
      ok: true,
      url,
      finalUrl: response.finalUrl,
      contentType,
      kind,
      fetchedAt: new Date(now()).toISOString(),
      bodyBase64: bytes.toString('base64'),
    };
    store(entry);
    return { ...entry, bytes, text: kind === 'html' ? bytes.toString('utf8') : null, fromCache: false };
  }

  return { getPage, robotsCheck, pacedFetch, USER_AGENT };
}

module.exports = { USER_AGENT, MIN_INTERVAL_MS, MAX_CANDIDATES, DEFAULT_CACHE_DIR, createSourceFetcher, cacheKey };
