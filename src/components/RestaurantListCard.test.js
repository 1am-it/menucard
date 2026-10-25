'use strict';

// BE-28b (#68) — bronregressies voor de kaart van /alle-restaurants.
// Zelfde conventie als RestaurantBrowseCard.test.js: fs.readFileSync +
// regex, omdat dit project geen gerenderde DOM-harness heeft. De functionele
// kaartregels staan in src/lib/restaurantBrowse.test.js.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMPONENT_PATH = path.join(REPO_ROOT, 'src/components/RestaurantListCard.js');
const GLOBALS_CSS_PATH = path.join(REPO_ROOT, 'app/globals.css');

const read = (file) => fs.readFileSync(file, 'utf8');

test('de hele kaart is precies één link; er zijn geen geneste links of knoppen', () => {
  const source = read(COMPONENT_PATH);
  assert.equal((source.match(/<Link\b/g) || []).length, 2, 'one <Link> per variant (menu / no menu)');
  assert.doesNotMatch(source, /<button\b/, 'the card must not contain a button');
  assert.doesNotMatch(source, /<a\b/, 'no raw anchor next to the single card link');
  const linkBlocks = source.split('<Link').slice(1);
  for (const block of linkBlocks) {
    assert.equal((block.match(/<\/Link>/g) || []).length, 1, 'a card link must close exactly once');
    assert.doesNotMatch(block.slice(0, block.indexOf('</Link>')), /<Link\b/, 'no nested Link inside the card');
  }
});

test('met menukaart: de CTA is een span met emoji en het echte aantal, geen tweede link', () => {
  const source = read(COMPONENT_PATH);
  assert.match(source, /<span className="ar-cta">\s*<Emoji glyph="📋" \/> \{card\.ctaLabel\}\s*<\/span>/);
  assert.match(source, /card\.menuLabels\.map\(\(label\) =>/);
});

test('zonder menukaart: geen grote knop, wel "Nog geen menukaart" en "Bekijk restaurant →"', () => {
  const source = read(COMPONENT_PATH);
  assert.match(source, /card\.noMenuLabel/);
  assert.match(source, /card\.restaurantLabel/);
  assert.match(source, /className="ar-arrow" aria-hidden="true">→</);
  assert.doesNotMatch(source, /ar-cta[^]*?card\.restaurantLabel/, 'the no-menu branch must not render the big CTA');
});

test('de kaart gebruikt de decoratieve Emoji-component voor tegel, adres en CTA', () => {
  const source = read(COMPONENT_PATH);
  assert.match(source, /import Emoji from '@\/src\/components\/Emoji'/);
  assert.match(source, /<Emoji glyph=\{card\.emoji\} className="ar-tile" \/>/);
  assert.match(source, /<Emoji glyph="📍" \/>/);
});

test('globals.css: de kaarten zijn even hoog, rond en gebruiken alleen BE-28-tokens', () => {
  const css = read(GLOBALS_CSS_PATH);
  const rule = css.match(/\.ar-card \{([^}]*)\}/);
  assert.ok(rule, 'expected an .ar-card rule');
  assert.match(rule[1], /border-radius:\s*var\(--radius-card\)/);
  assert.match(rule[1], /background:\s*var\(--card-surface\)/);
  assert.match(rule[1], /border:\s*1px solid var\(--card-border-color\)/);
  assert.match(css, /\.ar-grid \{[^}]*align-items:\s*stretch/);
  assert.match(css, /\.ar-card \{[^}]*height:\s*100%/);
  assert.match(css, /\.ar-cta \{[^}]*margin-top:\s*auto/);
});

test('globals.css: op de telefoon is de kaart zonder menukaart één compacte regel met pijl', () => {
  const css = read(GLOBALS_CSS_PATH);
  assert.match(css, /@media \(max-width: 720px\) \{[^]*?\.ar-nomenu-label \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 720px\) \{[^]*?\.ar-nomenu-inline \{ display: inline; \}/);
  assert.match(css, /@media \(max-width: 720px\) \{[^]*?\.ar-restaurant-link \{ display: none; \}/);
});
