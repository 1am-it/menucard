'use strict';

// BE-63 (#155, ronde 3) — de ene rechterkant van de publieke kop, als
// oppervlaktetest.
//
// Zelfde conventie als PrimaryNav.test.js en sharePreferenceSurface.test.js: het
// bronbestand lezen met fs + regex, want dit project heeft geen rendered-DOM-
// harness voor 'use client'-componenten. De rekenregels van de weergave staan in
// src/lib/themePreference.test.js; de paneelinhoud in
// src/components/PublicHeaderPanel.test.js. Hier gaat het om de eerste lading:
// gast en ingelogd, de twee knoppen, en dat het paneel (thema, delen, lijstje)
// pas bij het openen wordt geladen.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const HERO = read('src/components/PublicHeaderActions.js');
const CSS = read('src/components/public-header-actions.css');
const PANEL_CSS = read('src/components/public-header-menu.css');

const PUBLIC_PAGES = [
  'app/HomeView.js',
  'app/alle-restaurants/page.js',
  'app/claim/[restaurantId]/ClaimView.js',
  'app/inloggen/page.js',
  'app/kies/[code]/KiesView.js',
  'app/menu/[id]/MenuView.js',
  'app/mijn-lijstje/MijnLijstjeView.js',
  'app/nvwa/[id]/NvwaView.js',
  'app/restaurant/[id]/RestaurantDetailView.js',
  'app/search/page.js',
];

test('is een clientcomponent met een eigen stylesheet en een eigen paneelstylesheet', () => {
  assert.match(HERO, /^'use client'/);
  assert.match(HERO, /import '\.\/public-header-actions\.css'/);
  assert.match(CSS, /\.public-header-actions/);
  assert.match(PANEL_CSS, /\.pha-panel/);
});

test('als gast: "Voor restaurants", "Inloggen" naar /inloggen en de instellingenknop', () => {
  assert.match(HERO, /<Link href="\/voor-restaurants" className="pha-restaurants">Voor restaurants<\/Link>/);
  assert.match(HERO, /<Link href="\/inloggen" className="pha-login">Inloggen<\/Link>/);
  // De knop verschijnt alleen zonder sessiesleutel; de server raadt niets.
  assert.match(HERO, /\{signedIn \? null : \(/);
  assert.match(HERO, /hasSupabaseSessionKey\(window\.localStorage\)/);
  assert.match(HERO, /aria-label=\{SETTINGS_BUTTON_LABEL\}/);
  assert.match(HERO, /const SETTINGS_BUTTON_LABEL = 'Instellingen: thema en delen'/);
  assert.match(HERO, /aria-haspopup="dialog"/);
});

test('ingelogd: het bestaande accountmenu staat op de plek van "Inloggen"', () => {
  // Het menu staat er altijd, maar levert zelf niets zonder sessiesleutel
  // (BE-59); de Inloggen-knop verdwijnt zodra de sleutel er wel is.
  assert.match(HERO, /<AccountMenuButton \/>[\s\S]*<button[\s\S]*className="pha-settings"/);
  assert.match(
    HERO,
    /import AccountMenuButton from '@\/src\/components\/AccountMenuButton'/,
    'het bestaande accountmenu wordt hergebruikt, niet nagemaakt'
  );
});

test('de eerste lading bevat alleen de knoppen: het paneel wordt pas bij openen geladen', () => {
  // Ronde 2 brak het laadbudget doordat weergave, deelkeuze en paneel meteen
  // meekwamen. Die staan nu in PublicHeaderPanel.js, achter next/dynamic.
  assert.match(HERO, /import dynamic from 'next\/dynamic'/);
  assert.match(HERO, /dynamic\(\(\) => import\('@\/src\/components\/PublicHeaderPanel'\), \{ ssr: false \}\)/);
  assert.match(HERO, /\{open \? \(/);
  for (const forbidden of [/themePreference/, /sharePreference/, /ShareDialog/, /readSavedList/, /createPortal/, /SAVED_LIST_EVENT/]) {
    assert.doesNotMatch(HERO, forbidden, `${forbidden}: hoort niet in de eerste lading van de kop`);
  }
  // De sessiesleutel wordt net als in AccountMenuButton direct gelezen: geen
  // extra module in de eerste lading.
  assert.doesNotMatch(HERO, /savedListStorage/);
  assert.doesNotMatch(HERO, /@\/src\/lib\/dishList/, 'geen volledig dishList in de eerste lading');
  assert.match(HERO, /variant=\{open\}/);
  assert.match(HERO, /onClose=\{close\}/);
  assert.match(HERO, /returnFocusTo=\{open === 'menu' \? menuRef : settingsRef\}/);
});

test('mobiel: één ronde menuknop van 44 × 44 px met aria-label "Menu"', () => {
  assert.match(HERO, /const MENU_BUTTON_LABEL = 'Menu'/);
  assert.match(HERO, /className="pha-menu"/);
  assert.match(HERO, /aria-label=\{MENU_BUTTON_LABEL\}/);
  assert.match(HERO, /aria-expanded=\{open === 'menu'\}/);
  assert.match(HERO, /onClick=\{\(\) => setOpen\('menu'\)\}/);
  const menu = CSS.slice(CSS.indexOf('.pha-menu {'), CSS.indexOf('.pha-menu:hover'));
  assert.match(menu, /width: 44px/);
  assert.match(menu, /height: 44px/);
  assert.match(menu, /border-radius: var\(--radius-pill\)/);
  // Op desktop verborgen, op de telefoon zichtbaar.
  assert.match(menu, /display: none/);
  assert.match(CSS, /@media \(max-width: 640px\)/);
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /\.pha-menu \{\s*display: inline-flex;/);
  assert.match(mobile, /\.pha-restaurants,\s*\.pha-settings \{\s*display: none;/);
});

test('de instellingenknop is 44 × 44 px en "Inloggen" is 44 px hoog, omlijnd en rond', () => {
  const settings = CSS.slice(CSS.indexOf('.pha-settings {'), CSS.indexOf('.pha-settings:hover'));
  assert.match(settings, /width: 44px/);
  assert.match(settings, /height: 44px/);
  assert.match(settings, /border-radius: var\(--radius-pill\)/);
  const login = CSS.slice(CSS.indexOf('.pha-login {'), CSS.indexOf('.pha-login:hover'));
  assert.match(login, /height: 44px/);
  assert.match(login, /border: 1px solid var\(--border\)/);
  assert.match(login, /border-radius: var\(--radius-pill\)/);
  // Kleuren alleen via tokens.
  for (const css of [CSS, PANEL_CSS]) {
    assert.doesNotMatch(css, /(?:color|background|border|fill|stroke)[\w-]*\s*:\s*#[0-9a-fA-F]{3,6}\b|rgba?\(|hsla?\(/);
  }
});

test('elke publieke pagina gebruikt de ene component en geen losse kopknoppen meer', () => {
  for (const file of PUBLIC_PAGES) {
    const source = read(file);
    assert.match(
      source,
      /import PublicHeaderActions from '@\/src\/components\/PublicHeaderActions'/,
      `${file}: de gedeelde kop`
    );
    assert.match(source, /<PublicHeaderActions \/>/, `${file}: de gedeelde kop in de markup`);
    assert.doesNotMatch(
      source,
      /<ThemeToggle \/>|<ShareSettingsButton \/>/,
      `${file}: geen losse themakeuze of deelknop meer in de publieke kop`
    );
  }
});

test('de interne kop en /mijn-restaurant houden hun eigen losse knoppen', () => {
  assert.match(read('src/components/InternalNav.js'), /<ThemeToggle \/>/);
  assert.match(read('app/mijn-restaurant/OwnerDashboard.js'), /<ThemeToggle \/>/);
});

