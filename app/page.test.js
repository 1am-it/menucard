'use strict';

// BE-28 (#65) — de home is herschreven naar de goedgekeurde frisse mockup.
// Deze tests vervangen de oude home-tests uit BE-14 en de "drie USP-blokken"-
// tests: die regels zijn door dit besluit vervangen (owner 2026-10-25, zie
// planning/specs/tickets/be-28-fresh-public-style.md). De BE-14-regel zelf
// blijft gelden en wordt hieronder opnieuw vastgepind: "Bekijk alle
// restaurants →" wijst naar /alle-restaurants, nooit naar /restaurants.
//
// Same convention as the other app/ tests: fs.readFileSync + regex, no
// rendered-DOM harness. De home bestaat nu uit een dunne serverpagina
// (app/page.js) plus de 'use client'-weergave (app/HomeView.js).

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app/page.js');
const VIEW_PATH = path.join(REPO_ROOT, 'app/HomeView.js');

const readPage = () => fs.readFileSync(PAGE_PATH, 'utf8');
const readView = () => fs.readFileSync(VIEW_PATH, 'utf8').replace(/\r\n/g, '\n');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test('BE-14: "Bekijk alle restaurants →" is a real Link to /alle-restaurants, not the older /restaurants', () => {
  assert.match(
    readView(),
    /<Link href="\/alle-restaurants" className="detail-menu-btn-outline">\s*Bekijk alle restaurants →/,
    'expected the browse link to target /alle-restaurants, with its visible text unchanged'
  );
  assert.doesNotMatch(readView(), /<Link href="\/restaurants"[^>]*>\s*Bekijk alle restaurants/);
});

test('BE-28: app/page.js is a server page that only passes real tonight dishes, never the menu data', () => {
  const page = readPage();
  assert.doesNotMatch(page, /^'use client'/m, 'the page itself must stay server-side');
  assert.match(page, /import HomeView from '\.\/HomeView'/);
  assert.match(page, /import \{ selectTonightDishes \} from '@\/src\/lib\/publicTonight'/);
  assert.match(page, /<HomeView tonight=\{selectTonightDishes\(\)\} \/>/);
  assert.match(page, /export const revalidate = 300\b/, 'a bounded ISR window keeps the home fast');
  assert.doesNotMatch(page, /^import .*menus\.json/m, 'the menu archive is never imported into the page module');
});

test('BE-28: home order matches the mockup — search panel, meal chips, "Populair in Breda", then "Vanavond op de kaart"', () => {
  const view = readView();
  const hero = view.indexOf('className="home-hero"');
  const chips = view.indexOf('className="home-chips"');
  const popular = view.indexOf('id="populair-title"');
  const tonight = view.indexOf('id="vanavond-title"');
  const promise = view.indexOf('className="home-promise"');
  assert.ok(hero > -1 && chips > hero, 'search panel with the meal chips after it');
  assert.ok(popular > chips, '"Populair in Breda" follows the chips');
  assert.ok(tonight > popular, '"Vanavond op de kaart" follows the tiles');
  assert.ok(promise > tonight, 'the ⚡ / 💶 / 📵 line closes the page');
});

test('BE-28: the search panel carries the approved copy and a real search form into /search', () => {
  const view = readView();
  assert.match(view, /Breda · echte menukaarten/);
  assert.match(view, /Waar heb je vanavond zin in\?/);
  assert.match(view, /<form className="home-search" role="search" onSubmit=\{handleSubmit\}>/);
  assert.match(view, /router\.push\(trimmed \? `\/search\?q=\$\{encodeURIComponent\(trimmed\)\}` : '\/search'\)/);
  assert.match(view, /Laadt snel, ook op 4G/);
  assert.match(view, /Altijd met prijs/);
  assert.match(view, /Geen foto’s, wel info/);
});

test('BE-28: every meal chip and tile is an existing search destination, no new route or invented cuisine', () => {
  const view = readView();
  assert.match(view, /href=\{`\/search\?meal=\$\{meal\.value\}`\}/);
  assert.match(view, /href=\{`\/search\?cuisine=\$\{encodeURIComponent\(tile\.cuisine\)\}`\}/);
  assert.doesNotMatch(view, /href="\/nieuw|href="\/favorieten|href="\/account/);
});

test('BE-28: "Vanavond op de kaart" only renders with real dishes and never invents one', () => {
  const view = readView();
  assert.match(view, /\{tonight\.length > 0 && \(/, 'the section is omitted when there is no honest selection');
  assert.match(view, /\{tonight\.map\(\(dish\) => \{/);
  assert.match(view, /<span className="tonight-price">\{dish\.priceDisplay\}<\/span>/, 'the price is the real priceDisplay from the data');
  assert.match(view, /<Link href=\{dish\.menuLink\} className="tonight-card">/);
  assert.doesNotMatch(view, /€\s?\d/, 'no hand-written price literal in the view');
});

test('BE-28: "Nu open" on the home comes only from the existing opening logic and the browser clock', () => {
  const view = readView();
  assert.match(view, /import \{ todayOpening \} from '@\/src\/lib\/openingStatus'/);
  assert.match(view, /const isOpen = !!now && !!dish\.openingHours && todayOpening\(dish\.openingHours, now\)\.state === 'open'/);
  assert.match(view, /\{isOpen && \(/);
  assert.doesNotMatch(view, /openStatus/, 'a stored or server-computed status is never used as "Nu open"');
});

test('BE-28: emoji are system characters via <Emoji/>, never an image, font or bare character', () => {
  const view = readView();
  assert.match(view, /import Emoji from '@\/src\/components\/Emoji'/);
  const code = view
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/glyph="[^"]*"/g, '')
    .replace(/glyph: '[^']*'/g, '');
  assert.doesNotMatch(code, EMOJI, 'no bare emoji outside <Emoji glyph="…"/>');
  assert.doesNotMatch(view, /<img|background-image|\.png|\.svg|fonts\.googleapis/);
});

test('BE-28: the home mounts the shared PrimaryNav and the phone tab bar', () => {
  const view = readView();
  assert.match(view, /import PrimaryNav from '@\/src\/components\/PrimaryNav'/);
  assert.match(view, /import MobileTabBar from '@\/src\/components\/MobileTabBar'/);
  assert.match(view, /<MobileTabBar \/>/);
  assert.match(view, /<main className="page-with-tabbar">/);
});
