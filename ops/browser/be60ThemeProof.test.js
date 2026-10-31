'use strict';

// BE-60 (#150) — de bedrading van het themabewijs in de browsercheck.
//
// De review keurde be60-zoeken-390-light.png af: de pagina stond donker, omdat
// de check het thema met een losse schrijfactie in localStorage zette en de
// opname daarna niet controleerde. Deze test bewaakt dat de check het thema via
// de themaknop van de app zet, vóór elke opname het bewijs vastlegt en dat
// bewijs ook in het bewijsbestand bewaart. Zelfde conventie als
// be42BrowserCheck.test.js en scenarioFilterWiring.test.js: bestand lezen en
// matchen, geen browser en geen netwerk.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const CHECK = 'ops/browser/run-be60-browser-check.js';
const HELPER = 'ops/browser/lib/theme-proof.js';

test('BE-60: de check is via npm bereikbaar op de eigen poort', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:browser:be60'], `node ${CHECK}`);
  assert.match(read(CHECK), /process\.env\.BE60_PORT \|\| 3186/);
});

test('BE-60: het thema gaat via de themaknop van de app, niet via de opslag', () => {
  const source = read(CHECK);
  assert.match(source, /require\('\.\/lib\/theme-proof'\)/, 'de check mist de helper');
  assert.match(source, /clickThemeScript\(label\)/, 'de klik op de themaknop ontbreekt');
  assert.doesNotMatch(source, /localStorage\.setItem\('bredaeats_theme'/, 'het thema mag niet los in de opslag gezet worden');
  assert.doesNotMatch(source, /kiesThema/, 'de oude opslagroute is weg');
});

test('BE-60: vóór elke opname staan de drie metingen vast', () => {
  const source = read(CHECK);
  const bewijs = source.indexOf('const proof = await applyTheme(cdp, theme);');
  const meting = source.indexOf('const staat = await evalJs(cdp, ZOEK_STAAT);');
  const opname = source.indexOf('await shot(cdp, `be60-zoeken-${width}-${theme}.png`');
  assert.ok(bewijs > 0 && meting > bewijs, 'het themabewijs valt vóór de meting');
  assert.ok(opname > meting, 'de opname volgt na meting en bewijs');
  assert.match(source, /themeOk\(proof, theme\)/, 'het bewijs wordt gekeurd');
  assert.match(source, /themeProof: proof/, 'het bewijs gaat mee in de opname');
});

test('BE-60: elke opname in het bewijs draagt zijn eigen themeProof', () => {
  const source = read(CHECK);
  assert.match(source, /themeProof: meta\.themeProof \|\| null/, 'de opnamelijst bewaart het bewijs');
  assert.match(source, /elke opname heeft een kloppend themabewijs/);
  assert.match(source, /for \(const theme of \['light', 'dark'\]\)/);
  assert.match(source, /\[1280, 390, 320\]/, 'drie breedtes per thema');
});

test('BE-60: de helper leest data-theme, de actieve knop en --bg met de grenzen van de review', () => {
  const helper = read(HELPER);
  assert.match(helper, /getAttribute\('data-theme'\)/);
  assert.match(helper, /getPropertyValue\('--bg'\)/);
  assert.match(helper, /theme-btn/);
  assert.match(helper, /light: \{ above: 200 \}/);
  assert.match(helper, /dark: \{ below: 80 \}/);
  assert.doesNotMatch(helper, /localStorage/, 'de helper zet zelf geen thema');
});
