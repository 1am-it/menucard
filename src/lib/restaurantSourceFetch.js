// BE-20 — the robots.txt gate and bounded, same-site redirect policy for
// the restaurant source analysis route
// (app/api/internal/v1/restaurant-analysis-jobs/route.js) only.
//
// **A deliberate, documented deviation from the shared gate, scoped to
// BE-20.** `src/lib/candidateSuggestions.js`'s `classifyRobotsGate`
// (2026-09-05 correction) treats every failure to fetch robots.txt —
// including a plain 404 — as `unconfirmed` and blocks, and the shared
// routes disable redirects entirely (`maxRedirects: 0`). The Breda
// baseline (25 real sources, code 75224ee, 2026-10-03) showed this blocks
// sites for two general reasons: 4 of 25 have no robots.txt at all (HTTP
// 404), and 2 entry URLs plus 1 menu page answer with a same-host
// redirect (a language prefix, a trailing slash). This module refines
// only those two cases, for BE-20 only; BE-18's read-url route and the
// MARKET-05A website-suggestion route keep the shared, stricter gate
// unchanged.
//
// robots.txt outcome (`classifyRobotsOutcome`):
//   - `rules_loaded`       any 200, whatever its content type (as the shared
//                          gate already does) — parsed by the existing
//                          parser and honored (Disallow rules).
//   - `missing`            404 or 410 — the file demonstrably does not
//                          exist; the page may proceed through the rest of
//                          the unchanged safe-fetch chain (RFC 9309 §2.3.1.3).
//   - `access_denied`      401, 403 or 429 — blocked, reported as such.
//   - `unreachable`        5xx, timeout, network or TLS error — blocked
//                          (RFC 9309 §2.3.1.4 treats a server error as a
//                          complete disallow).
//   - `invalid_or_unknown` everything else — any other status, an
//                          oversized file, an unsafe target, or a robots.txt
//                          redirect this policy does not follow — blocked
//                          (fail-closed).
// Only `rules_loaded` (path not disallowed) and `missing` allow a fetch.
//
// Redirect policy (`fetchSameSiteWithRedirects`): every hop is requested
// with `maxRedirects: 0`, so `safeOutboundFetch.js` applies its full SSRF
// defense (URL shape, literal-IP block list, guarded DNS lookup, size cap,
// timeout) to each hop independently. A redirect is followed only when
// all hold, otherwise it fails closed:
//   - at most MAX_REDIRECTS hops, no loop (a URL is never requested twice);
//   - a parseable `Location`, http(s) only, no credentials, no fragment;
//   - no https → http downgrade;
//   - the same site: the same hostname up to a leading `www.` — exactly the
//     existing `normalizeHostname` equivalence `sameHostDiscovery.js`
//     already uses for its same-host boundary — and the same port. Never
//     another host, never another subdomain;
//   - the target's own path passes the robots.txt gate above before it is
//     ever requested.
// The original URL, final URL, and each hop (from, to, HTTP status) are
// returned as reviewable metadata (`describeRedirects`).
//
// Never fetches anything except through the injected `fetchImpl`, which
// the route always passes as `safeOutboundFetch.js`'s `fetchWebsiteSafely`
// — still the only network egress.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const { parseRobotsTxtDisallowRules, isPathAllowedByRobots } = require('./candidateSuggestions')
const { normalizeHostname } = require('./restaurantHostMatch')
const { isSafeUrlShape } = require('./safeOutboundFetch')

const ROBOTS_STATUSES = ['rules_loaded', 'missing', 'access_denied', 'unreachable', 'invalid_or_unknown']
const MAX_REDIRECTS = 3
const ROBOTS_MAX_BYTES = 200 * 1024
const ROBOTS_TIMEOUT_MS = 5000

/** Thrown when a redirect is refused by this module's own policy. */
class RedirectPolicyError extends Error {
  constructor(reason, message, details = {}) {
    super(message || reason)
    this.name = 'RedirectPolicyError'
    this.reason = reason
    Object.assign(this, details)
  }
}

/**
 * Classifies one robots.txt fetch outcome — `{ result }` on a 200, or
 * `{ error }` (a SafeFetchError or any other error) otherwise — into
 * exactly one of ROBOTS_STATUSES. Pure.
 */
function classifyRobotsOutcome({ result, error }) {
  if (result) {
    // Any 200 is `rules_loaded`, whatever its content type — exactly the
    // shared gate's existing behavior: the body always goes through the
    // existing parser, which ignores lines that are not robots rules.
    return { robotsStatus: 'rules_loaded', httpStatus: 200 }
  }
  const reason = error && error.reason
  const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : null
  if (reason === 'bad-status' && statusCode !== null) {
    if (statusCode === 404 || statusCode === 410) return { robotsStatus: 'missing', httpStatus: statusCode }
    if (statusCode === 401 || statusCode === 403 || statusCode === 429) return { robotsStatus: 'access_denied', httpStatus: statusCode }
    if (statusCode >= 500 && statusCode <= 599) return { robotsStatus: 'unreachable', httpStatus: statusCode }
    return { robotsStatus: 'invalid_or_unknown', httpStatus: statusCode }
  }
  if (reason === 'timeout' || reason === 'request-error' || reason === 'response-error') {
    return { robotsStatus: 'unreachable', httpStatus: null, detail: reason }
  }
  return { robotsStatus: 'invalid_or_unknown', httpStatus: statusCode, detail: reason || 'unknown' }
}

/** Whether a robots outcome allows fetching `pathname`. */
function robotsAllowsPath(outcome, pathname) {
  if (outcome.robotsStatus === 'missing') return true
  if (outcome.robotsStatus !== 'rules_loaded') return false
  return isPathAllowedByRobots(outcome.disallowRules || [], pathname)
}

/**
 * Fetches and classifies `${origin}/robots.txt` for `targetUrl`, then
 * decides for its path. A robots.txt redirect is followed only within the
 * same site and at most MAX_REDIRECTS hops; anything else is
 * `invalid_or_unknown`. Returns `{ shouldFetchPage, decision,
 * robotsStatus, httpStatus, detail, robotsUrl, disallowRules }`;
 * `decision` is `allowed`, `disallowed`, or `blocked`.
 */
async function checkRobotsForUrl(targetUrl, { fetchImpl }) {
  const target = new URL(targetUrl)
  const robotsUrl = `${target.origin}/robots.txt`
  let outcome
  try {
    const result = await fetchSameSiteWithRedirects(robotsUrl, {
      fetchImpl,
      fetchOptions: { maxBytes: ROBOTS_MAX_BYTES, timeoutMs: ROBOTS_TIMEOUT_MS },
      robotsCheck: null, // robots.txt itself is never gated by robots.txt
    })
    outcome = classifyRobotsOutcome({ result: result.response })
    if (outcome.robotsStatus === 'rules_loaded') outcome.disallowRules = parseRobotsTxtDisallowRules(result.response.body)
  } catch (error) {
    outcome =
      error instanceof RedirectPolicyError
        ? { robotsStatus: 'invalid_or_unknown', httpStatus: error.statusCode || null, detail: error.reason }
        : classifyRobotsOutcome({ error })
  }
  const allowed = robotsAllowsPath(outcome, target.pathname)
  const decision = allowed ? 'allowed' : outcome.robotsStatus === 'rules_loaded' ? 'disallowed' : 'blocked'
  return { shouldFetchPage: allowed, decision, robotsUrl, disallowRules: outcome.disallowRules || [], ...outcome }
}

function sameSite(a, b) {
  return normalizeHostname(a.href) === normalizeHostname(b.href) && a.port === b.port
}

/**
 * Validates one redirect hop. Returns the next URL or throws a
 * RedirectPolicyError. Pure.
 */
function validateRedirectTarget({ location, from, start, visited, hopsSoFar, maxRedirects, statusCode }) {
  if (hopsSoFar >= maxRedirects) throw new RedirectPolicyError('redirect-limit', `More than ${maxRedirects} redirects`, { statusCode })
  if (typeof location !== 'string' || location.trim() === '') throw new RedirectPolicyError('redirect-location-invalid', 'Empty Location', { statusCode })
  let next
  try {
    next = new URL(location, from)
  } catch {
    throw new RedirectPolicyError('redirect-location-invalid', 'Unparseable Location', { statusCode })
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new RedirectPolicyError('redirect-protocol', `Refusing ${next.protocol}`, { statusCode })
  if (next.username || next.password) throw new RedirectPolicyError('redirect-credentials', 'Credentials in Location', { statusCode })
  if (next.hash) throw new RedirectPolicyError('redirect-fragment', 'Fragment in Location', { statusCode })
  if (!isSafeUrlShape(next)) throw new RedirectPolicyError('redirect-unsafe-target', 'Unsafe redirect target', { statusCode })
  if (!sameSite(next, start)) throw new RedirectPolicyError('redirect-cross-host', `Cross-site redirect to ${next.hostname}`, { statusCode })
  if (from.protocol === 'https:' && next.protocol === 'http:') throw new RedirectPolicyError('redirect-downgrade', 'https → http', { statusCode })
  if (visited.has(next.href)) throw new RedirectPolicyError('redirect-loop', 'Redirect loop', { statusCode })
  return next
}

/**
 * Fetches `url` through `fetchImpl` (always `fetchWebsiteSafely` in the
 * route), following at most MAX_REDIRECTS same-site redirects under the
 * policy in this file's header. Before each redirect target is requested,
 * `robotsCheck(nextUrl)` must allow it (pass `null` only for robots.txt
 * itself). Resolves `{ response, originalUrl, finalUrl, redirects }`;
 * rejects with the underlying SafeFetchError or a RedirectPolicyError.
 */
async function fetchSameSiteWithRedirects(url, { fetchImpl, fetchOptions = {}, robotsCheck, maxRedirects = MAX_REDIRECTS }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required')
  const start = new URL(url)
  const visited = new Set([start.href])
  const redirects = []
  let current = start
  for (;;) {
    try {
      const response = await fetchImpl(current.href, { ...fetchOptions, maxRedirects: 0 })
      return { response, originalUrl: start.href, finalUrl: response.finalUrl || current.href, redirects }
    } catch (error) {
      if (!(error && error.reason === 'too-many-redirects' && typeof error.location === 'string')) throw error
      const next = validateRedirectTarget({
        location: error.location,
        from: current,
        start,
        visited,
        hopsSoFar: redirects.length,
        maxRedirects,
        statusCode: error.statusCode,
      })
      if (robotsCheck) {
        const gate = await robotsCheck(next.href)
        if (!gate.shouldFetchPage) {
          throw new RedirectPolicyError('redirect-robots-blocked', `robots.txt does not allow ${next.pathname}`, { statusCode: error.statusCode, robotsGate: gate })
        }
      }
      redirects.push({ from: current.href, to: next.href, status: error.statusCode || null })
      visited.add(next.href)
      current = next
    }
  }
}

/** Plain-language, reviewable notes for a redirect chain (Dutch, like
 * every other note this pipeline shows a reviewer). */
function describeRedirects(redirects) {
  return (Array.isArray(redirects) ? redirects : []).map(
    (hop) => `Doorgestuurd van ${hop.from} naar ${hop.to}${hop.status ? ` (HTTP ${hop.status})` : ''}.`
  )
}

/** The plain-language reason a robots gate blocked a fetch. */
function describeRobotsBlock(gate) {
  const status = gate && gate.httpStatus ? ` (HTTP ${gate.httpStatus})` : ''
  switch (gate && gate.robotsStatus) {
    case 'rules_loaded':
      return 'robots.txt van deze site staat het ophalen van deze pagina niet toe.'
    case 'access_denied':
      return `robots.txt van deze site weigert toegang${status} — de pagina is niet opgehaald.`
    case 'unreachable':
      return `robots.txt van deze site was niet bereikbaar${status} — de pagina is niet opgehaald.`
    default:
      return `robots.txt van deze site kon niet betrouwbaar worden gelezen${status} — de pagina is niet opgehaald.`
  }
}

module.exports = {
  ROBOTS_STATUSES,
  MAX_REDIRECTS,
  RedirectPolicyError,
  classifyRobotsOutcome,
  robotsAllowsPath,
  checkRobotsForUrl,
  validateRedirectTarget,
  fetchSameSiteWithRedirects,
  describeRedirects,
  describeRobotsBlock,
}
