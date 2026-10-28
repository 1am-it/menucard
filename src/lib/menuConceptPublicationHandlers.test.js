'use strict';

// BE-39 "Klaar voor publicatie" on the server — the list route derives exactly
// one publication badge for every internally approved card, shows a stored
// export with its real status, never treats an export as proof, and keeps the
// source verdict identical to the detail route. Behavioural tests with an
// injected fake Supabase client; fictional data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMenuConceptReviewHandlers, deriveSourceStatus } = require('./menuConceptReviewHandlers');
const { buildMenuConcept } = require('./menuConcept');

const REVIEWER = '33333333-3333-4333-8333-333333333333';
const MAKER = '11111111-1111-4111-8111-111111111111';
const SITE = 'https://www.bistro-fictief.example/';
const MENU_URL = 'https://bistro-fictief.example/menukaart';
const RESTAURANTS = { bistro: { name: 'Bistro Fictief' } };
const LIVE = { 'bistro-diner': { categories: [{ name: 'Koud', items: [{ name: 'Fictieve soep', priceValue: 7.5 }, { name: 'Fictieve mousse', priceValue: 8 }] }] } };
const RECEIPT_MENUS = [
  {
    categories: [
      { name: 'Koud', items: [{ name: 'Fictieve soep', price: '8.50' }, { name: 'Fictieve salade', price: '12.50' }, { name: 'Fictief tartaar', price: null }] },
      { name: 'Overig', items: [{ name: 'Fictieve salade', price: '13.00' }, { name: 'Fictief kaasplankje', price: '11.00' }] },
    ],
  },
];
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** The concept as BE-25 "Concept opslaan" stores it: with or without blockers. */
function content({ resolved = true } = {}) {
  if (!resolved) return buildMenuConcept({ menus: RECEIPT_MENUS, liveLines: [], edits: {} }).content;
  const edits = { lines: { '0.0.2': { price: '15,50' }, '0.1.0': { exclude: true }, '0.1.1': { category: 'Kaas' } }, removed: 'remove' };
  const live = [{ name: 'Fictieve soep', price: '7.50', category: 'Koud' }, { name: 'Fictieve mousse', price: '8.00', category: 'Koud' }];
  return buildMenuConcept({ menus: RECEIPT_MENUS, liveLines: live, edits }).content;
}

function snapshotRow(id, version, captured, extra = {}) {
  return {
    id,
    restaurant_id: 'bistro',
    menu_context: 'bistro-menukaart',
    version,
    content_hash: hash(captured),
    captured_content: captured,
    source_url: MENU_URL,
    source_type: 'own_website',
    quality_score: 'medium',
    originally_fetched_at: '2026-10-12T09:00:00Z',
    created_at: `2026-10-12T1${version}:00:00Z`,
    created_by: MAKER,
    origin_receipt_id: 'r1',
    based_on_snapshot_id: null,
    ...extra,
  };
}

const approved = (id) => ({ id, snapshot_id: id, reviewer_id: REVIEWER, decision: 'approved_internal', reason: null, note: null, decided_at: '2026-10-13T09:00:00Z' });


/**
 * A fake client that records every query with its table, columns and filters,
 * so "one query for all exports, none per card" and "no GitHub call" are
 * observable instead of assumed.
 */
function fakeSupabase(tables) {
  const queries = [];
  const matches = (table, filters) =>
    (tables[table] || []).filter((r) => filters.every((f) => (f.op === 'eq' ? r[f.col] === f.val : f.vals.includes(r[f.col]))));
  return {
    queries,
    tables,
    from(table) {
      const record = { table, columns: null, filters: [] };
      const filters = record.filters;
      const builder = {
        select(columns) {
          record.columns = columns;
          return builder;
        },
        eq(col, val) {
          filters.push({ op: 'eq', col, val });
          return builder;
        },
        in(col, vals) {
          filters.push({ op: 'in', col, vals });
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          queries.push(record);
          return Promise.resolve({ data: matches(table, filters)[0] || null, error: null });
        },
        then(resolve) {
          queries.push(record);
          return resolve({ data: matches(table, filters), error: null });
        },
      };
      return builder;
    },
    rpc() {
      return Promise.resolve({ data: null, error: { code: 'XX000' } });
    },
  };
}

function world({ snapshots, reviews = [], proposals, jobs, exports = [] } = {}) {
  return fakeSupabase({
    menu_snapshot_proposals: snapshots || [snapshotRow(1, 1, content())],
    menu_snapshot_reviews: reviews,
    url_intake_analysis_receipts: [{ id: 'r1', canonical_source_url: SITE, fetched_at: '2026-10-12T09:00:00Z', menus: RECEIPT_MENUS }],
    source_triage_proposals: proposals || [{ id: 'p1', restaurant_id: 'bistro', kind: 'add_candidate', proposed_url: MENU_URL, current_url: null, status: 'accepted', decided_at: '2026-10-12T09:30:00Z' }],
    restaurant_source_analysis_jobs: jobs || [{ id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-12T09:00:00Z' }],
    menu_snapshot_exports: exports,
  });
}

function exportRow(snapshotId, status, extra = {}) {
  return {
    id: 7,
    snapshot_id: snapshotId,
    restaurant_id: 'bistro',
    content_hash: 'fictief',
    export_hash: null,
    status,
    branch: 'menu/fictief',
    commit_sha: 'abcdef1',
    pr_number: 9,
    pr_url: 'https://github.invalid/9',
    error_reason: null,
    created_by: MAKER,
    created_at: '2026-10-13T09:30:00Z',
    updated_at: '2026-10-13T09:30:00Z',
    ...extra,
  };
}

function githubSpy(state = 'opened') {
  const calls = [];
  return { calls, async pullRequestState(prNumber) { calls.push(prNumber); return state; } };
}

function handlersFor(supabase, { github = null } = {}) {
  return createMenuConceptReviewHandlers({
    authenticate: async () => ({ ok: true, userId: REVIEWER, roles: [{ role: 'internal' }] }),
    getSupabase: () => supabase,
    restaurants: RESTAURANTS,
    liveMenus: LIVE,
    computeMenuHash: hash,
    github,
    now: () => new Date('2026-10-13T10:00:00Z'),
  });
}

const request = (body) => ({ json: async () => body });
const queriesFor = (supabase, table) => supabase.queries.filter((query) => query.table === table);

test('list: an internally approved card with every gate green gets exactly one "Klaar voor publicatie"', async () => {
  const supabase = world({ reviews: [approved(1)] });
  const res = await handlersFor(supabase, { github: githubSpy() }).list(request());
  assert.equal(res.status, 200);
  const item = res.body.items[0];
  assert.equal(item.status, 'approved');
  assert.equal(item.publication.state, 'ready');
  assert.equal(item.publication.label, 'Klaar voor publicatie');
  assert.deepEqual(item.publication.reasons, []);
  assert.equal(item.publication.canExport, true);
  assert.equal(item.publication.exportStatus, null);
  // The list only reads: no write, no RPC, no GitHub call.
  assert.equal(supabase.queries.filter((q) => q.table === 'menu_snapshot_exports').length, 1);
  assert.ok(!supabase.queries.some((q) => q.table === 'menu_snapshot_exports' && !q.filters.some((f) => f.op === 'in' && f.col === 'snapshot_id')));
});

test('list: waiting and rejected cards keep their current presentation, without a second badge', async () => {
  const supabase = world({
    snapshots: [
      snapshotRow(1, 1, content(), { restaurant_id: 'bistro', menu_context: 'bistro-menukaart' }),
      snapshotRow(2, 1, content(), { restaurant_id: 'ander', menu_context: 'ander-menukaart' }),
    ],
    reviews: [{ id: 2, snapshot_id: 2, reviewer_id: REVIEWER, decision: 'rejected', reason: 'other', note: null, decided_at: '2026-10-13T09:00:00Z' }],
  });
  const res = await handlersFor(supabase, { github: githubSpy() }).list(request());
  const byStatus = Object.fromEntries(res.body.items.map((item) => [item.status, item]));
  assert.equal(byStatus.waiting.publication, null);
  assert.equal(byStatus.rejected.publication, null);
  // Nothing approved: the source gate is not even read.
  assert.equal(supabase.queries.filter((q) => q.table === 'source_triage_proposals').length, 0);
  assert.equal(supabase.queries.filter((q) => q.table === 'restaurant_source_analysis_jobs').length, 0);
});

test('list: without a configured GitHub link the card is "Nog niet klaar: GitHub-koppeling ontbreekt"', async () => {
  const supabase = world({ reviews: [approved(1)] });
  const res = await handlersFor(supabase, { github: null }).list(request());
  const { publication } = res.body.items[0];
  assert.equal(publication.state, 'not_ready');
  assert.equal(publication.label, 'Nog niet klaar: GitHub-koppeling ontbreekt.');
  assert.equal(publication.canExport, false);
  assert.match(publication.hints[0], /GitHub-koppeling ontbreekt op de server/);
});

test('list: an unconfirmed source and a blocked source each give their own plain reason', async () => {
  const replaced = world({
    reviews: [approved(1)],
    proposals: [
      { id: 'p1', restaurant_id: 'bistro', kind: 'add_candidate', proposed_url: MENU_URL, current_url: null, status: 'accepted', decided_at: '2026-10-12T09:30:00Z' },
      { id: 'p2', restaurant_id: 'bistro', kind: 'mark_unusable', proposed_url: null, current_url: MENU_URL, status: 'accepted', decided_at: '2026-10-13T07:00:00Z' },
    ],
  });
  const notConfirmed = (await handlersFor(replaced, { github: githubSpy() }).list(request())).body.items[0].publication;
  assert.equal(notConfirmed.state, 'not_ready');
  assert.equal(notConfirmed.label, 'Nog niet klaar: Bron nog niet bevestigd.');

  const robots = world({
    reviews: [approved(1)],
    jobs: [
      { id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-12T09:00:00Z' },
      { id: 'j2', canonical_source_url: SITE, status: 'failed', error_reason: 'robots_disallowed', created_at: '2026-10-13T06:00:00Z' },
    ],
  });
  const blocked = (await handlersFor(robots, { github: githubSpy() }).list(request())).body.items[0].publication;
  assert.equal(blocked.state, 'not_ready');
  assert.equal(blocked.label, 'Nog niet klaar: De bron is geblokkeerd: Robots geblokkeerd.');
  assert.equal(blocked.canExport, false);
});

test('list: the same content that was rejected before is never ready, even as the latest approved version', async () => {
  const supabase = world({
    snapshots: [
      snapshotRow(1, 1, content(), { created_at: '2026-10-12T09:00:00Z' }),
      snapshotRow(2, 2, content(), { created_at: '2026-10-12T10:00:00Z', based_on_snapshot_id: 1 }),
    ],
    reviews: [
      { id: 1, snapshot_id: 1, reviewer_id: REVIEWER, decision: 'rejected', reason: 'other', note: null, decided_at: '2026-10-12T12:00:00Z' },
      { ...approved(2), decided_at: '2026-10-13T09:00:00Z' },
    ],
  });
  const res = await handlersFor(supabase, { github: githubSpy() }).list(request());
  assert.deepEqual(res.body.items.map((item) => item.id), [2]);
  const { publication } = res.body.items[0];
  assert.equal(publication.state, 'not_ready');
  assert.equal(publication.label, 'Nog niet klaar: Deze menukaart is eerder afgewezen.');
  assert.equal(publication.canExport, false);
});

test('list: a version with blockers is never ready', async () => {
  const supabase = world({ snapshots: [snapshotRow(1, 1, content({ resolved: false }))], reviews: [approved(1)] });
  const item = (await handlersFor(supabase, { github: githubSpy() }).list(request())).body.items[0];
  assert.ok(item.blockerCount > 0);
  assert.equal(item.publication.state, 'not_ready');
  assert.match(item.publication.label, /^Nog niet klaar: Los eerst \d+ blokkades? op\.$/);
  assert.equal(item.publication.canExport, false);
});

test('list: every stored export status is shown with its real text and never as proof of readiness', async () => {
  const cases = {
    pending: ['export_pending', 'Review-PR wordt gemaakt'],
    opened: ['export_opened', 'Review-PR open'],
    merged: ['export_merged', 'Review-PR gemerged'],
    failed: ['export_failed', 'Vorige poging mislukt'],
    closed: ['export_closed', 'Review-PR gesloten zonder merge'],
  };
  for (const [status, [state, label]] of Object.entries(cases)) {
    const github = githubSpy(status === 'merged' ? 'merged' : 'opened');
    const supabase = world({ reviews: [approved(1)], exports: [exportRow(1, status)] });
    const res = await handlersFor(supabase, { github }).list(request());
    const { publication } = res.body.items[0];
    assert.equal(publication.state, state, status);
    assert.equal(publication.label, label, status);
    assert.equal(publication.exportStatus, status, status);
    assert.equal(publication.ready, false, `${status} is never proof that a card is ready`);
    assert.equal(github.calls.length, 0, 'the list never calls GitHub');
  }
  const merged = (await handlersFor(world({ reviews: [approved(1)], exports: [exportRow(1, 'merged')] }), { github: githubSpy() }).list(request())).body.items[0];
  assert.equal(merged.publication.liveNote, 'live na de volgende deploy');
});

test('list: one exports query for all shown cards and the same query count for one or many cards', async () => {
  const many = (count) => {
    const snapshots = [];
    const reviews = [];
    for (let i = 1; i <= count; i += 1) {
      snapshots.push(snapshotRow(i, 1, content(), { restaurant_id: `zaak-${i}`, menu_context: `zaak-${i}-menukaart` }));
      reviews.push(approved(i));
    }
    return world({ snapshots, reviews, exports: [exportRow(1, 'failed')] });
  };
  const one = many(1);
  const four = many(4);
  const github = githubSpy();
  const oneRes = await handlersFor(one, { github }).list(request());
  const fourRes = await handlersFor(four, { github }).list(request());
  assert.equal(oneRes.status, 200);
  assert.equal(fourRes.status, 200);
  assert.equal(fourRes.body.items.length, 4);
  const exportQueries = four.queries.filter((q) => q.table === 'menu_snapshot_exports');
  assert.equal(exportQueries.length, 1, 'one exports query, never one per card');
  assert.deepEqual(exportQueries[0].filters, [{ op: 'in', col: 'snapshot_id', vals: [1, 2, 3, 4] }]);
  assert.equal(four.queries.filter((q) => q.table === 'source_triage_proposals').length, 1);
  assert.equal(four.queries.filter((q) => q.table === 'restaurant_source_analysis_jobs').length, 1);
  assert.equal(four.queries.length, one.queries.length, 'the query count does not grow with the number of cards');
  assert.equal(github.calls.length, 0);
});

test('regression: the list and the detail give the same publication judgment for the same card', async () => {
  const scenarios = [
    ['ready', { reviews: [approved(1)] }],
    ['stored export', { reviews: [approved(1)], exports: [exportRow(1, 'closed')] }],
    ['github missing', { reviews: [approved(1)] }],
    ['blocked source', {
      reviews: [approved(1)],
      jobs: [
        { id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-12T09:00:00Z' },
        { id: 'j2', canonical_source_url: SITE, status: 'failed', error_reason: 'fetch_failed', created_at: '2026-10-13T06:00:00Z' },
      ],
    }],
    ['rejected before', {
      snapshots: [
        snapshotRow(1, 1, content(), { created_at: '2026-10-12T09:00:00Z' }),
        snapshotRow(2, 2, content(), { created_at: '2026-10-12T10:00:00Z' }),
      ],
      reviews: [
        { id: 1, snapshot_id: 1, reviewer_id: REVIEWER, decision: 'rejected', reason: 'other', note: null, decided_at: '2026-10-12T12:00:00Z' },
        { ...approved(2), decided_at: '2026-10-13T09:00:00Z' },
      ],
    }],
  ];
  for (const [name, data] of scenarios) {
    for (const githubConfigured of [true, false]) {
      const github = githubConfigured ? githubSpy('opened') : null;
      const supabase = world(data);
      const handlers = handlersFor(supabase, { github });
      const list = await handlers.list(request());
      const detail = await handlers.detail(request(), String(list.body.items[0].id));
      const label = `${name} (github ${githubConfigured ? 'aan' : 'uit'})`;
      assert.equal(list.status, 200, label);
      assert.equal(detail.status, 200, label);
      const fromList = list.body.items[0].publication;
      const fromDetail = detail.body.publication;
      const judgment = (p) => [p.state, p.label, p.reasons, p.exportStatus, p.liveNote, p.canExport];
      assert.deepEqual(judgment(fromList), judgment(fromDetail), label);
    }
  }
});

test('detail: canExport comes from the one publication rule, including the earlier-rejection gate', async () => {
  const readyWorld = world({ reviews: [approved(1)] });
  const ready = await handlersFor(readyWorld, { github: githubSpy() }).detail(request(), '1');
  assert.equal(ready.body.publication.state, 'ready');
  assert.equal(ready.body.publication.canExport, true);
  assert.deepEqual(ready.body.publication.hints, []);

  const rejectedWorld = world({
    snapshots: [
      snapshotRow(1, 1, content(), { created_at: '2026-10-12T09:00:00Z' }),
      snapshotRow(2, 2, content(), { created_at: '2026-10-12T10:00:00Z' }),
    ],
    reviews: [
      { id: 1, snapshot_id: 1, reviewer_id: REVIEWER, decision: 'rejected', reason: 'other', note: null, decided_at: '2026-10-12T12:00:00Z' },
      { ...approved(2), decided_at: '2026-10-13T09:00:00Z' },
    ],
  });
  const rejected = await handlersFor(rejectedWorld, { github: githubSpy() }).detail(request(), '2');
  assert.equal(rejected.body.publication.canExport, false);
  assert.deepEqual(rejected.body.publication.reasons, ['Deze menukaart is eerder afgewezen.']);
  // The old detail screen did not check this gate at all; the server export
  // handler always did. One rule now governs both.
  assert.equal(rejected.body.concept.rejectedBefore, true);

  // A card with an export still open may not start a second one.
  const openWorld = world({ reviews: [approved(1)], exports: [exportRow(1, 'opened')] });
  const open = await handlersFor(openWorld, { github: githubSpy() }).detail(request(), '1');
  assert.equal(open.body.export.status, 'opened');
  assert.equal(open.body.publication.canExport, false);
  assert.equal(open.body.publication.state, 'export_opened');
});

test('deriveSourceStatus: the batched list verdict is the same rule as the single lookup', async () => {
  const proposals = [{ id: 'p1', restaurant_id: 'bistro', kind: 'add_candidate', proposed_url: MENU_URL, current_url: null, status: 'accepted', decided_at: '2026-10-12T09:30:00Z' }];
  const jobs = [{ id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-12T09:00:00Z' }];
  assert.deepEqual(deriveSourceStatus({ proposals, jobs, restaurantId: 'bistro', sourceUrl: MENU_URL, receiptUrl: SITE }), { confirmed: true, blocked: null });
  assert.deepEqual(deriveSourceStatus({ proposals, jobs, restaurantId: 'andere-zaak', sourceUrl: MENU_URL, receiptUrl: SITE }), { confirmed: false, blocked: null });
  assert.deepEqual(
    deriveSourceStatus({ proposals: [], jobs: [{ id: 'j2', canonical_source_url: MENU_URL, status: 'failed', error_reason: 'unsafe_url', created_at: '2026-10-13T06:00:00Z' }], restaurantId: 'bistro', sourceUrl: MENU_URL, receiptUrl: null }),
    { confirmed: false, blocked: { reason: 'unsafe_url', label: 'Ongeldige URL' } },
  );
});


