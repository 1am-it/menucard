'use strict';

// BE-68 (#168) — het QR-kaartje op bronniveau: de route, de toegang, de
// dynamische QR-bibliotheek, de eigen opmaak en de printmaten. De beslissingen
// zelf (URL, tekst, maten, toegang) staan in qrKaartje.test.js.
//
// De belangrijkste grens van dit ticket: `qrcode-generator` mag alleen op
// /mijn-restaurant/qr geladen worden. De eerste lading van de publieke pagina's
// groeit dus niet. Dat controleren we hier op de bron (één bestand importeert de
// bibliotheek, dynamisch) én, als er een build staat, in de chunks van de
// publieke routes zelf.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const PAGE = read('app/mijn-restaurant/qr/page.js');
const VIEW = read('app/mijn-restaurant/qr/QrKaartje.js');
const QR_CODE = read('app/mijn-restaurant/qr/QrCode.js');
const CSS = read('app/mijn-restaurant/qr/qr-kaartje.css');
const DASHBOARD = read('app/mijn-restaurant/OwnerDashboard.js');
const LAYOUT = read('app/mijn-restaurant/layout.js');
const GLOBALS = read('app/globals.css');

const cssZonderCommentaar = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test('BE-68: /mijn-restaurant/qr is er, met de vaste teksten uit het contract', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app/mijn-restaurant/qr/page.js')));
  assert.match(PAGE, /buildOwnerRestaurantIndex\(restaurantsData, menusData\)/);
  assert.match(PAGE, /siteUrl=\{process\.env\.NEXT_PUBLIC_SITE_URL \|\| ''\}/);
  assert.match(PAGE, /siteIndexable=\{process\.env\.NEXT_PUBLIC_SITE_INDEXABLE \|\| ''\}/);
  // De teksten staan in de lib, niet in de pagina: één bron voor de zin.
  assert.match(VIEW, /QR_MESSAGES\.title/);
  assert.match(VIEW, /QR_MESSAGES\.intro/);
  // De pagina is persoonlijk: /mijn-restaurant zet al noindex voor deze route.
  assert.match(LAYOUT, /robots: \{ index: false, follow: false \}/);
});

test('BE-68: alleen de eigen houder komt op de pagina', () => {
  // Sessie ophalen zoals op /mijn-restaurant/aanbod, en zonder sessie naar de
  // houder-login.
  assert.match(VIEW, /getSupabaseBrowser\(\)/);
  assert.match(VIEW, /\.auth\.getSession\(\)/);
  assert.match(VIEW, /router\.replace\(LOGIN_HREF\)/);
  assert.match(VIEW, /const LOGIN_HREF = '\/mijn-restaurant\/inloggen'/);
  // De rollen komen uit de bestaande route en gaan door dezelfde toegangsregel.
  assert.match(VIEW, /fetch\('\/api\/internal\/v1\/me'/);
  assert.match(VIEW, /eigenRestaurants\(\{ roles: body\.roles, restaurantIndex \}\)/);
  assert.match(VIEW, /kiesRestaurant\(\{/);
  // Geen eigen restaurant → de eerlijke melding, geen kaartje van iemand anders.
  assert.match(VIEW, /restaurants\.length === 0/);
  assert.match(VIEW, /QR_MESSAGES\.noRestaurant/);
  // Zonder URL (geen basis) wordt de deelknop niet actief.
  assert.match(VIEW, /disabled=\{bezig \|\| !url\}/);
});

test('BE-68: de navigatie in Mijn restaurant heeft het item QR-kaartje', () => {
  assert.match(DASHBOARD, /const QR_KAARTJE_HREF = '\/mijn-restaurant\/qr'/);
  assert.match(DASHBOARD, /const QR_KAARTJE_LINK_LABEL = 'QR-kaartje'/);
  // Alleen bij een eigen restaurant: `ownedIds` komt uit de rollen van de houder.
  assert.match(
    DASHBOARD,
    /restaurant\.known && ownedIds\.includes\(restaurant\.id\) && \(\s*<Link className="owner-link" href=\{QR_KAARTJE_HREF\}>/,
  );
});

/** Alle .js-bestanden onder app/ en src/, zonder tests (zelfde wandeling als
 * app/globals-css.test.js, zodat een nieuw bestand meetelt vóór de commit). */
function jsBestanden() {
  const gevonden = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
        gevonden.push(path.relative(ROOT, full).replace(/\\/g, '/'));
      }
    }
  };
  for (const root of ['app', 'src']) walk(path.join(ROOT, root));
  return gevonden;
}

test('BE-68: qrcode-generator wordt alleen dynamisch op deze pagina geladen', () => {
  const bestanden = jsBestanden();
  assert.ok(bestanden.length > 100, 'de wandeling vindt de app');

  const statisch = bestanden.filter((file) => /^\s*import[^\n]*from 'qrcode-generator'/m.test(read(file)));
  assert.deepEqual(statisch, [], 'nergens een statische import');

  const dynamisch = bestanden.filter((file) => /import\('qrcode-generator'\)/.test(read(file)));
  assert.deepEqual(dynamisch, ['app/mijn-restaurant/qr/QrCode.js']);
  // En QrCode.js wordt alleen door deze pagina gebruikt.
  const gebruikers = bestanden.filter((file) => /from '\.\/QrCode'/.test(read(file)));
  assert.deepEqual(gebruikers, ['app/mijn-restaurant/qr/QrKaartje.js']);
  // De eerste lading van de publieke pagina's raakt dit niet.
  for (const publiek of ['app/page.js', 'app/layout.js', 'app/menu/[id]/page.js', 'src/components/MenuBody.js']) {
    if (!fs.existsSync(path.join(ROOT, publiek))) continue;
    assert.doesNotMatch(read(publiek), /qrcode-generator|qr\/QrCode/, `${publiek} laadt de QR-bibliotheek niet`);
  }
});

test('BE-68: geen tweede nieuwe dependency', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['qrcode-generator'], '1.5.0');
  const verwacht = [
    '@anthropic-ai/sdk',
    '@supabase/supabase-js',
    'next',
    'pdfjs-dist',
    'qrcode-generator',
    'react',
    'react-dom',
  ];
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), verwacht);
});

test('BE-68: eigen opmaak met tokens, het kaartje altijd papier', () => {
  assert.match(VIEW, /import '\.\/qr-kaartje\.css'/);
  assert.match(VIEW, /import '\.\.\/mijn-restaurant\.css'/);
  // Niets van dit ticket staat in het gedeelde basisbestand (BE-52).
  assert.equal(GLOBALS.includes('.qr-kaartje'), false);
  // Kleuren via tokens, behalve het papierblok van het kaartje zelf en het
  // printvel (dat is papier).
  const zonderPapier = cssZonderCommentaar
    .replace(/\.qr-kaartje-kaart \{[^}]*\}/, '')
    .replace(/html,\s*body \{[^}]*\}/, '');
  assert.doesNotMatch(zonderPapier, /#[0-9a-fA-F]{3,8}\b/, 'geen hardgecodeerde kleur buiten het papierblok');
  assert.doesNotMatch(zonderPapier, /rgba?\(/, 'geen hardgecodeerde kleur buiten het papierblok');
  assert.match(cssZonderCommentaar, /--papier: #FFFFFF/);
  assert.match(cssZonderCommentaar, /--papier-strook: #F2C35B/);
  // De gekozen keuzekaart krijgt de rand van 2 px uit het ontwerp.
  assert.match(cssZonderCommentaar, /\.qr-kaartje-doel\[data-actief='ja'\] \{[^}]*var\(--text-primary\)/);
  // De knoppen: geel met --accent-fill en een omlijnde tweede knop.
  assert.match(cssZonderCommentaar, /\.qr-kaartje-knop--primair \{[^}]*background: var\(--accent-fill\)/);
  assert.match(cssZonderCommentaar, /\.qr-kaartje-knop \{[^}]*border: 1px solid var\(--border-strong\)/);
});

test('BE-68: de QR-code is een SVG met foutcorrectie M en rustzone 4', () => {
  // De instellingen komen uit de lib, niet uit het component: één bron.
  assert.match(QR_CODE, /import \{ QR_FOUTCORRECTIE, QR_RUSTZONE \} from/);
  assert.match(QR_CODE, /maak\(0, QR_FOUTCORRECTIE\)/);
  assert.match(QR_CODE, /const totaal = matrix\.aantal \+ QR_RUSTZONE \* 2/);
  assert.match(QR_CODE, /viewBox=\{`0 0 \$\{totaal\} \$\{totaal\}`\}/);
  // Een QR-code is informatie: een toegankelijke naam, geen aria-hidden.
  assert.match(QR_CODE, /role="img"/);
  assert.match(QR_CODE, /aria-label=\{label\}/);
  // En geen eigen encoder: de matrix komt uit de bibliotheek.
  assert.doesNotMatch(QR_CODE, /function .*(galois|reed|solomon|maskPattern)/i);
});

test('BE-68: de printmaten zijn A6 en 4×A6 op A4', () => {
  assert.match(cssZonderCommentaar, /@media print \{/);
  assert.match(cssZonderCommentaar, /@page \{\s*size: 105mm 148mm;\s*margin: 0;/);
  // Het A4-vel heeft een eigen paginanaam met vier kaartjes in 2 × 2.
  assert.match(cssZonderCommentaar, /@page qr-a4 \{\s*size: A4 portrait;/);
  assert.match(
    cssZonderCommentaar,
    /\.qr-kaartje-afdruk\[data-formaat='a4'\] \{\s*page: qr-a4;\s*grid-template-columns: 1fr 1fr;/,
  );
  // Op het scherm bestaat het afdrukvel niet; bij printen is het het enige.
  assert.match(cssZonderCommentaar, /\.qr-kaartje-afdruk \{\s*display: none;/);
  assert.match(cssZonderCommentaar, /\.qr-kaartje-afdruk \{\s*display: grid !important;/);
  // De rest van de pagina gaat niet mee op papier.
  assert.match(cssZonderCommentaar, /body > \* \{\s*display: none !important;/);
  // Vier kaartjes voor een A4, één voor A6.
  assert.match(VIEW, /const aantalKaartjes = formaat === 'png' \? 1 : maat\.perPagina/);
});

test('BE-68: zonder build blijft de chunkcontrole over aan de buildronde', (t) => {
  // De broncontrole hierboven is de harde grens. Staat er een build, dan kijken
  // we ook echt in de chunks van de publieke routes: daar mag geen enkel spoor
  // van de QR-bibliotheek in zitten (marker `qr8BitByte` uit de bibliotheek).
  const manifestPad = path.join(ROOT, '.next', 'app-build-manifest.json');
  if (!fs.existsSync(manifestPad)) {
    t.skip('geen .next/app-build-manifest.json; de buildronde doet deze controle');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPad, 'utf8'));
  const publiek = ['/page', '/menu/[id]/page', '/restaurant/[id]/page', '/search/page', '/alle-restaurants/page'];
  const gezien = [];
  for (const route of publiek) {
    for (const bestand of manifest.pages[route] || []) {
      const chunk = path.join(ROOT, '.next', bestand);
      if (!fs.existsSync(chunk)) continue;
      gezien.push(bestand);
      const inhoud = fs.readFileSync(chunk, 'utf8');
      assert.equal(inhoud.includes('qr8BitByte'), false, `${bestand} bevat de QR-bibliotheek`);
    }
  }
  assert.ok(gezien.length > 0, 'de publieke routes hebben chunks');
});
