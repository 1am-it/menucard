'use strict';

// BE-57 (#139, deel 1) — de tellerroute "bekeken" met een nep-client.
//
// Geen Supabase, geen netwerk en geen Next: de handler krijgt zijn
// afhankelijkheden als parameters (restaurantViewHandlers.js). Wat hier bewezen
// wordt:
//   - een bekend restaurant telt één keer, via de bestaande databasefunctie;
//   - een onbekend restaurant, een kapot verzoek en een leeg verzoek tellen niet;
//   - een ontbrekende tabel of functie (migratie nog niet toegepast) telt niet,
//     geeft geen fout en laat de route niet nóg eens wachten;
//   - zonder sleutel, met een netwerkfout of met een time-out: altijd 204;
//   - de limiet van één verzoek per seconde per restaurant;
//   - er gaat nooit meer dan { p_restaurant_id } naar de database.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const restaurantsData = require('../../data/restaurants.json');
const { createRestaurantViewHandlers, createViewLimiter } = require('./restaurantViewHandlers');
const { VIEW_FUNCTION } = require('./restaurantViews');

const RESTAURANT = '6';

/** Een Request-achtig object met alleen wat de handler gebruikt. */
function request(body, { headers = {} } = {}) {
  return {
    headers: { get: (name) => headers[name.toLowerCase()] || headers[name] || null },
    json: async () => {
      if (body === undefined) throw new Error('geen json');
      return body;
    },
  };
}

/** Een nep-client die elke rpc-aanroep vastlegt en een antwoord teruggeeft. */
function fakeSupabase(result = { error: null }) {
  const calls = [];
  return {
    calls,
    client: {
      rpc(name, params) {
        calls.push({ name, params });
        return typeof result === 'function' ? result(name, params) : Promise.resolve(result);
      },
    },
  };
}

function handlersFor(supabase, extra = {}) {
  return createRestaurantViewHandlers({
    getSupabase: () => supabase,
    restaurants: restaurantsData,
    ...extra,
  });
}

test('bekeken-route: een bekend restaurant telt één keer, met alleen de id', async () => {
  const fake = fakeSupabase();
  const handler = handlersFor(fake.client);
  const result = await handler.countRestaurantView(request({ restaurant: RESTAURANT }));
  assert.deepEqual(result, { status: 204, body: null });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0], { name: VIEW_FUNCTION, params: { p_restaurant_id: RESTAURANT } });
});

test('bekeken-route: een onbekend restaurant telt niet', async () => {
  const fake = fakeSupabase();
  const handler = handlersFor(fake.client);
  assert.equal((await handler.countRestaurantView(request({ restaurant: 'geen-restaurant' }))).status, 204);
  assert.equal((await handler.countRestaurantView(request({ restaurant: '999' }))).status, 204);
  assert.equal(fake.calls.length, 0, 'de database wordt niet eens benaderd');
});

test('bekeken-route: een kapot, te groot of leeg verzoek telt niet', async () => {
  const fake = fakeSupabase();
  const handler = handlersFor(fake.client);
  assert.equal((await handler.countRestaurantView(request(undefined))).status, 204);
  assert.equal((await handler.countRestaurantView(request({}))).status, 204);
  assert.equal((await handler.countRestaurantView(request({ restaurant: 6 }))).status, 204);
  assert.equal((await handler.countRestaurantView(request([RESTAURANT]))).status, 204);
  assert.equal((await handler.countRestaurantView({
    headers: { get: () => '4096' },
    json: async () => ({ restaurant: RESTAURANT }),
  })).status, 204);
  assert.equal((await handler.countRestaurantView(null)).status, 204);
  assert.equal(fake.calls.length, 0);
});

test('bekeken-route: extra velden in het verzoek bereiken de database nooit', async () => {
  const fake = fakeSupabase();
  const handler = handlersFor(fake.client);
  await handler.countRestaurantView(
    request({ restaurant: RESTAURANT, userId: 'abc', ip: '1.2.3.4', cookie: 's=1', session: 'x' })
  );
  assert.deepEqual(fake.calls[0].params, { p_restaurant_id: RESTAURANT });
});

test('bekeken-route: zonder migratie telt hij niets, zonder fout en zonder opnieuw te wachten', async () => {
  const fake = fakeSupabase({ error: { code: '42P01', message: 'relation "restaurant_views" does not exist' } });
  const handler = handlersFor(fake.client);
  assert.equal((await handler.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);
  assert.equal(handler.storageMissing(), true);
  // De tweede klik belt de database niet opnieuw.
  assert.equal((await handler.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);
  assert.equal(fake.calls.length, 1);
});

test('bekeken-route: zonder sleutel, met een netwerkfout of met een time-out altijd 204', async () => {
  const throwing = createRestaurantViewHandlers({
    getSupabase: () => { throw new Error('geen sleutel'); },
    restaurants: restaurantsData,
  });
  assert.equal((await throwing.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);

  const noClient = handlersFor(null);
  assert.equal((await noClient.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);

  const rejecting = handlersFor(fakeSupabase(() => Promise.reject(new Error('offline'))).client);
  assert.equal((await rejecting.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);

  const hanging = handlersFor(fakeSupabase(() => new Promise(() => {})).client, { timeoutMs: 10 });
  assert.equal((await hanging.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);
});

test('bekeken-route: hooguit één verzoek per seconde per restaurant', async () => {
  let clock = 1000;
  const fake = fakeSupabase();
  const handler = handlersFor(fake.client, { now: () => clock });
  assert.equal((await handler.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);
  assert.equal((await handler.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);
  assert.equal(fake.calls.length, 1, 'de tweede klik binnen de seconde telt niet');
  clock += 1000;
  assert.equal((await handler.countRestaurantView(request({ restaurant: RESTAURANT }))).status, 204);
  assert.equal(fake.calls.length, 2);
});

test('bekeken-route: de limiet is per restaurant', () => {
  let clock = 0;
  const limiter = createViewLimiter({ now: () => clock });
  assert.equal(limiter.allow('6'), true);
  assert.equal(limiter.allow('23'), true, 'een ander restaurant heeft zijn eigen venster');
  assert.equal(limiter.allow('6'), false);
  clock += 1000;
  assert.equal(limiter.allow('6'), true);
  assert.equal(limiter.allow('onbekend!'), false);
});
