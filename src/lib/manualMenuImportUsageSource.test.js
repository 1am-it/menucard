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
  readDurableUsageRows,
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
