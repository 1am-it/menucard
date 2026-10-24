'use strict';

// Z2-Z4 of the Delivery Lead order 6382953597 (variant 5): a static guard on the
// real page, the map component and the stylesheet. The rendered behaviour
// (light/dark, 320/390 px, panels, lazy pages, keyboard) is proven by
// ops/browser/run-menu-review-browser-check.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const PAGE = read(path.join('app', 'internal', 'menu-import', 'page.js'));
const MAP = read(path.join('src', 'components', 'MenuSourceMap.js'));
const CSS = read(path.join('app', 'globals.css'));

test('Z2: de schakelaar Lijst | Kaart staat bij de review en is met het toetsenbord te bedienen', () => {
  assert.match(PAGE, /className="mai-view-toggle" role="group" aria-label="Weergave van de controle"/);
  assert.match(PAGE, /aria-pressed=\{viewMode === 'list'\}/);
  assert.match(PAGE, /aria-pressed=\{viewMode === 'map'\}/);
  assert.match(PAGE, />\s*Lijst\s*<\/button>/);
  assert.match(PAGE, />\s*Kaart\s*<\/button>/);
  // De kaart verschijnt alleen als de server hem kan vergelijken.
  assert.match(PAGE, /\{review\.sourceMap && review\.sourceMap\.available \? \(/);
});

test('Z2: de legenda en de markeringen komen uit de server, niet uit het scherm', () => {
  assert.match(MAP, /\{map\.legend\.map\(\(entry\) => \(/);
  assert.match(MAP, /className=\{`mai-map-swatch mai-map-swatch--\$\{entry\.tone\}`\}/);
  assert.match(MAP, /className=\{`mai-map-mark mai-map-mark--\$\{line\.tone\}`\}/);
  assert.match(MAP, /aria-label=\{line\.ariaLabel\}/);
  assert.match(MAP, /aria-expanded=\{openMarkId === line\.markId\}/);
  // Colour is never the only carrier: a shape and a written label per tone.
  assert.match(MAP, /const GLYPH = \{/);
  assert.match(MAP, /\{GLYPH\[line\.tone\] \|\| '•'\}/);
});

test('Z3: pagina\'s komen lui binnen en er staat geen afbeelding in de kaart', () => {
  assert.match(PAGE, /async function loadCard\(sourceId, page\)/);
  assert.match(PAGE, /`\/imports\/\$\{report\.importId\}\/source-map`/);
  assert.match(PAGE, /source_id: sourceId, page/);
  // Alleen bij openen of bladeren, nooit bij de eerste weergave.
  const loader = PAGE.slice(PAGE.indexOf('async function loadCard'), PAGE.indexOf('function showMap'));
  assert.equal(loader.includes('AI_API'), false, 'no AI call when a page is read');
  assert.equal(loader.includes('fetch('), false, 'the loader uses the existing api() helper only');
  assert.equal(/<img|<canvas|<iframe|<object/.test(MAP), false, 'the card is text, never an image');
  assert.match(MAP, /card\.source\.view\.notice/);
});

test('Z3: de PDF- en afbeeldingsmeldingen staan er letterlijk', () => {
  const map = require('./menuSourceMap');
  assert.equal(map.WEBSITE_NOTICE, 'Opgehaalde tekst van de website');
  assert.equal(map.IMAGE_NOTICE, 'Deze kaart is een afbeelding; vergelijken kan nog niet.');
  assert.match(map.PDF_TEXT_NOTICE, /De echte PDF-pagina kan niet worden getoond/);
});

test('Z4: het paneel biedt per kleur precies de toegestane acties', () => {
  assert.match(MAP, /Kaart \{mark\.priceText \|\| 'onbekend'\} · concept \{mark\.conceptPriceText \|\| 'onbekend'\}/);
  assert.match(MAP, /Neem \{mark\.priceText \|\| 'de prijs'\} over/);
  assert.match(MAP, /aria-label=\{`Wijzig \$\{mark\.name \|\| 'dit gerecht'\}`\}/);
  assert.match(MAP, /onClick=\{\(\) => onTakePrice\(mark\)\}/);
  assert.match(MAP, /onClick=\{\(\) => onAdd\(mark\)\}/);
  assert.match(MAP, /onClick=\{\(\) => onNotDish\(mark\)\}/);
  assert.match(MAP, /onClick=\{\(\) => onCorrect\(mark\)\}/);
  // De kaart doet zelf geen verzoek: de pagina houdt de duurzame route.
  assert.equal(/fetch\(|api\(/.test(MAP), false, 'the map component calls no API itself');
  assert.match(PAGE, /action: 'take_source_price', lineId: mark\.id, rowId: mark\.rowId/);
  // "Bekijk op kaart" bij een gerecht in de lijst.
  assert.match(PAGE, /onClick=\{\(\) => openMarkOnMap\(row\)\}/);
  assert.match(PAGE, /Bekijk op kaart/);
});

test('Z2/Z4: de kleuren volgen de bestaande statusrollen, met rand of stippel als tweede drager', () => {
  for (const rule of ['.mai-map-swatch--covered', '.mai-map-swatch--uncovered', '.mai-map-swatch--price_mismatch', '.mai-map-swatch--not_dish']) {
    assert.ok(CSS.includes(rule), rule);
  }
  assert.match(CSS, /\.mai-map-line--covered \{ border-left-color: var\(--status-positive\); \}/);
  assert.match(CSS, /\.mai-map-line--uncovered \{ border-left-style: dashed; border-left-color: var\(--status-old\); \}/);
  assert.match(CSS, /\.mai-map-line--price_mismatch \{ border-left-style: double; border-left-width: 4px; border-left-color: var\(--status-blocked\); \}/);
  assert.match(CSS, /\.mai-map-line--not_dish \{ border-left-color: var\(--status-neutral\)/);
  assert.match(CSS, /\.mai-map-mark--price_mismatch \{ border-style: double; border-width: 3px; border-color: var\(--status-blocked-border\); \}/);
  // The retired --warning alias stays out of the new UI (colour language guard).
  const block = CSS.slice(CSS.indexOf('.mai-view-toggle {'), CSS.indexOf('.mai-map-panel-done'));
  assert.equal(/var\(--warning/.test(block), false);
  assert.equal(/\.mai-map-done-list li button/.test(block), false);
});
