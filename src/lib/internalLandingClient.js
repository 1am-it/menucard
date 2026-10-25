'use strict';

// #62 — the client-side landing rule glue used by the login page (and available
// to any other sign-in entry): resolve the caller's roles and the real
// workqueue numbers, then let the one tested rule in ./internalNav decide where
// to go. It never decides anything itself and never invents a destination:
//  - no session token, failed roles call, or an account without a visible
//    module → `null` (the caller keeps its existing status page);
//  - a failed counts call → the pure rule's own safe fallback (Dekking), never
//    a guess based on partial numbers.
// Only the two existing authenticated read routes are called; no writes.

const { resolveLandingHref } = require('./internalNav');

const ME_API = '/api/internal/v1/me';
const COUNT_API = '/api/internal/v1/workqueue-counts';

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function resolveLandingAfterSignIn(accessToken, fetchImpl) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  if (!accessToken) return null;

  let roles = null;
  try {
    const res = await doFetch(ME_API, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res || !res.ok) return null;
    const data = await readJson(res);
    roles = data && Array.isArray(data.roles) ? data.roles : null;
  } catch {
    return null;
  }
  if (!roles) return null;

  let counts = null;
  try {
    const res = await doFetch(COUNT_API, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    const data = res && res.ok ? await readJson(res) : null;
    counts = data && data.counts && typeof data.counts === 'object' ? data.counts : null;
  } catch {
    counts = null;
  }

  return resolveLandingHref(roles, counts);
}

module.exports = { ME_API, COUNT_API, resolveLandingAfterSignIn };
