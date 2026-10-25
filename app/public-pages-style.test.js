'use strict';

// BE-28b (#68) — de overige publieke pagina's volgen dezelfde frisse stijl.
// Bronregressies (fs + regex, de bestaande conventie) voor de koppeling tussen
// de pagina's en de BE-28-tokens; het echte beeld wordt bewezen door de
// browsercheck met screenshots (ops/browser/run-public-style-browser-check.js).

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('/restaurants: dezelfde emoji, menukaart-leidend en reserveren secundair', () => {
  const source = read('app/restaurants/page.js');
  assert.match(source, /import \{ cuisineEmoji \} from '@\/src\/lib\/cuisineStyle'/);
  assert.match(source, /<div className="rc-name"><Emoji glyph=\{cuisineEmoji\(restaurant\.cuisine\)\} \/> \{restaurant\.name\}<\/div>/);
  assert.match(source, /<Emoji glyph="📋" \/> Bekijk menu →/);
  assert.match(source, /hasMenu \? 'rc-reserve-btn--secondary' : ''/, 'the reservation action stays secondary when a menu exists');
});

test('restaurantpagina: "Bekijk menukaart" blijft leidend met emoji, reserveren blijft secundair', () => {
  const source = read('app/restaurant/[id]/RestaurantDetailView.js');
  assert.match(source, /<Link href=\{`\/menu\/\$\{menuLinks\[0\]\.id\}`\} className="dip-btn-primary">\s*<Emoji glyph="📋" \/> Bekijk menukaart/);
  assert.match(source, /className="dip-btn-secondary dip-btn-reserve"/);
});

test('claimpagina: gedeelde header, kaart, primaire knop-tokens en de telefoonmenubalk', () => {
  const source = read('app/claim/[restaurantId]/ClaimView.js');
  assert.match(source, /import MobileTabBar from '@\/src\/components\/MobileTabBar'/);
  assert.match(source, /<Wordmark \/>/);
  assert.match(source, /className="claim-card"/);
  assert.match(source, /className="claim-submit"/);
  assert.match(source, /<MobileTabBar \/>/);
  assert.doesNotMatch(source, /style=\{box\}|style=\{inputStyle\}|style=\{buttonStyle\}/, 'the old inline box/input/button styles must be gone');
});

test('NVWA-pagina: ronde chips met aria-pressed, dezelfde header en de telefoonmenubalk', () => {
  const source = read('app/nvwa/[id]/NvwaView.js');
  assert.match(source, /className=\{`filter-chip \$\{!filterMeal \? 'active' : ''\}`\}/);
  assert.match(source, /aria-pressed=\{filterAllergen === a\.id\}/);
  assert.match(source, /import MobileTabBar from '@\/src\/components\/MobileTabBar'/);
  assert.match(source, /<MobileTabBar \/>/);
});

test('globals.css: BE-28b gebruikt alleen tokens voor kaarten, chips en claim/nvwa', () => {
  const css = read('app/globals.css');
  const block = css.slice(css.indexOf('/* ── BE-28b (#68): Alle restaurants'), css.indexOf('/* ── Telefoon: zwevende menubalk'));
  assert.ok(block.length > 1000, 'expected the BE-28b style block');
  assert.match(block, /\.ar-card \{[^}]*background: var\(--card-surface\)/);
  assert.match(block, /\.ar-cta \{[^}]*background: var\(--button-primary-bg\)/);
  assert.match(block, /\.filter-chip \{[^}]*background: var\(--chip-bg\)/);
  assert.match(block, /\.claim-submit \{[^}]*background: var\(--button-primary-bg\)/);
  assert.match(block, /\.nvwa-export-btn \{[^}]*background: var\(--button-primary-bg\)/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b/, 'no hard-coded colour in the BE-28b block');
});
