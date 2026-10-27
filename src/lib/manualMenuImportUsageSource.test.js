'use strict';

// #59 K1/K3 (Lead-bevinding F6) — de leesroute naar duurzame gebruiksgegevens.
//
// Dezelfde functie bedient de interne GET en het ops-exportscript. Deze test
// bewijst dat ze alleen leest (`select`, filter op het JSON-pad, order, limit),
// nooit schrijft, en dat een afgekapte of mislukte leesactie eerlijk meldt.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONCEPT_COLUMNS,
  CONCEPT_TABLE,
  PROVENANCE_KIND_PATH,
  DISCOVERY_KIND,
  DISCOVERY_NOTE_PREFIX,
  readDurableUsageRows,
  readDurableSourceDiscoveryRows,
} = require('./manualMenuImportUsageSource');

function fakeClient({ rows = [], error = null } = {}) {
  const calls = [];
  const builder = {
    select(columns) {
      calls.push(['select', columns]);
      return builder;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return builder;
    },
    order(column, options) {
      calls.push(['order', column, options]);
      return builder;
    },
    limit(value) {
      calls.push(['limit', value]);
      return Promise.resolve({ data: rows, error });
    },
    insert() {
      calls.push(['insert']);
      throw new Error('de gebruiksroute schrijft niet');
    },
    update() {
      calls.push(['update']);
      throw new Error('de gebruiksroute schrijft niet');
    },
    delete() {
      calls.push(['delete']);
      throw new Error('de gebruiksroute schrijft niet');
    },
  };
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      return builder;
    },
  };
}

test('K3/W7: de leesroute leest alleen en filtert op beide AI-herkomsten', async () => {
  const client = fakeClient({ rows: [{ id: 3, created_at: '2026-10-22T21:10:02.873Z', captured_content: {} }] });
  const result = await readDurableUsageRows(client);
  assert.equal(result.ok, true);
  // The manual kind first, then the remaining room for AI reads; both rows are
  // returned and de-duplicated by the document itself.
  assert.equal(result.rows.length, 2);
  assert.equal(result.limit, 5000);
  assert.equal(result.bounded, false);
  assert.deepEqual(client.calls, [
    ['from', CONCEPT_TABLE],
    ['select', CONCEPT_COLUMNS],
    ['eq', PROVENANCE_KIND_PATH, 'handmatige_ai_import'],
    ['order', 'created_at', { ascending: true }],
    ['limit', 5000],
    ['from', CONCEPT_TABLE],
    ['select', CONCEPT_COLUMNS],
    ['eq', PROVENANCE_KIND_PATH, 'ai_gelezen'],
    ['order', 'created_at', { ascending: true }],
    ['limit', 4999],
  ]);
  assert.equal(client.calls.some(([name]) => ['insert', 'update', 'delete'].includes(name)), false);
});

test('K4: een leesactie die de grens raakt is zichtbaar begrensd', async () => {
  const client = fakeClient({ rows: [{ id: 1 }, { id: 2 }] });
  const result = await readDurableUsageRows(client, { limit: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.limit, 2);
  // The manual query already fills the bound, so no room is left for AI reads.
  assert.equal(result.bounded, true);
  assert.deepEqual(client.calls.filter(([name]) => name === 'eq').map(([, , value]) => value), ['handmatige_ai_import']);
  const wider = await readDurableUsageRows(fakeClient({ rows: [{ id: 1 }] }), { limit: 3 });
  assert.equal(wider.bounded, false);
});

test('K4: een leesfout of ontbrekende client is een concrete fout, geen leeg document', async () => {
  const failed = await readDurableUsageRows(fakeClient({ error: { message: 'neer' } }));
  assert.deepEqual(failed, { ok: false, code: 'read_failed' });
  assert.deepEqual(await readDurableUsageRows(null), { ok: false, code: 'no_client' });
  assert.deepEqual(await readDurableUsageRows({}), { ok: false, code: 'no_client' });
});

// BE-32 (#75, criterion 4): the source-discovery AI cost lives in the existing
// BE-24 proposal note and counts in the SAME monthly budget of 1000 cents.
function discoveryClient(rows) {
  const calls = [];
  const builder = {
    select(columns) {
      calls.push(['select', columns]);
      return builder;
    },
    like(column, value) {
      calls.push(['like', column, value]);
      return builder;
    },
    order(column, options) {
      calls.push(['order', column, options]);
      return builder;
    },
    limit(value) {
      calls.push(['limit', value]);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      return builder;
    },
  };
}

test('BE-32: de gemeten AI-kosten van een vindbron-voorstel tellen mee in hetzelfde maandbudget', async () => {
  const { monthlySpendFromRows } = require('./menuAiImport');
  const rows = [
    {
      id: 'proposal-1',
      proposed_at: '2026-10-27T09:00:00.000Z',
      note: 'Herkomst: OpenStreetMap (© OpenStreetMap-bijdragers) · website: https://een.invalid · menulink: https://een.invalid/menukaart · kosten: 4 cent',
    },
    // No measured cost: never counted as zero eurocents of spend.
    { id: 'proposal-2', proposed_at: '2026-10-27T09:10:00.000Z', note: 'Herkomst: AI-zoeken · website: https://twee.invalid' },
    // A remembered "Negeren" is not an AI cost at all.
    { id: 'proposal-3', proposed_at: '2026-10-27T09:20:00.000Z', note: 'Negeren in Nieuw gevonden: Bakkerij — geen restaurant voor ons.' },
  ];
  const client = discoveryClient(rows);
  const read = await readDurableSourceDiscoveryRows(client, { limit: 10 });
  assert.equal(read.ok, true);
  assert.equal(read.rows.length, 1, 'only the proposal with a measured cost becomes a cost row');
  assert.equal(read.rows[0].created_at, '2026-10-27T09:00:00.000Z');
  assert.equal(read.rows[0].captured_content.importProvenance.cost.eurCents, 4);
  assert.equal(read.rows[0].captured_content.importProvenance.kind, DISCOVERY_KIND);
  assert.deepEqual(client.calls.filter(([name]) => name === 'like'), [['like', 'note', `${DISCOVERY_NOTE_PREFIX}%`]]);
  assert.equal(client.calls.some(([name]) => ['insert', 'update', 'delete'].includes(name)), false);

  const spend = monthlySpendFromRows(read.rows, { now: new Date('2026-10-27T12:00:00.000Z') });
  assert.equal(spend.spentEurCents, 4);
  assert.equal(spend.limitEurCents, 1000, 'the existing ceiling of 1000 cents, never a new budget');
  assert.equal(spend.remainingEurCents, 996);

  // A read failure is a concrete error, never an empty (free) month.
  const failed = await readDurableSourceDiscoveryRows({
    from: () => ({
      select: () => ({
        like: () => ({
          order: () => ({ limit: async () => ({ data: null, error: { message: 'neer' } }) }),
        }),
      }),
    }),
  });
  assert.deepEqual(failed, { ok: false, code: 'read_failed' });
  assert.deepEqual(await readDurableSourceDiscoveryRows(null), { ok: false, code: 'no_client' });
});
