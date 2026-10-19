'use strict';

// The generic snapshot routes may not write or approve a versioned v2
// envelope. Behavioural tests with a fictional in-memory database: every
// refusal happens before the insert.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMenuSnapshotReviewHandlers } = require('./menuSnapshotReviewHandlers');
const { validateSnapshotProposalInput, snapshotProposalValidationMessage } = require('./menuSnapshotProposals');
const { MENU_PRODUCT_SCHEMA_VERSION } = require('./menuProductSchemaV2');

const EDITOR = '44444444-4444-4444-8444-444444444444';

const LEGACY_CONTENT = { title: 'Fictief', categories: [{ name: 'Koud', items: [{ name: 'Fictieve soep', desc: null, price: '8.50' }] }] };
const V2_CONTENT = {
  schemaVersion: MENU_PRODUCT_SCHEMA_VERSION,
  menus: [{ id: 'menu-1', title: 'Fictief', sourceId: 'src-1', variant: { id: 'variant-1', label: null, sourceLabel: null, locale: null, location: null, order: null }, categories: [] }],
  rejected: [],
  coverage: { status: 'no_items', sourcesRead: 1, pagesRead: 1, itemsExtracted: 0, unreadSources: [], limitations: [] },
};

function fakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      const rows = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)));
      const builder = {
        select() { return builder; },
        eq(col, val) { filters.push((r) => r[col] === val); return builder; },
        maybeSingle() { calls.push({ select: table }); return Promise.resolve({ data: rows()[0] || null, error: null }); },
        insert(row) {
          calls.push({ insert: table, row });
          const list = (tables[table] = tables[table] || []);
          list.push({ id: list.length + 1, decided_at: '2026-10-19T12:00:00Z', ...row });
          return { select: () => ({ single: () => Promise.resolve({ data: list[list.length - 1], error: null }) }) };
        },
      };
      return builder;
    },
  };
}

function handlerFor(supabase, roles = [{ role: 'editor' }]) {
  return createMenuSnapshotReviewHandlers({
    authenticate: async () => ({ ok: true, userId: EDITOR, roles }),
    getSupabase: () => supabase,
  });
}

const request = (body) => ({ json: async () => body });
const inserts = (supabase) => supabase.calls.filter((c) => c.insert);

test('editor: a v2 snapshot is refused with a concrete reason before the review insert', async () => {
  const supabase = fakeSupabase({ menu_snapshot_proposals: [{ id: '7', captured_content: V2_CONTENT }], menu_snapshot_reviews: [] });
  const res = await handlerFor(supabase).record(request({ decision: 'approved_internal' }), '7');
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'product_v2_read_only');
  assert.deepEqual(res.body.blockedActions, ['save', 'confirm', 'export', 'publish']);
  assert.deepEqual(inserts(supabase), []);
});

test('editor: an unknown or invalid version is refused, never approved as v1', async () => {
  for (const [content, reason] of [
    [{ ...V2_CONTENT, schemaVersion: 'menu-extraction-product/v9' }, 'unsupported_schema_version'],
    [{ ...V2_CONTENT, schemaVersion: 'menu-extraction-output/v1' }, 'unsupported_schema_version'],
    [{ ...V2_CONTENT, coverage: { status: 'complete', sourcesRead: 0, pagesRead: 0, itemsExtracted: 99, unreadSources: [], limitations: ['x'] } }, 'invalid_product_version'],
  ]) {
    const supabase = fakeSupabase({ menu_snapshot_proposals: [{ id: '7', captured_content: content }], menu_snapshot_reviews: [] });
    const res = await handlerFor(supabase).record(request({ decision: 'rejected', reason: 'other' }), '7');
    assert.equal(res.status, 409);
    assert.equal(res.body.reason, reason);
    assert.deepEqual(inserts(supabase), []);
  }
});

test('editor: legacy v1 content still records exactly one review row', async () => {
  const supabase = fakeSupabase({ menu_snapshot_proposals: [{ id: '7', captured_content: LEGACY_CONTENT }], menu_snapshot_reviews: [] });
  const res = await handlerFor(supabase).record(request({ decision: 'approved_internal', note: 'Fictief' }), '7');
  assert.equal(res.status, 201);
  assert.deepEqual(inserts(supabase).map((c) => c.insert), ['menu_snapshot_reviews']);
  assert.equal(inserts(supabase)[0].row.snapshot_id, '7');
  assert.equal(inserts(supabase)[0].row.reviewer_id, EDITOR);
});

test('rights: only editor may write; internal is refused before the database', async () => {
  for (const roles of [[{ role: 'internal' }], [{ role: 'owner', restaurant_id: '1' }], []]) {
    const supabase = fakeSupabase({ menu_snapshot_proposals: [{ id: '7', captured_content: LEGACY_CONTENT }] });
    const res = await handlerFor(supabase, roles).record(request({ decision: 'approved_internal' }), '7');
    assert.equal(res.status, 403);
    assert.deepEqual(supabase.calls, []);
  }
});

test('a missing snapshot is a 404 and an invalid decision a 400 without a database write', async () => {
  const supabase = fakeSupabase({ menu_snapshot_proposals: [] });
  const missing = await handlerFor(supabase).record(request({ decision: 'approved_internal' }), '7');
  assert.equal(missing.status, 404);
  assert.deepEqual(inserts(supabase), []);
  const invalid = await handlerFor(supabase).record(request({ decision: 'published' }), '7');
  assert.equal(invalid.status, 400);
});

test('the generic snapshot proposal validator refuses a versioned or v2-shaped envelope before a hash or insert', () => {
  const base = { restaurantId: '1', menuContext: '1-menukaart', sourceUrl: 'https://fictief.example/menu', sourceType: 'own_website', qualityScore: 'medium' };
  for (const capturedContent of [V2_CONTENT, { menus: [{ categories: [] }] }, { ...LEGACY_CONTENT, schemaVersion: 'anything' }]) {
    const result = validateSnapshotProposalInput({ ...base, capturedContent });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'unsupported-product-schema');
    assert.match(snapshotProposalValidationMessage(result.reason), /versioned product envelope/);
  }
  assert.equal(validateSnapshotProposalInput({ ...base, capturedContent: LEGACY_CONTENT }).valid, true);
});

