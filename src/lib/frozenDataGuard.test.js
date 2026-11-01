'use strict';

// BE-76 (#189) — de bewaker (uitkomst 5).
//
// Een test die van de inhoud van de kaarten afhangt, hoort op de vaste kopie te
// draaien (src/test-fixtures/useFrozenData.js). Laadt een testbestand
// data/menus.json of data/restaurants.json rechtstreeks, dan sluipt het
// probleem terug: elke nieuwe of ververste kaart breekt die test weer.
//
// Deze test leest de testbestanden als tekst en faalt op zo'n bestand. De enige
// uitzondering is het contract op de levende data
// (src/lib/liveDataContract.test.js) — dat hoort de echte data te lezen — en
// deze bewaker zelf.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_ROOTS = ['src', 'app', 'ops'];
const SELF = path.join('src', 'lib', 'frozenDataGuard.test.js');
const ALLOWED = new Set([SELF, path.join('src', 'lib', 'liveDataContract.test.js')]);

// Elke vorm waarin een testbestand de levende kaartdata daadwerkelijk laadt.
// Een losse vermelding in een commentaar of in manifest-metadata telt niet: het
// gaat om het laden zelf.
const LIVE_DATA_PATTERNS = [
  /require\s*\([^)]*data[/\\](?:menus|restaurants)\.json/,
  /readFileSync\s*\([^)]*data[/\\](?:menus|restaurants)\.json/,
  /['"]data['"]\s*,\s*['"](?:menus|restaurants)\.json['"]/,
  /__fixtures__[/\\]dishSearch-data/,
];

const FROZEN_CALL = /useFrozenData\s*\(/;

function testFilesIn(dir) {
  const absolute = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  const found = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      found.push(...testFilesIn(relative));
    } else if (entry.name.endsWith('.test.js')) {
      found.push(relative);
    }
  }
  return found;
}

test('geen testbestand laadt de levende kaartdata zonder useFrozenData', () => {
  const offenders = [];

  for (const file of SCAN_ROOTS.flatMap(testFilesIn)) {
    if (ALLOWED.has(file)) continue;
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const mentions = LIVE_DATA_PATTERNS.some((pattern) => pattern.test(source));
    if (!mentions) continue;
    if (FROZEN_CALL.test(source)) continue;
    offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    `deze testbestanden laden data/menus.json of data/restaurants.json zonder useFrozenData: ${offenders.join(', ')}. `
      + 'Laat ze op de vaste kopie draaien (require(\'../test-fixtures/useFrozenData\').useFrozenData()) '
      + 'of gebruik de levende data alleen in src/lib/liveDataContract.test.js.'
  );
});

test('de vaste kopie is compleet: menus.json en restaurants.json staan er allebei', () => {
  for (const name of ['menus', 'restaurants']) {
    const file = path.join(REPO_ROOT, 'src', 'test-fixtures', 'frozen-data', `${name}.json`);
    assert.ok(fs.existsSync(file), `de vaste kopie mist ${name}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(Object.keys(data).length > 0, `${name}.json in de vaste kopie is leeg`);
  }
});
