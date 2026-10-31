'use strict';

// BE-57 (#139, deel 1) — de teller "bekeken", de rekenregels.
//
// Zonder browser, React of netwerk: de navigator, de opslag en fetch zijn
// parameters. Wat hier bewezen wordt:
//   - een telverzoek is exact { restaurant } — geen cookie, id of ander
//     identificerend veld;
//   - één keer per pagina en één keer per sessie;
//   - bij "Do Not Track" of "Global Privacy Control" wordt niets verstuurd;
//   - de beacon blokkeert de pagina niet (sendBeacon, anders fetch keepalive) en
//     een fout is nooit zichtbaar;
//   - na het laden: pas in een idle-moment of een time-out, niet synchroon.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  VIEW_ENDPOINT,
  VIEW_FUNCTION,
  VIEW_SESSION_KEY,
  VIEW_TABLE,
  isMissingViewStorage,
  isTrackingOptedOut,
  normalizeRestaurantId,
  scheduleRestaurantView,
  sendRestaurantView,
  sessionViewedIds,
  shouldCountRestaurantView,
  viewBody,
} = require('./restaurantViews');

const RESTAURANT = '6';

/** Een sessionStorage-achtig object in geheugen. */
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
  };
}

/** Een navigator-achtig object dat elke beacon vastlegt. */
function beaconNavigator({ result = true, throws = false, doNotTrack, globalPrivacyControl } = {}) {
  const sent = [];
  return {
    sent,
    doNotTrack,
    globalPrivacyControl,
    sendBeacon(url, blob) {
      if (throws) throw new Error('beacon kapot');
      sent.push({ url, blob });
      return result;
    },
  };
}

test('bekeken: de route, de functie en de tabel heten zoals de migratie ze noemt', () => {
  assert.equal(VIEW_ENDPOINT, '/api/v1/bekeken');
  assert.equal(VIEW_FUNCTION, 'increment_restaurant_view');
  assert.equal(VIEW_TABLE, 'restaurant_views');
  assert.equal(VIEW_SESSION_KEY, 'bredaeats_bekeken');
});

test('bekeken: een telverzoek is exact { restaurant } — geen identificerende velden', () => {
  assert.deepEqual(viewBody({ restaurant: RESTAURANT }), { restaurant: RESTAURANT });
  // Alles wat een caller erbij zet, valt weg.
  assert.deepEqual(
    viewBody({ restaurant: RESTAURANT, userId: 'abc', ip: '1.2.3.4', cookie: 's=1', path: '/menu/6' }),
    { restaurant: RESTAURANT }
  );
  assert.equal(viewBody({ restaurant: 'Restaurant 6' }), null);
  assert.equal(viewBody({ restaurant: '6; drop table restaurant_views' }), null);
  assert.equal(viewBody({}), null);
  assert.equal(viewBody(), null);
});

test('bekeken: alleen de id-vorm van de routes is geldig', () => {
  assert.equal(normalizeRestaurantId('6'), '6');
  assert.equal(normalizeRestaurantId(' 23 '), '23');
  for (const value of ['', ' ', 'restaurant-6', '6/../7', '../6', 'a b', null, undefined, 42, {}, 'x'.repeat(25)]) {
    assert.equal(normalizeRestaurantId(value), null, String(value));
  }
});

test('bekeken: "Do Not Track" en "Global Privacy Control" worden gerespecteerd', () => {
  assert.equal(isTrackingOptedOut({ doNotTrack: '1' }), true);
  assert.equal(isTrackingOptedOut({ doNotTrack: 'Yes' }), true);
  assert.equal(isTrackingOptedOut({ msDoNotTrack: '1' }), true);
  assert.equal(isTrackingOptedOut({ globalPrivacyControl: true }), true);
  assert.equal(isTrackingOptedOut({ doNotTrack: '0' }), false);
  assert.equal(isTrackingOptedOut({ doNotTrack: 'unspecified' }), false);
  assert.equal(isTrackingOptedOut({ globalPrivacyControl: false }), false);
  assert.equal(isTrackingOptedOut(null), false);
  assert.equal(isTrackingOptedOut(undefined), false);
});

test('bekeken: bij een opt-out gaat er niets weg, ook niet met een geldige id', () => {
  const nav = beaconNavigator({ doNotTrack: '1' });
  const pageSent = new Set();
  assert.equal(sendRestaurantView({ restaurantId: RESTAURANT, navigator: nav, pageSent }), false);
  assert.equal(nav.sent.length, 0);
  assert.equal(pageSent.size, 0, 'niet geteld is ook niet onthouden');

  const gpc = beaconNavigator({ globalPrivacyControl: true });
  assert.equal(sendRestaurantView({ restaurantId: RESTAURANT, navigator: gpc, pageSent: new Set() }), false);
  assert.equal(gpc.sent.length, 0);
});


test('bekeken: één keer per pagina, ook als het effect twee keer loopt', () => {
  const nav = beaconNavigator();
  const pageSent = new Set();
  assert.equal(sendRestaurantView({ restaurantId: RESTAURANT, navigator: nav, pageSent }), true);
  assert.equal(sendRestaurantView({ restaurantId: RESTAURANT, navigator: nav, pageSent }), false);
  assert.equal(nav.sent.length, 1);
});

test('bekeken: één keer per sessie, ook na een herlaadactie', () => {
  const storage = memoryStorage();
  const first = beaconNavigator();
  assert.equal(sendRestaurantView({ restaurantId: RESTAURANT, navigator: first, storage, pageSent: new Set() }), true);
  assert.deepEqual(sessionViewedIds(storage), [RESTAURANT]);

  // Nieuwe paginalading, zelfde sessie: niet nog eens tellen.
  const second = beaconNavigator();
  assert.equal(sendRestaurantView({ restaurantId: RESTAURANT, navigator: second, storage, pageSent: new Set() }), false);
  assert.equal(second.sent.length, 0);

  // Een ander restaurant in dezelfde sessie telt wel.
  const other = beaconNavigator();
  assert.equal(sendRestaurantView({ restaurantId: '23', navigator: other, storage, pageSent: new Set() }), true);
  assert.deepEqual(sessionViewedIds(storage), [RESTAURANT, '23']);
});

test('bekeken: kapotte of geblokkeerde opslag telt niet dubbel en gooit niet', () => {
  const brokenStorage = {
    getItem() { throw new Error('geblokkeerd'); },
    setItem() { throw new Error('vol'); },
  };
  const nav = beaconNavigator();
  const pageSent = new Set();
  assert.equal(shouldCountRestaurantView({ restaurantId: RESTAURANT, navigator: nav, storage: brokenStorage }), true);
  assert.equal(sendRestaurantView({ restaurantId: RESTAURANT, navigator: nav, storage: brokenStorage, pageSent }), true);
  assert.equal(sendRestaurantView({ restaurantId: RESTAURANT, navigator: nav, storage: brokenStorage, pageSent }), false);
  assert.equal(nav.sent.length, 1);
});

test('bekeken: sendBeacon krijgt één JSON-blob en de pagina wacht er niet op', async () => {
  const nav = beaconNavigator();
  const result = sendRestaurantView({ restaurantId: RESTAURANT, navigator: nav, pageSent: new Set() });
  // Synchroon resultaat, geen belofte: er valt niets te awaiten.
  assert.equal(typeof result, 'boolean');
  assert.equal(result, true);
  assert.equal(nav.sent.length, 1);
  assert.equal(nav.sent[0].url, VIEW_ENDPOINT);
  assert.equal(nav.sent[0].blob.type, 'application/json');
  assert.deepEqual(JSON.parse(await nav.sent[0].blob.text()), { restaurant: RESTAURANT });
});


test('bekeken: zonder sendBeacon gaat het met fetch en keepalive', () => {
  const calls = [];
  const fetchRef = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve({ ok: true });
  };
  const result = sendRestaurantView({ restaurantId: RESTAURANT, navigator: {}, fetchRef, pageSent: new Set() });
  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, VIEW_ENDPOINT);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.keepalive, true, 'de aanvraag overleeft een navigatie');
  assert.equal(calls[0].options.credentials, 'omit', 'geen cookie mee');
  assert.deepEqual(JSON.parse(calls[0].options.body), { restaurant: RESTAURANT });
});

test('bekeken: een netwerk- of beaconfout is nooit zichtbaar', () => {
  const throwingBeacon = beaconNavigator({ throws: true });
  assert.equal(
    sendRestaurantView({ restaurantId: RESTAURANT, navigator: throwingBeacon, pageSent: new Set() }),
    false
  );

  const rejectingFetch = () => Promise.reject(new Error('offline'));
  assert.equal(
    sendRestaurantView({ restaurantId: RESTAURANT, navigator: {}, fetchRef: rejectingFetch, pageSent: new Set() }),
    true,
    'de pagina merkt niets van de afwijzing'
  );
});

test('bekeken: na het laden tellen, niet synchroon tijdens het renderen', () => {
  const nav = beaconNavigator();
  const idleCalls = [];
  const windowLike = {
    requestIdleCallback: (callback, options) => { idleCalls.push({ callback, options }); },
  };
  assert.equal(scheduleRestaurantView({ restaurantId: RESTAURANT, navigator: nav, window: windowLike }), true);
  assert.equal(nav.sent.length, 0, 'nog niet verstuurd tijdens het laden');
  assert.equal(idleCalls.length, 1);
  assert.deepEqual(idleCalls[0].options, { timeout: 2000 });
  idleCalls[0].callback();
  assert.equal(nav.sent.length, 1);
});

test('bekeken: een ontbrekende tabel of functie is herkenbaar', () => {
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    assert.equal(isMissingViewStorage({ code }), true, code);
  }
  assert.equal(isMissingViewStorage({ message: 'relation "restaurant_views" does not exist' }), true);
  assert.equal(isMissingViewStorage({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isMissingViewStorage(null), false);
  assert.equal(isMissingViewStorage(undefined), false);
});
