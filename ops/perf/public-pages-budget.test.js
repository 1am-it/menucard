'use strict';

// BE-50 (#120, criterium 5) — de budgettest voor het eerste JS-pakket.
//
// De grens komt uit de vastgelegde meting in ops/perf/evidence/public-pages.json:
// per pagina staat daar `buildFirstLoadJs.gzipBytes`, de som van de
// gzip-grootte van precies de JS-bestanden die die route volgens
// `.next/app-build-manifest.json` als eerste laadt. Deze test rekent datzelfde
// getal opnieuw uit op de build in deze checkout en faalt boven +10%.
//
// Waarom niet in de browser? De echte overdracht staat in dezelfde meting
// (ops/perf/measure-public-pages.js); een `node --test` hoort zelf geen browser
// en geen eigen build te starten. De bouwkant is deterministisch en groeit mee
// zodra er een chunk bij komt, ook als die pas later in de browser landt.
//
// Draai eerst `next build` (het meetscript doet dat zelf); zonder
// productiebuild slaat deze test zichzelf over met een melding, zodat een verse
// checkout niet op een ontbrekende .next stukloopt.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { firstLoadJsFromBuild, hasProductionBuild } = require('./lib/first-load-js');

const ROOT = path.join(__dirname, '..', '..');
const EVIDENCE_PATH = path.join(__dirname, 'evidence', 'public-pages.json');
const TOLERANCE = 0.1;
const CONTRACT_PAGES = [
  ['home', '/'],
  ['search', '/search?q=pasta'],
  ['alle-restaurants', '/alle-restaurants'],
  ['restaurant', '/restaurant/6'],
  ['menu', '/menu/23-borrel'],
  ['mijn-lijstje', '/mijn-lijstje'],
];

const EVIDENCE = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf8'));

test('de vastgelegde meting noemt de zes pagina’s uit het contract, met hun JS-grens', () => {
  assert.equal(EVIDENCE.be, 'BE-50 (#120)');
  for (const [id, pagePath] of CONTRACT_PAGES) {
    const page = EVIDENCE.pages.find((entry) => entry.id === id);
    assert.ok(page, `${id} ontbreekt in de meting`);
    assert.equal(page.path, pagePath, `${id}: de meting hoort bij ${pagePath}`);
    assert.ok(page.totalBytes > 0, `${id}: geen overgedragen bytes vastgelegd`);
    assert.ok(page.buildFirstLoadJs && page.buildFirstLoadJs.gzipBytes > 0, `${id}: geen JS-grens vastgelegd`);
    assert.ok(page.buildFirstLoadJs.route, `${id}: geen route vastgelegd`);
  }
});

for (const [id, pagePath] of CONTRACT_PAGES) {
  const page = EVIDENCE.pages.find((entry) => entry.id === id);
  test(`eerste JS-pakket van ${pagePath} blijft binnen 10% van de vastgelegde meting`, (t) => {
    if (!hasProductionBuild(ROOT)) {
      t.skip('geen productiebuild: draai eerst next build (of ops/perf/measure-public-pages.js)');
      return;
    }
    const recorded = page.buildFirstLoadJs.gzipBytes;
    const limit = Math.ceil(recorded * (1 + TOLERANCE));
    const current = firstLoadJsFromBuild({ root: ROOT, route: page.buildFirstLoadJs.route });
    assert.deepEqual(current.missing, [], `${pagePath}: JS-bestanden uit de manifest ontbreken in .next`);
    assert.ok(
      current.gzipBytes <= limit,
      `${pagePath}: eerste JS-pakket is ${current.gzipBytes} bytes (gzip) en de grens is ${limit} ` +
        `(gemeten ${recorded} + 10%). Grootste posten: ${current.files
          .slice()
          .sort((a, b) => b.gzipBytes - a.gzipBytes)
          .slice(0, 3)
          .map((file) => `${file.file} ${file.gzipBytes}`)
          .join(', ')}`
    );
  });
}

test('de publieke kop importeert geen volledig dishList en laadt het paneel lui', () => {
  // BE-63 (#155, ronde 3): de kop en de teller in PrimaryNav mogen niet het
  // volledige src/lib/dishList.js (met de deellinks en de dieplinkopbouw) in de
  // eerste lading halen. De teller leest de kleine helper, het paneel met de
  // themakeuze en "Delen via" komt pas bij het openen.
  const withoutComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = ['src/components/PrimaryNav.js', 'src/components/PublicHeaderActions.js'];
  for (const file of files) {
    const source = withoutComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    assert.doesNotMatch(source, /from '@\/src\/lib\/dishList'/, `${file}: geen statische import van dishList`);
    assert.doesNotMatch(source, /require\(['"][^'"]*dishList['"]\)/, `${file}: geen require van dishList`);
    assert.match(source, /from '@\/src\/lib\/savedListStorage'/, `${file}: de kleine opslaghelper`);
  }
  const header = withoutComments(fs.readFileSync(path.join(ROOT, 'src/components/PublicHeaderActions.js'), 'utf8'));
  assert.match(header, /dynamic\(\(\) => import\('@\/src\/components\/PublicHeaderPanel'\), \{ ssr: false \}\)/);
  assert.doesNotMatch(header, /from '@\/src\/lib\/sharePreference'|from '@\/src\/lib\/themePreference'/);
});

test('het deelblad laadt pas na een tik en zit niet in het eerste JS-pakket', () => {
  for (const file of ['src/components/ShareSettingsButton.js', 'src/components/DishShareButton.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /import dynamic from 'next\/dynamic'/, `${file}: geen dynamische import`);
    assert.match(source, /import\('@\/src\/components\/ShareDialog'\)/, `${file}: het blad wordt niet lui geladen`);
    assert.doesNotMatch(
      source,
      /^import \{[^}]*ShareDialog[^}]*\} from '@\/src\/components\/ShareDialog'/m,
      `${file}: het blad staat weer in de statische import (en dus in het eerste JS-pakket)`
    );
  }
});

test('geen publieke pagina of clientcomponent importeert de volledige databestanden', () => {
  // Commentaar noemt de bestanden soms juist om te zeggen dat ze NIET mee
  // mogen; daarom telt alleen de echte code.
  const withoutComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const clientModules = [
    'app/HomeView.js',
    'app/search/page.js',
    'app/alle-restaurants/page.js',
    'app/menu/[id]/MenuView.js',
    'app/restaurant/[id]/RestaurantDetailView.js',
    'app/mijn-lijstje/MijnLijstjeView.js',
  ];
  for (const file of clientModules) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /'use client'/, `${file}: hoort een clientpagina te zijn`);
    assert.doesNotMatch(withoutComments(source), /data\/menus\.json|data\/restaurants\.json/, `${file}: volledige data naar de browser`);
  }
  const components = fs
    .readdirSync(path.join(ROOT, 'src', 'components'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => `src/components/${file}`);
  for (const file of components) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(withoutComments(source), /data\/menus\.json|data\/restaurants\.json/, `${file}: volledige data naar de browser`);
  }
});
