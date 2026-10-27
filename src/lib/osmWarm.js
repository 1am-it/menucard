'use strict';

// BE-34 (#81, criterion 5) — "OpenStreetMap 's nachts ophalen".
//
// A second daily Vercel Cron calls /api/cron/osm-breda before the working day.
// That route calls exactly the same unstable_cache function (tag `osm-breda`,
// 24 h) as "Nieuw gevonden" and "Vind bronnen", so it can never request OSM more
// often than that cache allows. It writes nothing, returns nothing but `{ ok }`
// and only checks CRON_SECRET when that variable exists.
//
// The two decisions are pure and therefore provable without a scheduler:
//  - `cronAuthorized`: no secret configured means the route stays reachable
//    (read-only anyway); with a secret, only the exact bearer passes;
//  - `warmResponse`: the route answers only `{ ok }`, whatever the underlying
//    result carried.

function cronAuthorized({ secret = null, authorization = null } = {}) {
  if (typeof secret !== 'string' || secret.trim() === '') return true;
  if (typeof authorization !== 'string') return false;
  return authorization === `Bearer ${secret}`;
}

/** Nothing but `{ ok }` ever leaves this route. */
function warmResponse(result) {
  return { ok: Boolean(result && result.ok === true) };
}

module.exports = { cronAuthorized, warmResponse };
