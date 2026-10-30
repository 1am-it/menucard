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
  assert.match(ROBOTS, /import \{ robotsMetadata \} from '@\/src\/lib\/seo'/);
  assert.match(ROBOTS, /import \{ siteUrl \} from '@\/src\/lib\/siteUrl'/);
  assert.match(ROBOTS, /export default function robots\(\)/);
  assert.match(ROBOTS, /return robotsMetadata\(\{ siteUrl: siteUrl\(\) \}\)/);
  assert.doesNotMatch(ROBOTS, DOMAIN);
  assert.doesNotMatch(ROBOTS, /disallow:\s*\[/, 'de uitsluitlijst staat in src/lib/seo.js, niet hier');
});

test('in de eigen productcode staat geen hardgecodeerd domein', () => {
  for (const file of ['src/lib/siteUrl.js', 'src/lib/seo.js', 'app/robots.js', 'app/layout.js']) {
    assert.doesNotMatch(read(file), DOMAIN, `${file} mag geen domein bevatten`);
  }
});
