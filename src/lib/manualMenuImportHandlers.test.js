'use strict';

// #59 fase 2 — regressies op de serverhandlers van de handmatige AI-import.
//
// Sinds herstelronde 6350337273 (K1) is de stroom toestandsloos: elke stap
// opent een ondertekend toestandstoken en geeft een nieuw token terug. Deze
// tests bewijzen daarom expliciet:
//   - de hele keten over **aparte handler-instanties** heen (serverless-
//     simulatie): elke stap krijgt een nieuwe instantie;
//   - een gewijzigd, verlopen, te groot of vreemd token en een token van een
//     andere gebruiker geven een gewone melding, nooit een doorgang;
//   - een onbekend restaurant wordt geweigerd en de keuze komt uit de
//     bestaande statische lijst;
//   - een ontbrekend servergeheim stopt met een concrete fout.
//
// Fakes voor auth, bronlezing en opslag; geen netwerk, geen database en geen
// provider.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadMenuExtractionProtocol } = require('./menuExtractionProtocol');
const { sourceHashForText } = require('./manualMenuImportBundle');
const {
  validateUsageExport,
  NOT_MEASURED_LABEL,
  NOT_TRACKED_LABEL,
} = require('./manualMenuImportUsage');
const { createManualImportStateCipher } = require('./manualMenuImportState');
const { createManualMenuImportHandlers, searchRestaurantChoices } = require('./manualMenuImportHandlers');

const PROTOCOL = loadMenuExtractionProtocol({ root: path.resolve(__dirname, '..', '..') });
const NOW = new Date('2026-10-22T12:00:00.000Z');
const TEST_SECRET = 'test-service-role-key-0123456789abcdef';

const RESTAURANTS = {
  '1': { name: 'Restaurant Wolfslaar', buurt: 'Wolfslaar' },
  '23': { name: 'Restaurant Voorbeeld', buurt: 'Centrum' },
};

const HTML_TEXT = ['LUNCH', 'Bites', 'Broodplank 8,50', 'Truffelsupplement 3,00'].join('\n');

function request(body) {
  return { json: async () => body };
}

function output() {
  return {
    menus: [
      {
        title: 'Lunch',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Bites',
            items: [
              {
                name: 'Broodplank',
                priceStatus: 'known',
                amountMinorUnits: 850,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'Bites · regel 1', quote: 'Broodplank 8,50' },
              },
              {
                name: 'Truffelsupplement',
                priceStatus: 'known',
                amountMinorUnits: 300,
                currency: 'EUR',
                supplementOf: 'Broodplank',
                evidence: { sourceId: 'source-1', locator: 'Bites · toeslag', quote: 'Truffelsupplement 3,00' },
              },
              {
                name: 'Koffie',
                priceStatus: 'known',
                amountMinorUnits: 280,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'Bites · regel 9', quote: 'Koffie 2,80' },
              },
            ],
          },
        ],
      },
    ],
    coverage: {
      status: 'complete',
      sourcesRead: 1,
      pagesRead: 1,
      itemsExtracted: 3,
      unreadSources: [],
      limitations: [],
    },
  };
}

/**
 * Elke aanroep maakt een nieuwe handlerinstantie. Alleen de cipher en de
 * opgeslagen concepten worden gedeeld, precies zoals de serverless-runtime
 * alleen het geheim en de database deelt.
 */
function harness(overrides = {}) {
  let counter = 0;
  const saved = [];
  const clock = { now: NOW };
  const stateCipher =
    overrides.stateCipher || createManualImportStateCipher({ secret: TEST_SECRET, now: () => clock.now });
  const create = (extra = {}) =>
    createManualMenuImportHandlers({
      authenticate:
        extra.authenticate ||
        overrides.authenticate ||
        (async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal' }] })),
      readSources: async ({ urls }) =>
        urls.map((url, index) => ({
          id: `source-${index + 1}`,
          url,
          kind: 'html',
          status: 'read',
          text: HTML_TEXT,
          sha256: sourceHashForText(HTML_TEXT),
        })),
      loadProtocol: () => PROTOCOL,
      generateId: () => `id-${++counter}`,
      saveConcept: async (input) => {
        saved.push(input);
        return { status: 201, body: { concept: { id: 'concept-1', version: 1, unchanged: false } } };
      },
      stateCipher,
      restaurants: RESTAURANTS,
      // Dezelfde duurzame bron als de GET en het ops-exportscript: de
      // opgeslagen concepten met hun importProvenance.
      readUsageRows:
        extra.readUsageRows ||
        overrides.readUsageRows ||
        (async () => ({
          ok: true,
          rows: saved.map((input, index) => ({
            id: `concept-${index + 1}`,
            created_at: NOW.toISOString(),
            captured_content: input.content,
          })),
          limit: 5000,
          bounded: false,
        })),
      now: () => clock.now,
      ...extra,
    });
  return { next: create, saved, clock, stateCipher };
}

async function createBundle(handlers, body = {}) {
  const result = await handlers.createBundle(
    request({ restaurant_id: '23', urls: ['https://voorbeeld.example/menukaart'], ...body }),
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

async function importAnswer(handlers, step1) {
  const result = await handlers.importAnswer(
    request({
      state: step1.state,
      ai_name: 'Claude',
      answer: `Korte samenvatting.\n\`\`\`json\n${JSON.stringify(output())}\n\`\`\``,
    }),
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

test('K1/K2/K3/K5/K7: de hele keten werkt over aparte handler-instanties', async () => {
  const h = harness();

  // Stap 1 — prompt maken in instantie A.
  const handlerA = h.next();
  const step1 = await createBundle(handlerA);
  assert.ok(typeof step1.state === 'string' && step1.state.length > 0);
  assert.equal(step1.state.includes('Broodplank 8,50'), false, 'de brontekst staat niet leesbaar in het token');
  assert.match(step1.prompt.text, /korte, leesbare samenvatting/i);
  assert.equal(JSON.stringify(step1.bundle).includes('Broodplank 8,50'), false);
  assert.ok(step1.validUntil);

  // Stap 2 — antwoord controleren in een nieuwe instantie (serverless).
  const handlerB = h.next();
  const step2 = await importAnswer(handlerB, step1);
  assert.equal(step2.import.summary.items, 3);
  assert.equal(step2.import.summary.valid, 1);
  assert.equal(step2.import.summary.needsReview, 2);
  assert.equal('validated' in step2.import, false);
  assert.equal('output' in step2.import, false);
  assert.ok(typeof step2.state === 'string' && step2.state !== step1.state);

  // Stap 3 — twee beslissingen, elk in weer een nieuwe instantie.
  const supplement = step2.import.rows.find((row) => row.code === 'supplement_as_main_price');
  const missing = step2.import.rows.find((row) => row.code === 'quote_not_in_source');
  let state = step2.state;
  const handlerC = h.next();
  const afterSupplement = await handlerC.decide(
    request({ state, decision: { rowId: supplement.id, action: 'confirm' } }),
    step2.import.importId,
  );
  assert.equal(afterSupplement.status, 200, JSON.stringify(afterSupplement.body));
  state = afterSupplement.body.state;
  const handlerD = h.next();
  const withoutReason = await handlerD.decide(
    request({ state, decision: { rowId: missing.id, action: 'confirm' } }),
    step2.import.importId,
  );
  assert.equal(withoutReason.status, 422);
  const handlerE = h.next();
  const withReason = await handlerE.decide(
    request({
      state,
      decision: { rowId: missing.id, action: 'confirm', reasonCode: 'scan_onleesbaar', note: 'Op de papieren kaart gezien.' },
    }),
    step2.import.importId,
  );
  assert.equal(withReason.status, 200, JSON.stringify(withReason.body));
  assert.equal(withReason.body.review.canSave, true);
  assert.equal(withReason.body.review.summary.pending, 0);

  // Opslaan in een laatste nieuwe instantie: alleen het token draagt de staat.
  const handlerF = h.next();
  const savedResult = await handlerF.save(request({ state: withReason.body.state }), step2.import.importId);
  assert.equal(savedResult.status, 201, JSON.stringify(savedResult.body));
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].sourceType, 'manual');
  assert.equal(h.saved[0].qualityScore, 'medium');
  assert.equal(h.saved[0].content.importProvenance.aiName, 'Claude');
  assert.equal(
    h.saved[0].content.categories[0].items.some((item) => item.name === 'Truffelsupplement'),
    false,
  );

  // K3: hetzelfde document als het ops-exportscript, uit de opgeslagen
  // concepten — niet uit een teller in het geheugen.
  const usage = await h.next().usage(request({}));
  assert.equal(usage.status, 200);
  assert.deepEqual(validateUsageExport(usage.body.usage), []);
  assert.equal(usage.body.usage.source.kind, 'durable');
  assert.equal(usage.body.usage.source.rowsUsed, 1);
  assert.equal(usage.body.usage.costs.status, 'not_measured');
  assert.equal(usage.body.usage.costs.label, NOT_MEASURED_LABEL);
  assert.equal(usage.body.usage.totals.conceptSaved, 1);
  assert.equal(usage.body.usage.ai[0].aiName, 'Claude');
  assert.equal(usage.body.usage.totals.promptCreated, NOT_TRACKED_LABEL);
  assert.equal(usage.body.usage.totals.importChecked, NOT_TRACKED_LABEL);
  assert.equal(JSON.stringify(usage.body.usage).includes('Broodplank'), false);
});

test('K5: opslaan zonder menselijke stappen wordt geweigerd en schrijft niets', async () => {
  const h = harness();
  const step1 = await createBundle(h.next());
  const step2 = await importAnswer(h.next(), step1);
  const result = await h.next().save(request({ state: step2.state }), step2.import.importId);
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'blocked');
  assert.equal(h.saved.length, 0);
});

test('K1: een gewijzigd token wordt geweigerd, ook tussen twee instanties', async () => {
  const h = harness();
  const step1 = await createBundle(h.next());
  const step2 = await importAnswer(h.next(), step1);
  const parts = step2.state.split('.');
  // Een teken in het midden van de ciphertext wijzigen: aan het eind kunnen
  // ongebruikte base64-bits toevallig dezelfde bytes opleveren.
  const at = 5;
  const swapped = parts[2][at] === 'A' ? 'B' : 'A';
  const flipped = `${parts[0]}.${parts[1]}.${parts[2].slice(0, at)}${swapped}${parts[2].slice(at + 1)}.${parts[3]}`;
  const result = await h.next().decide(
    request({ state: flipped, decision: { rowId: step2.import.rows[0].id, action: 'confirm' } }),
    step2.import.importId,
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'state_invalid');
  assert.match(result.body.error, /geldige import/);
  assert.equal(h.saved.length, 0);
});

test('K1: een verlopen token geeft een gewone melding met dezelfde reden', async () => {
  const h = harness();
  const step1 = await createBundle(h.next());
  h.clock.now = new Date(NOW.getTime() + 31 * 60 * 1000);
  const result = await h.next().importAnswer(
    request({ state: step1.state, ai_name: 'Claude', answer: '```json\n{}\n```' }),
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'state_expired');
  assert.match(result.body.error, /verlopen/);
});


test('K1: een token van een andere gebruiker is niet bruikbaar en niet op te slaan', async () => {
  const h = harness();
  const step1 = await createBundle(h.next());
  const step2 = await importAnswer(h.next(), step1);
  const otherUser = async () => ({ ok: true, userId: 'user-2', roles: [{ role: 'internal' }] });
  const other = h.next({ authenticate: otherUser });
  const decide = await other.decide(
    request({ state: step2.state, decision: { rowId: step2.import.rows[0].id, action: 'drop' } }),
    step2.import.importId,
  );
  assert.equal(decide.status, 409);
  assert.equal(decide.body.reason, 'state_other_user');
  assert.match(decide.body.error, /jouw sessie/);
  const save = await other.save(request({ state: step2.state }), step2.import.importId);
  assert.equal(save.status, 409);
  assert.equal(save.body.reason, 'state_other_user');
  assert.equal(h.saved.length, 0);
});

test('K1: een te groot token wordt geweigerd in plaats van stil afgekapt', async () => {
  const tiny = createManualImportStateCipher({ secret: TEST_SECRET, now: () => NOW, maxTokenChars: 200 });
  const h = harness({ stateCipher: tiny });
  const result = await h.next().createBundle(request({ restaurant_id: '23', urls: ['https://voorbeeld.example/menukaart'] }));
  assert.equal(result.status, 413);
  assert.equal(result.body.reason, 'state_too_large');
  assert.match(result.body.error, /te groot/);
});

test('K1: een ontbrekend servergeheim stopt met een concrete configuratiefout', async () => {
  const missing = createManualImportStateCipher({ secret: undefined });
  const h = harness({ stateCipher: missing });
  const result = await h.next().createBundle(request({ restaurant_id: '23', urls: ['https://voorbeeld.example/menukaart'] }));
  assert.equal(result.status, 500);
  assert.equal(result.body.reason, 'state_config_missing');
  assert.match(result.body.error, /niet geconfigureerd/);
});

test('K1: zonder token is de volgende stap niet mogelijk', async () => {
  const result = await harness().next().importAnswer(request({ ai_name: 'Claude', answer: '```json\n{}\n```' }));
  assert.equal(result.status, 400);
  assert.equal(result.body.reason, 'state_required');
});

test('K3: het restaurant komt uit de bestaande lijst en een onbekend nummer wordt geweigerd', async () => {
  const h = harness();
  const unknown = await h.next().createBundle(request({ restaurant_id: '999', urls: ['https://voorbeeld.example/menukaart'] }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.reason, 'restaurant_unknown');
  const missing = await h.next().createBundle(request({ restaurant_id: '   ', urls: ['https://voorbeeld.example/menukaart'] }));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.reason, 'restaurant_required');
  const step1 = await createBundle(h.next(), { restaurant_id: '1' });
  assert.equal(step1.bundle.restaurantId, '1');
  assert.equal(step1.bundle.restaurantName, 'Restaurant Wolfslaar');
  assert.match(step1.prompt.text, /Restaurant Wolfslaar/);
});

test('K3: zoeken op naam gebruikt de statische lijst, diakritisch ongevoelig en begrensd', async () => {
  const choices = searchRestaurantChoices(RESTAURANTS, 'wolf');
  assert.deepEqual(choices.map((entry) => entry.id), ['1']);
  assert.equal(choices[0].name, 'Restaurant Wolfslaar');
  assert.deepEqual(searchRestaurantChoices(RESTAURANTS, '  '), []);
  assert.deepEqual(searchRestaurantChoices(RESTAURANTS, 'bestaat niet'), []);
  assert.equal(searchRestaurantChoices(RESTAURANTS, 'restaurant', 1).length, 1);
  const many = {};
  for (let index = 0; index < 25; index += 1) many[String(index)] = { name: `Test Café ${index}` };
  assert.equal(searchRestaurantChoices(many, 'cafe').length, 10);
});

test('K3: GET /restaurants geeft alleen interne keuzes en weigert onbekende ids', async () => {
  const h = harness();
  const handler = h.next();
  const search = await handler.listRestaurants({ url: 'https://intern.example/api?q=voor' });
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.restaurants.map((entry) => entry.id), ['23']);
  const short = await handler.listRestaurants({ url: 'https://intern.example/api?q=v' });
  assert.equal(short.status, 200);
  assert.deepEqual(short.body.restaurants, []);
  assert.match(short.body.hint, /twee letters/);
  const exact = await handler.listRestaurants({ url: 'https://intern.example/api?id=1' });
  assert.equal(exact.status, 200);
  assert.equal(exact.body.restaurant.name, 'Restaurant Wolfslaar');
  const unknown = await handler.listRestaurants({ url: 'https://intern.example/api?id=999' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.reason, 'restaurant_unknown');
  const forbidden = await h
    .next({ authenticate: async () => ({ ok: true, userId: 'user-9', roles: [{ role: 'owner', restaurant_id: '23' }] }) })
    .listRestaurants({ url: 'https://intern.example/api?q=voor' });
  assert.equal(forbidden.status, 403);
});


test('K1/K6: een stap van een andere import (URL-id) wordt geweigerd', async () => {
  const h = harness();
  const step1 = await createBundle(h.next());
  const step2 = await importAnswer(h.next(), step1);
  const result = await h.next().decide(
    request({ state: step2.state, decision: { rowId: step2.import.rows[0].id, action: 'drop' } }),
    'andere-import',
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'state_mismatch');
});

test('K3: een gewijzigde bundelhash in het verzoek blijft een blokkade', async () => {
  const h = harness();
  const step1 = await createBundle(h.next());
  const result = await h.next().importAnswer(
    request({ state: step1.state, bundle_hash: 'e'.repeat(64), ai_name: 'Claude', answer: '```json\n{}\n```' }),
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'bundle_hash_mismatch');
});

test('rolregel: een niet-interne gebruiker krijgt 403 en er wordt niets opgeslagen', async () => {
  const h = harness({
    authenticate: async () => ({ ok: true, userId: 'user-3', roles: [{ role: 'owner', restaurant_id: '23' }] }),
  });
  const result = await h.next().createBundle(request({ restaurant_id: '23', urls: ['https://voorbeeld.example/menu'] }));
  assert.equal(result.status, 403);
  assert.equal(h.saved.length, 0);
});

test('K6: de vervolgprompt gaat over één regel en het antwoord vervangt alleen die regel', async () => {
  const h = harness();
  const step1 = await createBundle(h.next());
  const step2 = await importAnswer(h.next(), step1);
  const row = step2.import.rows.find((entry) => entry.code === 'quote_not_in_source');
  const promptResult = await h.next().followUp(request({ state: step2.state, row_id: row.id }), step2.import.importId);
  assert.equal(promptResult.status, 200);
  assert.match(promptResult.body.prompt.text, /Vervolgvraag over één regel/);
  assert.match(promptResult.body.prompt.text, /Broodplank 8,50/);

  const oneRow = {
    menus: [
      {
        title: 'Lunch',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Bites',
            items: [
              {
                name: 'Koffie',
                priceStatus: 'on_request',
                evidence: { sourceId: 'source-1', locator: 'Bites · regel 1', quote: 'Broodplank 8,50' },
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  };
  const answered = await h.next().followUp(
    request({ state: step2.state, row_id: row.id, answer: `Kort.\n\`\`\`json\n${JSON.stringify(oneRow)}\n\`\`\`` }),
    step2.import.importId,
  );
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  const after = answered.body.import.rows.find((entry) => entry.id === row.id);
  assert.equal(after.state, 'valid');
  const repeated = await h
    .next()
    .followUp(request({ state: answered.body.state, row_id: row.id }), step2.import.importId);
  assert.equal(repeated.status, 422);
  assert.equal(repeated.body.reason, 'follow_up_used');
});

test('K6: een vervolgantwoord dat andere regels raakt wordt geweigerd', async () => {
  const h = harness();
  const step1 = await createBundle(h.next());
  const step2 = await importAnswer(h.next(), step1);
  const row = step2.import.rows.find((entry) => entry.code === 'quote_not_in_source');
  const result = await h.next().followUp(
    request({ state: step2.state, row_id: row.id, answer: `\`\`\`json\n${JSON.stringify(output())}\n\`\`\`` }),
    step2.import.importId,
  );
  assert.equal(result.status, 422);
  assert.equal(result.body.reason, 'follow_up_out_of_scope');
});

test('K1: prompts en gecontroleerde imports zonder opslag tellen niet mee', async () => {
  // De oude teller gaf hier promptCreated 1 en importChecked 1. Die waarden
  // werden nergens duurzaam bewaard en zijn dus geen waarheid (F6).
  const h = harness();
  const step1 = await createBundle(h.next());
  await importAnswer(h.next(), step1);
  const usage = await h.next().usage(request({}));
  assert.equal(usage.status, 200);
  assert.equal(usage.body.usage.totals.conceptSaved, 0);
  assert.equal(usage.body.usage.totals.promptCreated, NOT_TRACKED_LABEL);
  assert.equal(usage.body.usage.totals.importChecked, NOT_TRACKED_LABEL);
  assert.deepEqual(usage.body.usage.ai, []);
  assert.deepEqual(validateUsageExport(usage.body.usage), []);
});

test('K3: zonder duurzame leesroute stopt de export met een concrete fout', async () => {
  const withoutSource = createManualMenuImportHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal' }] }),
    now: () => NOW,
  });
  const result = await withoutSource.usage(request({}));
  assert.equal(result.status, 500);
  assert.equal(result.body.reason, 'usage_source_missing');
  assert.equal(result.body.usage, undefined);
});

test('K3: een leesfout geeft 503 en nooit een leeg of verzonnen document', async () => {
  const failed = harness({ readUsageRows: async () => ({ ok: false, code: 'read_failed' }) });
  const result = await failed.next().usage(request({}));
  assert.equal(result.status, 503);
  assert.equal(result.body.reason, 'usage_source_unavailable');
  assert.equal(result.body.usage, undefined);

  const throwing = harness({
    readUsageRows: async () => {
      throw new Error('database onbereikbaar');
    },
  });
  const thrown = await throwing.next().usage(request({}));
  assert.equal(thrown.status, 503);
  assert.equal(thrown.body.usage, undefined);
});

