'use strict';

// BE-28b (#68) — bronregressies voor de kaart van /alle-restaurants.
// BE-42 (#98) — 1A: de kaart is geen ene grote link meer; de naam linkt naar de
// restaurantpagina en elke menukaart is een eigen knop naar /menu/<id>.
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

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// De kaart met menukaart is het stuk ná de no-menu-variant.
function menuCardSource() {
  const source = read(COMPONENT_PATH);
  const marker = 'return (\n    <article className="ar-card">';
  const start = source.indexOf(marker);
  assert.ok(start > -1, 'expected the menu-card <article>');
  return source.slice(start);
}

test('met menukaart: de kaart is geen link meer, de naam is de link', () => {
  const source = read(COMPONENT_PATH);
  assert.match(source, /<article className="ar-card">/);
  assert.doesNotMatch(source, /<Link href=\{card\.href\} className="ar-card">/, 'de hele kaart mag geen link meer zijn');
  assert.match(source, /<Link href=\{card\.href\} className="ar-name ar-name-link">\s*\{card\.name\}\s*<\/Link>/);
});

test('met menukaart: elke kaartnaam is een eigen knop naar die menukaart', () => {
  const source = menuCardSource();
  assert.match(source, /<ul className="ar-menu-buttons" aria-label=\{`Menukaarten van \$\{card\.name\}`\}>/);
  assert.match(source, /card\.menuButtons\.map\(\(button\) =>/);
  assert.match(source, /<Link href=\{button\.href\} className="ar-menu-button">/);
  assert.match(source, /<EmojiText value=\{button\.label\} \/>/);
  assert.doesNotMatch(source, /card\.ctaLabel|ar-cta/, 'de grote knop "Bekijk N menukaarten" is vervallen');
});

test('met menukaart: geen geneste links en de knoppen staan in de DOM na de naam', () => {
  const source = menuCardSource();
  const nameLinkAt = source.indexOf('className="ar-name ar-name-link"');
  const buttonsAt = source.indexOf('className="ar-menu-buttons"');
  assert.ok(nameLinkAt > -1 && buttonsAt > nameLinkAt, 'tabvolgorde: eerst de naam, dan de kaartknoppen');
  const links = source.match(/<Link\b/g) || [];
  assert.equal(links.length, source.match(/<\/Link>/g).length, 'elke <Link> sluit precies één keer');
  const between = source.slice(nameLinkAt, buttonsAt);
  assert.doesNotMatch(between.slice(between.indexOf('</Link>')), /<Link\b/, 'geen tweede link vóór de knoppenlijst');
});

test('zonder menukaart: de kaart blijft één link met "Nog geen menukaart" en "Bekijk restaurant →"', () => {
  const source = read(COMPONENT_PATH);
  const noMenuBranch = source.slice(source.indexOf('<Link href={card.href} className="ar-card ar-card--nomenu">'), source.indexOf('<article'));
  assert.match(noMenuBranch, /card\.noMenuLabel/);
  assert.match(noMenuBranch, /card\.restaurantLabel/);
  assert.match(noMenuBranch, /className="ar-arrow" aria-hidden="true">→</);
  assert.doesNotMatch(noMenuBranch, /ar-menu-button|ar-cta/, 'zonder menukaart geen knoppen en geen grote CTA');
});

test('de kaart gebruikt de decoratieve Emoji-component voor tegel en adres', () => {
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
  assert.match(css, /\.ar-menu-buttons \{[^}]*margin:\s*auto 0 0/);
});

test('globals.css: de menuknoppen zijn ≥ 44 px, token-only en hebben een zichtbare focus', () => {
  const css = read(GLOBALS_CSS_PATH);
  const button = css.match(/\.ar-menu-button \{([^}]*)\}/);
  assert.ok(button, 'expected an .ar-menu-button rule');
  assert.match(button[1], /min-height:\s*44px/);
  assert.match(button[1], /background:\s*var\(--surface-soft\)/);
  assert.match(button[1], /color:\s*var\(--text-primary\)/);
  assert.match(css, /\.ar-name-link:focus-visible,\s*\n\.ar-menu-button:focus-visible \{ outline: 2px solid var\(--border-focus\)/);
  assert.match(css, /\.ar-name-link \{[^}]*color: var\(--text-primary\)/);
});

test('globals.css: op de telefoon is de kaart zonder menukaart één compacte regel met pijl', () => {
  const css = read(GLOBALS_CSS_PATH);
  assert.match(css, /@media \(max-width: 720px\) \{[^]*?\.ar-nomenu-label \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 720px\) \{[^]*?\.ar-nomenu-inline \{ display: inline; \}/);
  assert.match(css, /@media \(max-width: 720px\) \{[^]*?\.ar-restaurant-link \{ display: none; \}/);
});
