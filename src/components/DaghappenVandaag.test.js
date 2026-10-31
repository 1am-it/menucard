'use strict';

// BE-55 stap B, deel 4 (#135) — "Daghappen vandaag" op de home.
//
// Conventie van deze repo: fs.readFileSync + regex (er is geen rendered-DOM
// testharnas). Wat hier bewezen wordt is de opdracht zelf: maximaal drie, een
// willekeurige volgorde van de server, een link "Alle" naar het filter
// "Vandaag", geen sectie zonder aanbod, en geen volledige lijst naar de
// browser.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const component = fs.readFileSync(path.join(REPO_ROOT, 'src/components/DaghappenVandaag.js'), 'utf8');
const home = fs.readFileSync(path.join(REPO_ROOT, 'app/HomeView.js'), 'utf8');
const route = fs.readFileSync(path.join(REPO_ROOT, 'app/api/v1/daghap/vandaag/route.js'), 'utf8');
const css = fs.readFileSync(path.join(REPO_ROOT, 'src/components/daghappen-vandaag.css'), 'utf8');

test('BE-55 home: de sectie staat op de home en haalt zelf hooguit drie op', () => {
  assert.match(home, /<DaghappenVandaag\s*\/>/, 'de home rendert de sectie');
  assert.match(home, /import DaghappenVandaag from '@\/src\/components\/DaghappenVandaag'/);
  assert.match(component, /slice\(0,\s*3\)/, 'hooguit drie');
  assert.match(component, /\/api\/v1\/daghap\/vandaag/, 'eigen kleine lijst-endpoint');
  assert.match(component, /if \(aanbod\.length === 0\) return null/, 'geen aanbod: geen sectie');
  assert.doesNotMatch(component, /menus\.json|restaurants\.json/, 'geen volledige lijst naar de browser');
});

test('BE-55 home: "Alle" gaat naar het filter Vandaag', () => {
  assert.match(component, /const ALLE_HREF = '\/search\?vandaag=1'/);
  assert.match(component, /href=\{ALLE_HREF\}[\s\S]{0,40}Alle/);
  assert.match(component, /aria-labelledby="daghappen-vandaag-titel"/, 'de sectie is gelabeld door zijn kop');
});

test('BE-55 home: de route geeft alleen de weergavevelden en niets cachebaars', () => {
  assert.match(route, /daghapHandlers\.publiekVandaag/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.doesNotMatch(route, /getSupabaseAdmin|service_role/, 'de sleutel blijft op de server');
});

test('BE-55 home: de opmaak staat in het eigen stylesheet met tokens', () => {
  // Commentaar telt niet mee: daar staat het issuenummer (#135) in.
  const regels = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(component, /import '\.\/daghappen-vandaag\.css'/);
  assert.match(css, /\.daghappen-vandaag-titel/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.doesNotMatch(regels, /#[0-9a-fA-F]{3,6}\b/, 'geen hexkleur');
  assert.doesNotMatch(regels, /rgb\(|hsl\(/, 'geen rgb() of hsl()');
});
