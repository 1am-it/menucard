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
  fetchSameSiteWithRedirects,
  classifyRobotsOutcome,
  robotsAllowsPath,
  describeRobotsBlock,
  RedirectPolicyError,
} = require('../../../src/lib/restaurantSourceFetch');
const { parseRobotsTxtDisallowRules } = require('../../../src/lib/candidateSuggestions');

const USER_AGENT = 'OnzeMenukaarten-startvulling/1.0 (+[E-MAILADRES])';
const MIN_INTERVAL_MS = 2000;
const MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_CACHE_DIR = path.join('.local', 'menu-bootstrap-cache');
const MAX_CANDIDATES = 5;
// A robots.txt that was unreachable (timeout, TLS, network, 5xx) is checked
// once more with a wider timeout, so the report can say what happened. The
// rule itself does not change: without a readable robots.txt nothing is
// fetched (RFC 9309 §2.3.1.4); a 4xx means "no rules" and may proceed
// (§2.3.1.3) — that is the shared gate's existing `missing` status.
const ROBOTS_TIMEOUT_MS = 5000;
const ROBOTS_RETRY_TIMEOUT_MS = 20000;
const ROBOTS_MAX_BYTES = 200 * 1024;
// RFC 9309 §2.3.1.2: a robots.txt redirect is followed for at least five hops.
const ROBOTS_MAX_REDIRECTS = 5;
const ROBOTS_CACHE_POLICY = 'robots-retry-v1';

/**
 * One robots.txt gate (RFC 9309). A robots.txt redirect is followed within the
 * same site, up to five hops (§2.3.1.2 asks for at least five); the decision
 * stays fail-closed: without a readable robots.txt nothing is fetched
 * (§2.3.1.4), a 4xx means "no rules" and may proceed (§2.3.1.3).
 *
 * Only an `unreachable` outcome (timeout, TLS, network error or 5xx) is tried
 * once more with a wider timeout, so the report can say what happened. The
 * classification of the second attempt is the one that travels with the result.
 */
async function fetchRobotsOnce(url, pacedFetch, { timeoutMs }) {
  const target = new URL(url);
  const robotsUrl = `${target.origin}/robots.txt`;
  try {
    const result = await fetchSameSiteWithRedirects(robotsUrl, {
      fetchImpl: pacedFetch,
      fetchOptions: { maxBytes: ROBOTS_MAX_BYTES, timeoutMs },
      robotsCheck: null, // robots.txt itself is never gated by robots.txt
      maxRedirects: ROBOTS_MAX_REDIRECTS,
    });
    const outcome = classifyRobotsOutcome({ result: result.response });
    if (outcome.robotsStatus === 'rules_loaded') {
      outcome.disallowRules = parseRobotsTxtDisallowRules(result.response.body);
    }
    return { ...outcome, robotsUrl };
  } catch (error) {
    const outcome =
      error instanceof RedirectPolicyError
        ? { robotsStatus: 'invalid_or_unknown', httpStatus: error.statusCode || null, detail: error.reason }
        : classifyRobotsOutcome({ error });
    return { ...outcome, robotsUrl };
  }
}

function decideRobots(outcome, url) {
  const allowed = robotsAllowsPath(outcome, new URL(url).pathname);
  return {
    ...outcome,
    decision: allowed ? 'allowed' : outcome.robotsStatus === 'rules_loaded' ? 'disallowed' : 'blocked',
    shouldFetchPage: allowed,
    disallowRules: outcome.disallowRules || [],
  };
}

async function robustRobotsCheck(url, pacedFetch) {
  const first = await fetchRobotsOnce(url, pacedFetch, { timeoutMs: ROBOTS_TIMEOUT_MS });
  if (first.robotsStatus !== 'unreachable') return { ...decideRobots(first, url), attempts: 1 };
  const second = await fetchRobotsOnce(url, pacedFetch, { timeoutMs: ROBOTS_RETRY_TIMEOUT_MS });
  return {
    ...decideRobots(second, url),
    attempts: 2,
    firstAttempt: { robotsStatus: first.robotsStatus, httpStatus: first.httpStatus || null, detail: first.detail || null },
  };
}

/** One line the report can print: what exactly happened with robots.txt. */
function describeRobotsAttempt(gate) {
  if (!gate) return null;
  const first = gate.firstAttempt || null;
  const reason = gate.detail || (gate.httpStatus ? `http ${gate.httpStatus}` : 'onbekend');
  const text = `${gate.robotsStatus} (${reason}${gate.attempts > 1 ? `, na een tweede poging met ${ROBOTS_RETRY_TIMEOUT_MS} ms` : ''})`;
  return first ? `${text}; eerste poging: ${first.robotsStatus} (${first.detail || (first.httpStatus ? `http ${first.httpStatus}` : 'onbekend')})` : text;
}


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
    return robustRobotsCheck(url, pacedFetch);
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
    // A refusal written before the retry policy existed is checked once more:
    // the report must say what really happened, not repeat an older guess.
    if (cached && !(cached.ok === false && cached.robotsPolicy !== ROBOTS_CACHE_POLICY)) {
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
      // A robots.txt that could not be read because the site itself does not
      // resolve or does not answer is a different report line than a site that
      // refuses: "site niet bereikbaar" (Lead review ronde 5, #176). A 5xx on
      // robots.txt alone keeps its own robots line.
      const siteUnreachable = gate.robotsStatus === 'unreachable' && (gate.httpStatus === null || gate.httpStatus === undefined);
      const entry = {
        ok: false,
        url,
        reason: siteUnreachable ? 'unreachable' : 'robots',
        detail: siteUnreachable ? 'site niet bereikbaar' : describeRobotsBlock(gate),
        robotsStatus: gate.robotsStatus,
        robotsHttpStatus: gate.httpStatus || null,
        robotsDetail: gate.detail || null,
        robotsAttempt: describeRobotsAttempt(gate),
        robotsAttempts: gate.attempts || 1,
        robotsPolicy: ROBOTS_CACHE_POLICY,
      };
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

module.exports = { USER_AGENT, MIN_INTERVAL_MS, MAX_CANDIDATES, DEFAULT_CACHE_DIR, ROBOTS_RETRY_TIMEOUT_MS, createSourceFetcher, cacheKey, robustRobotsCheck, describeRobotsAttempt };
