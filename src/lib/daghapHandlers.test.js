'use strict';

// BE-55 stap A (#135, criterium 2) — de handlers met een fictieve client.
//
// Geen Supabase, geen netwerk: de client hieronder is een klein nagebouwde
// PostgREST (select, insert, update, rpc) met dezelfde vorm die de handlers
// gebruiken. Daarmee worden de dragende punten uit het contract getest:
//   - een niet-eigenaar krijgt 403 en een gast zonder sessie 401;
//   - een aanbod boven de limiet wordt geweigerd (1 daghap, 3 seizoens,
//     10 plaatsingen of wijzigingen per dag);
//   - een filtertreffer gaat naar `in_controle`, niet online;
//   - verlopen aanbod komt nooit terug, ook niet via de lijst;
//   - elke plaatsing, wijziging en offline-actie staat in de geschiedenis;
//   - zonder migratie antwoordt elke route 503.
//
// De prijsgrens gebruikt de echte menukaarten van restaurant 1.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const menusData = require('../../data/menus.json');
const restaurantsData = require('../../data/restaurants.json');
const { duursteKaartPrijsCent } = require('./daghapAanbod');
const {
  DAGHAP_CLEANUP_FUNCTION,
  DAGHAP_MELDINGEN_TOT_CONTROLE,
  DAGHAP_TABLE_AANBOD,
  DAGHAP_TABLE_GEBEURTENISSEN,
  DAGHAP_TABLE_MELDINGEN,
  createDaghapHandlers,
} = require('./daghapHandlers');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const RESTAURANT_ID = '1';
// 30 oktober 2026, 12:00 in Amsterdam (CET): de daghap verloopt om 22:59 UTC.
const NOW = Date.parse('2026-10-30T11:00:00.000Z');
const VERLOOPT_VANDAAG = '2026-10-30T22:59:00.000Z';
const VERLOOPT_GISTEREN = '2026-10-29T22:59:00.000Z';

/** Een verzoek zoals Next.js hem aan een route geeft. */
function request(body, { url = `http://localhost/api/v1/daghap?restaurant_id=${RESTAURANT_ID}`, headers = {} } = {}) {
  return {
    url,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
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
    user_id: OWNER_ID,
    soort: 'daghap',
    naam: 'Pompoensoep met brood',
    prijs_cent: 650,
    beschrijving: null,
    labels: [],
    status: 'online',
    filter_reden: null,
    verloopt_op: VERLOOPT_VANDAAG,
    created_at: '2026-10-30T09:00:00.000Z',
    updated_at: '2026-10-30T09:00:00.000Z',
    ...overrides,
  };
}

function daghapBody(overrides = {}) {
  return {
    restaurant_id: RESTAURANT_ID,
    soort: 'daghap',
    naam: 'Pompoensoep met brood',
    prijs: '6,50',
    beschrijving: 'Met geroosterde pompoenpitten',
    labels: ['veganistisch'],
    ...overrides,
  };
}

/**
 * De fictieve client. `eigenaren` is de lijst staff_roles-rijen: alleen een rij
 * met rol owner voor dit restaurant maakt iemand houder. `failing` laat één of
 * meer tabellen ontbreken (42P01), precies de fout van een nog niet toegepaste
 * 0023.
 */
function fakeSupabase({ aanbod = [], gebeurtenissen = [], meldingen = [], eigenaren = [{ user_id: OWNER_ID, role: 'owner', restaurant_id: RESTAURANT_ID }], failing = null, failingInsert = [], rpcResult = 2, rpcError = null } = {}) {
  const tables = {
    [DAGHAP_TABLE_AANBOD]: aanbod.map((rij) => aanbodRij(rij)),
    [DAGHAP_TABLE_GEBEURTENISSEN]: gebeurtenissen.map((rij, index) => ({ gebeurtenis_id: index + 1, ...rij })),
    [DAGHAP_TABLE_MELDINGEN]: meldingen.map((rij, index) => ({ melding_id: index + 1, ...rij })),
    staff_roles: eigenaren.map((rij, index) => ({ id: index + 1, ...rij })),
  };
  const calls = [];
  const rpcCalls = [];
  let volgendeId = tables[DAGHAP_TABLE_AANBOD].length + 1;

  function errorFor(table) {
    if (!failing) return null;
    return failing[table] ? { code: '42P01', message: `relation "${table}" does not exist` } : null;
  }

  function past(rij, [kolom, hoe, waarde]) {
    const huidig = rij[kolom];
    if (hoe === 'eq') return String(huidig) === String(waarde);
    if (hoe === 'in') return Array.isArray(waarde) && waarde.includes(huidig);
    if (hoe === 'gt') return String(huidig) > String(waarde);
    if (hoe === 'gte') return String(huidig) >= String(waarde);
    return false;
  }

  function execute(query, one) {
    calls.push({
      table: query.table,
      action: query.action,
      filters: query.filters.slice(),
      payload: query.payload,
    });
    const error = errorFor(query.table);
    if (error) return Promise.resolve({ data: null, error });
    const rijen = tables[query.table] || [];

    if (query.action === 'select') {
      let gevonden = rijen.filter((rij) => query.filters.every((filter) => past(rij, filter)));
      if (query.order) {
        const { kolom, oplopend } = query.order;
        gevonden = gevonden.slice().sort((a, b) => (oplopend
          ? String(a[kolom]).localeCompare(String(b[kolom]))
          : String(b[kolom]).localeCompare(String(a[kolom]))));
      }
      return Promise.resolve({ data: one ? gevonden[0] || null : gevonden, error: null });
    }

    if (query.action === 'insert') {
      if (failingInsert.includes(query.table)) {
        return Promise.resolve({ data: null, error: { code: '23514', message: 'insert geweigerd' } });
      }
      const rij = { ...query.payload };
      if (query.table === DAGHAP_TABLE_AANBOD) {
        const botsing = rijen.some((bestaand) => bestaand.restaurant_id === rij.restaurant_id
          && bestaand.soort === 'daghap'
          && rij.soort === 'daghap'
          && ['online', 'in_controle'].includes(bestaand.status));
        if (botsing) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } });
        rij.id = volgendeId;
        volgendeId += 1;
        rij.created_at = rij.created_at || '2026-10-30T11:00:00.000Z';
      } else if (query.table === DAGHAP_TABLE_MELDINGEN) {
        // De unieke constraint van 0023: één melding per (aanbod, apparaat).
        const dubbel = rijen.some((bestaand) => String(bestaand.aanbod_id) === String(rij.aanbod_id)
          && bestaand.apparaat === rij.apparaat);
        if (dubbel) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } });
        rij.melding_id = rijen.length + 1;
        rij.created_at = '2026-10-30T11:00:00.000Z';
      } else {
        rij.gebeurtenis_id = rijen.length + 1;
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
      const verwijderd = rijen.filter((rij) => query.filters.every((filter) => past(rij, filter)));
      for (const rij of verwijderd) rijen.splice(rijen.indexOf(rij), 1);
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
      select() { return query; },
      eq(kolom, waarde) { query.filters.push([kolom, 'eq', waarde]); return query; },
      in(kolom, waarden) { query.filters.push([kolom, 'in', waarden]); return query; },
      gt(kolom, waarde) { query.filters.push([kolom, 'gt', waarde]); return query; },
      gte(kolom, waarde) { query.filters.push([kolom, 'gte', waarde]); return query; },
      order(kolom, { ascending = true } = {}) { query.order = { kolom, oplopend: ascending }; return query; },
      insert(rij) { query.action = 'insert'; query.payload = Array.isArray(rij) ? rij[0] : { ...rij }; return query; },
      update(patch) { query.action = 'update'; query.payload = { ...patch }; return query; },
      delete() { query.action = 'delete'; return query; },
      single() { return execute(query, true); },
      maybeSingle() { return execute(query, true); },
      then(onFulfilled, onRejected) { return execute(query, false).then(onFulfilled, onRejected); },
    };
    return query;
  }

  return {
    calls,
    rpcCalls,
    tables,
    from: (table) => builder(table),
    rpc: (naam, args) => {
      rpcCalls.push({ naam, args });
      if (rpcError) return Promise.resolve({ data: null, error: rpcError });
      // De opruimfunctie doet wat ruim_verlopen_daghap_op in 0023 doet: verlopen
      // aanbod op 'verlopen' en één geschiedenisregel per aanbod.
      if (naam === DAGHAP_CLEANUP_FUNCTION) {
        const verlopen = tables[DAGHAP_TABLE_AANBOD].filter((rij) => String(rij.verloopt_op) <= new Date(NOW).toISOString()
          && ['online', 'in_controle'].includes(rij.status));
        for (const rij of verlopen) {
          rij.status = 'verlopen';
          tables[DAGHAP_TABLE_GEBEURTENISSEN].push({
            gebeurtenis_id: tables[DAGHAP_TABLE_GEBEURTENISSEN].length + 1,
            aanbod_id: rij.id,
            restaurant_id: rij.restaurant_id,
            actie: 'verlopen',
            door: null,
            gegevens: { naam: rij.naam, prijs_cent: rij.prijs_cent, status: rij.status },
            moment: new Date(NOW).toISOString(),
          });
        }
        return Promise.resolve({ data: verlopen.length, error: null });
      }
      return Promise.resolve({ data: rpcResult, error: null });
    },

  };
}

function handlersFor(client, overrides = {}) {
  return createDaghapHandlers({
    getSupabase: () => client,
    authenticate: async () => ({ ok: true, userId: OWNER_ID }),
    duursteKaartPrijs: (restaurantId) => duursteKaartPrijsCent({
      restaurantId,
      restaurant: restaurantsData[restaurantId],
      menus: menusData,
    }),
    now: () => NOW,
    timeoutMs: 200,
    ...overrides,
  });
}

/** De geschiedenisregels van deze client, in volgorde. */
function geschiedenis(client) {
  return client.tables[DAGHAP_TABLE_GEBEURTENISSEN];
}

test('BE-55: een houder plaatst een daghap en de geschiedenis bewaart hem', async () => {
  const client = fakeSupabase();
  const handlers = handlersFor(client);

  const resultaat = await handlers.plaatsAanbod(request(daghapBody()));

  assert.equal(resultaat.status, 201);
  assert.equal(resultaat.body.ok, true);
  assert.equal(resultaat.body.aanbod.status, 'online');
  assert.equal(resultaat.body.aanbod.prijs, '€ 6,50');
  assert.equal(resultaat.body.aanbod.verlooptOp, VERLOOPT_VANDAAG);
  assert.equal(resultaat.body.inControle, false);

  const rijen = geschiedenis(client);
  assert.equal(rijen.length, 1);
  assert.equal(rijen[0].actie, 'geplaatst');
  assert.equal(rijen[0].door, OWNER_ID);
  assert.equal(rijen[0].restaurant_id, RESTAURANT_ID);
  assert.equal(rijen[0].gegevens.naam, 'Pompoensoep met brood');
  assert.equal(rijen[0].gegevens.status, 'online');
});

test('BE-55: zonder sessie is het 401 en zonder claim op dit restaurant 403', async () => {
  const zonderSessie = fakeSupabase();
  const anoniem = handlersFor(zonderSessie, { authenticate: async () => ({ ok: false, status: 401 }) });
  const eerste = await anoniem.plaatsAanbod(request(daghapBody()));
  assert.equal(eerste.status, 401);
  assert.equal(eerste.body.message, 'Log in om je aanbod te beheren.');
  assert.equal(zonderSessie.calls.length, 0, 'zonder sessie wordt er niets geschreven');

  // Ingelogd, maar geen owner-rij voor dít restaurant (bijvoorbeeld nog een
  // openstaande claim, of een houder van een ander restaurant).
  const vreemde = fakeSupabase({
    eigenaren: [{ user_id: OTHER_ID, role: 'owner', restaurant_id: RESTAURANT_ID }],
  });
  const nietEigenaar = handlersFor(vreemde);
  const tweede = await nietEigenaar.plaatsAanbod(request(daghapBody()));
  assert.equal(tweede.status, 403);
  assert.equal(tweede.body.message, 'Je bent geen houder van dit restaurant.');
  assert.equal(geschiedenis(vreemde).length, 0);
  assert.equal(vreemde.tables[DAGHAP_TABLE_AANBOD].length, 0);

  // Wel houder, maar van een ander restaurant: ook 403.
  const anderRestaurant = fakeSupabase({
    eigenaren: [{ user_id: OWNER_ID, role: 'owner', restaurant_id: '6' }],
  });
  const derde = await handlersFor(anderRestaurant).plaatsAanbod(request(daghapBody()));
  assert.equal(derde.status, 403);
});

test('BE-55: een filtertreffer gaat naar in_controle, niet online', async () => {
  const client = fakeSupabase();
  const handlers = handlersFor(client);

  const resultaat = await handlers.plaatsAanbod(request(daghapBody({ naam: 'Pizza met 50% korting' })));

  assert.equal(resultaat.status, 201);
  assert.equal(resultaat.body.aanbod.status, 'in_controle');
  assert.equal(resultaat.body.inControle, true);
  assert.equal(resultaat.body.aanbod.melding, 'Wordt kort gecontroleerd.');
  assert.equal(resultaat.body.bericht, 'Wordt kort gecontroleerd.');
  const rij = client.tables[DAGHAP_TABLE_AANBOD][0];
  assert.equal(rij.status, 'in_controle');
  assert.match(rij.filter_reden, /reclame:korting/);
});

test('BE-55: een prijs boven 3× de duurste prijs op de kaart gaat naar in_controle', async () => {
  const client = fakeSupabase();
  // De kaart van dit restaurant is € 10,00: alles boven € 30,00 is verdacht.
  const handlers = handlersFor(client, { duursteKaartPrijs: () => 1000 });

  const teDuur = await handlers.plaatsAanbod(request(daghapBody({ prijs: '31,00' })));
  assert.equal(teDuur.status, 201);
  assert.equal(teDuur.body.aanbod.status, 'in_controle');
  assert.match(client.tables[DAGHAP_TABLE_AANBOD][0].filter_reden, /prijs:boven_kaart/);

  const netjes = fakeSupabase();
  const nogNet = await handlersFor(netjes, { duursteKaartPrijs: () => 1000 })
    .plaatsAanbod(request(daghapBody({ prijs: '30,00' })));
  assert.equal(nogNet.body.aanbod.status, 'online');
});

test('BE-55: een ongeldig aanbod wordt met een 400 en de foutcodes geweigerd', async () => {
  const client = fakeSupabase();
  const handlers = handlersFor(client);

  const resultaat = await handlers.plaatsAanbod(request(daghapBody({ naam: 'So', prijs: '0,10' })));

  assert.equal(resultaat.status, 400);
  assert.equal(resultaat.body.error, 'invalid_aanbod');
  assert.ok(resultaat.body.errors.includes('naam_te_kort'));
  assert.ok(resultaat.body.errors.includes('prijs_ongeldig'));
  assert.deepEqual(resultaat.body.messages, ['Gebruik een naam van 3 tot 80 tekens.', 'Vul een prijs tussen € 0,50 en € 150 in.']);
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD].length, 0);
  assert.equal(geschiedenis(client).length, 0);
});

test('BE-55: een tweede daghap, een vierde seizoensgerecht en de daglimiet worden geweigerd', async () => {
  const tweedeDaghap = fakeSupabase({ aanbod: [aanbodRij()] });
  const daghap = await handlersFor(tweedeDaghap).plaatsAanbod(request(daghapBody()));
  assert.equal(daghap.status, 409);
  assert.equal(daghap.body.error, 'daghap_limiet');
  assert.equal(daghap.body.message, 'Er staat al een daghap online voor vandaag.');

  const seizoenRij = (id) => aanbodRij({
    id,
    soort: 'seizoensgerecht',
    verloopt_op: '2026-11-20T22:59:00.000Z',
  });
  const vierdeSeizoen = fakeSupabase({ aanbod: [seizoenRij(2), seizoenRij(3), seizoenRij(4)] });
  const seizoen = await handlersFor(vierdeSeizoen).plaatsAanbod(request(daghapBody({
    soort: 'seizoensgerecht',
    einddatum: '2026-12-01',
  })));
  assert.equal(seizoen.status, 409);
  assert.equal(seizoen.body.error, 'seizoenslimiet');
  assert.equal(seizoen.body.message, 'Er staan al 3 seizoensgerechten online.');

  // Drie seizoensgerechten mogen wel (de grens is 3, niet 2).
  const derdeSeizoen = fakeSupabase({ aanbod: [seizoenRij(2), seizoenRij(3)] });
  const derde = await handlersFor(derdeSeizoen).plaatsAanbod(request(daghapBody({
    soort: 'seizoensgerecht',
    einddatum: '2026-12-01',
  })));
  assert.equal(derde.status, 201);

  // Tien plaatsingen of wijzigingen vandaag is de grens; de elfde is een 429.
  const vandaag = Array.from({ length: 10 }, () => ({
    aanbod_id: 99,
    restaurant_id: RESTAURANT_ID,
    actie: 'geplaatst',
    door: OWNER_ID,
    moment: '2026-10-30T09:00:00.000Z',
  }));
  const daglimiet = fakeSupabase({ gebeurtenissen: vandaag });
  const geweigerd = await handlersFor(daglimiet).plaatsAanbod(request(daghapBody()));
  assert.equal(geweigerd.status, 429);
  assert.equal(geweigerd.body.error, 'daglimiet');
  assert.equal(geweigerd.body.message, 'Je kunt per dag maximaal 10 keer iets plaatsen of wijzigen.');
  assert.equal(daglimiet.tables[DAGHAP_TABLE_AANBOD].length, 0);

  // Negen mag nog.
  const negen = fakeSupabase({ gebeurtenissen: vandaag.slice(0, 9) });
  const mag = await handlersFor(negen).plaatsAanbod(request(daghapBody()));
  assert.equal(mag.status, 201);

  // Een regel van gisteren telt niet mee voor vandaag.
  const gisteren = fakeSupabase({
    gebeurtenissen: vandaag.map((rij) => ({ ...rij, moment: '2026-10-29T09:00:00.000Z' })),
  });
  assert.equal((await handlersFor(gisteren).plaatsAanbod(request(daghapBody()))).status, 201);
});

test('BE-55: verlopen aanbod wordt nooit meer getoond of gewijzigd', async () => {
  const client = fakeSupabase({
    aanbod: [aanbodRij({ verloopt_op: VERLOOPT_GISTEREN })],
  });
  const handlers = handlersFor(client);

  // De lijst laat het niet zien, ook al heeft de opruiming nog niet gelopen.
  const lijst = await handlers.lijstAanbod(request(undefined));
  assert.equal(lijst.status, 200);
  assert.deepEqual(lijst.body.aanbod, []);
  assert.equal(lijst.body.daghap, 0);

  // Wijzigen en offline halen worden geweigerd.
  const wijzigen = await handlers.wijzigAanbod(request(daghapBody({ naam: 'Nieuw gerecht' })), { id: 1 });
  assert.equal(wijzigen.status, 409);
  assert.equal(wijzigen.body.error, 'verlopen');
  const offline = await handlers.offlineAanbod(request(undefined), { id: 1 });
  assert.equal(offline.status, 409);

  // En de opruiming zet hem op verlopen, met één geschiedenisregel.
  const opgeruimd = await handlers.ruimVerlopenOp();
  assert.equal(opgeruimd.status, 200);
  assert.equal(opgeruimd.body.verlopen, 1);
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD][0].status, 'verlopen');
  assert.equal(geschiedenis(client).filter((rij) => rij.actie === 'verlopen').length, 1);
});

test('BE-55: een daghap van gisteren blokkeert een nieuwe daghap niet', async () => {
  const client = fakeSupabase({ aanbod: [aanbodRij({ verloopt_op: VERLOOPT_GISTEREN })] });
  const resultaat = await handlersFor(client).plaatsAanbod(request(daghapBody()));

  assert.equal(resultaat.status, 201, 'eerst opruimen, dan opnieuw proberen');
  assert.deepEqual(client.rpcCalls.map((call) => call.naam), [DAGHAP_CLEANUP_FUNCTION]);
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD].length, 2);
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD][0].status, 'verlopen');
});

test('BE-55: de houder wijzigt zijn aanbod en de geschiedenis bewaart beide versies', async () => {
  const client = fakeSupabase({ aanbod: [aanbodRij()] });
  const handlers = handlersFor(client);

  const resultaat = await handlers.wijzigAanbod(
    request(daghapBody({ naam: 'Pompoensoep met rozemarijn', prijs: '7,25' })),
    { id: 1 },
  );

  assert.equal(resultaat.status, 200);
  assert.equal(resultaat.body.aanbod.naam, 'Pompoensoep met rozemarijn');
  assert.equal(resultaat.body.aanbod.prijs, '€ 7,25');
  const rijen = geschiedenis(client);
  assert.equal(rijen.length, 1);
  assert.equal(rijen[0].actie, 'gewijzigd');
  assert.equal(rijen[0].door, OWNER_ID);
  assert.equal(rijen[0].gegevens.naam, 'Pompoensoep met rozemarijn');
});

test('BE-55: wijzigen door een niet-eigenaar is 403, een onbekend aanbod is 404', async () => {
  const vreemde = fakeSupabase({
    aanbod: [aanbodRij()],
    eigenaren: [{ user_id: OTHER_ID, role: 'owner', restaurant_id: RESTAURANT_ID }],
  });
  const geweigerd = await handlersFor(vreemde).wijzigAanbod(request(daghapBody()), { id: 1 });
  assert.equal(geweigerd.status, 403);
  assert.equal(vreemde.tables[DAGHAP_TABLE_AANBOD][0].naam, 'Pompoensoep met brood');

  const leeg = fakeSupabase();
  const handlers = handlersFor(leeg);
  assert.equal((await handlers.wijzigAanbod(request(daghapBody()), { id: 99 })).status, 404);
  assert.equal((await handlers.wijzigAanbod(request(daghapBody()), { id: 'geen-id' })).status, 404);
  assert.equal((await handlers.offlineAanbod(request(undefined), { id: 99 })).status, 404);
});

test('BE-55: offline halen werkt en is een tweede keer geen fout', async () => {
  const client = fakeSupabase({ aanbod: [aanbodRij()] });
  const handlers = handlersFor(client);

  const eerste = await handlers.offlineAanbod(request(undefined), { id: 1 });
  assert.equal(eerste.status, 200);
  assert.equal(eerste.body.gewijzigd, true);
  assert.equal(eerste.body.aanbod.status, 'offline');
  assert.equal(eerste.body.bericht, 'Je aanbod staat niet meer online.');
  assert.equal(geschiedenis(client).filter((rij) => rij.actie === 'offline').length, 1);

  const tweede = await handlers.offlineAanbod(request(undefined), { id: 1 });
  assert.equal(tweede.status, 200);
  assert.equal(tweede.body.gewijzigd, false);
  assert.equal(geschiedenis(client).filter((rij) => rij.actie === 'offline').length, 1, 'geen tweede regel');

  // Een offline aanbod blijft offline als de houder het wijzigt: wijzigen publiceert niet.
  const gewijzigd = await handlers.wijzigAanbod(
    request(daghapBody({ beschrijving: 'Morgen weer' })),
    { id: 1 },
  );
  assert.equal(gewijzigd.status, 200);
  assert.equal(gewijzigd.body.aanbod.status, 'offline');
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD][0].beschrijving, 'Morgen weer');
});

test('BE-55: de houder ziet wat er van zijn restaurant online staat', async () => {
  const client = fakeSupabase({
    aanbod: [
      aanbodRij({ id: 1 }),
      aanbodRij({ id: 2, soort: 'seizoensgerecht', verloopt_op: '2026-11-20T22:59:00.000Z' }),
      aanbodRij({ id: 3, soort: 'seizoensgerecht', status: 'offline', verloopt_op: '2026-11-21T22:59:00.000Z' }),
      aanbodRij({ id: 4, soort: 'seizoensgerecht', verloopt_op: VERLOOPT_GISTEREN }),
      aanbodRij({ id: 5, restaurant_id: '6' }),
    ],
  });

  const resultaat = await handlersFor(client).lijstAanbod(request(undefined));

  assert.equal(resultaat.status, 200);
  assert.deepEqual(resultaat.body.aanbod.map((rij) => rij.id), [1, 2, 3]);
  assert.equal(resultaat.body.daghap, 1);
  assert.equal(resultaat.body.seizoensgerechten, 2);
  assert.equal(resultaat.body.aanbod[0].naam, 'Pompoensoep met brood');
});

test('BE-55: zonder de migratie antwoordt elke route 503 en blijft de app werken', async () => {
  const zonderTabel = fakeSupabase({ failing: { [DAGHAP_TABLE_AANBOD]: true } });
  const handlers = handlersFor(zonderTabel);
  const plaatsen = await handlers.plaatsAanbod(request(daghapBody()));
  assert.equal(plaatsen.status, 503);
  assert.equal(plaatsen.body.error, 'daghap_unavailable');
  assert.equal(plaatsen.body.message, 'Daghappen zijn nog niet beschikbaar.');
  assert.equal((await handlers.lijstAanbod(request(undefined))).status, 503);

  const zonderGeschiedenis = fakeSupabase({ failing: { [DAGHAP_TABLE_GEBEURTENISSEN]: true } });
  assert.equal((await handlersFor(zonderGeschiedenis).plaatsAanbod(request(daghapBody()))).status, 503);

  const zonderRollen = fakeSupabase({ failing: { staff_roles: true } });
  assert.equal((await handlersFor(zonderRollen).plaatsAanbod(request(daghapBody()))).status, 503);

  const zonderFunctie = fakeSupabase({
    rpcError: { code: '42883', message: 'function ruim_verlopen_daghap_op does not exist' },
  });
  assert.equal((await handlersFor(zonderFunctie).ruimVerlopenOp()).status, 503);

  // En zonder client (geen sleutel in deze omgeving) gebeurt er niets gevaarlijks.
  const zonderClient = createDaghapHandlers({
    getSupabase: () => { throw new Error('geen sleutel'); },
    authenticate: async () => ({ ok: true, userId: OWNER_ID }),
    now: () => NOW,
  });
  assert.equal((await zonderClient.plaatsAanbod(request(daghapBody()))).status, 503);
  assert.equal((await zonderClient.ruimVerlopenOp()).status, 503);
});

test('BE-55: geen geschiedenis betekent geen plaatsing', async () => {
  // De geschiedenistabel weigert de insert: dan mag het aanbod er niet blijven
  // staan, want elke plaatsing moet te herleiden zijn.
  const client = fakeSupabase({ failingInsert: [DAGHAP_TABLE_GEBEURTENISSEN] });
  const resultaat = await handlersFor(client).plaatsAanbod(request(daghapBody()));

  assert.equal(resultaat.status, 500);
  assert.equal(resultaat.body.error, 'daghap_failed');
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD].length, 0, 'de rij is weer weggehaald');
  assert.equal(geschiedenis(client).length, 0);
});

test('BE-55: de opruiming roept de functie uit 0023 aan', async () => {
  const client = fakeSupabase({ rpcResult: 3 });
  const resultaat = await handlersFor(client).ruimVerlopenOp();
  assert.equal(resultaat.status, 200);
  assert.equal(resultaat.body.ok, true);
  assert.equal(resultaat.body.verlopen, 0, 'de nep-functie ruimt niets op in een lege client');
  assert.deepEqual(client.rpcCalls.map((call) => call.naam), ['ruim_verlopen_daghap_op']);
});

test('BE-55: de publieke GET geeft alleen online, niet-verlopen aanbod zonder interne velden', async () => {
  const client = fakeSupabase({
    aanbod: [
      { id: 1, naam: 'Pompoensoep', status: 'online' },
      { id: 2, naam: 'Griekse salade', status: 'in_controle', soort: 'seizoensgerecht' },
      { id: 3, naam: 'Erwtensoep', status: 'online', verloopt_op: VERLOOPT_GISTEREN },
      { id: 4, naam: 'Herfststoof', status: 'offline', soort: 'seizoensgerecht' },
    ],
  });
  const resultaat = await handlersFor(client).publiekAanbod(
    request(undefined, { url: `http://localhost/api/v1/daghap/publiek?restaurant_id=${RESTAURANT_ID}` }),
  );

  assert.equal(resultaat.status, 200);
  assert.deepEqual(resultaat.body.aanbod.map((rij) => rij.naam), ['Pompoensoep']);
  const rij = resultaat.body.aanbod[0];
  assert.deepEqual(Object.keys(rij).sort(), [
    'beschrijving', 'id', 'labels', 'naam', 'prijs', 'prijsCent', 'soort', 'verlooptOp',
  ]);
  assert.equal(rij.status, undefined);
  assert.equal(rij.filter_reden, undefined);
  assert.equal(rij.restaurant_id, undefined);
});

test('BE-55: de publieke GET vraagt om één restaurant en werkt zonder migratie', async () => {
  const client = fakeSupabase();
  const zonderId = await handlersFor(client).publiekAanbod(request(undefined, { url: 'http://localhost/api/v1/daghap/publiek' }));
  assert.equal(zonderId.status, 400);

  const zonderTabel = fakeSupabase({ failing: { [DAGHAP_TABLE_AANBOD]: true } });
  const uitkomst = await handlersFor(zonderTabel).publiekAanbod(
    request(undefined, { url: `http://localhost/api/v1/daghap/publiek?restaurant_id=${RESTAURANT_ID}` }),
  );
  assert.equal(uitkomst.status, 503);
});

function meldRequest(apparaat, { id = 1 } = {}) {
  return request({ apparaat }, { url: `http://localhost/api/v1/daghap/${id}/meld` });
}

const APPARAAT_A = 'apparaat-aaaaaaaaaaaa-1';
const APPARAAT_B = 'apparaat-bbbbbbbbbbbb-2';
const APPARAAT_C = 'apparaat-cccccccccccc-3';



test('BE-55: na drie meldingen van drie apparaten gaat het aanbod op in_controle', async () => {
  const client = fakeSupabase({ aanbod: [{ id: 1, status: 'online' }] });
  const handlers = handlersFor(client);

  const eerste = await handlers.meldAanbod(meldRequest(APPARAAT_A), { id: '1' });
  assert.equal(eerste.status, 200);
  assert.equal(eerste.body.gemeld, true);
  assert.equal(eerste.body.inControle, false);
  assert.equal(eerste.body.aantal, 1);

  const tweede = await handlers.meldAanbod(meldRequest(APPARAAT_B), { id: '1' });
  assert.equal(tweede.body.aantal, 2);
  assert.equal(tweede.body.inControle, false);
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD][0].status, 'online');

  const derde = await handlers.meldAanbod(meldRequest(APPARAAT_C), { id: '1' });
  assert.equal(derde.status, 200);
  assert.equal(derde.body.aantal, DAGHAP_MELDINGEN_TOT_CONTROLE);
  assert.equal(derde.body.inControle, true);
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD][0].status, 'in_controle');
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD][0].filter_reden, 'meldingen');

  const acties = geschiedenis(client).map((rij) => rij.actie);
  assert.deepEqual(acties, ['gemeld', 'gemeld', 'gemeld', 'in_controle']);
  assert.equal(client.tables[DAGHAP_TABLE_MELDINGEN].length, 3);
  // Van de gast blijft alleen het apparaatkenmerk over: geen account, geen IP.
  assert.deepEqual(Object.keys(client.tables[DAGHAP_TABLE_MELDINGEN][0]).sort(), [
    'aanbod_id', 'apparaat', 'created_at', 'melding_id',
  ]);
  assert.equal(geschiedenis(client)[0].door, null);
  assert.equal(geschiedenis(client)[0].apparaat, APPARAAT_A);
});

test('BE-55: dubbel melden vanaf hetzelfde apparaat telt één keer', async () => {
  const client = fakeSupabase({
    aanbod: [{ id: 1, status: 'online' }],
    meldingen: [
      { aanbod_id: 1, apparaat: APPARAAT_A },
      { aanbod_id: 1, apparaat: APPARAAT_B },
    ],
  });
  const handlers = handlersFor(client);

  const dubbel = await handlers.meldAanbod(meldRequest(APPARAAT_A), { id: '1' });
  assert.equal(dubbel.status, 200, 'dubbel melden is geen fout');
  assert.equal(dubbel.body.alGemeld, true);
  assert.equal(dubbel.body.gemeld, false);
  assert.equal(dubbel.body.aantal, 2, 'de tweede melding telt niet op');
  assert.equal(dubbel.body.inControle, false);
  assert.equal(client.tables[DAGHAP_TABLE_AANBOD][0].status, 'online');

  const derde = await handlers.meldAanbod(meldRequest(APPARAAT_C), { id: '1' });
  assert.equal(derde.body.aantal, 3, 'pas het derde apparaat haalt de grens');
  assert.equal(derde.body.inControle, true);
  assert.equal(client.tables[DAGHAP_TABLE_MELDINGEN].length, 3);
});

test('BE-55: melden kan niet op verlopen of offline aanbod en vraagt een apparaatkenmerk', async () => {
  const verlopen = fakeSupabase({ aanbod: [{ id: 1, verloopt_op: VERLOOPT_GISTEREN }] });
  const uitkomst = await handlersFor(verlopen).meldAanbod(meldRequest(APPARAAT_A), { id: '1' });
  assert.equal(uitkomst.status, 409);
  assert.equal(verlopen.tables[DAGHAP_TABLE_MELDINGEN].length, 0);

  const offline = fakeSupabase({ aanbod: [{ id: 1, status: 'offline' }] });
  assert.equal((await handlersFor(offline).meldAanbod(meldRequest(APPARAAT_A), { id: '1' })).status, 409);

  const online = fakeSupabase({ aanbod: [{ id: 1, status: 'online' }] });
  const handlers = handlersFor(online);
  assert.equal((await handlers.meldAanbod(meldRequest('kort'), { id: '1' })).status, 400);
  assert.equal((await handlers.meldAanbod(meldRequest(APPARAAT_A), { id: '999' })).status, 404);
  assert.equal((await handlers.meldAanbod(null, { id: '1' })).status, 400);

  const alInControle = fakeSupabase({ aanbod: [{ id: 1, status: 'in_controle' }] });
  const alUitkomst = await handlersFor(alInControle).meldAanbod(meldRequest(APPARAAT_A), { id: '1' });
  assert.equal(alUitkomst.status, 200);
  assert.equal(alUitkomst.body.inControle, true);
  assert.equal(alInControle.tables[DAGHAP_TABLE_MELDINGEN].length, 0, 'een melding na controle telt niet meer');

  const zonderMigratie = fakeSupabase({ aanbod: [{ id: 1, status: 'online' }], failing: { [DAGHAP_TABLE_MELDINGEN]: true } });
  assert.equal((await handlersFor(zonderMigratie).meldAanbod(meldRequest(APPARAAT_A), { id: '1' })).status, 503);
});



