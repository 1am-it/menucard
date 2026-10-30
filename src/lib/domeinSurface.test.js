'use strict';

// BE-56 (#137) — de bedrading van het eigen domein, als oppervlaktetest.
//
// Zelfde conventie als dishShareSurface.test.js en be42PriceSurface.test.js: het
// bronbestand lezen met fs + regex, geen gerenderde DOM-harness en geen tweede
// implementatie van dezelfde regel. De regels zelf staan in siteUrl.test.js,
// seo.test.js en qrRoute.test.js; hier gaat het om de vraag of de app ze ook
// echt gebruikt en of er nergens een domein in de code staat.
//
// Wat deze test bewijst:
//   - app/layout.js zet metadataBase via siteUrl(), zonder eigen domein;
//   - app/robots.js is een dunne ingang op src/lib/seo.js (en de sitemap-regel
//     komt uit diezelfde module);
//   - in de productcode staat geen hardgecodeerd domein.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const LAYOUT = read('app/layout.js');
const ROBOTS = read('app/robots.js');
const SITEMAP = read('app/sitemap.js');
const QR_PAGE = read('app/r/[id]/page.js');

// De domeinen die in de code zouden kunnen opduiken. Ze mogen alleen in
// documentatie of in een test staan, nooit in de productcode.
const DOMAIN = /onzemenukaarten\.nl|menucard-kappa|vercel\.app/i;

test('app/layout.js zet metadataBase via siteUrl(), niet met een eigen domein', () => {
  assert.match(LAYOUT, /import \{ siteUrl \} from '@\/src\/lib\/siteUrl'/);
  assert.match(LAYOUT, /const SITE_URL = siteUrl\(\)/);
  assert.match(LAYOUT, /metadataBase: new URL\(SITE_URL\)/);
  assert.match(LAYOUT, /title: 'BredaEats — Zie de menukaart vóór je reserveert'/, 'de bestaande metadata blijft staan');
  assert.doesNotMatch(LAYOUT, DOMAIN);
});

test('app/robots.js is een dunne ingang op src/lib/seo.js en de siteUrl-helper', () => {
  assert.match(ROBOTS, /import \{ closedRobotsMetadata, isIndexable, robotsMetadata \} from '@\/src\/lib\/seo'/);
  assert.match(ROBOTS, /import \{ siteUrl \} from '@\/src\/lib\/siteUrl'/);
  assert.match(ROBOTS, /export default function robots\(\)/);
  assert.match(ROBOTS, /return robotsMetadata\(\{ siteUrl: siteUrl\(\) \}\)/);
  assert.doesNotMatch(ROBOTS, DOMAIN);
  assert.doesNotMatch(ROBOTS, /disallow:\s*\[/, 'de uitsluitlijst staat in src/lib/seo.js, niet hier');
});

test('app/sitemap.js is een dunne ingang op src/lib/seo.js met de statische gegevens', () => {
  assert.match(SITEMAP, /import \{ isIndexable, sitemapEntries \} from '@\/src\/lib\/seo'/);
  assert.match(SITEMAP, /import \{ siteUrl \} from '@\/src\/lib\/siteUrl'/);
  assert.match(SITEMAP, /import restaurantsData from '@\/data\/restaurants\.json'/);
  assert.match(SITEMAP, /import menusData from '@\/data\/menus\.json'/);
  assert.match(SITEMAP, /export default function sitemap\(\)/);
  assert.match(SITEMAP, /siteUrl: siteUrl\(\)/);
  assert.match(SITEMAP, /restaurants: Object\.keys\(restaurantsData\)/);
  assert.match(SITEMAP, /menus: Object\.keys\(menusData\)/);
  // Geen interne of persoonlijke pagina's en geen eigen padlijst: die staan in
  // src/lib/seo.js (getest in seo.test.js).
  assert.doesNotMatch(SITEMAP, /\/internal|\/api|\/mijn-restaurant|\/claim|\/kies|\/mijn-lijstje/);
  assert.doesNotMatch(SITEMAP, DOMAIN);
});

test('/r/[id] stuurt 307 door naar de restaurantpagina en geeft een onbekend id een 404', () => {
  assert.match(QR_PAGE, /import \{ notFound, redirect \} from 'next\/navigation'/);
  assert.match(QR_PAGE, /import \{ qrRestaurantTarget, restaurantHref \} from '@\/src\/lib\/qrRoute'/);
  assert.match(QR_PAGE, /import restaurantsData from '@\/data\/restaurants\.json'/);
  assert.match(QR_PAGE, /export const dynamic = 'force-dynamic'/, 'de doorverwijzing volgt altijd de actuele gegevens');
  assert.match(QR_PAGE, /const target = qrRestaurantTarget\(\{ id, restaurants: restaurantsData \}\)/);
  assert.match(QR_PAGE, /if \(!target\) notFound\(\)/);
  assert.match(QR_PAGE, /redirect\(restaurantHref\(target\)\)/);
  // 307, geen 308: het is een tijdelijke doorverwijzing zolang het adres kan
  // veranderen. `redirect()` doet dat standaard; een vaste code zou afwijken.
  assert.doesNotMatch(QR_PAGE, /permanent|statusCode: 30[18]/);
  assert.doesNotMatch(QR_PAGE, DOMAIN);
  assert.doesNotMatch(QR_PAGE, /href=|Nooit gevonden|Naar de home/, 'geen omleiding of link in plaats van de 404');
});

test('geen statische robots.txt of sitemap in public/ die de routes overschrijft', () => {
  // Next.js serveert een bestand uit public/ vóór dezelfde route. Een oude
  // public/robots.txt maakte app/robots.js dus onbereikbaar; dat is hier
  // bewezen met een echte `next build` + `next start` (zie de checkpoint).
  for (const file of ['public/robots.txt', 'public/sitemap.xml']) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), false, `${file} zou app/${path.basename(file).replace('.txt', '.js')} overschrijven`);
  }
});

test('in de eigen productcode staat geen hardgecodeerd domein', () => {
  for (const file of ['src/lib/siteUrl.js', 'src/lib/seo.js', 'src/lib/qrRoute.js', 'app/robots.js', 'app/sitemap.js', 'app/layout.js', 'app/r/[id]/page.js']) {
    assert.doesNotMatch(read(file), DOMAIN, `${file} mag geen domein bevatten`);
  }
});
