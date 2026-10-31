'use strict';

// BE-63 (#155) — de ene rechterkant van de publieke kop, als oppervlaktetest.
//
// Zelfde conventie als PrimaryNav.test.js en sharePreferenceSurface.test.js: het
// bronbestand lezen met fs + regex, want dit project heeft geen rendered-DOM-
// harness voor 'use client'-componenten. De rekenregels van de weergave staan in
// src/lib/themePreference.test.js; hier gaat het om de vragen uit de opdracht:
// gast en ingelogd, het paneel open en dicht (Esc, focus terug), de themakeuze
// inclusief Automatisch, "Delen via" opent het BE-61-venster, en geen losse
// ThemeToggle of ShareSettingsButton meer in de publieke pagina's.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const HERO = read('src/components/PublicHeaderActions.js');
const CSS = read('src/components/public-header-actions.css');

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

test('is een clientcomponent met een eigen stylesheet', () => {
  assert.match(HERO, /^'use client'/);
  assert.match(HERO, /import '\.\/public-header-actions\.css'/);
  assert.match(CSS, /\.public-header-actions/);
});

test('als gast: "Voor restaurants", "Inloggen" naar /inloggen en de instellingenknop', () => {
  assert.match(HERO, /<Link href="\/voor-restaurants" className="pha-restaurants">Voor restaurants<\/Link>/);
  assert.match(HERO, /<Link href="\/inloggen" className="pha-login">Inloggen<\/Link>/);
  // De knop verschijnt alleen zonder sessiesleutel; de server raadt niets.
  assert.match(HERO, /\{signedIn \? null : \(/);
  assert.match(HERO, /hasSupabaseSessionKey\(storage\)/);
  assert.match(HERO, /aria-label=\{SETTINGS_BUTTON_LABEL\}/);
  assert.match(HERO, /const SETTINGS_BUTTON_LABEL = 'Instellingen: thema en delen'/);
  assert.match(HERO, /aria-haspopup="dialog"/);
  assert.match(HERO, /aria-expanded=\{open\}/);
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


test('het paneel opent en sluit, met Esc en met de focus terug naar de knop', () => {
  assert.match(HERO, /role="dialog"/);
  assert.match(HERO, /aria-modal="true"/);
  assert.match(HERO, /if \(event\.key === 'Escape'\) \{/);
  assert.match(HERO, /setOpen\(false\)/);
  assert.match(HERO, /const opener = openerRef\.current \|\| document\.activeElement/);
  assert.match(HERO, /if \(opener && typeof opener\.focus === 'function' && document\.contains\(opener\)\) opener\.focus\(\)/);
  assert.match(HERO, /event\.key !== 'Tab'/);
  assert.match(HERO, /if \(event\.target === event\.currentTarget\) setOpen\(false\)/);
  assert.match(HERO, /\{SETTINGS_CLOSE_LABEL\}/);
});

test('de weergave: Licht, Donker en Automatisch via de gedeelde themalogica', () => {
  assert.match(HERO, /import \{[\s\S]*THEME_OPTIONS[\s\S]*\} from '@\/src\/lib\/themePreference'/);
  assert.match(HERO, /\{THEME_OPTIONS\.map\(\(option\) => \(/);
  assert.match(HERO, /\{option\.label\}/);
  assert.match(HERO, /aria-pressed=\{theme === option\.value\}/);
  assert.match(HERO, /writeThemePreference\(safeBrowserStorage\(\), value\)/);
  assert.match(HERO, /applyThemeChoice\(value, prefersLightNow\(\)\)/);
  assert.match(HERO, /window\.matchMedia\('\(prefers-color-scheme: light\)'\)\.matches/);
  // Geen tweede opslagsleutel en geen eigen kleur.
  assert.doesNotMatch(HERO, /localStorage\.setItem\(/);
  assert.doesNotMatch(HERO, /(?:color|background|border|fill|stroke)[\w-]*\s*:\s*#[0-9a-fA-F]{3,6}\b|rgb\(|hsl\(/);
});

test('"Delen via" opent het BE-61-venster en toont de huidige keuze als subtekst', () => {
  assert.match(HERO, /import \{[\s\S]*SHARE_SETTINGS_LABEL[\s\S]*\} from '@\/src\/lib\/sharePreference'/);
  assert.match(HERO, /sharePreferenceSummary\(shareValue\)/);
  assert.match(HERO, /\{SHARE_SETTINGS_LABEL\}/);
  assert.match(HERO, /onClick=\{openShare\}/);
  assert.match(HERO, /setShareOpen\(true\)/);
  assert.match(HERO, /<ShareDialog[\s\S]*mode="settings"/);
  assert.match(HERO, /onSave=\{saveShare\}/);
  // Het venster wordt pas geladen als het nodig is (BE-50).
  assert.match(HERO, /dynamic\(/);
  assert.match(HERO, /ssr: false/);
});

test('de knop is 44 × 44 px en "Inloggen" is 44 px hoog, omlijnd en rond', () => {
  const settings = CSS.slice(CSS.indexOf('.pha-settings {'), CSS.indexOf('.pha-settings:hover'));
  assert.match(settings, /width: 44px/);
  assert.match(settings, /height: 44px/);
  assert.match(settings, /border-radius: var\(--radius-pill\)/);
  const login = CSS.slice(CSS.indexOf('.pha-login {'), CSS.indexOf('.pha-login:hover'));
  assert.match(login, /height: 44px/);
  assert.match(login, /border: 1px solid var\(--border\)/);
  assert.match(login, /border-radius: var\(--radius-pill\)/);
  // Kleuren alleen via tokens.
  assert.doesNotMatch(CSS, /(?:color|background|border|fill|stroke)[\w-]*\s*:\s*#[0-9a-fA-F]{3,6}\b|rgba?\(|hsla?\(/);
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
