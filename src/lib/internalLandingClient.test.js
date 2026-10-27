'use strict';

// #62 — the client-side landing glue: which read-only endpoints are called, that
// the pure rule decides, and that no failure ever produces an invented
// destination. Fictional fetch only; no network.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ME_API, COUNT_API, resolveLandingAfterSignIn } = require('./internalLandingClient');

const internal = [{ role: 'internal' }];

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const entry = responses[url];
    if (!entry) throw new Error(`unexpected fetch: ${url}`);
    const response = typeof entry === 'function' ? entry() : entry;
    if (response instanceof Error) throw response;
    return {
      ok: response.ok !== false,
      status: response.status || (response.ok === false ? 500 : 200),
      json: async () => response.body,
    };
  };
  return { impl, calls };
}

test('a known account lands on the section with the most real open work', async () => {
  const { impl, calls } = fakeFetch({
    [ME_API]: { body: { roles: internal } },
    [COUNT_API]: { body: { counts: { 'menu-concepts': 2, 'source-triage': 7, 'import-inbox': 1 } } },
  });
  const href = await resolveLandingAfterSignIn('fixture-token', impl);
  assert.equal(href, '/internal/bronnen');
  assert.deepEqual(calls.map((call) => call.url), [ME_API, COUNT_API]);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'Bearer fixture-token');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.method, undefined, 'both calls stay read-only');
  }
});

test('equal counts keep the contract order: Menuconcepten before Bronnen', async () => {
  const { impl } = fakeFetch({
    [ME_API]: { body: { roles: internal } },
    [COUNT_API]: { body: { counts: { 'menu-concepts': 4, 'source-triage': 4, 'import-inbox': 4 } } },
  });
  assert.equal(await resolveLandingAfterSignIn('fixture-token', impl), '/internal/menu-concepts');
});

test('zero open work lands on Dekking', async () => {
  const { impl } = fakeFetch({
    [ME_API]: { body: { roles: internal } },
    [COUNT_API]: { body: { counts: { 'menu-concepts': 0, 'source-triage': 0, 'import-inbox': 0 } } },
  });
  assert.equal(await resolveLandingAfterSignIn('fixture-token', impl), '/internal/coverage');
});

test('an editor-only account lands on its own counted section when it has work', async () => {
  const { impl } = fakeFetch({
    [ME_API]: { body: { roles: [{ role: 'editor' }] } },
    [COUNT_API]: { body: { counts: { moderation: 3 } } },
  });
  assert.equal(await resolveLandingAfterSignIn('fixture-token', impl), '/internal/moderation');
});

test('a failed counts call falls back to Dekking — never a guessed winner from partial numbers', async () => {
  const failed = fakeFetch({
    [ME_API]: { body: { roles: internal } },
    [COUNT_API]: { ok: false, body: { error: 'boom' } },
  });
  assert.equal(await resolveLandingAfterSignIn('fixture-token', failed.impl), '/internal/coverage');

  const threw = fakeFetch({
    [ME_API]: { body: { roles: internal } },
    [COUNT_API]: new Error('network down'),
  });
  assert.equal(await resolveLandingAfterSignIn('fixture-token', threw.impl), '/internal/coverage');
});

test('an account without a usable role gets null, so the caller keeps its existing status page', async () => {
  for (const roles of [[], [{ role: 'owner', restaurant_id: '9001' }]]) {
    const { impl } = fakeFetch({ [ME_API]: { body: { roles } } });
    assert.equal(await resolveLandingAfterSignIn('fixture-token', impl), null);
  }
});

test('a failed or missing roles lookup gets null and never calls the counts route', async () => {
  const denied = fakeFetch({ [ME_API]: { ok: false, status: 401, body: { error: 'Niet ingelogd.' } } });
  assert.equal(await resolveLandingAfterSignIn('fixture-token', denied.impl), null);
  assert.deepEqual(denied.calls.map((call) => call.url), [ME_API]);

  const threw = fakeFetch({ [ME_API]: new Error('network down') });
  assert.equal(await resolveLandingAfterSignIn('fixture-token', threw.impl), null);
});

test('no token means no request and no destination', async () => {
  const { impl, calls } = fakeFetch({});
  assert.equal(await resolveLandingAfterSignIn('', impl), null);
  assert.deepEqual(calls, []);
});
