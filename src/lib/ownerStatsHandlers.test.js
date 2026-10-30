'use strict';

// BE-57 (#139, deel 1) — de houderstatistieken met een nep-client.
//
// Geen Supabase, geen netwerk en geen Next. Wat hier bewezen wordt:
//   - 401 zonder sessie;
//   - 403 voor iedereen die geen `owner` is van precies dít restaurant (ook
//     voor internal of voor de eigenaar van een ander restaurant), en dan wordt
//     er niets gelezen;
//   - 404 voor een onbekend restaurant;
//   - de cijfers zelf: deze week tegen vorige week, de top 4 en de drempel;
//   - zonder migratie (0024) de stand "nog geen cijfers", met 200 en zonder fout;
//   - een onbereikbare database: 503, nooit een crash.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const restaurantsData = require('../../data/restaurants.json');
const {
  FORBIDDEN_MESSAGE,
  NOT_FOUND_MESSAGE,
  UNAVAILABLE_MESSAGE,
  createOwnerStatsHandlers,
} = require('./ownerStatsHandlers');
const { NO_DATA_MESSAGE, NO_DATA_STATUS, READY_STATUS, UNDER_MINIMUM_LABEL } = require('./ownerRestaurantStats');

const NOW = new Date('2026-10-29T12:00:00.000Z');
const OWNER = { ok: true, userId: 'user-1', roles: [{ role: 'owner', restaurant_id: '6' }] };

/** Een nep-client die elke leesronde vastlegt en per tabel antwoordt. */
function fakeSupabase(responses = {}) {
  const queries = [];
  return {
    queries,
    client: {
      from(table) {
        const record = { table, filters: [] };
        queries.push(record);
        const api = {
          select(columns) { record.columns = columns; return api; },
          eq(column, value) { record.filters.push(['eq', column, value]); return api; },
          like(column, value) { record.filters.push(['like', column, value]); return api; },
          gte(column, value) { record.filters.push(['gte', column, value]); return api; },
          lte(column, value) { record.filters.push(['lte', column, value]); return api; },
          order() { return api; },
          range(from, to) { record.range = [from, to]; return api; },
          then(resolve, reject) {
            const answer = responses[table];
            return Promise.resolve(
              typeof answer === 'function' ? answer(record) : (answer || { data: [], error: null })
            ).then(resolve, reject);
          },
        };
        return api;
      },
    },
  };
}

function handlerFor({ auth = OWNER, supabase, now = () => NOW, getSupabase } = {}) {
  return createOwnerStatsHandlers({
    authenticate: async () => auth,
    getSupabase: getSupabase || (() => supabase),
    restaurants: restaurantsData,
    now,
  });
}


test('houdercijfers: 401 zonder sessie', async () => {
  const fake = fakeSupabase();
  const handler = handlerFor({ auth: { ok: false, status: 401, error: 'Niet ingelogd.' }, supabase: fake.client });
  const outcome = await handler.getOwnerStats({}, '6');
  assert.equal(outcome.status, 401);
  assert.equal(fake.queries.length, 0, 'zonder sessie wordt er niets gelezen');
});

test('houdercijfers: 403 voor iemand die geen eigenaar is van dit restaurant', async () => {
  const cases = [
    { name: 'geen rol', roles: [] },
    { name: 'internal', roles: [{ role: 'internal', restaurant_id: null }] },
    { name: 'editor', roles: [{ role: 'editor', restaurant_id: '6' }] },
    { name: 'eigenaar van een ander restaurant', roles: [{ role: 'owner', restaurant_id: '23' }] },
    { name: 'owner zonder restaurant', roles: [{ role: 'owner' }] },
  ];
  for (const item of cases) {
    const fake = fakeSupabase();
    const handler = handlerFor({ auth: { ok: true, userId: 'u', roles: item.roles }, supabase: fake.client });
    const outcome = await handler.getOwnerStats({}, '6');
    assert.equal(outcome.status, 403, item.name);
    assert.equal(outcome.body.error, FORBIDDEN_MESSAGE, item.name);
    assert.equal(fake.queries.length, 0, `${item.name}: niets gelezen`);
  }
});

test('houdercijfers: 404 voor een onbekend restaurant of een ongelijke id', async () => {
  const fake = fakeSupabase();
  const handler = handlerFor({ supabase: fake.client });
  for (const id of ['999', '', null, undefined, 'restaurant-6', '6/../7']) {
    const outcome = await handler.getOwnerStats({}, id);
    assert.equal(outcome.status, 404, String(id));
    assert.equal(outcome.body.error, NOT_FOUND_MESSAGE);
  }
  assert.equal(fake.queries.length, 0);
});


test('houdercijfers: de eigenaar krijgt deze week, vorige week en de top 4', async () => {
  const fake = fakeSupabase({
    restaurant_views: {
      data: [
        { day: '2026-10-29', viewed: 40 },
        { day: '2026-10-26', viewed: 20 },
        { day: '2026-10-22', viewed: 30 },
      ],
      error: null,
    },
    dish_counters: {
      data: [
        { dish_key: '6-diner-0-0', day: '2026-10-29', saved: 6, shared: 4 },
        { dish_key: '6-diner-0-1', day: '2026-10-28', saved: 1, shared: 2 },
        { dish_key: '6-diner-0-0', day: '2026-10-22', saved: 8, shared: 2 },
      ],
      error: null,
    },
    kies_stemmen: {
      data: [
        { dish_key: '6-diner-0-0', lekker: true, gestemd_op: '2026-10-29T09:00:00.000Z' },
        { dish_key: '6-diner-0-0', lekker: true, gestemd_op: '2026-10-28T09:00:00.000Z' },
        { dish_key: '6-diner-0-1', lekker: true, gestemd_op: '2026-10-27T09:00:00.000Z' },
      ],
      error: null,
    },
  });
  const outcome = await handlerFor({ supabase: fake.client }).getOwnerStats({}, '6');
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.status, READY_STATUS);
  assert.equal(outcome.body.restaurantId, '6');

  const byId = Object.fromEntries(outcome.body.week.map((metric) => [metric.id, metric]));
  assert.equal(byId.bekeken.value, 60);
  assert.equal(byId.bekeken.previous, 30);
  assert.equal(byId.bekeken.change.label, '30 meer dan vorige week');
  assert.equal(byId.bewaard.value, 7);
  assert.equal(byId.bewaard.previous, 8);
  assert.equal(byId.gedeeld.value, 6);
  assert.equal(byId.gedeeld.previous, 2);
  assert.equal(byId.gedeeld.shown, '6');
  assert.equal(byId.gedeeld.previousShown, UNDER_MINIMUM_LABEL);
  assert.equal(byId.favoriet.value, 3, 'drie keer "lekker" in deze week');
  assert.equal(byId.favoriet.shown, UNDER_MINIMUM_LABEL);
  // Top 4: bewaard + gedeeld per gerecht, hoogste eerst.
  assert.deepEqual(outcome.body.top.map((entry) => entry.dishKey), ['6-diner-0-0', '6-diner-0-1']);
  assert.deepEqual(outcome.body.top.map((entry) => entry.total), [10, 3]);
  assert.equal(outcome.body.top[1].label, UNDER_MINIMUM_LABEL);
});

test('houdercijfers: alleen de eigen rijen en kolommen worden gelezen', async () => {
  const fake = fakeSupabase();
  await handlerFor({ supabase: fake.client }).getOwnerStats({}, '6');
  assert.deepEqual(fake.queries.map((query) => query.table), ['restaurant_views', 'dish_counters', 'kies_stemmen']);
  assert.deepEqual(fake.queries[0].filters, [
    ['eq', 'restaurant_id', '6'],
    // BE-57 deel 2: tot de maand terug, voor de stand "net geclaimd".
    ['gte', 'day', '2026-09-30'],
    ['lte', 'day', '2026-10-29'],
  ]);
  assert.deepEqual(fake.queries[1].filters, [
    ['like', 'dish_key', '6-%'],
    ['gte', 'day', '2026-09-30'],
    ['lte', 'day', '2026-10-29'],
  ]);
  assert.deepEqual(fake.queries[2].filters, [
    ['like', 'dish_key', '6-%'],
    ['eq', 'lekker', true],
    ['gte', 'gestemd_op', '2026-09-30'],
  ]);
  // Geen roepnaam, geen stemmer, geen identiteit: alleen deze kolommen.
  assert.equal(fake.queries[0].columns, 'day, viewed');
  assert.equal(fake.queries[1].columns, 'dish_key, day, saved, shared');
  assert.equal(fake.queries[2].columns, 'dish_key, lekker, gestemd_op');
});

test('houdercijfers: het maandcijfer telt dezelfde rijen over dertig dagen', async () => {
  const fake = fakeSupabase({
    restaurant_views: {
      data: [
        { day: '2026-10-29', viewed: 6 },
        { day: '2026-10-08', viewed: 9 },
      ],
      error: null,
    },
    dish_counters: {
      data: [{ dish_key: '6-diner-0-0', day: '2026-10-08', saved: 2, shared: 1 }],
      error: null,
    },
    kies_stemmen: { data: [], error: null },
  });
  const outcome = await handlerFor({ supabase: fake.client }).getOwnerStats({}, '6');
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.status, READY_STATUS);
  // Deze week: 6 keer bekeken; de maand: 15.
  assert.equal(outcome.body.week.find((metric) => metric.id === 'bekeken').value, 6);
  assert.equal(outcome.body.month.totals.viewed, 15);
  assert.equal(outcome.body.month.figures.find((figure) => figure.id === 'bekeken').shown, '15');
  // Bewaard 2 en gedeeld 1 blijven onder de drempel, ook in de maand.
  assert.equal(outcome.body.month.figures.find((figure) => figure.id === 'bewaard').shown, UNDER_MINIMUM_LABEL);
});

test('houdercijfers: zonder migratie de stand "nog geen cijfers", zonder fout', async () => {
  const fake = fakeSupabase({
    restaurant_views: { data: null, error: { code: '42P01', message: 'relation "restaurant_views" does not exist' } },
  });
  const outcome = await handlerFor({ supabase: fake.client }).getOwnerStats({}, '6');
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.status, NO_DATA_STATUS);
  assert.equal(outcome.body.message, NO_DATA_MESSAGE);
  assert.equal(outcome.body.hasData, false);
  assert.deepEqual(outcome.body.week, []);
  assert.equal(fake.queries.length, 1, 'na een ontbrekende tabel niet verder lezen');
});

test('houdercijfers: zonder enige telling ook "nog geen cijfers"', async () => {
  const fake = fakeSupabase();
  const outcome = await handlerFor({ supabase: fake.client }).getOwnerStats({}, '6');
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.status, NO_DATA_STATUS);
  assert.equal(outcome.body.message, NO_DATA_MESSAGE);
});

test('houdercijfers: een storing is 503, nooit een crash', async () => {
  const broken = fakeSupabase({ restaurant_views: { data: null, error: { code: '57014', message: 'timeout' } } });
  const first = await handlerFor({ supabase: broken.client }).getOwnerStats({}, '6');
  assert.equal(first.status, 503);
  assert.equal(first.body.error, UNAVAILABLE_MESSAGE);

  const noClient = await handlerFor({ supabase: null }).getOwnerStats({}, '6');
  assert.equal(noClient.status, 503);

  const rejecting = fakeSupabase({
    dish_counters: { data: null, error: { code: 'PGRST301', message: 'JWT expired' } },
  });
  const second = await handlerFor({ supabase: rejecting.client }).getOwnerStats({}, '6');
  assert.equal(second.status, 503);
});

test('houdercijfers: zonder sleutel of met een onbruikbare klok geen verkeerde cijfers', async () => {
  const throwing = await handlerFor({ getSupabase: () => { throw new Error('geen sleutel'); } }).getOwnerStats({}, '6');
  assert.equal(throwing.status, 503);

  const fake = fakeSupabase();
  const badClock = await handlerFor({ supabase: fake.client, now: () => 'geen datum' }).getOwnerStats({}, '6');
  assert.equal(badClock.status, 503);
  assert.equal(fake.queries.length, 0);
});
