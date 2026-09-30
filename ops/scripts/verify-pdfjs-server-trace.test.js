'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  ROUTE_RELATIVE_PATH,
  BUNDLED_RUNTIME_MARKERS,
  checkPdfjsServerOutput,
  readNextOutput,
} = require('./verify-pdfjs-server-trace');

const REPO_ROOT = path.join(__dirname, '..', '..');

const GOOD_ROUTE_SOURCE =
  'a=>{a.exports=import("pdfjs-dist/legacy/build/pdf.mjs")},b=>{b.exports=import("pdfjs-dist/legacy/build/pdf.worker.mjs")}';
const GOOD_TRACE = [
  '../../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  '../../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  '../../../../../../../node_modules/next/package.json',
];

function goodOutput(overrides = {}) {
  return {
    routeSource: GOOD_ROUTE_SOURCE,
    traceFiles: GOOD_TRACE,
    serverSources: [{ file: 'server/chunks/123.js', source: 'module.exports={}' }],
    ...overrides,
  };
}

test('passes for route output that imports PDF.js natively, traces both files, and bundles no PDF.js runtime', () => {
  assert.deepEqual(checkPdfjsServerOutput(goodOutput()), { ok: true, problems: [] });
});

test('fails when the route file trace ships pdf.mjs without pdf.worker.mjs — the regression that broke every PDF', () => {
  const result = checkPdfjsServerOutput(goodOutput({ traceFiles: [GOOD_TRACE[0], GOOD_TRACE[2]] }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, ['route file trace does not include node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']);
});

test('fails when the route no longer imports PDF.js natively (e.g. it was bundled instead)', () => {
  const result = checkPdfjsServerOutput(goodOutput({ routeSource: 'a=>{a.exports=__webpack_require__(42)}' }));
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0], /no native import of pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs/);
  assert.match(result.problems[1], /no native import of pdfjs-dist\/legacy\/build\/pdf\.mjs/);
});

test('fails when any server output file contains bundled PDF.js runtime code', () => {
  for (const marker of BUNDLED_RUNTIME_MARKERS) {
    const result = checkPdfjsServerOutput(
      goodOutput({ serverSources: [{ file: 'server/chunks/9.js', source: `throw new Error('${marker}')` }] })
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ['bundled PDF.js runtime code found in server/chunks/9.js']);
  }
});

test('accepts Windows-style separators in the trace and single-quoted native imports', () => {
  const result = checkPdfjsServerOutput(
    goodOutput({
      routeSource: "import('pdfjs-dist/legacy/build/pdf.worker.mjs');import('pdfjs-dist/legacy/build/pdf.mjs')",
      traceFiles: GOOD_TRACE.map((file) => file.replace(/\//g, '\\')),
    })
  );
  assert.deepEqual(result, { ok: true, problems: [] });
});

test('markers are real: each sits in exactly one pinned PDF.js file and nowhere in this project\'s own PDF code', () => {
  const buildDir = path.join(REPO_ROOT, 'node_modules/pdfjs-dist/legacy/build');
  const library = fs.readFileSync(path.join(buildDir, 'pdf.mjs'), 'utf8');
  const worker = fs.readFileSync(path.join(buildDir, 'pdf.worker.mjs'), 'utf8');
  const [libraryMarker, workerMarker] = BUNDLED_RUNTIME_MARKERS;
  assert.ok(library.includes(libraryMarker) && !worker.includes(libraryMarker));
  assert.ok(worker.includes(workerMarker) && !library.includes(workerMarker));

  for (const ownFile of ['src/lib/pdfTextExtraction.js', 'next.config.js']) {
    const source = fs.readFileSync(path.join(REPO_ROOT, ownFile), 'utf8');
    for (const marker of BUNDLED_RUNTIME_MARKERS) {
      assert.ok(!source.includes(marker), `${ownFile} must not contain the marker "${marker}"`);
    }
  }
});

test('readNextOutput reads the route, its file trace, and every server script from a build directory', () => {
  const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-pdfjs-'));
  try {
    const routePath = path.join(nextDir, ROUTE_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(routePath), { recursive: true });
    fs.writeFileSync(routePath, GOOD_ROUTE_SOURCE);
    fs.writeFileSync(`${routePath}.nft.json`, JSON.stringify({ version: 1, files: GOOD_TRACE }));
    fs.mkdirSync(path.join(nextDir, 'server/chunks'), { recursive: true });
    fs.writeFileSync(path.join(nextDir, 'server/chunks/1.js'), 'module.exports={}');

    const output = readNextOutput(nextDir);
    assert.equal(output.routeSource, GOOD_ROUTE_SOURCE);
    assert.deepEqual(output.traceFiles, GOOD_TRACE);
    assert.deepEqual(output.serverSources.map((s) => s.file).sort(), [
      'server/app/api/internal/v1/restaurant-analysis-jobs/route.js',
      'server/chunks/1.js',
    ]);
    assert.deepEqual(checkPdfjsServerOutput(output), { ok: true, problems: [] });
  } finally {
    fs.rmSync(nextDir, { recursive: true, force: true });
  }
});

test('CLI exits non-zero, without throwing, when there is no build output to check', () => {
  const missingDir = path.join(os.tmpdir(), 'verify-pdfjs-does-not-exist');
  let exitCode = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'verify-pdfjs-server-trace.js'), `--next-dir=${missingDir}`], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    exitCode = err.status;
    stderr = err.stderr;
  }
  assert.equal(exitCode, 1);
  assert.match(stderr, /cannot read the build output/);
});
