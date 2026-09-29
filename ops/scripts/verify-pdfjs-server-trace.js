'use strict';

/**
 * Read-only, post-build check that the BE-20 restaurant-analysis route
 * ships PDF.js the way src/lib/pdfTextExtraction.js needs it at runtime:
 *
 *   1. route.js loads pdfjs-dist natively (external, via next.config.js's
 *      `serverExternalPackages`) — both the worker module and the library.
 *   2. The route's own `.nft.json` file trace — the list of files a
 *      serverless deployment packages for this function — includes both
 *      pdf.mjs and pdf.worker.mjs. A missing worker file is exactly the
 *      failure mode that local unit tests cannot see: with the full
 *      `node_modules` present every PDF parses, while a function shipped
 *      without the worker fails every PDF with "fake worker" errors.
 *   3. No server output file contains PDF.js's own runtime code, i.e.
 *      pdfjs-dist was not bundled back into a server chunk.
 *
 * Never builds, fetches, or writes anything: it only reads the `.next`
 * output of a build the caller already ran.
 *
 * Usage: node ops/scripts/verify-pdfjs-server-trace.js [--next-dir=<path>]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROUTE_RELATIVE_PATH = 'server/app/api/internal/v1/restaurant-analysis-jobs/route.js';

const REQUIRED_NATIVE_IMPORTS = [
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  'pdfjs-dist/legacy/build/pdf.mjs',
];

const REQUIRED_TRACED_FILES = [
  'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
];

// String literals that survive minification, each present in exactly one
// pinned PDF.js file (pdf.mjs, pdf.worker.mjs) and nowhere in this
// project's own source — so finding one in server output means PDF.js's
// own code was bundled there. Guarded by this script's own tests.
const BUNDLED_RUNTIME_MARKERS = [
  'No "GlobalWorkerOptions.workerSrc" specified.',
  'The API version ',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasNativeImport(source, specifier) {
  return new RegExp(`import\\(\\s*["']${escapeRegExp(specifier)}["']\\s*\\)`).test(source);
}

/**
 * Pure check over already-read build output. `serverSources` is a list of
 * `{ file, source }` for every server output script. Returns
 * `{ ok, problems }` — `problems` is a list of plain-language findings.
 */
function checkPdfjsServerOutput({ routeSource, traceFiles, serverSources }) {
  const problems = [];

  for (const specifier of REQUIRED_NATIVE_IMPORTS) {
    if (!hasNativeImport(routeSource, specifier)) {
      problems.push(`route output has no native import of ${specifier}`);
    }
  }

  const normalizedTrace = traceFiles.map((file) => file.replace(/\\/g, '/'));
  for (const required of REQUIRED_TRACED_FILES) {
    if (!normalizedTrace.some((file) => file.endsWith(required))) {
      problems.push(`route file trace does not include ${required}`);
    }
  }

  for (const { file, source } of serverSources) {
    if (BUNDLED_RUNTIME_MARKERS.some((marker) => source.includes(marker))) {
      problems.push(`bundled PDF.js runtime code found in ${file}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

function listServerScripts(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listServerScripts(full));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      found.push(full);
    }
  }
  return found;
}

function readNextOutput(nextDir) {
  const routePath = path.join(nextDir, ROUTE_RELATIVE_PATH);
  const routeSource = fs.readFileSync(routePath, 'utf8');
  const traceFiles = JSON.parse(fs.readFileSync(`${routePath}.nft.json`, 'utf8')).files;
  const serverDir = path.join(nextDir, 'server');
  const serverSources = listServerScripts(serverDir).map((file) => ({
    file: path.relative(nextDir, file).replace(/\\/g, '/'),
    source: fs.readFileSync(file, 'utf8'),
  }));
  return { routeSource, traceFiles, serverSources };
}

function main(argv) {
  const dirArg = argv.find((arg) => arg.startsWith('--next-dir='));
  const nextDir = path.resolve(dirArg ? dirArg.slice('--next-dir='.length) : '.next');

  let output;
  try {
    output = readNextOutput(nextDir);
  } catch (err) {
    console.error(`FAIL — cannot read the build output in ${nextDir}; run \`npm run build\` first (${err.code || err.message}).`);
    process.exitCode = 1;
    return;
  }

  const result = checkPdfjsServerOutput(output);
  if (result.ok) {
    console.log(`OK — native PDF.js imports present, pdf.mjs and pdf.worker.mjs traced, no bundled PDF.js runtime (${output.serverSources.length} server scripts checked).`);
    return;
  }
  for (const problem of result.problems) console.error(`FAIL — ${problem}`);
  process.exitCode = 1;
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  ROUTE_RELATIVE_PATH,
  REQUIRED_NATIVE_IMPORTS,
  REQUIRED_TRACED_FILES,
  BUNDLED_RUNTIME_MARKERS,
  checkPdfjsServerOutput,
  readNextOutput,
};
