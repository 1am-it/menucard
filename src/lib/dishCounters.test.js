'use strict';

// BE-44 (#105, criterium 5) — de anonieme tellers: de rekenregels.
//
// Tegen de echte projectdata (dezelfde menukaarten die de app toont), zonder
// Supabase en zonder browser. De load-bearing punten uit het contract:
//   - precies drie gebeurtenissen: gedeeld, bewaard, reserveren;
//   - een telverzoek is exact { dish, event } — geen id, cookie of ander
//     identificerend veld, ook niet als de caller er iets bij zet;
//   - een onbekend of verdwenen gerecht wordt nooit geteld;
//   - hooguit één verzoek per seconde per gerecht en gebeurtenis;
//   - de browserkant is fire-and-forget en faalt stil.

const assert = require('node:assert/strict');
const { test } = require('node:test');
// BE-74 (#185): het getelde gerecht is een gerecht van maart; vaste kopie van
// die kaarten in plaats van de levende data.
require('../services/__fixtures__/frozenMarchData').freezeMarchData();
const menusData = require('../../data/menus.json');
const {
  COUNTER_THROTTLE_MS,
  DISH_COUNTER_ENDPOINT,
  DISH_COUNTER_EVENTS,
  DISH_COUNTER_FUNCTION,
  counterBody,
  createCounterLimiter,
  isCounterEvent,
  isMissingCounterStorage,
  normalizeCounterEvent,
  normalizeDishKey,
  resolveCounterDish,
  sendDishCounter,
} = require('./dishCounters');

// De fixture uit de browsercheck: "Poussin" uit de dinerkaart van restaurant 6.
const DISH = '6-diner-0-0';
const OTHER_DISH = '6-diner-0-1';

test('tellers: precies de drie gebeurtenissen uit het contract, en niets anders', () => {
  assert.deepEqual(DISH_COUNTER_EVENTS, ['gedeeld', 'bewaard', 'reserveren']);
  for (const event of DISH_COUNTER_EVENTS) {
    assert.equal(normalizeCounterEvent(event), event);
    assert.equal(isCounterEvent(event), true);
  }
  for (const value of ['', 'share', 'saved', 'reserveer', 'reserveren!', 'bewaard,gedeeld', null, undefined, 42, {}]) {
    assert.equal(normalizeCounterEvent(value), null, String(value));
    assert.equal(isCounterEvent(value), false, String(value));
  }
  assert.equal(normalizeCounterEvent(' Gedeeld '), 'gedeeld', 'spaties en hoofdletters zijn geen andere gebeurtenis');
});

test('tellers: een telverzoek is exact { dish, event } — geen identificerende velden', () => {
  assert.deepEqual(counterBody({ dish: DISH, event: 'gedeeld' }), { dish: DISH, event: 'gedeeld' });

  // Alles wat een caller erbij zet, valt weg. Er is dus geen pad waarlangs een
  // gebruikers-id, cookie, ip of sessie in de tabel kan belanden.
  const body = counterBody({
    dish: DISH,
    event: 'bewaard',
    userId: 'abc',
    ip: '1.2.3.4',
    userAgent: 'test',
    cookie: 'session=1',
    extra: { nested: true },
  });
  assert.deepEqual(Object.keys(body).sort(), ['dish', 'event']);
  assert.deepEqual(body, { dish: DISH, event: 'bewaard' });

  // Zonder geldige id of gebeurtenis is er geen verzoek.
  assert.equal(counterBody({ dish: '', event: 'gedeeld' }), null);
  assert.equal(counterBody({ dish: DISH }), null);
  assert.equal(counterBody({ dish: DISH, event: 'liked' }), null);
  assert.equal(counterBody({}), null);
  assert.equal(counterBody(), null);
});

test('tellers: alleen de id-vorm van de deeplink en het anker is een gerecht-id', () => {
  assert.equal(normalizeDishKey(DISH), DISH);
  assert.equal(normalizeDishKey(' 6-diner-0-1 '), OTHER_DISH, 'spaties eromheen zijn geen ander gerecht');
  assert.equal(normalizeDishKey('6-diner-00-01'), OTHER_DISH, 'de canonieke vorm, zoals het anker hem schrijft');
  for (const value of ['', 'poussin', '6-diner', '6-diner-0', '6-diner-x-0', '../6-diner-0-0', null, undefined, 7]) {
    assert.equal(normalizeDishKey(value), null, String(value));
  }
  // De vorm is nog geen bestaand gerecht: `6-diner-0-0-0` is een geldige id
  // van menukaart "6-diner-0", die niet bestaat. Dat vangt resolveCounterDish
  // af (zie de volgende test), niet deze vormcontrole.
  assert.equal(normalizeDishKey('6-diner-0-0-0'), '6-diner-0-0-0');
  assert.equal(normalizeDishKey(`${'a'.repeat(100)}-0-0`), null, 'een id van meer dan 96 tekens past niet in de kolom');
});

test('tellers: een gerecht wordt opgezocht in de echte menukaarten, nooit uit de client geloofd', () => {
  const dish = resolveCounterDish(DISH, menusData);
  assert.equal(dish.dishKey, DISH);
  assert.equal(dish.menuId, '6-diner');
  assert.equal(dish.catIdx, 0);
  assert.equal(dish.itemIdx, 0);
  assert.equal(dish.name, 'Poussin');
  assert.equal(dish.category, 'Specialiteiten van Bardot');

  // Onbekende menukaart, categorie of gerecht: geen gerecht, dus geen telling.
  assert.equal(resolveCounterDish('99-diner-0-0', menusData), null);
  assert.equal(resolveCounterDish('6-diner-9-0', menusData), null);
  assert.equal(resolveCounterDish('6-diner-0-99', menusData), null);
  assert.equal(resolveCounterDish(DISH, null), null);
  assert.equal(resolveCounterDish(DISH, {}), null);
  assert.equal(resolveCounterDish('geen-id', menusData), null);
});

test('tellers: hooguit één verzoek per seconde per gerecht en gebeurtenis', () => {
  let clock = 1000;
  const limiter = createCounterLimiter({ windowMs: COUNTER_THROTTLE_MS, now: () => clock });

  assert.equal(limiter.allow(DISH, 'gedeeld'), true);
  assert.equal(limiter.allow(DISH, 'gedeeld'), false, 'tweede klik binnen de seconde telt niet');
  clock += 999;
  assert.equal(limiter.allow(DISH, 'gedeeld'), false, 'nog net binnen het venster');
  clock += 1;
  assert.equal(limiter.allow(DISH, 'gedeeld'), true, 'na een seconde telt hij weer');

  // De limiet is per gerecht én per gebeurtenis: delen en bewaren staan
  // elkaar niet in de weg, en een ander gerecht is een andere teller.
  assert.equal(limiter.allow(DISH, 'bewaard'), true);
  assert.equal(limiter.allow(OTHER_DISH, 'gedeeld'), true);
  assert.equal(limiter.allow(OTHER_DISH, 'gedeeld'), false);

  // Ongeldige invoer telt nooit en onthoudt niets.
  assert.equal(limiter.allow('geen-id', 'gedeeld'), false);
  assert.equal(limiter.allow(DISH, 'liked'), false);

  // Buiten het venster ruimt de limiter zichzelf op: geen onbegrensde map.
  clock += 5000;
  assert.equal(limiter.allow(OTHER_DISH, 'gedeeld'), true);
  assert.equal(limiter.size(), 1);
});

test('tellers: de browserkant is fire-and-forget en stuurt alleen dish en event', async () => {
  const calls = [];
  const fetchRef = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ status: 204 });
  };

  const result = await sendDishCounter({ fetchRef, dish: DISH, event: 'gedeeld' });

  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DISH_COUNTER_ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.keepalive, true, 'de telling overleeft een navigatie');
  assert.equal(calls[0].init.credentials, 'omit', 'geen cookie mee');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)).sort(), ['dish', 'event']);
  assert.deepEqual(JSON.parse(calls[0].init.body), { dish: DISH, event: 'gedeeld' });
  assert.equal(DISH_COUNTER_FUNCTION, 'increment_dish_counter');
});

test('tellers: een mislukte telling is nooit zichtbaar en gooit nooit', async () => {
  // Netwerkfout of 500: alleen `false`, geen afwijzing.
  assert.equal(await sendDishCounter({ fetchRef: () => Promise.reject(new Error('offline')), dish: DISH, event: 'bewaard' }), false);
  // Een fetch die synchroon gooit (bijvoorbeeld een geblokkeerde fetch).
  assert.equal(await sendDishCounter({
    fetchRef: () => { throw new Error('geblokkeerd'); },
    dish: DISH,
    event: 'reserveren',
  }), false);
  // Geen fetch en/of geen geldig gerecht: er wordt niets verstuurd.
  let called = 0;
  const countingFetch = () => { called += 1; return Promise.resolve({ status: 204 }); };
  assert.equal(await sendDishCounter({ fetchRef: countingFetch, dish: 'geen-id', event: 'gedeeld' }), false);
  assert.equal(await sendDishCounter({ fetchRef: countingFetch, dish: DISH, event: 'liked' }), false);
  assert.equal(await sendDishCounter({ dish: DISH, event: 'gedeeld', fetchRef: null }), false);
  assert.equal(called, 0);
});

test('tellers: "de tabel bestaat nog niet" is herkenbaar, zodat de teller stil kan stoppen', () => {
  assert.equal(isMissingCounterStorage({ code: '42P01' }), true, 'undefined_table');
  assert.equal(isMissingCounterStorage({ code: '42883' }), true, 'undefined_function');
  assert.equal(isMissingCounterStorage({ code: 'PGRST202' }), true, 'functie niet in de schema-cache');
  assert.equal(isMissingCounterStorage({ code: 'PGRST205' }), true, 'tabel niet in de schema-cache');
  assert.equal(isMissingCounterStorage({ message: 'relation "dish_counters" does not exist' }), true);
  assert.equal(isMissingCounterStorage({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isMissingCounterStorage({ code: '08006', message: 'connection failure' }), false);
  assert.equal(isMissingCounterStorage(null), false);
});
