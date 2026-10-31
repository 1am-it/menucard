'use strict';

// BE-59 (#146, punt 5) — de volledigheid van de interne navigatie.
//
// Elke pagina onder app/internal moet bereikbaar zijn. Dat mag op drie
// manieren, en alle drie zijn ze hier expliciet:
//   1. de pagina is zelf een item in INTERNAL_MODULES (of de ene
//      toevoegpagina ADD_ENTRY_HREF);
//   2. de pagina is een subpagina van zo'n item (bijvoorbeeld
//      /internal/bronnen/batch onder /internal/bronnen);
//   3. er staat een echte link naar de pagina in de interne code.
// Uitzonderingen staan in INTERNAL_PAGE_EXCEPTIONS: de inlog- en
// activatiepagina's, /internal zelf en detailpagina's met een [id].
//
// Een nieuwe pagina zonder een van deze plekken laat deze test falen — precies
// wat het contract vraagt.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ADD_ENTRY_HREF, INTERNAL_MODULES, INTERNAL_PAGE_EXCEPTIONS } = require('./internalNav');

const ROOT = path.join(__dirname, '..', '..');
const INTERNAL_DIR = path.join(ROOT, 'app', 'internal');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

/** Elke `page.js` onder app/internal als routepad, bijvoorbeeld
 * `/internal/bronnen/batch`. */
function internalPageRoutes() {
  return walk(INTERNAL_DIR)
    .filter((file) => path.basename(file) === 'page.js')
    .map((file) => {
      const relative = path.relative(INTERNAL_DIR, path.dirname(file)).replace(/\\/g, '/');
      return relative === '' ? '/internal' : `/internal/${relative}`;
    })
    .sort();
}

/** De bron van de interne code: waar een link naar een pagina in kan staan. */
function internalSource() {
  const files = walk(INTERNAL_DIR).filter((file) => file.endsWith('.js'));
  files.push(path.join(ROOT, 'src', 'components', 'InternalNav.js'));
  return files.map((file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).join('\n');
}

const NAV_HREFS = [...INTERNAL_MODULES.map((module) => module.href), ADD_ENTRY_HREF];

function isDetailRoute(route) {
  return route.includes('[');
}

function coverageOf(route, source) {
  if (INTERNAL_PAGE_EXCEPTIONS.includes(route)) return 'uitzondering';
  if (isDetailRoute(route)) return 'detailpagina';
  if (NAV_HREFS.includes(route)) return 'balk-item';
  if (NAV_HREFS.some((href) => route.startsWith(`${href}/`))) return 'subpagina van een balk-item';
  if (source.includes(route)) return 'gelinkt vanuit de interne code';
  return null;
}

test('elke pagina onder app/internal is bereikbaar vanuit de interne navigatie', () => {
  const source = internalSource();
  const missing = internalPageRoutes().filter((route) => coverageOf(route, source) === null);
  assert.deepEqual(missing, [], `zonder plek in de balk of link: ${missing.join(', ')}`);
});

test('de uitzonderingen zijn echte pagina\'s, geen verouderde namen', () => {
  const routes = internalPageRoutes();
  for (const exception of INTERNAL_PAGE_EXCEPTIONS) {
    assert.ok(routes.includes(exception), `${exception} bestaat nog als pagina`);
  }
});

test('de indeling van de balk: werkvoorraad, overzichten en toevoegen', () => {
  const nav = fs.readFileSync(path.join(ROOT, 'src/components/InternalNav.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(nav, /internal-nav-workqueue-title-full">Werkvoorraad</);
  assert.match(nav, /<p className="internal-nav-workqueue-heading" id="internal-nav-overviews">\s*Overzichten\s*<\/p>/);
  assert.match(nav, /href="\/internal\/toevoegen"/);
  assert.equal(ADD_ENTRY_HREF, '/internal/toevoegen');
});

test('geen pagina zonder balk-item is een uitzondering die eigenlijk een bestemming is', () => {
  for (const module of INTERNAL_MODULES) {
    assert.ok(!INTERNAL_PAGE_EXCEPTIONS.includes(module.href), `${module.href} is een balk-item`);
  }
});
