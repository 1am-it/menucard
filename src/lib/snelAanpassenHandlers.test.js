'use strict';

// BE-58 deel 1 (#143) — de API's met een fictieve client.
//
// Wat hier bewezen wordt (contract, acceptatie 1 en 2):
//   - iemand die geen eigenaar is krijgt 403, en een houder zonder
//     plaatsrecht ook; er wordt dan niets geschreven;
//   - de prijsgrens en de markering "grote wijziging";
//   - maximaal 30 wijzigingen per dag;
//   - een wijziging is pas zichtbaar na goedkeuring;
//   - het bevestigingslabel vervalt na 90 dagen;
//   - de overlay raakt alleen het juiste gerecht en geeft geen interne velden;
//   - de interne lijst en de beoordeling eisen de rol `internal`;
//   - zonder migratie antwoordt elke route 503.
//
// FICTIONELE DATA: client, rijen en gebruikers zijn verzonnen; er komt geen
// echte Supabase-URL of sleutel aan te pas.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  TABLE_BEVESTIGINGEN,
  TABLE_GEBEURTENISSEN,
  TABLE_PLAATSRECHT,
  TABLE_WIJZIGINGEN,
  createSnelAanpassenHandlers,
} = require('./snelAanpassenHandlers');
const { pasOverlayToe } = require('./snelAanpassen');

const MENUS = {
  '9-lunch': {
    name: 'Fictief Restaurant',
    categories: [
      { name: 'Lunch', items: [
        { name: 'Tomatensoep', price: '€10', priceValue: 10, desc: 'Met basilicum' },
        { name: 'Bruschetta', price: '€7', priceValue: 7, desc: 'Met tomaat' },
      ] },
    ],
  },
  '9-diner': { name: 'Fictief Restaurant', categories: [{ name: 'Diner', items: [{ name: 'Stoofvlees', price: '€18,50', priceValue: 18.5 }] }] },
};
const NOW = () => new Date('2026-10-30T12:00:00Z');

function request({ url = 'https://example.test/api', body = null } = {}) {
  return {
    url,
    headers: new Headers(body === null ? {} : { 'content-type': 'application/json' }),
    json: async () => {
      if (body === null) throw new Error('geen body');
      return body;
    },
  };
}

/**
 * Een nep-client die precies het deel van de supabase-js-API nabootst dat deze
 * handlers gebruiken, en elke aanroep vastlegt. Geen echte database.
 */
function createFakeSupabase({
  staffRoles = [{ id: 1, user_id: 'houder-1', restaurant_id: '9', role: 'owner' }],
  plaatsrecht = [],
  wijzigingen = [],
  bevestigingen = [],
  gebeurtenissen = [],
  missingTables = [],
  failTables = {},
} = {}) {
  const calls = [];
  const tabellen = {
    staff_roles: staffRoles.map((rij) => ({ ...rij })),
    [TABLE_PLAATSRECHT]: plaatsrecht.map((rij) => ({ ...rij })),
    [TABLE_WIJZIGINGEN]: wijzigingen.map((rij) => ({ ...rij })),
    [TABLE_BEVESTIGINGEN]: bevestigingen.map((rij) => ({ ...rij })),
    [TABLE_GEBEURTENISSEN]: gebeurtenissen.map((rij) => ({ ...rij })),
  };
  let volgendeId = 100;

  function builder(table) {
    const state = { op: 'select', payload: null, filters: [], gte: [], order: null, limit: null };
    calls.push({ table, state });

    function rijMatch(rij) {
      const gelijk = state.filters.every(([kolom, waarde]) => String(rij[kolom]) === String(waarde));
      const vanaf = state.gte.every(([kolom, waarde]) => String(rij[kolom] || '') >= String(waarde));
      return gelijk && vanaf;
    }

    function selecteer() {
      let rijen = (tabellen[table] || []).filter(rijMatch);
      if (state.order) {
        const { kolom, ascending } = state.order;
        rijen = rijen.slice().sort((a, b) => {
          const links = String(a[kolom] || '');
          const rechts = String(b[kolom] || '');
          return ascending ? links.localeCompare(rechts) : rechts.localeCompare(links);
        });
      }
      if (state.limit !== null) rijen = rijen.slice(0, state.limit);
      return rijen;
    }

    function resultaat() {
      const fout = failTables[table];
      if (fout) return { data: null, error: fout };
      if (missingTables.includes(table)) {
        return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
      }
      if (state.op === 'insert') {
        const rij = { ...state.payload };
        if (table === TABLE_WIJZIGINGEN) {
          rij.wijziging_id = volgendeId;
          volgendeId += 1;
          rij.status = rij.status || 'in_controle';
        }
        if (table === TABLE_GEBEURTENISSEN) {
          rij.gebeurtenis_id = volgendeId;
          volgendeId += 1;
        }
        tabellen[table] = [...(tabellen[table] || []), rij];
        return { data: [rij], error: null };
      }
      if (state.op === 'update') {
        const bijgewerkt = [];
        tabellen[table] = (tabellen[table] || []).map((rij) => {
          if (!rijMatch(rij)) return rij;
          const nieuw = { ...rij, ...state.payload };
          bijgewerkt.push(nieuw);
          return nieuw;
        });
        return { data: bijgewerkt, error: null };
      }
      if (state.op === 'delete') {
        const verwijderd = (tabellen[table] || []).filter(rijMatch);
        tabellen[table] = (tabellen[table] || []).filter((rij) => !rijMatch(rij));
        return { data: verwijderd, error: null };
      }
      if (state.op === 'upsert') {
        const sleutel = state.conflict || 'restaurant_id';
        const bestaand = (tabellen[table] || []).find((rij) => String(rij[sleutel]) === String(state.payload[sleutel]));
        if (bestaand) Object.assign(bestaand, state.payload);
        else tabellen[table] = [...(tabellen[table] || []), { ...state.payload }];
        return { data: [bestaand || state.payload], error: null };
      }
      return { data: selecteer(), error: null };
    }

    const api = {
      select() { return api; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api; },
      update(payload) { state.op = 'update'; state.payload = payload; return api; },
      delete() { state.op = 'delete'; return api; },
      upsert(payload, options = {}) {
        state.op = 'upsert';
        state.payload = payload;
        state.conflict = options.onConflict;
        return api;
      },
      eq(kolom, waarde) { state.filters.push([kolom, waarde]); return api; },
      gte(kolom, waarde) { state.gte.push([kolom, waarde]); return api; },
      order(kolom, options = {}) { state.order = { kolom, ascending: options.ascending !== false }; return api; },
      limit(aantal) { state.limit = aantal; return api; },
      maybeSingle() {
        const uitkomst = resultaat();
        if (uitkomst.error) return Promise.resolve(uitkomst);
        const rijen = Array.isArray(uitkomst.data) ? uitkomst.data : [];
        return Promise.resolve({ data: rijen[0] || null, error: null });
      },
      then(resolve, reject) { return Promise.resolve(resultaat()).then(resolve, reject); },
    };
    return api;
  }

  return { from: (table) => builder(table), calls, tabellen };
}

function handlersVoor(client, { houder = true, internal = true, rol = 'internal', now = NOW } = {}) {
  return createSnelAanpassenHandlers({
    getSupabase: () => client,
    authenticate: async () => (houder ? { ok: true, userId: 'houder-1' } : { ok: false, status: 401 }),
    authenticateInternal: async () => {
      if (!internal) return { ok: false, status: 401 };
      if (!rol) return { ok: false, status: 403, error: 'Geen rol' };
      return { ok: true, userId: 'beheer-1', roles: [{ role: rol }] };
    },
    menus: MENUS,
    now,
  });
}

function wijzigingBody(extra = {}) {
  return { menuId: '9-lunch', categorieIndex: 0, gerechtIndex: 0, soort: 'prijs', prijs: '11,00', ...extra };
}

test('BE-58: wie geen eigenaar is krijgt 403 en er wordt niets geschreven', async () => {
  const client = createFakeSupabase({ staffRoles: [] });
  const handlers = handlersVoor(client);
  const uitkomst = await handlers.diendeWijzigingIn(request({ body: wijzigingBody() }));
  assert.equal(uitkomst.status, 403);
  assert.match(uitkomst.body.message, /houder/i);
  assert.equal(client.calls.filter((call) => call.table === TABLE_WIJZIGINGEN && call.state.op === 'insert').length, 0);
});

test('BE-58: een houder zonder plaatsrecht krijgt 403 en er wordt niets geschreven', async () => {
  const client = createFakeSupabase({ plaatsrecht: [{ restaurant_id: '9', user_id: 'houder-1' }] });
  const handlers = handlersVoor(client);
  const uitkomst = await handlers.diendeWijzigingIn(request({ body: wijzigingBody() }));
  assert.equal(uitkomst.status, 403);
  assert.equal(uitkomst.body.error, 'geen_plaatsrecht');
  assert.equal(client.calls.filter((call) => call.table === TABLE_WIJZIGINGEN && call.state.op === 'insert').length, 0);
});

test('BE-58: zonder de tabel daghap_plaatsrecht (0023 nog niet toegepast) blijft de route werken', async () => {
  const client = createFakeSupabase({ missingTables: [TABLE_PLAATSRECHT] });
  const handlers = handlersVoor(client);
  const uitkomst = await handlers.diendeWijzigingIn(request({ body: wijzigingBody() }));
  assert.equal(uitkomst.status, 201);
});

test('BE-58: de prijsgrens wordt ook in de API afgedwongen', async () => {
  const client = createFakeSupabase();
  const handlers = handlersVoor(client);
  for (const prijs of ['0,49', '150,01']) {
    const uitkomst = await handlers.diendeWijzigingIn(request({ body: wijzigingBody({ prijs }) }));
    assert.equal(uitkomst.status, 400, `prijs ${prijs}`);
    assert.deepEqual(uitkomst.body.fouten, ['prijs_buiten_grens']);
  }
  const ondergrens = await handlers.diendeWijzigingIn(request({ body: wijzigingBody({ prijs: '0,50' }) }));
  assert.equal(ondergrens.status, 201);
  assert.equal(ondergrens.body.wijziging.prijsCent, 50);
  const bovengrens = await handlers.diendeWijzigingIn(request({ body: wijzigingBody({ prijs: '150' }) }));
  assert.equal(bovengrens.status, 201);
  assert.equal(bovengrens.body.wijziging.prijsCent, 15000);
});

test('BE-58: een wijziging staat op in_controle en meldt dat, met "grote wijziging" boven 50%', async () => {
  const client = createFakeSupabase();
  const handlers = handlersVoor(client);
  const uitkomst = await handlers.diendeWijzigingIn(request({ body: wijzigingBody() }));
  assert.equal(uitkomst.status, 201);
  assert.equal(uitkomst.body.wijziging.status, 'in_controle');
  assert.equal(uitkomst.body.wijziging.groteWijziging, false);
  assert.equal(uitkomst.body.message, 'We controleren een wijziging kort voordat gasten hem zien.');
  assert.equal(client.tabellen[TABLE_WIJZIGINGEN][0].oude_prijs_cent, 1000);

  const groot = await handlers.diendeWijzigingIn(request({ body: wijzigingBody({ gerechtIndex: 1, prijs: '20' }) }));
  assert.equal(groot.status, 201);
  assert.equal(groot.body.wijziging.groteWijziging, true, '€7 naar €20 is meer dan 50%');
  assert.equal(client.calls.some((call) => call.table === TABLE_GEBEURTENISSEN && call.state.op === 'insert'), true);
});

test('BE-58: maximaal 30 wijzigingen per dag', async () => {
  const vandaag = '2026-10-30T08:00:00.000Z';
  const rijen = Array.from({ length: 30 }, (_, index) => ({
    wijziging_id: index + 1, restaurant_id: '9', user_id: 'houder-1', status: 'in_controle', created_at: vandaag,
  }));
  const client = createFakeSupabase({ wijzigingen: rijen });
  const handlers = handlersVoor(client);
  const uitkomst = await handlers.diendeWijzigingIn(request({ body: wijzigingBody() }));
  assert.equal(uitkomst.status, 429);
  assert.equal(uitkomst.body.maximum, 30);
  assert.equal(client.calls.filter((call) => call.table === TABLE_WIJZIGINGEN && call.state.op === 'insert').length, 0);

  // Rijen van eergisteren tellen niet mee voor vandaag.
  const oud = rijen.map((rij) => ({ ...rij, created_at: '2026-10-28T08:00:00.000Z' }));
  const vers = createFakeSupabase({ wijzigingen: oud });
  const wel = await handlersVoor(vers).diendeWijzigingIn(request({ body: wijzigingBody() }));
  assert.equal(wel.status, 201);
});

test('BE-58: een wijziging is pas zichtbaar na goedkeuring', async () => {
  const client = createFakeSupabase();
  const handlers = handlersVoor(client);
  const ingediend = await handlers.diendeWijzigingIn(request({ body: wijzigingBody() }));
  assert.equal(ingediend.status, 201);

  const voor = await handlers.publiekeOverlay(request({ url: 'https://example.test/api/v1/menukaart/overlay?restaurant=9' }));
  assert.equal(voor.status, 200);
  assert.deepEqual(voor.body.wijzigingen, []);

  const goedgekeurd = await handlers.keurGoed(request(), { id: String(ingediend.body.wijziging.wijzigingId) });
  assert.equal(goedgekeurd.status, 200);
  assert.equal(goedgekeurd.body.wijziging.status, 'goedgekeurd');

  const na = await handlers.publiekeOverlay(request({ url: 'https://example.test/api/v1/menukaart/overlay?restaurant=9' }));
  assert.equal(na.body.wijzigingen.length, 1);
  assert.deepEqual(na.body.wijzigingen[0], {
    menuId: '9-lunch', categorieIndex: 0, gerechtIndex: 0, gerechtNaam: 'Tomatensoep',
    soort: 'prijs', prijsCent: 1100, prijs: '€11', tijdelijkNietBeschikbaar: false,
  });
  // De statische kaart is niet beschreven; de overlay doet het werk.
  assert.equal(MENUS['9-lunch'].categories[0].items[0].price, '€10');
  const metOverlay = pasOverlayToe(MENUS['9-lunch'], na.body.wijzigingen.map((rij) => ({
    categorie_index: rij.categorieIndex, gerecht_index: rij.gerechtIndex, soort: rij.soort, prijs_cent: rij.prijsCent,
  })));
  assert.equal(metOverlay.categories[0].items[0].price, '€11');
  assert.equal(metOverlay.categories[0].items[1].price, '€7');
  // Een goedgekeurde wijziging telt als bevestiging.
  assert.equal(na.body.bevestiging.actief, true);
  assert.equal(na.body.bevestiging.label, 'Bevestigd door het restaurant');
});

test('BE-58: afwijzen vraagt een reden en schrijft de beslissing in de geschiedenis', async () => {
  const client = createFakeSupabase();
  const handlers = handlersVoor(client);
  const ingediend = await handlers.diendeWijzigingIn(request({ body: wijzigingBody() }));
  const id = String(ingediend.body.wijziging.wijzigingId);

  const zonder = await handlers.wijsAf(request({ body: {} }), { id });
  assert.equal(zonder.status, 400);
  assert.equal(zonder.body.error, 'afwijs_reden_verplicht');

  const afgewezen = await handlers.wijsAf(request({ body: { reden: 'De prijs klopt niet met de kaart.' } }), { id });
  assert.equal(afgewezen.status, 200);
  assert.equal(afgewezen.body.wijziging.status, 'afgewezen');
  assert.equal(afgewezen.body.wijziging.afwijsReden, 'De prijs klopt niet met de kaart.');
  const acties = client.tabellen[TABLE_GEBEURTENISSEN].map((rij) => rij.actie);
  assert.deepEqual(acties, ['ingediend', 'afgewezen']);
  assert.equal(client.tabellen[TABLE_GEBEURTENISSEN][1].gegevens.reden, 'De prijs klopt niet met de kaart.');

  // Een tweede beoordeling is 409 en schrijft niets.
  const nogmaals = await handlers.wijsAf(request({ body: { reden: 'Nog een keer.' } }), { id });
  assert.equal(nogmaals.status, 409);
  assert.equal(client.tabellen[TABLE_GEBEURTENISSEN].length, 2);

  // Afgewezen wijzigingen komen niet in de publieke overlay.
  const overlay = await handlers.publiekeOverlay(request({ url: 'https://example.test/api/v1/menukaart/overlay?restaurant=9' }));
  assert.deepEqual(overlay.body.wijzigingen, []);
});

test('BE-58: de interne lijst en beoordeling eisen de rol internal', async () => {
  const client = createFakeSupabase({ wijzigingen: [{
    wijziging_id: 5, restaurant_id: '9', menu_id: '9-lunch', categorie_index: 0, gerecht_index: 0,
    gerecht_naam: 'Tomatensoep', user_id: 'houder-1', soort: 'prijs', prijs_cent: 1100,
    status: 'in_controle', grote_wijziging: false, created_at: '2026-10-30T09:00:00.000Z',
  }] });
  const alsEigenaar = handlersVoor(client, { rol: null });
  const lijst = await alsEigenaar.interneLijst(request());
  assert.equal(lijst.status, 403);
  assert.equal(client.calls.some((call) => call.table === TABLE_WIJZIGINGEN), false, 'geen data gelezen');

  const zonderSessie = handlersVoor(client, { internal: false });
  assert.equal((await zonderSessie.interneLijst(request())).status, 401);

  const ok = handlersVoor(client);
  const gevonden = await ok.interneLijst(request());
  assert.equal(gevonden.status, 200);
  assert.equal(gevonden.body.wijzigingen.length, 1);
  assert.equal(gevonden.body.wijzigingen[0].houderId, 'houder-1');

  const afgewezen = await alsEigenaar.keurGoed(request(), { id: '5' });
  assert.equal(afgewezen.status, 403);
  assert.equal(client.tabellen[TABLE_WIJZIGINGEN][0].status, 'in_controle');
});

test('BE-58: bevestigen geeft het label, dat na 90 dagen vervalt', async () => {
  const client = createFakeSupabase();
  const opDag1 = () => new Date('2026-10-30T09:00:00Z');
  const na90 = () => new Date('2027-01-28T09:00:01Z');
  const dag1 = await handlersVoor(client, { now: opDag1 }).bevestigMenukaart(request({ body: { menuId: '9-lunch' } }));
  assert.equal(dag1.status, 200);
  assert.equal(dag1.body.bevestiging.label, 'Bevestigd door het restaurant');
  assert.equal(dag1.body.bevestiging.datum, '30-10-2026');
  assert.equal(dag1.body.geldigDagen, 90);
  assert.equal(client.tabellen[TABLE_GEBEURTENISSEN].at(-1).actie, 'bevestigd');

  const binnen = await handlersVoor(client, { now: opDag1 }).publiekeOverlay(request({ url: 'https://example.test/api/v1/menukaart/overlay?restaurant=9' }));
  assert.equal(binnen.body.bevestiging.actief, true);

  const verlopen = await handlersVoor(client, { now: na90 }).publiekeOverlay(request({ url: 'https://example.test/api/v1/menukaart/overlay?restaurant=9' }));
  assert.equal(verlopen.body.bevestiging.actief, false);
  assert.equal(verlopen.body.bevestiging.label, '');
});

test('BE-58: niet-eigenaren kunnen niet bevestigen', async () => {
  const client = createFakeSupabase({ staffRoles: [] });
  const uitkomst = await handlersVoor(client).bevestigMenukaart(request({ body: { menuId: '9-lunch' } }));
  assert.equal(uitkomst.status, 403);
  assert.equal(client.tabellen[TABLE_BEVESTIGINGEN].length, 0);
  assert.equal(client.calls.some((call) => call.table === TABLE_GEBEURTENISSEN), false);
});

test('BE-58: de publieke overlay leest alleen het gevraagde restaurant', async () => {
  const client = createFakeSupabase({
    wijzigingen: [
      { wijziging_id: 1, restaurant_id: '9', menu_id: '9-lunch', categorie_index: 0, gerecht_index: 0, gerecht_naam: 'Tomatensoep', soort: 'prijs', prijs_cent: 1100, status: 'goedgekeurd', beoordeeld_op: '2026-10-30T10:00:00.000Z' },
      { wijziging_id: 2, restaurant_id: '6', menu_id: '6-lunch', categorie_index: 0, gerecht_index: 0, gerecht_naam: 'Soep', soort: 'prijs', prijs_cent: 500, status: 'goedgekeurd', beoordeeld_op: '2026-10-30T10:00:00.000Z' },
      { wijziging_id: 3, restaurant_id: '9', menu_id: '9-lunch', categorie_index: 0, gerecht_index: 1, gerecht_naam: 'Bruschetta', soort: 'beschikbaarheid', beschikbaar: false, status: 'in_controle', beoordeeld_op: null },
    ],
  });
  const uitkomst = await handlersVoor(client).publiekeOverlay(request({ url: 'https://example.test/api/v1/menukaart/overlay?restaurant=9' }));
  assert.equal(uitkomst.status, 200);
  assert.equal(uitkomst.body.wijzigingen.length, 1);
  // Alleen de velden voor de weergave: geen user_id, status of beoordelaar.
  assert.deepEqual(Object.keys(uitkomst.body.wijzigingen[0]).sort(), [
    'categorieIndex', 'gerechtIndex', 'gerechtNaam', 'menuId', 'prijs', 'prijsCent', 'soort', 'tijdelijkNietBeschikbaar',
  ]);
  // De query filtert op restaurant én goedgekeurd, met een bovengrens.
  const query = client.calls.find((call) => call.table === TABLE_WIJZIGINGEN);
  assert.deepEqual(query.state.filters, [['restaurant_id', '9'], ['status', 'goedgekeurd']]);
  assert.equal(Number.isInteger(query.state.limit), true);

  const zonderRestaurant = await handlersVoor(client).publiekeOverlay(request());
  assert.equal(zonderRestaurant.status, 400);
});

test('BE-58: zonder migratie antwoordt elke route 503 met één nette melding', async () => {
  const client = createFakeSupabase({ missingTables: [TABLE_WIJZIGINGEN, TABLE_BEVESTIGINGEN, TABLE_GEBEURTENISSEN] });
  const handlers = handlersVoor(client);
  const routes = [
    handlers.diendeWijzigingIn(request({ body: wijzigingBody() })),
    handlers.eigenWijzigingen(request()),
    handlers.bevestigMenukaart(request({ body: { menuId: '9-lunch' } })),
    handlers.publiekeOverlay(request({ url: 'https://example.test/api/v1/menukaart/overlay?restaurant=9' })),
    handlers.interneLijst(request()),
  ];
  for (const uitkomst of await Promise.all(routes)) {
    assert.equal(uitkomst.status, 503);
    assert.equal(uitkomst.body.error, 'menukaart_unavailable');
    assert.equal(uitkomst.body.message, 'Snel aanpassen is nog niet beschikbaar.');
  }

  const leeg = createSnelAanpassenHandlers({ getSupabase: () => null });
  assert.equal((await leeg.publiekeOverlay(request({ url: 'https://example.test/x?restaurant=9' }))).status, 503);
});

test('BE-58: de eigen lijst toont alleen eigen wijzigingen en het resterende dagmaximum', async () => {
  const client = createFakeSupabase({
    wijzigingen: [
      { wijziging_id: 1, user_id: 'houder-1', restaurant_id: '9', status: 'in_controle', created_at: '2026-10-30T09:00:00.000Z', soort: 'prijs', prijs_cent: 1100 },
      { wijziging_id: 2, user_id: 'iemand-anders', restaurant_id: '9', status: 'in_controle', created_at: '2026-10-30T09:00:00.000Z', soort: 'prijs', prijs_cent: 900 },
    ],
  });
  const uitkomst = await handlersVoor(client).eigenWijzigingen(request());
  assert.equal(uitkomst.status, 200);
  assert.equal(uitkomst.body.wijzigingen.length, 1);
  assert.equal(uitkomst.body.wijzigingen[0].wijzigingId, 1);
  assert.deepEqual(uitkomst.body.daglimiet, { maximum: 30, resterend: 29 });
  assert.equal(uitkomst.body.wijzigingen[0].user_id, undefined, 'geen onbewerkte kolomnamen');
});
