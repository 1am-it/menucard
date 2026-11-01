'use strict';

// BE-44 (#105, criterium 4) — het lijstje: id's, opslag, de gedeelde link en de
// teksten. Tegen de echte projectdata (dezelfde menukaarten als de app), geen
// mocks van de data zelf.
//
// De load-bearing punten uit het contract:
// - de id's staan in de URL, gecodeerd en gedecodeerd, met hooguit 20 gerechten;
// - ongeldige, onbekende en verdwenen id's worden stil overgeslagen en geteld;
// - de opslag is localStorage, in try/catch: zonder opslag of met een fout
//   blijft de pagina werken (leeg lijstje, geen crash);
// - "Bewaren"/"Bewaard", "<n> bewaard" en "Gedeeld lijstje · <n> gerechten"
//   zijn de teksten uit het contract;
// - de gedeelde lijstlink draagt alleen de id's en de stand.

const assert = require('node:assert/strict');
const { test } = require('node:test');
// BE-74 (#185): de id's en de verwachtingen horen bij de kaarten van maart;
// vastgezette kopie in plaats van de levende data.
require('../test-fixtures/useFrozenData').useFrozenData('maart-2026');
const menusData = require('../../data/menus.json');
const restaurantsData = require('../../data/restaurants.json');
const {
  ADD_TO_OWN_LIST_LABEL,
  LIST_PAGE,
  LIST_PARAM,
  LIST_SHARE_LABEL,
  NOT_AVAILABLE_MESSAGE,
  REMOVE_LABEL,
  SAVED_LABEL,
  SAVED_LIST_KEY,
  SAVED_LIST_LIMIT,
  SAVE_LABEL,
  absoluteUrl,
  addEntries,
  addSavedDishes,
  buildEntry,
  decodeListParam,
  dishIds,
  encodeListParam,
  isDishSaved,
  listDishHref,
  listImageRows,
  listImageTitle,
  listShareHref,
  listShareImageHref,
  listShareMetadata,
  normalizeEntries,
  parseDishId,
  readSavedList,
  resolveListDishes,
  savedBarLabel,
  sharedListHeading,
  toggleEntry,
  toggleSavedDish,
  writeSavedList,
} = require('./dishList');
const { resolveDishTarget } = require('./dishDeepLink');

// De echte fixture: "Poussin" (€20,95) uit de dinerkaart van restaurant 6.
const MENU_ID = '6-diner';
const menu = menusData[MENU_ID];
const restaurant = restaurantsData['6'];
const category = menu.categories[0];
const dish = category.items[0];
const DISH_ID = '6-diner-0-0';

function entryFor(catIdx, itemIdx) {
  const cat = menu.categories[catIdx];
  const item = cat && cat.items[itemIdx];
  return buildEntry({
    menuId: MENU_ID,
    catIdx,
    itemIdx,
    item,
    category: cat && cat.name,
    restaurantName: restaurant.name,
  });
}

/** Een localStorage-achtig object; `fail` maakt elke bewerking kapot. */
function fakeStorage({ fail = false, value = null } = {}) {
  const store = new Map();
  if (value !== null) store.set(SAVED_LIST_KEY, value);
  return {
    store,
    getItem(key) {
      if (fail) throw new Error('storage kapot');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, next) {
      if (fail) throw new Error('storage vol');
      store.set(key, next);
    },
  };
}

// ─── Id's ────────────────────────────────────────────────────────────────────

test('een gerecht-id is <menukaart>-<categorie>-<gerecht> en niets anders', () => {
  assert.deepEqual(parseDishId('6-diner-0-0'), { menuId: '6-diner', catIdx: 0, itemIdx: 0 });
  assert.deepEqual(parseDishId('6-specialiteiten-12-3'), { menuId: '6-specialiteiten', catIdx: 12, itemIdx: 3 });
  for (const invalid of ['', '   ', null, undefined, '6-diner', 'poussin', '6-diner-x-0', '6-diner-0', '6-diner--1-0', '-1-0']) {
    assert.equal(parseDishId(invalid), null, `${invalid} is geen gerecht-id`);
  }
});

// ─── De lijstje-URL: coderen, decoderen, ongeldige invoer, limiet ────────────

test('coderen en decoderen is een rondje, met dezelfde volgorde', () => {
  const entries = [entryFor(0, 0), entryFor(0, 1)].filter(Boolean);
  assert.equal(entries.length, 2);
  const encoded = encodeListParam(entries);
  assert.equal(encoded, entries.map((entry) => entry.id).join(','));
  assert.deepEqual(decodeListParam(encoded), { ids: entries.map((entry) => entry.id), skipped: 0 });
});

test("decoderen slaat ongeldige id's en dubbelen over en telt ze", () => {
  const result = decodeListParam(`${DISH_ID},poussin,${DISH_ID},,6-diner-x-0`);
  assert.deepEqual(result.ids, [DISH_ID]);
  assert.equal(result.skipped, 3);
  assert.deepEqual(decodeListParam(''), { ids: [], skipped: 0 });
  assert.deepEqual(decodeListParam(null), { ids: [], skipped: 0 });
  assert.deepEqual(decodeListParam(','), { ids: [], skipped: 0 });
});

test('de limiet van 20 geldt bij coderen en bij decoderen', () => {
  assert.equal(SAVED_LIST_LIMIT, 20);
  const many = Array.from({ length: 25 }, (unused, index) => ({
    id: `6-diner-${index}-0`,
    name: `Gerecht ${index}`,
    category: 'Specialiteiten van Bardot',
    price: '€10,00',
    restaurant: restaurant.name,
  }));
  const encoded = encodeListParam(many);
  assert.equal(encoded.split(',').length, SAVED_LIST_LIMIT);
  const decoded = decodeListParam(encoded);
  assert.equal(decoded.ids.length, SAVED_LIST_LIMIT);
  assert.equal(decoded.skipped, 0);
  const overLimit = decodeListParam(many.map((entry) => entry.id).join(','));
  assert.equal(overLimit.ids.length, SAVED_LIST_LIMIT);
  assert.equal(overLimit.skipped, 5);
  assert.equal(encodeListParam([]), null);
});

test('de normale lijst is ontdubbeld, geldig en hooguit 20 lang', () => {
  const entries = normalizeEntries([
    entryFor(0, 0),
    entryFor(0, 0),
    null,
    { id: 'geen-id', name: 'niets' },
    entryFor(0, 1),
  ]);
  assert.deepEqual(entries.map((entry) => entry.id), [DISH_ID, '6-diner-0-1']);
  assert.deepEqual(dishIds(entries), [DISH_ID, '6-diner-0-1']);
});

test('de id\'s werken ook los: de server heeft van een gedeelde link niets meer dan de id', () => {
  assert.deepEqual(dishIds([DISH_ID, '6-diner-0-1', DISH_ID, 'onzin', null]), [DISH_ID, '6-diner-0-1']);
  assert.equal(encodeListParam([DISH_ID, '6-diner-0-1']), `${DISH_ID},6-diner-0-1`);
  // De gedeelde link van de server (alleen id's) is gelijk aan die van de
  // lijstpagina (hele gerechten).
  const entries = [entryFor(0, 0), entryFor(0, 1)];
  assert.equal(encodeListParam(entries), encodeListParam(entries.map((entry) => entry.id)));
});

// ─── De gedeelde lijstlink ───────────────────────────────────────────────────

test("de gedeelde lijstlink draagt de id's en de stand, en niets anders", () => {
  const entries = [entryFor(0, 0), entryFor(0, 1)];
  const href = listShareHref({ values: entries, theme: 'donker' });
  const parsed = new URL(href, 'http://local.invalid');
  assert.equal(parsed.pathname, LIST_PAGE);
  assert.equal(parsed.searchParams.get(LIST_PARAM), entries.map((entry) => entry.id).join(','));
  assert.equal(parsed.searchParams.get('stand'), 'donker');
  assert.equal([...parsed.searchParams.keys()].length, 2);
  assert.equal(listShareHref({ values: [] }), null);
  assert.match(listShareHref({ values: entries, theme: 'licht' }), /stand=licht/);
  // De id's staan leesbaar in de link (geen %2C) en de pagina leest hem terug.
  assert.equal(href.includes('%2C'), false);
  assert.deepEqual(decodeListParam(parsed.searchParams.get(LIST_PARAM)).ids, entries.map((entry) => entry.id));
});

test('de voorvertoning van het lijstje is een eigen 1200 × 630-afbeelding', () => {
  const entries = [entryFor(0, 0)];
  const href = listShareImageHref({ values: entries, theme: 'donker' });
  const parsed = new URL(href, 'http://local.invalid');
  assert.equal(parsed.pathname, `${LIST_PAGE}/share-image`);
  assert.equal(parsed.searchParams.get(LIST_PARAM), DISH_ID);
  assert.equal(parsed.searchParams.get('stand'), 'donker');
  assert.equal(listShareImageHref({ values: [] }), null);
});

test('elk gerecht in het lijstje is aan te tikken naar dezelfde deeplink', () => {
  const entry = entryFor(0, 0);
  const href = listDishHref(entry, 'donker');
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(href.split('?')[0], `/menu/${MENU_ID}`);
  assert.equal(params.get('dish'), DISH_ID);
  assert.equal(params.get('name'), dish.name);
  assert.equal(params.get('cat'), category.name);
  assert.equal(params.get('stand'), 'donker');
  // De ontvanger valt er precies op terug.
  assert.deepEqual(
    resolveDishTarget(params.get('dish'), params.get('name'), params.get('cat'), MENU_ID, menu.categories),
    { catIdx: 0, itemIdx: 0 },
  );
  assert.equal(listDishHref(null, 'donker'), null);
});

test("onbekende en verdwenen id's worden overgeslagen en geteld", () => {
  const { dishes, skipped } = resolveListDishes({
    ids: [DISH_ID, '99-diner-0-0', '6-diner-0-999', 'onzin', '6-diner-1-0'],
    menus: menusData,
    restaurants: restaurantsData,
  });
  assert.deepEqual(dishes.map((entry) => entry.id), [DISH_ID, '6-diner-1-0']);
  assert.equal(skipped, 3);
  assert.equal(dishes[0].name, dish.name);
  assert.equal(dishes[0].restaurant, restaurant.name);
  assert.match(dishes[0].price, /20,95/);
});

test('de ontvanger ziet de kop uit het contract en de telling van wat mist', () => {
  assert.equal(sharedListHeading(2), 'Gedeeld lijstje · 2 gerechten');
  assert.equal(sharedListHeading(1), 'Gedeeld lijstje · 1 gerecht');
  assert.equal(savedBarLabel(3), '3 bewaard');
  assert.equal(savedBarLabel(0), '0 bewaard');
  assert.equal(listImageTitle(3), '3 gerechten om uit te kiezen');
  assert.equal(SAVE_LABEL, 'Bewaren');
  assert.equal(SAVED_LABEL, 'Bewaard');
  assert.equal(LIST_SHARE_LABEL, 'Lijstje delen');
  assert.equal(ADD_TO_OWN_LIST_LABEL, 'Zet ze op mijn eigen lijstje');
  assert.equal(REMOVE_LABEL, 'Verwijderen');
  assert.equal(NOT_AVAILABLE_MESSAGE, 'Niet meer beschikbaar');
});

test('de voorvertoning van het lijstje toont hooguit vier regels en telt de rest', () => {
  const entries = Array.from({ length: 7 }, (unused, index) => ({
    id: `6-diner-${index}-0`,
    name: `Gerecht ${index}`,
    category: category.name,
    price: '€10,00',
    restaurant: restaurant.name,
  }));
  const { rows, more } = listImageRows(entries);
  assert.equal(rows.length, 4);
  assert.equal(more, 3);
  assert.deepEqual(listImageRows([]), { rows: [], more: 0 });
});

test('de echte menukaarten leveren de id die de deeplink gebruikt', () => {
  const entry = entryFor(0, 0);
  assert.equal(entry.id, DISH_ID);
  assert.equal(entry.name, dish.name);
  assert.equal(entry.restaurant, restaurant.name);
  assert.equal(entry.category, category.name);
  assert.match(entry.price, /20,95/);
});


// ─── Opslag: localStorage, in try/catch ─────────────────────────────────────

test('bewaren en weer weghalen werkt op een echte opslag', () => {
  const storage = fakeStorage();
  const entry = entryFor(0, 0);
  const added = toggleSavedDish(storage, entry);
  assert.deepEqual({ saved: added.saved, ok: added.ok }, { saved: true, ok: true });
  assert.equal(isDishSaved(storage, DISH_ID), true);
  assert.deepEqual(readSavedList(storage).map((item) => item.id), [DISH_ID]);
  const removed = toggleSavedDish(storage, entry);
  assert.deepEqual({ saved: removed.saved, ok: removed.ok }, { saved: false, ok: true });
  assert.equal(isDishSaved(storage, DISH_ID), false);
  assert.deepEqual(readSavedList(storage), []);
});

test('zonder opslag, met een fout of met kapotte JSON werkt de pagina door', () => {
  const entry = entryFor(0, 0);
  const broken = fakeStorage({ fail: true });
  assert.deepEqual(readSavedList(undefined), []);
  assert.deepEqual(readSavedList(null), []);
  assert.deepEqual(readSavedList({}), []);
  assert.deepEqual(readSavedList(broken), []);
  assert.deepEqual(readSavedList(fakeStorage({ value: '{geen json' })), []);
  assert.deepEqual(readSavedList(fakeStorage({ value: '{"niet":"een lijst"}' })), []);
  // Schrijven lukt niet, maar de knop gooit niet en de bedoelde stand blijft.
  const result = toggleSavedDish(broken, entry);
  assert.equal(result.saved, true);
  assert.equal(result.ok, false);
  assert.equal(toggleSavedDish(undefined, entry).saved, true);
  assert.deepEqual(writeSavedList(undefined, [entry]), { ok: false, entries: [entry] });
  assert.equal(addSavedDishes(undefined, [entry]).added, 1);
  assert.equal(isDishSaved(broken, DISH_ID), false);
});

test("wat in de opslag staat is een gewone JSON-lijst met de id's", () => {
  const storage = fakeStorage();
  toggleSavedDish(storage, entryFor(0, 0));
  const parsed = JSON.parse(storage.store.get(SAVED_LIST_KEY));
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].id, DISH_ID);
  // Een volgend bezoek leest hetzelfde lijstje terug.
  assert.deepEqual(readSavedList(storage).map((item) => item.id), [DISH_ID]);
});

test('het hele gedeelde lijstje in één keer overnemen, zonder dubbelen', () => {
  const storage = fakeStorage();
  const entries = [entryFor(0, 0), entryFor(0, 1)].filter(Boolean);
  toggleSavedDish(storage, entries[0]);
  const added = addSavedDishes(storage, entries);
  assert.equal(added.added, entries.length - 1);
  assert.deepEqual(added.entries.map((entry) => entry.id), entries.map((entry) => entry.id));
  assert.equal(addEntries([], []).added, 0);
  // En het eigen lijstje blijft bruikbaar na een tweede keer overnemen.
  assert.equal(addSavedDishes(storage, entries).added, 0);
});

test('de knop-stand volgt de opslag, ook bij een onbekend id', () => {
  const storage = fakeStorage();
  assert.equal(isDishSaved(storage, DISH_ID), false);
  assert.equal(isDishSaved(storage, 'onzin'), false);
  assert.deepEqual(toggleEntry([], null), { entries: [], saved: false, changed: false });
  toggleSavedDish(storage, entryFor(0, 0));
  assert.equal(isDishSaved(storage, DISH_ID), true);
});

// ─── De voorvertoning van het lijstje (metadata) ─────────────────────────────

test('de metadata van een gedeeld lijstje heeft een eigen titel, beschrijving en afbeelding', () => {
  const entries = [entryFor(0, 0), entryFor(0, 1)].filter(Boolean);
  const href = listShareHref({ values: entries, theme: 'donker' });
  const imageHref = listShareImageHref({ values: entries, theme: 'donker' });
  const metadata = listShareMetadata({
    count: entries.length,
    entries,
    baseUrl: 'https://onzemenukaarten.nl',
    href,
    imageHref,
  });
  assert.equal(metadata.title, '2 gerechten om uit te kiezen');
  assert.match(metadata.openGraph.description, new RegExp(restaurant.name));
  assert.equal(metadata.openGraph.url, `https://onzemenukaarten.nl${href}`);
  assert.equal(metadata.openGraph.images[0].url, `https://onzemenukaarten.nl${imageHref}`);
  assert.equal(metadata.openGraph.images[0].width, 1200);
  assert.equal(metadata.openGraph.images[0].height, 630);
  assert.equal(metadata.metadataBase.toString(), 'https://onzemenukaarten.nl/');
  // Zonder basis: geen metadataBase en geen gegokte absolute URL's.
  const withoutBase = listShareMetadata({ count: 1, entries, href: '/mijn-lijstje?lijst=x' });
  assert.equal('metadataBase' in withoutBase, false);
  assert.equal('url' in withoutBase.openGraph, false);
});

test('absoluteUrl maakt alleen absoluut wat met een echte basis kan', () => {
  assert.equal(absoluteUrl('/mijn-lijstje', 'https://example.org/'), 'https://example.org/mijn-lijstje');
  assert.equal(absoluteUrl('/mijn-lijstje', undefined), null);
  assert.equal(absoluteUrl('https://example.org/x', undefined), 'https://example.org/x');
  assert.equal(absoluteUrl(null, 'https://example.org'), null);
});
