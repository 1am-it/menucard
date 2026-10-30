'use strict';

// BE-55 stap B, deel 4 (#135) — de interne werkvoorraad met een fictieve client.
//
// Geen Supabase en geen netwerk: hieronder staat een kleine nagebouwde
// PostgREST (select, insert, update, delete, limit) met dezelfde vorm die de
// handlers gebruiken. Getest worden de dragende punten van de opdracht:
//   - 401 zonder sessie en 403 voor een account zonder de rol `internal`;
//   - de lijst toont alleen tegengehouden of gemeld aanbod, nooit verlopen;
//   - goedkeuren zet het weer online en schrijft een geschiedenisregel;
//   - verwijderen zet het offline, bewaart de rij en schrijft geschiedenis;
//   - het plaatsrecht afnemen en teruggeven schrijft allebei geschiedenis;
//   - zonder migratie antwoordt elke actie 503.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DAGHAP_TABLE_AANBOD,
  DAGHAP_TABLE_GEBEURTENISSEN,
  DAGHAP_TABLE_MELDINGEN,
  DAGHAP_TABLE_PLAATSRECHT,
} = require('./daghapHandlers');
const { createDaghapBeheerHandlers } = require('./daghapBeheerHandlers');

const BEHEERDER_ID = '33333333-3333-4333-8333-333333333333';
const HOLDER_ID = '11111111-1111-4111-8111-111111111111';
const RESTAURANT_ID = '1';
// 30 oktober 2026, 12:00 in Amsterdam (CET): vandaag verloopt om 22:59 UTC.
const NOW = Date.parse('2026-10-30T11:00:00.000Z');
const VERLOOPT_VANDAAG = '2026-10-30T22:59:00.000Z';
const VERLOOPT_GISTEREN = '2026-10-29T22:59:00.000Z';

function request(body, { url = 'http://localhost/api/internal/v1/daghap/werkvoorraad' } = {}) {
  return {
    url,
    headers: { get: () => null },
    json: async () => {
      if (body === undefined) throw new Error('geen json');
      return body;
    },
  };
}

function aanbodRij(overrides = {}) {
  return {
    id: 1,
    restaurant_id: RESTAURANT_ID,
    user_id: HOLDER_ID,
    soort: 'daghap',
    naam: 'Pompoensoep met brood',
    prijs_cent: 650,
    beschrijving: null,
    labels: [],
    status: 'in_controle',
    filter_reden: 'reclame:korting',
    verloopt_op: VERLOOPT_VANDAAG,
    created_at: '2026-10-30T09:00:00.000Z',
    updated_at: '2026-10-30T09:00:00.000Z',
    ...overrides,
  };
}

function fakeSupabase({
  aanbod = [],
  meldingen = [],
  plaatsrecht = [],
  failing = null,
  failingInsert = [],
} = {}) {
  const tables = {
    [DAGHAP_TABLE_AANBOD]: aanbod.map((rij) => aanbodRij(rij)),
    [DAGHAP_TABLE_GEBEURTENISSEN]: [],
    [DAGHAP_TABLE_MELDINGEN]: meldingen.map((rij, index) => ({ melding_id: index + 1, ...rij })),
    [DAGHAP_TABLE_PLAATSRECHT]: plaatsrecht.map((rij) => ({ ...rij })),
  };

  function past(rij, [kolom, hoe, waarde]) {
    const huidig = rij[kolom];
    if (hoe === 'eq') return String(huidig) === String(waarde);
    if (hoe === 'in') return Array.isArray(waarde) && waarde.some((w) => String(w) === String(huidig));
    if (hoe === 'gt') return String(huidig) > String(waarde);
    return false;
  }

  function execute(query, one) {
    if (failing) {
      return Promise.resolve({ data: null, error: { code: '42P01', message: `relation "${query.table}" does not exist` } });
    }
    const rijen = tables[query.table] || [];

    if (query.action === 'select') {
      let gevonden = rijen.filter((rij) => query.filters.every((filter) => past(rij, filter)));
      if (query.order) {
        const { kolom, oplopend } = query.order;
        gevonden = gevonden.slice().sort((a, b) => (oplopend
          ? String(a[kolom]).localeCompare(String(b[kolom]))
          : String(b[kolom]).localeCompare(String(a[kolom]))));
      }
      if (Number.isInteger(query.limit)) gevonden = gevonden.slice(0, query.limit);
      return Promise.resolve({ data: one ? gevonden[0] || null : gevonden, error: null });
    }

    if (query.action === 'insert') {
      if (failingInsert.includes(query.table)) {
        return Promise.resolve({ data: null, error: { code: '23514', message: 'insert geweigerd' } });
      }
      const rij = { ...query.payload };
      if (query.table === DAGHAP_TABLE_GEBEURTENISSEN) rij.gebeurtenis_id = rijen.length + 1;
      if (query.table === DAGHAP_TABLE_PLAATSRECHT) {
        const dubbel = rijen.some((bestaand) => bestaand.restaurant_id === rij.restaurant_id
          && bestaand.user_id === rij.user_id);
        if (dubbel) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } });
      }
      rijen.push(rij);
      return Promise.resolve({ data: one ? rij : [rij], error: null });
    }

    if (query.action === 'update') {
      const gevonden = rijen.filter((rij) => query.filters.every((filter) => past(rij, filter)));
      for (const rij of gevonden) Object.assign(rij, query.payload);
      return Promise.resolve({ data: one ? gevonden[0] || null : gevonden, error: null });
    }

    if (query.action === 'delete') {
      const weg = rijen.filter((rij) => query.filters.every((filter) => past(rij, filter)));
      for (const rij of weg) rijen.splice(rijen.indexOf(rij), 1);
      return Promise.resolve({ data: null, error: null });
    }

    return Promise.resolve({ data: null, error: { message: 'onbekende actie' } });
  }

  function builder(table) {
    const query = {
      table,
      action: 'select',
      filters: [],
      payload: null,
      order: null,
      limit: null,
      select() { return query; },
      eq(kolom, waarde) { query.filters.push([kolom, 'eq', waarde]); return query; },
      in(kolom, waarden) { query.filters.push([kolom, 'in', waarden]); return query; },
      gt(kolom, waarde) { query.filters.push([kolom, 'gt', waarde]); return query; },
      order(kolom, { ascending = true } = {}) { query.order = { kolom, oplopend: ascending }; return query; },
      limit(aantal) { query.limit = aantal; return query; },
      insert(rij) { query.action = 'insert'; query.payload = Array.isArray(rij) ? rij[0] : { ...rij }; return query; },
      update(patch) { query.action = 'update'; query.payload = { ...patch }; return query; },
      delete() { query.action = 'delete'; return query; },
      single() { return execute(query, true); },
      maybeSingle() { return execute(query, true); },
      then(onFulfilled, onRejected) { return execute(query, false).then(onFulfilled, onRejected); },
    };
    return query;
  }

  return { tables, from: (table) => builder(table) };
}

function handlersFor(client, { authenticate } = {}) {
  return createDaghapBeheerHandlers({
    getSupabase: () => client,
    authenticate: authenticate || (async () => ({
      ok: true,
      userId: BEHEERDER_ID,
      roles: [{ role: 'internal', restaurant_id: null }],
    })),
    now: () => NOW,
    timeoutMs: 200,
  });
}

function geschiedenis(client) {
  return client.tables[DAGHAP_TABLE_GEBEURTENISSEN];
}


test('BE-55 beheer: zonder sessie 401 en zonder de rol internal 403', async () => {
  const zonderSessie = fakeSupabase({ aanbod: [aanbodRij()] });
  const anoniem = handlersFor(zonderSessie, { authenticate: async () => ({ ok: false, status: 401, error: 'Missing bearer token' }) });
  const eerste = await anoniem.getWerkvoorraad(request());
  assert.equal(eerste.status, 401);
  assert.equal(eerste.body.error, 'unauthorized');

  // Een houder (owner) of een editor is geen intern beheerder van deze lijst.
  for (const rol of ['owner', 'editor']) {
    const client = fakeSupabase({ aanbod: [aanbodRij()] });
    const hand = handlersFor(client, {
      authenticate: async () => ({ ok: true, userId: HOLDER_ID, roles: [{ role: rol, restaurant_id: RESTAURANT_ID }] }),
    });
    const geweigerd = await hand.getWerkvoorraad(request());
    assert.equal(geweigerd.status, 403, `${rol} hoort geen toegang te krijgen`);
    assert.equal(geweigerd.body.error, 'forbidden');

    const goedkeuren = await hand.keurGoed(request(), { id: '1' });
    assert.equal(goedkeuren.status, 403);
    const verwijderen = await hand.verwijderAanbod(request(), { id: '1' });
    assert.equal(verwijderen.status, 403);
    const recht = await hand.wijzigPlaatsrecht(request({
      restaurant_id: RESTAURANT_ID,
      user_id: HOLDER_ID,
      actie: 'afnemen',
    }));
    assert.equal(recht.status, 403);
    assert.equal(geschiedenis(client).length, 0, 'een geweigerde actie schrijft niets');
    assert.equal(client.tables[DAGHAP_TABLE_PLAATSRECHT].length, 0);
  }
});

test('BE-55 beheer: de lijst toont alleen tegengehouden of gemeld aanbod', async () => {
  const client = fakeSupabase({
    aanbod: [
      aanbodRij({ id: 1, status: 'in_controle', filter_reden: 'reclame:korting' }),
      aanbodRij({ id: 2, status: 'online', soort: 'seizoensgerecht', verloopt_op: '2026-11-20T22:59:00.000Z' }),
      aanbodRij({ id: 3, status: 'online' }),
      aanbodRij({ id: 4, status: 'online', verloopt_op: VERLOOPT_GISTEREN }),
      aanbodRij({ id: 5, status: 'offline' }),
    ],
    meldingen: [{ aanbod_id: 2, apparaat: 'abcdefghijklmnop' }],
    plaatsrecht: [{ restaurant_id: '7', user_id: HOLDER_ID, ingetrokken_op: '2026-10-30T10:00:00.000Z' }],
  });

  const resultaat = await handlersFor(client).getWerkvoorraad(request());

  assert.equal(resultaat.status, 200);
  assert.deepEqual(resultaat.body.aanbod.map((rij) => rij.id), [1, 2]);
  assert.equal(resultaat.body.tegengehouden, 1);
  assert.equal(resultaat.body.gemeld, 1);
  const gemeld = resultaat.body.aanbod.find((rij) => rij.id === 2);
  assert.equal(gemeld.meldingen, 1);
  assert.equal(gemeld.tegengehouden, false);
  assert.equal(gemeld.houderId, HOLDER_ID);
  assert.deepEqual(resultaat.body.plaatsrecht, [
    { restaurantId: '7', houderId: HOLDER_ID, ingetrokkenOp: '2026-10-30T10:00:00.000Z' },
  ]);
});

test('BE-55 beheer: goedkeuren zet het aanbod weer online en schrijft geschiedenis', async () => {
  const client = fakeSupabase({ aanbod: [aanbodRij({ id: 1, status: 'in_controle' })] });
  const hand = handlersFor(client);

  const resultaat = await hand.keurGoed(request(), { id: '1' });

  assert.equal(resultaat.status, 200);
  assert.equal(resultaat.body.aanbod.status, 'online');
  const rij = client.tables[DAGHAP_TABLE_AANBOD][0];
  assert.equal(rij.status, 'online');
  assert.equal(rij.filter_reden, null, 'de filterreden is opgelost');
  const regels = geschiedenis(client);
  assert.equal(regels.length, 1);
  assert.equal(regels[0].actie, 'goedgekeurd');
  assert.equal(regels[0].aanbod_id, 1);
  assert.equal(regels[0].restaurant_id, RESTAURANT_ID);
  assert.equal(regels[0].door, BEHEERDER_ID);

  // Verlopen aanbod komt niet terug, ook niet met goedkeuren.
  const verlopen = fakeSupabase({ aanbod: [aanbodRij({ id: 2, verloopt_op: VERLOOPT_GISTEREN })] });
  const geweigerd = await handlersFor(verlopen).keurGoed(request(), { id: '2' });
  assert.equal(geweigerd.status, 409);
  assert.equal(geschiedenis(verlopen).length, 0);

  // Een onbekend id is een 404, geen 500.
  const onbekend = await hand.keurGoed(request(), { id: '99' });
  assert.equal(onbekend.status, 404);
});

test('BE-55 beheer: verwijderen zet het offline, bewaart de rij en schrijft geschiedenis', async () => {
  const client = fakeSupabase({ aanbod: [aanbodRij({ id: 1, status: 'in_controle' })] });

  const resultaat = await handlersFor(client).verwijderAanbod(request(), { id: '1' });

  assert.equal(resultaat.status, 200);
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD].length, 1, 'de rij blijft bewaard');
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD][0].status, 'offline');
  const regels = geschiedenis(client);
  assert.equal(regels.length, 1);
  assert.equal(regels[0].actie, 'verwijderd');
  assert.equal(regels[0].door, BEHEERDER_ID);
});

test('BE-55 beheer: plaatsrecht afnemen en teruggeven schrijft allebei een geschiedenisregel', async () => {
  const client = fakeSupabase();
  const hand = handlersFor(client);

  const afgenomen = await hand.wijzigPlaatsrecht(request({
    restaurant_id: RESTAURANT_ID,
    user_id: HOLDER_ID,
    actie: 'afnemen',
  }));
  assert.equal(afgenomen.status, 200);
  assert.deepEqual(
    client.tables[DAGHAP_TABLE_PLAATSRECHT].map((rij) => [rij.restaurant_id, rij.user_id]),
    [[RESTAURANT_ID, HOLDER_ID]],
  );
  assert.equal(geschiedenis(client).length, 1);
  assert.equal(geschiedenis(client)[0].actie, 'recht_afgenomen');
  assert.equal(geschiedenis(client)[0].aanbod_id, null, 'een rechtactie hoort bij een restaurant');
  assert.equal(geschiedenis(client)[0].restaurant_id, RESTAURANT_ID);
  assert.deepEqual(geschiedenis(client)[0].gegevens, { houder_id: HOLDER_ID });

  // Nog eens afnemen is geen fout (23505): de geschiedenis groeit wel.
  const nogmaals = await hand.wijzigPlaatsrecht(request({ restaurant_id: RESTAURANT_ID, user_id: HOLDER_ID, actie: 'afnemen' }));
  assert.equal(nogmaals.status, 200);
  assert.equal(geschiedenis(client).length, 2);

  const terug = await hand.wijzigPlaatsrecht(request({ restaurant_id: RESTAURANT_ID, user_id: HOLDER_ID, actie: 'teruggeven' }));
  assert.equal(terug.status, 200);
  assert.equal(client.tables[DAGHAP_TABLE_PLAATSRECHT].length, 0);
  assert.equal(geschiedenis(client).length, 3);
  assert.equal(geschiedenis(client)[2].actie, 'recht_teruggegeven');

  // Zonder houder of met een onbekende actie: 400 en niets geschreven.
  const ongeldig = await hand.wijzigPlaatsrecht(request({ restaurant_id: RESTAURANT_ID, user_id: 'geen-uuid', actie: 'afnemen' }));
  assert.equal(ongeldig.status, 400);
  assert.equal(ongeldig.body.error, 'user_required');
  const rareActie = await hand.wijzigPlaatsrecht(request({ restaurant_id: RESTAURANT_ID, user_id: HOLDER_ID, actie: 'wissen' }));
  assert.equal(rareActie.status, 400);
  assert.equal(geschiedenis(client).length, 3);
});

test('BE-55 beheer: zonder migratie antwoordt elke actie 503', async () => {
  const client = fakeSupabase({ failing: true });
  const hand = handlersFor(client);

  const lijst = await hand.getWerkvoorraad(request());
  assert.equal(lijst.status, 503);
  assert.equal(lijst.body.error, 'daghap_unavailable');

  const goedkeuren = await hand.keurGoed(request(), { id: '1' });
  assert.equal(goedkeuren.status, 503);

  const recht = await hand.wijzigPlaatsrecht(request({ restaurant_id: RESTAURANT_ID, user_id: HOLDER_ID, actie: 'afnemen' }));
  assert.equal(recht.status, 503);
});
