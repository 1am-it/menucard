'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const {
  pointInRing,
  pointInPolygon,
  isPointInBreda,
  computeBbox,
  loadAndVerifyBoundaryGeometry,
  composeAddress,
  minimizeOsmNodeProperties,
  buildRecordLocator,
  computeContentHash,
  classifyAndExtractFeature,
  processGdalFeatureCollection,
  computeExtractionConfigFingerprint,
  computeIdempotencyKey,
  isSafeRedirectTarget,
  downloadWithOneValidatedRedirect,
  runPreflightChecks,
  runImport,
  createFixtureDbClient,
  assertDryRunConfirmation,
  assertMaxRecordsToStoreArg,
  assertValidMaxRecordsToStore,
  buildDryRunImportOptions,
} = require('./import-breda-osm');
const config = require('./import-breda-osm.config');
const { sha256String, canonicalJsonStringify, HaltError } = require('./capture-market-boundary');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_OSM_PATH = path.join(__dirname, '__fixtures__', 'breda-osm-candidates.osm');

// A deliberately generous cap for tests that are not themselves about the
// maxRecordsToStore feature — every such fixture produces at most a
// handful of real candidates, so this can never be the thing that limits
// what gets stored in those tests.
const GENEROUS_MAX_RECORDS = 100;

function isDockerDaemonReachable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const DOCKER_REACHABLE = isDockerDaemonReachable();
const DOCKER_SKIP_REASON =
  'Docker daemon is not reachable from this environment right now (docker info failed) — ' +
  'this test genuinely requires it and is skipped, not faked or force-passed.';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'import-breda-osm-test-'));
}

// A trivial square with one triangular hole — enough to exercise both the
// exterior-ring and hole-subtraction branches without depending on
// Breda's real geometry.
const SQUARE_WITH_HOLE_FEATURE = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [5, 6],
        [4, 4],
      ],
    ],
  },
};

// ─── Pure geometry ─────────────────────────────────────────────────────────

test('pointInRing/pointInPolygon: exterior ring includes, hole excludes', () => {
  const ring = SQUARE_WITH_HOLE_FEATURE.geometry.coordinates[0];
  assert.equal(pointInRing(5, 5, ring), true, 'center of the square is inside the exterior ring');
  assert.equal(pointInRing(20, 20, ring), false, 'far outside the square');

  assert.equal(pointInPolygon(1, 1, SQUARE_WITH_HOLE_FEATURE.geometry.coordinates), true, 'inside square, outside hole');
  assert.equal(pointInPolygon(5, 5, SQUARE_WITH_HOLE_FEATURE.geometry.coordinates), false, 'inside the hole must be excluded');
  assert.equal(pointInPolygon(50, 50, SQUARE_WITH_HOLE_FEATURE.geometry.coordinates), false, 'outside the square entirely');
});

test('isPointInBreda: MultiPolygon support (treated as "inside any part")', () => {
  const multi = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        SQUARE_WITH_HOLE_FEATURE.geometry.coordinates,
        [
          [
            [100, 100],
            [110, 100],
            [110, 110],
            [100, 110],
            [100, 100],
          ],
        ],
      ],
    },
  };
  assert.equal(isPointInBreda(1, 1, multi), true, 'inside the first polygon part');
  assert.equal(isPointInBreda(105, 105, multi), true, 'inside the second polygon part');
  assert.equal(isPointInBreda(50, 50, multi), false, 'between the two parts');
});

test('isPointInBreda against the real, committed Breda v1 geometry', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  assert.equal(isPointInBreda(4.7683, 51.5719, geo), true, 'Breda city centre is inside the real boundary');
  assert.equal(isPointInBreda(4.9041, 52.3676, geo), false, 'Amsterdam is outside the real boundary');
});

test('loadAndVerifyBoundaryGeometry halts on a tampered local file', () => {
  const tmpDir = makeTmpDir();
  try {
    const badPath = path.join(tmpDir, 'breda.geojson');
    fs.writeFileSync(badPath, JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }));
    const fakeRepoRoot = tmpDir;
    // loadAndVerifyBoundaryGeometry resolves config.BREDA.geojsonRepoPath
    // under repoRoot — recreate that exact relative path under the temp
    // "repo root" so only the file content (not the lookup path) differs.
    const nestedDir = path.join(tmpDir, path.dirname(config.BREDA.geojsonRepoPath));
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.copyFileSync(badPath, path.join(tmpDir, config.BREDA.geojsonRepoPath));

    assert.throws(
      () => loadAndVerifyBoundaryGeometry(fakeRepoRoot),
      (err) => err.name === 'HaltError' && err.reason === 'boundary-geometry-hash-mismatch'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeBbox pads a polygon bounding box outward', () => {
  const feature = { geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } };
  const bbox = computeBbox(feature, 1);
  assert.deepEqual(bbox, { minLon: -1, minLat: -1, maxLon: 11, maxLat: 11 });
});

// ─── Data minimisation ──────────────────────────────────────────────────────

test('composeAddress composes available components and returns null when nothing is present', () => {
  assert.equal(
    composeAddress({ street: 'Teststraat', houseNumber: '12', postcode: '4811AB', city: 'Breda', country: null }),
    'Teststraat 12, 4811AB Breda'
  );
  assert.equal(composeAddress({ street: null, houseNumber: null, postcode: null, city: null, country: null }), null);
  assert.equal(composeAddress({ street: 'Onlystraat', houseNumber: null, postcode: null, city: null, country: null }), 'Onlystraat');
});

test('minimizeOsmNodeProperties only ever reads the fixed allowlist — extra tags never leak through', () => {
  const fields = minimizeOsmNodeProperties(
    {
      amenity: 'restaurant',
      name: 'Some Place',
      phone: '+31 76 0000000',
      website: 'https://example.test',
      addr_street: 'Teststraat',
      addr_housenumber: '1',
      addr_city: 'Breda',
      addr_postcode: '4811AA',
      // Never listed in osmconf.ini's attributes= and never read here —
      // present only to prove minimizeOsmNodeProperties ignores anything
      // outside its fixed allowlist, defense-in-depth on top of
      // osmconf.ini's own other_tags=no.
      cuisine: 'italian',
      opening_hours: 'Mo-Su 12:00-22:00',
      operator: 'Some Person Name',
    },
    { lon: 4.78, lat: 51.58, osmId: '4001' }
  );

  assert.deepEqual(Object.keys(fields).sort(), ['address', 'category', 'location', 'name', 'osm_node_id', 'phone', 'website'].sort());
  assert.equal(fields.name, 'Some Place');
  assert.equal(fields.category, 'restaurant');
  assert.equal(fields.osm_node_id, '4001');
  assert.deepEqual(fields.location, { lat: 51.58, lon: 4.78 });
  assert.equal('cuisine' in fields, false);
  assert.equal('opening_hours' in fields, false);
  assert.equal('operator' in fields, false);
});

test('minimizeOsmNodeProperties falls back to contact:*-derived fields when the primary field is absent', () => {
  const fields = minimizeOsmNodeProperties(
    { amenity: 'cafe', name: 'Fallback Cafe', contact_phone: '+31 76 1111111', contact_website: 'https://fallback.test' },
    { lon: 4.77, lat: 51.59, osmId: '4002' }
  );
  assert.equal(fields.phone, '+31 76 1111111');
  assert.equal(fields.website, 'https://fallback.test');
});

test('minimizeOsmNodeProperties on a minimal node keeps only category/location/osm_node_id', () => {
  const fields = minimizeOsmNodeProperties({ amenity: 'bar' }, { lon: 4.75, lat: 51.6, osmId: '4003' });
  assert.deepEqual(Object.keys(fields).sort(), ['category', 'location', 'osm_node_id'].sort());
});

test('computeContentHash is deterministic and matches an independently-computed hash', () => {
  const extractedFields = { name: 'X', category: 'restaurant', location: { lat: 1, lon: 2 }, osm_node_id: '1' };
  const recordLocator = buildRecordLocator('1');
  const hash = computeContentHash(extractedFields, recordLocator);
  const expected = sha256String(canonicalJsonStringify({ extracted_fields: extractedFields, record_locator: recordLocator }));
  assert.equal(hash, expected);
  assert.equal(computeContentHash(extractedFields, recordLocator), hash, 'deterministic — same input, same hash');
  assert.notEqual(
    computeContentHash({ ...extractedFields, name: 'Y' }, recordLocator),
    hash,
    'a changed extracted field must change the hash'
  );
});

// ─── classifyAndExtractFeature / processGdalFeatureCollection (pure) ──────

function fakeGeoJsonFeature({ osmId, amenity, lon, lat, geometryType = 'Point', extraProps = {} }) {
  return {
    type: 'Feature',
    properties: { osm_id: osmId, amenity, name: `Fixture ${osmId}`, ...extraProps },
    geometry: geometryType ? { type: geometryType, coordinates: geometryType === 'Point' ? [lon, lat] : [[[lon, lat]]] } : null,
  };
}

test('classifyAndExtractFeature: stored when inside boundary and amenity-allowed', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  const result = classifyAndExtractFeature(fakeGeoJsonFeature({ osmId: '9001', amenity: 'restaurant', lon: 4.7683, lat: 51.5719 }), {
    bredaGeojson: geo,
    allowedAmenityValues: config.ALLOWED_AMENITY_VALUES,
    seenOsmIds: new Set(),
    retrievedAt: '2026-09-05T00:00:00.000Z',
  });
  assert.equal(result.outcome, 'stored');
  assert.equal(result.record.record_locator, 'osm:node:9001');
  assert.equal(result.record.extracted_fields.category, 'restaurant');
});

test('classifyAndExtractFeature: skipped when outside the Breda boundary', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  const result = classifyAndExtractFeature(fakeGeoJsonFeature({ osmId: '9002', amenity: 'restaurant', lon: 4.9041, lat: 52.3676 }), {
    bredaGeojson: geo,
    allowedAmenityValues: config.ALLOWED_AMENITY_VALUES,
    seenOsmIds: new Set(),
    retrievedAt: '2026-09-05T00:00:00.000Z',
  });
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.reason, 'outside-breda-boundary');
});

test('classifyAndExtractFeature: errored on a disallowed amenity value', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  const result = classifyAndExtractFeature(fakeGeoJsonFeature({ osmId: '9003', amenity: 'shop', lon: 4.7683, lat: 51.5719 }), {
    bredaGeojson: geo,
    allowedAmenityValues: config.ALLOWED_AMENITY_VALUES,
    seenOsmIds: new Set(),
    retrievedAt: '2026-09-05T00:00:00.000Z',
  });
  assert.equal(result.outcome, 'errored');
  assert.equal(result.reason, 'amenity-not-allowed');
});

test('classifyAndExtractFeature: errored on missing/invalid geometry', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  const result = classifyAndExtractFeature(
    { type: 'Feature', properties: { osm_id: '9004', amenity: 'restaurant' }, geometry: null },
    { bredaGeojson: geo, allowedAmenityValues: config.ALLOWED_AMENITY_VALUES, seenOsmIds: new Set(), retrievedAt: 'now' }
  );
  assert.equal(result.outcome, 'errored');
  assert.equal(result.reason, 'invalid-or-missing-geometry');
});

test('classifyAndExtractFeature: a duplicate OSM node id within one run is rejected, not stored twice', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  const seenOsmIds = new Set();
  const feature = fakeGeoJsonFeature({ osmId: '9005', amenity: 'restaurant', lon: 4.7683, lat: 51.5719 });

  const first = classifyAndExtractFeature(feature, {
    bredaGeojson: geo,
    allowedAmenityValues: config.ALLOWED_AMENITY_VALUES,
    seenOsmIds,
    retrievedAt: 'now',
  });
  const second = classifyAndExtractFeature(feature, {
    bredaGeojson: geo,
    allowedAmenityValues: config.ALLOWED_AMENITY_VALUES,
    seenOsmIds,
    retrievedAt: 'now',
  });

  assert.equal(first.outcome, 'stored');
  assert.equal(second.outcome, 'errored');
  assert.equal(second.reason, 'duplicate-osm-node-id');
});

test('processGdalFeatureCollection aggregates stored/skipped/errored counts correctly', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  const featureCollection = {
    type: 'FeatureCollection',
    features: [
      fakeGeoJsonFeature({ osmId: '1', amenity: 'restaurant', lon: 4.7683, lat: 51.5719 }), // stored
      fakeGeoJsonFeature({ osmId: '2', amenity: 'restaurant', lon: 4.9041, lat: 52.3676 }), // skipped (outside)
      fakeGeoJsonFeature({ osmId: '3', amenity: 'shop', lon: 4.7683, lat: 51.5719 }), // errored (amenity)
      fakeGeoJsonFeature({ osmId: '1', amenity: 'restaurant', lon: 4.7683, lat: 51.5719 }), // errored (duplicate of "1")
    ],
  };
  const result = processGdalFeatureCollection(featureCollection, {
    bredaGeojson: geo,
    allowedAmenityValues: config.ALLOWED_AMENITY_VALUES,
    retrievedAt: 'now',
    maxRecordsToStore: GENEROUS_MAX_RECORDS,
  });
  assert.deepEqual(result.record_counts, { fetched: 4, stored: 1, skipped: 1, errored: 2 });
  assert.equal(result.records.length, 1);
  assert.equal(result.error_log.length, 2);
});

// ─── maxRecordsToStore: the mandatory storage cap ─────────────────────────

test('processGdalFeatureCollection: never stores more than maxRecordsToStore, even when more valid candidates match', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  // 15 distinct, individually valid, in-Breda restaurant nodes — more
  // than the cap below.
  const features = Array.from({ length: 15 }, (_, i) =>
    fakeGeoJsonFeature({ osmId: `cap-${i}`, amenity: 'restaurant', lon: 4.7683, lat: 51.5719 })
  );
  const result = processGdalFeatureCollection(
    { type: 'FeatureCollection', features },
    { bredaGeojson: geo, allowedAmenityValues: config.ALLOWED_AMENITY_VALUES, retrievedAt: 'now', maxRecordsToStore: 10 }
  );
  assert.equal(result.records.length, 10, 'never more than the cap, even though 15 candidates were individually valid');
  assert.deepEqual(result.record_counts, { fetched: 15, stored: 10, skipped: 5, errored: 0 });
  assert.equal(result.error_log.length, 0, 'candidates excluded only by the cap are not errors — nothing about them is wrong');
});

test('processGdalFeatureCollection: exactly maxRecordsToStore candidates are stored when there are exactly that many', () => {
  const geo = loadAndVerifyBoundaryGeometry(REPO_ROOT);
  const features = Array.from({ length: 10 }, (_, i) =>
    fakeGeoJsonFeature({ osmId: `exact-${i}`, amenity: 'restaurant', lon: 4.7683, lat: 51.5719 })
  );
  const result = processGdalFeatureCollection(
    { type: 'FeatureCollection', features },
    { bredaGeojson: geo, allowedAmenityValues: config.ALLOWED_AMENITY_VALUES, retrievedAt: 'now', maxRecordsToStore: 10 }
  );
  assert.equal(result.records.length, 10);
  assert.equal(result.record_counts.skipped, 0, 'exactly hitting the cap is not itself a skip');
});

// ─── Idempotency ───────────────────────────────────────────────────────────

test('computeIdempotencyKey is deterministic and sensitive to every documented input', () => {
  const base = {
    dataOriginSourceId: 'a',
    dataOriginSourceAuthorizationVersionId: 'b',
    accessProviderSourceId: 'c',
    accessProviderSourceAuthorizationVersionId: 'd',
    marketId: 'm',
    sourceLocator: 'loc',
    sourceVersion: null,
    sourceArtifactHash: 'hash1',
    extractionConfigFingerprint: 'fp1',
  };
  const key1 = computeIdempotencyKey(base);
  const key2 = computeIdempotencyKey({ ...base });
  assert.equal(key1, key2, 'identical input produces identical key');

  assert.notEqual(computeIdempotencyKey({ ...base, sourceLocator: 'other' }), key1);
  assert.notEqual(computeIdempotencyKey({ ...base, extractionConfigFingerprint: 'fp2' }), key1, 'a changed extraction ruleset must change the key');
  assert.notEqual(computeIdempotencyKey({ ...base, dataOriginSourceAuthorizationVersionId: 'b2' }), key1, 'a re-reviewed source authorization version must change the key');
});

test('computeIdempotencyKey (2026-09-05): a different source_artifact_hash always produces a different key, all else equal', () => {
  const base = {
    dataOriginSourceId: 'a',
    dataOriginSourceAuthorizationVersionId: 'b',
    accessProviderSourceId: 'c',
    accessProviderSourceAuthorizationVersionId: 'd',
    marketId: 'm',
    // Same sourceLocator on purpose — this is exactly the Geofabrik
    // scenario the change is for: the same URL republished with
    // genuinely different content must not be treated as a duplicate.
    sourceLocator: 'https://download.geofabrik.de/europe/netherlands-latest.osm.pbf',
    sourceVersion: null,
    extractionConfigFingerprint: 'fp1',
  };
  const keyForHashA = computeIdempotencyKey({ ...base, sourceArtifactHash: 'aaaa' });
  const keyForHashB = computeIdempotencyKey({ ...base, sourceArtifactHash: 'bbbb' });
  const keyForHashARepeat = computeIdempotencyKey({ ...base, sourceArtifactHash: 'aaaa' });

  assert.notEqual(keyForHashA, keyForHashB, 'two different artifact hashes at the same sourceLocator must produce different keys');
  assert.equal(keyForHashA, keyForHashARepeat, 'the same artifact hash must reproduce the same key');
});

test('computeExtractionConfigFingerprint changes when the allowed amenity list changes', () => {
  const originalAllowed = config.ALLOWED_AMENITY_VALUES;
  const fp1 = computeExtractionConfigFingerprint();
  config.ALLOWED_AMENITY_VALUES = ['restaurant'];
  try {
    const fp2 = computeExtractionConfigFingerprint();
    assert.notEqual(fp1, fp2);
  } finally {
    config.ALLOWED_AMENITY_VALUES = originalAllowed;
  }
});

// ─── Geofabrik redirect handling: downloadWithOneValidatedRedirect ───────
//
// Uses a real local HTTP test server (same convention as
// capture-market-boundary.test.js's own live-download tests) rather than
// a hand-rolled fake response object — exercises the real Node HTTP
// client/redirect-handling code path, not a reimplementation of it.

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stopTestServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** The redirect-target rules under test, scoped to the local test
 * server's own host/port rather than the real `download.geofabrik.de` —
 * `downloadGeofabrikExtract`'s own wrapper (untested here directly, since
 * it requires a real network round-trip) pins the real values; this is
 * the same core function it calls. */
function redirectRulesFor(port) {
  return {
    expectedProtocol: 'http:',
    expectedHost: '127.0.0.1',
    expectedPort: String(port),
    pathPattern: /^\/europe\/netherlands-\d{6}\.osm\.pbf$/,
  };
}

test('isSafeRedirectTarget: accepts an exact match, rejects host/port/path/credentials/query/fragment deviations', () => {
  const rules = { expectedProtocol: 'https:', expectedHost: 'download.geofabrik.de', expectedPort: '', pathPattern: /^\/europe\/netherlands-\d{6}\.osm\.pbf$/ };

  assert.equal(isSafeRedirectTarget(new URL('https://download.geofabrik.de/europe/netherlands-260904.osm.pbf'), rules).ok, true);

  assert.equal(isSafeRedirectTarget(new URL('https://evil.example/europe/netherlands-260904.osm.pbf'), rules).ok, false, 'wrong host');
  assert.equal(isSafeRedirectTarget(new URL('http://download.geofabrik.de/europe/netherlands-260904.osm.pbf'), rules).ok, false, 'wrong protocol');
  assert.equal(isSafeRedirectTarget(new URL('https://download.geofabrik.de:8443/europe/netherlands-260904.osm.pbf'), rules).ok, false, 'non-default port');
  assert.equal(isSafeRedirectTarget(new URL('https://user:pass@download.geofabrik.de/europe/netherlands-260904.osm.pbf'), rules).ok, false, 'credentials');
  assert.equal(isSafeRedirectTarget(new URL('https://download.geofabrik.de/europe/netherlands-260904.osm.pbf?x=1'), rules).ok, false, 'query string');
  assert.equal(isSafeRedirectTarget(new URL('https://download.geofabrik.de/europe/netherlands-260904.osm.pbf#frag'), rules).ok, false, 'fragment');
  assert.equal(isSafeRedirectTarget(new URL('https://download.geofabrik.de/europe/germany-260904.osm.pbf'), rules).ok, false, 'wrong region in path');
  assert.equal(isSafeRedirectTarget(new URL('https://download.geofabrik.de/europe/netherlands-latest.osm.pbf'), rules).ok, false, 'not the dated-file pattern');
});

test('downloadWithOneValidatedRedirect: a direct 200 on the fixed URL is accepted with no redirect', async () => {
  const body = Buffer.from('fake pbf bytes');
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(body);
  });
  try {
    const { port } = server.address();
    const result = await downloadWithOneValidatedRedirect({
      url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
      expectedProtocol: 'http:',
      expectedHost: '127.0.0.1',
      expectedPath: '/europe/netherlands-latest.osm.pbf',
      redirect: redirectRulesFor(port),
      allowedContentTypes: ['application/octet-stream'],
      maxBytes: 1024,
      requestImpl: http.get,
    });
    try {
      assert.equal(result.redirected, false);
      assert.equal(result.initialUrl, result.finalUrl);
      assert.equal(fs.readFileSync(result.filePath).equals(body), true);
    } finally {
      fs.rmSync(result.tmpDir, { recursive: true, force: true });
    }
  } finally {
    await stopTestServer(server);
  }
});

test('downloadWithOneValidatedRedirect: one valid redirect to a dated extract is followed and downloaded', async () => {
  const body = Buffer.from('fake dated pbf bytes');
  const server = await startTestServer((req, res) => {
    if (req.url === '/europe/netherlands-latest.osm.pbf') {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/europe/netherlands-260904.osm.pbf`, 'Content-Type': 'text/html' });
      res.end('<html>redirecting…</html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(body);
  });
  try {
    const { port } = server.address();
    const result = await downloadWithOneValidatedRedirect({
      url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
      expectedProtocol: 'http:',
      expectedHost: '127.0.0.1',
      expectedPath: '/europe/netherlands-latest.osm.pbf',
      redirect: redirectRulesFor(port),
      allowedContentTypes: ['application/octet-stream'],
      maxBytes: 1024,
      requestImpl: http.get,
    });
    try {
      assert.equal(result.redirected, true);
      assert.equal(result.finalUrl, `http://127.0.0.1:${port}/europe/netherlands-260904.osm.pbf`);
      assert.notEqual(result.initialUrl, result.finalUrl);
      assert.equal(fs.readFileSync(result.filePath).equals(body), true);
    } finally {
      fs.rmSync(result.tmpDir, { recursive: true, force: true });
    }
  } finally {
    await stopTestServer(server);
  }
});

test('downloadWithOneValidatedRedirect: a second redirect (from the already-redirected target) is a hard failure', async () => {
  const server = await startTestServer((req, res) => {
    if (req.url === '/europe/netherlands-latest.osm.pbf') {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/europe/netherlands-260904.osm.pbf` });
      res.end();
      return;
    }
    // The redirect target itself redirects again — must never be followed.
    res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/europe/netherlands-260905.osm.pbf` });
    res.end();
  });
  try {
    const { port } = server.address();
    let capturedTmpDir;
    await assert.rejects(
      async () => {
        try {
          return await downloadWithOneValidatedRedirect({
            url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
            expectedProtocol: 'http:',
            expectedHost: '127.0.0.1',
            expectedPath: '/europe/netherlands-latest.osm.pbf',
            redirect: redirectRulesFor(port),
            allowedContentTypes: ['application/octet-stream'],
            maxBytes: 1024,
            requestImpl: http.get,
          });
        } catch (err) {
          capturedTmpDir = err.removedTmpDir;
          throw err;
        }
      },
      (err) => err instanceof HaltError && err.reason === 'geofabrik-second-redirect-rejected'
    );
    assert.equal(capturedTmpDir, undefined, 'no temp dir is ever created before the final target is even reached');
  } finally {
    await stopTestServer(server);
  }
});

test('downloadWithOneValidatedRedirect: a redirect to a different host is rejected, never followed', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(302, { Location: 'http://evil.example/europe/netherlands-260904.osm.pbf' });
    res.end();
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        downloadWithOneValidatedRedirect({
          url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/europe/netherlands-latest.osm.pbf',
          redirect: redirectRulesFor(port),
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
          requestImpl: http.get,
        }),
      (err) => err instanceof HaltError && err.reason === 'geofabrik-redirect-target-rejected' && /hostname/.test(err.message)
    );
  } finally {
    await stopTestServer(server);
  }
});

test('downloadWithOneValidatedRedirect: a redirect to an unexpected path is rejected, never followed', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/europe/germany-260904.osm.pbf` });
    res.end();
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        downloadWithOneValidatedRedirect({
          url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/europe/netherlands-latest.osm.pbf',
          redirect: redirectRulesFor(port),
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
          requestImpl: http.get,
        }),
      (err) => err instanceof HaltError && err.reason === 'geofabrik-redirect-target-rejected' && /path/.test(err.message)
    );
  } finally {
    await stopTestServer(server);
  }
});

test('downloadWithOneValidatedRedirect: a redirect carrying a query string, fragment, credentials, or a deviating port is rejected', async () => {
  // Each variant is rejected purely by inspecting the parsed Location
  // URL, before any second request is ever issued — so a deviating-port
  // variant can safely name a port nothing is listening on, and a
  // credentials variant can safely name fake credentials, without either
  // ever actually being connected to.
  async function expectRejected(locationBuilder, matchesMessage) {
    const server = await startTestServer((req, res) => {
      res.writeHead(302, { Location: locationBuilder(server.address().port) });
      res.end();
    });
    try {
      const { port } = server.address();
      await assert.rejects(
        () =>
          downloadWithOneValidatedRedirect({
            url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
            expectedProtocol: 'http:',
            expectedHost: '127.0.0.1',
            expectedPath: '/europe/netherlands-latest.osm.pbf',
            redirect: redirectRulesFor(port),
            allowedContentTypes: ['application/octet-stream'],
            maxBytes: 1024,
            requestImpl: http.get,
          }),
        (err) => err instanceof HaltError && err.reason === 'geofabrik-redirect-target-rejected' && matchesMessage(err.message)
      );
    } finally {
      await stopTestServer(server);
    }
  }

  await expectRejected((port) => `http://127.0.0.1:${port}/europe/netherlands-260904.osm.pbf?x=1`, (msg) => /query/.test(msg));
  await expectRejected((port) => `http://127.0.0.1:${port}/europe/netherlands-260904.osm.pbf#frag`, (msg) => /fragment/.test(msg));
  await expectRejected((port) => `http://user:pass@127.0.0.1:${port}/europe/netherlands-260904.osm.pbf`, (msg) => /credentials/.test(msg));
  // A port that differs from the one this redirect rule expects — never
  // actually reachable, and never connected to; rejection happens purely
  // on the parsed URL.
  await expectRejected((port) => `http://127.0.0.1:${port + 1}/europe/netherlands-260904.osm.pbf`, (msg) => /port/.test(msg));
});

test('downloadWithOneValidatedRedirect: an unexpected final Content-Type is rejected even after a valid redirect', async () => {
  const server = await startTestServer((req, res) => {
    if (req.url === '/europe/netherlands-latest.osm.pbf') {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/europe/netherlands-260904.osm.pbf` });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>not a pbf</html>');
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        downloadWithOneValidatedRedirect({
          url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/europe/netherlands-latest.osm.pbf',
          redirect: redirectRulesFor(port),
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
          requestImpl: http.get,
        }),
      (err) => err instanceof HaltError && err.reason === 'geofabrik-download-bad-content-type'
    );
  } finally {
    await stopTestServer(server);
  }
});

test('downloadWithOneValidatedRedirect: the initial 302 response\'s own Content-Type is never treated as the file type', async () => {
  // The redirect page's Content-Type ("text/html") would fail the
  // allowlist if it were ever (wrongly) checked — proving it is truly
  // never inspected by using a final target whose real Content-Type
  // legitimately passes, while the intermediate redirect page's does not.
  const server = await startTestServer((req, res) => {
    if (req.url === '/europe/netherlands-latest.osm.pbf') {
      res.writeHead(302, {
        Location: `http://127.0.0.1:${server.address().port}/europe/netherlands-260904.osm.pbf`,
        'Content-Type': 'text/html; charset=iso-8859-1',
      });
      res.end('<html>redirecting…</html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(Buffer.from('real bytes'));
  });
  try {
    const { port } = server.address();
    const result = await downloadWithOneValidatedRedirect({
      url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
      expectedProtocol: 'http:',
      expectedHost: '127.0.0.1',
      expectedPath: '/europe/netherlands-latest.osm.pbf',
      redirect: redirectRulesFor(port),
      allowedContentTypes: ['application/octet-stream'],
      maxBytes: 1024,
      requestImpl: http.get,
    });
    fs.rmSync(result.tmpDir, { recursive: true, force: true });
  } finally {
    await stopTestServer(server);
  }
});

test('downloadWithOneValidatedRedirect: a non-200 final status (after a valid redirect) is rejected', async () => {
  const server = await startTestServer((req, res) => {
    if (req.url === '/europe/netherlands-latest.osm.pbf') {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/europe/netherlands-260904.osm.pbf` });
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('not found');
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        downloadWithOneValidatedRedirect({
          url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/europe/netherlands-latest.osm.pbf',
          redirect: redirectRulesFor(port),
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
          requestImpl: http.get,
        }),
      (err) => err instanceof HaltError && err.reason === 'geofabrik-download-bad-status'
    );
  } finally {
    await stopTestServer(server);
  }
});

test('downloadWithOneValidatedRedirect: the byte limit is enforced on the final download, with no leftover file', async () => {
  const server = await startTestServer((req, res) => {
    if (req.url === '/europe/netherlands-latest.osm.pbf') {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/europe/netherlands-260904.osm.pbf` });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.write(Buffer.alloc(2000, 1));
    res.end(Buffer.alloc(2000, 2));
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        downloadWithOneValidatedRedirect({
          url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/europe/netherlands-latest.osm.pbf',
          redirect: redirectRulesFor(port),
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
        requestImpl: http.get,
        }),
      (err) => err instanceof HaltError && err.reason === 'geofabrik-download-too-large'
    );
  } finally {
    await stopTestServer(server);
  }
});

test('runImport records the audit fields correctly after a valid redirect (source_locator/source_version/source_version_note)', async () => {
  const body = Buffer.from('fake dated pbf bytes for runImport audit test');
  const server = await startTestServer((req, res) => {
    if (req.url === '/europe/netherlands-latest.osm.pbf') {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/europe/netherlands-260904.osm.pbf` });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(body);
  });
  try {
    const { port } = server.address();
    const db = createFixtureDbClient();
    const result = await runImport({
      maxRecordsToStore: GENEROUS_MAX_RECORDS,
      live: true,
      dbClient: db,
      repoRoot: REPO_ROOT,
      gdalRunner: () => fakeFeatureCollection(),
      downloader: () =>
        downloadWithOneValidatedRedirect({
          url: `http://127.0.0.1:${port}/europe/netherlands-latest.osm.pbf`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/europe/netherlands-latest.osm.pbf',
          redirect: redirectRulesFor(port),
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
          requestImpl: http.get,
        }),
    });

    assert.equal(result.outcome, 'completed');
    assert.equal(result.importRun.source_locator, `http://127.0.0.1:${port}/europe/netherlands-260904.osm.pbf`, 'source_locator is the actually-downloaded dated URL, not the "latest" alias');
    assert.equal(result.importRun.source_version, 'netherlands-260904.osm.pbf', 'source_version is the dated file identity');
    assert.match(result.importRun.source_version_note, /netherlands-latest\.osm\.pbf/, 'note records the original "latest" URL');
    assert.match(result.importRun.source_version_note, /netherlands-260904\.osm\.pbf/, 'note records the validated redirect target');
    assert.ok(result.importRun.source_artifact_hash, 'the artifact hash is still computed from the actually-downloaded bytes');
  } finally {
    await stopTestServer(server);
  }
});

// ─── Preflight — must run before any network traffic ──────────────────────

test('runPreflightChecks succeeds against a correctly-seeded fixture db client', async () => {
  const db = createFixtureDbClient();
  const result = await runPreflightChecks(db);
  assert.equal(result.market.id, config.BREDA.marketId);
  assert.equal(result.dataOrigin.source.id, config.OSM_SOURCE.sourceId);
  assert.equal(result.accessProvider.source.id, config.GEOFABRIK_SOURCE.sourceId);
});

test('runPreflightChecks halts on a market slug mismatch', async () => {
  const db = createFixtureDbClient();
  db._state.market.slug = 'not-breda';
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-market-slug-mismatch'
  );
});

test('runPreflightChecks halts on a boundary artifact_git_ref mismatch', async () => {
  const db = createFixtureDbClient();
  db._state.boundaryVersion.artifact_git_ref = 'deadbeef';
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-artifact-git-ref-mismatch'
  );
});

test('runPreflightChecks halts on a boundary geometry_hash mismatch', async () => {
  const db = createFixtureDbClient();
  db._state.boundaryVersion.geometry_hash = 'wrong-hash';
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-boundary-geometry-hash-mismatch'
  );
});

test('runPreflightChecks halts when a source authorization version is blocked', async () => {
  const db = createFixtureDbClient();
  db._state.authorizationVersions[config.OSM_SOURCE.authorizationVersionId].status = 'blocked';
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-source-status-mismatch'
  );
});

test('runPreflightChecks (2026-09-05): halts even on the looser "allowed" status — expected status must match exactly', async () => {
  // Both OSM and Geofabrik are registered as exactly "restricted", per
  // docs/api/source-registry-schema.md. Before the 2026-09-05 tightening,
  // this tool accepted "allowed" OR "restricted" loosely; now it must
  // match config.OSM_SOURCE.expectedStatus exactly.
  const db = createFixtureDbClient();
  db._state.authorizationVersions[config.OSM_SOURCE.authorizationVersionId].status = 'allowed';
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-source-status-mismatch'
  );
});

test('runPreflightChecks halts on a source id mismatch (returned row does not match the requested id)', async () => {
  const db = createFixtureDbClient();
  db._state.sources[config.OSM_SOURCE.sourceId].id = 'some-other-source-id';
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-source-id-mismatch'
  );
});

test('runPreflightChecks halts on an authorization-version id mismatch (returned row does not match the requested id)', async () => {
  const db = createFixtureDbClient();
  db._state.authorizationVersions[config.OSM_SOURCE.authorizationVersionId].id = 'some-other-sav-id';
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-authorization-version-id-mismatch'
  );
});

test('runPreflightChecks halts when basic_info is not in allowed_data_categories', async () => {
  const db = createFixtureDbClient();
  db._state.authorizationVersions[config.GEOFABRIK_SOURCE.authorizationVersionId].allowed_data_categories = ['geospatial_reference_data'];
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-basic-info-not-allowed'
  );
});

test('runPreflightChecks halts when the primary allowed_access_method is not open_dataset_download', async () => {
  const db = createFixtureDbClient();
  db._state.authorizationVersions[config.OSM_SOURCE.authorizationVersionId].allowed_access_method = 'open_api_query';
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-primary-access-method-not-open-dataset-download'
  );
});

test('runPreflightChecks halts when geographic_applicability.market_id does not name Breda', async () => {
  const db = createFixtureDbClient();
  db._state.authorizationVersions[config.GEOFABRIK_SOURCE.authorizationVersionId].geographic_applicability = {
    country_codes: ['NL'],
    market_id: 'some-other-market-id',
  };
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-geographic-scope-mismatch'
  );
});

test('runPreflightChecks halts when geographic_applicability is entirely missing', async () => {
  const db = createFixtureDbClient();
  delete db._state.authorizationVersions[config.OSM_SOURCE.authorizationVersionId].geographic_applicability;
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-geographic-scope-mismatch'
  );
});

test('runPreflightChecks halts when raw_import is not in allowed_processing_stages', async () => {
  const db = createFixtureDbClient();
  db._state.authorizationVersions[config.GEOFABRIK_SOURCE.authorizationVersionId].allowed_processing_stages = [
    'internal_quality_review',
  ];
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-processing-stage-not-allowed'
  );
});

test('runPreflightChecks halts when a referenced source/authorization-version row is missing entirely', async () => {
  const db = createFixtureDbClient();
  delete db._state.authorizationVersions[config.OSM_SOURCE.authorizationVersionId];
  await assert.rejects(
    () => runPreflightChecks(db),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-authorization-version-missing'
  );
});

test('a preflight mismatch halts runImport before any GDAL/network call is made', async () => {
  const db = createFixtureDbClient();
  db._state.market.slug = 'not-breda';
  let gdalCalled = false;
  await assert.rejects(
    () =>
      runImport({
        maxRecordsToStore: GENEROUS_MAX_RECORDS,
        live: false,
        osmFilePath: FIXTURE_OSM_PATH,
        dbClient: db,
        repoRoot: REPO_ROOT,
        gdalRunner: () => {
          gdalCalled = true;
          return { type: 'FeatureCollection', features: [] };
        },
      }),
    (err) => err.name === 'HaltError' && err.reason === 'preflight-market-slug-mismatch'
  );
  assert.equal(gdalCalled, false, 'GDAL must never run when preflight itself failed');
});

// ─── runImport orchestration (fake gdalRunner/downloader/dbClient) ───────

function fakeFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: [fakeGeoJsonFeature({ osmId: 'run-1', amenity: 'restaurant', lon: 4.7683, lat: 51.5719 })],
  };
}

/** Shapes a fake `downloader()` resolution to match what
 * downloadWithOneValidatedRedirect actually resolves — `filePath` (not
 * the old `gpkgPath`), plus the audit fields runImport now reads
 * (`initialUrl`/`finalUrl`/`redirected`). */
function fakeDownloadResult(filePath, tmpDir, { redirected = false, finalUrl = config.LIVE_SOURCE.url, initialUrl = config.LIVE_SOURCE.url } = {}) {
  return { filePath, tmpDir, initialUrl, finalUrl, redirected };
}

test('runImport (live) inserts an ImportRun and its extraction records exactly once', async () => {
  const db = createFixtureDbClient();
  const result = await runImport({
    maxRecordsToStore: GENEROUS_MAX_RECORDS,
    live: true,
    dbClient: db,
    repoRoot: REPO_ROOT,
    gdalRunner: () => fakeFeatureCollection(),
    downloader: () => Promise.resolve(fakeDownloadResult(FIXTURE_OSM_PATH, null)),
  });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.importRun.status, 'succeeded');
  assert.equal(db._state.insertedImportRuns.length, 1);
  assert.equal(db._state.insertedExtractionRecords.length, 1);
});

// ─── maxRecordsToStore: mandatory, and enforced end to end ────────────────

test('runImport rejects a missing/invalid maxRecordsToStore before any preflight check, network access, or GDAL invocation', async () => {
  const throwsIfTouched = {
    getMarket: async () => { throw new Error('must never be called — maxRecordsToStore must be validated first'); },
    getBoundaryVersion: async () => { throw new Error('must never be called'); },
    getSource: async () => { throw new Error('must never be called'); },
    getSourceAuthorizationVersion: async () => { throw new Error('must never be called'); },
    getImportRunByIdempotencyKey: async () => { throw new Error('must never be called'); },
    insertImportRun: async () => { throw new Error('must never be called'); },
    insertExtractionRecords: async () => { throw new Error('must never be called'); },
    updateImportRunStatus: async () => { throw new Error('must never be called'); },
  };

  for (const badValue of [undefined, null, 0, -1, 3.5, '10', NaN]) {
    let gdalCalled = false;
    let downloaderCalled = false;
    await assert.rejects(
      () =>
        runImport({
          maxRecordsToStore: badValue,
          live: true,
          dbClient: throwsIfTouched,
          repoRoot: REPO_ROOT,
          gdalRunner: () => {
            gdalCalled = true;
            return fakeFeatureCollection();
          },
          downloader: () => {
            downloaderCalled = true;
            return Promise.resolve(fakeDownloadResult(FIXTURE_OSM_PATH, null));
          },
        }),
      (err) => err.name === 'HaltError' && err.reason === 'invalid-max-records-to-store',
      `expected maxRecordsToStore=${JSON.stringify(badValue)} to be rejected`
    );
    assert.equal(gdalCalled, false, 'GDAL must never run when maxRecordsToStore itself is invalid');
    assert.equal(downloaderCalled, false, 'no download must ever start when maxRecordsToStore itself is invalid');
  }
});

test('runImport (end to end): a source with more matches than maxRecordsToStore still results in at most 10 actual writes', async () => {
  const db = createFixtureDbClient();
  // 25 distinct, individually valid, in-Breda restaurant nodes — far more
  // than the cap requested below.
  const manyMatchesFeatureCollection = {
    type: 'FeatureCollection',
    features: Array.from({ length: 25 }, (_, i) =>
      fakeGeoJsonFeature({ osmId: `many-${i}`, amenity: 'restaurant', lon: 4.7683, lat: 51.5719 })
    ),
  };

  const result = await runImport({
    maxRecordsToStore: 10,
    live: true,
    dbClient: db,
    repoRoot: REPO_ROOT,
    gdalRunner: () => manyMatchesFeatureCollection,
    downloader: () => Promise.resolve(fakeDownloadResult(FIXTURE_OSM_PATH, null)),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.extractionRecords.length, 10, 'runImport\'s own return value must reflect the cap');
  assert.equal(result.importRun.record_counts.fetched, 25);
  assert.equal(result.importRun.record_counts.stored, 10);
  assert.equal(result.importRun.record_counts.skipped, 15, 'the 15 candidates beyond the cap are accounted for as skipped, not silently dropped');
  assert.equal(db._state.insertedImportRuns.length, 1, 'exactly one ImportRun');
  assert.equal(db._state.insertedExtractionRecords.length, 10, 'the database actually received at most 10 records — the real, end-to-end guarantee');
});

test('runImport idempotency: an identical re-trigger recognizes the existing run and creates nothing new', async () => {
  const db = createFixtureDbClient();
  const runOnce = () =>
    runImport({
      maxRecordsToStore: GENEROUS_MAX_RECORDS,
      live: true,
      dbClient: db,
      repoRoot: REPO_ROOT,
      gdalRunner: () => fakeFeatureCollection(),
      downloader: () => Promise.resolve(fakeDownloadResult(FIXTURE_OSM_PATH, null)),
    });

  const first = await runOnce();
  const second = await runOnce();

  assert.equal(first.outcome, 'completed');
  assert.equal(second.outcome, 'already_exists');
  assert.equal(db._state.insertedImportRuns.length, 1, 'no duplicate ImportRun row');
  assert.equal(db._state.insertedExtractionRecords.length, 1, 'no duplicate extraction records');
});

test('runImport error handling: a GDAL failure marks the ImportRun failed and still rejects', async () => {
  const db = createFixtureDbClient();
  await assert.rejects(
    () =>
      runImport({
        maxRecordsToStore: GENEROUS_MAX_RECORDS,
        live: true,
        dbClient: db,
        repoRoot: REPO_ROOT,
        gdalRunner: () => {
          const { HaltError } = require('./capture-market-boundary');
          throw new HaltError('osm-gdal-extraction-failed', 'simulated failure');
        },
        downloader: () => Promise.resolve(fakeDownloadResult(FIXTURE_OSM_PATH, null)),
      }),
    (err) => err.name === 'HaltError' && err.reason === 'osm-gdal-extraction-failed'
  );
  assert.equal(db._state.insertedImportRuns.length, 1);
  assert.equal(db._state.insertedImportRuns[0].status, 'failed');
  assert.ok(db._state.insertedImportRuns[0].completed_at);
});

test('runImport removes its temporary extraction directory on both success and failure', async () => {
  const db1 = createFixtureDbClient();
  let capturedOutDirSuccess;
  await runImport({
    maxRecordsToStore: GENEROUS_MAX_RECORDS,
    live: false,
    osmFilePath: FIXTURE_OSM_PATH,
    dbClient: db1,
    repoRoot: REPO_ROOT,
    gdalRunner: ({ outDir }) => {
      capturedOutDirSuccess = outDir;
      assert.equal(fs.existsSync(outDir), true, 'the temp dir exists while GDAL "runs"');
      return fakeFeatureCollection();
    },
  });
  assert.equal(fs.existsSync(capturedOutDirSuccess), false, 'removed after a successful run');

  const db2 = createFixtureDbClient();
  let capturedOutDirFailure;
  await assert.rejects(() =>
    runImport({
      maxRecordsToStore: GENEROUS_MAX_RECORDS,
      live: false,
      osmFilePath: FIXTURE_OSM_PATH,
      dbClient: db2,
      repoRoot: REPO_ROOT,
      gdalRunner: ({ outDir }) => {
        capturedOutDirFailure = outDir;
        const { HaltError } = require('./capture-market-boundary');
        throw new HaltError('osm-gdal-extraction-failed', 'simulated failure');
      },
    })
  );
  assert.equal(fs.existsSync(capturedOutDirFailure), false, 'removed after a failed run too');
});

test('runImport removes its temporary download directory (live mode) on both success and failure', async () => {
  const makeDownloadTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fake-geofabrik-download-'));

  const db1 = createFixtureDbClient();
  const tmp1 = makeDownloadTmp();
  fs.copyFileSync(FIXTURE_OSM_PATH, path.join(tmp1, 'netherlands-latest.osm'));
  await runImport({
    maxRecordsToStore: GENEROUS_MAX_RECORDS,
    live: true,
    dbClient: db1,
    repoRoot: REPO_ROOT,
    gdalRunner: () => fakeFeatureCollection(),
    downloader: () => Promise.resolve(fakeDownloadResult(path.join(tmp1, 'netherlands-latest.osm'), tmp1)),
  });
  assert.equal(fs.existsSync(tmp1), false, 'download temp dir removed after success');

  const db2 = createFixtureDbClient();
  const tmp2 = makeDownloadTmp();
  fs.copyFileSync(FIXTURE_OSM_PATH, path.join(tmp2, 'netherlands-latest.osm'));
  await assert.rejects(() =>
    runImport({
      maxRecordsToStore: GENEROUS_MAX_RECORDS,
      live: true,
      dbClient: db2,
      repoRoot: REPO_ROOT,
      gdalRunner: () => {
        const { HaltError } = require('./capture-market-boundary');
        throw new HaltError('osm-gdal-extraction-failed', 'simulated failure');
      },
      downloader: () => Promise.resolve(fakeDownloadResult(path.join(tmp2, 'netherlands-latest.osm'), tmp2)),
    })
  );
  assert.equal(fs.existsSync(tmp2), false, 'download temp dir removed after failure too');
});

test('runImport (dry-run) never calls any dbClient insert/update method', async () => {
  const db = createFixtureDbClient();
  const result = await runImport({
    maxRecordsToStore: GENEROUS_MAX_RECORDS,
    live: false,
    osmFilePath: FIXTURE_OSM_PATH,
    dbClient: db,
    repoRoot: REPO_ROOT,
    gdalRunner: () => fakeFeatureCollection(),
  });
  assert.equal(result.outcome, 'completed');
  assert.equal(db._state.insertedImportRuns.length, 0, 'a dry run must never insert a real ImportRun');
  assert.equal(db._state.insertedExtractionRecords.length, 0, 'a dry run must never insert real extraction records');
});

// ─── New safe "real dry-run" shape: live:true, mutate:false ──────────────

/** A dbClient wrapper that throws if any write method is ever called —
 * used to prove the new `mutate: false` dry-run mode structurally cannot
 * reach the database write path, not merely that it happens not to in
 * this particular test scenario. */
function createWriteForbiddenDbClient(baseDbClient) {
  const forbidden = (name) => async () => {
    throw new Error(`dry-run must never call dbClient.${name}()`);
  };
  return {
    ...baseDbClient,
    insertImportRun: forbidden('insertImportRun'),
    insertExtractionRecords: forbidden('insertExtractionRecords'),
    updateImportRunStatus: forbidden('updateImportRunStatus'),
  };
}

test('runImport (live: true, mutate: false — the new dry-run shape) performs a real download/hash/extraction but cannot reach the database write path', async () => {
  const db = createWriteForbiddenDbClient(createFixtureDbClient());
  const downloadTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-geofabrik-dry-run-'));
  const downloadedPath = path.join(downloadTmp, 'netherlands-latest.osm');
  fs.copyFileSync(FIXTURE_OSM_PATH, downloadedPath);

  const result = await runImport({
    maxRecordsToStore: GENEROUS_MAX_RECORDS,
    live: true,
    mutate: false,
    dbClient: db,
    repoRoot: REPO_ROOT,
    gdalRunner: () => fakeFeatureCollection(),
    downloader: () => Promise.resolve(fakeDownloadResult(downloadedPath, downloadTmp)),
  });

  // A real (here: faked-network, real-code-path) download happened —
  // proven by the fact that the download temp dir is gone afterward
  // (cleaned up, exactly like a real live run would).
  assert.equal(fs.existsSync(downloadTmp), false, 'the "downloaded" temp dir must still be cleaned up in dry-run mode');
  assert.equal(result.outcome, 'completed');
  assert.ok(result.importRun.source_artifact_hash, 'the real artifact hash must still be computed and reported');
  assert.equal(result.extractionRecords.length, 1, 'extraction/measurement still happens — only persistence is skipped');
});

test('runImport (mutate: false) still performs the idempotency read but never an insert, even when no existing run is found', async () => {
  const db = createFixtureDbClient();
  let getCalled = false;
  const originalGet = db.getImportRunByIdempotencyKey.bind(db);
  db.getImportRunByIdempotencyKey = async (key) => {
    getCalled = true;
    return originalGet(key);
  };

  await runImport({
    maxRecordsToStore: GENEROUS_MAX_RECORDS,
    live: false,
    mutate: false,
    osmFilePath: FIXTURE_OSM_PATH,
    dbClient: db,
    repoRoot: REPO_ROOT,
    gdalRunner: () => fakeFeatureCollection(),
  });

  assert.equal(getCalled, true, 'the idempotency read is still informative in dry-run mode');
  assert.equal(db._state.insertedImportRuns.length, 0);
  assert.equal(db._state.insertedExtractionRecords.length, 0);
});

// ─── assertDryRunConfirmation (CLI --dry-run gating) ──────────────────────

test('assertDryRunConfirmation requires --dry-run AND an exactly-matching --confirm-market', () => {
  assert.deepEqual(assertDryRunConfirmation([], 'breda'), { dryRun: false });
  assert.deepEqual(assertDryRunConfirmation(['--fixture', 'x.osm'], 'breda'), { dryRun: false });

  assert.throws(
    () => assertDryRunConfirmation(['--dry-run'], 'breda'),
    (err) => err instanceof HaltError && err.reason === 'dry-run-confirmation-missing',
    'expected --dry-run alone (no --confirm-market at all) to refuse'
  );

  assert.throws(
    () => assertDryRunConfirmation(['--dry-run', '--confirm-market=amsterdam'], 'breda'),
    (err) => err instanceof HaltError && err.reason === 'dry-run-confirmation-missing',
    'expected a mismatched market slug (not a free selector) to refuse'
  );

  assert.deepEqual(assertDryRunConfirmation(['--dry-run', '--confirm-market=breda'], 'breda'), {
    dryRun: true,
    marketSlug: 'breda',
  });
});

// ─── assertMaxRecordsToStoreArg / assertValidMaxRecordsToStore (CLI + core
// mandatory-limit gating) ───────────────────────────────────────────────

test('assertMaxRecordsToStoreArg requires the flag and a positive integer value', () => {
  assert.throws(
    () => assertMaxRecordsToStoreArg([]),
    (err) => err instanceof HaltError && err.reason === 'max-records-to-store-missing'
  );
  assert.throws(
    () => assertMaxRecordsToStoreArg(['--dry-run', '--confirm-market=breda']),
    (err) => err instanceof HaltError && err.reason === 'max-records-to-store-missing'
  );

  for (const badValue of ['0', '-1', 'ten', '3.5', '']) {
    assert.throws(
      () => assertMaxRecordsToStoreArg([`--max-records-to-store=${badValue}`]),
      (err) => err instanceof HaltError && err.reason === 'max-records-to-store-invalid',
      `expected --max-records-to-store=${badValue} to be rejected`
    );
  }

  assert.equal(assertMaxRecordsToStoreArg(['--max-records-to-store=10']), 10);
  assert.equal(assertMaxRecordsToStoreArg(['--live', '--confirm-market=breda', '--max-records-to-store=1']), 1);
});

test('assertValidMaxRecordsToStore accepts only positive integers', () => {
  assert.doesNotThrow(() => assertValidMaxRecordsToStore(1));
  assert.doesNotThrow(() => assertValidMaxRecordsToStore(10));
  for (const badValue of [undefined, null, 0, -1, 3.5, '10', NaN]) {
    assert.throws(
      () => assertValidMaxRecordsToStore(badValue),
      (err) => err instanceof HaltError && err.reason === 'invalid-max-records-to-store',
      `expected ${JSON.stringify(badValue)} to be rejected`
    );
  }
});

// ─── buildDryRunImportOptions: the structural "dry-run always means
// mutate: false" guarantee ─────────────────────────────────────────────

test('buildDryRunImportOptions always produces live:true, mutate:false — never derived from dbClient or any other input', () => {
  const fakeDbClientA = { marker: 'A' };
  const fakeDbClientB = createFixtureDbClient();

  for (const dbClient of [fakeDbClientA, fakeDbClientB, undefined, null]) {
    const options = buildDryRunImportOptions({ dbClient, repoRoot: REPO_ROOT, maxRecordsToStore: GENEROUS_MAX_RECORDS });
    assert.equal(options.live, true, 'dry-run must always request a real download');
    assert.equal(options.mutate, false, 'dry-run must never request a database write, regardless of dbClient');
    assert.equal(options.dbClient, dbClient, 'the given dbClient is passed through unchanged, not swapped');
    assert.equal(options.repoRoot, REPO_ROOT);
    assert.equal(options.maxRecordsToStore, GENEROUS_MAX_RECORDS, 'the given maxRecordsToStore is passed through unchanged');
  }
});

test('the exact options buildDryRunImportOptions produces, combined with a write-forbidden dbClient, complete with no write attempt', async () => {
  const db = createWriteForbiddenDbClient(createFixtureDbClient());
  const options = buildDryRunImportOptions({ dbClient: db, repoRoot: REPO_ROOT, maxRecordsToStore: GENEROUS_MAX_RECORDS });

  const result = await runImport({
    ...options,
    gdalRunner: () => fakeFeatureCollection(),
    downloader: () => Promise.resolve(fakeDownloadResult(FIXTURE_OSM_PATH, null)),
  });

  assert.equal(result.outcome, 'completed');
  assert.ok(result.importRun.source_artifact_hash, 'real measurement still happens — only persistence is skipped');
});

// ─── CLI routing (subprocess): --live / --dry-run gating, end to end ─────
//
// Runs the real script file as a child process with SUPABASE_URL/
// SUPABASE_SERVICE_ROLE_KEY explicitly cleared, so a correctly-routed
// --dry-run invocation is guaranteed to fail fast at
// createLiveDbClient() — before any network request or GDAL invocation —
// rather than risk ever reaching a real download in a test. This proves
// the CLI's routing (which flag combination reaches which branch)
// without needing real credentials or performing any real download/
// database access.

const SCRIPT_PATH = path.join(__dirname, 'import-breda-osm.js');

function runCliNoCredentials(args) {
  const env = { ...process.env };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ? err.stdout.toString() : '', stderr: err.stderr ? err.stderr.toString() : '' };
  }
}

test('CLI: --live with --confirm-market but WITHOUT --max-records-to-store refuses before reaching a database client', () => {
  const result = runCliNoCredentials(['--live', '--confirm-market=breda']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /max-records-to-store-missing/);
  assert.doesNotMatch(result.stderr, /live-db-client-not-configured/, 'must never get as far as constructing a db client without the mandatory limit');
});

test('CLI: --live --confirm-market=breda --max-records-to-store=<n> now actually starts (enabled 2026-09-05) — reaches the real live branch, not the old hard refusal', () => {
  const result = runCliNoCredentials(['--live', '--confirm-market=breda', '--max-records-to-store=10']);
  assert.equal(result.status, 1, 'fails fast here only because no Supabase credentials are configured in this test');
  assert.doesNotMatch(result.stderr, /not enabled by this project yet/, 'the old hard-refusal message must be gone — --live is meant to actually start now, given the mandatory limit');
  assert.match(
    result.stderr,
    /live-db-client-not-configured/,
    'expected it to reach createLiveDbClient() and fail there — proving it got past all CLI gating (including the new mandatory limit) with no network/GDAL/database call attempted'
  );
});

test('CLI: --live with an invalid --max-records-to-store (zero, negative, non-numeric) refuses before reaching a database client', () => {
  for (const badValue of ['0', '-1', 'ten', '3.5']) {
    const result = runCliNoCredentials(['--live', '--confirm-market=breda', `--max-records-to-store=${badValue}`]);
    assert.equal(result.status, 1, `expected failure for --max-records-to-store=${badValue}`);
    assert.match(result.stderr, /max-records-to-store-invalid/, `expected the invalid-value message for --max-records-to-store=${badValue}`);
  }
});

test('CLI: --dry-run combined with --live still routes through the --live branch, checked first', () => {
  const result = runCliNoCredentials(['--dry-run', '--live', '--confirm-market=breda']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /max-records-to-store-missing/, 'must refuse via the --live branch\'s own gating, never proceed as a dry run');
});

test('CLI: --dry-run without an exact --confirm-market=breda refuses before anything else runs', () => {
  const missing = runCliNoCredentials(['--dry-run']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /dry-run-confirmation-missing/);

  const wrongMarket = runCliNoCredentials(['--dry-run', '--confirm-market=amsterdam']);
  assert.equal(wrongMarket.status, 1);
  assert.match(wrongMarket.stderr, /dry-run-confirmation-missing/);
});

test('CLI: --dry-run --confirm-market=breda WITHOUT --max-records-to-store refuses before reaching a database client', () => {
  const result = runCliNoCredentials(['--dry-run', '--confirm-market=breda']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /max-records-to-store-missing/);
  assert.doesNotMatch(result.stderr, /live-db-client-not-configured/, 'must never get as far as constructing a db client without the mandatory limit');
});

test('CLI: --dry-run --confirm-market=breda --max-records-to-store=<n> now actually starts (reaches the real dry-run branch, not the old hard refusal)', () => {
  const result = runCliNoCredentials(['--dry-run', '--confirm-market=breda', '--max-records-to-store=10']);
  assert.equal(result.status, 1, 'fails fast here only because no Supabase credentials are configured in this test');
  assert.doesNotMatch(
    result.stderr,
    /not enabled by this project yet/,
    'the old hard-refusal message must be gone — --dry-run is meant to actually start now'
  );
  assert.match(
    result.stderr,
    /live-db-client-not-configured/,
    'expected it to reach createLiveDbClient() and fail there — proving it got past all CLI gating with no network/GDAL call attempted'
  );
});

// ─── Real, end-to-end GDAL test (the one Docker-backed test) ─────────────

test('end-to-end: real GDAL extraction against the synthetic .osm fixture produces exactly the expected Breda candidates', { skip: DOCKER_REACHABLE ? false : DOCKER_SKIP_REASON }, async () => {
  const db = createFixtureDbClient();
  const result = await runImport({
    maxRecordsToStore: GENEROUS_MAX_RECORDS,
    live: false,
    osmFilePath: FIXTURE_OSM_PATH,
    dbClient: db,
    repoRoot: REPO_ROOT,
    // No gdalRunner override — this is the real, pinned-container GDAL path.
  });

  assert.equal(result.outcome, 'completed');

  const byOsmId = Object.fromEntries(result.extractionRecords.map((r) => [r.extracted_fields.osm_node_id, r]));

  // Only the three in-boundary, allowed-amenity nodes are present. The
  // outside-boundary node (4005), the wrong-amenity node (4004), the
  // amenity-less node (4006), and the way-based "restaurant" (5001) are
  // all absent — the way in particular proves node-only v1 scope
  // structurally (the "points" layer never contained it), not via a
  // filter that happened to also catch it.
  assert.deepEqual(Object.keys(byOsmId).sort(), ['4001', '4002', '4003']);

  const inside = byOsmId['4001'];
  assert.equal(inside.extracted_fields.name, 'Fixture Restaurant Inside');
  assert.equal(inside.extracted_fields.category, 'restaurant');
  assert.equal(inside.extracted_fields.phone, '+31 76 1111111');
  assert.equal(inside.extracted_fields.website, 'https://fixture-inside.test');
  assert.equal(inside.extracted_fields.address, 'Fixturestraat 1, 4811AA Breda');
  assert.equal('cuisine' in inside.extracted_fields, false);

  const fallback = byOsmId['4002'];
  assert.equal(fallback.extracted_fields.phone, '+31 76 2222222', 'contact:phone fallback');
  assert.equal(fallback.extracted_fields.website, 'https://fixture-cafe.test', 'contact:website fallback');

  const minimal = byOsmId['4003'];
  assert.deepEqual(Object.keys(minimal.extracted_fields).sort(), ['category', 'location', 'osm_node_id']);

  assert.equal(result.importRun.record_counts.stored, 3);
  assert.equal(result.importRun.status, 'succeeded');
});
