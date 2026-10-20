'use strict';

// BE-27 export against fictional v2 envelopes: an unsupported/versioned row is
// refused before the export claim, branch, commit, pull request or any GitHub
// request. Fictional in-memory clients only.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMenuConceptExportHandler, exportMenuEntry } = require('./menuConceptExport');
const { MENU_PRODUCT_SCHEMA_VERSION } = require('./menuProductSchemaV2');
const { buildMenuConcept } = require('./menuConcept');

const REVIEWER = '33333333-3333-4333-8333-333333333333';
const MENU_URL = 'https://bistro-fictief.example/menukaart';
const SITE = 'https://www.bistro-fictief.example/';
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const LIVE = { '1-diner': { subtitle: 'Dinerkaart', categories: [{ name: 'Hoofd', items: [{ name: 'Fictieve soep', price: '€7,50', priceValue: 7.5 }] }] } };
const RESTAURANTS = { 1: { name: 'Bistro Fictief' } };

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
            name: 'Hoofd',
            path: ['Diner', 'Hoofd'],
            sourcePath: ['DINNER', 'HOOFD'],
            kind: 'section',
            choice: null,
            uncertain: false,
            items: [
              {
                id: 'item-1',
                kind: 'dish',
                name: 'Fictieve soep',
                description: null,
                price: { status: 'known', amountMinorUnits: 750, currency: 'EUR', text: null, isFrom: false, evidence: { sourceId: 'src-1', locator: 'regel 1', quote: 'Fictieve soep 7,50' } },
                priceVariants: [],
                primaryPriceRef: null,
                supplementOf: null,
                choiceGroupRef: null,
                allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
                dietaryLabels: [],
                availability: null,
                evidence: { sourceId: 'src-1', locator: 'regel 1', quote: 'Fictieve soep 7,50' },
                origins: origins(),
              },
            ],
          },
        ],
      },
    ],
    rejected: [],
    coverage: { status: 'partial', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: ['Fictieve beperking.'] },
  };
}

function legacyContent() {
  return buildMenuConcept({ menus: [{ categories: [{ name: 'Hoofd', items: [{ name: 'Fictieve soep', price: '7.50' }] }] }], liveLines: [], edits: {} }).content;
}

function snapshotRow(captured) {
  return { id: 5, restaurant_id: '1', menu_context: '1-menukaart', version: 1, content_hash: hash(captured), captured_content: captured, source_url: MENU_URL, source_type: 'own_website', quality_score: 'medium', originally_fetched_at: '2026-10-19T09:00:00Z', created_at: '2026-10-19T10:00:00Z', created_by: REVIEWER, origin_receipt_id: 'r1', based_on_snapshot_id: null };
}

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
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
        insert(row) { calls.push({ insert: table, row }); return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 1, ...row }, error: null }) }) }; },
        update() { calls.push({ update: table }); return builder; },
        then(resolve) { return resolve({ data: rows(), error: null }); },
      };
      return builder;
    },
  };
}

function fakeGithub() {
  const calls = [];
  const step = (name) => calls.push(name);
  return {
    calls,
    async baseSha() { step('baseSha'); return 'a'.repeat(40); },
    async readFile(path) { step(`read:${path}`); return '{}'; },
    async commitToNewBranch() { step('commit'); return { commitSha: 'c'.repeat(40) }; },
    async openPullRequest() { step('pull'); return { number: 1, url: 'https://github.invalid/1' }; },
    async getPullRequest() { step('getPull'); return { state: 'open', merged: false }; },
  };
}

function world({ captured, receiptProduct = null }) {
  return fakeSupabase({
    menu_snapshot_proposals: [snapshotRow(captured)],
    menu_snapshot_reviews: [{ id: 1, snapshot_id: 5, reviewer_id: REVIEWER, decision: 'approved_internal', reason: null, decided_at: '2026-10-19T10:10:00Z' }],
    url_intake_analysis_receipts: [{ id: 'r1', canonical_source_url: SITE, menus: [{ categories: [] }], product: receiptProduct }],
    source_triage_proposals: [{ id: 'p1', restaurant_id: '1', kind: 'add_candidate', proposed_url: MENU_URL, current_url: null, status: 'accepted', decided_at: '2026-10-19T09:30:00Z' }],
    restaurant_source_analysis_jobs: [{ id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-19T09:00:00Z' }],
    menu_snapshot_exports: [],
  });
}

function handlerFor(supabase, github) {
  return createMenuConceptExportHandler({
    authenticate: async () => ({ ok: true, userId: REVIEWER, roles: [{ role: 'internal' }] }),
    getSupabase: () => supabase,
    restaurants: RESTAURANTS,
    liveMenus: LIVE,
    computeMenuHash: hash,
    github,
    sourceStatus: async () => ({ confirmed: true, blocked: null }),
    now: () => new Date('2026-10-19T11:00:00Z'),
  });
}

const request = (body) => ({ json: async () => body });
const effects = (supabase) => supabase.calls.filter((c) => c.insert || c.update);

test('a v2 concept is refused before the export claim, branch, commit, pull request or GitHub call', async () => {
  const supabase = world({ captured: productFixture() });
  const github = fakeGithub();
  const res = await handlerFor(supabase, github).exportToReviewPr(request({ expected_version: 1 }), '5');
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'product_v2_read_only');
  assert.deepEqual(res.body.blockedActions, ['save', 'confirm', 'export', 'publish']);
  assert.deepEqual(effects(supabase), []);
  assert.deepEqual(github.calls, []);
});

test('a v1 concept whose receipt carries a v2 envelope is refused before any export effect', async () => {
  const supabase = world({ captured: legacyContent(), receiptProduct: productFixture() });
  const github = fakeGithub();
  const res = await handlerFor(supabase, github).exportToReviewPr(request({ expected_version: 1 }), '5');
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'receipt_product_v2_authoritative');
  assert.deepEqual(effects(supabase), []);
  assert.deepEqual(github.calls, []);
});

test('exportMenuEntry returns no entry and no concept for a v2 snapshot', () => {
  const result = exportMenuEntry({ snapshot: snapshotRow(productFixture()), menus: LIVE });
  assert.equal(result.entry, null);
  assert.equal(result.concept, null);
  assert.equal(result.blocked.kind, 'v2');
});

test('an invalid v2 row is also refused before any side effect', async () => {
  const supabase = world({ captured: { ...productFixture(), coverage: { status: 'complete', sourcesRead: 0, pagesRead: 0, itemsExtracted: 99, unreadSources: [], limitations: [] } } });
  const github = fakeGithub();
  const res = await handlerFor(supabase, github).exportToReviewPr(request({ expected_version: 1 }), '5');
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'invalid_product_version');
  assert.deepEqual(effects(supabase), []);
  assert.deepEqual(github.calls, []);
});

// P2 regression (review 6283658271): an unversioned v2-shaped concept row is
// not v1 content, so export refuses it with a concrete reason instead of a
// parser exception or a claim.
test('an unversioned v2-shaped concept is refused before the export claim, branch or pull request', async () => {
  for (const captured of [
    { menus: [{ categories: [] }] },
    { menus: [], categories: 'geen lijst' },
  ]) {
    const supabase = world({ captured });
    const github = fakeGithub();
    const res = await handlerFor(supabase, github).exportToReviewPr(request({ expected_version: 1 }), '5');
    assert.equal(res.status, 409);
    assert.equal(res.body.reason, 'unsupported_schema_version');
    assert.equal(res.body.schemaVersion, null);
    assert.deepEqual(effects(supabase), []);
    assert.deepEqual(github.calls, []);
    const entry = exportMenuEntry({ snapshot: snapshotRow(captured), menus: LIVE });
    assert.equal(entry.entry, null);
    assert.equal(entry.concept, null);
    assert.equal(entry.blocked.reason, 'unsupported_schema_version');
  }
});

