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

test('/restaurants: uitgefaseerd met een permanente 308 naar /alle-restaurants', () => {
  const source = read('app/restaurants/page.js');
  assert.match(source, /import \{ permanentRedirect \} from 'next\/navigation'/);
  assert.match(source, /permanentRedirect\(query \? `\/alle-restaurants\?q=\$\{encodeURIComponent\(query\)\}` : '\/alle-restaurants'\)/);
  assert.doesNotMatch(source, /cuisineEmoji|restaurant-card|rc-reserve-btn/, 'the old page body is gone; shared components stay shared');
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
  // BE-48 (#112): de claim gebruikt de gedeelde authstijl (auth-submit,
  // auth-input, auth-error) in plaats van eigen claim-knoppen.
  assert.match(source, /className="auth-submit"/);
  assert.match(source, /<MobileTabBar \/>/);
  assert.doesNotMatch(source, /style=\{box\}|style=\{inputStyle\}|style=\{buttonStyle\}/, 'the old inline box/input/button styles must be gone');
});

test('NVWA-pagina: ronde chips met aria-pressed, dezelfde header en de telefoonmenubalk', () => {
  const source = read('app/nvwa/[id]/NvwaView.js');
  assert.match(source, /className=\{`filter-chip \$\{!filterMeal \? 'active' : ''\}`\}/);
  assert.match(source, /aria-pressed=\{filterAllergen === a\.id\}/);
  assert.match(source, /className="nvwa-score-value"/);
  assert.match(source, /minWidth: 64, flexShrink: 0/, 'the score value must not shrink under its own text at 320 px');
  assert.match(source, /import MobileTabBar from '@\/src\/components\/MobileTabBar'/);
  assert.match(source, /<MobileTabBar \/>/);
});

test('globals.css: BE-28b gebruikt alleen tokens voor kaarten, chips en claim/nvwa', () => {
  const css = read('app/globals.css');
  const block = css.slice(css.indexOf('/* ── BE-28b (#68): Alle restaurants'), css.indexOf('/* ── Telefoon: zwevende menubalk'));
  assert.ok(block.length > 1000, 'expected the BE-28b style block');
  assert.match(block, /\.ar-card \{[^}]*background: var\(--card-surface\)/);
  assert.match(block, /\.ar-menu-button \{[^}]*background: var\(--surface-soft\)/);
  assert.match(block, /\.filter-chip \{[^}]*background: var\(--chip-bg\)/);
  // BE-48 (#112): de claimknoppen zijn vervangen door de gedeelde authstijl; de
  // claimstapel zelf blijft token-only (zie de controle hieronder).
  assert.match(block, /\.claim-step \{ display: grid; gap: 16px; \}/);
  assert.match(block, /\.nvwa-export-btn \{[^}]*background: var\(--button-primary-bg\)/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b/, 'no hard-coded colour in the BE-28b block');
});
