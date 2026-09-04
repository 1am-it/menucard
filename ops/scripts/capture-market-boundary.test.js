'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { execFileSync } = require('node:child_process');
const { buildFixtureGeoPackage } = require('./__fixtures__/build-fixture-gpkg');
const {
  HaltError,
  sha256File,
  generateUuidV7,
  runCapture,
  runGdalExtraction,
  assertLiveConfirmation,
  downloadGeoPackage,
  findTopMostNewDir,
  runCliCapture,
  validateRfc7946,
  canonicalizeGeoJson,
  REQUIRED_MANIFEST_FIELDS,
  REQUIRED_DERIVATION_FIELDS,
} = require('./capture-market-boundary');
const config = require('./capture-market-boundary.config');

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

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_RELATIVE_PATH = path.relative(REPO_ROOT, path.join(__dirname, 'capture-market-boundary.js'));

function makeFixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-fixture-'));
}

/** A fake GDAL runner standing in for the real Docker/GDAL step. It does
 * NOT reimplement reprojection math — it returns a fixed, hand-written,
 * already-valid RFC 7946 Feature for the trivial synthetic fixture
 * geometry, so everything downstream of "GDAL ran" (canonicalization,
 * both hashes, manifest completeness, atomic write) is exercised for
 * real. What is faked is only "GDAL was invoked and succeeded" — the one
 * step this environment cannot verify without a running Docker daemon. */
function fakeGdalRunner({ outDir }) {
  const outPath = path.join(outDir, 'extracted.geojson');
  fs.writeFileSync(
    outPath,
    JSON.stringify({
      type: 'Feature',
      properties: { identificatie: 'GM0758', code: '0758', naam: 'Breda' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [4.0, 51.0],
            [4.1, 51.0],
            [4.1, 51.1],
            [4.0, 51.1],
            [4.0, 51.0],
          ],
        ],
      },
    })
  );
  return outPath;
}

function baseCaptureArgs(overrides = {}) {
  return {
    marketSlug: 'breda',
    versionNumber: 1,
    repoRoot: REPO_ROOT,
    scriptRelativePath: SCRIPT_RELATIVE_PATH,
    gdalRunner: fakeGdalRunner,
    gdalVersionString: 'GDAL 3.13.3, released 2026 (fixture test — not queried from a real container)',
    ...overrides,
  };
}

// ─── UUIDv7 validation ─────────────────────────────────────────────────────

test('generateUuidV7 produces RFC 9562-conformant UUIDv7 values', () => {
  const samples = Array.from({ length: 200 }, () => generateUuidV7());
  const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  for (const id of samples) {
    // Valid UUID format (RFC 9562 §4 canonical textual representation).
    assert.match(id, UUID_SHAPE, `not a valid UUID string: ${id}`);

    const groups = id.split('-');
    // Version: the first hex digit of the third group must be "7".
    assert.equal(groups[2][0], '7', `expected version nibble 7, got ${groups[2][0]} in ${id}`);

    // Variant: the first hex digit of the fourth group, read as 4 bits,
    // must start with "10" — i.e. the nibble is in [8, 9, a, b].
    const variantNibble = parseInt(groups[3][0], 16);
    assert.ok(
      variantNibble >= 0b1000 && variantNibble <= 0b1011,
      `expected RFC variant bits "10xx" (nibble 8-b), got ${groups[3][0]} in ${id}`
    );
  }

  // Uniqueness across the sample.
  assert.equal(new Set(samples).size, samples.length, 'expected all generated UUIDs to be unique');

  // Time-ordering: the 48-bit timestamp component (first 12 hex chars,
  // ignoring dashes) should be non-decreasing across sequential calls —
  // the whole point of choosing v7 over v4.
  const timestamps = samples.map((id) => id.replace(/-/g, '').slice(0, 12));
  const sorted = [...timestamps].sort();
  assert.deepEqual(timestamps, sorted, 'expected UUIDv7 timestamp prefixes to be non-decreasing over time');
});

// ─── Happy path ────────────────────────────────────────────────────────────

test(
  'happy path (primary): real pinned GDAL container selects, validates, reprojects, and produces a complete manifest',
  { skip: DOCKER_REACHABLE ? false : DOCKER_SKIP_REASON },
  async () => {
    const dir = makeFixtureDir();
    const gpkgPath = path.join(dir, 'fixture.gpkg');
    buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM0758', code: '0758', naam: 'Breda' }]);

    // No injected double here — `gdalRunner` defaults to the real
    // `runGdalExtraction`, which shells out to `docker run` against the
    // already-pinned image digest and the synthetic fixture only.
    const result = await runCapture({
      gpkgPath,
      marketSlug: 'breda',
      versionNumber: 1,
      repoRoot: REPO_ROOT,
      scriptRelativePath: SCRIPT_RELATIVE_PATH,
      gdalVersionString: execFileSync(
        'docker',
        ['run', '--rm', config.GDAL.ref, 'ogr2ogr', '--version'],
        { encoding: 'utf8' }
      ).trim(),
    });

    for (const field of REQUIRED_MANIFEST_FIELDS) {
      assert.notStrictEqual(result.manifest[field], null, `expected ${field} not to be null`);
      assert.notStrictEqual(result.manifest[field], undefined, `expected ${field} not to be undefined`);
    }
    for (const field of REQUIRED_DERIVATION_FIELDS) {
      assert.notStrictEqual(result.manifest.derivation[field], null, `expected derivation.${field} not to be null`);
    }

    assert.equal(result.manifest.source_artifact_hash, sha256File(gpkgPath));
    assert.notEqual(result.manifest.source_artifact_hash, result.manifest.geometry_hash);
    assert.match(result.manifest.source_artifact_hash, /^[0-9a-f]{64}$/);
    assert.match(result.manifest.geometry_hash, /^[0-9a-f]{64}$/);

    // The GeoJSON GDAL actually produced: RFC 7946 shape, no legacy "crs"
    // member, and coordinates in a plausible WGS84 lon/lat range — proof
    // the container genuinely reprojected from EPSG:28992, not an
    // identity copy or a stub.
    const writtenGeojson = JSON.parse(fs.readFileSync(result.geojsonPath, 'utf8'));
    assert.equal(writtenGeojson.crs, undefined);
    const feature = validateRfc7946(writtenGeojson);
    assert.equal(feature.geometry.type, 'Polygon');
    const flatCoords = feature.geometry.coordinates.flat(2);
    for (let i = 0; i < flatCoords.length; i += 2) {
      const [lon, lat] = [flatCoords[i], flatCoords[i + 1]];
      assert.ok(lon > -180 && lon < 180, `longitude out of range: ${lon}`);
      assert.ok(lat > -90 && lat < 90, `latitude out of range: ${lat}`);
      // The synthetic fixture is a fabricated square roughly in the
      // Netherlands' RD-New numeric range — a correct reprojection should
      // land roughly in the Netherlands' rough lon/lat envelope, not
      // somewhere wildly unrelated (a coarse sanity check, not a
      // real-boundary assertion).
      assert.ok(lon > 3 && lon < 8, `expected a roughly-Netherlands longitude, got ${lon}`);
      assert.ok(lat > 50 && lat < 54, `expected a roughly-Netherlands latitude, got ${lat}`);
    }

    // geometry_hash matches an independent recomputation from the actual,
    // already-canonical bytes written to breda.geojson — proving the hash
    // covers exactly what the real container's output became on disk,
    // not a value computed some other way.
    assert.equal(result.manifest.geometry_hash, sha256File(result.geojsonPath));

    assert.equal(result.manifest.derivation.tool_reference, config.GDAL.ref);
    assert.match(result.manifest.derivation.tool_reference, /^ghcr\.io\/osgeo\/gdal@sha256:[0-9a-f]{64}$/);
    assert.match(result.manifest.derivation.tool, /GDAL/);
    assert.match(result.manifest.derivation.procedure_ref.git_revision, /^[0-9a-f]{40}$/);
    assert.equal(result.manifest.derivation.procedure_ref.path, SCRIPT_RELATIVE_PATH);
    assert.equal(typeof result.manifest.derivation.procedure_ref.working_tree_dirty_for_this_file, 'boolean');

    fs.rmSync(result.tmpDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
);

test(
  'happy path (supplementary, injected double): exercises manifest/hash/atomicity logic without invoking Docker',
  async () => {
    const dir = makeFixtureDir();
    const gpkgPath = path.join(dir, 'fixture.gpkg');
    buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM0758', code: '0758', naam: 'Breda' }]);

    const result = await runCapture({ gpkgPath, ...baseCaptureArgs() });

    // Manifest completeness — no required field is null/undefined.
    for (const field of REQUIRED_MANIFEST_FIELDS) {
      assert.notStrictEqual(result.manifest[field], null, `expected ${field} not to be null`);
      assert.notStrictEqual(result.manifest[field], undefined, `expected ${field} not to be undefined`);
    }
    for (const field of REQUIRED_DERIVATION_FIELDS) {
      assert.notStrictEqual(result.manifest.derivation[field], null, `expected derivation.${field} not to be null`);
    }

    // Hashes: present, different, and semantically correct.
    assert.equal(result.manifest.source_artifact_hash, sha256File(gpkgPath));
    assert.notEqual(result.manifest.source_artifact_hash, result.manifest.geometry_hash);
    assert.match(result.manifest.source_artifact_hash, /^[0-9a-f]{64}$/);
    assert.match(result.manifest.geometry_hash, /^[0-9a-f]{64}$/);

    // geometry_hash must match an independent recomputation from the
    // written breda.geojson file — proving it's a real hash of real bytes,
    // not a placeholder.
    const writtenGeojson = fs.readFileSync(result.geojsonPath, 'utf8');
    const { text: recomputedCanonical } = canonicalizeGeoJson(
      (() => {
        // canonicalizeGeoJson expects a *raw* GDAL-shaped file path; feed it
        // the same fake output again to recompute independently.
        const tmp = path.join(dir, 'recheck.geojson');
        fakeGdalRunner({ outDir: dir });
        fs.renameSync(path.join(dir, 'extracted.geojson'), tmp);
        return tmp;
      })(),
      config.SERIALIZATION_RULE.coordinatePrecisionDecimals
    );
    const crypto = require('node:crypto');
    assert.equal(
      result.manifest.geometry_hash,
      crypto.createHash('sha256').update(recomputedCanonical, 'utf8').digest('hex')
    );

    // RFC 7946 / WGS84 shape: no legacy "crs" member, valid Polygon.
    const parsedGeojson = JSON.parse(writtenGeojson);
    assert.equal(parsedGeojson.crs, undefined);
    const feature = validateRfc7946(parsedGeojson); // throws if invalid
    assert.equal(feature.geometry.type, 'Polygon');

    // Tool/procedure reference resolvable for a future manifest.
    assert.equal(result.manifest.derivation.tool_reference, config.GDAL.ref);
    assert.match(result.manifest.derivation.tool_reference, /^ghcr\.io\/osgeo\/gdal@sha256:[0-9a-f]{64}$/);
    assert.match(result.manifest.derivation.procedure_ref.git_revision, /^[0-9a-f]{40}$/);
    assert.equal(result.manifest.derivation.procedure_ref.path, SCRIPT_RELATIVE_PATH);
    assert.equal(typeof result.manifest.derivation.procedure_ref.working_tree_dirty_for_this_file, 'boolean');

    fs.rmSync(result.tmpDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
);

test('halts with no output when no feature matches the primary selector', async () => {
  const dir = makeFixtureDir();
  const gpkgPath = path.join(dir, 'fixture.gpkg');
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM9999', code: '9999', naam: 'Nietbreda' }]);

  await assert.rejects(
    () => runCapture({ gpkgPath, ...baseCaptureArgs() }),
    (err) => {
      assert.ok(err instanceof HaltError);
      assert.equal(err.reason, 'no-matching-feature');
      assert.ok(err.removedTmpDir, 'expected a tmp dir to have been created and recorded');
      assert.equal(fs.existsSync(err.removedTmpDir), false, 'temp directory must not survive a halt');
      return true;
    }
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('halts with no output when more than one feature matches the primary selector', async () => {
  const dir = makeFixtureDir();
  const gpkgPath = path.join(dir, 'fixture.gpkg');
  buildFixtureGeoPackage(gpkgPath, [
    { identificatie: 'GM0758', code: '0758', naam: 'Breda' },
    { identificatie: 'GM0758', code: '0758', naam: 'Breda (duplicate row)' },
  ]);

  await assert.rejects(
    () => runCapture({ gpkgPath, ...baseCaptureArgs() }),
    (err) => {
      assert.ok(err instanceof HaltError);
      assert.equal(err.reason, 'duplicate-matching-features');
      assert.equal(fs.existsSync(err.removedTmpDir), false);
      return true;
    }
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('halts with no output when code does not match', async () => {
  const dir = makeFixtureDir();
  const gpkgPath = path.join(dir, 'fixture.gpkg');
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM0758', code: '0001', naam: 'Breda' }]);

  await assert.rejects(
    () => runCapture({ gpkgPath, ...baseCaptureArgs() }),
    (err) => {
      assert.ok(err instanceof HaltError);
      assert.equal(err.reason, 'validation-mismatch');
      assert.match(err.detail, /code/);
      assert.equal(fs.existsSync(err.removedTmpDir), false);
      return true;
    }
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('halts with no output when naam does not match', async () => {
  const dir = makeFixtureDir();
  const gpkgPath = path.join(dir, 'fixture.gpkg');
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM0758', code: '0758', naam: 'Amsterdam' }]);

  await assert.rejects(
    () => runCapture({ gpkgPath, ...baseCaptureArgs() }),
    (err) => {
      assert.ok(err instanceof HaltError);
      assert.equal(err.reason, 'validation-mismatch');
      assert.match(err.detail, /naam/);
      assert.equal(fs.existsSync(err.removedTmpDir), false);
      return true;
    }
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

/** Runs the REAL `runGdalExtraction` (real code path, real argument
 * building, real error translation) but injects a fake `execFileSyncImpl`
 * that always throws — simulating "Docker/the container is unavailable"
 * deterministically, independent of whatever this machine's actual Docker
 * state happens to be right now. Only the one child-process boundary is
 * faked; everything else (arg assembly, output-path check, HaltError
 * translation) runs for real. */
function unavailableDockerGdalRunner(args) {
  return runGdalExtraction({
    ...args,
    execFileSyncImpl: () => {
      const err = new Error(
        "spawnSync docker ENOENT (simulated for a deterministic test — this is not this machine's real Docker state)"
      );
      err.stderr = Buffer.from('docker: command not found (simulated)');
      throw err;
    },
  });
}

test('real GDAL/Docker step fails with an understandable error when the container/tooling is unavailable', async () => {
  const dir = makeFixtureDir();
  const gpkgPath = path.join(dir, 'fixture.gpkg');
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM0758', code: '0758', naam: 'Breda' }]);

  // Uses the REAL runGdalExtraction, but with the child-process call itself
  // faked to fail (see unavailableDockerGdalRunner above) — this test's
  // outcome no longer depends on whether Docker actually happens to be
  // reachable on this machine at test time.
  await assert.rejects(
    () => runCapture({ gpkgPath, ...baseCaptureArgs({ gdalRunner: unavailableDockerGdalRunner }) }),
    (err) => {
      assert.ok(err instanceof HaltError);
      assert.equal(err.reason, 'gdal-extraction-failed');
      assert.match(err.message, /docker/i);
      assert.equal(fs.existsSync(err.removedTmpDir), false);
      return true;
    }
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── Live-mode confirmation gate ───────────────────────────────────────────

test('live mode without both confirmation flags refuses', () => {
  assert.deepEqual(assertLiveConfirmation([], 'breda'), { live: false });
  assert.deepEqual(assertLiveConfirmation(['--fixture', 'x.gpkg'], 'breda'), { live: false });

  assert.throws(
    () => assertLiveConfirmation(['--live'], 'breda'),
    (err) => {
      assert.ok(err instanceof HaltError);
      assert.equal(err.reason, 'live-confirmation-missing');
      return true;
    },
    'expected --live alone (no --confirm-market at all) to refuse'
  );

  assert.throws(
    () => assertLiveConfirmation(['--live', '--confirm-market=amsterdam'], 'breda'),
    (err) => {
      assert.ok(err instanceof HaltError);
      assert.equal(err.reason, 'live-confirmation-missing');
      return true;
    },
    'expected a mismatched market slug (not a free selector) to refuse'
  );

  assert.throws(
    () => assertLiveConfirmation(['--live', '--confirm-market='], 'breda'),
    (err) => err instanceof HaltError && err.reason === 'live-confirmation-missing',
    'expected an empty confirmation value to refuse'
  );

  assert.deepEqual(assertLiveConfirmation(['--live', '--confirm-market=breda'], 'breda'), {
    live: true,
    marketSlug: 'breda',
  });
});

// ─── Live download: URL/host/path validation (no network involved) ────────

test('live download refuses a non-HTTPS URL without attempting any request', async () => {
  await assert.rejects(
    () =>
      downloadGeoPackage({
        url: 'http://service.pdok.nl/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg',
        expectedProtocol: 'https:',
        expectedHost: 'service.pdok.nl',
        expectedPath: '/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg',
        allowedContentTypes: ['application/octet-stream'],
        maxBytes: 1024,
        requestImpl: () => {
          throw new Error('requestImpl must never be called for a rejected URL');
        },
      }),
    (err) => err instanceof HaltError && err.reason === 'live-download-protocol-rejected'
  );
});

test('live download refuses a mismatched host without attempting any request', async () => {
  await assert.rejects(
    () =>
      downloadGeoPackage({
        url: 'https://evil.example.com/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg',
        expectedProtocol: 'https:',
        expectedHost: 'service.pdok.nl',
        expectedPath: '/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg',
        allowedContentTypes: ['application/octet-stream'],
        maxBytes: 1024,
        requestImpl: () => {
          throw new Error('requestImpl must never be called for a rejected URL');
        },
      }),
    (err) => err instanceof HaltError && err.reason === 'live-download-host-mismatch'
  );
});

test('live download refuses a mismatched path without attempting any request', async () => {
  await assert.rejects(
    () =>
      downloadGeoPackage({
        url: 'https://service.pdok.nl/some/other/file.gpkg',
        expectedProtocol: 'https:',
        expectedHost: 'service.pdok.nl',
        expectedPath: '/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg',
        allowedContentTypes: ['application/octet-stream'],
        maxBytes: 1024,
        requestImpl: () => {
          throw new Error('requestImpl must never be called for a rejected URL');
        },
      }),
    (err) => err instanceof HaltError && err.reason === 'live-download-path-mismatch'
  );
});

// ─── Live download: synthetic local server (no real PDOK network access) ──
//
// A local, in-process HTTP server on 127.0.0.1 stands in for PDOK so the
// status/content-type/size/redirect handling can be exercised for real,
// without ever making a real network request. `expectedProtocol` is set to
// 'http:' only in these tests (the local server has no TLS cert); the real
// production entry point (`downloadLiveSource`) always uses the fixed
// `config.LIVE_SOURCE` values, which require 'https:'.

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stopTestServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('live download halts with no leftover file on a redirect response', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:1/elsewhere' });
    res.end();
  });
  try {
    const { port } = server.address();
    let capturedTmpDir;
    await assert.rejects(
      async () => {
        try {
          return await downloadGeoPackage({
            url: `http://127.0.0.1:${port}/fixture.gpkg`,
            expectedProtocol: 'http:',
            expectedHost: '127.0.0.1',
            expectedPath: '/fixture.gpkg',
            allowedContentTypes: ['application/octet-stream'],
            maxBytes: 1024,
            requestImpl: http.get,
          });
        } catch (err) {
          capturedTmpDir = err.removedTmpDir;
          throw err;
        }
      },
      (err) => err instanceof HaltError && err.reason === 'live-download-redirect-rejected'
    );
    assert.ok(capturedTmpDir, 'expected a tmp dir to have been created and recorded');
    assert.equal(fs.existsSync(capturedTmpDir), false, 'temp directory must not survive a rejected redirect');
  } finally {
    await stopTestServer(server);
  }
});

test('live download halts with no leftover file on a non-200 status', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/octet-stream' });
    res.end('server error');
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        downloadGeoPackage({
          url: `http://127.0.0.1:${port}/fixture.gpkg`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/fixture.gpkg',
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
          requestImpl: http.get,
        }),
      (err) => {
        assert.ok(err instanceof HaltError);
        assert.equal(err.reason, 'live-download-bad-status');
        assert.equal(fs.existsSync(err.removedTmpDir), false);
        return true;
      }
    );
  } finally {
    await stopTestServer(server);
  }
});

test('live download halts with no leftover file on an unexpected content-type', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>not a geopackage</html>');
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        downloadGeoPackage({
          url: `http://127.0.0.1:${port}/fixture.gpkg`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/fixture.gpkg',
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
          requestImpl: http.get,
        }),
      (err) => {
        assert.ok(err instanceof HaltError);
        assert.equal(err.reason, 'live-download-bad-content-type');
        assert.equal(fs.existsSync(err.removedTmpDir), false);
        return true;
      }
    );
  } finally {
    await stopTestServer(server);
  }
});

test('live download halts with no leftover file when the response exceeds maxBytes', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.write(Buffer.alloc(2000, 1));
    res.end(Buffer.alloc(2000, 2));
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        downloadGeoPackage({
          url: `http://127.0.0.1:${port}/fixture.gpkg`,
          expectedProtocol: 'http:',
          expectedHost: '127.0.0.1',
          expectedPath: '/fixture.gpkg',
          allowedContentTypes: ['application/octet-stream'],
          maxBytes: 1024,
          requestImpl: http.get,
        }),
      (err) => {
        assert.ok(err instanceof HaltError);
        assert.equal(err.reason, 'live-download-too-large');
        assert.equal(fs.existsSync(err.removedTmpDir), false);
        return true;
      }
    );
  } finally {
    await stopTestServer(server);
  }
});

test('a valid synthetic download flows through the full temporary capture chain, and the downloaded source is removed on success', async () => {
  const fixtureDir = makeFixtureDir();
  const gpkgPath = path.join(fixtureDir, 'fixture.gpkg');
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM0758', code: '0758', naam: 'Breda' }]);
  const gpkgBytes = fs.readFileSync(gpkgPath);

  const server = await startTestServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(gpkgBytes);
  });

  let capturedLiveTmpDir;
  try {
    const { port } = server.address();

    // `runCapture`'s real live branch, exercised end-to-end, with only the
    // download target swapped for the local synthetic server (never real
    // PDOK config/network) and the GDAL step swapped for the same
    // dependency-free fake used by the "supplementary" fixture test above
    // — this test's purpose is the live-download plumbing, not GDAL, which
    // is already independently proven by the real-container happy path.
    const liveDownloader = async () => {
      const downloaded = await downloadGeoPackage({
        url: `http://127.0.0.1:${port}/fixture.gpkg`,
        expectedProtocol: 'http:',
        expectedHost: '127.0.0.1',
        expectedPath: '/fixture.gpkg',
        allowedContentTypes: ['application/octet-stream'],
        maxBytes: 10 * 1024 * 1024,
        requestImpl: http.get,
      });
      capturedLiveTmpDir = downloaded.tmpDir;
      return downloaded;
    };

    const result = await runCapture({
      live: true,
      liveDownloader,
      ...baseCaptureArgs(),
    });

    for (const field of REQUIRED_MANIFEST_FIELDS) {
      assert.notStrictEqual(result.manifest[field], null, `expected ${field} not to be null`);
      assert.notStrictEqual(result.manifest[field], undefined, `expected ${field} not to be undefined`);
    }
    assert.equal(result.manifest.source_artifact_hash, sha256File(gpkgPath));
    assert.notEqual(result.manifest.source_artifact_hash, result.manifest.geometry_hash);

    assert.ok(capturedLiveTmpDir, 'expected the live downloader to have created a temp dir');
    assert.equal(
      fs.existsSync(capturedLiveTmpDir),
      false,
      'the downloaded national GeoPackage temp dir must be removed after a successful capture'
    );

    fs.rmSync(result.tmpDir, { recursive: true, force: true });
  } finally {
    await stopTestServer(server);
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('the downloaded live source is removed even when a later capture step fails', async () => {
  const fixtureDir = makeFixtureDir();
  const gpkgPath = path.join(fixtureDir, 'fixture.gpkg');
  // A feature that will fail validation further down the pipeline — the
  // download itself succeeds; selection/validation is what fails.
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM9999', code: '9999', naam: 'Nietbreda' }]);
  const gpkgBytes = fs.readFileSync(gpkgPath);

  const server = await startTestServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(gpkgBytes);
  });

  let capturedLiveTmpDir;
  try {
    const { port } = server.address();
    const liveDownloader = async () => {
      const downloaded = await downloadGeoPackage({
        url: `http://127.0.0.1:${port}/fixture.gpkg`,
        expectedProtocol: 'http:',
        expectedHost: '127.0.0.1',
        expectedPath: '/fixture.gpkg',
        allowedContentTypes: ['application/octet-stream'],
        maxBytes: 10 * 1024 * 1024,
        requestImpl: http.get,
      });
      capturedLiveTmpDir = downloaded.tmpDir;
      return downloaded;
    };

    await assert.rejects(
      () => runCapture({ live: true, liveDownloader, ...baseCaptureArgs() }),
      (err) => err instanceof HaltError && err.reason === 'no-matching-feature'
    );

    assert.ok(capturedLiveTmpDir, 'expected the live downloader to have created a temp dir');
    assert.equal(
      fs.existsSync(capturedLiveTmpDir),
      false,
      'the downloaded national GeoPackage temp dir must be removed even after a downstream failure'
    );
  } finally {
    await stopTestServer(server);
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

// ─── Fix 1: no dependency on a source-internal primary key ────────────────

test('the fixture GeoPackage exposes no "id" column, yet a full capture still succeeds', async () => {
  const dir = makeFixtureDir();
  const gpkgPath = path.join(dir, 'fixture.gpkg');
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM0758', code: '0758', naam: 'Breda' }]);

  // Directly inspect the fixture's real schema — proves this is a genuine
  // schema property being tested, not just an assumption about the
  // fixture builder's intent.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(gpkgPath, { readOnly: true });
  const columns = db.prepare("PRAGMA table_info('gemeentegebied')").all().map((c) => c.name);
  db.close();
  assert.ok(!columns.includes('id'), `expected no "id" column, found columns: ${columns.join(', ')}`);
  assert.ok(columns.includes('fid'), 'expected the fixture to use a differently-named internal key ("fid")');

  const result = await runCapture({ gpkgPath, ...baseCaptureArgs() });
  assert.equal(result.manifest.feature_selection_rule.primarySelector.field, 'identificatie');
  assert.match(result.manifest.source_artifact_hash, /^[0-9a-f]{64}$/);

  fs.rmSync(result.tmpDir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── Fix 2: no leftover output-directory structure after a failed capture ─

test('refuses to run when the output directory already exists, and never invokes the capture factory', async () => {
  const parentDir = makeFixtureDir();
  const existingOutDir = path.join(parentDir, 'v1');
  fs.mkdirSync(existingOutDir);
  const sentinelPath = path.join(existingOutDir, 'sentinel.txt');
  fs.writeFileSync(sentinelPath, 'pre-existing content that must survive untouched');

  let factoryCalled = false;
  await assert.rejects(
    () =>
      runCliCapture(existingOutDir, async () => {
        factoryCalled = true;
        throw new Error('the capture factory must never be invoked when the output directory already exists');
      }),
    (err) => {
      assert.ok(err instanceof HaltError);
      assert.equal(err.reason, 'output-directory-exists');
      return true;
    }
  );

  assert.equal(factoryCalled, false, 'expected the capture factory to never be invoked');
  assert.equal(fs.existsSync(sentinelPath), true, 'expected the pre-existing directory and its contents to survive');

  fs.rmSync(parentDir, { recursive: true, force: true });
});

test('findTopMostNewDir identifies exactly the subtree that does not yet exist', () => {
  const parentDir = makeFixtureDir();
  // parentDir itself exists; nothing under it does yet.
  const deepTarget = path.join(parentDir, 'boundaries', 'breda', 'v1');
  assert.equal(findTopMostNewDir(deepTarget), path.join(parentDir, 'boundaries'));

  // Now pre-create "boundaries" — only "breda/v1" should be considered new.
  fs.mkdirSync(path.join(parentDir, 'boundaries'));
  assert.equal(findTopMostNewDir(deepTarget), path.join(parentDir, 'boundaries', 'breda'));

  // An already-existing target returns null.
  fs.mkdirSync(path.join(parentDir, 'boundaries', 'breda'));
  fs.mkdirSync(deepTarget);
  assert.equal(findTopMostNewDir(deepTarget), null);

  fs.rmSync(parentDir, { recursive: true, force: true });
});

test('removes only the newly-created output directory tree after a failed capture, leaving pre-existing ancestors untouched', async () => {
  const parentDir = makeFixtureDir(); // stands in for an already-existing market-data/
  const siblingMarker = path.join(parentDir, 'sibling.txt');
  fs.writeFileSync(siblingMarker, 'must survive');
  const outDir = path.join(parentDir, 'boundaries', 'breda', 'v1'); // none of this exists yet

  await assert.rejects(
    () =>
      runCliCapture(outDir, async () => {
        throw new HaltError('no-matching-feature', 'simulated failure for this test');
      }),
    (err) => err instanceof HaltError && err.reason === 'no-matching-feature'
  );

  assert.equal(fs.existsSync(outDir), false, 'expected the output directory to be removed after a failed capture');
  assert.equal(
    fs.existsSync(path.join(parentDir, 'boundaries')),
    false,
    'expected the newly-created intermediate directory to be removed after a failed capture'
  );
  assert.equal(fs.existsSync(siblingMarker), true, 'expected a pre-existing sibling file to survive untouched');
  assert.equal(fs.existsSync(parentDir), true, 'expected the pre-existing parent directory itself to survive');

  fs.rmSync(parentDir, { recursive: true, force: true });
});

test('runCliCapture writes atomically into a freshly-created output directory on success', async () => {
  const parentDir = makeFixtureDir();
  const gpkgPath = path.join(parentDir, 'fixture.gpkg');
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM0758', code: '0758', naam: 'Breda' }]);
  const outDir = path.join(parentDir, 'out', 'boundaries', 'breda', 'v1');

  const result = await runCliCapture(outDir, () => runCapture({ gpkgPath, ...baseCaptureArgs() }));

  assert.equal(result.outDir, path.resolve(outDir));
  assert.ok(fs.existsSync(path.join(outDir, 'manifest.json')), 'expected manifest.json in the output directory');
  assert.ok(fs.existsSync(path.join(outDir, 'breda.geojson')), 'expected breda.geojson in the output directory');

  fs.rmSync(parentDir, { recursive: true, force: true });
});

test('a failed live capture (after a successful download) leaves neither an output directory nor a leftover downloaded source', async () => {
  const fixtureDir = makeFixtureDir();
  const gpkgPath = path.join(fixtureDir, 'fixture.gpkg');
  // This feature will pass the download but fail selection — exercises the
  // Fix 1 + Fix 2 guarantees together, end-to-end.
  buildFixtureGeoPackage(gpkgPath, [{ identificatie: 'GM9999', code: '9999', naam: 'Nietbreda' }]);
  const gpkgBytes = fs.readFileSync(gpkgPath);

  const server = await startTestServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(gpkgBytes);
  });

  const parentDir = makeFixtureDir();
  const outDir = path.join(parentDir, 'market-data', 'boundaries', 'breda', 'v1');
  let capturedLiveTmpDir;

  try {
    const { port } = server.address();
    const liveDownloader = async () => {
      const downloaded = await downloadGeoPackage({
        url: `http://127.0.0.1:${port}/fixture.gpkg`,
        expectedProtocol: 'http:',
        expectedHost: '127.0.0.1',
        expectedPath: '/fixture.gpkg',
        allowedContentTypes: ['application/octet-stream'],
        maxBytes: 10 * 1024 * 1024,
        requestImpl: http.get,
      });
      capturedLiveTmpDir = downloaded.tmpDir;
      return downloaded;
    };

    await assert.rejects(
      () => runCliCapture(outDir, () => runCapture({ live: true, liveDownloader, ...baseCaptureArgs() })),
      (err) => err instanceof HaltError && err.reason === 'no-matching-feature'
    );

    assert.equal(fs.existsSync(outDir), false, 'expected no output directory to remain');
    assert.equal(
      fs.existsSync(path.join(parentDir, 'market-data')),
      false,
      'expected no newly-created market-data/ parent to remain'
    );
    assert.ok(capturedLiveTmpDir, 'expected the live downloader to have created a temp dir');
    assert.equal(fs.existsSync(capturedLiveTmpDir), false, 'expected the downloaded national GeoPackage to be removed');
  } finally {
    await stopTestServer(server);
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});
