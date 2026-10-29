'use strict';

// BE-44 (#105, criterium 4) — de bedrading van bewaren en het lijstje.
//
// Zelfde conventie als dishShareSurface.test.js: het bronbestand lezen met fs +
// regex, geen gerenderde DOM-harness en geen tweede implementatie van dezelfde
// regel. De rekenregels zelf (id's, opslag, URL, limiet, teksten) staan in
// dishList.test.js; hier gaat het om de vraag of de pagina's en componenten ze
// ook echt gebruiken.
//
// Wat deze test bewijst:
//   - elke gerechtkaart op /menu/<id> heeft "Delen" én "Bewaren";
//   - de bewaarknop leest en schrijft via de lib (localStorage in try/catch),
//     toont "Bewaard" met aria-pressed en een gevulde bladwijzer;
//   - de onderbalk verschijnt alleen met iets bewaards en linkt naar het lijstje;
//   - /mijn-lijstje leest de id's van de server, toont "Gedeeld lijstje · <n>
//     gerechten", telt wat er mist en kan alles overnemen;
//   - de eigen lijst toont gerecht, restaurant en prijs, met verwijderen per
//     gerecht en "Lijstje delen" (alleen de link);
//   - de voorvertoning van het lijstje is 1200 × 630 met next/og, zonder foto.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const MENU_VIEW = read('app/menu/[id]/MenuView.js');
const MENU_BODY = read('src/components/MenuBody.js');
const SHARE_BUTTON = read('src/components/DishShareButton.js');
const SAVE_BUTTON = read('src/components/DishSaveButton.js');
const SAVED_BAR = read('src/components/SavedListBar.js');
const LIST_SHARE_BUTTON = read('src/components/ListShareButton.js');
const LIST_PAGE = read('app/mijn-lijstje/page.js');
const LIST_VIEW = read('app/mijn-lijstje/MijnLijstjeView.js');
const LIST_IMAGE = read('app/mijn-lijstje/share-image/route.js');
const CSS = read('app/globals.css');

function cssBlock(selector) {
  const start = CSS.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} staat niet in app/globals.css`);
  const open = CSS.indexOf('{', start);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

test('elke gerechtkaart op de menupagina krijgt "Delen" én "Bewaren"', () => {
  assert.match(MENU_VIEW, /import \{ buildEntry \} from '@\/src\/lib\/dishList'/);
  assert.match(MENU_VIEW, /const saveEntry = /);
  assert.match(MENU_VIEW, /buildEntry\(\{/);
  assert.match(MENU_VIEW, /saveEntry=\{saveEntry\}/);
  // De bewaarplek hoort bij dezelfde kaart als de deellink, niet bij een
  // tweede, zelfgemaakte lijst.
  const shareHref = MENU_VIEW.indexOf('const shareHref = ');
  const saveEntry = MENU_VIEW.indexOf('const saveEntry = ');
  assert.ok(shareHref > -1 && saveEntry > shareHref, 'saveEntry volgt op shareHref');
  assert.match(MENU_BODY, /<DishShareButton href=\{shareHref\} title=\{shareTitle\} entry=\{saveEntry\} \/>/);
});

test('de bewaarknop leest en schrijft via de lib en toont "Bewaard" met aria-pressed', () => {
  assert.match(SAVE_BUTTON, /import \{[^}]*SAVED_LABEL[^}]*SAVE_LABEL[^}]*\} from '@\/src\/lib\/dishList'/s);
  assert.match(SAVE_BUTTON, /safeBrowserStorage\(\)/);
  assert.match(SAVE_BUTTON, /toggleSavedDish\(safeBrowserStorage\(\), entry\)/);
  assert.match(SAVE_BUTTON, /aria-pressed=\{saved\}/);
  assert.match(SAVE_BUTTON, /\{saved \? SAVED_LABEL : SAVE_LABEL\}/);
  assert.match(SAVE_BUTTON, /fill=\{saved \? 'currentColor' : 'none'\}/, 'de bladwijzer is gevuld zodra hij aanstaat');
  assert.match(SAVE_BUTTON, /SAVED_LIST_EVENT/);
  // De pagina werkt ook als opslag niet kan: er is geen try/catch meer nodig op
  // de plek van de klik, want de lib vangt elke fout.
  assert.doesNotMatch(SAVE_BUTTON, /localStorage\.setItem/);
});

test('de onderbalk verschijnt alleen met iets bewaards en linkt naar het lijstje', () => {
  assert.match(MENU_VIEW, /import SavedListBar from '@\/src\/components\/SavedListBar'/);
  assert.match(MENU_VIEW, /<SavedListBar \/>/);
  assert.match(SAVED_BAR, /if \(count === 0\) return null/);
  assert.match(SAVED_BAR, /readSavedList\(safeBrowserStorage\(\)\)\.length/);
  assert.match(SAVED_BAR, /href=\{LIST_PAGE\}/);
  assert.match(SAVED_BAR, /\{savedBarLabel\(count\)\}/);
  assert.match(SAVED_BAR, /\{VIEW_LIST_LABEL\}/);
  const bar = cssBlock('.saved-list-bar');
  assert.match(bar, /position: fixed/);
  assert.match(bar, /min-height: 48px/);
  // Op de telefoon staat de balk boven de zwevende menubalk.
  assert.match(CSS, /@media \(max-width: 720px\) \{\s*\.saved-list-bar \{ bottom: 84px; \}/);
});

test('de knoppen op de kaart en in het lijstje houden een tikvlak van 44 px', () => {
  for (const selector of ['.dish-save-btn', '.lijst-remove', '.lijst-primary-btn']) {
    const block = cssBlock(selector);
    assert.match(block, /min-height: 44px/, `${selector} heeft geen 44 px tikvlak`);
  }
  assert.match(cssBlock('.dish-save-btn'), /min-width: 44px/);
  assert.match(cssBlock('.lijst-remove'), /min-width: 44px/);
  // Beide knoppen van de lijstpagina gebruiken die ene primaire stijl.
  assert.match(LIST_VIEW, /className="lijst-primary-btn lijst-add-btn"/);
  assert.match(LIST_SHARE_BUTTON, /className="lijst-primary-btn lijst-share-btn"/);
});

test('de gedeelde lijst wordt op de server uit de echte menukaarten opgezocht', () => {
  assert.match(LIST_PAGE, /export async function generateMetadata\(/);
  assert.match(LIST_PAGE, /import menusData from '@\/data\/menus\.json'/);
  assert.match(LIST_PAGE, /decodeListParam\(query\.lijst\)/);
  assert.match(LIST_PAGE, /resolveListDishes\(\{/);
  assert.match(LIST_PAGE, /listShareMetadata\(\{/);
  assert.match(LIST_PAGE, /listShareHref\(\{ values, theme: stand \}\)/);
  assert.match(LIST_PAGE, /listShareImageHref\(\{ values, theme: stand \}\)/);
  // Zonder ?lijst= blijft de algemene metadata staan.
  assert.match(LIST_PAGE, /if \(!shared \|\| dishes\.length === 0\) return \{\}/);
  // Geen opslag op de server: het lijstje bestaat alleen in de browser.
  assert.doesNotMatch(LIST_PAGE, /localStorage\./);
  assert.match(LIST_PAGE, /process\.env\.NEXT_PUBLIC_SITE_URL/);
});

test('de ontvanger ziet "Gedeeld lijstje · <n> gerechten", tikt elk gerecht aan en kan alles overnemen', () => {
  assert.match(LIST_VIEW, /sharedListHeading\(sharedDishes\.length\)/);
  assert.match(LIST_VIEW, /\{NOT_AVAILABLE_MESSAGE\}: \{skipped\}/);
  assert.match(LIST_VIEW, /const href = listDishHref\(entry, theme\) \|\| `\/menu\/\$\{entry\.menuId\}`/);
  assert.match(LIST_VIEW, /\{ADD_TO_OWN_LIST_LABEL\}/);
  assert.match(LIST_VIEW, /addSavedDishes\(safeBrowserStorage\(\), sharedDishes\)/);
  assert.match(LIST_VIEW, /role="status"/);
});

test('het eigen lijstje toont gerecht, restaurant en prijs, met verwijderen en "Lijstje delen"', () => {
  assert.match(LIST_VIEW, /readSavedList\(safeBrowserStorage\(\)\)/);
  for (const field of ['entry.name', 'entry.restaurant', 'entry.price']) {
    assert.ok(LIST_VIEW.includes(`{${field}}`), `${field} staat niet op de lijstpagina`);
  }
  assert.match(LIST_VIEW, /onClick=\{\(\) => onRemove\(entry\)\}/);
  assert.match(LIST_VIEW, /aria-label=\{`\$\{REMOVE_LABEL\}: \$\{entry\.name\}`\}/);
  assert.match(LIST_VIEW, /<ListShareButton/);
  assert.match(LIST_VIEW, /listShareHref\(\{ values: own \}\)/);
  // Delen gaat via dezelfde lib als één gerecht: alleen de link.
  assert.match(LIST_SHARE_BUTTON, /import \{ shareLink \} from '@\/src\/lib\/dishShare'/);
  assert.match(LIST_SHARE_BUTTON, /shareLink\(\{/);
  assert.match(LIST_SHARE_BUTTON, /role="status"/);
  assert.match(LIST_SHARE_BUTTON, /\{LIST_SHARE_LABEL\}/);
  assert.doesNotMatch(LIST_SHARE_BUTTON, /\btext:/);
});

test('de voorvertoning van het lijstje is 1200 × 630 met next/og, zonder foto', () => {
  assert.match(LIST_IMAGE, /import \{ ImageResponse \} from 'next\/og'/);
  assert.match(LIST_IMAGE, /width: 1200, height: 630/);
  assert.match(LIST_IMAGE, /import ShareCard from '@\/app\/_share\/ShareCard'/);
  assert.match(LIST_IMAGE, /loadShareBoldFonts\(\)/);
  assert.match(LIST_IMAGE, /shareThemeFor\(url\.searchParams\.get\('stand'\)\)/);
  assert.match(LIST_IMAGE, /listImageTitle\(dishes\.length\)/);
  assert.match(LIST_IMAGE, /listImageRows\(dishes\)/);
  assert.match(LIST_IMAGE, /oneLineDescription\(entry\.name/);
  assert.match(LIST_IMAGE, /oneLineDescription\(entry\.restaurant/);
  assert.match(LIST_IMAGE, /entry\.price/);
  assert.match(LIST_IMAGE, /Cache-Control/);
  assert.doesNotMatch(LIST_IMAGE, /<img|next\/image/);
});
