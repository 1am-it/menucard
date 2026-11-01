'use strict';

// BE-56 (#137) — robots.txt en de sitemap als rekenregels, zonder React.
//
// Criterium 2 van de acceptatie: de sitemap bevat geen interne paden. Hier
// staan de regels die app/robots.js en app/sitemap.js gebruiken; de bedrading
// van die twee bestanden zelf staat in src/lib/domeinSurface.test.js.
//
// De basis-URL komt van buiten. Zo bewijst elke test meteen de twee gevallen
// uit het contract: met een eigen domein en zonder.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  PRIVATE_PATHS,
  PUBLIC_PATHS,
  SITEMAP_PATH,
  absoluteHref,
  isPrivatePath,
  robotsMetadata,
  sitemapEntries,
} = require('./seo');

// De echte statische gegevens, net als app/sitemap.js ze aanlevert. Deze test
// controleert dus de werkelijke 25 restaurants en 11 menukaarten, geen fixture.
const RESTAURANTS = Object.keys(require('../../data/restaurants.json'));
const MENUS = Object.keys(require('../../data/menus.json'));

const SITE = 'https://onzemenukaarten.nl';

test('robots.txt staat de publieke pagina\'s toe en sluit de privépaden uit', () => {
  const robots = robotsMetadata({ siteUrl: SITE });
  assert.equal(robots.rules.userAgent, '*');
  assert.equal(robots.rules.allow, '/');
  assert.deepEqual(robots.rules.disallow, ['/internal', '/api', '/mijn-restaurant', '/claim', '/kies', '/mijn-lijstje']);
  for (const path of ['/internal', '/api', '/mijn-restaurant', '/claim', '/kies', '/mijn-lijstje']) {
    assert.ok(robots.rules.disallow.includes(path), `${path} moet uitgesloten zijn`);
  }
  // De publieke pagina's staan niet in de uitsluitlijst.
  for (const path of ['/', '/alle-restaurants', '/restaurant/6', '/menu/6-diner']) {
    assert.equal(robots.rules.disallow.includes(path), false);
  }
});

test('de sitemap-regel in robots.txt verschijnt alleen met een eigen domein', () => {
  assert.equal(robotsMetadata({ siteUrl: SITE }).sitemap, 'https://onzemenukaarten.nl/sitemap.xml');
  assert.equal(robotsMetadata({ siteUrl: 'https://onzemenukaarten.nl/' }).sitemap, 'https://onzemenukaarten.nl/sitemap.xml');
  // Geen (geldige) instelling: de regel valt weg, de rest blijft staan.
  assert.equal('sitemap' in robotsMetadata({ siteUrl: '' }), false);
  assert.equal('sitemap' in robotsMetadata({}), false);
  assert.equal('sitemap' in robotsMetadata({ siteUrl: 'http://onzemenukaarten.nl' }), false);
  assert.deepEqual(robotsMetadata({}).rules.disallow, robotsMetadata({ siteUrl: SITE }).rules.disallow);
});

test('de privépaden zijn met hun onderliggende paden herkenbaar', () => {
  for (const path of PRIVATE_PATHS) {
    assert.equal(isPrivatePath(path), true, `${path} is privé`);
    assert.equal(isPrivatePath(`${path}/extra`), true, `${path}/extra is privé`);
  }
  assert.equal(isPrivatePath('/alle-restaurants'), false);
  assert.equal(isPrivatePath('/restaurant/6'), false);
  assert.equal(isPrivatePath('/menu/6-diner'), false);
  assert.equal(isPrivatePath('/kiesjes'), false, 'alleen het pad zelf telt, geen voorvoegsel');
  assert.equal(isPrivatePath('/apiculture'), false);
  assert.equal(isPrivatePath(''), false);
});

test('een pad wordt alleen met een geldige https-basis een absolute link', () => {
  assert.equal(absoluteHref(SITE, SITEMAP_PATH), 'https://onzemenukaarten.nl/sitemap.xml');
  assert.equal(absoluteHref('https://onzemenukaarten.nl/', '/restaurant/6'), 'https://onzemenukaarten.nl/restaurant/6');
  assert.equal(absoluteHref('', '/sitemap.xml'), null);
  assert.equal(absoluteHref('http://onzemenukaarten.nl', '/sitemap.xml'), null);
});

test('de publieke lijst is de home, de lijstpagina en de twee tekstpagina\'s, zonder privépaden', () => {
  assert.deepEqual(PUBLIC_PATHS, ['/', '/alle-restaurants', '/privacy', '/colofon']);
  for (const path of PUBLIC_PATHS) assert.equal(isPrivatePath(path), false);
});

test('de sitemap bevat de home, de lijstpagina en elke echte restaurant- en menukaart', () => {
  const entries = sitemapEntries({ siteUrl: SITE, restaurants: RESTAURANTS, menus: MENUS });
  const urls = entries.map((entry) => entry.url);

  // BE-69 (#172): vier publieke pagina's zonder id, daarna de restaurants en de
  // menukaarten.
  assert.equal(entries.length, 4 + RESTAURANTS.length + MENUS.length, 'geen dubbele en geen ontbrekende pagina');
  assert.ok(urls.includes('https://onzemenukaarten.nl/'));
  assert.ok(urls.includes('https://onzemenukaarten.nl/alle-restaurants'));
  assert.ok(urls.includes('https://onzemenukaarten.nl/privacy'));
  assert.ok(urls.includes('https://onzemenukaarten.nl/colofon'));
  // De echte gegevens: elk restaurant en elke menukaart, met een id in het pad.
  for (const id of RESTAURANTS) {
    assert.ok(urls.includes(`https://onzemenukaarten.nl/restaurant/${id}`), `restaurant ${id} ontbreekt`);
  }
  for (const id of MENUS) {
    assert.ok(urls.includes(`https://onzemenukaarten.nl/menu/${id}`), `menukaart ${id} ontbreekt`);
  }
  assert.equal(RESTAURANTS.length, 25);
  // BE-71 ronde 3: de kaart van Restaurant Zenza (17-menukaart) is de veertiende.
  assert.equal(MENUS.length, 23);
  // Elke regel is een volledige https-URL op het eigen domein.
  for (const url of urls) assert.match(url, /^https:\/\/onzemenukaarten\.nl\//);
});

test('de sitemap bevat geen interne of persoonlijke paden', () => {
  const entries = sitemapEntries({ siteUrl: SITE, restaurants: RESTAURANTS, menus: MENUS });
  for (const entry of entries) {
    const path = entry.url.replace(SITE, '');
    assert.equal(isPrivatePath(path), false, `${path} hoort niet in de sitemap`);
    for (const prefix of ['/internal', '/api', '/mijn-restaurant', '/claim', '/kies', '/mijn-lijstje']) {
      assert.equal(path.startsWith(prefix), false, `${path} hoort niet in de sitemap`);
    }
    assert.doesNotMatch(entry.url, /[?#]/, 'geen query of fragment in de sitemap');
  }
  // Ook een bron die per ongeluk zo'n pad aanlevert, komt er niet in: een id met
  // een slash valt af, en een id dat een privépad zou opleveren ook.
  const leaky = sitemapEntries({
    siteUrl: SITE,
    restaurants: ['6', '/internal', 'mijn-restaurant'],
    menus: ['6-diner', 'kies', ''],
  });
  const leakyPaths = leaky.map((entry) => entry.url.replace(SITE, ''));
  assert.deepEqual(leakyPaths.filter((path) => PRIVATE_PATHS.some((prefix) => path.startsWith(prefix))), []);
  assert.ok(leakyPaths.includes('/restaurant/6'));
  assert.ok(leakyPaths.includes('/menu/6-diner'));
  assert.equal(leakyPaths.includes('/menu/'), false, 'een lege id levert geen pad op');
});

test('zonder eigen domein is de sitemap leeg', () => {
  assert.deepEqual(sitemapEntries({ siteUrl: '', restaurants: RESTAURANTS, menus: MENUS }), []);
  assert.deepEqual(sitemapEntries({ restaurants: RESTAURANTS, menus: MENUS }), []);
  assert.deepEqual(sitemapEntries({ siteUrl: 'http://onzemenukaarten.nl', restaurants: RESTAURANTS, menus: MENUS }), []);
  assert.deepEqual(sitemapEntries({ siteUrl: 'niet-een-url', restaurants: RESTAURANTS, menus: MENUS }), []);
  assert.deepEqual(sitemapEntries(), []);
});

test('niet publiek: alleen NEXT_PUBLIC_SITE_INDEXABLE "true" opent robots en sitemap', () => {
  const { isIndexable, closedRobotsMetadata } = require('./seo');
  assert.equal(isIndexable('true'), true);
  for (const value of [undefined, null, '', 'false', '1', 'yes']) assert.equal(isIndexable(value), false, String(value));
  assert.deepEqual(closedRobotsMetadata(), { rules: { userAgent: '*', disallow: '/' } });
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', '..');
  assert.match(fs.readFileSync(path.join(root, 'app', 'robots.js'), 'utf8'), /isIndexable\(process\.env\.NEXT_PUBLIC_SITE_INDEXABLE\)\) return closedRobotsMetadata\(\)/);
  assert.match(fs.readFileSync(path.join(root, 'app', 'sitemap.js'), 'utf8'), /isIndexable\(process\.env\.NEXT_PUBLIC_SITE_INDEXABLE\)\) return \[\]/);
});
