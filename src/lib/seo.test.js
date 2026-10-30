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
} = require('./seo');

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

test('de publieke lijst is de home plus de lijstpagina, zonder privépaden', () => {
  assert.deepEqual(PUBLIC_PATHS, ['/', '/alle-restaurants']);
  for (const path of PUBLIC_PATHS) assert.equal(isPrivatePath(path), false);
});
