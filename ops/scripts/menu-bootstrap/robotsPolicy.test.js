'use strict';

// BE-71 (#176, Lead-review ronde 5, punt 4) — robots.txt volgens RFC 9309:
// een doorverwijzing op robots.txt wordt gevolgd tot vijf stappen, en een site
// die niet antwoordt heet "site niet bereikbaar", niet "robots.txt".
// Alles met een nep-fetch: geen netwerk.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSourceFetcher, robustRobotsCheck } = require('./fetchSource');

const SITE = 'https://voorbeeld.nl/menu';
const ROBOTS_BODY = 'User-agent: *\r\nDisallow: /geheim\r\n';

/** Een nep-fetch die op robots.txt een keten van `hops` doorverwijzingen geeft. */
function chainFetch({ hops = 0, robotsBody = ROBOTS_BODY, robotsError = null, page = '<html><body>kaart</body></html>' } = {}) {
  const calls = [];
  let seen = 0;
  async function fetchImpl(url, options = {}) {
    calls.push({ url, userAgent: options.userAgent || null });
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt' || parsed.pathname.startsWith('/robots-')) {
      if (robotsError) throw Object.assign(new Error('robots.txt mislukt'), robotsError);
      if (seen < hops) {
        const location = new URL(`/robots-${seen + 2}.txt`, parsed.origin).href;
        seen += 1;
        throw Object.assign(new Error('doorverwijzing'), { reason: 'too-many-redirects', location, statusCode: 301 });
      }
      return { body: robotsBody, bytes: null, finalUrl: url, contentType: 'text/plain', redirected: seen > 0 };
    }
    return { body: null, bytes: Buffer.from(page, 'utf8'), finalUrl: url, contentType: 'text/html', redirected: false };
  }
  return { fetchImpl, calls };
}

const noWait = { now: () => 0, sleep: async () => {} };

test('robots.txt: een doorverwijzing wordt gevolgd, tot vijf stappen (RFC 9309)', async () => {
  for (const hops of [1, 3, 5]) {
    const { fetchImpl, calls } = chainFetch({ hops });
    const gate = await robustRobotsCheck(SITE, fetchImpl);
    assert.equal(gate.robotsStatus, 'rules_loaded', `${hops} doorverwijzingen`);
    assert.equal(gate.shouldFetchPage, true);
    assert.equal(calls.filter((call) => call.url.startsWith('https://voorbeeld.nl/robots')).length, hops + 1);
  }
});

test('robots.txt: een zesde doorverwijzing wordt geweigerd en de pagina wordt niet opgehaald', async () => {
  const { fetchImpl } = chainFetch({ hops: 6 });
  const gate = await robustRobotsCheck(SITE, fetchImpl);
  assert.notEqual(gate.robotsStatus, 'rules_loaded');
  assert.equal(gate.shouldFetchPage, false);
});

test('robots.txt: een site die niet antwoordt heet "site niet bereikbaar", geen robots.txt', async () => {
  const { fetchImpl } = chainFetch({ robotsError: { reason: 'request-error', code: 'ENOTFOUND' } });
  const fetcher = createSourceFetcher({ cacheDir: null, fetchImpl, sleep: noWait.sleep, now: noWait.now });
  const page = await fetcher.getPage(SITE);
  assert.equal(page.ok, false);
  assert.equal(page.reason, 'unreachable');
  assert.equal(page.detail, 'site niet bereikbaar');
  assert.equal(page.robotsStatus, 'unreachable');
});

test('robots.txt: een 5xx op robots.txt blijft een robots-melding, geen onbereikbare site', async () => {
  const { fetchImpl } = chainFetch({ robotsError: { reason: 'bad-status', statusCode: 503 } });
  const fetcher = createSourceFetcher({ cacheDir: null, fetchImpl, sleep: noWait.sleep, now: noWait.now });
  const page = await fetcher.getPage(SITE);
  assert.equal(page.ok, false);
  assert.equal(page.reason, 'robots');
  assert.match(page.detail, /robots\.txt/);
});

test('robots.txt: een echt verbod blijft een robots-melding en de pagina wordt nooit opgehaald', async () => {
  const { fetchImpl, calls } = chainFetch({ robotsBody: 'User-agent: *\nDisallow: /menu\n' });
  const fetcher = createSourceFetcher({ cacheDir: null, fetchImpl, sleep: noWait.sleep, now: noWait.now });
  const page = await fetcher.getPage(SITE);
  assert.equal(page.ok, false);
  assert.equal(page.reason, 'robots');
  assert.equal(calls.some((call) => call.url === SITE), false);
});
