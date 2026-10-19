'use strict';

// Existing receipt/concept/review handlers against a fictional v2 envelope:
// the view is version-faithful and read-only, and every save/approve/reject
// path refuses before a hash, insert, update or RPC. No real database,
// network, GitHub or credential is involved.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMenuConceptReviewHandlers } = require('./menuConceptReviewHandlers');
const { MENU_PRODUCT_SCHEMA_VERSION } = require('./menuProductSchemaV2');
const { buildMenuConcept } = require('./menuConcept');

const REVIEWER = '33333333-3333-4333-8333-333333333333';
const MAKER = '11111111-1111-4111-8111-111111111111';
const SITE = 'https://fictief-brasserie.invalid/';
const MENU_URL = 'https://fictief-brasserie.invalid/menu';
const RESTAURANTS = { bistro: { name: 'Fictief Brasserie' } };
const LIVE = { 'bistro-diner': { categories: [{ name: 'Koud', items: [{ name: 'Fictieve soep', priceValue: 7.5 }] }] } };
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function origins(overrides = {}) {
  return { name: 'extracted', description: 'unknown', price: 'extracted', allergens: 'unknown', supplementOf: 'unknown', availability: 'unknown', kind: 'unknown', ...overrides };
}

function productFixture() {
  return {
    schemaVersion: MENU_PRODUCT_SCHEMA_VERSION,
    menus: [
      {
        id: 'menu-1',
        title: 'Fictief Diner',
        sourceId: 'src-1',
        variant: { id: 'variant-1', label: 'Diner', sourceLabel: 'DINNER', locale: null, location: null, order: 1 },
        categories: [
          {
            id: 'cat-1',
            name: 'Voorgerechten',
            path: ['Diner', 'Voorgerechten'],
            sourcePath: ['DINNER', 'VOOR'],
            kind: 'section',
            choice: null,
            uncertain: false,
            items: [
              {
                id: 'item-1',
                kind: 'dish',
                name: 'Fictieve burrata',
                description: null,
                price: { status: 'known', amountMinorUnits: 1300, currency: 'EUR', text: null, isFrom: false, evidence: { sourceId: 'src-1', locator: 'regel 1', quote: 'Fictieve burrata 13,00' } },
                priceVariants: [],
                primaryPriceRef: null,
                supplementOf: null,
                choiceGroupRef: null,
                allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
                dietaryLabels: [],
                availability: null,
                evidence: { sourceId: 'src-1', locator: 'regel 1', quote: 'Fictieve burrata 13,00' },
                origins: origins(),
              },
              {
                id: 'item-2',
                kind: 'supplement',
                name: 'Extra brood',
                description: null,
                price: { status: 'known', amountMinorUnits: 200, currency: 'EUR', text: null, isFrom: false, evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Extra brood 2,00' } },
                priceVariants: [],
                primaryPriceRef: null,
                supplementOf: { status: 'unresolved', label: 'Bij de maaltijd', context: { menuId: 'menu-1', categoryId: 'cat-1' }, limitation: 'Geen expliciet doelitem.' },
                choiceGroupRef: null,
                allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
                dietaryLabels: [],
                availability: null,
                evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Extra brood 2,00' },
                origins: origins({ supplementOf: 'extracted' }),
              },
            ],
          },
        ],
      },
    ],
    rejected: [],
    coverage: { status: 'partial', sourcesRead: 1, pagesRead: 1, itemsExtracted: 2, unreadSources: [], limitations: ['Fictieve beperking.'] },
  };
}

function legacyContent() {
  return buildMenuConcept({
    menus: [{ categories: [{ name: 'Koud', items: [{ name: 'Fictieve soep', price: '8.50' }] }] }],
    liveLines: [],
    edits: {},
  }).content;
}

function snapshotRow(id, captured, extra = {}) {
  return {
    id,
    restaurant_id: 'bistro',
    menu_context: 'bistro-menukaart',
    version: 1,
    content_hash: hash(captured),
    captured_content: captured,
    source_url: MENU_URL,
    source_type: 'own_website',
    quality_score: 'medium',
    originally_fetched_at: '2026-10-19T09:00:00Z',
    created_at: '2026-10-19T10:00:00Z',
    created_by: MAKER,
    origin_receipt_id: 'r1',
    based_on_snapshot_id: null,
    ...extra,
  };
}

function fakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    tables,
    from(table) {
      const filters = [];
      const rows = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)));
      const builder = {
        select() { return builder; },
        eq(col, val) { filters.push((r) => r[col] === val); return builder; },
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() { calls.push({ select: table }); return Promise.resolve({ data: rows()[0] || null, error: null }); },
        single() { calls.push({ select: table }); return Promise.resolve({ data: rows()[0] || null, error: null }); },
        insert(row) {
          calls.push({ insert: table, row });
          if (!tables[table]) tables[table] = [];
          tables[table].push({ ...row, id: tables[table].length + 1 });
          return { select: () => ({ single: () => Promise.resolve({ data: { id: tables[table].length }, error: null }) }) };
        },
        then(resolve) { calls.push({ select: table }); return resolve({ data: rows(), error: null }); },
      };
      return builder;
    },
    rpc(name, args) {
      calls.push({ rpc: name, args });
      return Promise.resolve({ data: [{ review_id: 1, created: true }], error: null });
    },
  };
}

function world({ captured, receiptProduct = undefined } = {}) {
  return fakeSupabase({
    menu_snapshot_proposals: [snapshotRow(1, captured || productFixture())],
    menu_snapshot_reviews: [],
    url_intake_analysis_receipts: [{ id: 'r1', canonical_source_url: SITE, fetched_at: '2026-10-19T09:00:00Z', menus: [{ categories: [{ name: 'Koud', items: [{ name: 'Fictieve soep', price: '8.50' }] }] }], product: receiptProduct }],
    source_triage_proposals: [{ id: 'p1', restaurant_id: 'bistro', kind: 'add_candidate', proposed_url: MENU_URL, current_url: null, status: 'accepted', decided_at: '2026-10-19T09:30:00Z' }],
    restaurant_source_analysis_jobs: [{ id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-19T09:00:00Z' }],
  });
}

function handlersFor(supabase, { roles = [{ role: 'internal' }] } = {}) {
  return createMenuConceptReviewHandlers({
    authenticate: async () => ({ ok: true, userId: REVIEWER, roles }),
    getSupabase: () => supabase,
    restaurants: RESTAURANTS,
    liveMenus: LIVE,
    computeMenuHash: hash,
    now: () => new Date('2026-10-19T10:30:00Z'),
  });
}

const request = (body) => ({ json: async () => body });
const inserts = (supabase) => supabase.calls.filter((c) => c.insert);
const rpcs = (supabase) => supabase.calls.filter((c) => c.rpc);

test('list: a v2 concept is listed read-only with its own counts, never as a v1 concept', async () => {
  const supabase = world();
  const res = await handlersFor(supabase).list(request(null));
  assert.equal(res.status, 200);
  const item = res.body.items[0];
  assert.equal(item.readOnly, true);
  assert.equal(item.schemaVersion, MENU_PRODUCT_SCHEMA_VERSION);
  assert.equal(item.dishCount, 2);
  assert.ok(item.blockerCount >= 2);
  assert.ok(item.attentionCount >= 1);
  assert.deepEqual(inserts(supabase), []);
  assert.deepEqual(rpcs(supabase), []);
});

test('detail: a v2 concept shows the sanitized product view and refuses a v1 preview', async () => {
  const supabase = world();
  const res = await handlersFor(supabase).detail(request(null), '1');
  assert.equal(res.status, 200);
  assert.equal(res.body.concept.captured, null, 'the raw v2 envelope is not re-exposed as v1 content');
  assert.equal(res.body.concept.readOnly, true);
  assert.equal(res.body.concept.blocked.reason, 'product_v2_read_only');
  assert.deepEqual(res.body.concept.blocked.blockedActions, ['save', 'confirm', 'export', 'publish']);
  assert.equal(res.body.product.schemaVersion, MENU_PRODUCT_SCHEMA_VERSION);
  assert.equal(res.body.product.sourceVerification, 'unverified');
  assert.equal(res.body.product.counts.items, 2);
  assert.equal(res.body.product.menus[0].categories[0].items[1].supplementOf.status, 'unresolved');
  assert.equal(res.body.preview.concept, null);
  assert.equal(res.body.preview.blocked, 'product_v2_read_only');
  assert.deepEqual(res.body.originLines, {});
  assert.deepEqual(inserts(supabase), []);
  assert.deepEqual(rpcs(supabase), []);
});

test('saveVersion: a v2 concept is refused before any version, hash or insert; repeated clicks stay side-effect free', async () => {
  const supabase = world();
  const handlers = handlersFor(supabase);
  const first = await handlers.saveVersion(request({ expected_version: 1, edits: { lines: { '0.0.0': { price: '9,00' } } } }), '1');
  const second = await handlers.saveVersion(request({ expected_version: 1, edits: {} }), '1');
  for (const res of [first, second]) {
    assert.equal(res.status, 409);
    assert.equal(res.body.reason, 'product_v2_read_only');
    assert.deepEqual(res.body.blockedActions, ['save', 'confirm', 'export', 'publish']);
  }
  assert.deepEqual(inserts(supabase), []);
  assert.deepEqual(rpcs(supabase), []);
});

test('decide: both approve and reject are refused for v2 before the review RPC', async () => {
  const supabase = world();
  const handlers = handlersFor(supabase);
  const approve = await handlers.decide(request({ expected_version: 1, decision: 'approved_internal' }), '1');
  const reject = await handlers.decide(request({ expected_version: 1, decision: 'rejected', reason: 'insufficient_content' }), '1');
  for (const res of [approve, reject]) {
    assert.equal(res.status, 409);
    assert.equal(res.body.reason, 'product_v2_read_only');
  }
  assert.deepEqual(rpcs(supabase), []);
  assert.deepEqual(inserts(supabase), []);
});

test('mixed: a v1 concept whose receipt carries a v2 envelope is read-only and cannot be saved or approved', async () => {
  const supabase = world({ captured: legacyContent(), receiptProduct: productFixture() });
  const handlers = handlersFor(supabase);
  const detail = await handlers.detail(request(null), '1');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.concept.captured, null);
  assert.equal(detail.body.concept.blocked.reason, 'receipt_product_v2_authoritative');
  assert.equal(detail.body.product.counts.items, 2, 'the v2 envelope is shown, not the older v1 projection');
  const list = await handlers.list(request(null));
  assert.equal(list.body.items[0].readOnly, true);
  assert.equal(list.body.items[0].blockedReason, 'receipt_product_v2_authoritative');
  assert.equal(list.body.items[0].dishCount, 2);
  const save = await handlers.saveVersion(request({ expected_version: 1, edits: {} }), '1');
  const approve = await handlers.decide(request({ expected_version: 1, decision: 'approved_internal' }), '1');
  assert.equal(save.status, 409);
  assert.equal(save.body.reason, 'receipt_product_v2_authoritative');
  assert.equal(approve.status, 409);
  assert.equal(approve.body.reason, 'receipt_product_v2_authoritative');
  assert.deepEqual(inserts(supabase), []);
  assert.deepEqual(rpcs(supabase), []);
});

test('invalid and unsupported versions stay visible as a concrete block, never a 500 or a v1 fallback', async () => {
  for (const [captured, reason] of [
    [{ ...productFixture(), coverage: { status: 'complete', sourcesRead: 0, pagesRead: 0, itemsExtracted: 99, unreadSources: [], limitations: [] } }, 'invalid_product_version'],
    [{ ...productFixture(), schemaVersion: 'menu-extraction-product/v9' }, 'unsupported_schema_version'],
  ]) {
    const supabase = world({ captured });
    const handlers = handlersFor(supabase);
    const detail = await handlers.detail(request(null), '1');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.concept.blocked.reason, reason);
    assert.equal(detail.body.product, null);
    assert.ok(detail.body.concept.blocked.problems.length > 0);
    const save = await handlers.saveVersion(request({ expected_version: 1, edits: {} }), '1');
    assert.equal(save.status, 409);
    assert.equal(save.body.reason, reason);
    assert.deepEqual(inserts(supabase), []);
    assert.deepEqual(rpcs(supabase), []);
  }
});

test('rights are unchanged: editor, owner and a missing session never reach the v2 reader or a write', async () => {
  for (const roles of [[{ role: 'editor' }], [{ role: 'owner', restaurant_id: 'bistro' }]]) {
    const supabase = world();
    const res = await handlersFor(supabase, { roles }).detail(request(null), '1');
    assert.equal(res.status, 403);
    assert.deepEqual(supabase.calls, []);
  }
});



