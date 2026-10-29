'use strict';

// BE-45 (#114) — de serverkant van de tellertabel, met een fictieve client.
//
// Wat hier bewezen wordt (contract criterium 1 en de rollen/defecten):
//   - `internal` krijgt 200 en precies de vorm van het contract;
//   - `editor` en `owner` krijgen 403 en er wordt dan niets gelezen;
//   - een ongeldige periode wordt 7 (en de query gebruikt de 7 UTC-dagen);
//   - de periode filtert op UTC-dagen, niet op de lokale dag;
//   - een ontbrekende tabel, een onbereikbare database en een ontbrekende
//     sleutel geven alle drie "Tellers zijn nu niet beschikbaar.";
//   - een lange periode leest in pagina's en telt alles op;
//   - de route leest alleen de vier tellerkolommen en schrijft niets.
//
// FICTIONELE DATA: de client en de rijen zijn verzonnen; er komt geen echte
// Supabase-URL of sleutel aan te pas.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  COLUMNS,
  PAGE_SIZE,
  TABLE,
  createDishCounterReportHandlers,
  periodFromRequest,
} = require('./dishCounterReportHandlers');
const { FORBIDDEN_MESSAGE, UNAVAILABLE_MESSAGE } = require('./dishCounterReport');

const MENUS = {
  '7-diner': { name: 'Fictief Restaurant', categories: [{ name: 'Hoofdgerechten', items: [{ name: 'Stoofvlees' }] }] },
};
const RESTAURANTS = { 7: { name: 'Fictief Restaurant' } };
const NOW = () => new Date('2026-10-29T12:00:00Z');

/**
 * Een nep-client die precies het deel van de supabase-js-API nabootst dat deze
 * handler gebruikt, en elke aanroep vastlegt.
 */
function createFakeSupabase({ rows = [], error = null, throwOnFrom = null, pages = null } = {}) {
  const calls = [];
  const queries = [];

  function answer(from, to) {
    if (pages) return Promise.resolve({ data: pages[queries.length - 1] || [], error });
    return Promise.resolve({ data: rows.slice(from, to + 1), error });
  }

  function buildQuery(query) {
    const api = {
      select(columns) {
        query.select = columns;
        calls.push({ step: 'select', columns });
        return api;
      },
      gte(column, value) {
        query.gte = [column, value];
        calls.push({ step: 'gte', column, value });
        return api;
      },
      lte(column, value) {
        query.lte = [column, value];
        calls.push({ step: 'lte', column, value });
        return api;
      },
      order(column, options) {
        query.order = [...(query.order || []), [column, options && options.ascending === false ? 'desc' : 'asc']];
        return api;
      },
      range(from, to) {
        query.range = [from, to];
        calls.push({ step: 'range', from, to });
        return answer(from, to);
      },
    };
    return api;
  }

  return {
    calls,
    queries,
    from(table) {
      calls.push({ step: 'from', table });
      if (throwOnFrom) throw throwOnFrom;
      const query = { table };
      queries.push(query);
      return buildQuery(query);
    },
    // Niets in deze route mag schrijven.
    insert() { throw new Error('insert is verboden'); },
    update() { throw new Error('update is verboden'); },
    delete() { throw new Error('delete is verboden'); },
    rpc() { throw new Error('rpc is verboden'); },
  };
}

function request(query = '') {
  return { url: `http://localhost:3000/api/internal/v1/tellers${query}`, headers: { get: () => null } };
}

function handlerFor(supabase, { roles = [{ role: 'internal' }], now = NOW } = {}) {
  return createDishCounterReportHandlers({
    authenticate: async () => ({ ok: true, userId: 'fixture-user', roles }),
    getSupabase: () => supabase,
    menus: MENUS,
    restaurants: RESTAURANTS,
    now,
  });

test('interne medewerker: 200 met precies de vorm van het contract', async () => {
  const supabase = createFakeSupabase({ rows: ROWS });
  const { status, body } = await handlerFor(supabase).getTellers(request('?periode=7'));

  assert.equal(status, 200);
  assert.equal(body.periode, '7');
  assert.deepEqual(body.totalen, { gedeeld: 7, bewaard: 4, reserveren: 8 });
  assert.equal(body.rijen.length, 2);
  assert.deepEqual(Object.keys(body.rijen[0]), [
    'dishKey',
    'gerecht',
    'restaurant',
    'restaurantId',
    'gedeeld',
    'bewaard',
    'reserveren',
    'href',
    'onbekend',
  ]);
  assert.equal(body.rijen[0].dishKey, '7-diner-0-0');
  assert.equal(body.rijen[0].gerecht, 'Stoofvlees');
  assert.equal(body.rijen[0].restaurant, 'Fictief Restaurant');
  assert.equal(body.rijen[0].restaurantId, '7');
  assert.equal(body.rijen[0].gedeeld, 6);
  assert.equal(body.rijen[1].onbekend, true, 'een onbekende sleutel blijft in het antwoord');
  assert.equal(body.rijen[1].gerecht, '7-diner-4-4');

  // De query: de tabel uit 0021, alleen de vier tellerkolommen, de UTC-dagen.
  assert.equal(supabase.calls[0].table, TABLE);
  assert.equal(TABLE, 'dish_counters');
  assert.match(COLUMNS, /dish_key, day, shared, saved, reservation_clicks/);
  const query = supabase.queries[0];
  assert.equal(query.select, COLUMNS);
  assert.deepEqual(query.gte, ['day', '2026-10-23']);
  assert.deepEqual(query.lte, ['day', '2026-10-29']);
  assert.deepEqual(query.range, [0, PAGE_SIZE - 1]);
  assert.equal(PAGE_SIZE, 1000);
  // En niets schrijft.
  assert.equal(supabase.calls.filter((call) => ['insert', 'update', 'delete', 'rpc'].includes(call.step)).length, 0);
});

test('rollen: editor en owner krijgen 403 en er wordt niets gelezen', async () => {
  for (const roles of [
    [{ role: 'editor' }],
    [{ role: 'owner', restaurant_id: '7' }],
    [{ role: 'owner' }, { role: 'editor' }],
    [],
    null,
  ]) {
    const supabase = createFakeSupabase({ rows: ROWS });
    const { status, body } = await handlerFor(supabase, { roles }).getTellers(request('?periode=7'));
    assert.equal(status, 403, `rollen ${JSON.stringify(roles)} horen 403 te krijgen`);
    assert.equal(body.error, FORBIDDEN_MESSAGE);
    assert.equal(supabase.calls.length, 0, 'geen enkele leesactie vóór de rolcheck');
  }
});

test('een interne medewerker met een tweede rol houdt toegang; zonder sessie 401', async () => {
  const supabase = createFakeSupabase({ rows: ROWS });
  const combined = await handlerFor(supabase, { roles: [{ role: 'internal' }, { role: 'editor' }] }).getTellers(request());
  assert.equal(combined.status, 200);

  const noSession = createDishCounterReportHandlers({
    authenticate: async () => ({ ok: false, status: 401, error: 'Missing bearer token' }),
    getSupabase: () => createFakeSupabase({ rows: ROWS }),
    menus: MENUS,
    restaurants: RESTAURANTS,
    now: NOW,
  });
  const missing = await noSession.getTellers(request());
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, 'Missing bearer token');

  // Een authenticatielaag die zelf een fout geeft, houdt zijn eigen status.
  const misconfigured = createDishCounterReportHandlers({
    authenticate: async () => ({ ok: false, status: 500, error: 'Internal API is not configured' }),
    getSupabase: () => createFakeSupabase(),
    menus: MENUS,
    restaurants: RESTAURANTS,
    now: NOW,
  });
  assert.equal((await misconfigured.getTellers(request())).status, 500);
});

}

const ROWS = [
  { dish_key: '7-diner-0-0', day: '2026-10-29', shared: 4, saved: 1, reservation_clicks: 2 },
  { dish_key: '7-diner-0-0', day: '2026-10-26', shared: 2, saved: 3, reservation_clicks: 1 },
  { dish_key: '7-diner-4-4', day: '2026-10-28', shared: 1, saved: 0, reservation_clicks: 5 },
];

test('periode: vandaag, 7 en 30 vragen elk hun eigen UTC-dagen op', async () => {
  const expected = {
    vandaag: ['2026-10-29', '2026-10-29'],
    7: ['2026-10-23', '2026-10-29'],
    30: ['2026-09-30', '2026-10-29'],
  };
  for (const [periode, [van, tot]] of Object.entries(expected)) {
    const supabase = createFakeSupabase({ rows: [] });
    const { status, body } = await handlerFor(supabase).getTellers(request(`?periode=${periode}`));
    assert.equal(status, 200);
    assert.equal(body.periode, periode);
    assert.deepEqual(supabase.queries[0].gte, ['day', van], `van voor ${periode}`);
    assert.deepEqual(supabase.queries[0].lte, ['day', tot], `tot voor ${periode}`);
  }
});

test('periode: een ongeldige of ontbrekende periode valt terug op 7, zonder fout', async () => {
  for (const query of ['?periode=14', '?periode=', '?periode=week', '', '?iets=anders']) {
    const supabase = createFakeSupabase({ rows: [] });
    const { status, body } = await handlerFor(supabase).getTellers(request(query));
    assert.equal(status, 200, `query "${query}" is geen fout`);
    assert.equal(body.periode, '7', `query "${query}" valt terug op 7`);
    assert.deepEqual(supabase.queries[0].gte, ['day', '2026-10-23']);
  }
  assert.equal(periodFromRequest(null), null);
  assert.equal(periodFromRequest({}), null);
  assert.equal(periodFromRequest({ url: 'geen url' }), null);
});

test('de UTC-dag bepaalt de grens, niet de lokale dag van de server', async () => {
  // 00:30 op 30 oktober in Brussel is 22:30 UTC op 29 oktober.
  const supabase = createFakeSupabase({ rows: [] });
  const handler = handlerFor(supabase, { now: () => new Date('2026-10-30T00:30:00+02:00') });
  const { body } = await handler.getTellers(request('?periode=vandaag'));
  assert.equal(body.periode, 'vandaag');
  assert.deepEqual(supabase.queries[0].gte, ['day', '2026-10-29']);
  assert.deepEqual(supabase.queries[0].lte, ['day', '2026-10-29']);
});



test('tabel ontbreekt: de nette foutstaat in plaats van een crash', async () => {
  for (const error of [
    { code: '42P01', message: 'relation "public.dish_counters" does not exist' },
    { code: 'PGRST205', message: "Could not find the table 'public.dish_counters' in the schema cache" },
    { message: 'boom' },
  ]) {
    const supabase = createFakeSupabase({ error });
    const { status, body } = await handlerFor(supabase).getTellers(request('?periode=7'));
    assert.equal(status, 503);
    assert.equal(body.error, UNAVAILABLE_MESSAGE);
    assert.equal(UNAVAILABLE_MESSAGE, 'Tellers zijn nu niet beschikbaar.');
  }
});

test('database onbereikbaar of zonder sleutel: dezelfde foutstaat, geen crash', async () => {
  // De client gooit al bij `from()` (bijvoorbeeld een netwerkfout).
  const throwing = createFakeSupabase({ throwOnFrom: new Error('fetch failed') });
  assert.equal((await handlerFor(throwing).getTellers(request())).status, 503);

  // Geen Supabase-sleutel: getSupabaseAdmin gooit.
  const noKey = createDishCounterReportHandlers({
    authenticate: async () => ({ ok: true, roles: [{ role: 'internal' }] }),
    getSupabase: () => { throw new Error('Supabase is not configured'); },
    menus: MENUS,
    restaurants: RESTAURANTS,
    now: NOW,
  });
  const withoutKey = await noKey.getTellers(request());
  assert.equal(withoutKey.status, 503);
  assert.equal(withoutKey.body.error, UNAVAILABLE_MESSAGE);

  // Een client die geen bruikbare `from` heeft, is dezelfde situatie.
  const empty = createDishCounterReportHandlers({
    authenticate: async () => ({ ok: true, roles: [{ role: 'internal' }] }),
    getSupabase: () => null,
    menus: MENUS,
    restaurants: RESTAURANTS,
    now: NOW,
  });
  assert.equal((await empty.getTellers(request())).status, 503);

  // Een onbruikbare klok levert ook geen verzonnen periode op.
  const badClock = createFakeSupabase({ rows: ROWS });
  const broken = await handlerFor(badClock, { now: () => new Date('invalid') }).getTellers(request());
  assert.equal(broken.status, 503);
  assert.equal(badClock.calls.length, 0);
});


test('een lange periode leest in pagina\'s en telt alles op', async () => {
  const firstPage = Array.from({ length: PAGE_SIZE }, (unused, index) => ({
    dish_key: `7-diner-0-${index}`,
    day: '2026-10-29',
    shared: 1,
    saved: 0,
    reservation_clicks: 0,
  }));
  const secondPage = [
    { dish_key: '7-diner-0-0', day: '2026-10-28', shared: 3, saved: 1, reservation_clicks: 1 },
  ];
  const supabase = createFakeSupabase({ pages: [firstPage, secondPage] });
  const { status, body } = await handlerFor(supabase).getTellers(request('?periode=30'));

  assert.equal(status, 200);
  assert.equal(supabase.queries.length, 2, 'een volle pagina vraagt om de volgende');
  assert.deepEqual(supabase.queries[0].range, [0, PAGE_SIZE - 1]);
  assert.deepEqual(supabase.queries[1].range, [PAGE_SIZE, PAGE_SIZE * 2 - 1]);
  assert.equal(body.aantalGerechten, PAGE_SIZE);
  assert.equal(body.rijen.length, 500, 'de tabel blijft op 500 rijen');
  assert.equal(body.totalen.gedeeld, PAGE_SIZE + 3);
  assert.equal(body.totalen.bewaard, 1);
  assert.equal(body.totalen.reserveren, 1);
});

test('de handler levert nooit meer dan 500 rijen, ook niet bij 600 gerechten', async () => {
  const rows = Array.from({ length: 600 }, (unused, index) => ({
    dish_key: `7-diner-0-${index}`,
    day: '2026-10-29',
    shared: index,
    saved: 1,
    reservation_clicks: 0,
  }));
  const supabase = createFakeSupabase({ rows });
  const { body } = await handlerFor(supabase).getTellers(request('?periode=vandaag'));
  assert.equal(body.rijen.length, 500);
  assert.equal(body.aantalGerechten, 600);
  assert.equal(body.rijen[0].gedeeld, 599, 'de standaardsortering is Gedeeld, aflopend');
  assert.equal(body.totalen.gedeeld, (599 * 600) / 2);
});

test('de handler schrijft nooit en raakt geen andere tabel aan', async () => {
  const supabase = createFakeSupabase({ rows: ROWS });
  await handlerFor(supabase).getTellers(request('?periode=7'));
  for (const call of supabase.calls) {
    if (call.step === 'from') assert.equal(call.table, 'dish_counters');
    assert.ok(!['insert', 'update', 'delete', 'upsert', 'rpc'].includes(call.step));
  }
});
