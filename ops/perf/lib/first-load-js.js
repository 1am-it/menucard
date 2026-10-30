'use strict';

// BE-50 (#120) — het eerste JS-pakket van een publieke pagina, afgeleid uit de
// productiebuild zelf.
//
// De meting (ops/perf/measure-public-pages.js) leest in de browser de echt
// overgedragen bytes. Een `node --test`-budgettest kan geen browser starten,
// dus die vergelijkt dezelfde pagina via de eigen manifesten van de build:
// `.next/app-build-manifest.json` noemt per route precies de JS-bestanden die
// die route als eerste laadt (gedeelde chunks plus de routechunk). De som van
// de gzip-grootte van die bestanden is de bouwkant van hetzelfde eerste
// JS-pakket: komt er een chunk bij, dan groeit dit getal mee.
//
// Geen dependency: `node:fs` en `node:zlib`.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MANIFEST = path.join('.next', 'app-build-manifest.json');

function gzipSize(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length;
}

/**
 * De JS-bestanden die `route` als eerste laadt, met hun bytes.
 * @param {{root:string, route:string}} options
 * @returns {{route:string, files:Array<{file:string,bytes:number,gzipBytes:number}>, rawBytes:number, gzipBytes:number, missing:string[]}}
 */
function firstLoadJsFromBuild({ root, route }) {
  const manifestPath = path.join(root, MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = (manifest.pages && manifest.pages[route]) || [];
  const found = [];
  const missing = [];
  for (const file of files) {
    const absolute = path.join(root, '.next', file);
    if (!fs.existsSync(absolute)) {
      missing.push(file);
      continue;
    }
    const buffer = fs.readFileSync(absolute);
    found.push({ file, bytes: buffer.length, gzipBytes: gzipSize(buffer) });
  }
  return {
    route,
    files: found,
    rawBytes: found.reduce((sum, entry) => sum + entry.bytes, 0),
    gzipBytes: found.reduce((sum, entry) => sum + entry.gzipBytes, 0),
    missing,
  };
}

/** Is er een productiebuild om tegen te meten? */
function hasProductionBuild(root) {
  return fs.existsSync(path.join(root, MANIFEST));
}

module.exports = { firstLoadJsFromBuild, hasProductionBuild, gzipSize, MANIFEST };
