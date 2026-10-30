'use strict';

// BE-51 (#121) — bronregressies voor de toegankelijkheid van de publieke
// pagina's: dezelfde conventie als app/public-pages-style.test.js (fs + regex).
//
// Wat hier wordt vastgelegd, is precies wat de browsercheck
// (ops/browser/run-a11y-public-check.js) in de browser meet: namen en labels,
// landmarks, en de reflow- en bewegingsregels. Een wijziging die een van deze
// regels stilzwijgend terugdraait, valt hier om — zonder browser en zonder
// netwerk.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Het BE-51-blok onderaan globals.css, zodat een regel elders niet telt. */
const be51Block = () => {
  const css = read('app/globals.css');
  const start = css.indexOf('BE-51 (issue 121) — toegankelijkheid van de publieke pagina');
  assert.ok(start > 0, 'verwacht het BE-51-blok in app/globals.css');
  return css.slice(start);
};

test('globals.css respecteert prefers-reduced-motion', () => {
  const block = be51Block();
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{/);
  assert.match(block, /html \{ scroll-behavior: auto; \}/);
  assert.match(block, /animation-duration: 0\.01ms !important/);
  assert.match(block, /transition-duration: 0\.01ms !important/);
});

test('de BE-51-laag gebruikt alleen tokens en geen eigen kleuren', () => {
  const block = be51Block();
  assert.doesNotMatch(block, /:\s*#[0-9a-fA-F]{3,8}\b/, 'geen hardgecodeerde kleur in de BE-51-laag');
  assert.doesNotMatch(block, /:\s*rgba?\(/, 'geen hardgecodeerde kleur in de BE-51-laag');
});

test('de reflow-regels van BE-51 staan er: rasterkolommen, wrapping en tikdoelen', () => {
  const block = be51Block();
  assert.match(block, /\.tonight-list \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(block, /minmax\(min\(280px, 100%\), 1fr\)/);
  assert.match(block, /\.mobile-tabbar \{ max-width: calc\(100% - 24px\); flex-wrap: wrap; \}/);
  assert.match(block, /\.hero-inner, \.detail-hero-inner \{ grid-template-columns: minmax\(0, 1fr\); gap: 24px; \}/);
  // Het prijsvlak mocht niet krimpen en stond op één regel; dat duwde de kaart
  // bij 200% tekst breder dan het scherm.
  assert.match(block, /\.td-price \{ white-space: normal; flex-shrink: 1; min-width: 0; overflow-wrap: anywhere; \}/);
  assert.match(block, /\.card-top > \.td-name \{ flex: 1 1 auto; min-width: min\(100%, 12ch\); \}/);
  assert.match(block, /\.status-badge \{ white-space: normal; flex-wrap: wrap; min-width: 0; \}/);
});

test('de restaurantpagina houdt zijn kopknoppen in een klasse die mag wrappen', () => {
  const source = read('app/restaurant/[id]/RestaurantDetailView.js');
  assert.match(source, /<div className="header-actions">/);
  assert.doesNotMatch(source, /style=\{\{ display: 'flex', gap: 8, alignItems: 'center' \}\}/);
  assert.match(be51Block(), /\.header-actions \{[^}]*flex-wrap: wrap/);
});

test('de twee kleine tekstlinks hebben een echt tikdoel', () => {
  const block = be51Block();
  // De naam in een zoekresultaat: een vol tikvlak van 44 px.
  assert.match(
    block,
    /\.dish-result-card-row \.dish-group-example-link \{\s*display: inline-flex;\s*align-items: center;\s*min-height: 44px;/
  );
  // De restaurantnaam op "Alle restaurants": 24 px met vrije ruimte eromheen.
  assert.match(block, /\.ar-name-link \{\s*display: inline-flex;\s*align-items: center;\s*min-height: 24px;/);
});

test('de taal van het document staat vast op Nederlands', () => {
  assert.match(read('app/layout.js'), /<html lang="nl"/);
});

test('het zoekveld op /search heeft een toegankelijke naam', () => {
  const source = read('app/search/page.js');
  assert.match(source, /className="search-input flagship"[\s\S]{0,200}aria-label="Zoek een gerecht, restaurant of buurt"/);
  assert.match(source, /className="search-clear" aria-label="Zoekveld wissen"/);
});

test('de zoekvelden op de menukaart hebben een naam en de wissen-knop ook', () => {
  const source = read('app/menu/[id]/MenuView.js');
  assert.match(source, /className="mf-search"[\s\S]{0,200}aria-label="Zoek gerecht of ingrediënt"/);
  assert.match(source, /className="mf-price-slider"[\s\S]{0,80}aria-label="Maximale prijs"/);
  assert.match(source, /className="mf-clear" aria-label="Zoekveld wissen"/);
});

test('de menukaart heeft echte navigatiegebieden in plaats van losse divs', () => {
  const source = read('app/menu/[id]/MenuView.js');
  assert.match(source, /<nav className="cat-nav" aria-label="Gerechten op deze kaart">/);
  assert.match(source, /<nav className="meal-switch" aria-label="Menukaarten">/);
  assert.doesNotMatch(source, /<div className="cat-nav">/);
  assert.doesNotMatch(source, /<div className="meal-switch">/);
});

test('Mijn lijstje heeft een nav-landmark voor de terugweg', () => {
  const source = read('app/mijn-lijstje/MijnLijstjeView.js');
  assert.match(source, /<nav className="lijst-back" aria-label="Terug">\s*<Link href="\/" className="back-btn"( prefetch=\{false\})?>/);
  assert.match(be51Block(), /\.lijst-back \{ display: flex; \}/);
});
