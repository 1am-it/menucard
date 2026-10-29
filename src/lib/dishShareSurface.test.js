'use strict';

// BE-44 (#105) — de bedrading van het delen, als oppervlaktetest.
//
// Zelfde conventie als src/lib/be42PriceSurface.test.js en publicStyle.test.js:
// het bronbestand lezen met fs + regex, geen gerenderde DOM-harness en geen
// tweede implementatie van dezelfde regel. De rekenregels zelf (payload, URL,
// metadata, kleuren, klembord) staan in dishShare.test.js en shareTheme.test.js;
// hier gaat het om de vraag of de pagina's en componenten ze ook echt gebruiken.
//
// Wat deze test bewijst:
//   - /menu/<id> heeft generateMetadata en houdt zonder gerecht-deeplink de
//     algemene metadata (lege bijdrage, dus app/layout.js blijft geldig);
//   - de gerechtkaart toont "Delen" onder de beschrijving en niet naast de prijs;
//   - de knop geeft alleen `{ url, title }` door, met een `role="status"`-melding
//     en een aanraakvlak van minstens 44 px;
//   - het Publicatievoorbeeld (StaticMenu) krijgt geen deelknop;
//   - de ontvanger ziet "Iemand deelde dit gerecht met je";
//   - er is een og:image-route met ImageResponse van 1200 × 630, zonder foto;
//   - er is een apple-touch-icon van 180 × 180 met het bestaande beeldmerk.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const MENU_PAGE = read('app/menu/[id]/page.js');
const MENU_VIEW = read('app/menu/[id]/MenuView.js');
const MENU_BODY = read('src/components/MenuBody.js');
const SHARE_BUTTON = read('src/components/DishShareButton.js');
const SHARE_IMAGE = read('app/menu/[id]/share-image/route.js');
const APPLE_ICON = read('app/apple-icon.js');
const LAYOUT = read('app/layout.js');
const CSS = read('app/globals.css');

function cssBlock(selector) {
  const start = CSS.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} staat niet in app/globals.css`);
  const open = CSS.indexOf('{', start);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

test('/menu/<id> heeft generateMetadata en houdt zonder gerecht-deeplink de algemene metadata', () => {
  assert.match(MENU_PAGE, /export async function generateMetadata\(/);
  // Zonder (geldige) deeplink doet deze pagina niets aan metadata: {} betekent
  // dat de algemene metadata uit app/layout.js blijft staan.
  assert.match(MENU_PAGE, /if \(!r\) return \{\}/);
  assert.match(MENU_PAGE, /if \(!target\) return \{\}/);
  assert.doesNotMatch(MENU_PAGE, /openGraph:\s*\{/);
  // De algemene metadata is niet aangeraakt.
  assert.match(LAYOUT, /export const metadata = \{/);
  assert.match(LAYOUT, /title: 'BredaEats — Zie de menukaart vóór je reserveert'/);
});
test('/menu/<id> gebruikt de ene deelbouwer voor link, metadata en og:image', () => {
  for (const helper of ['dishShareHref', 'dishShareMetadata', 'dishSharePrice', 'shareImageHref', 'siteBaseUrl']) {
    assert.match(MENU_PAGE, new RegExp(`\\b${helper}\\b`), `${helper} moet in de metadata gebruikt worden`);
  }
  assert.match(MENU_PAGE, /resolveDishTarget\(query\.dish, query\.name, query\.cat, id, r\.categories\)/);
  assert.match(MENU_PAGE, /process\.env\.NEXT_PUBLIC_SITE_URL/);
  assert.match(MENU_PAGE, /headerList\.get\('host'\)/);
});

test('de gerechtkaart toont "Delen" en "Bewaren" onder de beschrijving en niet naast de prijs', () => {
  const desc = MENU_BODY.indexOf('{item.desc && (');
  const share = MENU_BODY.indexOf('<DishShareButton');
  const supplement = MENU_BODY.indexOf('{item.sup');
  assert.ok(desc > -1 && share > -1 && supplement > -1);
  assert.ok(share > desc, 'de deel- en bewaarknoppen staan onder de beschrijving');
  assert.ok(share < supplement, 'de knoppen staan vóór de supplementen, niet in de prijsregel');
  const cardTop = MENU_BODY.slice(MENU_BODY.indexOf('<div className="card-top">'), desc);
  assert.doesNotMatch(cardTop, /DishShareButton|DishSaveButton/, 'de knoppen staan niet in de regel met de prijs');
  // BE-44 criterium 4: dezelfde regel geeft de bewaarplek mee aan de knop.
  assert.match(MENU_BODY, /\{\(shareHref \|\| saveEntry\) && \(/);
  assert.match(MENU_BODY, /entry=\{saveEntry\}/);
});

test('alleen de publieke menukaart geeft een deellink mee; het Publicatievoorbeeld niet', () => {
  assert.match(MENU_VIEW, /shareHref=\{shareHref\}/);
  assert.match(MENU_VIEW, /shareTitle=\{dishShareTitle\(/);
  assert.match(MENU_VIEW, /shareNote=\{isResolvedTarget && hasShareTheme\(standParam\)\}/);
  assert.match(MENU_VIEW, /buildDishDeepLink\(\{/);
  // StaticMenu (Publicatievoorbeeld) rendert MenuItem zonder de deelprops.
  const staticMenu = MENU_BODY.slice(MENU_BODY.indexOf('export function StaticMenu'));
  assert.doesNotMatch(staticMenu, /shareHref|DishShareButton/);
});

test('de ontvanger ziet de regel "Iemand deelde dit gerecht met je" bij de kaart', () => {
  assert.match(MENU_BODY, /shareNote && <div className="dish-share-note">\{SHARED_DISH_NOTE\}/);
  assert.match(MENU_BODY, /import \{ SHARED_DISH_NOTE \} from '@\/src\/lib\/dishShare'/);
  // De stand uit de link verandert het thema van de pagina niet: MenuView leest
  // hem alleen voor de deelregel, nooit voor data-theme of een filter.
  assert.doesNotMatch(MENU_VIEW, /setAttribute\('data-theme'/);
  assert.doesNotMatch(MENU_VIEW, /standParam[\s\S]{0,40}(setQuery|setExcludeAllergens|setDietTags|setMaxPrice)/);
});

test('de deelknop geeft alleen url en title door, met een statusmelding en 44 px tikvlak', () => {
  assert.match(SHARE_BUTTON, /buildSharePayload\(\{ title, url \}\)/);
  assert.doesNotMatch(SHARE_BUTTON, /\btext:\s/, 'er gaat geen berichttekst mee');
  assert.doesNotMatch(SHARE_BUTTON, /navigatorRef\.share\(\{[^}]*text/);
  assert.match(SHARE_BUTTON, /copyShareLink\(navigatorRef\.clipboard, url\)/);
  assert.match(SHARE_BUTTON, /role="status"/);
  assert.match(SHARE_BUTTON, /Delen/);
  const button = cssBlock('.dish-share-btn');
  assert.match(button, /min-height:\s*44px/);
  assert.match(button, /min-width:\s*44px/);
});

test('de voorvertoningsafbeelding is 1200 × 630, met next/og en zonder foto', () => {
  assert.match(SHARE_IMAGE, /import \{ ImageResponse \} from 'next\/og'/);
  assert.match(SHARE_IMAGE, /width: 1200, height: 630/);
  assert.match(SHARE_IMAGE, /shareThemeFor\(url\.searchParams\.get\('stand'\)\)/);
  assert.match(SHARE_IMAGE, /Cache-Control/);
  assert.doesNotMatch(SHARE_IMAGE, /<img|next\/image/);
});

test('het app-icoon is 180 × 180 met het bestaande "om"-beeldmerk', () => {
  assert.match(APPLE_ICON, /export const size = \{ width: 180, height: 180 \}/);
  assert.match(APPLE_ICON, /contentType = 'image\/png'/);
  assert.match(APPLE_ICON, /APP_ICON_SVG/);
});

