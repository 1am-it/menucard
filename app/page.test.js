'use strict';

// BE-29 (#70) — de home is herschreven van een server-selectie naar een
// compacte kandidatenlijst plus de pure selectie in de browser. Deze tests
// vervangen de BE-28-tests waar dat besluit ze vervangt; de BE-14-regel
// ("Bekijk alle restaurants →" wijst naar /alle-restaurants) blijft gelden.
//
// Same convention as the other app/ tests: fs.readFileSync + regex, no
// rendered-DOM harness. De home bestaat uit een dunne serverpagina
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

test('BE-29: app/page.js is a server page that only passes the compact candidate list, never the menu data', () => {
  const page = readPage();
  assert.doesNotMatch(page, /^'use client'/m, 'the page itself must stay server-side');
  assert.match(page, /import HomeView from '\.\/HomeView'/);
  assert.match(page, /import \{ buildTonightCandidates \} from '@\/src\/lib\/publicTonightData'/);
  assert.match(page, /<HomeView candidates=\{buildTonightCandidates\(\)\} shareCard=\{<ShareHeroCard \/>\} \/>/);
  assert.match(page, /export const revalidate = 300\b/, 'a bounded ISR window keeps the home fast');
  assert.doesNotMatch(page, /^import .*menus\.json/m, 'the menu archive is never imported into the page module');
  assert.doesNotMatch(page, /selectTonightDishes|tonight=/, 'no server-side moment selection remains');
});

test('BE-29: home order matches the mockup — search panel, meal chips, "Populair in Breda", season tiles, then the moment section', () => {
  const view = readView();
  const hero = view.indexOf('className="home-hero"');
  const chips = view.indexOf('className="home-chips"');
  const popular = view.indexOf('id="populair-title"');
  const season = view.indexOf('id="seizoen-title"');
  const tonight = view.indexOf('id="vanavond-title"');
  const promise = view.indexOf('className="home-promise"');
  assert.ok(hero > -1 && chips > hero, 'search panel with the meal chips after it');
  assert.ok(popular > chips, '"Populair in Breda" follows the chips');
  assert.ok(season > popular, 'the season tiles follow the popular tiles');
  assert.ok(tonight > season, 'the moment section follows the season tiles');
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

test('BE-28: every meal chip and popular tile is an existing search destination, no new route or invented cuisine', () => {
  const view = readView();
  assert.match(view, /href=\{`\/search\?meal=\$\{meal\.value\}`\}/);
  assert.match(view, /href=\{`\/search\?cuisine=\$\{encodeURIComponent\(tile\.cuisine\)\}`\}/);
  assert.doesNotMatch(view, /href="\/nieuw|href="\/favorieten|href="\/account/);
});

test('BE-29: the season tiles come from the tested calendar and only appear with real search results', () => {
  const view = readView();
  assert.match(view, /import \{ seasonTiles \} from '@\/src\/lib\/seasonCalendar'/);
  assert.match(view, /const month = now \? zonedParts\(now\)\.month : null/);
  assert.match(view, /const tiles = seasonTiles\(month\)/);
  assert.match(view, /fetch\(`\/api\/search\?q=\$\{encodeURIComponent\(tile\.query\)\}&limit=1`\)/);
  assert.match(view, /data\.total > 0 \? tile : null/);
  assert.match(view, /const visibleSeasonTiles = seasonResult\.month === month \? seasonResult\.tiles : \[\]/);
  assert.match(view, /\{visibleSeasonTiles\.length > 0 && \(/);
  assert.match(view, /data-season=\{tile\.id\}/);
  assert.match(view, /href=\{tile\.href\}/);
  assert.doesNotMatch(view, /href="\/seizoen|href="\/nieuw/);
});

test('BE-29: the moment section is selected in the browser and omitted below three dishes', () => {
  const view = readView();
  assert.match(view, /import \{ selectTonight \} from '@\/src\/lib\/publicTonight'/);
  assert.match(view, /const selection = useMemo\(\s*\(\) => \(now \? selectTonight\(\{ candidates, now \}\) : null\),\s*\[candidates, now\]\s*\)/);
  assert.match(view, /const tonight = selection && !selection\.hidden \? selection\.dishes : \[\]/);
  assert.match(view, /\{tonight\.length > 0 && \(/);
  assert.match(view, /data-meal=\{selection\.mealType\}/);
  assert.match(view, /href=\{`\/search\?meal=\$\{selection\.mealType\}`\}/);
});

test('BE-29: the title and every label are driven by the selected moment and the real dish fields', () => {
  const view = readView();
  assert.match(view, /\{selection\.title\} <Emoji glyph="🔥" \/>/);
  assert.match(view, /<Link href=\{dish\.href\} className="tonight-card" data-dish=\{dish\.dishId\}>/);
  assert.match(view, /\{dish\.newOnMenu && \(/);
  assert.match(view, /Nieuw op de kaart/);
  assert.match(view, /\{dish\.seasonal && \(/);
  assert.match(view, /> Seizoen\s*<\/span>/);
  assert.match(view, /\{dish\.vegetarian && \(/);
  assert.match(view, /> Vegetarisch\s*<\/span>/);
  assert.match(view, /\{dish\.daily && \(/);
  assert.match(view, /Daghap · \{dish\.daily\.dateLine\}/);
  assert.match(view, /<span className="tonight-price">\{dish\.priceDisplay\}<\/span>/, 'the price is the real priceDisplay from the data');
  assert.doesNotMatch(view, /€\s?\d/, 'no hand-written price literal in the view');
});

test('BE-29: there is no server-rendered "Nu open" or daghap — both wait for the browser clock', () => {
  const view = readView();
  assert.match(view, /const isOpen = !!now && !!dish\.openingHours && todayOpening\(dish\.openingHours, now\)\.state === 'open'/);
  // BE-38 (#90) — "Nu open" staat in de tak zonder terugvaltijd; een gerecht
  // uit de terugval noemt zijn eigen "Opent om HH:MM".
  assert.match(view, /\) : \(\s*isOpen && \(/);
  assert.doesNotMatch(view, /openStatus/, 'a stored or server-computed status is never used as "Nu open"');
  // De hele moment-sectie hangt achter `now`: zonder browserklok staat er
  // geen gerecht, geen daghap en geen "Nu open" in de server-HTML.
  assert.match(view, /\(now \? selectTonight\(\{ candidates, now \}\) : null\)/);
});

test('BE-38: the section keeps its place and labels a fallback dish with its own clock time', () => {
  const view = readView();
  // Dezelfde sectie, dezelfde kaart: alleen de titel en de inhoudsregel
  // veranderen. De titel komt uit de pure selectie (inclusief "· vanaf HH:MM").
  assert.match(view, /\{selection\.title\} <Emoji glyph="🔥" \/>/);
  assert.match(view, /data-mode=\{selection\.mode\}/);
  assert.match(view, /href=\{`\/search\?meal=\$\{selection\.mealType\}`\}/);
  // Een gerecht uit de terugval: "🕒 Opent om HH:MM" in plaats van "Nu open".
  assert.match(view, /\{dish\.opensAt \? \(/);
  assert.match(view, /<span className="open-label open-label--later">/);
  assert.match(view, /<Emoji glyph="🕒" \/>\s*Opent om \{dish\.opensAt\}/);
  assert.match(view, /\{\(dish\.newOnMenu \|\| dish\.seasonal \|\| dish\.vegetarian \|\| dish\.daily \|\| dish\.opensAt \|\| isOpen\) && \(/);
  assert.doesNotMatch(view, /Opent om \d{2}:\d{2}/, 'geen vaste tijd in de weergave');
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
