'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const { SafeFetchError, fetchWebsiteSafely } = require('./safeOutboundFetch')
const {
  ROBOTS_STATUSES,
  MAX_REDIRECTS,
  RedirectPolicyError,
  classifyRobotsOutcome,
  checkRobotsForUrl,
  fetchSameSiteWithRedirects,
  describeRedirects,
  describeRobotsBlock,
} = require('./restaurantSourceFetch')

/**
 * A stand-in for `fetchWebsiteSafely` with `maxRedirects: 0`: `routes` maps
 * an exact URL to `{ status, location?, contentType?, body?, error? }`.
 * Records every requested URL so a test can prove a target was never hit.
 */
function fakeFetch(routes) {
  const calls = []
  async function fetchImpl(url, options) {
    calls.push(url)
    assert.equal(options.maxRedirects, 0, 'every hop must be requested with maxRedirects: 0')
    const route = routes[url]
    if (!route) throw new SafeFetchError('bad-status', 'Expected HTTP 200, got 404', { statusCode: 404 })
    if (route.error) throw new SafeFetchError(route.error, route.error)
    if (route.status >= 300 && route.status < 400 && route.location !== undefined) {
      throw new SafeFetchError('too-many-redirects', 'redirect', { statusCode: route.status, location: route.location })
    }
    if (route.status !== 200) throw new SafeFetchError('bad-status', `got ${route.status}`, { statusCode: route.status })
    return { body: route.body || '', bytes: null, finalUrl: url, contentType: route.contentType === undefined ? 'text/html' : route.contentType, redirected: false }
  }
  fetchImpl.calls = calls
  return fetchImpl
}

const ROBOTS_OK = { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /privé\nDisallow: /private\n' }

// ─── robots.txt classification ─────────────────────────────────────────────

test('classifyRobotsOutcome: every outcome maps to exactly one of the five statuses', () => {
  const cases = [
    [{ result: { contentType: 'text/plain' } }, 'rules_loaded', 200],
    [{ result: { contentType: null } }, 'rules_loaded', 200],
    [{ result: { contentType: 'text/html' } }, 'rules_loaded', 200],
    [{ result: { contentType: 'application/octet-stream' } }, 'rules_loaded', 200],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 404 }) }, 'missing', 404],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 410 }) }, 'missing', 410],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 401 }) }, 'access_denied', 401],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 403 }) }, 'access_denied', 403],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 429 }) }, 'access_denied', 429],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 500 }) }, 'unreachable', 500],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 503 }) }, 'unreachable', 503],
    [{ error: new SafeFetchError('timeout') }, 'unreachable', null],
    [{ error: new SafeFetchError('request-error', 'ECONNREFUSED') }, 'unreachable', null],
    [{ error: new SafeFetchError('request-error', 'unable to verify the first certificate') }, 'unreachable', null],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 400 }) }, 'invalid_or_unknown', 400],
    [{ error: new SafeFetchError('bad-status', '', { statusCode: 418 }) }, 'invalid_or_unknown', 418],
    [{ error: new SafeFetchError('response-too-large') }, 'invalid_or_unknown', null],
    [{ error: new SafeFetchError('resolved-address-not-allowed') }, 'invalid_or_unknown', null],
    [{ error: new Error('something else') }, 'invalid_or_unknown', null],
  ]
  for (const [input, status, httpStatus] of cases) {
    const outcome = classifyRobotsOutcome(input)
    assert.equal(outcome.robotsStatus, status, JSON.stringify(input.result || { reason: input.error.reason, statusCode: input.error.statusCode }))
    assert.equal(outcome.httpStatus, httpStatus)
    assert.ok(ROBOTS_STATUSES.includes(outcome.robotsStatus))
  }
})

test('checkRobotsForUrl: 200 text/plain loads and honors Disallow rules — allowed and disallowed paths', async () => {
  const fetchImpl = fakeFetch({ 'https://site.example/robots.txt': ROBOTS_OK })
  const allowed = await checkRobotsForUrl('https://site.example/menu', { fetchImpl })
  assert.equal(allowed.robotsStatus, 'rules_loaded')
  assert.equal(allowed.decision, 'allowed')
  assert.equal(allowed.shouldFetchPage, true)
  const denied = await checkRobotsForUrl('https://site.example/private/menu', { fetchImpl })
  assert.equal(denied.decision, 'disallowed')
  assert.equal(denied.shouldFetchPage, false)
})

test('checkRobotsForUrl: a 200 served as text/html is still rules_loaded and goes through the existing parser — the shared gate\'s behavior (regression: Breda re-measurement)', async () => {
  // An HTML page served for /robots.txt: no robots lines, so nothing is disallowed.
  const html = fakeFetch({ 'https://site.example/robots.txt': { status: 200, contentType: 'text/html', body: '<html><body>Welkom</body></html>' } })
  const allowed = await checkRobotsForUrl('https://site.example/menu', { fetchImpl: html })
  assert.equal(allowed.robotsStatus, 'rules_loaded')
  assert.equal(allowed.httpStatus, 200)
  assert.deepEqual(allowed.disallowRules, [])
  assert.equal(allowed.shouldFetchPage, true)

  // Real robots rules in a text/html response are still parsed and honored.
  const rulesAsHtml = fakeFetch({ 'https://site.example/robots.txt': { ...ROBOTS_OK, contentType: 'text/html' } })
  const denied = await checkRobotsForUrl('https://site.example/private/menu', { fetchImpl: rulesAsHtml })
  assert.equal(denied.robotsStatus, 'rules_loaded')
  assert.equal(denied.decision, 'disallowed')
  assert.equal(denied.shouldFetchPage, false)
  assert.deepEqual(denied.disallowRules, ['/privé', '/private'])
})

test('checkRobotsForUrl: 404 and 410 are `missing` and allow the page; 401/403/429, 5xx, network errors and other answers block', async () => {
  const expectations = [
    [{ status: 404 }, 'missing', true],
    [{ status: 410 }, 'missing', true],
    [{ status: 401 }, 'access_denied', false],
    [{ status: 403 }, 'access_denied', false],
    [{ status: 429 }, 'access_denied', false],
    [{ status: 500 }, 'unreachable', false],
    [{ status: 503 }, 'unreachable', false],
    [{ error: 'timeout' }, 'unreachable', false],
    [{ error: 'request-error' }, 'unreachable', false],
    [{ status: 400 }, 'invalid_or_unknown', false],
  ]
  for (const [route, status, shouldFetchPage] of expectations) {
    const gate = await checkRobotsForUrl('https://site.example/', { fetchImpl: fakeFetch({ 'https://site.example/robots.txt': route }) })
    assert.equal(gate.robotsStatus, status, JSON.stringify(route))
    assert.equal(gate.shouldFetchPage, shouldFetchPage, JSON.stringify(route))
    assert.equal(gate.decision, shouldFetchPage ? 'allowed' : 'blocked')
  }
})

test('checkRobotsForUrl: a same-site robots.txt redirect is followed; a cross-site one is invalid_or_unknown and blocks', async () => {
  const followed = await checkRobotsForUrl('https://site.example/', {
    fetchImpl: fakeFetch({
      'https://site.example/robots.txt': { status: 301, location: 'https://www.site.example/robots.txt' },
      'https://www.site.example/robots.txt': ROBOTS_OK,
    }),
  })
  assert.equal(followed.robotsStatus, 'rules_loaded')
  assert.equal(followed.shouldFetchPage, true)

  const crossSite = fakeFetch({ 'https://site.example/robots.txt': { status: 302, location: 'https://cdn.other.example/robots.txt' } })
  const blocked = await checkRobotsForUrl('https://site.example/', { fetchImpl: crossSite })
  assert.equal(blocked.robotsStatus, 'invalid_or_unknown')
  assert.equal(blocked.detail, 'redirect-cross-host')
  assert.equal(blocked.shouldFetchPage, false)
  assert.deepEqual(crossSite.calls, ['https://site.example/robots.txt'], 'the cross-site target is never requested')
})

// ─── redirect policy ───────────────────────────────────────────────────────

function allowAll() {
  return async () => ({ shouldFetchPage: true, decision: 'allowed', robotsStatus: 'missing' })
}

test('fetchSameSiteWithRedirects: a relative same-host redirect is followed and recorded as reviewable metadata', async () => {
  const fetchImpl = fakeFetch({
    'https://site.example/': { status: 301, location: 'nl/' },
    'https://site.example/nl/': { status: 200 },
  })
  const result = await fetchSameSiteWithRedirects('https://site.example/', { fetchImpl, robotsCheck: allowAll() })
  assert.equal(result.originalUrl, 'https://site.example/')
  assert.equal(result.finalUrl, 'https://site.example/nl/')
  assert.deepEqual(result.redirects, [{ from: 'https://site.example/', to: 'https://site.example/nl/', status: 301 }])
  assert.deepEqual(describeRedirects(result.redirects), ['Doorgestuurd van https://site.example/ naar https://site.example/nl/ (HTTP 301).'])
})

test('fetchSameSiteWithRedirects: canonicalization between the main host and its www variant, and an http → https upgrade, are allowed', async () => {
  for (const [from, to] of [
    ['https://site.example/', 'https://www.site.example/'],
    ['https://www.site.example/', 'https://site.example/'],
    ['http://site.example/', 'https://site.example/'],
  ]) {
    const fetchImpl = fakeFetch({ [from]: { status: 301, location: to }, [to]: { status: 200 } })
    const result = await fetchSameSiteWithRedirects(from, { fetchImpl, robotsCheck: allowAll() })
    assert.equal(result.finalUrl, to)
  }
})

test('fetchSameSiteWithRedirects: an external host, another subdomain, a private IP, localhost, a non-HTTP(S) scheme, credentials, a fragment and a downgrade all fail closed — the target is never requested', async () => {
  const refused = [
    ['https://other.example/', 'redirect-cross-host'],
    ['https://breda.site.example/', 'redirect-cross-host'],
    ['https://example/', 'redirect-cross-host'],
    ['http://127.0.0.1/', 'redirect-unsafe-target'],
    ['http://10.0.0.5/admin', 'redirect-unsafe-target'],
    ['http://[::1]/', 'redirect-unsafe-target'],
    ['http://localhost/', 'redirect-unsafe-target'],
    ['ftp://site.example/menu.pdf', 'redirect-protocol'],
    ['javascript:alert(1)', 'redirect-protocol'],
    ['file:///etc/passwd', 'redirect-protocol'],
    ['https://user:pw@site.example/', 'redirect-credentials'],
    ['https://site.example/menu#top', 'redirect-fragment'],
    ['http://site.example/', 'redirect-downgrade'],
  ]
  for (const [location, reason] of refused) {
    const fetchImpl = fakeFetch({ 'https://site.example/': { status: 302, location } })
    await assert.rejects(
      () => fetchSameSiteWithRedirects('https://site.example/', { fetchImpl, robotsCheck: allowAll() }),
      (err) => err instanceof RedirectPolicyError && err.reason === reason && err.statusCode === 302,
      location
    )
    assert.deepEqual(fetchImpl.calls, ['https://site.example/'], `${location} must never be requested`)
  }
})

test('fetchSameSiteWithRedirects: a loop, an exceeded limit and an invalid Location fail closed', async () => {
  const loop = fakeFetch({
    'https://site.example/a': { status: 302, location: '/b' },
    'https://site.example/b': { status: 302, location: '/a' },
  })
  await assert.rejects(() => fetchSameSiteWithRedirects('https://site.example/a', { fetchImpl: loop, robotsCheck: allowAll() }), (err) => err.reason === 'redirect-loop')

  const routes = {}
  for (let i = 0; i <= MAX_REDIRECTS + 1; i += 1) routes[`https://site.example/${i}`] = { status: 302, location: `/${i + 1}` }
  const chain = fakeFetch(routes)
  await assert.rejects(() => fetchSameSiteWithRedirects('https://site.example/0', { fetchImpl: chain, robotsCheck: allowAll() }), (err) => err.reason === 'redirect-limit')
  assert.equal(chain.calls.length, MAX_REDIRECTS + 1, 'never more than MAX_REDIRECTS hops are requested')

  const invalid = fakeFetch({ 'https://site.example/': { status: 301, location: 'http://[bad' } })
  await assert.rejects(() => fetchSameSiteWithRedirects('https://site.example/', { fetchImpl: invalid, robotsCheck: allowAll() }), (err) => err.reason === 'redirect-location-invalid')
})

test('fetchSameSiteWithRedirects: a redirect target is gated by robots.txt before it is ever requested', async () => {
  const fetchImpl = fakeFetch({
    'https://site.example/': { status: 302, location: '/private/menu' },
    'https://site.example/robots.txt': ROBOTS_OK,
  })
  const robotsCheck = (url) => checkRobotsForUrl(url, { fetchImpl })
  await assert.rejects(
    () => fetchSameSiteWithRedirects('https://site.example/', { fetchImpl, robotsCheck }),
    (err) => err.reason === 'redirect-robots-blocked' && err.robotsGate.decision === 'disallowed'
  )
  assert.equal(fetchImpl.calls.includes('https://site.example/private/menu'), false)
})

test('fetchSameSiteWithRedirects: an ordinary non-redirect failure is passed through unchanged; fetchImpl is required', async () => {
  const fetchImpl = fakeFetch({ 'https://site.example/': { status: 404 } })
  await assert.rejects(() => fetchSameSiteWithRedirects('https://site.example/', { fetchImpl, robotsCheck: allowAll() }), (err) => err instanceof SafeFetchError && err.statusCode === 404)
  await assert.rejects(() => fetchSameSiteWithRedirects('https://site.example/', { robotsCheck: allowAll() }), TypeError)
})

test('describeRobotsBlock: names the real reason in plain language', () => {
  assert.match(describeRobotsBlock({ robotsStatus: 'access_denied', httpStatus: 403 }), /weigert toegang \(HTTP 403\)/)
  assert.match(describeRobotsBlock({ robotsStatus: 'unreachable', httpStatus: 503 }), /niet bereikbaar \(HTTP 503\)/)
  assert.match(describeRobotsBlock({ robotsStatus: 'invalid_or_unknown', httpStatus: null }), /niet betrouwbaar worden gelezen/)
  assert.match(describeRobotsBlock({ robotsStatus: 'rules_loaded' }), /niet toe/)
})

// ─── integration with the real fetchWebsiteSafely (local server) ─────────

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function lookupFor(map) {
  return function lookup(hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback
    const opts = typeof options === 'function' ? {} : options || {}
    if (map[hostname] instanceof Error) return cb(map[hostname])
    const address = map[hostname]
    if (!address) return cb(new SafeFetchError('resolved-address-not-allowed', `no test address for ${hostname}`))
    return opts.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4)
  }
}

test('integration: the real fetchWebsiteSafely follows a relative same-host redirect hop by hop, each hop with maxRedirects 0', async () => {
  const seen = []
  const server = await startServer((req, res) => {
    seen.push(req.url)
    if (req.url === '/') {
      res.writeHead(301, { Location: 'nl/' })
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html>ok</html>')
  })
  try {
    const { port } = server.address()
    const lookup = lookupFor({ 'site.test': '127.0.0.1' })
    const fetchImpl = (url, options) => fetchWebsiteSafely(url, { ...options, lookup })
    const result = await fetchSameSiteWithRedirects(`http://site.test:${port}/`, { fetchImpl, robotsCheck: allowAll() })
    assert.equal(result.finalUrl, `http://site.test:${port}/nl/`)
    assert.deepEqual(seen, ['/', '/nl/'])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('integration: a same-site www redirect whose hostname resolves to a private address is still refused by the SSRF guard', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(301, { Location: `http://www.site.test:${req.socket.localPort}/` })
    res.end()
  })
  try {
    const { port } = server.address()
    const lookup = lookupFor({ 'site.test': '127.0.0.1', 'www.site.test': new SafeFetchError('resolved-address-not-allowed', '10.0.0.7') })
    const fetchImpl = (url, options) => fetchWebsiteSafely(url, { ...options, lookup })
    await assert.rejects(
      () => fetchSameSiteWithRedirects(`http://site.test:${port}/`, { fetchImpl, robotsCheck: allowAll() }),
      (err) => err instanceof SafeFetchError && err.reason === 'resolved-address-not-allowed'
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
