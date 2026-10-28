'use strict';

// BE-14 — canonical back-navigation correction. Same convention as
// app/search/page.test.js: fs.readFileSync + regex, since this project has
// no rendered-DOM test harness for app/ pages. This is this component's
// first test file; it exists solely to pin the one back-link this ticket
// touches — see be-14-fix-alle-restaurants-back-navigation.md.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const COMPONENT_PATH = path.join(REPO_ROOT, 'app/restaurant/[id]/RestaurantDetailView.js');

function readComponentSource() {
  return fs.readFileSync(COMPONENT_PATH, 'utf8');
}

test('BE-14: "← Alle restaurants" is a real Link element pointing at /alle-restaurants, not the older /restaurants', () => {
  const source = readComponentSource();
  assert.match(
    source,
    /<Link href="\/alle-restaurants" className="back-btn">← Alle restaurants<\/Link>/,
    'expected the header back-link to target /alle-restaurants, with its visible text unchanged'
  );
});

test('BE-14: no header link on this page still points at /restaurants', () => {
  const source = readComponentSource();
  assert.doesNotMatch(
    source,
    /<Link href="\/restaurants"/,
    'the older /restaurants target must be fully gone from this file'
  );
});

// ─── BE-42 (#98) 2A — de hele menukaart in tabbladen ─────────────────────────
// Bronregressies (fs + regex, dezelfde conventie als hierboven). Het echte
// beeld en de echte HTML worden bewezen door de browsercheck
// (ops/browser/run-be42-browser-check.js); het kaartmodel zelf door
// src/lib/menuTabs.test.js.

const PAGE_PATH = path.join(REPO_ROOT, 'app/restaurant/[id]/page.js');

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

test('BE-42 2A: de sectie heet "Menukaarten" en toont één tabblad per kaart', () => {
  const source = readComponentSource();
  assert.match(source, /<h2 className="rpm-title" id="menukaarten-title">Menukaarten<\/h2>/);
  assert.doesNotMatch(source, /Menukaart preview/, 'the six-dish preview is gone');
  assert.match(source, /\{menus\.tabs\.map\(tab => \(/, 'each menu is its own tab');
  assert.match(source, /className=\{`meal-btn \$\{tab\.active \? 'active' : ''\}`\}/, 'the active tab is visibly marked');
});

test('BE-42 2A: elk tabblad is een echte link van de server (?kaart=<id>)', () => {
  const source = readComponentSource();
  assert.match(source, /href=\{tab\.href\}/, 'the tab href comes from the model (a real link)');
  assert.match(source, /aria-current=\{tab\.active \? 'page' : undefined\}/, 'the active tab is announced');
  assert.match(source, /prefetch=\{false\}/, 'the other menus are not prefetched, so only the chosen menu loads');
  assert.match(source, /scroll=\{false\}/, 'switching tabs does not jump to the top');
  assert.doesNotMatch(source, /<button[^>]*onClick=\{[^}]*kaart/, 'tabs are links, not JavaScript-only buttons');
});

test('BE-42 2A: de hele kaart komt uit de bestaande menukaart-opbouw (MenuBody)', () => {
  const source = readComponentSource();
  assert.match(source, /import \{ StaticMenu \} from '@\/src\/components\/MenuBody'/);
  assert.equal((source.match(/<StaticMenu/g) || []).length, 1, 'exactly one menu body is rendered');
  assert.match(source, /categories=\{menus\.activeMenu\.categories\}/, 'only the chosen menu is rendered');
  assert.doesNotMatch(source, /menus\.activeMenu\.categories\.map|tab\.categories/, 'no second dish renderer');
});

test('BE-42 2A: regressie — de restaurantpagina rendert maar één kaart, nooit alle kaarten', () => {
  const source = readComponentSource();
  const page = readPageSource();
  // De view kent alleen het actieve menu; er is geen lijst met alle menus meer.
  assert.doesNotMatch(source, /menus\.menus|menus\.all|menus\.map\(|activeMenus/, 'the view has no all-menus data');
  assert.match(source, /menus\.activeMenu/, 'the panel renders the active menu');
  // De serverpagina geeft alleen het model mee; het model draagt één kaart.
  assert.doesNotMatch(page, /getMenuPreview|menuPreview/, 'the six-dish preview helper is gone');
  assert.match(page, /restaurantMenus\(\{/, 'the page builds the tab model server-side');
  assert.match(page, /requested: query\.kaart/, 'the requested tab comes from ?kaart=');
  assert.match(page, /restaurantForView\(restaurant\)/, 'the embedded copy of all menus is stripped before it reaches the browser');
});

test('BE-42 2A: de bronregel, de originele kaart en /menu/<id> blijven bestaan', () => {
  const source = readComponentSource();
  assert.match(source, /className="rp-source rpm-source"/, 'the source line per menu is kept');
  assert.match(source, /href=\{menus\.activeMenu\.source\}/, 'the link to the original menu is kept');
  assert.match(source, /<Link href=\{`\/menu\/\$\{menus\.activeMenu\.id\}`\} className="detail-menu-btn-outline">/, 'the separate menu page stays reachable');
});

test('BE-42 2A: de standaardkaart en de tabkeuze komen van de server, niet van de klok', () => {
  const page = readPageSource();
  const source = readComponentSource();
  // De keuze is server-side (searchParams) en de view rekent zelf geen tab uit.
  assert.match(page, /const query = \(await searchParams\) \|\| \{\}/);
  assert.doesNotMatch(source, /\? `\$\{menus\.tabs\[0\]|tabs\.find\(/, 'the view does not pick a tab itself');
  assert.match(page, /menus: menusData/, 'all menus stay on the server; only the chosen one travels to the browser');
});

