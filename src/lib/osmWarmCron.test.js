'use strict';

// BE-34 (#81, criterion 5) — the nightly OpenStreetMap cron, proven without a
// scheduler: vercel.json holds exactly two crons and nothing else, the route is
// read-only and answers `{ ok }` only, it reuses the existing cached OSM read
// (the same tag) and it checks CRON_SECRET only when that exists. No network.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { cronAuthorized, warmResponse } = require('./osmWarm');
const { OSM_CACHE_SECONDS } = require('./osmSource');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('vercel.json holds exactly three daily crons and no other setting', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(Object.keys(config), ['crons']);
  assert.equal(config.crons.length, 3);
  // BE-46 (#106, criterium 3) voegt het dagelijkse opruimen van stemmingen toe.
  assert.deepEqual(
    config.crons.map((cron) => cron.path).sort(),
    ['/api/cron/kies-opruimen', '/api/cron/osm-breda', '/api/health/db'],
  );
  for (const cron of config.crons) {
    // "minute hour * * *": one run a day, never more.
    assert.match(cron.schedule, /^\d{1,2} \d{1,2} \* \* \*$/, `${cron.path} runs once a day`);
  }
  // The keep-alive stays exactly as it was.
  assert.equal(config.crons.find((cron) => cron.path === '/api/health/db').schedule, '17 5 * * *');
});

test('the warm-up route writes nothing and answers only { ok }', () => {
  const route = read('app/api/cron/osm-breda/route.js');
  assert.match(route, /warmOsmCache\(\)/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /warmResponse\(/);
  assert.doesNotMatch(route, /getSupabaseAdmin|\.insert\(|\.update\(|\.rpc\(|createConceptVersion/);
  // No second OSM request: the route goes through the existing cached read.
  assert.doesNotMatch(route, /fetchOverpassBusinesses|overpass-api|fetch\(/);
});

test('the warm-up reuses the one cached OSM read with the same tag and window', () => {
  const deps = read('src/lib/sourceDiscoveryRouteDeps.js');
  assert.match(deps, /export async function warmOsmCache\(\)/);
  assert.match(deps, /const result = await cachedBusinesses\(\)/);
  assert.match(deps, /tags: \['osm-breda'\]/);
  assert.match(deps, /revalidate: OSM_CACHE_SECONDS/);
  assert.equal(OSM_CACHE_SECONDS, 24 * 60 * 60);
});

test('the route only opens with the exact CRON_SECRET when one exists', () => {
  // No secret configured: reachable, and read-only anyway.
  assert.equal(cronAuthorized({ secret: null, authorization: null }), true);
  assert.equal(cronAuthorized({ secret: '', authorization: 'Bearer iets' }), true);
  assert.equal(cronAuthorized({}), true);
  // Configured: only the exact bearer passes.
  assert.equal(cronAuthorized({ secret: 'geheim', authorization: 'Bearer geheim' }), true);
  assert.equal(cronAuthorized({ secret: 'geheim', authorization: 'Bearer ander' }), false);
  assert.equal(cronAuthorized({ secret: 'geheim', authorization: null }), false);
  assert.equal(cronAuthorized({ secret: 'geheim', authorization: 'geheim' }), false);
});

test('nothing but the boolean leaves the route', () => {
  assert.deepEqual(warmResponse({ ok: true, businesses: [1, 2], fetchedAt: 'x' }), { ok: true });
  assert.deepEqual(warmResponse({ ok: false, reason: 'osm_unreachable' }), { ok: false });
  assert.deepEqual(warmResponse(null), { ok: false });
});
