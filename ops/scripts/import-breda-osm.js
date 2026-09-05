'use strict';

/**
 * First internal, blobless Breda OSM/Geofabrik candidate import
 * (MARKET-04A). Implements the design recorded across
 * docs/api/import-run-schema.md and docs/api/source-registry-schema.md:
 * fetch one Geofabrik Netherlands extract temporarily, select only Breda
 * candidates per Breda boundary v1, extract only the permitted minimal
 * OSM `basic_info` fields, and stage them as an `ImportRun` +
 * `ImportExtractionRecord[]` pair. Never a canonical merge, never a
 * public route, never restaurant-data exposure — those stay blocked by
 * gates 3B/4B, untouched by this script.
 *
 * Node-only scope for v1 (see docs/api/import-run-schema.md's "Update
 * (2026-09-05)" note): only the OSM/GDAL "points" layer is ever read —
 * way/relation-based locations are a known, visible, out-of-scope gap for
 * this first pass, not silently dropped.
 *
 * Mirrors capture-market-boundary.js's safety pattern throughout: a fixed
 * source route (never caller-supplied), explicit `--live
 * --confirm-market=breda` confirmation, temporary working directories
 * that are unconditionally removed, halt-on-error via `HaltError`, and
 * reuse of that module's already-tested primitives (`generateUuidV7`,
 * `sha256File`/`sha256String`, `canonicalJsonStringify`,
 * `assertLiveConfirmation`, `downloadGeoPackage`) rather than
 * reimplementing them.
 *
 * Requiring this module, or running it without `--live`/`--dry-run`,
 * never performs network access or a live Supabase mutation. Both live
 * mode (`--live --confirm-market=breda`) and dry-run mode (`--dry-run
 * --confirm-market=breda`, added 2026-09-05 — a real download/hash/GDAL
 * pass that can never write to the database, see `runImport`'s `mutate`
 * parameter) are real, wired code — not stubs — but `main()` below
 * refuses to invoke either, even when correctly confirmed: enabling
 * either for real against the real Geofabrik endpoint is a separate,
 * later, explicitly-approved step, exactly like the boundary tool's own
 * history.
 *
 * **Preflight tightening (2026-09-05)**: `verifySourceAuthorization` now
 * checks the exact source/authorization-version ids, the exact expected
 * `restricted` status, `basic_info` in `allowed_data_categories`,
 * `open_dataset_download` as the primary `allowed_access_method`, Breda's
 * exact market id in `geographic_applicability`, and `raw_import` in
 * `allowed_processing_stages` — each its own independent check with its
 * own `HaltError` reason, not one loose "usable" check.
 *
 * **Idempotency tightening (2026-09-05)**: `computeIdempotencyKey` now
 * also covers `source_artifact_hash` — the hash of the actual downloaded
 * artifact, not just its URL — so a byte-different re-publication of the
 * same Geofabrik URL is never mistaken for a duplicate of an earlier run.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { URL } = require('node:url');
const { execFileSync } = require('node:child_process');

const config = require('./import-breda-osm.config');
const {
  HaltError,
  sha256File,
  sha256String,
  canonicalJsonStringify,
  generateUuidV7,
  assertLiveConfirmation,
} = require('./capture-market-boundary');

// ─── Small utilities ──────────────────────────────────────────────────────

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildAmenityWhereClause(allowedAmenityValues) {
  return `amenity IN (${allowedAmenityValues.map(sqlStringLiteral).join(', ')})`;
}

// ─── Boundary geometry: load + verify + exact point-in-polygon ───────────

/**
 * Loads the committed Breda v1 GeoJSON from the repository and recomputes
 * its geometry_hash the same way capture-market-boundary.js's own
 * canonicalizeGeoJson does (sorted-key canonical JSON, then sha256) —
 * cross-checking the local file against the hash this project's own
 * documentation and (once live-verified) the database both record.
 * Halts rather than silently trusting a repo file that has drifted.
 */
function loadAndVerifyBoundaryGeometry(repoRoot) {
  const fullPath = path.join(repoRoot, config.BREDA.geojsonRepoPath);
  if (!fs.existsSync(fullPath)) {
    throw new HaltError('boundary-file-missing', fullPath);
  }
  const raw = fs.readFileSync(fullPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new HaltError('boundary-file-not-valid-json', fullPath);
  }
  const recomputedHash = sha256String(canonicalJsonStringify(parsed));
  if (recomputedHash !== config.BREDA.expectedGeometryHash) {
    throw new HaltError(
      'boundary-geometry-hash-mismatch',
      `expected ${config.BREDA.expectedGeometryHash}, got ${recomputedHash} for ${fullPath}`
    );
  }
  if (!parsed.geometry || (parsed.geometry.type !== 'Polygon' && parsed.geometry.type !== 'MultiPolygon')) {
    throw new HaltError('boundary-geometry-unexpected-type', String(parsed.geometry && parsed.geometry.type));
  }
  return parsed;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** `polygonCoords`: [exteriorRing, hole1, hole2, ...] — a hole subtracts
 * from the exterior, never adds. */
function pointInPolygon(lon, lat, polygonCoords) {
  if (!pointInRing(lon, lat, polygonCoords[0])) return false;
  for (let k = 1; k < polygonCoords.length; k++) {
    if (pointInRing(lon, lat, polygonCoords[k])) return false;
  }
  return true;
}

/** Exact ray-casting test against Breda's real, committed boundary
 * geometry — the authoritative in/out test. The GDAL `-spat` bbox filter
 * (see runOsmExtraction below) is only ever a cheap pre-filter; this
 * function is what actually decides whether a candidate is stored. */
function isPointInBreda(lon, lat, bredaGeojsonFeature) {
  const geom = bredaGeojsonFeature.geometry;
  if (geom.type === 'Polygon') {
    return pointInPolygon(lon, lat, geom.coordinates);
  }
  return geom.coordinates.some((polygonCoords) => pointInPolygon(lon, lat, polygonCoords));
}

/** Cheap, generous bounding box for GDAL's `-spat` pre-filter — never the
 * authoritative test (isPointInBreda is). Padded outward so the pre-filter
 * can only ever be over-inclusive, never exclude a genuine candidate. */
function computeBbox(bredaGeojsonFeature, paddingDegrees) {
  const geom = bredaGeojsonFeature.geometry;
  const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const polygonCoords of polygons) {
    for (const ring of polygonCoords) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return {
    minLon: minLon - paddingDegrees,
    minLat: minLat - paddingDegrees,
    maxLon: maxLon + paddingDegrees,
    maxLat: maxLat + paddingDegrees,
  };
}

// ─── GDAL extraction (requires Docker) ────────────────────────────────────

/**
 * Real GDAL invocation via the digest-pinned container, mirroring
 * capture-market-boundary.js's runGdalExtraction exactly: a thin,
 * directly-inspectable `docker run` wrapper, no geometry math
 * reimplemented in JavaScript. Only ever reads the `points` layer — the
 * physical enforcement of this project's node-only v1 scope: a way- or
 * relation-tagged restaurant is structurally invisible to this query, not
 * filtered out after being read.
 */
function runOsmExtraction({
  osmFilePath,
  gdalRef,
  osmConfPath,
  allowedAmenityValues,
  bbox,
  layer,
  outDir,
  execFileSyncImpl = execFileSync,
}) {
  const osmDir = path.dirname(path.resolve(osmFilePath));
  const osmName = path.basename(osmFilePath);
  const confDir = path.dirname(path.resolve(osmConfPath));
  const confName = path.basename(osmConfPath);
  const outName = 'points.geojson';

  const whereClause = buildAmenityWhereClause(allowedAmenityValues);

  const args = [
    'run',
    '--rm',
    '-v',
    `${osmDir}:/in:ro`,
    '-v',
    `${confDir}:/conf:ro`,
    '-v',
    `${path.resolve(outDir)}:/out`,
    gdalRef,
    'ogr2ogr',
    '-f',
    'GeoJSON',
    '-oo',
    `CONFIG_FILE=/conf/${confName}`,
    '-where',
    whereClause,
    '-spat',
    String(bbox.minLon),
    String(bbox.minLat),
    String(bbox.maxLon),
    String(bbox.maxLat),
    `/out/${outName}`,
    `/in/${osmName}`,
    layer,
  ];

  try {
    execFileSyncImpl('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const stderrText = err.stderr ? err.stderr.toString('utf8') : String(err.message);
    throw new HaltError(
      'osm-gdal-extraction-failed',
      `docker/GDAL invocation failed — is Docker running and is ${gdalRef} reachable? Underlying error: ${stderrText.trim()}`
    );
  }

  const outPath = path.join(outDir, outName);
  if (!fs.existsSync(outPath)) {
    throw new HaltError('osm-gdal-produced-no-output', outPath);
  }
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

// ─── Data minimisation: GDAL feature -> allowed, minimized candidate ─────

/** Composes a single "samengesteld adres" string from whatever address
 * components are present — never invents a missing component, returns
 * null rather than a partial/misleading string when nothing is present. */
function composeAddress({ street, houseNumber, postcode, city, country }) {
  const streetLine = [street, houseNumber].filter(Boolean).join(' ').trim();
  const localityLine = [postcode, city].filter(Boolean).join(' ').trim();
  const parts = [streetLine, localityLine, country].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Reads only the fixed allowlist of GDAL property keys this project is
 * authorized to extract (docs/api/source-registry-schema.md's
 * `basic_info` list) — anything else present on `properties` (e.g. a
 * freeform contributor tag GDAL happened to still carry) is never read,
 * defense-in-depth alongside osmconf.ini's own `other_tags=no`.
 */
function minimizeOsmNodeProperties(properties, { lon, lat, osmId }) {
  const fields = {};
  if (properties.name) fields.name = properties.name;

  const address = composeAddress({
    street: properties.addr_street || null,
    houseNumber: properties.addr_housenumber || null,
    postcode: properties.addr_postcode || null,
    city: properties.addr_city || null,
    country: properties.addr_country || null,
  });
  if (address) fields.address = address;

  const phone = properties.phone || properties.contact_phone || null;
  if (phone) fields.phone = phone;

  const website = properties.website || properties.contact_website || null;
  if (website) fields.website = website;

  if (properties.amenity) fields.category = properties.amenity;

  fields.location = { lat, lon };
  fields.osm_node_id = String(osmId);

  return fields;
}

function buildRecordLocator(osmId) {
  return `osm:node:${osmId}`;
}

/**
 * `content_hash` is computed **only** from the already-minimized
 * extraction plus record_locator — never from the source's raw,
 * unfiltered feature. See docs/api/import-run-schema.md's "Amendment
 * (2026-09-05): content_hash computed after minimisation, not before".
 */
function computeContentHash(extractedFields, recordLocator) {
  return sha256String(canonicalJsonStringify({ extracted_fields: extractedFields, record_locator: recordLocator }));
}

/**
 * Classifies one raw GDAL feature and either extracts it or reports why
 * it was skipped/errored. Pure function — no I/O — so every branch is
 * directly unit-testable against a synthetic FeatureCollection, without
 * Docker or a database.
 *
 * `seenOsmIds` is a caller-owned Set, mutated here — the mechanism that
 * prevents a duplicate OSM node id (within one source, one run) from ever
 * producing two extraction records, matching
 * `import_extraction_records`'s own `unique (import_run_id,
 * record_locator)` constraint at the application layer, before a DB round
 * trip is even attempted.
 */
function classifyAndExtractFeature(feature, { bredaGeojson, allowedAmenityValues, seenOsmIds, retrievedAt }) {
  const properties = feature.properties || {};
  const osmId = properties.osm_id;

  if (osmId === undefined || osmId === null || String(osmId).length === 0) {
    return { outcome: 'errored', reason: 'missing-osm-id' };
  }
  const idKey = String(osmId);

  if (seenOsmIds.has(idKey)) {
    return { outcome: 'errored', reason: 'duplicate-osm-node-id', osmId: idKey };
  }

  const amenity = properties.amenity;
  if (!allowedAmenityValues.includes(amenity)) {
    return { outcome: 'errored', reason: 'amenity-not-allowed', osmId: idKey, amenity: amenity || null };
  }

  const geom = feature.geometry;
  if (!geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
    return { outcome: 'errored', reason: 'invalid-or-missing-geometry', osmId: idKey };
  }
  const [lon, lat] = geom.coordinates;
  if (typeof lon !== 'number' || typeof lat !== 'number' || Number.isNaN(lon) || Number.isNaN(lat)) {
    return { outcome: 'errored', reason: 'non-numeric-coordinates', osmId: idKey };
  }

  // Only mark the id as seen once it has passed identity/amenity/geometry
  // validation — an errored feature's id does not consume the dedupe slot
  // a legitimately later, distinct feature might need.
  seenOsmIds.add(idKey);

  if (!isPointInBreda(lon, lat, bredaGeojson)) {
    return { outcome: 'skipped', reason: 'outside-breda-boundary', osmId: idKey };
  }

  const extractedFields = minimizeOsmNodeProperties(properties, { lon, lat, osmId: idKey });
  const recordLocator = buildRecordLocator(idKey);
  const contentHash = computeContentHash(extractedFields, recordLocator);

  return {
    outcome: 'stored',
    record: {
      record_locator: recordLocator,
      source_locator: recordLocator,
      retrieved_at: retrievedAt,
      content_hash: contentHash,
      extracted_fields: extractedFields,
    },
  };
}

/** Processes a whole GDAL-produced FeatureCollection into the final
 * extraction records plus ImportRun.record_counts/error_log — the core,
 * fully pure/unit-testable pipeline stage. */
function processGdalFeatureCollection(featureCollection, { bredaGeojson, allowedAmenityValues, retrievedAt }) {
  const features = (featureCollection && featureCollection.features) || [];
  const seenOsmIds = new Set();
  const records = [];
  const errorLog = [];
  let skipped = 0;
  let errored = 0;

  for (const feature of features) {
    const result = classifyAndExtractFeature(feature, { bredaGeojson, allowedAmenityValues, seenOsmIds, retrievedAt });
    if (result.outcome === 'stored') {
      records.push(result.record);
    } else if (result.outcome === 'skipped') {
      skipped += 1;
    } else {
      errored += 1;
      errorLog.push({ reason: result.reason, osm_id: result.osmId || null, amenity: result.amenity || null });
    }
  }

  return {
    records,
    record_counts: { fetched: features.length, stored: records.length, skipped, errored },
    error_log: errorLog,
  };
}

// ─── Idempotency ───────────────────────────────────────────────────────────

function computeExtractionConfigFingerprint() {
  const osmConfContents = fs.readFileSync(config.OSMCONF_PATH, 'utf8');
  return sha256String(
    canonicalJsonStringify({
      osmconf_ini_sha256: sha256String(osmConfContents),
      allowed_amenity_values: [...config.ALLOWED_AMENITY_VALUES].sort(),
      layer: config.GDAL.layer,
    })
  );
}

/**
 * Deterministic idempotency key, per docs/api/import-run-schema.md's
 * "Idempotency" section: a function of both source-reference pairs, the
 * market, the concrete source_locator, source_version (where the source
 * exposes one), a fingerprint of the extraction ruleset actually used,
 * and — **added 2026-09-05** — `sourceArtifactHash`, the hash of the
 * actual downloaded/used artifact. Geofabrik republishes
 * `netherlands-latest.osm.pbf` at the same URL periodically; keying only
 * on `sourceLocator` would treat two runs against two genuinely different
 * file contents (different candidates, different point-in-time data) as
 * "the same import" merely because the URL didn't change. Including the
 * artifact hash means only a byte-identical re-fetch is ever treated as a
 * duplicate; a new edition of the extract always gets a new key, even
 * against the same URL. Re-triggering the truly "same" import does not
 * silently double-count; a changed allowlist/config, a re-reviewed
 * authorization version, or a genuinely different source artifact each
 * produce a new key.
 */
function computeIdempotencyKey({
  dataOriginSourceId,
  dataOriginSourceAuthorizationVersionId,
  accessProviderSourceId,
  accessProviderSourceAuthorizationVersionId,
  marketId,
  sourceLocator,
  sourceVersion,
  sourceArtifactHash,
  extractionConfigFingerprint,
}) {
  return sha256String(
    canonicalJsonStringify({
      data_origin_source_id: dataOriginSourceId,
      data_origin_source_authorization_version_id: dataOriginSourceAuthorizationVersionId,
      access_provider_source_id: accessProviderSourceId || null,
      access_provider_source_authorization_version_id: accessProviderSourceAuthorizationVersionId || null,
      market_id: marketId,
      source_locator: sourceLocator,
      source_version: sourceVersion || null,
      source_artifact_hash: sourceArtifactHash,
      extraction_config_fingerprint: extractionConfigFingerprint,
    })
  );
}

// ─── Live source download (requires network — live mode only) ────────────

/**
 * Deliberately **not** a reuse of capture-market-boundary.js's generic
 * `downloadGeoPackage` — that function halts on ANY redirect, by design,
 * and stays completely unmodified (as does the boundary capture tool that
 * depends on it). This project's own read-only verification (2026-09-05)
 * found that Geofabrik's fixed, registered `netherlands-latest.osm.pbf`
 * URL is not itself the file — it 302-redirects to a periodically
 * re-dated artifact (confirmed: `netherlands-<YYMMDD>.osm.pbf`, e.g.
 * `netherlands-260904.osm.pbf`). This function is a self-contained,
 * strictly-scoped exception that exists **only** for this one Geofabrik
 * download path, never as a general "redirects are OK" capability.
 *
 * `url.pathname` matching `redirectPathPattern` and `url.port` being
 * exactly `expectedRedirectPort` and everything else in
 * `isSafeRedirectTarget` below is checked before the one allowed redirect
 * is ever followed — never a best-effort or partial match.
 */
function parseContentType(headerValue) {
  if (!headerValue) return null;
  return headerValue.split(';')[0].trim().toLowerCase();
}

/**
 * Whether `url` (already parsed) is a permitted redirect target. Every
 * dimension is checked explicitly and independently — protocol, host,
 * port, absence of credentials/query/fragment, and the exact dated-file
 * path pattern — so a partial match (e.g. right host, wrong path) is
 * never treated as "close enough."
 */
function isSafeRedirectTarget(url, { expectedProtocol, expectedHost, expectedPort, pathPattern }) {
  if (url.protocol !== expectedProtocol) {
    return { ok: false, reason: `protocol "${url.protocol}" !== expected "${expectedProtocol}"` };
  }
  if (url.hostname !== expectedHost) {
    return { ok: false, reason: `hostname "${url.hostname}" !== expected "${expectedHost}"` };
  }
  if (url.port !== expectedPort) {
    return { ok: false, reason: `port "${url.port || '(default)'}" !== expected "${expectedPort || '(default)'}"` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'redirect target must not carry credentials' };
  }
  if (url.search) {
    return { ok: false, reason: `redirect target must not carry a query string, got "${url.search}"` };
  }
  if (url.hash) {
    return { ok: false, reason: `redirect target must not carry a fragment, got "${url.hash}"` };
  }
  if (!pathPattern.test(url.pathname)) {
    return { ok: false, reason: `path "${url.pathname}" does not match the expected dated-extract pattern` };
  }
  return { ok: true };
}

/**
 * Downloads from `url`, allowing **zero or exactly one** redirect, to
 * exactly one validated target shape — never a general-purpose redirect
 * follower. Behaviour:
 *
 *  - a direct `200` on `url` itself is accepted and downloaded as-is;
 *  - a single `3xx` with a `Location` header pointing at a target that
 *    passes `isSafeRedirectTarget` is followed exactly once; that
 *    second request's response is then held to the exact same `200`/
 *    content-type/byte-limit rules as a direct response would be;
 *  - a second `3xx` (a redirect from the already-redirected target) is a
 *    hard `HaltError` — never followed;
 *  - a redirect to any target that fails `isSafeRedirectTarget` is a
 *    hard `HaltError` — never followed;
 *  - the **initial** `3xx` response's own `Content-Type` (almost always
 *    an HTML redirect page) is never read or treated as the file's type
 *    — that response's body is drained and discarded, unread, and only
 *    the *final* `200` response's `Content-Type` is ever checked against
 *    `allowedContentTypes`.
 *
 * Resolves `{ filePath, tmpDir, initialUrl, finalUrl, redirected }` —
 * `tmpDir` (and only `tmpDir`) must be removed by the caller once
 * `filePath` is no longer needed, exactly like `downloadGeoPackage`'s own
 * `tmpDir` contract. On any failure, the temp directory this call itself
 * created is removed before rejecting — no partial file ever survives.
 */
function downloadWithOneValidatedRedirect({
  url,
  expectedProtocol,
  expectedHost,
  expectedPath,
  redirect,
  allowedContentTypes,
  maxBytes,
  requestImpl = https.get,
}) {
  const initialUrl = new URL(url);
  if (initialUrl.protocol !== expectedProtocol) {
    throw new HaltError('geofabrik-download-protocol-rejected', `expected protocol "${expectedProtocol}", got "${initialUrl.protocol}"`);
  }
  if (initialUrl.hostname !== expectedHost) {
    throw new HaltError('geofabrik-download-host-mismatch', `expected host "${expectedHost}", got "${initialUrl.hostname}"`);
  }
  if (initialUrl.pathname !== expectedPath) {
    throw new HaltError('geofabrik-download-path-mismatch', `expected path "${expectedPath}", got "${initialUrl.pathname}"`);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    function downloadFinalResponse(res, finalUrl) {
      if (res.statusCode !== 200) {
        res.resume();
        fail(new HaltError('geofabrik-download-bad-status', `expected HTTP 200 at the final target, got ${res.statusCode}`));
        return;
      }
      const contentType = parseContentType(res.headers['content-type']);
      if (!contentType || !allowedContentTypes.includes(contentType)) {
        res.resume();
        fail(
          new HaltError(
            'geofabrik-download-bad-content-type',
            `unexpected Content-Type "${res.headers['content-type']}" at the final target`
          )
        );
        return;
      }

      const tmpDir = makeTempDir('breda-osm-geofabrik-download-');
      const destPath = path.join(tmpDir, path.basename(finalUrl.pathname) || 'geofabrik-extract.osm.pbf');
      const fileStream = fs.createWriteStream(destPath);
      let bytesWritten = 0;

      res.on('data', (chunk) => {
        if (settled) return;
        bytesWritten += chunk.length;
        if (bytesWritten > maxBytes) {
          res.destroy();
          fileStream.destroy();
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fail(new HaltError('geofabrik-download-too-large', `download exceeded maxBytes=${maxBytes}`));
          return;
        }
        fileStream.write(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        fileStream.end(() => {
          if (settled) return;
          succeed({
            filePath: destPath,
            tmpDir,
            initialUrl: initialUrl.href,
            finalUrl: finalUrl.href,
            redirected: finalUrl.href !== initialUrl.href,
          });
        });
      });
      res.on('error', (err) => {
        fileStream.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fail(new HaltError('geofabrik-download-response-error', err.message));
      });
    }

    function issueRequest(targetUrl, isFollowingRedirect) {
      let req;
      try {
        req = requestImpl(targetUrl.href, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400) {
            if (isFollowingRedirect) {
              // A redirect from the already-redirected target — the one
              // allowed hop has been used; a second is always rejected,
              // regardless of where it points.
              res.resume();
              fail(
                new HaltError(
                  'geofabrik-second-redirect-rejected',
                  `received a second redirect (status ${res.statusCode}) from the already-validated target — refusing to follow further`
                )
              );
              return;
            }

            const locationHeader = res.headers.location;
            // The initial redirect response's own body/content-type is
            // never read as the file — drained and discarded, unused.
            res.resume();

            if (!locationHeader) {
              fail(new HaltError('geofabrik-redirect-missing-location', `received redirect status ${res.statusCode} with no Location header`));
              return;
            }

            let redirectTarget;
            try {
              redirectTarget = new URL(locationHeader, targetUrl);
            } catch (err) {
              fail(new HaltError('geofabrik-redirect-location-invalid', String(locationHeader)));
              return;
            }

            const check = isSafeRedirectTarget(redirectTarget, redirect);
            if (!check.ok) {
              fail(new HaltError('geofabrik-redirect-target-rejected', `${redirectTarget.href}: ${check.reason}`));
              return;
            }

            issueRequest(redirectTarget, true);
            return;
          }

          downloadFinalResponse(res, targetUrl);
        });
        req.on('error', (err) => fail(new HaltError('geofabrik-download-request-error', err.message)));
      } catch (err) {
        fail(new HaltError('geofabrik-download-request-error', err.message));
      }
    }

    issueRequest(initialUrl, false);
  });
}

/**
 * The only entry point live mode actually calls for the Geofabrik
 * extract — always the one, fixed, already-reviewed `config.LIVE_SOURCE`
 * URL, with the one, fixed, already-validated redirect shape
 * (`https://download.geofabrik.de/europe/netherlands-<YYMMDD>.osm.pbf`,
 * no port/credentials/query/fragment). Never accepts a caller-supplied
 * URL or redirect target.
 */
function downloadGeofabrikExtract(requestImpl) {
  return downloadWithOneValidatedRedirect({
    url: config.LIVE_SOURCE.url,
    expectedProtocol: config.LIVE_SOURCE.expectedProtocol,
    expectedHost: config.LIVE_SOURCE.expectedHost,
    expectedPath: config.LIVE_SOURCE.expectedPath,
    redirect: {
      expectedProtocol: config.LIVE_SOURCE.expectedProtocol,
      expectedHost: config.LIVE_SOURCE.expectedHost,
      expectedPort: '',
      pathPattern: /^\/europe\/netherlands-\d{6}\.osm\.pbf$/,
    },
    allowedContentTypes: config.LIVE_SOURCE.allowedContentTypes,
    maxBytes: config.LIVE_SOURCE.maxDownloadBytes,
    requestImpl,
  });
}

// ─── Preflight: live database checks, before any network traffic ─────────

/**
 * Verifies one source's exact identity and exact authorization scope —
 * tightened 2026-09-05 beyond the original "allowed OR restricted, has
 * the required stage" check. Every one of these is checked independently
 * and halts on its own specific mismatch, before any network traffic:
 *
 *  - the returned `source`/`sourceAuthorizationVersion` rows are exactly
 *    the ones this run asked for by id (defense-in-depth against a
 *    `dbClient` implementation bug silently returning the wrong row);
 *  - the authorization version actually belongs to this source;
 *  - `status` matches the exact expected value from config (`restricted`
 *    for both OSM and Geofabrik, per the registered source-registry
 *    entries) — not merely "usable" (`allowed` or `restricted` loosely);
 *  - `basic_info` is present in `allowed_data_categories` — the only data
 *    category this tool is ever authorized to extract;
 *  - `allowed_access_method` is exactly the required primary method
 *    (`open_dataset_download`) — never a live/authenticated route;
 *  - `geographic_applicability.market_id` names Breda's exact,
 *    already-registered market id — this authorization is Breda-scoped,
 *    not implicitly reused for any other market;
 *  - `raw_import` is permitted (unset `allowed_processing_stages` means
 *    `status` alone governs, per the documented contract).
 */
async function verifySourceAuthorization(dbClient, sourceConfig, requiredStage, label) {
  const source = await dbClient.getSource(sourceConfig.sourceId);
  if (!source) {
    throw new HaltError('preflight-source-missing', label);
  }
  if (source.id !== sourceConfig.sourceId) {
    throw new HaltError('preflight-source-id-mismatch', `${label}: expected ${sourceConfig.sourceId}, got ${source.id}`);
  }

  const sav = await dbClient.getSourceAuthorizationVersion(sourceConfig.authorizationVersionId);
  if (!sav) {
    throw new HaltError('preflight-authorization-version-missing', label);
  }
  if (sav.id !== sourceConfig.authorizationVersionId) {
    throw new HaltError(
      'preflight-authorization-version-id-mismatch',
      `${label}: expected ${sourceConfig.authorizationVersionId}, got ${sav.id}`
    );
  }
  if (sav.source_id !== sourceConfig.sourceId) {
    throw new HaltError('preflight-authorization-version-source-mismatch', label);
  }
  if (sav.status !== sourceConfig.expectedStatus) {
    throw new HaltError(
      'preflight-source-status-mismatch',
      `${label}: expected status="${sourceConfig.expectedStatus}", got "${sav.status}"`
    );
  }
  if (!Array.isArray(sav.allowed_data_categories) || !sav.allowed_data_categories.includes(config.REQUIRED_DATA_CATEGORY)) {
    throw new HaltError('preflight-basic-info-not-allowed', `${label} does not permit "${config.REQUIRED_DATA_CATEGORY}"`);
  }
  if (sav.allowed_access_method !== config.REQUIRED_PRIMARY_ACCESS_METHOD) {
    throw new HaltError(
      'preflight-primary-access-method-not-open-dataset-download',
      `${label}: expected primary access method "${config.REQUIRED_PRIMARY_ACCESS_METHOD}", got "${sav.allowed_access_method}"`
    );
  }
  const scopedMarketId = sav.geographic_applicability && sav.geographic_applicability.market_id;
  if (scopedMarketId !== config.BREDA.marketId) {
    throw new HaltError('preflight-geographic-scope-mismatch', `${label}: expected market_id ${config.BREDA.marketId}, got ${scopedMarketId}`);
  }
  const stages = sav.allowed_processing_stages;
  if (Array.isArray(stages) && stages.length > 0 && !stages.includes(requiredStage)) {
    throw new HaltError('preflight-processing-stage-not-allowed', `${label} does not permit "${requiredStage}"`);
  }
  return { source, sourceAuthorizationVersion: sav };
}

/**
 * Checks the live database, via the service role, for Breda, boundary
 * v1 (including its artifact_git_ref/hashes), and both the OSM and
 * Geofabrik sources plus their exact authorization versions and allowed
 * processing stages — **before a single byte of network traffic for the
 * actual import is sent.** Throws HaltError on any mismatch; never
 * proceeds on a best-effort or partial match.
 */
async function runPreflightChecks(dbClient) {
  const market = await dbClient.getMarket(config.BREDA.marketId);
  if (!market) {
    throw new HaltError('preflight-market-missing', config.BREDA.marketId);
  }
  if (market.slug !== config.BREDA.marketSlug) {
    throw new HaltError('preflight-market-slug-mismatch', String(market.slug));
  }
  if (market.current_boundary_version_id !== config.BREDA.boundaryVersionId) {
    throw new HaltError('preflight-market-current-boundary-mismatch', String(market.current_boundary_version_id));
  }

  const boundary = await dbClient.getBoundaryVersion(config.BREDA.boundaryVersionId);
  if (!boundary) {
    throw new HaltError('preflight-boundary-version-missing', config.BREDA.boundaryVersionId);
  }
  if (boundary.market_id !== config.BREDA.marketId) {
    throw new HaltError('preflight-boundary-market-mismatch', String(boundary.market_id));
  }
  if (boundary.artifact_git_ref !== config.BREDA.expectedArtifactGitRef) {
    throw new HaltError('preflight-artifact-git-ref-mismatch', String(boundary.artifact_git_ref));
  }
  if (boundary.source_artifact_hash !== config.BREDA.expectedSourceArtifactHash) {
    throw new HaltError('preflight-boundary-source-artifact-hash-mismatch', String(boundary.source_artifact_hash));
  }
  if (boundary.geometry_hash !== config.BREDA.expectedGeometryHash) {
    throw new HaltError('preflight-boundary-geometry-hash-mismatch', String(boundary.geometry_hash));
  }

  const dataOrigin = await verifySourceAuthorization(dbClient, config.OSM_SOURCE, config.REQUIRED_PROCESSING_STAGE, 'OpenStreetMap');
  const accessProvider = await verifySourceAuthorization(
    dbClient,
    config.GEOFABRIK_SOURCE,
    config.REQUIRED_PROCESSING_STAGE,
    'Geofabrik'
  );

  return { market, boundary, dataOrigin, accessProvider };
}

// ─── Orchestration ─────────────────────────────────────────────────────────

/**
 * Runs the full import procedure: preflight (against `dbClient`, before
 * any network traffic), then either a local fixture `.osm` file
 * (`live: false`) or a real, guarded Geofabrik download (`live: true`),
 * then the artifact-hash-inclusive idempotency check, then GDAL
 * extraction (`points` layer only), minimization, and — only when
 * `mutate` is true — the actual `ImportRun`/`ImportExtractionRecord`
 * writes via `dbClient`.
 *
 * **Execution order note (2026-09-05)**: the download (or, in fixture
 * mode, reading the local file) now happens *before* the final
 * idempotency check and before an `ImportRun` object is even built —
 * `source_artifact_hash` must be known first, since it is now part of
 * the idempotency key (see computeIdempotencyKey's own comment). This
 * means a `live: true` call always performs its download even when the
 * run turns out to be a byte-identical duplicate; that is a deliberate,
 * accepted cost of keying on the actual artifact rather than just its
 * URL — Geofabrik republishes the same URL with new content, so the
 * content itself, not just the locator, must be known to tell two runs
 * apart.
 *
 * `mutate` (defaults to `live`) independently controls whether this call
 * is allowed to write anything at all: `live: true, mutate: false` is
 * the **dry-run** shape — a real download, real hashing, real GDAL
 * filtering/measurement, but the `insertImportRun`/
 * `insertExtractionRecords`/`updateImportRunStatus` branches below are
 * never reached. `dbClient` is always required and always used for
 * preflight/idempotency reads regardless of `mutate` — this lets a
 * fixture or dry run exercise the real preflight logic against a seeded
 * fake, or the real database read-only, without ever writing to it.
 */
async function runImport({
  live = false,
  mutate = live,
  osmFilePath,
  dbClient,
  gdalRunner = runOsmExtraction,
  downloader = downloadGeofabrikExtract,
  liveRequestImpl,
  repoRoot,
  triggeredBy = 'manual',
  now = () => new Date().toISOString(),
}) {
  await runPreflightChecks(dbClient);
  const bredaGeojson = loadAndVerifyBoundaryGeometry(repoRoot);
  const bbox = computeBbox(bredaGeojson, config.BBOX_PADDING_DEGREES);

  const extractionConfigFingerprint = computeExtractionConfigFingerprint();

  let downloadTmpDir = null;
  let extractionTmpDir = null;
  let effectiveOsmFilePath = osmFilePath;
  let importRun = null;

  try {
    // sourceLocator/sourceVersion/sourceVersionNote are only fully known
    // once the download (live mode) has actually happened — the fixed
    // "latest" URL may 302-redirect to a periodically re-dated artifact
    // (see downloadWithOneValidatedRedirect above); the *actual*, final,
    // dated URL is what gets recorded, never the "latest" alias alone.
    let sourceLocator;
    let sourceVersion = null;
    let sourceVersionNote;

    if (live) {
      const downloaded = await downloader(liveRequestImpl);
      effectiveOsmFilePath = downloaded.filePath;
      downloadTmpDir = downloaded.tmpDir;

      sourceLocator = downloaded.finalUrl;
      if (downloaded.redirected) {
        sourceVersion = path.basename(new URL(downloaded.finalUrl).pathname);
        sourceVersionNote = `Fetched via the fixed "latest" URL (${downloaded.initialUrl}), which redirected exactly once to the validated, dated extract ${downloaded.finalUrl}.`;
      } else {
        sourceVersion = null;
        sourceVersionNote = `Fetched directly from the fixed "latest" URL (${downloaded.initialUrl}) with no redirect.`;
      }
    } else {
      sourceLocator = `fixture:${path.basename(osmFilePath)}`;
      sourceVersionNote = 'Synthetic fixture — not a real Geofabrik extract';
    }

    // The actual artifact must be in hand (downloaded or, in fixture
    // mode, already local) before the idempotency key can be computed —
    // it is now one of the key's inputs.
    const sourceArtifactHash = sha256File(effectiveOsmFilePath);

    const idempotencyKey = computeIdempotencyKey({
      dataOriginSourceId: config.OSM_SOURCE.sourceId,
      dataOriginSourceAuthorizationVersionId: config.OSM_SOURCE.authorizationVersionId,
      accessProviderSourceId: config.GEOFABRIK_SOURCE.sourceId,
      accessProviderSourceAuthorizationVersionId: config.GEOFABRIK_SOURCE.authorizationVersionId,
      marketId: config.BREDA.marketId,
      sourceLocator,
      sourceVersion,
      sourceArtifactHash,
      extractionConfigFingerprint,
    });

    // The "definitieve" idempotency check — now artifact-hash-aware.
    const existingRun = await dbClient.getImportRunByIdempotencyKey(idempotencyKey);
    if (existingRun) {
      return { outcome: 'already_exists', importRun: existingRun, extractionRecords: [] };
    }

    importRun = {
      id: generateUuidV7(),
      data_origin_source_id: config.OSM_SOURCE.sourceId,
      data_origin_source_authorization_version_id: config.OSM_SOURCE.authorizationVersionId,
      access_provider_source_id: config.GEOFABRIK_SOURCE.sourceId,
      access_provider_source_authorization_version_id: config.GEOFABRIK_SOURCE.authorizationVersionId,
      market_id: config.BREDA.marketId,
      market_boundary_version_id: config.BREDA.boundaryVersionId,
      access_method_used: 'open_dataset_download',
      access_provider_note: 'Geofabrik periodic Netherlands OSM extract (netherlands-latest.osm.pbf)',
      source_locator: sourceLocator,
      source_version: sourceVersion,
      source_version_note: sourceVersionNote,
      source_artifact_hash_algorithm: config.HASH_ALGORITHM.toUpperCase(),
      source_artifact_hash: sourceArtifactHash,
      started_at: now(),
      completed_at: null,
      status: 'running',
      record_counts: { fetched: 0, stored: 0, skipped: 0, errored: 0 },
      error_log: [],
      checkpoint: null,
      idempotency_key: idempotencyKey,
      triggered_by: triggeredBy,
      retried_from_run_id: null,
    };

    if (mutate) {
      await dbClient.insertImportRun(importRun);
    }

    extractionTmpDir = makeTempDir('breda-osm-extract-');
    const featureCollection = gdalRunner({
      osmFilePath: effectiveOsmFilePath,
      gdalRef: config.GDAL.ref,
      osmConfPath: config.OSMCONF_PATH,
      allowedAmenityValues: config.ALLOWED_AMENITY_VALUES,
      bbox,
      layer: config.GDAL.layer,
      outDir: extractionTmpDir,
    });

    const { records, record_counts, error_log } = processGdalFeatureCollection(featureCollection, {
      bredaGeojson,
      allowedAmenityValues: config.ALLOWED_AMENITY_VALUES,
      retrievedAt: now(),
    });

    const extractionRecords = records.map((record) => ({
      id: generateUuidV7(),
      import_run_id: importRun.id,
      market_boundary_version_id: config.BREDA.boundaryVersionId,
      ...record,
    }));

    const status = record_counts.errored > 0 && record_counts.stored === 0 ? 'failed' : record_counts.errored > 0 ? 'partial' : 'succeeded';
    const completedAt = now();

    if (mutate) {
      if (extractionRecords.length > 0) {
        await dbClient.insertExtractionRecords(extractionRecords);
      }
      await dbClient.updateImportRunStatus(importRun.id, {
        status,
        completed_at: completedAt,
        record_counts,
        error_log,
        checkpoint: null,
      });
    }

    return {
      outcome: 'completed',
      importRun: { ...importRun, status, completed_at: completedAt, record_counts, error_log },
      extractionRecords,
    };
  } catch (err) {
    if (mutate && importRun) {
      try {
        await dbClient.updateImportRunStatus(importRun.id, {
          status: 'failed',
          completed_at: now(),
          record_counts: { fetched: 0, stored: 0, skipped: 0, errored: 0 },
          error_log: [{ reason: 'run-failed', message: err.message }],
          checkpoint: null,
        });
      } catch (updateErr) {
        // Best-effort — the original error is what matters and is
        // rethrown below regardless of whether this status update itself
        // succeeded.
      }
    }
    throw err;
  } finally {
    if (downloadTmpDir) fs.rmSync(downloadTmpDir, { recursive: true, force: true });
    if (extractionTmpDir) fs.rmSync(extractionTmpDir, { recursive: true, force: true });
  }
}

// ─── Database client — live (real, wired, not invoked by main() yet) ─────

/**
 * Real Supabase-js wiring via the service role, mirroring
 * src/lib/supabaseAdmin.js's client construction (CommonJS here, matching
 * this directory's existing convention, rather than that module's ESM
 * export). Real, wired code — but `main()` below never calls this: a real
 * live run is a separate, later, explicitly-approved step.
 */
function createLiveDbClient() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HaltError(
      'live-db-client-not-configured',
      'set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.local.example)'
    );
  }
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  async function selectOne(table, id) {
    const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
    if (error) throw new HaltError('live-db-query-failed', `${table}: ${error.message}`);
    return data;
  }

  return {
    getMarket: (id) => selectOne('markets', id),
    getBoundaryVersion: (id) => selectOne('market_boundary_versions', id),
    getSource: (id) => selectOne('sources', id),
    getSourceAuthorizationVersion: (id) => selectOne('source_authorization_versions', id),
    async getImportRunByIdempotencyKey(key) {
      const { data, error } = await client.from('import_runs').select('*').eq('idempotency_key', key).maybeSingle();
      if (error) throw new HaltError('live-db-query-failed', `import_runs: ${error.message}`);
      return data;
    },
    async insertImportRun(row) {
      const { error } = await client.from('import_runs').insert(row);
      if (error) throw new HaltError('live-db-insert-failed', `import_runs: ${error.message}`);
    },
    async insertExtractionRecords(rows) {
      const { error } = await client.from('import_extraction_records').insert(rows);
      if (error) throw new HaltError('live-db-insert-failed', `import_extraction_records: ${error.message}`);
    },
    async updateImportRunStatus(id, patch) {
      const { error } = await client.from('import_runs').update(patch).eq('id', id);
      if (error) throw new HaltError('live-db-update-failed', `import_runs: ${error.message}`);
    },
  };
}

// ─── Database client — fixture/fake (offline, deterministic, testable) ───

/**
 * An in-memory stand-in for the live database, seeded with exactly the
 * values the real, live-verified Supabase project is expected to hold
 * (per config.js's own committed identities) — so CLI dry-run mode, and
 * most tests, can exercise the real preflight/idempotency logic fully
 * offline, without any live Supabase mutation. `overrides` lets tests
 * deliberately seed a mismatch (e.g. a wrong hash or a `blocked` status)
 * to exercise runPreflightChecks' failure paths.
 */
function createFixtureDbClient(overrides = {}) {
  const state = {
    market: {
      id: config.BREDA.marketId,
      slug: config.BREDA.marketSlug,
      current_boundary_version_id: config.BREDA.boundaryVersionId,
    },
    boundaryVersion: {
      id: config.BREDA.boundaryVersionId,
      market_id: config.BREDA.marketId,
      artifact_git_ref: config.BREDA.expectedArtifactGitRef,
      source_artifact_hash: config.BREDA.expectedSourceArtifactHash,
      geometry_hash: config.BREDA.expectedGeometryHash,
    },
    sources: {
      [config.OSM_SOURCE.sourceId]: { id: config.OSM_SOURCE.sourceId, name: 'OpenStreetMap' },
      [config.GEOFABRIK_SOURCE.sourceId]: { id: config.GEOFABRIK_SOURCE.sourceId, name: 'Geofabrik — Netherlands OSM extract' },
    },
    authorizationVersions: {
      [config.OSM_SOURCE.authorizationVersionId]: {
        id: config.OSM_SOURCE.authorizationVersionId,
        source_id: config.OSM_SOURCE.sourceId,
        status: 'restricted',
        allowed_data_categories: ['basic_info'],
        allowed_access_method: 'open_dataset_download',
        geographic_applicability: { country_codes: ['NL'], market_id: config.BREDA.marketId },
        allowed_processing_stages: ['raw_import', 'internal_quality_review', 'moderation_preparation'],
      },
      [config.GEOFABRIK_SOURCE.authorizationVersionId]: {
        id: config.GEOFABRIK_SOURCE.authorizationVersionId,
        source_id: config.GEOFABRIK_SOURCE.sourceId,
        status: 'restricted',
        allowed_data_categories: ['basic_info'],
        allowed_access_method: 'open_dataset_download',
        geographic_applicability: { country_codes: ['NL'], market_id: config.BREDA.marketId },
        allowed_processing_stages: ['raw_import', 'internal_quality_review', 'moderation_preparation'],
      },
    },
    importRunsByIdempotencyKey: new Map(),
    insertedImportRuns: [],
    insertedExtractionRecords: [],
  };

  // Shallow-merge top-level override keys (market/boundaryVersion/etc.)
  // over the seeded defaults, without losing untouched siblings.
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && state[key] && typeof state[key] === 'object') {
      Object.assign(state[key], value);
    } else {
      state[key] = value;
    }
  }

  return {
    _state: state,
    async getMarket(id) {
      return id === state.market.id ? state.market : null;
    },
    async getBoundaryVersion(id) {
      return id === state.boundaryVersion.id ? state.boundaryVersion : null;
    },
    async getSource(id) {
      return state.sources[id] || null;
    },
    async getSourceAuthorizationVersion(id) {
      return state.authorizationVersions[id] || null;
    },
    async getImportRunByIdempotencyKey(key) {
      return state.importRunsByIdempotencyKey.get(key) || null;
    },
    async insertImportRun(row) {
      state.insertedImportRuns.push(row);
      state.importRunsByIdempotencyKey.set(row.idempotency_key, row);
    },
    async insertExtractionRecords(rows) {
      state.insertedExtractionRecords.push(...rows);
    },
    async updateImportRunStatus(id, patch) {
      const run = state.insertedImportRuns.find((r) => r.id === id);
      if (run) Object.assign(run, patch);
    },
  };
}

// ─── CLI entry point ────────────────────────────────────────────────────────

/**
 * Same fixed-confirmation pattern as `assertLiveConfirmation`
 * (capture-market-boundary.js), applied to a second, independent flag:
 * `--dry-run` requires an exactly-matching `--confirm-market=<slug>` too.
 * Implemented locally (not by generalizing `assertLiveConfirmation`
 * itself) so this addition never risks changing that already-tested,
 * shared function's behaviour for the boundary capture tool.
 */
function assertDryRunConfirmation(args, expectedMarketSlug) {
  const dryRun = args.includes('--dry-run');
  if (!dryRun) {
    return { dryRun: false };
  }
  const confirmArg = args.find((a) => a.startsWith('--confirm-market='));
  const confirmedValue = confirmArg ? confirmArg.slice('--confirm-market='.length) : null;
  if (confirmedValue !== expectedMarketSlug) {
    throw new HaltError(
      'dry-run-confirmation-missing',
      `--dry-run requires an exactly matching --confirm-market=${expectedMarketSlug}; ` +
        `got --confirm-market=${confirmedValue === null ? '(missing)' : JSON.stringify(confirmedValue)}`
    );
  }
  return { dryRun: true, marketSlug: confirmedValue };
}

function main(argv) {
  const args = argv.slice(2);
  const fixtureIdx = args.indexOf('--fixture');
  const outIdx = args.indexOf('--out');

  let liveCheck;
  try {
    liveCheck = assertLiveConfirmation(args, config.LIVE_SOURCE.expectedMarketSlug);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return undefined;
  }

  let dryRunCheck;
  try {
    dryRunCheck = assertDryRunConfirmation(args, config.LIVE_SOURCE.expectedMarketSlug);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return undefined;
  }

  const repoRoot = path.resolve(__dirname, '..', '..');

  if (liveCheck.live) {
    // Live mode is real, wired code (runImport({live: true, mutate: true,
    // ...}) and createLiveDbClient() are both fully implemented and
    // unit-tested against fakes) — but this CLI entry point deliberately
    // refuses to invoke it, even with a correctly-matching
    // --confirm-market, exactly like the boundary tool's own history:
    // enabling a real live run is a separate, later, explicitly-approved
    // step, not a side effect of building this tool.
    console.error(
      'Live mode is wired but not enabled by this project yet. A real Breda ' +
        'OSM/Geofabrik import run requires a separate, explicit approval — ' +
        'see docs/api/import-run-schema.md and this tool\'s own report. Refusing to proceed.'
    );
    process.exitCode = 1;
    return undefined;
  }

  if (dryRunCheck.dryRun) {
    // Dry-run mode is also real, wired code — runImport({live: true,
    // mutate: false, ...}) performs a real download, real hashing, real
    // GDAL extraction, and real measurement, but is structurally
    // prevented from ever calling insertImportRun/insertExtractionRecords
    // /updateImportRunStatus (see runImport's own `mutate` handling and
    // this tool's tests). Enabling it against the real Geofabrik endpoint
    // is still a separate, later, explicitly-approved step, exactly like
    // --live — this round only prepares and tests the safe plumbing.
    console.error(
      'Dry-run mode is wired (real download + hash + GDAL extraction + measurement, never a database write) ' +
        'but not enabled by this project yet — running it against the real Geofabrik endpoint is a separate, ' +
        'later, explicitly-approved step. Refusing to proceed automatically even though --dry-run/--confirm-market matched.'
    );
    process.exitCode = 1;
    return undefined;
  }

  if (fixtureIdx === -1 || outIdx === -1) {
    console.error(
      'Usage (local fixture only, no network, no database write): node import-breda-osm.js --fixture <osm-file> --out <dir>'
    );
    process.exitCode = 1;
    return undefined;
  }

  const osmFilePath = args[fixtureIdx + 1];
  const outDir = args[outIdx + 1];
  const dbClient = createFixtureDbClient();

  return runImport({
    live: false,
    osmFilePath,
    dbClient,
    repoRoot,
    triggeredBy: 'manual',
  })
    .then((result) => {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'import-run.json'), `${JSON.stringify(result.importRun, null, 2)}\n`, 'utf8');
      fs.writeFileSync(
        path.join(outDir, 'extraction-records.json'),
        `${JSON.stringify(result.extractionRecords, null, 2)}\n`,
        'utf8'
      );
      console.log(`Dry-run import complete (${result.outcome}). Report written to: ${outDir}`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  loadAndVerifyBoundaryGeometry,
  pointInRing,
  pointInPolygon,
  isPointInBreda,
  computeBbox,
  runOsmExtraction,
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
  downloadGeofabrikExtract,
  verifySourceAuthorization,
  runPreflightChecks,
  runImport,
  createLiveDbClient,
  createFixtureDbClient,
  assertDryRunConfirmation,
};
