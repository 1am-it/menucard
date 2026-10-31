'use strict';

// BE-55 (#135, herstel na review deel 2) — regressies voor de plek van het
// blok "Vandaag" en voor precies één "Bewaar" en één "Deel" per daghapkaart.
//
// Conventie van deze repo: fs.readFileSync + regex (er is geen rendered-DOM
// harness voor app/-pagina's, zie app/menu/[id]/MenuView.test.js). Het echte
// beeld bewijst ops/browser/run-be55-browser-check.js.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

const COMPONENT_PATH = 'src/components/DaghapVandaag.js';
const RESTAURANT_VIEW_PATH = 'app/restaurant/[id]/RestaurantDetailView.js';
const MENU_VIEW_PATH = 'app/menu/[id]/MenuView.js';
const SHARE_BUTTON_PATH = 'src/components/DishShareButton.js';

test('BE-55: een daghapkaart heeft precies één "Bewaar" en één "Deel"', () => {
  const component = read(COMPONENT_PATH);
  // De losse bewaarknop naast de deelknop gaf twee bladwijzers op de kaart.
  assert.equal((component.match(/<DishSaveButton/g) || []).length, 0, 'geen losse bewaarknop in de daghapkaart');
  assert.equal((component.match(/<DishShareButton/g) || []).length, 1, 'precies één deelknop per kaart');
  assert.match(component, /<DishShareButton[\s\S]*?entry=\{entry\}/, 'de deelknop krijgt de entry en rendert daaruit de bewaarknop');
  assert.doesNotMatch(component, /import DishSaveButton/, 'de bewaarknop komt niet meer apart binnen');
});

test('BE-55: "Bewaar" bestaat op de kaart doordat de deelknop hem zelf rendert', () => {
  const shareButton = read(SHARE_BUTTON_PATH);
  assert.equal((shareButton.match(/<DishSaveButton/g) || []).length, 1, 'de deelknop rendert de bewaarknop één keer');
  // BE-65 (#157) voegde een variant met het zichtbare woord "Delen" toe voor de
  // home en /search. De menukaart houdt de bestaande naam "Deel <gerecht>":
  // die tak staat letterlijk in dezelfde regel.
  assert.match(shareButton, /aria-label=\{withLabel \? `Delen: \$\{shareName\}` : `Deel \$\{shareName\}`\}/, '"Deel" heeft een duidelijke toegankelijke naam');
});

test('BE-55: de bewaarknop heeft een duidelijke toegankelijke naam', () => {
  const saveButton = read('src/components/DishSaveButton.js');
  assert.match(saveButton, /aria-label=\{`Bewaar \$\{saveName\}`\}/, '"Bewaar" is een zichtbare naam voor hulpsoftware');
});

test('BE-55: op /restaurant/[id] staat "Vandaag" in de kop, vóór de menuknoppen', () => {
  const view = read(RESTAURANT_VIEW_PATH);
  const occurrences = (view.match(/<DaghapVandaag/g) || []).length;
  assert.equal(occurrences, 1, 'het blok staat precies één keer op de restaurantpagina');

  const blockIndex = view.indexOf('<DaghapVandaag');
  const heroIndex = view.indexOf('<div className="detail-hero">');
  const mainIndex = view.indexOf('<main className="page-main page-with-tabbar">');
  const descIndex = view.indexOf('className="detail-desc"');
  const menuLinksIndex = view.indexOf('className="detail-menu-links"');

  assert.ok(heroIndex >= 0 && mainIndex > heroIndex, 'de hero staat vóór de hoofdsectie');
  assert.ok(blockIndex > heroIndex && blockIndex < mainIndex, 'het blok staat in de hero, niet onderaan de pagina');
  assert.ok(blockIndex > descIndex, 'het blok staat onder de beschrijving');
  assert.ok(blockIndex < menuLinksIndex, 'het blok staat vóór de menuknoppen');
});

test('BE-55: op /menu/[id] staat "Vandaag" boven de zoek- en filterbalk', () => {
  const view = read(MENU_VIEW_PATH);
  const occurrences = (view.match(/<DaghapVandaag/g) || []).length;
  assert.equal(occurrences, 1, 'het blok staat precies één keer op de menupagina');

  const blockIndex = view.indexOf('<DaghapVandaag');
  const filterIndex = view.indexOf('<div className="menu-filter-bar">');
  const headerIndex = view.indexOf('<header>');
  assert.ok(headerIndex >= 0 && filterIndex > headerIndex, 'de filterbalk volgt op de kop');
  assert.ok(blockIndex > headerIndex, 'het blok staat onder de kop');
  assert.ok(blockIndex < filterIndex, 'het blok staat boven de zoek- en filterbalk');
});

test('BE-55: de band van de menupagina heeft eigen opmaak buiten globals.css', () => {
  const css = read('src/components/daghap-vandaag.css');
  assert.match(css, /\.daghap-band\s*\{[\s\S]*?max-width: var\(--max-w\)/, 'de band volgt de paginabreedte via een token');
  assert.doesNotMatch(css, /:\s*#[0-9a-fA-F]{3,8}\b|:\s*rgba?\(|:\s*hsla?\(/, 'kleuren komen uit tokens, geen losse kleurwaarden');
});

test("BE-67: het blok Vandaag toont een dagmenu per gang, met beide prijzen", () => {
  const component = read(COMPONENT_PATH);
  // De gangen als regels Voor / Hoofd / Na, met het hoofdgerecht vet (css).
  assert.match(component, /GANG_KORT\[gang\.gang\]/, "de korte gangnaam komt uit de lib");
  assert.match(component, /className={`daghap-vandaag-gang daghap-vandaag-gang--\$\{gang\.gang\}`}/,
    "elke gang heeft een eigen regel");
  assert.match(component, /FORM_MESSAGES\.prijs2Chip/, "de chip 2 gangen staat er");
  assert.match(component, /FORM_MESSAGES\.prijs3Chip/, "de chip 3 gangen staat er");
  assert.match(component, /herhaalKort\(/, "het label elke di en do komt uit de lib");
  // Op = op: grijs, doorgestreept en met de badge; het blijft in de lijst staan.
  assert.match(component, /daghap-vandaag-card--uitverkocht/);
  assert.match(component, /daghap-vandaag-name--uitverkocht/);
  assert.match(component, /FORM_MESSAGES\.uitverkochtBadge/);
  const css = read("src/components/daghap-vandaag.css");
  assert.match(css, /\.daghap-vandaag-name--uitverkocht \{[^}]*line-through/s, "de naam is doorgestreept");
  assert.match(css, /\.daghap-vandaag-gang--hoofd \.daghap-vandaag-gang-naam \{[^}]*font-weight: 600/s,
    "het hoofdgerecht is vet");
});

test("BE-67: het houderoverzicht heeft Op = op en de drie cijfers", () => {
  const view = read("app/mijn-restaurant/aanbod/AanbodView.js");
  assert.match(view, /onClick=\{\(\) => zetUitverkocht\(item, !uitverkocht\)\}/, "de knop wisselt tussen Op = op en Toch weer beschikbaar");
  assert.match(view, /FORM_MESSAGES\.opIsOpWeer : FORM_MESSAGES\.opIsOpKnop/);
  assert.match(view, /\/uitverkocht`, \{/, "de knop praat met de eigen route");
  assert.match(view, /FORM_MESSAGES\.uitverkochtLabel/, "het label Uitverkocht staat er");
  assert.match(view, /item\.cijfers\.bekekenTekst/);
  assert.match(view, /item\.cijfers\.bewaardTekst/);
  assert.match(view, /item\.cijfers\.gedeeldTekst/);
});
