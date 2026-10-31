'use strict';

// BE-63 (#155, ronde 3) — het mobiele menu en het instellingenpaneel.
//
// Bronregressie (fs + regex), dezelfde conventie als PrimaryNav.test.js: dit
// project heeft geen rendered-DOM-harness voor 'use client'-componenten. Wat
// hier vastligt zijn de eisen uit de opdracht: de inhoud en de links van het
// menu, dat beide varianten in een portaal boven de tabbalk liggen, en de
// focusregels (focus erin, Tab binnen het paneel, Esc sluit, focus terug).

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const PANEL = read('src/components/PublicHeaderPanel.js');
const CSS = read('src/components/public-header-menu.css');
const GLOBALS = read('app/globals.css');

test('is een clientcomponent met een eigen stylesheet, in een portaal', () => {
  assert.match(PANEL, /^'use client'/);
  assert.match(PANEL, /import '\.\/public-header-menu\.css'/);
  assert.match(PANEL, /import \{ createPortal \} from 'react-dom'/);
  assert.match(PANEL, /return createPortal\(/);
  assert.match(PANEL, /document\.body/);
  assert.match(PANEL, /role="dialog"/);
  assert.match(PANEL, /aria-modal="true"/);
  assert.match(PANEL, /export default function PublicHeaderPanel\(\{ variant = 'settings', onClose, returnFocusTo \}\)/);
});

test('het menu ligt boven de tabbalk: de laag is .share-layer, de tabbalk staat lager', () => {
  // .share-layer (z-index 150) boven .mobile-tabbar (z-index 120).
  const layer = Number(/\.share-layer \{[^}]*z-index: (\d+)/.exec(GLOBALS)[1]);
  const tabbar = Number(/\.mobile-tabbar \{[^}]*z-index: (\d+)/.exec(GLOBALS)[1]);
  assert.ok(layer > tabbar, `de menulaag (${layer}) hoort boven de tabbalk (${tabbar}) te liggen`);
  assert.match(PANEL, /className=\{`share-layer pha-layer\$\{isMenu \? ' pha-layer--sheet' : ''\}`\}/);
  // Ruimte onder het menu voor de zwevende tabbalk.
  assert.match(CSS, /\.pha-layer--sheet \{[\s\S]*padding-bottom: calc\(84px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(PANEL, /className=\{`share-panel pha-panel\$\{isMenu \? ' pha-panel--sheet' : ''\}`\}/);
});

test('de weergave: Licht, Donker en Automatisch via de gedeelde themalogica', () => {
  assert.match(PANEL, /import \{[\s\S]*THEME_OPTIONS[\s\S]*\} from '@\/src\/lib\/themePreference'/);
  assert.match(PANEL, /\{THEME_OPTIONS\.map\(\(option\) => \(/);
  assert.match(PANEL, /\{option\.label\}/);
  assert.match(PANEL, /aria-pressed=\{theme === option\.value\}/);
  assert.match(PANEL, /writeThemePreference\(safeBrowserStorage\(\), value\)/);
  assert.match(PANEL, /applyThemeChoice\(value, prefersLightNow\(\)\)/);
  assert.match(PANEL, /window\.matchMedia\('\(prefers-color-scheme: light\)'\)\.matches/);
  // Geen tweede opslagsleutel en geen eigen kleur.
  assert.doesNotMatch(PANEL, /localStorage\.setItem\(/);
  assert.doesNotMatch(CSS, /(?:color|background|border|fill|stroke)[\w-]*\s*:\s*#[0-9a-fA-F]{3,6}\b|rgba?\(|hsla?\(/);
});

test('"Delen via" opent het BE-61-venster en toont de huidige keuze als subtekst', () => {
  assert.match(PANEL, /import \{[\s\S]*SHARE_SETTINGS_LABEL[\s\S]*\} from '@\/src\/lib\/sharePreference'/);
  assert.match(PANEL, /sharePreferenceSummary\(shareValue\)/);
  assert.match(PANEL, /\{SHARE_SETTINGS_LABEL\}/);
  assert.match(PANEL, /onClick=\{openShare\}/);
  assert.match(PANEL, /setShareOpen\(true\)/);
  assert.match(PANEL, /<ShareDialog[\s\S]*mode="settings"/);
  assert.match(PANEL, /onSave=\{saveShare\}/);
  // Het venster wordt pas geladen als het nodig is (BE-50).
  assert.match(PANEL, /dynamic\(/);
  assert.match(PANEL, /ssr: false/);
});

test('het menu: het blok "Heb je een restaurant?" met Inloggen en Claim je zaak', () => {
  assert.match(PANEL, /export const RESTAURANT_BLOCK_TITLE = 'Heb je een restaurant\?'/);
  assert.match(PANEL, /export const RESTAURANT_BLOCK_TEXT = 'Log in om je menukaart, prijzen en daghap bij te werken\.'/);
  assert.match(PANEL, /\{RESTAURANT_BLOCK_TITLE\}/);
  assert.match(PANEL, /\{RESTAURANT_BLOCK_TEXT\}/);
  // Inloggen: donkere knop (.share-btn-primary) naar /inloggen.
  assert.match(PANEL, /<Link href="\/inloggen" className="share-btn share-btn-primary pha-block-action">\s*\{LOGIN_LABEL\}/);
  // Claim je zaak: omlijnde knop (.share-btn) naar /mijn-restaurant/claimen.
  assert.match(PANEL, /<Link href="\/mijn-restaurant\/claimen" className="share-btn pha-block-action">\s*\{CLAIM_LABEL\}/);
  assert.match(PANEL, /export const VISITOR_NOTE = 'Als bezoeker heb je geen account nodig\.'/);
  assert.match(PANEL, /\{VISITOR_NOTE\}/);
  // En de teller van "Mijn lijstje".
  assert.match(PANEL, /export const LIST_LABEL = 'Mijn lijstje'/);
  assert.match(PANEL, /<Link href="\/mijn-lijstje" className="pha-row">/);
  assert.match(PANEL, /savedListCount\(storage\)/);
  assert.match(PANEL, /window\.addEventListener\(SAVED_LIST_EVENT, read\)/);
  // Alleen het menu toont het restaurantblok en het lijstje.
  assert.match(PANEL, /\{isMenu \? \(/);
});

test('sluiten en focus: focus erin, Tab binnen het paneel, Esc sluit, focus terug', () => {
  // Focus erin: de sluitknop van het paneel krijgt de focus.
  assert.match(PANEL, /const first = closeRef\.current \|\| focusables\(\)\[0\]/);
  assert.match(PANEL, /if \(first && typeof first\.focus === 'function'\) first\.focus\(\)/);
  assert.match(PANEL, /ref=\{closeRef\}/);
  // Tab blijft binnen het paneel, ook met shift.
  assert.match(PANEL, /if \(event\.key !== 'Tab'\) return/);
  assert.match(PANEL, /if \(event\.shiftKey && document\.activeElement === items\[0\]\)/);
  assert.match(PANEL, /else if \(!event\.shiftKey && document\.activeElement === last\)/);
  // Esc sluit.
  assert.match(PANEL, /if \(event\.key === 'Escape'\) \{/);
  assert.match(PANEL, /onCloseRef\.current\(\)/);
  // En de focus keert terug naar de knop die het paneel opende.
  assert.match(PANEL, /const opener = returnFocusToRef\.current && returnFocusToRef\.current\.current/);
  assert.match(PANEL, /if \(opener && typeof opener\.focus === 'function' && document\.contains\(opener\)\) opener\.focus\(\)/);
  // Sluiten kan ook met de sluitknop en met een tik naast het paneel.
  assert.match(PANEL, /aria-label=\{MENU_CLOSE_LABEL\}/);
  assert.match(PANEL, /if \(event\.target === event\.currentTarget\) close\(\)/);
  assert.match(PANEL, /\{MENU_CLOSE_LABEL\}/);
});

test('de sluitknop is 44 × 44 px en rond, net als de andere kopknoppen', () => {
  const close = CSS.slice(CSS.indexOf('.pha-close {'), CSS.indexOf('.pha-close:hover'));
  assert.match(close, /width: 44px/);
  assert.match(close, /height: 44px/);
  assert.match(close, /border-radius: var\(--radius-pill\)/);
});

test('geen volledig dishList in het paneel: de teller komt uit de kleine helper', () => {
  assert.match(PANEL, /import \{ SAVED_LIST_EVENT, safeBrowserStorage, savedListCount \} from '@\/src\/lib\/savedListStorage'/);
  assert.doesNotMatch(PANEL, /@\/src\/lib\/dishList/);
  assert.doesNotMatch(PANEL, /readSavedList/);
});

