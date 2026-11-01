'use strict';

// BE-46 (#106, criterium 2 en 3) — de API-handlers met een fictieve client.
//
// Geen Supabase, geen netwerk: de client hieronder is een klein nagebouwde
// PostgREST (select, insert, upsert, delete, rpc) met dezelfde vorm die de
// handlers gebruiken. Daarmee worden de load-bearing punten uit het contract
// getest: aanmaken, stemmen, vervangen, ongedaan maken, de sluitingstijd, het
// maximum van 50 stemmers, een onbekende sleutel en een ontbrekende tabel.
//
// De gerechten en de prijzen komen uit de echte projectdata, zodat een
// verkeerde aanname over de statische data meteen opvalt.

const assert = require('node:assert/strict');
const { test } = require('node:test');
// BE-74 (#185): de stemgerechten komen uit de kaarten van maart; deze tests
// draaien op de vaste kopie daarvan, niet op de levende data.
require('../test-fixtures/useFrozenData').useFrozenData('maart-2026');
const menusData = require('../../data/menus.json');
const restaurantsData = require('../../data/restaurants.json');
const { KIES_CLEANUP_FUNCTION, createKiesHandlers } = require('./kiesHandlers');

const DISH_ID = '6-diner-0-0';
const SECOND_DISH_ID = '6-diner-0-1';
const UNKNOWN_DISH_ID = '99-diner-0-0';
const DISH_NAME = 'Poussin';
const CODE = 'A'.repeat(22);
const STEMMER = 'b'.repeat(22);
const OTHER_STEMMER = 'c'.repeat(22);
const NEW_STEMMER = 'd'.repeat(22);
const NOW = Date.parse('2026-10-30T12:00:00.000Z');

/** Een verzoek zoals Next.js hem aan een route geeft. */
function request(body, { url = 'http://localhost/api/v1/kies', headers = {} } = {}) {
  return {
    url,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    json: async () => {
      if (body === undefined) throw new Error('geen json');
      return body;
    },
  };
}

function stemmingRow(overrides = {}) {
  return { code: CODE, dish_keys: [DISH_ID, SECOND_DISH_ID], sluit_om: null, ...overrides };
}

function voteRow(overrides = {}) {
  return { stemming_code: CODE, stemmer: STEMMER, roepnaam: 'Sam', dish_key: DISH_ID, lekker: true, ...overrides };
}

function handlersFor(client, overrides = {}) {
  return createKiesHandlers({
    getSupabase: () => client,
    menus: menusData,
    restaurants: restaurantsData,
    now: () => NOW,
    timeoutMs: 200,
    ...overrides,
  });
}

/**
 * De fictieve client. `failing` laat één of meer tabellen of de functie
 * ontbreken (42P01/42883), precies de fout van een nog niet toegepaste 0022.
 */
function fakeSupabase({ stemmingen = [], stemmen = [], failing = null, rpcResult = 2, hang = false } = {}) {
  const tables = {
    kies_stemmingen: stemmingen.map((row) => ({ sluit_om: null, created_at: '2026-10-30T09:00:00.000Z', ...row })),
    kies_stemmen: stemmen.map((row, index) => ({ stem_id: index + 1, gestemd_op: '2026-10-30T09:30:00.000Z', ...row })),
  };
  const calls = [];
  const rpcCalls = [];

  function errorFor(table) {
    if (!failing) return null;
    if (table === 'rpc') {
      return failing.rpc ? { code: '42883', message: `function ${KIES_CLEANUP_FUNCTION} does not exist` } : null;
    }
    return failing[table] ? { code: '42P01', message: `relation "${table}" does not exist` } : null;
  }

  function matches(row, filters) {
    return filters.every(([column, value]) => row[column] === value);
  }

  function execute(query, one) {
    calls.push({
      table: query.table,
      action: query.action,
      filters: query.filters.slice(),
      payload: query.payload,
      options: query.options,
    });
    const error = errorFor(query.table);
    if (error) return Promise.resolve({ data: null, error });
    if (hang) return new Promise(() => {});
    const rows = tables[query.table];

    if (query.action === 'select') {
      const found = rows.filter((row) => matches(row, query.filters));
      return Promise.resolve({ data: one ? found[0] || null : found, error: null });
    }
    if (query.action === 'insert') {
      if (rows.some((row) => row.code === query.payload.code)) {
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } });
      }
      rows.push({ sluit_om: null, created_at: '2026-10-30T12:00:00.000Z', ...query.payload });
      return Promise.resolve({ data: { code: query.payload.code }, error: null });
    }
    if (query.action === 'upsert') {
      const existing = rows.filter(
        (row) => row.stemming_code === query.payload.stemming_code
          && row.stemmer === query.payload.stemmer
          && row.dish_key === query.payload.dish_key,
      );
      if (existing.length === 0) rows.push({ stem_id: rows.length + 1, ...query.payload });
      else Object.assign(existing[0], query.payload);
      return Promise.resolve({ data: [query.payload], error: null });
    }
    if (query.action === 'delete') {
      const kept = rows.filter((row) => !matches(row, query.filters));
      tables[query.table] = kept;
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: null, error: { message: `unsupported ${query.action}` } });
  }

  function from(table) {
    const query = { table, action: 'select', filters: [], payload: null, options: null };
    const api = {
      select() { return api; },
      insert(payload) { query.action = 'insert'; query.payload = payload; return api; },
      upsert(payload, options) { query.action = 'upsert'; query.payload = payload; query.options = options; return api; },
      delete() { query.action = 'delete'; return api; },
      eq(column, value) { query.filters.push([column, value]); return api; },
      single() { return execute(query, true); },
      maybeSingle() { return execute(query, true); },
      then(onFulfilled, onRejected) { return execute(query, false).then(onFulfilled, onRejected); },
    };
    return api;
  }

  return {
    from,
    rpc(name, params) {
      rpcCalls.push({ name, params });
      const error = errorFor('rpc');
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: rpcResult, error: null });
    },
    calls,
    rpcCalls,
    tables,
  };
}


// ─── Aanmaken ──────────────────────────────────────────────────────────────

test('POST /api/v1/kies maakt een stemming met een niet te raden code', async () => {
  const client = fakeSupabase();
  const handlers = handlersFor(client);
  const result = await handlers.createStemming(request({ dish_keys: [DISH_ID, SECOND_DISH_ID] }));
  assert.equal(result.status, 201);
  assert.match(result.body.code, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(result.body.href, `/kies/${result.body.code}`);
  assert.deepEqual(result.body.dishKeys, [DISH_ID, SECOND_DISH_ID]);
  assert.equal(result.body.dishes, 2);
  assert.equal(result.body.sluitOm, null);
  assert.equal(client.tables.kies_stemmingen.length, 1);
  assert.deepEqual(client.tables.kies_stemmingen[0].dish_keys, [DISH_ID, SECOND_DISH_ID]);
  assert.equal(client.tables.kies_stemmingen[0].sluit_om, null);
});

test('POST /api/v1/kies bewaart een sluitingstijd als ISO-tijdstip', async () => {
  const client = fakeSupabase();
  const result = await handlersFor(client).createStemming(
    request({ dish_keys: [DISH_ID], sluit_om: '2026-10-30T18:00:00+01:00' }),
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.sluitOm, '2026-10-30T17:00:00.000Z');
  assert.equal(client.tables.kies_stemmingen[0].sluit_om, '2026-10-30T17:00:00.000Z');
});

test('POST /api/v1/kies weigert een onbekende sleutel via de deeplinkresolutie', async () => {
  const client = fakeSupabase();
  const result = await handlersFor(client).createStemming(request({ dish_keys: [DISH_ID, UNKNOWN_DISH_ID] }));
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'unknown_dish_key');
  assert.equal(result.body.skipped, 1);
  assert.equal(client.tables.kies_stemmingen.length, 0, 'er wordt niets geschreven');
});

test('POST /api/v1/kies weigert een lege lijst, een kapot verzoek en een onzin-tijd', async () => {
  const handlers = handlersFor(fakeSupabase());
  for (const body of [{}, { dish_keys: [] }, { dish_keys: ['geen-id'] }, { dish_keys: [DISH_ID], sluitOm: 'x' }]) {
    const result = await handlers.createStemming(request(body));
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.ok(result.body.error);
  }
  assert.equal((await handlers.createStemming(request(undefined))).status, 400);
  assert.equal((await handlers.createStemming(request([DISH_ID]))).status, 400, 'geen array als body');
});

test('POST /api/v1/kies weigert een sluitingstijd die al voorbij is', async () => {
  const result = await handlersFor(fakeSupabase()).createStemming(
    request({ dish_keys: [DISH_ID], sluit_om: '2026-10-30T11:59:00.000Z' }),
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'sluit_om_in_past');
});

test('zonder migratie antwoordt het aanmaken met de ene nette melding', async () => {
  const result = await handlersFor(fakeSupabase({ failing: { kies_stemmingen: true } }))
    .createStemming(request({ dish_keys: [DISH_ID] }));
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'kies_unavailable');
  assert.equal(result.body.message, 'Samen kiezen is nog niet beschikbaar');
});

test('zonder serverclient (geen sleutel) is het aanmaken ook niet beschikbaar', async () => {
  const handlers = createKiesHandlers({
    getSupabase: () => { throw new Error('Supabase is not configured'); },
    menus: menusData,
    restaurants: restaurantsData,
  });
  const result = await handlers.createStemming(request({ dish_keys: [DISH_ID] }));
  assert.equal(result.status, 503);
  assert.equal(result.body.message, 'Samen kiezen is nog niet beschikbaar');
});


// ─── Lezen ─────────────────────────────────────────────────────────────────

test('GET /api/v1/kies/<code> geeft de gerechten, de sluitingstijd en de uitslag', async () => {
  const client = fakeSupabase({
    stemmingen: [stemmingRow({ sluit_om: '2026-10-30T17:00:00.000Z' })],
    stemmen: [voteRow(), voteRow({ stemmer: OTHER_STEMMER, roepnaam: 'Noa', lekker: false })],
  });
  const result = await handlersFor(client).readStemmingRequest(request(null), { code: CODE });
  assert.equal(result.status, 200);
  assert.equal(result.body.code, CODE);
  assert.equal(result.body.gesloten, false);
  assert.equal(result.body.sluitOm, '2026-10-30T17:00:00.000Z');
  const [first, second] = result.body.dishes;
  assert.equal(first.name, DISH_NAME);
  assert.equal(first.price, '€20,95');
  assert.equal(first.restaurant, 'Brasserie Bardot');
  assert.ok(first.description.length > 0);
  assert.equal(second.id, SECOND_DISH_ID);
  assert.equal(result.body.stemmers, 2);
  assert.equal(result.body.stemmen, 2);
  assert.equal(result.body.uitslag[0].id, DISH_ID);
  assert.equal(result.body.uitslag[0].lekker, 1);
  assert.equal(result.body.uitslag[0].lieverNiet, 1);
  assert.deepEqual(result.body.uitslag[0].kiezers, ['Sam']);
});

test('na de sluitingstijd zegt de uitlezing dat de stemming gesloten is', async () => {
  const client = fakeSupabase({ stemmingen: [stemmingRow({ sluit_om: '2026-10-30T11:00:00.000Z' })] });
  const result = await handlersFor(client).readStemmingRequest(request(null), { code: CODE });
  assert.equal(result.status, 200);
  assert.equal(result.body.gesloten, true);
});

test('een onbekende of ongeldige code geeft 404, nooit een gok', async () => {
  const handlers = handlersFor(fakeSupabase());
  assert.equal((await handlers.readStemmingRequest(request(null), { code: CODE })).status, 404);
  assert.equal((await handlers.readStemmingRequest(request(null), { code: 'kort' })).status, 404);
  assert.equal((await handlers.readStemmingRequest(request(null), {})).status, 404);
});

test('een stemming waarvan de gerechten verdwenen zijn, bestaat niet meer', async () => {
  const client = fakeSupabase({ stemmingen: [stemmingRow({ dish_keys: [UNKNOWN_DISH_ID] })] });
  const result = await handlersFor(client).readStemmingRequest(request(null), { code: CODE });
  assert.equal(result.status, 404);
});

test('zonder migratie is ook het lezen niet beschikbaar', async () => {
  const result = await handlersFor(fakeSupabase({ failing: { kies_stemmingen: true } }))
    .readStemmingRequest(request(null), { code: CODE });
  assert.equal(result.status, 503);
  assert.equal(result.body.message, 'Samen kiezen is nog niet beschikbaar');
});


// ─── Stemmen ───────────────────────────────────────────────────────────────

test('POST /stem bewaart een stem en geeft de nieuwe uitslag terug', async () => {
  const client = fakeSupabase({ stemmingen: [stemmingRow()] });
  const result = await handlersFor(client).vote(
    request({ stemmer: STEMMER, roepnaam: ' Sam ', dishKey: DISH_ID, lekker: true }),
    { code: CODE },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.vervangen, false);
  assert.equal(result.body.stemmers, 1);
  assert.equal(result.body.uitslag[0].lekker, 1);
  const upsert = client.calls.find((call) => call.action === 'upsert');
  assert.equal(upsert.payload.stemming_code, CODE);
  assert.equal(upsert.payload.stemmer, STEMMER);
  assert.equal(upsert.payload.roepnaam, 'Sam', 'de roepnaam wordt plat en getrimd');
  assert.equal(upsert.payload.dish_key, DISH_ID);
  assert.equal(upsert.payload.lekker, true);
  assert.equal(upsert.options.onConflict, 'stemming_code,stemmer,dish_key');
  assert.equal(client.tables.kies_stemmen.length, 1);
});

test('een tweede stem op hetzelfde gerecht vervangt de vorige', async () => {
  const client = fakeSupabase({ stemmingen: [stemmingRow()], stemmen: [voteRow({ lekker: true })] });
  const result = await handlersFor(client).vote(
    request({ stemmer: STEMMER, roepnaam: 'Sam', dishKey: DISH_ID, lekker: false }),
    { code: CODE },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.vervangen, true);
  assert.equal(result.body.stemmen, 1, 'nog steeds één stem');
  // De rij van dit gerecht: 0 lekker, 1 liever niet. (Het andere gerecht staat
  // bovenaan, want bij een gelijke stand wint de minste "liever niet".)
  const row = result.body.uitslag.find((entry) => entry.id === DISH_ID);
  assert.equal(row.lekker, 0);
  assert.equal(row.lieverNiet, 1);
  assert.deepEqual(row.lieverNietKiezers, ['Sam']);
  assert.equal(client.tables.kies_stemmen.length, 1);
});

test('POST /stem weigert een gerecht dat niet in de stemming zit', async () => {
  const client = fakeSupabase({ stemmingen: [stemmingRow()] });
  const result = await handlersFor(client).vote(
    request({ stemmer: STEMMER, roepnaam: 'Sam', dishKey: UNKNOWN_DISH_ID, lekker: true }),
    { code: CODE },
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'dish_not_in_stemming');
  assert.equal(client.calls.filter((call) => call.action === 'upsert').length, 0);
});

test('POST /stem weigert een kapot verzoek: kenmerk, roepnaam, sleutel en lekker', async () => {
  const client = fakeSupabase({ stemmingen: [stemmingRow()] });
  const handlers = handlersFor(client);
  const cases = [
    [{ roepnaam: 'Sam', dishKey: DISH_ID, lekker: true }, 'invalid_stemmer'],
    [{ stemmer: 'kort', roepnaam: 'Sam', dishKey: DISH_ID, lekker: true }, 'invalid_stemmer'],
    [{ stemmer: STEMMER, roepnaam: '', dishKey: DISH_ID, lekker: true }, 'invalid_roepnaam'],
    [{ stemmer: STEMMER, roepnaam: 'A'.repeat(25), dishKey: DISH_ID, lekker: true }, 'invalid_roepnaam'],
    [{ stemmer: STEMMER, roepnaam: 'Sam', lekker: true }, 'invalid_dish_key'],
    [{ stemmer: STEMMER, roepnaam: 'Sam', dishKey: DISH_ID, lekker: 'ja' }, 'invalid_lekker'],
    [{ stemmer: STEMMER, roepnaam: 'Sam', dishKey: DISH_ID }, 'invalid_lekker'],
  ];
  for (const [body, error] of cases) {
    const result = await handlers.vote(request(body), { code: CODE });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.body.error, error, JSON.stringify(body));
  }
  assert.equal(client.calls.filter((call) => call.action === 'upsert').length, 0, 'er wordt niets geschreven');
});

test('POST /stem weigert na de sluitingstijd en laat de uitslag zien', async () => {
  const client = fakeSupabase({
    stemmingen: [stemmingRow({ sluit_om: '2026-10-30T11:00:00.000Z' })],
    stemmen: [voteRow()],
  });
  const result = await handlersFor(client).vote(
    request({ stemmer: OTHER_STEMMER, roepnaam: 'Noa', dishKey: DISH_ID, lekker: true }),
    { code: CODE },
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'closed');
  assert.equal(result.body.message, 'De stemming is gesloten');
  assert.ok(Array.isArray(result.body.uitslag), 'de stand blijft zichtbaar');
  assert.equal(client.calls.filter((call) => call.action === 'upsert').length, 0);
});


test('POST /stem weigert de 51e stemmer, maar laat een bestaande stemmer door', async () => {
  const stemmen = [];
  for (let index = 0; index < 50; index += 1) {
    stemmen.push(voteRow({ stemmer: `${String(index).padStart(22, '0')}`, roepnaam: `Stemmer ${index}` }));
  }
  const client = fakeSupabase({ stemmingen: [stemmingRow()], stemmen });
  const handlers = handlersFor(client);

  const extra = await handlers.vote(
    request({ stemmer: NEW_STEMMER, roepnaam: 'Een na laatste', dishKey: SECOND_DISH_ID, lekker: true }),
    { code: CODE },
  );
  assert.equal(extra.status, 409);
  assert.equal(extra.body.error, 'full');
  assert.equal(extra.body.message, 'Deze stemming heeft het maximum van 50 stemmers bereikt');
  assert.equal(extra.body.stemmers, 50);

  const existing = await handlers.vote(
    request({ stemmer: stemmen[0].stemmer, roepnaam: 'Stemmer 0', dishKey: SECOND_DISH_ID, lekker: true }),
    { code: CODE },
  );
  assert.equal(existing.status, 200, 'wie al meedoet mag zijn stem nog vervangen');
});

test('POST /stem zonder migratie of zonder client is niet beschikbaar', async () => {
  const missing = await handlersFor(fakeSupabase({ stemmingen: [stemmingRow()], failing: { kies_stemmen: true } })).vote(
    request({ stemmer: STEMMER, roepnaam: 'Sam', dishKey: DISH_ID, lekker: true }),
    { code: CODE },
  );
  assert.equal(missing.status, 503);

  const noClient = createKiesHandlers({ menus: menusData, restaurants: restaurantsData });
  const result = await noClient.vote(
    request({ stemmer: STEMMER, roepnaam: 'Sam', dishKey: DISH_ID, lekker: true }),
    { code: CODE },
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.message, 'Samen kiezen is nog niet beschikbaar');
});

// ─── Ongedaan maken ────────────────────────────────────────────────────────

test('DELETE /stem maakt de laatste stem van die stemmer ongedaan', async () => {
  const client = fakeSupabase({
    stemmingen: [stemmingRow()],
    stemmen: [
      voteRow({ dish_key: DISH_ID, gestemd_op: '2026-10-30T10:00:00.000Z' }),
      voteRow({ dish_key: SECOND_DISH_ID, gestemd_op: '2026-10-30T10:05:00.000Z' }),
      voteRow({ stemmer: OTHER_STEMMER, roepnaam: 'Noa', dish_key: DISH_ID }),
    ],
  });
  const result = await handlersFor(client).undoVote(
    request({ stemmer: STEMMER, roepnaam: 'Sam', dishKey: SECOND_DISH_ID, lekker: true }),
    { code: CODE },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.undone, true);
  assert.equal(result.body.dishKey, SECOND_DISH_ID, 'de laatste, niet zomaar een');
  assert.equal(result.body.stemmen, 2);
  assert.equal(result.body.stemmers, 2);
  assert.equal(client.tables.kies_stemmen.length, 2);
  const del = client.calls.find((call) => call.action === 'delete');
  assert.deepEqual(del.filters, [
    ['stemming_code', CODE],
    ['stemmer', STEMMER],
    ['dish_key', SECOND_DISH_ID],
  ]);
});

test('DELETE /stem zonder eigen stem is geen fout', async () => {
  const client = fakeSupabase({ stemmingen: [stemmingRow()], stemmen: [voteRow()] });
  const result = await handlersFor(client).undoVote(request({ stemmer: OTHER_STEMMER }), { code: CODE });
  assert.equal(result.status, 200);
  assert.equal(result.body.undone, false);
  assert.equal(client.calls.filter((call) => call.action === 'delete').length, 0);
});

test('DELETE /stem leest de stemmer ook uit de query, maar nooit zonder', async () => {
  const client = fakeSupabase({ stemmingen: [stemmingRow()], stemmen: [voteRow()] });
  const handlers = handlersFor(client);
  const viaQuery = await handlers.undoVote(
    request(undefined, { url: `http://localhost/api/v1/kies/${CODE}/stem?stemmer=${STEMMER}` }),
    { code: CODE },
  );
  assert.equal(viaQuery.status, 200);
  assert.equal(viaQuery.body.undone, true);

  const none = await handlers.undoVote(request({}), { code: CODE });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'invalid_stemmer');
});

test('DELETE /stem weigert na de sluitingstijd', async () => {
  const client = fakeSupabase({
    stemmingen: [stemmingRow({ sluit_om: '2026-10-30T11:00:00.000Z' })],
    stemmen: [voteRow()],
  });
  const result = await handlersFor(client).undoVote(request({ stemmer: STEMMER }), { code: CODE });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'closed');
  assert.equal(client.calls.filter((call) => call.action === 'delete').length, 0);
});

// ─── Opruimen ──────────────────────────────────────────────────────────────

test('het opruimen roept de functie uit 0022 aan met zeven dagen', async () => {
  const client = fakeSupabase({ rpcResult: 3 });
  const result = await handlersFor(client).cleanupStemmingen();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, verwijderd: 3 });
  assert.deepEqual(client.rpcCalls, [{ name: KIES_CLEANUP_FUNCTION, params: { p_dagen: 7 } }]);
});

test('zonder migratie of zonder client meldt het opruimen netjes dat het niet kan', async () => {
  const missing = await handlersFor(fakeSupabase({ failing: { rpc: true } })).cleanupStemmingen();
  assert.equal(missing.status, 503);
  assert.deepEqual(missing.body, { ok: false });

  const noClient = createKiesHandlers({ menus: menusData, restaurants: restaurantsData });
  const result = await noClient.cleanupStemmingen();
  assert.equal(result.status, 503);
});

// ─── Een hangende of kapotte database ──────────────────────────────────────

test('een database die niet antwoordt levert een fout, geen hang', async () => {
  const client = fakeSupabase({ hang: true });
  const handlers = handlersFor(client, { timeoutMs: 20 });
  const created = await handlers.createStemming(request({ dish_keys: [DISH_ID] }));
  assert.equal(created.status, 500);
  assert.equal(created.body.error, 'kies_failed');
  const read = await handlers.readStemmingRequest(request(null), { code: CODE });
  assert.equal(read.status, 500);
});

