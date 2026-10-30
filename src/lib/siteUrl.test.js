'use strict';

// BE-56 (#137) — de centrale basis-URL, criterium 1 van de acceptatie:
// leeg, ongeldig, een slash aan het eind en http in plaats van https.
//
// De helper leest alleen de omgeving; deze tests geven daarom een eigen object
// mee in plaats van `process.env` te zetten. Zo raakt geen enkele test de echte
// omgeving en kunnen ze naast elkaar draaien.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  SITE_URL_ENV,
  absoluteSiteUrl,
  normalizeSiteUrl,
  siteUrl,
} = require('./siteUrl');

const env = (value) => ({ [SITE_URL_ENV]: value });

test('een lege of ontbrekende instelling geeft geen basis-URL', () => {
  assert.equal(siteUrl({}), '');
  assert.equal(siteUrl(), siteUrl(process.env), 'zonder argument leest hij process.env');
  assert.equal(siteUrl(env('')), '');
  assert.equal(siteUrl(env('   ')), '');
  assert.equal(siteUrl(env(undefined)), '');
  assert.equal(siteUrl(env(null)), '');
  assert.equal(siteUrl(null), '');
  assert.equal(normalizeSiteUrl(undefined), '');
  assert.equal(normalizeSiteUrl(''), '');
});

test('een ongeldige instelling geeft geen basis-URL in plaats van een gok', () => {
  assert.equal(siteUrl(env('onzemenukaarten.nl')), '');
  assert.equal(siteUrl(env('niet-een-url')), '');
  assert.equal(siteUrl(env('//onzemenukaarten.nl')), '');
  assert.equal(siteUrl(env('https://')), '');
  assert.equal(siteUrl(env('ftp://onzemenukaarten.nl')), '');
  assert.equal(siteUrl(env('javascript:alert(1)')), '');
  // Een pad, query of inloggegevens horen niet in een basis-URL.
  assert.equal(siteUrl(env('https://onzemenukaarten.nl/menu')), '');
  assert.equal(siteUrl(env('https://onzemenukaarten.nl/?x=1')), '');
  assert.equal(siteUrl(env('https://onzemenukaarten.nl/#top')), '');
  assert.equal(siteUrl(env('https://gebruiker:geheim@onzemenukaarten.nl')), '');
});

test('een slash aan het eind valt weg', () => {
  assert.equal(siteUrl(env('https://onzemenukaarten.nl/')), 'https://onzemenukaarten.nl');
  assert.equal(siteUrl(env('  https://onzemenukaarten.nl/  ')), 'https://onzemenukaarten.nl');
  assert.equal(siteUrl(env('https://onzemenukaarten.nl')), 'https://onzemenukaarten.nl');
  // Een dubbele slash is geen geldig adres (het is een pad, geen domein).
  assert.equal(siteUrl(env('https://onzemenukaarten.nl//')), '');
});

test('http in plaats van https is geen basis-URL', () => {
  assert.equal(siteUrl(env('http://onzemenukaarten.nl')), '');
  assert.equal(siteUrl(env('http://onzemenukaarten.nl/')), '');
  assert.equal(normalizeSiteUrl('http://localhost:3000'), '');
  // https op een andere poort blijft wel bruikbaar (lokale productiebouw).
  assert.equal(siteUrl(env('https://localhost:3000')), 'https://localhost:3000');
});

test('de hoofdletters en de poort van de host blijven kloppen', () => {
  assert.equal(siteUrl(env('HTTPS://OnzeMenukaarten.NL/')), 'https://onzemenukaarten.nl');
  assert.equal(siteUrl(env('https://onzemenukaarten.nl:8443')), 'https://onzemenukaarten.nl:8443');
});

test('een pad wordt alleen met een echte basis een absolute link', () => {
  assert.equal(absoluteSiteUrl('/menu/6-diner', env('https://onzemenukaarten.nl')), 'https://onzemenukaarten.nl/menu/6-diner');
  assert.equal(absoluteSiteUrl('/', env('https://onzemenukaarten.nl/')), 'https://onzemenukaarten.nl/');
  assert.equal(absoluteSiteUrl('robots.txt', env('https://onzemenukaarten.nl')), 'https://onzemenukaarten.nl/robots.txt');
  assert.equal(absoluteSiteUrl('/menu/6-diner', {}), null);
  assert.equal(absoluteSiteUrl('/menu/6-diner', env('http://onzemenukaarten.nl')), null);
});
