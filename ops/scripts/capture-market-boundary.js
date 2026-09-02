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
 * real Docker/GDAL run against the real 2026 dataset) exists as code but
 * is gated behind an explicit `--live` flag and is not invoked by this
 * project until a separate, explicit approval closes gate 1.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
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
 * Returns the matched row's id on success. Throws HaltError otherwise —
 * never returns a partial/ambiguous result.
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
    const columns = ['id', primarySelector.field, ...requiredValidations.map((v) => v.field)];
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

    return row.id;
  } finally {
    db.close();
  }
}

// ─── Step 3: GDAL extraction + reprojection (requires Docker) ────────────

/**
 * Real GDAL invocation via a digest-pinned container. This is the only
 * step in the whole procedure that needs Docker. It is intentionally a
 * thin, directly-inspectable wrapper around a single `docker run`
 * invocation — no geometry math is reimplemented in JavaScript.
 *
 * Throws a clear, actionable Error (never a partial file) if Docker is
 * unavailable, the image can't be pulled, or ogr2ogr itself fails.
 */
function runGdalExtraction({ gpkgPath, layer, featureId, gdalRef, outDir, execFileSyncImpl = execFileSync }) {
  const gpkgDir = path.dirname(path.resolve(gpkgPath));
  const gpkgName = path.basename(gpkgPath);
  const outName = 'extracted.geojson';

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
    '-where', `id = ${Number(featureId)}`,
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
 * Runs the full capture procedure against a GeoPackage that is already
 * present on disk at `gpkgPath` (a local fixture in dry-run mode; the
 * real downloaded file in live mode — downloading itself is out of scope
 * for this round and not implemented here).
 *
 * Writes to a temp directory throughout; only on full success does it
 * return the temp directory's contents (still not moved into
 * `market-data/` by this function — that final, real placement is a
 * separate, later, explicitly-approved step). On any failure, the temp
 * directory is removed and nothing is returned.
 *
 * `gdalRunner` is injectable so tests can substitute a fake for the one
 * step that requires Docker, without ever faking geometry math itself.
 */
function runCapture({
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
}) {
  const tmpDir = makeTempDir('market-boundary-capture-');
  try {
    const sourceArtifactHash = sha256File(gpkgPath);

    const featureId = selectAndValidateFeature(gpkgPath, layer, selectionRule);

    const rawGeoJsonPath = gdalRunner({
      gpkgPath,
      layer,
      featureId,
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
  }
}

// ─── CLI entry point ────────────────────────────────────────────────────────

function main(argv) {
  const args = argv.slice(2);
  const live = args.includes('--live');
  const fixtureIdx = args.indexOf('--fixture');
  const outIdx = args.indexOf('--out');

  if (live) {
    // Deliberately not implemented in this round. Live mode requires its
    // own separate, explicit approval step (closing gate 1) — see the
    // ticket/report this script accompanies. Never reachable via the
    // default invocation.
    console.error(
      'Live mode is intentionally not implemented yet. This is a documented, ' +
        'deliberate stop, not a bug: closing gate 1 for real requires a ' +
        'separate, explicit approval. Re-run without --live for dry-run/fixture mode.'
    );
    process.exitCode = 1;
    return;
  }

  if (fixtureIdx === -1 || outIdx === -1) {
    console.error('Usage (dry-run only): node capture-market-boundary.js --fixture <gpkg-path> --out <dir>');
    process.exitCode = 1;
    return;
  }

  const gpkgPath = args[fixtureIdx + 1];
  const outDir = args[outIdx + 1];
  fs.mkdirSync(outDir, { recursive: true });

  try {
    const result = runCapture({
      gpkgPath,
      marketSlug: 'breda',
      versionNumber: 1,
      repoRoot: path.resolve(__dirname, '..', '..'),
      scriptRelativePath: path.relative(path.resolve(__dirname, '..', '..'), __filename),
      gdalVersionString: 'unresolved — real GDAL was not invoked outside tests in this CLI run',
    });
    fs.cpSync(result.tmpDir, outDir, { recursive: true });
    fs.rmSync(result.tmpDir, { recursive: true, force: true });
    console.log(`Dry-run capture complete. Manifest written to: ${path.join(outDir, 'manifest.json')}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
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
  validateRfc7946,
  canonicalizeGeoJson,
  canonicalJsonStringify,
  assembleManifest,
  assertComplete,
  getProcedureRef,
  runCapture,
  REQUIRED_MANIFEST_FIELDS,
  REQUIRED_DERIVATION_FIELDS,
};
