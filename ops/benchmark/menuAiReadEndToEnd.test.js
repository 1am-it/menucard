'use strict';

// BB4 of the Delivery Lead review 6384867373 (#59 / BE-21): one end-to-end
// route test WITHOUT any network. A mocked transport layer returns the stored
// answer shape of `aiAnswerRealShape.js` (a copy of a live answer under
// ops/benchmark/output/ai-probe-raw/, fictional values) and the real chain does
// the rest: menuAiReadHandlers -> menuAiImport -> the adapter -> the unchanged
// validator -> buildImportReport -> reviewView -> the concept.
//
// The assertion the Lead asked for: the number of rows "in orde" is greater
// than zero. Before BB1 every row of this exact shape was refused as
// "niet op te slaan", because the required `allergens` object was read as a
// statement about allergens.
//
// This test lives in ops/benchmark on purpose: product code never imports
// ops/benchmark (menuIsolation.test.js), while a benchmark test may read
// product code. No key, no SDK, no provider, no database, no reference change.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createMenuAiReadHandlers } = require('../../src/lib/menuAiReadHandlers');
const { loadMenuExtractionProtocol } = require('../../src/lib/menuExtractionProtocol');
const { buildImportBundle, sourceHashForText } = require('../../src/lib/manualMenuImportBundle');
const { createManualImportStateCipher } = require('../../src/lib/manualMenuImportState');
const { SOURCE_ID, SOURCE_TEXT, realShapeAnswer } = require('./aiAnswerRealShape');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL = loadMenuExtractionProtocol({ root: ROOT });
const SECRET = 'fixture-secret-value-for-tests-only';
// The route only asks whether a key and the flag are present; this value is
// never sent anywhere, because the transport below never leaves the process.
const FIXTURE_KEY = 'fixture-anthropic-key-not-a-secret';

function requestOf(body) {
  return { text: async () => JSON.stringify(body), headers: { get: () => 'Bearer fixture' } };
}

function bundle() {
  return buildImportBundle({
    bundleId: 'BB4-REAL-SHAPE',
    actorUserId: 'user-1',
    restaurantId: '23',
    restaurantName: 'Fictief Brasserie',
    fetchedAt: '2026-10-24T12:00:00.000Z',
    protocol: PROTOCOL,
    now: new Date('2026-10-24T12:00:00.000Z'),
    sources: [
      {
        id: SOURCE_ID,
        url: 'https://fictief-brasserie.invalid/menu',
        kind: 'html',
        status: 'read',
        text: SOURCE_TEXT,
        sha256: sourceHashForText(SOURCE_TEXT),
      },
    ],
  });
}

function sealedState() {
  const cipher = createManualImportStateCipher({ secret: SECRET, now: () => new Date('2026-10-24T12:00:00.000Z') });
  const sealed = cipher.seal({
    userId: 'user-1',
    restaurantId: '23',
    bundle: bundle(),
    report: null,
    decisions: [],
    followUps: {},
    followUpTotal: 0,
  });
  return { cipher, token: sealed.token };
}

/** The mocked transport: returns the stored answer and books one cent. */
function replayTransport(answer, { costEurCents = 1 } = {}) {
  const state = { calls: 0, lastCall: null };
  const create = ({ budget } = {}) => ({
    provider: 'fixture-replay',
    model: 'stored-ai-answer',
    enabled: true,
    get lastCall() {
      return state.lastCall;
    },
    async call() {
      state.calls += 1;
      if (budget && typeof budget === 'object') budget.costEurCents = costEurCents;
      state.lastCall = { ok: true, requestId: 'req_bb4', costEurCents };
      return JSON.parse(JSON.stringify(answer));
    },
  });
  return { state, create };
}


function harness({ answer, costEurCents = 1 } = {}) {
  const sealed = sealedState();
  const transport = replayTransport(answer, { costEurCents });
  const saved = [];
  const handlers = createMenuAiReadHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal', restaurant_id: null }] }),
    env: () => ({ ANTHROPIC_API_KEY: FIXTURE_KEY, MENU_AI_FALLBACK_ENABLED: 'true' }),
    now: () => new Date('2026-10-24T12:05:00.000Z'),
    readUsageRows: async () => ({ ok: true, rows: [] }),
    readSources: async () => [
      {
        id: SOURCE_ID,
        url: 'https://fictief-brasserie.invalid/menu',
        kind: 'html',
        status: 'read',
        text: SOURCE_TEXT,
        hasText: true,
        sha256: sourceHashForText(SOURCE_TEXT),
      },
    ],
    resolveJob: async () => ({ ok: false }),
    loadProtocol: () => PROTOCOL,
    openState: (token) => sealed.cipher.open(token),
    sealState: (state) => sealed.cipher.seal(state),
    saveConcept: async (input) => {
      saved.push(input);
      return { status: 201, body: { concept: { id: 'concept-bb4', version: 1, unchanged: false } } };
    },
    createCall: transport.create,
    generateId: () => 'import-bb4',
  });
  return { handlers, saved, transport, sealed };
}


test('BB4: een nagebootst transport met een echt antwoord levert items "in orde"', async () => {
  const h = harness({ answer: realShapeAnswer() });
  const result = await h.handlers.read(requestOf({ state: h.sealed.token }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(h.transport.state.calls, 1, 'precies één modelaanroep via de nagebootste transportlaag');
  // De kern van BB1/BB4: het echte antwoord levert regels "in orde", niet nul.
  assert.ok(result.body.summary.items > 0);
  assert.ok(result.body.summary.valid > 0, `valid=${result.body.summary.valid}`);
  assert.equal(result.body.summary.items, 6);
  assert.equal(result.body.summary.valid, 4);
  // De review toont dezelfde telling en dezelfde regelstanden als het rapport.
  const rows = result.body.review.rows;
  assert.equal(rows.length, 6);
  assert.equal(rows.filter((row) => row.state === 'valid').length, 4);
  assert.deepEqual(
    rows.filter((row) => row.state !== 'valid').map((row) => [row.name, row.code]),
    [
      ['Fictieve appeltaart', 'allergens'],
      ['Fictieve oesters', 'availability'],
    ],
  );
  // En het concept bewaart de gerechten die in orde zijn.
  assert.equal(h.saved.length, 1);
  const names = h.saved[0].content.categories.flatMap((category) => category.items).map((item) => item.name);
  assert.ok(names.includes('Fictieve olijven'));
  assert.ok(names.includes('Fictief brood'));
  assert.equal(result.body.cost.known, true);
  assert.equal(result.body.cost.eurCents, 1);
  assert.equal(result.body.monthly.spentEurCents, 1);
  // Het bewijs in elke regel blijft een letterlijk citaat uit de bron.
  assert.equal(rows.every((row) => typeof row.quote === 'string' && row.quote.length > 0), true);
  assert.equal(rows.every((row) => row.sourceId === SOURCE_ID), true);
});

test('BB4: een ongeldige uitvoer blijft een weigering zonder concept', async () => {
  const broken = realShapeAnswer();
  broken.menus[0].categories[0].items[0].evidence.quote = 'Deze zin staat niet in de bron';
  const h = harness({ answer: broken });
  const result = await h.handlers.read(requestOf({ state: h.sealed.token }));
  assert.equal(result.status, 422);
  assert.equal(result.body.reason, 'schema_violation');
  assert.equal(h.saved.length, 0);
  // BE-36 (#87, criterion 2): an invalid answer is retried exactly once, and a
  // second refusal still writes nothing.
  assert.equal(h.transport.state.calls, 2);
});
