'use strict';

/**
 * Breda MarketBoundaryVersion capture procedure (MARKET-01/04 gate 1).
 *
 * Implements the derivation procedure documented in
 * docs/api/market-entity-schema.md's `MarketBoundaryVersion` contract:
 * select one feature from the official Kadaster/PDOK "Bestuurlijke
 * Gebieden" GeoPackage, validate it, reproject it to a canonical GeoJSON,
 * and assemble a complete manifest — or halt and write nothing at all.
 *
 * This module is defaults-safe: requiring it, or running it without
 * `--live`, never performs network access. Live mode (real PDOK download +
 * real Docker/GDAL run against the real 2026 dataset) is real, wired code
 * — not a stub — but requires BOTH `--live` and an exactly-matching
 * `--confirm-market=<slug>` (see `assertLiveConfirmation`), accepts no
 * caller-supplied URL or market (only the one fixed, registered source in
 * `capture-market-boundary.config.js`'s `LIVE_SOURCE`), and is not invoked
 * by this project against the real PDOK endpoint until a separate,
 * explicit approval closes gate 1.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const https = require('node:https');
const { URL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const config = require('./capture-market-boundary.config');

// ─── Small utilities ──────────────────────────────────────────────────────

function sha256File(filePath) {
  const hash = crypto.createHash(config.HASH_ALGORITHM);
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha256String(text) {
  return crypto.createHash(config.HASH_ALGORITHM).update(text, 'utf8').digest('hex');
}

function isSafeIdentifier(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Generates an RFC 9562-conformant UUIDv7, using only `node:crypto` — no
 * dependency. Layout (128 bits): 48-bit big-endian Unix ms timestamp,
 * 4-bit version (0111), 12-bit random `rand_a`, 2-bit variant (10),
 * 62-bit random `rand_b`. Replaces the earlier placeholder
 * `crypto.randomUUID()` (UUIDv4) call in `assembleManifest` — a
 * `MarketBoundaryVersion.id` must be UUIDv7 per
 * `docs/api/market-entity-schema.md`'s amendment (time-ordered, matching
 * this record type's append-only versioning).
 */
function generateUuidV7() {
  const unixTsMs = BigInt(Date.now());
  const rand = crypto.randomBytes(10); // 80 bits of entropy source

  const bytes = Buffer.alloc(16);

  // Bytes 0-5: 48-bit big-endian Unix timestamp in milliseconds.
  bytes[0] = Number((unixTsMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTsMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTsMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTsMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTsMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTsMs & 0xffn);

  // Byte 6: high nibble = version (0111 = 7); low nibble = top 4 bits of rand_a.
  bytes[6] = 0x70 | (rand[0] & 0x0f);
  // Byte 7: remaining 8 bits of rand_a (12 bits total across bytes 6-7).
  bytes[7] = rand[1];

  // Byte 8: top 2 bits = variant (10, the RFC 4122/9562 variant);
  // remaining 6 bits = start of rand_b.
  bytes[8] = 0x80 | (rand[2] & 0x3f);
  // Bytes 9-15: remaining 56 bits of rand_b (62 bits total across byte 8's
  // low 6 bits + bytes 9-15).
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Reads the current git revision and whether the working tree is dirty
 * for this specific script file — used so a future manifest's
 * `derivation.procedure_ref` can point at an exact, versioned procedure,
 * per docs/api/market-entity-schema.md's requirement that `procedure_ref`
 * be "a reference to a versioned, written, step-by-step procedure," not a
 * free-text description. */
function getProcedureRef(repoRoot, scriptRelativePath) {
  let gitRevision = null;
  let dirty = null;
  try {
    gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--', scriptRelativePath], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    dirty = status.length > 0;
  } catch (err) {
    // Not fatal for a dry run — but a real, registered capture must not
    // proceed with an unknown procedure reference (see runCapture below).
    gitRevision = null;
    dirty = null;
  }
  return {
    path: scriptRelativePath,
    git_revision: gitRevision,
    working_tree_dirty_for_this_file: dirty,
  };
}

// ─── Step 1/2: selection + validation (pure SQL — no GDAL, no Docker) ─────

class HaltError extends Error {
  constructor(reason, detail) {
    super(`Capture halted: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'HaltError';
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Opens a GeoPackage (any valid SQLite file with the expected attribute
 * table/columns) read-only and applies the selection + validation rule.
 * Never touches the geometry column — this step is deliberately
 * geometry-agnostic and requires no GDAL/Docker at all, so it is fully
 * testable in any environment.
 *
 * Deliberately never reads, returns, or otherwise depends on a
 * source-internal primary key (`fid`, `id`, or any other name a
 * GeoPackage happens to use for its feature table). Selection and
 * validation are keyed entirely on the semantic, approved fields
 * (`identificatie`/`code`/`naam`) — the same fields `runGdalExtraction`
 * below uses to select the geometry, so both steps are guaranteed to
 * agree on which row they mean without ever naming its internal key.
 *
 * Throws HaltError on anything but exactly one fully-matching row — never
 * returns a partial/ambiguous result.
 */
function selectAndValidateFeature(gpkgPath, layer, selectionRule) {
  if (!isSafeIdentifier(layer)) {
    throw new HaltError('unsafe-layer-name', layer);
  }
  const { primarySelector, requiredValidations } = selectionRule;
  if (!isSafeIdentifier(primarySelector.field)) {
    throw new HaltError('unsafe-selector-field', primarySelector.field);
  }
  for (const v of requiredValidations) {
    if (!isSafeIdentifier(v.field)) {
      throw new HaltError('unsafe-validation-field', v.field);
    }
  }

  const db = new DatabaseSync(gpkgPath, { readOnly: true });
  try {
    const columns = [primarySelector.field, ...requiredValidations.map((v) => v.field)];
    const uniqueColumns = [...new Set(columns)];
    const stmt = db.prepare(
      `SELECT ${uniqueColumns.join(', ')} FROM ${layer} WHERE ${primarySelector.field} = ?`
    );
    const rows = stmt.all(primarySelector.value);

    if (rows.length === 0) {
      throw new HaltError(
        'no-matching-feature',
        `${primarySelector.field} = ${JSON.stringify(primarySelector.value)}`
      );
    }
    if (rows.length > 1) {
      throw new HaltError(
        'duplicate-matching-features',
        `${rows.length} rows matched ${primarySelector.field} = ${JSON.stringify(primarySelector.value)}`
      );
    }

    const row = rows[0];
    for (const v of requiredValidations) {
      if (row[v.field] !== v.value) {
        throw new HaltError(
          'validation-mismatch',
          `expected ${v.field} = ${JSON.stringify(v.value)}, found ${JSON.stringify(row[v.field])}`
        );
      }
    }
  } finally {
    db.close();
  }
}

// ─── Step 3: GDAL extraction + reprojection (requires Docker) ────────────

/**
 * Escapes a string value for embedding in an OGR SQL `-where` literal
 * (doubles any single quote — standard SQL string-literal escaping). The
 * value always originates from this project's own trusted, reviewed
 * `SELECTION_RULE` config, never from external input, but this is applied
 * regardless as a defense-in-depth measure.
 */
function sqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Real GDAL invocation via a digest-pinned container. This is the only
 * step in the whole procedure that needs Docker. It is intentionally a
 * thin, directly-inspectable wrapper around a single `docker run`
 * invocation — no geometry math is reimplemented in JavaScript.
 *
 * Selects the feature to extract using the exact same semantic
 * `selectionRule.primarySelector` (e.g. `identificatie = 'GM0758'`) that
 * `selectAndValidateFeature` already validated — never a source-internal
 * primary key. This guarantees both steps agree on the same row without
 * either one needing to know or care what that key is called.
 *
 * Throws a clear, actionable Error (never a partial file) if Docker is
 * unavailable, the image can't be pulled, or ogr2ogr itself fails.
 */
function runGdalExtraction({ gpkgPath, layer, selectionRule, gdalRef, outDir, execFileSyncImpl = execFileSync }) {
  const gpkgDir = path.dirname(path.resolve(gpkgPath));
  const gpkgName = path.basename(gpkgPath);
  const outName = 'extracted.geojson';

  const { field, value } = selectionRule.primarySelector;
  if (!isSafeIdentifier(field)) {
    throw new HaltError('unsafe-selector-field', field);
  }
  const whereClause = `${field} = ${sqlStringLiteral(value)}`;

  const args = [
    'run',
    '--rm',
    '-v', `${gpkgDir}:/in:ro`,
    '-v', `${path.resolve(outDir)}:/out`,
    gdalRef,
    'ogr2ogr',
    '-f', 'GeoJSON',
    '-t_srs', config.CRS.output,
    // RFC7946=YES is the GeoJSON driver's dedicated compliance profile: it
    // guarantees WGS84 axis order/precision and — critically — omits the
    // legacy top-level "crs" member that plain reprojection otherwise
    // leaves in place, which `validateRfc7946` (correctly) rejects.
    '-lco', 'RFC7946=YES',
    '-lco', `COORDINATE_PRECISION=${config.SERIALIZATION_RULE.coordinatePrecisionDecimals}`,
    '-where', whereClause,
    `/out/${outName}`,
    `/in/${gpkgName}`,
    layer,
  ];

  try {
    execFileSyncImpl('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const stderrText = err.stderr ? err.stderr.toString('utf8') : String(err.message);
    throw new HaltError(
      'gdal-extraction-failed',
      `docker/GDAL invocation failed — is Docker running and is ${gdalRef} reachable? Underlying error: ${stderrText.trim()}`
    );
  }

  const outPath = path.join(outDir, outName);
  if (!fs.existsSync(outPath)) {
    throw new HaltError('gdal-produced-no-output', outPath);
  }
  return outPath;
}

// ─── Step 0 (live mode only): guarded confirmation + guarded download ─────

/**
 * `--live` alone is never enough. A second, exactly-matching
 * `--confirm-market=<expectedMarketSlug>` flag must also be present —
 * this is a fixed confirmation of the one market this procedure supports
 * today, not a free market selector: any other value (or a missing flag)
 * refuses. Pure/argv-based so this is testable without spawning a process.
 */
function assertLiveConfirmation(args, expectedMarketSlug) {
  const live = args.includes('--live');
  if (!live) {
    return { live: false };
  }
  const confirmArg = args.find((a) => a.startsWith('--confirm-market='));
  const confirmedValue = confirmArg ? confirmArg.slice('--confirm-market='.length) : null;
  if (confirmedValue !== expectedMarketSlug) {
    throw new HaltError(
      'live-confirmation-missing',
      `live mode requires both --live and an exactly matching --confirm-market=${expectedMarketSlug}; ` +
        `got --confirm-market=${confirmedValue === null ? '(missing)' : JSON.stringify(confirmedValue)}`
    );
  }
  return { live: true, marketSlug: confirmedValue };
}

function parseContentType(headerValue) {
  if (!headerValue) return null;
  return headerValue.split(';')[0].trim().toLowerCase();
}

/**
 * Downloads a single file over HTTPS into its own throwaway temp
 * directory, enforcing every safeguard before a single byte is trusted:
 * exact protocol/host/path match, no redirects, an allow-listed status
 * code and Content-Type, and a hard byte-count ceiling enforced while
 * streaming (not after the fact). Never returns a partial file — any
 * failure removes the temp directory it created before rejecting.
 *
 * `url`/`expectedHost`/`expectedPath` etc. are parameters so this
 * primitive is independently testable (including against a local
 * synthetic server); the real live-capture entry point (`downloadLiveSource`
 * below) is what actually gets called at runtime, and it never accepts a
 * caller-supplied URL — it always uses the fixed, registered config value.
 */
async function downloadGeoPackage({
  url,
  expectedProtocol,
  expectedHost,
  expectedPath,
  allowedContentTypes,
  maxBytes,
  requestImpl = https.get,
}) {
  const parsed = new URL(url);
  if (parsed.protocol !== expectedProtocol) {
    throw new HaltError(
      'live-download-protocol-rejected',
      `expected protocol "${expectedProtocol}", got "${parsed.protocol}" for ${url}`
    );
  }
  if (parsed.hostname !== expectedHost) {
    throw new HaltError('live-download-host-mismatch', `expected host "${expectedHost}", got "${parsed.hostname}"`);
  }
  if (parsed.pathname !== expectedPath) {
    throw new HaltError('live-download-path-mismatch', `expected path "${expectedPath}", got "${parsed.pathname}"`);
  }

  const tmpDir = makeTempDir('market-boundary-live-source-');
  const destPath = path.join(tmpDir, 'source.gpkg');

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    let req;
    try {
      req = requestImpl(url, (res) => {
        // Redirects are refused outright — this procedure's explicit,
        // documented rule. The URL is fixed and already confirmed to
        // resolve directly during source review; a redirect at capture
        // time is treated as unexpected, not as something to follow.
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          fail(
            new HaltError(
              'live-download-redirect-rejected',
              `received redirect status ${res.statusCode}; this procedure refuses all redirects`
            )
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          fail(new HaltError('live-download-bad-status', `expected HTTP 200, got ${res.statusCode}`));
          return;
        }

        const contentType = parseContentType(res.headers['content-type']);
        if (!contentType || !allowedContentTypes.includes(contentType)) {
          res.resume();
          fail(
            new HaltError(
              'live-download-bad-content-type',
              `unexpected Content-Type "${res.headers['content-type']}"`
            )
          );
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        let bytesWritten = 0;

        res.on('data', (chunk) => {
          if (settled) return;
          bytesWritten += chunk.length;
          if (bytesWritten > maxBytes) {
            res.destroy();
            fileStream.destroy();
            fail(new HaltError('live-download-too-large', `download exceeded maxBytes=${maxBytes}`));
            return;
          }
          fileStream.write(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          fileStream.end(() => {
            if (settled) return;
            settled = true;
            resolve({ gpkgPath: destPath, tmpDir });
          });
        });
        res.on('error', (err) => {
          fileStream.destroy();
          fail(new HaltError('live-download-response-error', err.message));
        });
      });
      req.on('error', (err) => {
        fail(new HaltError('live-download-request-error', err.message));
      });
    } catch (err) {
      fail(new HaltError('live-download-request-error', err.message));
    }
  }).catch((err) => {
    err.removedTmpDir = tmpDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  });
}

/**
 * The only entry point `runCapture`'s live mode actually calls. Unlike
 * `downloadGeoPackage`, it takes no URL/host/path parameters at all — it
 * always downloads exactly the one, fixed, already-reviewed
 * `config.LIVE_SOURCE` artifact. `requestImpl` remains overridable purely
 * as a test seam (mirroring `runGdalExtraction`'s `execFileSyncImpl`), the
 * same way tests substitute Docker/child-process calls without ever
 * changing *what* is being requested.
 */
function downloadLiveSource(requestImpl) {
  return downloadGeoPackage({
    url: config.LIVE_SOURCE.url,
    expectedProtocol: config.LIVE_SOURCE.expectedProtocol,
    expectedHost: config.LIVE_SOURCE.expectedHost,
    expectedPath: config.LIVE_SOURCE.expectedPath,
    allowedContentTypes: config.LIVE_SOURCE.allowedContentTypes,
    maxBytes: config.LIVE_SOURCE.maxDownloadBytes,
    requestImpl,
  });
}

// ─── Step 4: canonical serialization + RFC 7946 validation ────────────────

function roundCoordinates(coords, decimals) {
  const factor = 10 ** decimals;
  if (typeof coords[0] === 'number') {
    return coords.map((c) => Math.round(c * factor) / factor);
  }
  return coords.map((c) => roundCoordinates(c, decimals));
}

/**
 * Validates the minimal shape RFC 7946 requires and this project's
 * inclusion_rule depends on: a Feature (or FeatureCollection of exactly
 * one Feature) with Polygon/MultiPolygon geometry, numeric coordinate
 * arrays, and — per RFC 7946 §4 — no legacy top-level "crs" member (RFC
 * 7946 mandates WGS84 implicitly; a "crs" member signals a pre-7946,
 * non-conformant file).
 */
function validateRfc7946(geojson) {
  if (geojson.crs) {
    throw new HaltError('rfc7946-violation', 'a "crs" member is present; RFC 7946 mandates implicit WGS84');
  }
  let feature = geojson;
  if (geojson.type === 'FeatureCollection') {
    if (!Array.isArray(geojson.features) || geojson.features.length !== 1) {
      throw new HaltError(
        'rfc7946-violation',
        `expected exactly one Feature, found ${geojson.features ? geojson.features.length : 0}`
      );
    }
    feature = geojson.features[0];
  }
  if (feature.type !== 'Feature') {
    throw new HaltError('rfc7946-violation', `unexpected top-level type "${feature.type}"`);
  }
  const geom = feature.geometry;
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
    throw new HaltError('rfc7946-violation', `unexpected geometry type "${geom && geom.type}"`);
  }
  if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) {
    throw new HaltError('rfc7946-violation', 'empty or non-array coordinates');
  }
  return feature;
}

/** Deterministic, sorted-key JSON serialization — the exact byte sequence
 * `geometry_hash` is computed over. */
function canonicalJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalizeGeoJson(rawGeoJsonPath, precisionDecimals) {
  const raw = JSON.parse(fs.readFileSync(rawGeoJsonPath, 'utf8'));
  const feature = validateRfc7946(raw);

  const canonicalFeature = {
    type: 'Feature',
    properties: feature.properties || {},
    geometry: {
      type: feature.geometry.type,
      coordinates: roundCoordinates(feature.geometry.coordinates, precisionDecimals),
    },
  };

  const text = canonicalJsonStringify(canonicalFeature);
  return { feature: canonicalFeature, text };
}

// ─── Step 5: manifest assembly — enforces "no null on a real version" ─────

const REQUIRED_MANIFEST_FIELDS = [
  'id',
  'business_key',
  'representation_type',
  'definition_ref',
  'source_version',
  'valid_from',
  'retrieved_at',
  'feature_selection_rule',
  'inclusion_rule',
  'source_artifact_hash_algorithm',
  'source_artifact_hash',
  'geometry_hash',
  'derivation',
  'effective_from',
];

const REQUIRED_DERIVATION_FIELDS = ['input_crs', 'output_crs', 'tool', 'tool_reference', 'procedure_ref', 'serialization_rule'];

function assertComplete(manifest) {
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (manifest[field] === null || manifest[field] === undefined) {
      throw new HaltError('incomplete-manifest', `required field "${field}" is null/undefined`);
    }
  }
  for (const field of REQUIRED_DERIVATION_FIELDS) {
    if (manifest.derivation[field] === null || manifest.derivation[field] === undefined) {
      throw new HaltError('incomplete-manifest', `required derivation field "${field}" is null/undefined`);
    }
  }
  return manifest;
}

function assembleManifest({
  marketSlug,
  versionNumber,
  sourceArtifactHash,
  geometryHash,
  canonicalGeoJsonText,
  gdalVersionString,
  procedureRef,
  retrievedAt,
}) {
  const manifest = {
    id: generateUuidV7(),
    business_key: { market_slug: marketSlug, version_number: versionNumber },
    representation_type: 'polygon',
    definition_ref: config.PDOK_SOURCE.definitionRef,
    source_version: config.PDOK_SOURCE.sourceVersion,
    valid_from: '2026-01-01',
    retrieved_at: retrievedAt,
    feature_selection_rule: config.SELECTION_RULE,
    inclusion_rule:
      'A coordinate is in-market if it falls within or on the polygon boundary of the selected feature.',
    source_artifact_hash_algorithm: config.HASH_ALGORITHM.toUpperCase(),
    source_artifact_hash: sourceArtifactHash,
    geometry_hash: geometryHash,
    derivation: {
      input_crs: config.CRS.input,
      output_crs: config.CRS.output,
      tool: gdalVersionString,
      tool_reference: config.GDAL.ref,
      procedure_ref: procedureRef,
      serialization_rule: config.SERIALIZATION_RULE,
    },
    effective_from: retrievedAt,
    supersedes_version: null,
  };
  return assertComplete(manifest);
}

// ─── Orchestration ─────────────────────────────────────────────────────────

/**
 * Runs the full capture procedure against a GeoPackage — either one
 * already present on disk at `gpkgPath` (dry-run/fixture mode), or one
 * fetched by this function itself via the guarded live download path
 * (`live: true`; see below).
 *
 * Writes to a temp directory throughout; only on full success does it
 * return the temp directory's contents (still not moved into
 * `market-data/` by this function — that final, real placement is a
 * separate, later, explicitly-approved step). On any failure, the temp
 * directory is removed and nothing is returned.
 *
 * `gdalRunner` is injectable so tests can substitute a fake for the one
 * step that requires Docker, without ever faking geometry math itself.
 *
 * When `live` is true, `gpkgPath` is ignored and the national GeoPackage
 * is instead fetched via `liveDownloader` (defaulting to the real,
 * fixed-source `downloadLiveSource`) into its own temp directory, which is
 * unconditionally removed again in `finally` — success or failure — so
 * the downloaded national file never lingers on disk. This is `async`
 * (rather than blocking, like the rest of this module) only because of
 * that one network step; every other step remains the same synchronous
 * call it always was.
 */
async function runCapture({
  gpkgPath,
  layer = config.GDAL.layer,
  selectionRule = config.SELECTION_RULE,
  marketSlug,
  versionNumber,
  repoRoot,
  scriptRelativePath,
  gdalRunner = runGdalExtraction,
  gdalVersionString,
  now = () => new Date().toISOString(),
  live = false,
  liveDownloader = downloadLiveSource,
  liveRequestImpl,
}) {
  const tmpDir = makeTempDir('market-boundary-capture-');
  let liveTmpDir = null;
  try {
    let effectiveGpkgPath = gpkgPath;
    if (live) {
      const downloaded = await liveDownloader(liveRequestImpl);
      effectiveGpkgPath = downloaded.gpkgPath;
      liveTmpDir = downloaded.tmpDir;
    }

    const sourceArtifactHash = sha256File(effectiveGpkgPath);

    selectAndValidateFeature(effectiveGpkgPath, layer, selectionRule);

    const rawGeoJsonPath = gdalRunner({
      gpkgPath: effectiveGpkgPath,
      layer,
      selectionRule,
      gdalRef: config.GDAL.ref,
      outDir: tmpDir,
    });

    const { text: canonicalText } = canonicalizeGeoJson(
      rawGeoJsonPath,
      config.SERIALIZATION_RULE.coordinatePrecisionDecimals
    );
    const geometryHash = sha256String(canonicalText);

    const canonicalGeoJsonPath = path.join(tmpDir, 'breda.geojson');
    fs.writeFileSync(canonicalGeoJsonPath, canonicalText, 'utf8');

    const procedureRef = getProcedureRef(repoRoot, scriptRelativePath);
    if (!procedureRef.git_revision) {
      throw new HaltError(
        'procedure-ref-unavailable',
        'could not resolve a git revision for this script — a real, registered version must reference an exact, versioned procedure'
      );
    }

    const manifest = assembleManifest({
      marketSlug,
      versionNumber,
      sourceArtifactHash,
      geometryHash,
      gdalVersionString,
      procedureRef,
      retrievedAt: now(),
    });

    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    return { tmpDir, manifestPath, geojsonPath: canonicalGeoJsonPath, manifest };
  } catch (err) {
    // Attached so callers/tests can verify the temp directory was actually
    // removed — "no half-written artifact survives a failure" is a
    // testable property, not just an intention.
    err.removedTmpDir = tmpDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  } finally {
    // The downloaded national GeoPackage is never the deliverable — only
    // the derived manifest/GeoJSON in `tmpDir` is. It is removed here
    // unconditionally, on both the success and failure paths.
    if (liveTmpDir) {
      fs.rmSync(liveTmpDir, { recursive: true, force: true });
    }
  }
}

// ─── Output-directory handling: refuse-if-exists, clean-up-if-new-and-failed ─

/**
 * Returns the highest ancestor of `targetDir` (inclusive) that does not
 * yet exist on disk — i.e. the top of the subtree
 * `fs.mkdirSync(targetDir, { recursive: true })` would need to create.
 * Returns `null` if `targetDir` already exists.
 *
 * This is what lets a failed capture clean up exactly what it created
 * (and nothing that pre-existed): if `market-data/` already existed but
 * `market-data/boundaries/breda/v1` did not, this returns
 * `market-data/boundaries` — removing that one subtree deletes `boundaries`
 * and `breda` and `v1` together, while leaving `market-data/` itself, and
 * anything else under it, untouched.
 */
function findTopMostNewDir(targetDir) {
  const resolved = path.resolve(targetDir);
  if (fs.existsSync(resolved)) {
    return null;
  }
  let current = resolved;
  let parent = path.dirname(current);
  while (!fs.existsSync(parent)) {
    current = parent;
    const grandparent = path.dirname(parent);
    if (grandparent === parent) break; // reached filesystem root
    parent = grandparent;
  }
  return current;
}

/**
 * Wraps a `runCapture(...)`-shaped async factory with the output-directory
 * contract this tool must uphold:
 *
 *  - Refuses outright (throws, never creates or touches anything) if
 *    `outDir` already exists — an existing boundary version must never be
 *    silently overwritten or merged into.
 *  - Creates only the directories that do not yet exist.
 *  - On any failure (the capture itself, or the final copy), removes only
 *    the subtree this call itself created via `findTopMostNewDir` — never
 *    a directory that already existed before this call.
 *  - On success, copies the completed temp capture into `outDir` and
 *    removes the temp directory — the same atomic "build fully in temp,
 *    only place it in the real location once it is fully valid" contract
 *    `runCapture` already upholds internally.
 *
 * Deliberately has no `console.log`/`process.exitCode` side effects of its
 * own, so it is directly unit-testable via `assert.rejects`; `main` is
 * responsible for reporting and exit codes.
 */
async function runCliCapture(outDir, runCapturePromiseFactory) {
  const resolvedOutDir = path.resolve(outDir);
  if (fs.existsSync(resolvedOutDir)) {
    throw new HaltError(
      'output-directory-exists',
      `refusing to write into an already-existing directory: ${resolvedOutDir} — ` +
        'an existing boundary version must never be overwritten'
    );
  }

  const topNewDir = findTopMostNewDir(resolvedOutDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  try {
    const result = await runCapturePromiseFactory();
    fs.cpSync(result.tmpDir, resolvedOutDir, { recursive: true });
    fs.rmSync(result.tmpDir, { recursive: true, force: true });
    return { outDir: resolvedOutDir, manifest: result.manifest };
  } catch (err) {
    if (topNewDir) {
      fs.rmSync(topNewDir, { recursive: true, force: true });
    }
    throw err;
  }
}

// ─── CLI entry point ────────────────────────────────────────────────────────

/**
 * Live mode is real, wired code — not a stub — but it is still gated
 * behind two flags that must both be present and exactly matching
 * (`assertLiveConfirmation`), and behind every safeguard in
 * `downloadGeoPackage`. Nothing in this project invokes it against the
 * real PDOK endpoint; closing gate 1 for real is a separate, explicitly
 * approved step (see the ticket/report this script accompanies).
 */
function main(argv) {
  const args = argv.slice(2);
  const outIdx = args.indexOf('--out');
  const fixtureIdx = args.indexOf('--fixture');

  let liveCheck;
  try {
    liveCheck = assertLiveConfirmation(args, config.LIVE_SOURCE.expectedMarketSlug);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return undefined;
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  const scriptRelativePath = path.relative(repoRoot, __filename);

  if (liveCheck.live) {
    if (outIdx === -1) {
      console.error(
        `Usage (live mode): node capture-market-boundary.js --live ` +
          `--confirm-market=${config.LIVE_SOURCE.expectedMarketSlug} --out <dir>`
      );
      process.exitCode = 1;
      return undefined;
    }
    const outDir = args[outIdx + 1];

    return runCliCapture(outDir, () =>
      runCapture({
        live: true,
        marketSlug: liveCheck.marketSlug,
        versionNumber: 1,
        repoRoot,
        scriptRelativePath,
        gdalVersionString: execFileSync(
          'docker',
          ['run', '--rm', config.GDAL.ref, 'ogr2ogr', '--version'],
          { encoding: 'utf8' }
        ).trim(),
      })
    )
      .then((result) => {
        console.log(`Live capture complete. Manifest written to: ${path.join(result.outDir, 'manifest.json')}`);
      })
      .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
      });
  }

  if (fixtureIdx === -1 || outIdx === -1) {
    console.error('Usage (dry-run only): node capture-market-boundary.js --fixture <gpkg-path> --out <dir>');
    process.exitCode = 1;
    return undefined;
  }

  const gpkgPath = args[fixtureIdx + 1];
  const outDir = args[outIdx + 1];

  return runCliCapture(outDir, () =>
    runCapture({
      gpkgPath,
      marketSlug: 'breda',
      versionNumber: 1,
      repoRoot,
      scriptRelativePath,
      gdalVersionString: 'unresolved — real GDAL was not invoked outside tests in this CLI run',
    })
  )
    .then((result) => {
      console.log(`Dry-run capture complete. Manifest written to: ${path.join(result.outDir, 'manifest.json')}`);
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
  HaltError,
  sha256File,
  sha256String,
  generateUuidV7,
  selectAndValidateFeature,
  runGdalExtraction,
  assertLiveConfirmation,
  downloadGeoPackage,
  downloadLiveSource,
  validateRfc7946,
  canonicalizeGeoJson,
  canonicalJsonStringify,
  assembleManifest,
  assertComplete,
  getProcedureRef,
  runCapture,
  findTopMostNewDir,
  runCliCapture,
  REQUIRED_MANIFEST_FIELDS,
  REQUIRED_DERIVATION_FIELDS,
};
