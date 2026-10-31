'use strict';

// BE-52 (issue 128) — bewaker voor paginagebonden CSS.
//
// Waarom deze test bestaat: elk ticket zette zijn opmaak onderaan
// app/globals.css, dat daardoor 6591 regels telde. Parallelle PR's botsten bij
// elke merge (BE-46, BE-47, BE-50, BE-51 op 30 okt) en bij één samenvoeging ging
// zelfs een sluitaccolade verloren. Deze test legt twee dingen vast:
//
//   1. globals.css groeit niet meer dan 40 regels boven het aantal van deze
//      verhuizing. Het aantal verhoog je alleen bewust, met een reden in de
//      commit — niet stilzwijgend met een nieuw blok onderaan.
//   2. Een verplaatst klasseblok staat alleen nog in zijn eigen bestand, en dat
//      bestand wordt ook echt geïmporteerd door de code die het gebruikt.
//
// Bronregressie (fs + regex), dezelfde conventie als public-pages-style.test.js.
// Het echte beeld blijft bewezen door de browserchecks.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

// Vastgezet na de verhuizing van BE-52 (30 okt): 5806 regels. De 40 regels
// ruimte zijn voor een kleine, echt gedeelde aanvulling; nieuwe opmaak voor één
// pagina hoort naast de pagina.
const GLOBALS_LINES = 5806;
const BUDGET = 40;

// Wat er verhuisd is, met het bestand waar het nu staat en de code die het
// importeert. Eén regel per bestand; de klassen zelf zijn niet hernoemd.
const MOVED = [
  {
    prefix: 'kies-',
    file: 'app/kies/kies.css',
    importers: ['app/kies/[code]/KiesView.js'],
  },
  {
    prefix: 'kies-',
    file: 'src/components/kies-start.css',
    importers: ['src/components/KiesStartButton.js'],
  },
  {
    prefix: 'tellers-',
    file: 'app/internal/tellers/tellers.css',
    importers: ['app/internal/tellers/page.js'],
  },
  {
    prefix: 'owner-',
    file: 'app/mijn-restaurant/mijn-restaurant.css',
    importers: ['app/mijn-restaurant/OwnerDashboard.js', 'app/mijn-restaurant/OwnerAccountDeletion.js'],
  },
];

/** Alle CSS-bestanden onder app/ en src/ (de enige plekken met eigen opmaak). */
function cssFiles(roots = ['app', 'src'], found = []) {
  for (const root of roots) {
    const base = path.join(ROOT, root);
    if (!fs.existsSync(base)) continue;
    walk(base, found);
  }
  return found;
}

function walk(dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.name.endsWith('.css')) found.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return found;
}

/** De klassenamen die een CSS-bestand zelf definieert (selectors, geen var()). */
function classNames(css, prefix) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const matches = withoutComments.match(new RegExp(`\\.${prefix}[a-zA-Z0-9_-]*`, 'g')) || [];
  return [...new Set(matches.map((match) => match.slice(1)))];
}

test('globals.css groeit niet meer dan 40 regels boven het vastgezette aantal', () => {
  const lines = read('app/globals.css').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  assert.ok(
    lines.length <= GLOBALS_LINES + BUDGET,
    `app/globals.css heeft ${lines.length} regels; het budget is ${GLOBALS_LINES} + ${BUDGET}. ` +
      'Nieuwe opmaak voor één pagina hoort in een CSS-bestand naast die pagina; ' +
      'verhoog het aantal alleen bewust, met een reden in de commit.',
  );
});

test('globals.css blijft de enige globale import in de root-layout', () => {
  const layout = read('app/layout.js');
  assert.match(layout, /^import '\.\/globals\.css'$/m);
  assert.equal((layout.match(/\.css'/g) || []).length, 1, 'de layout importeert alleen globals.css');
});

test('de verplaatste klassen staan niet meer in globals.css', () => {
  const globals = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const { prefix, file } of MOVED) {
    assert.doesNotMatch(
      globals,
      new RegExp(`\\.${prefix}`),
      `globals.css mag geen .${prefix}*-regels meer hebben; die staan in ${file}`,
    );
  }
});

test('een verplaatst klasseblok staat alleen in zijn eigen bestand', () => {
  const all = cssFiles().filter((file) => file.endsWith('.css'));
  for (const file of all) assert.ok(fs.existsSync(path.join(ROOT, file)));

  for (const { prefix, file } of MOVED) {
    const own = classNames(read(file), prefix);
    assert.ok(own.length > 0, `${file} definieert ten minste één .${prefix}*-klasse`);
    for (const other of all) {
      if (other === file) continue;
      const css = read(other).replace(/\/\*[\s\S]*?\*\//g, '');
      const leaked = own.filter((name) => css.includes(`.${name}`));
      assert.deepEqual(
        leaked,
        [],
        `${other} mag geen ${leaked.join(', ')} bevatten; dat blok hoort bij ${file}`,
      );
    }
  }
});

test('elk verplaatst CSS-bestand wordt geïmporteerd door de code die het gebruikt', () => {
  for (const { file, importers } of MOVED) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} bestaat`);
    const relative = `./${path.basename(file)}`;
    for (const importer of importers) {
      const source = read(importer);
      const needs = path.posix.relative(path.posix.dirname(importer), file);
      assert.ok(
        source.includes(`import '${needs}'`) || source.includes(`import '${relative}'`),
        `${importer} importeert ${file}`,
      );
    }
  }
});

test('geen CSS-modules: elk stylesheet is een gewoon .css-bestand naast zijn code', () => {
  const stylesheets = cssFiles().sort();
  assert.deepEqual(stylesheets, [
    'app/globals.css',
    // BE-65: de twee kolommen van de hero en de knoppen bij elk gerecht.
    'app/home.css',
    // BE-59 deel 2: de ene ingang /inloggen.
    'app/inloggen/inloggen.css',
    // BE-55 deel 4: de interne werkvoorraad, naast zijn pagina.
    'app/internal/aanbod/aanbod-beheer.css',
    'app/internal/menu-concepts/menu-concepts.css',
    'app/internal/menukaart-wijzigingen/wijzigingen.css',
    'app/internal/tellers/tellers.css',
    'app/kies/kies.css',
    // BE-55: aanbodformulier en het blok "Vandaag", beide naast hun code.
    'app/mijn-restaurant/aanbod/aanbod.css',
    'app/mijn-restaurant/claimen/claimen.css',
    'app/mijn-restaurant/menukaart/menukaart.css',
    'app/mijn-restaurant/mijn-restaurant-cijfers.css',
    'app/mijn-restaurant/mijn-restaurant.css',
    // BE-55 deel 5: het label en het filter "Vandaag" in de zoekresultaten.
    'app/search/search.css',
    // BE-59: het accountmenu.
    'src/components/account-menu.css',
    'src/components/daghap-vandaag.css',
    // BE-55 deel 4: "Daghappen vandaag" op de home.
    'src/components/daghappen-vandaag.css',
    // BE-65: de deelknop met het woord "Delen" (home en /search).
    'src/components/dish-share-button.css',
    'src/components/kies-start.css',
    'src/components/menu-body.css',
    // BE-59 deel 2: de footerlink op de publieke pagina's.
    'src/components/public-footer.css',
    // BE-65: de balk na het bewaren (laadt pas als er iets bewaard is).
    'src/components/saved-dishes-bar.css',
    // BE-65: het venster Stuur je lijstje (laadt pas bij het openen).
    'src/components/saved-list-send.css',
    // BE-65: de deelkaart in de hero.
    'src/components/share-hero-card.css',
  ]);
  assert.deepEqual(stylesheets.filter((file) => file.endsWith('.module.css')), [], 'geen CSS-modules');
});
