'use strict';

// BE-44 (#105) — de deelgegevens van één gerecht, tegen echte projectdata.
// Geen mocks: dezelfde restaurants/menukaarten die de app toont.
//
// De load-bearing punten uit het contract (criterium 1, 2 en 3):
// - de payload voor het systeemdeelmenu is alleen `url` en `title`, nooit
//   `text` (eigenaarsbesluit 28 oktober);
// - de link is de bestaande BE-12-deeplink, met alleen de stand erbij;
// - de stand verandert niets aan de link behalve de voorvertoningskleur;
// - og:title is "<gerecht> · <prijs>", ook als de bron geen prijs heeft;
// - og:description noemt restaurant, adres en één regel beschrijving;
// - een ongeldige of onvolledige link levert geen payload en geen metadata op;
// - het klembord-alternatief meldt alleen "Link gekopieerd" als het echt lukte.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const menusData = require('../../data/menus.json');
const restaurantsData = require('../../data/restaurants.json');
const { resolveDishTarget } = require('./dishDeepLink');
const {
  COPIED_MESSAGE,
  SHARE_THEME_PARAM,
  buildSharePayload,
  copyShareLink,
  dishShareHref,
  dishShareMetadata,
  dishSharePrice,
  dishShareTitle,
  dishShareUrl,
  hasShareTheme,
  normalizeShareTheme,
  oneLineDescription,
  shareImageHref,
  shareOgDescription,
  shareTarget,
  shareThemeFromAttribute,
  siteBaseUrl,
  withShareTheme,
} = require('./dishShare');

// De echte fixture: "Poussin" (€20,95) uit de dinerkaart van restaurant 6.
const menu = menusData['6-diner'];
const restaurant = restaurantsData['6'];
const dish = menu.categories[0].items[0];
const dishId = '6-diner-0-0';
test('de deelpayload is alleen url en title — geen text, geen andere velden', () => {
  const payload = buildSharePayload({ title: 'Poussin · Brasserie Bardot', url: 'https://onzemenukaarten.nl/menu/6-diner?dish=6-diner-0-0' });
  assert.deepEqual(Object.keys(payload), ['url', 'title']);
  assert.equal('text' in payload, false);
  assert.match(payload.url, /^https:\/\/onzemenukaarten\.nl\/menu\/6-diner\?dish=6-diner-0-0$/);
});

test('zonder URL is er geen payload; zonder title blijven url en geen lege title over', () => {
  assert.equal(buildSharePayload({ title: 'Poussin', url: '' }), null);
  assert.equal(buildSharePayload({ title: 'Poussin' }), null);
  assert.deepEqual(buildSharePayload({ url: 'https://example.org/menu/6-diner' }), { url: 'https://example.org/menu/6-diner' });
});

test('de deellink is de bestaande BE-12-deeplink met alleen de stand erbij', () => {
  const href = dishShareHref({ menuLink: '/menu/6-diner', dishId, name: dish.name, category: menu.categories[0].name, theme: 'donker' });
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('dish'), dishId);
  assert.equal(params.get('name'), dish.name);
  assert.equal(params.get('cat'), menu.categories[0].name);
  assert.equal(params.get(SHARE_THEME_PARAM), 'donker');
  assert.equal(params.has('text'), false);
  assert.equal(params.has('fromQuery'), false);
  // En de ontvanger valt er precies op terug.
  assert.deepEqual(
    resolveDishTarget(params.get('dish'), params.get('name'), params.get('cat'), '6-diner', menu.categories),
    { catIdx: 0, itemIdx: 0 },
  );
});

test('een geaccentueerde gerechtnaam overleeft coderen en decoderen in de deellink', () => {
  const href = dishShareHref({ menuLink: '/menu/6-diner', dishId, name: 'Café Spécial & Zo', category: menu.categories[0].name, theme: 'licht' });
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('name'), 'Café Spécial & Zo');
  assert.match(href, /name=Caf%C3%A9\+Sp%C3%A9cial\+%26\+Zo/);
});

test('zonder geldige velden is er geen deellink', () => {
  assert.equal(dishShareHref({ dishId, name: dish.name, category: menu.categories[0].name }), null);
  assert.equal(dishShareHref({ menuLink: '/menu/6-diner', name: dish.name, category: menu.categories[0].name }), null);
  assert.equal(dishShareHref({}), null);
});


test('de echte fixture bestaat en resolveert naar precies dit gerecht', () => {
  assert.equal(dish.name, 'Poussin');
  const target = resolveDishTarget(dishId, dish.name, menu.categories[0].name, '6-diner', menu.categories);
  assert.deepEqual(target, { catIdx: 0, itemIdx: 0 });
});

test('de stand is licht of donker, nooit iets anders; een link houdt er precies één', () => {
  assert.equal(normalizeShareTheme('donker'), 'donker');
  assert.equal(normalizeShareTheme('dark'), 'donker');
  assert.equal(normalizeShareTheme('licht'), 'licht');
  assert.equal(normalizeShareTheme('light'), 'licht');
  assert.equal(normalizeShareTheme('paars'), 'licht');
  assert.equal(normalizeShareTheme(undefined), 'licht');
  assert.equal(shareThemeFromAttribute('dark'), 'donker');
  assert.equal(hasShareTheme('donker'), true);
  assert.equal(hasShareTheme('licht'), true);
  assert.equal(hasShareTheme(''), false);
  assert.equal(hasShareTheme(null), false);
  assert.equal(withShareTheme('/menu/6-diner?dish=6-diner-0-0&stand=licht', 'donker'), '/menu/6-diner?dish=6-diner-0-0&stand=donker');
  assert.equal(withShareTheme(null, 'donker'), null);
});

test('de absolute deellink gebruikt de basis-URL en laat een absolute link staan', () => {
  assert.equal(dishShareUrl({ baseUrl: 'https://onzemenukaarten.nl', href: '/menu/6-diner?dish=6-diner-0-0' }), 'https://onzemenukaarten.nl/menu/6-diner?dish=6-diner-0-0');
  assert.equal(dishShareUrl({ baseUrl: 'https://onzemenukaarten.nl/', href: '/menu/6-diner' }), 'https://onzemenukaarten.nl/menu/6-diner');
  assert.equal(dishShareUrl({ baseUrl: 'https://onzemenukaarten.nl', href: 'https://other.example/x' }), 'https://other.example/x');
  assert.equal(dishShareUrl({ baseUrl: 'https://onzemenukaarten.nl', href: '' }), null);
});

test('de basis-URL: eigen omgeving eerst, anders de huidige host, anders lokaal', () => {
  assert.equal(siteBaseUrl({ envUrl: 'https://onzemenukaarten.nl/', host: 'ignored.example' }), 'https://onzemenukaarten.nl');
  assert.equal(siteBaseUrl({ envUrl: '', host: 'localhost:3000', proto: 'http' }), 'http://localhost:3000');
  assert.equal(siteBaseUrl({ envUrl: 'niet-een-url', host: 'menukaarten.example' }), 'https://menukaarten.example');
  assert.equal(siteBaseUrl({}), 'http://localhost:3000');
});

test('de basis-URL: lokaal is http, een echte host is https, een proxyheader wint', () => {
  assert.equal(siteBaseUrl({ host: 'localhost:3157' }), 'http://localhost:3157');
  assert.equal(siteBaseUrl({ host: '127.0.0.1:3157' }), 'http://127.0.0.1:3157');
  assert.equal(siteBaseUrl({ host: 'onzemenukaarten.nl' }), 'https://onzemenukaarten.nl');
  assert.equal(siteBaseUrl({ host: 'onzemenukaarten.nl', proto: 'http' }), 'http://onzemenukaarten.nl');
  assert.equal(siteBaseUrl({ host: 'localhost:3157', proto: 'https' }), 'https://localhost:3157');
});

test('de kop van het deelmenu is gerecht en restaurant, geen berichttekst', () => {
  assert.equal(dishShareTitle({ name: dish.name, restaurantName: restaurant.name }), 'Poussin · Brasserie Bardot');
  assert.equal(dishShareTitle({ name: dish.name }), 'Poussin');
  assert.equal(dishShareTitle({}), '');
});

test('de prijs is de prijs van de kaart, en zonder echte prijs "op aanvraag"', () => {
  assert.equal(dishSharePrice(dish), '€20,95');
  assert.equal(dishSharePrice({ name: 'Soep', priceOnRequest: true }), 'op aanvraag');
  assert.equal(dishSharePrice({ name: 'Soep' }), 'op aanvraag');
  assert.equal(dishSharePrice(null), 'op aanvraag');
});

test('één regel beschrijving: witruimte plat en afgekapt op een woordgrens', () => {
  assert.equal(oneLineDescription('  Krielkippetje\n van   de rotisserie '), 'Krielkippetje van de rotisserie');
  assert.equal(oneLineDescription(''), '');
  const long = oneLineDescription(`${'a'.repeat(50)} ${'b'.repeat(200)}`);
  assert.ok(long.endsWith('…'));
  assert.ok(long.length <= 111);
  assert.ok(!long.includes('  '));
});

test('og:description noemt restaurant, adres en één regel beschrijving', () => {
  const description = shareOgDescription({ restaurantName: restaurant.name, address: restaurant.address, description: dish.desc });
  assert.ok(description.startsWith('Brasserie Bardot · Van Coothplein 12, 4811 NE Breda — '));
  assert.ok(description.includes('Krielkippetje van onze huisrotisserie'));
  assert.equal(shareOgDescription({ restaurantName: restaurant.name }), 'Brasserie Bardot');
  assert.equal(shareOgDescription({}), '');
});

test('de metadata van een gedeeld gerecht: og:title "<gerecht> · <prijs>", og:url en og:image', () => {
  const href = dishShareHref({ menuLink: '/menu/6-diner', dishId, name: dish.name, category: menu.categories[0].name, theme: 'licht' });
  const imageHref = shareImageHref({ menuId: '6-diner', dishId, name: dish.name, category: menu.categories[0].name, theme: 'licht' });
  const metadata = dishShareMetadata({
    dishName: dish.name,
    priceLabel: dishSharePrice(dish),
    restaurantName: restaurant.name,
    address: restaurant.address,
    description: dish.desc,
    baseUrl: 'https://onzemenukaarten.nl',
    href,
    imageHref,
  });
  assert.equal(metadata.openGraph.title, 'Poussin · €20,95');
  assert.equal(metadata.title, 'Poussin · €20,95');
  assert.equal(metadata.openGraph.url, `https://onzemenukaarten.nl${href}`);
  assert.ok(metadata.openGraph.description.includes('Brasserie Bardot'));
  assert.ok(metadata.openGraph.description.includes('Van Coothplein 12, 4811 NE Breda'));
  assert.equal(metadata.openGraph.images.length, 1);
  assert.equal(metadata.openGraph.images[0].width, 1200);
  assert.equal(metadata.openGraph.images[0].height, 630);
  assert.match(metadata.openGraph.images[0].url, /^https:\/\/onzemenukaarten\.nl\/menu\/6-diner\/share-image\?/);
  assert.match(metadata.openGraph.images[0].url, /stand=licht/);
  // De basis voor relatieve metadata komt uit dezelfde bron.
  assert.equal(metadata.metadataBase.href, 'https://onzemenukaarten.nl/');
  // Geen foto en geen berichttekst in de metadata.
  assert.equal('text' in metadata.openGraph, false);
});

test('de metadata met een onbekende prijs zegt eerlijk "op aanvraag"', () => {
  const metadata = dishShareMetadata({
    dishName: 'Dagschotel',
    priceLabel: dishSharePrice({ name: 'Dagschotel', priceOnRequest: true }),
    restaurantName: restaurant.name,
    address: restaurant.address,
    description: '',
    baseUrl: 'https://onzemenukaarten.nl',
    href: '/menu/6-diner?dish=6-diner-0-0&name=Dagschotel&cat=Starters&stand=donker',
    imageHref: '/menu/6-diner/share-image?dish=6-diner-0-0&name=Dagschotel&cat=Starters&stand=donker',
  });
  assert.equal(metadata.openGraph.title, 'Dagschotel · op aanvraag');
  assert.equal(metadata.openGraph.description, 'Brasserie Bardot · Van Coothplein 12, 4811 NE Breda');
  assert.match(metadata.openGraph.images[0].url, /stand=donker/);
});

test('de metadata zonder gerechtnaam of prijs verzint niets en valt terug', () => {
  const metadata = dishShareMetadata({ dishName: '', priceLabel: '', baseUrl: 'https://onzemenukaarten.nl' });
  assert.equal(metadata.openGraph.title, '');
  assert.equal('description' in metadata.openGraph, false);
  assert.equal('url' in metadata.openGraph, false);
  assert.equal('images' in metadata.openGraph, false);
});

test('zonder geldige basis-URL komt er geen metadataBase en geen gok', () => {
  assert.equal('metadataBase' in dishShareMetadata({ dishName: 'Poussin', priceLabel: '€20,95' }), false);
  assert.equal('metadataBase' in dishShareMetadata({ dishName: 'Poussin', baseUrl: 'niet-een-url' }), false);
  assert.equal('metadataBase' in dishShareMetadata({ dishName: 'Poussin', baseUrl: 'http://localhost:3157' }), true);
});

test('het adres van de voorvertoningsafbeelding draagt dezelfde stand als de link', () => {
  const href = dishShareHref({ menuLink: '/menu/6-diner', dishId, name: dish.name, category: menu.categories[0].name, theme: 'donker' });
  const image = shareImageHref({ menuId: '6-diner', dishId, name: dish.name, category: menu.categories[0].name, theme: 'donker' });
  assert.equal(new URLSearchParams(href.split('?')[1]).get(SHARE_THEME_PARAM), 'donker');
  assert.equal(new URL(image, 'http://local.invalid').searchParams.get(SHARE_THEME_PARAM), 'donker');
  assert.equal(shareImageHref({ menuId: '6-diner' }), null);
});

// ─── Het klembord-alternatief (criterium 1, zonder navigator.share) ────────

test('het delen kiest het systeemmenu als dat er is, anders het klembord, anders niets', () => {
  const share = () => Promise.resolve();
  const clipboard = { writeText: () => Promise.resolve() };
  assert.equal(shareTarget({ share, clipboard }), 'share');
  assert.equal(shareTarget({ share: undefined, clipboard }), 'clipboard');
  assert.equal(shareTarget({}), 'none');
  assert.equal(shareTarget({ clipboard: {} }), 'none');
});

test('een geslaagde kopie geeft de melding "Link gekopieerd"', async () => {
  const written = [];
  const clipboard = { writeText: async (value) => { written.push(value); } };
  const result = await copyShareLink(clipboard, 'https://onzemenukaarten.nl/menu/6-diner?dish=6-diner-0-0&stand=donker');
  assert.deepEqual(result, { ok: true, message: COPIED_MESSAGE });
  assert.equal(COPIED_MESSAGE, 'Link gekopieerd');
  assert.deepEqual(written, ['https://onzemenukaarten.nl/menu/6-diner?dish=6-diner-0-0&stand=donker']);
});

test('een geweigerde of ontbrekende kopie geeft geen melding en gooit nooit', async () => {
  const denied = { writeText: async () => { throw new Error('NotAllowedError'); } };
  const broken = { writeText: () => { throw new Error('kapot'); } };
  assert.deepEqual(await copyShareLink(denied, 'https://example.org/x'), { ok: false, message: '' });
  assert.deepEqual(await copyShareLink(broken, 'https://example.org/x'), { ok: false, message: '' });
  assert.deepEqual(await copyShareLink(undefined, 'https://example.org/x'), { ok: false, message: '' });
  assert.deepEqual(await copyShareLink({}, 'https://example.org/x'), { ok: false, message: '' });
  assert.deepEqual(await copyShareLink({ writeText: async () => {} }, ''), { ok: false, message: '' });
});

