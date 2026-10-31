'use strict';

// BE-59 (#146, punt 3) — de footerlinks onderaan de publieke pagina's, en de
// pagina's waar ze heen gaan. BE-64 (#156, punt 5) splitst de oude link
// "Voor restaurants · Inloggen": "Voor restaurants" gaat naar
// /voor-restaurants, "Inloggen" blijft de ene ingang.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

// De publieke pagina's: precies de koppen waar ook het accountmenu staat.
const PUBLIC_PAGES = [
  'app/HomeView.js',
  'app/search/page.js',
  'app/alle-restaurants/page.js',
  'app/restaurant/[id]/RestaurantDetailView.js',
  'app/menu/[id]/MenuView.js',
  'app/mijn-lijstje/MijnLijstjeView.js',
  // BE-64 (#156): de pagina voor restaurants heeft dezelfde kop en footer.
  'app/voor-restaurants/page.js',
];

test('de footer toont "Voor restaurants", "Inloggen", "Privacy" en "Colofon", elk naar de eigen pagina', () => {
  const source = read('src/components/PublicFooter.js');
  const { LOGIN_PAGE_HREF } = require('../lib/loginEntry');
  const { FOR_RESTAURANTS_HREF } = require('../lib/forRestaurantsCopy');
  // BE-69 (#172, uitkomst 3): de twee tekstpagina's staan er ook in.
  const { PRIVACY_HREF, COLOFON_HREF } = require('../lib/legalCopy');
  assert.equal(LOGIN_PAGE_HREF, '/inloggen');
  assert.equal(FOR_RESTAURANTS_HREF, '/voor-restaurants');
  assert.equal(PRIVACY_HREF, '/privacy');
  assert.equal(COLOFON_HREF, '/colofon');
  assert.match(source, /const LOGIN_HREF = '\/inloggen'/, 'dezelfde bestemming als de ene ingang');
  assert.match(source, /const RESTAURANTS_HREF = '\/voor-restaurants'/, 'de eigen pagina voor restaurants');
  assert.match(source, /const PRIVACY_HREF = '\/privacy'/, 'de privacyverklaring');
  assert.match(source, /const COLOFON_HREF = '\/colofon'/, 'het colofon');
  assert.match(source, /href=\{RESTAURANTS_HREF\} prefetch=\{false\}>\s*Voor restaurants\s*<\/Link>/);
  assert.match(source, /href=\{LOGIN_HREF\} prefetch=\{false\}>\s*Inloggen\s*<\/Link>/);
  assert.match(source, /href=\{PRIVACY_HREF\} prefetch=\{false\}>\s*Privacy\s*<\/Link>/);
  assert.match(source, /href=\{COLOFON_HREF\} prefetch=\{false\}>\s*Colofon\s*<\/Link>/);
  assert.match(source, /className="public-footer-sep" aria-hidden="true"/, 'het scheidingsteken leest niet voor');
  assert.match(source, /^import '\.\/public-footer\.css'$/m);
  assert.ok(fs.existsSync(path.join(ROOT, 'src/components/public-footer.css')));
});

test('de footerlinks laden de twee routes niet vooruit (gemeten eerste laadgrootte)', () => {
  // BE-59 deel 3 (#146): zonder prefetch={false} haalde Next.js de route
  // /inloggen al op zodra de link bij het venster kwam: +6,8 KB op / en +6,1 KB
  // op /search in ops/browser/run-be59-load-size-check.js. Voor
  // /voor-restaurants geldt hetzelfde (BE-64).
  const source = read('src/components/PublicFooter.js');
  const links = source.match(/<Link\b[^>]*>/g) || [];
  assert.equal(links.length, 4, 'vier footerlinks');
  for (const link of links) {
    assert.match(link, /prefetch=\{false\}/, `${link} laadt niet vooruit`);
  }
});

test('de footer heeft geen sessiecheck nodig: geen Supabase, geen opslag, geen verzoek', () => {
  const source = read('src/components/PublicFooter.js');
  const imports = source.match(/^import .+$/gm) || [];
  assert.deepEqual(
    imports.map((line) => line.trim()),
    ["import Link from 'next/link'", "import './public-footer.css'"],
    'alleen next/link en de eigen CSS: niets extra in de eerste lading',
  );
  assert.doesNotMatch(source, /supabase|fetch\(|localStorage|useEffect/i);
});

test('elke publieke pagina met een kop toont de footer', () => {
  for (const file of PUBLIC_PAGES) {
    const source = read(file);
    assert.match(source, /import PublicFooter from '@\/src\/components\/PublicFooter'/, `${file} importeert de footer`);
    assert.match(source, /<PublicFooter \/>/, `${file} toont de footer`);
  }
});

test('de footer staat in de DOM na de inhoud (na </main>)', () => {
  for (const file of PUBLIC_PAGES) {
    const source = read(file);
    const main = source.lastIndexOf('</main>');
    const footer = source.indexOf('<PublicFooter />');
    assert.ok(main > 0 && footer > main, `${file} zet de footer onder de inhoud`);
  }
});

test('de opmaak gebruikt alleen tokens, met een tikvlak van 44 px', () => {
  const css = read('src/components/public-footer.css');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rules, /\b(rgb|rgba|hsl|hsla)\(/);
  assert.match(rules, /\.public-footer-link \{[^}]*min-height: 44px;/);
});


test('de twee tekstpagina\'s van BE-69 tonen dezelfde footer', () => {
  const legal = read('src/components/LegalDocument.js');
  assert.match(legal, /import PublicFooter from '@\/src\/components\/PublicFooter'/);
  const main = legal.lastIndexOf('</main>');
  const footer = legal.indexOf('<PublicFooter />');
  assert.ok(main > 0 && footer > main, 'de footer staat onder de inhoud');
  for (const page of ['app/privacy/page.js', 'app/colofon/page.js']) {
    assert.match(read(page), /import LegalDocument from '@\/src\/components\/LegalDocument'/, `${page} gebruikt de gedeelde vorm`);
  }
});
