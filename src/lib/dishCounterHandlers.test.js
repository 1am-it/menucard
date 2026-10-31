'use strict';

// BE-44 (#105, criterium 5) — de tellerroute met een nep-client.
//
// Geen Supabase, geen netwerk en geen Next: de handler krijgt zijn
// afhankelijkheden als parameters (dishCounterHandlers.js). Wat hier bewezen
// wordt:
//   - de drie geldige gebeurtenissen tellen elk één keer, met de juiste
//     parameters en via de bestaande databasefunctie;
//   - een onbekend event, een onbekend gerecht, een kapot verzoek en een leeg
//     verzoek tellen niet;
//   - een ontbrekende tabel of functie (migratie nog niet toegepast) telt niet
//     en laat de route niet nóg eens wachten;
//   - zonder sleutel, met een netwerkfout of met een time-out: geen fout naar
//     de browser, altijd 204;
//   - de limiet van één verzoek per seconde per gerecht en gebeurtenis;
//   - er gaat nooit meer dan { dish, event } naar de database.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const menusData = require('../../data/menus.json');
const { createDishCounterHandlers } = require('./dishCounterHandlers');

const DISH = '6-diner-0-0';

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

function handlerWith(client, options = {}) {
  return createDishCounterHandlers({
    getSupabase: () => client,
    menus: menusData,
    ...options,
  });
}

test('tellerroute: de drie gebeurtenissen tellen elk één keer via increment_dish_counter', async () => {
  const fake = fakeSupabase();
  const handlers = handlerWith(fake.client);

  for (const event of ['gedeeld', 'bewaard', 'reserveren']) {
    const result = await handlers.countDishEvent(request({ dish: DISH, event }));
    assert.deepEqual(result, { status: 204, body: null });
  }

  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.calls.map((call) => call.params.p_event), ['gedeeld', 'bewaard', 'reserveren']);
  assert.deepEqual(fake.calls.map((call) => call.params.p_dish_key), [DISH, DISH, DISH]);
  for (const call of fake.calls) {
    assert.equal(call.name, 'increment_dish_counter');
    // De enige parameters die de route doorgeeft: gerecht en gebeurtenis.
    assert.deepEqual(Object.keys(call.params).sort(), ['p_dish_key', 'p_event']);
  }
});

test('tellerroute: een onbekend event, een onbekend gerecht of een kapot verzoek telt niet', async () => {
  const fake = fakeSupabase();
  const handlers = handlerWith(fake.client);

  const cases = [
    request({ dish: DISH, event: 'liked' }),
    request({ dish: DISH, event: '' }),
    request({ dish: DISH }),
    request({ dish: '99-diner-0-0', event: 'gedeeld' }),
    request({ dish: '6-diner-9-9', event: 'bewaard' }),
    request({ dish: 'poussin', event: 'gedeeld' }),
    request({ event: 'gedeeld' }),
    request({ dish: DISH, event: 'gedeeld', userId: 'abc' }, { headers: { 'content-length': '9000' } }),
    request(undefined),
    request(['6-diner-0-0', 'gedeeld']),
    null,
  ];

  for (const item of cases) {
    assert.deepEqual(await handlers.countDishEvent(item), { status: 204, body: null });
  }
  assert.equal(fake.calls.length, 0, 'er is niets geteld');
});

test('tellerroute: zonder sleutel, met een netwerkfout of met een fout in het antwoord blijft het 204', async () => {
  const withoutKey = createDishCounterHandlers({
    menus: menusData,
    getSupabase: () => { throw new Error('Supabase is not configured'); },
  });
  assert.deepEqual(await withoutKey.countDishEvent(request({ dish: DISH, event: 'gedeeld' })), { status: 204, body: null });

  const noClient = createDishCounterHandlers({ menus: menusData, getSupabase: () => null });
  assert.deepEqual(await noClient.countDishEvent(request({ dish: DISH, event: 'gedeeld' })), { status: 204, body: null });

  const networkDown = handlerWith({ rpc: () => Promise.reject(new Error('fetch failed')) });
  assert.deepEqual(await networkDown.countDishEvent(request({ dish: DISH, event: 'bewaard' })), { status: 204, body: null });

  const rpcThrows = handlerWith({ rpc: () => { throw new Error('rpc ontplofte'); } });
  assert.deepEqual(await rpcThrows.countDishEvent(request({ dish: DISH, event: 'reserveren' })), { status: 204, body: null });

  const otherError = handlerWith({ rpc: () => Promise.resolve({ error: { code: '23505', message: 'duplicate key' } }) });
  assert.deepEqual(await otherError.countDishEvent(request({ dish: DISH, event: 'gedeeld' })), { status: 204, body: null });
});

test('tellerroute: ontbrekende tabel of functie telt niet en wordt onthouden (veilig falen)', async () => {
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const fake = fakeSupabase({ error: { code, message: 'relation "dish_counters" does not exist' } });
    const handlers = handlerWith(fake.client);

    assert.deepEqual(await handlers.countDishEvent(request({ dish: DISH, event: 'gedeeld' })), { status: 204, body: null });
    assert.equal(fake.calls.length, 1);
    assert.equal(handlers.storageMissing(), true, code);

    // De volgende klik wacht niet nog eens op dezelfde fout.
    assert.deepEqual(await handlers.countDishEvent(request({ dish: DISH, event: 'bewaard' })), { status: 204, body: null });
    assert.equal(fake.calls.length, 1, `${code}: niet opnieuw geprobeerd`);
  }
});

test('tellerroute: een time-out telt niet en is geen fout naar de browser', async () => {
  let calls = 0;
  const handlers = handlerWith({
    rpc: () => { calls += 1; return new Promise(() => {}); },
  }, { timeoutMs: 20 });

  const started = Date.now();
  const result = await handlers.countDishEvent(request({ dish: DISH, event: 'gedeeld' }));
  const elapsed = Date.now() - started;

  assert.deepEqual(result, { status: 204, body: null });
  assert.equal(calls, 1);
  assert.ok(elapsed < 2000, `de route wachtte ${elapsed} ms`);
  // Een time-out is geen "tabel ontbreekt": de volgende klik mag het gewoon
  // weer proberen (het was misschien een trage verbinding).
  assert.equal(handlers.storageMissing(), false);
});

test('tellerroute: hooguit één verzoek per seconde per gerecht en gebeurtenis', async () => {
  let clock = 5000;
  const fake = fakeSupabase();
  const handlers = handlerWith(fake.client, { now: () => clock });

  await handlers.countDishEvent(request({ dish: DISH, event: 'gedeeld' }));
  await handlers.countDishEvent(request({ dish: DISH, event: 'gedeeld' }));
  assert.equal(fake.calls.length, 1, 'de tweede klik binnen de seconde telt niet');

  // Een andere gebeurtenis en een ander gerecht zijn eigen tellers.
  await handlers.countDishEvent(request({ dish: DISH, event: 'bewaard' }));
  await handlers.countDishEvent(request({ dish: '6-diner-0-1', event: 'gedeeld' }));
  assert.equal(fake.calls.length, 3);

  clock += 1000;
  await handlers.countDishEvent(request({ dish: DISH, event: 'gedeeld' }));
  assert.equal(fake.calls.length, 4);
});

// BE-67 (ronde 3) — de bewaar- en deelknop bij een daghap of dagmenu gebruiken
// dezelfde tellerroute. Een nep-client met `from().insert()` legt vast wat er
// geschreven wordt; er komt geen Supabase en geen netwerk aan te pas.

const AANBOD = 'daghap-6-42';

/** Een nep-client met zowel de tellerfunctie als de geschiedenistabel. */
function fakeBeheerSupabase(insertResult = { error: null }) {
  const rows = [];
  return {
    rows,
    client: {
      rpc() {
        return Promise.resolve({ error: null });
      },
      from(table) {
        return {
          insert(row) {
            rows.push({ table, row });
            return Promise.resolve(typeof insertResult === 'function' ? insertResult(row) : insertResult);
          },
        };
      },
    },
  };
}

test('tellerroute: bewaard en gedeeld bij een aanbod schrijven één rij in daghap_gebeurtenissen', async () => {
  const fake = fakeBeheerSupabase();
  const handlers = handlerWith(fake.client, { now: () => Date.UTC(2026, 9, 31, 10, 0, 0) });

  const bewaard = await handlers.countDishEvent(request({ dish: AANBOD, event: 'bewaard' }));
  const gedeeld = await handlers.countDishEvent(request({ dish: AANBOD, event: 'gedeeld' }));

  assert.deepEqual(bewaard, { status: 204, body: null });
  assert.deepEqual(gedeeld, { status: 204, body: null });
  assert.equal(fake.rows.length, 2);
  assert.equal(fake.rows[0].table, 'daghap_gebeurtenissen');
  assert.deepEqual(fake.rows[0].row, {
    aanbod_id: 42,
    restaurant_id: '6',
    actie: 'bewaard',
    door: null,
    apparaat: null,
    gegevens: {},
    moment: '2026-10-31T10:00:00.000Z',
  });
  assert.equal(fake.rows[1].row.actie, 'gedeeld');
  // Niets over de bezoeker: geen apparaat, geen account, geen cookie.
  for (const { row } of fake.rows) {
    assert.equal(row.door, null);
    assert.equal(row.apparaat, null);
    assert.deepEqual(row.gegevens, {});
    assert.deepEqual(Object.keys(row).sort(), [
      'aanbod_id', 'actie', 'apparaat', 'door', 'gegevens', 'moment', 'restaurant_id',
    ]);
  }
});

test('tellerroute: een aanbod telt niet bij reserveren, een onbekend event of een onbruikbare sleutel', async () => {
  const fake = fakeBeheerSupabase();
  const handlers = handlerWith(fake.client);

  for (const body of [
    { dish: AANBOD, event: 'reserveren' },
    { dish: AANBOD, event: 'bekeken' },
    { dish: AANBOD, event: 'onbekend' },
    { dish: 'daghap-6-', event: 'bewaard' },
    { dish: 'daghap-6-abc', event: 'bewaard' },
    { dish: DISH, event: 'bewaard' },
  ]) {
    const result = await handlers.countDishEvent(request(body));
    assert.deepEqual(result, { status: 204, body: null });
  }

  assert.equal(fake.rows.filter((entry) => entry.table === 'daghap_gebeurtenissen').length, 0);
});

test('tellerroute: zonder 0026 (de insert faalt) blijft het 204 en telt een gerecht gewoon door', async () => {
  // De check op `actie` kent de waarde nog niet: Postgres weigert de rij.
  const fake = fakeBeheerSupabase({ error: { code: '23514', message: 'new row violates check constraint' } });
  const handlers = handlerWith(fake.client);

  const result = await handlers.countDishEvent(request({ dish: AANBOD, event: 'gedeeld' }));

  assert.deepEqual(result, { status: 204, body: null });
  assert.equal(fake.rows.length, 1);
  // Een geweigerde rij is geen ontbrekende opslag: het gerecht telt door.
  assert.equal(handlers.storageMissing(), false);
});

test('tellerroute: een aanbod telt hooguit één keer per seconde per sleutel en gebeurtenis', async () => {
  let clock = 9000;
  const fake = fakeBeheerSupabase();
  const handlers = handlerWith(fake.client, { now: () => clock });

  await handlers.countDishEvent(request({ dish: AANBOD, event: 'gedeeld' }));
  await handlers.countDishEvent(request({ dish: AANBOD, event: 'gedeeld' }));
  assert.equal(fake.rows.length, 1);

  await handlers.countDishEvent(request({ dish: AANBOD, event: 'bewaard' }));
  assert.equal(fake.rows.length, 2);

  clock += 1000;
  await handlers.countDishEvent(request({ dish: AANBOD, event: 'gedeeld' }));
  assert.equal(fake.rows.length, 3);
});

