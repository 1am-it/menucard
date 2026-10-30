'use strict';

// BE-17 Menuconcepten beoordelen v1 — handlers tested behaviourally with an
// injected fake Supabase client: internal-only access, server-side blockers
// (never the browser's word), stale versions, idempotent decisions, fixed
// rejection reasons, audit fields and the source check. Fictional data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMenuConceptReviewHandlers } = require('./menuConceptReviewHandlers');
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

/** The concept as BE-25 "Concept opslaan" stores it: with blockers resolved or not. */
function content({ resolved }) {
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

function fakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    tables,
    from(table) {
      const filters = [];
      const rows = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)));
      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        in(col, vals) {
          filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          calls.push({ select: table });
          return Promise.resolve({ data: rows()[0] || null, error: null });
        },
        insert(row) {
          calls.push({ insert: table, row });
          const list = (tables[table] = tables[table] || []);
          if (list.some((r) => r.restaurant_id === row.restaurant_id && r.menu_context === row.menu_context && r.version === row.version)) {
            const conflict = { data: null, error: { code: '23505' } };
            return { select: () => ({ maybeSingle: () => Promise.resolve(conflict) }) };
          }
          const stored = { id: list.length + 100, created_at: '2026-10-13T08:00:00Z', ...row };
          list.push(stored);
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: stored.id }, error: null }) }) };
        },
        then(resolve) {
          calls.push({ select: table });
          return resolve({ data: rows(), error: null });
        },
      };
      return builder;
    },
    // Mirrors record_menu_snapshot_decision (0018): stale → P0061, same decision → one row.
    rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name !== 'record_menu_snapshot_decision') return Promise.resolve({ data: null, error: { code: 'XX000' } });
      const snap = tables.menu_snapshot_proposals.find((s) => s.id === args.p_snapshot_id);
      if (!snap) return Promise.resolve({ data: null, error: { code: 'P0060' } });
      const latest = Math.max(...tables.menu_snapshot_proposals.filter((s) => s.restaurant_id === snap.restaurant_id && s.menu_context === snap.menu_context).map((s) => s.version));
      if (snap.version !== args.p_expected_version || snap.version !== latest) return Promise.resolve({ data: null, error: { code: 'P0061' } });
      const reviews = (tables.menu_snapshot_reviews = tables.menu_snapshot_reviews || []);
      const last = reviews.filter((r) => r.snapshot_id === snap.id).slice(-1)[0];
      if (last && last.decision === args.p_decision && (last.reason || null) === (args.p_reason || null)) return Promise.resolve({ data: [{ review_id: last.id, created: false }], error: null });
      const row = { id: reviews.length + 1, snapshot_id: snap.id, reviewer_id: args.p_actor_user_id, decision: args.p_decision, reason: args.p_reason, note: args.p_note, decided_at: `2026-10-13T09:0${reviews.length}:00Z` };
      reviews.push(row);
      return Promise.resolve({ data: [{ review_id: row.id, created: true }], error: null });
    },
  };
}

function world({ snapshots, reviews = [], proposals, jobs } = {}) {
  return fakeSupabase({
    menu_snapshot_proposals: snapshots || [snapshotRow(1, 1, content({ resolved: true }))],
    menu_snapshot_reviews: reviews,
    url_intake_analysis_receipts: [{ id: 'r1', canonical_source_url: SITE, fetched_at: '2026-10-12T09:00:00Z', menus: RECEIPT_MENUS }],
    source_triage_proposals: proposals || [{ id: 'p1', restaurant_id: 'bistro', kind: 'add_candidate', proposed_url: MENU_URL, current_url: null, status: 'accepted', decided_at: '2026-10-12T09:30:00Z' }],
    restaurant_source_analysis_jobs: jobs || [{ id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-12T09:00:00Z' }],
  });
}

function handlersFor(supabase, { userId = REVIEWER, roles = [{ role: 'internal' }] } = {}) {
  return createMenuConceptReviewHandlers({
    authenticate: async () => ({ ok: true, userId, roles }),
    getSupabase: () => supabase,
    restaurants: RESTAURANTS,
    liveMenus: LIVE,
    computeMenuHash: hash,
    now: () => new Date('2026-10-13T10:00:00Z'),
  });
}

const request = (body) => ({ json: async () => body });
const inserts = (supabase) => supabase.calls.filter((c) => c.insert);
const rpcs = (supabase) => supabase.calls.filter((c) => c.rpc);

test('only the internal role: a missing session, editor or owner is refused before any database call', async () => {
  const cases = [
    { auth: { ok: false, status: 401, error: 'Missing bearer token' }, status: 401 },
    { auth: { ok: true, userId: REVIEWER, roles: [{ role: 'editor' }] }, status: 403 },
    { auth: { ok: true, userId: REVIEWER, roles: [{ role: 'owner', restaurant_id: 'bistro' }] }, status: 403 },
  ];
  for (const c of cases) {
    let dbCalls = 0;
    const handlers = createMenuConceptReviewHandlers({
      authenticate: async () => c.auth,
      getSupabase: () => {
        dbCalls += 1;
        return world();
      },
      restaurants: RESTAURANTS,
      liveMenus: LIVE,
      computeMenuHash: hash,
    });
    const body = { expected_version: 1, decision: 'approved_internal', edits: {} };
    for (const res of [await handlers.list(request()), await handlers.detail(request(), '1'), await handlers.saveVersion(request(body), '1'), await handlers.decide(request(body), '1')]) {
      assert.equal(res.status, c.status);
    }
    assert.equal(dbCalls, 0);
  }
});

test('list: the latest version per concept, waiting first, with restaurant, source, time, status and attention counts', async () => {
  const supabase = world({
    snapshots: [
      snapshotRow(1, 1, content({ resolved: false })),
      snapshotRow(2, 2, content({ resolved: true }), { based_on_snapshot_id: 1, created_by: REVIEWER }),
      { ...snapshotRow(3, 1, content({ resolved: true })), restaurant_id: 'andere', menu_context: 'andere-menukaart' },
    ],
    reviews: [{ id: 1, snapshot_id: 3, decision: 'approved_internal', reason: null, decided_at: '2026-10-12T12:00:00Z' }],
  });
  const res = await handlersFor(supabase).list(request());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i) => [i.id, i.version, i.status]), [[2, 2, 'waiting'], [3, 1, 'approved']]);
  const bistro = res.body.items[0];
  assert.equal(bistro.restaurantName, 'Bistro Fictief');
  assert.equal(bistro.sourceUrl, MENU_URL);
  assert.equal(bistro.createdBySelf, true);
  assert.equal(bistro.blockerCount, 0);
  assert.equal(bistro.attentionCount, 2); // the soup's price change and the decided disappeared mousse stay visible
  assert.equal(inserts(supabase).length + rpcs(supabase).length, 0);
});

test('detail: original extraction, current menu, lineage with base version, reviews and source status', async () => {
  const supabase = world({ snapshots: [snapshotRow(1, 1, content({ resolved: false })), snapshotRow(2, 2, content({ resolved: true }), { based_on_snapshot_id: 1 })] });
  const res = await handlersFor(supabase).detail(request(), '2');
  assert.equal(res.status, 200);
  const { concept, originLines, liveLines, history, source } = res.body;
  assert.equal(concept.version, 2);
  assert.equal(concept.isLatest, true);
  assert.equal(concept.originRecorded, true);
  assert.deepEqual(originLines['0.0.2'], { name: 'Fictief tartaar', desc: null, price: null, category: 'Koud' });
  assert.deepEqual(liveLines.map((l) => l.name), ['Fictieve soep', 'Fictieve mousse']);
  assert.deepEqual(history.map((h) => [h.version, h.basedOnVersion]), [[2, 1], [1, null]]);
  assert.deepEqual(source, { confirmed: true, blocked: null });
  assert.equal((await handlersFor(supabase).detail(request(), 'abc')).status, 404);
  assert.equal((await handlersFor(supabase).detail(request(), '99')).status, 404);
});

test('correction: blockers are recomputed on the server from the stored version; forged browser fields change nothing', async () => {
  const supabase = world({ snapshots: [snapshotRow(1, 1, content({ resolved: false }))] });
  const forged = {
    expected_version: 1,
    canSave: true,
    blockers: [],
    edits: { lines: { '0.0.2': { accept: true, price: 'gratis', status: 'new' }, 'x.y': { exclude: true } }, removed: 'misschien', content: { categories: [] } },
  };
  const res = await handlersFor(supabase).saveVersion(request(forged), '1');
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'blockers');
  // "Klopt zo" never settles a missing price; vague section, duplicate and the disappeared dish stay blockers too.
  assert.deepEqual(res.body.blockers.map((b) => b.status).sort(), ['duplicate', 'missing_price', 'removed', 'unclear_category', 'unclear_category']);
  assert.equal(inserts(supabase).length, 0);
});

test('correction: a new immutable version with maker, analysis result and base version; the price change does not block', async () => {
  const supabase = world({ snapshots: [snapshotRow(1, 1, content({ resolved: false }))] });
  const edits = {
    // Rename and price the tartaar, keep both salads deliberately ("Klopt zo"),
    // exclude the uncertain cheese board, keep the disappeared mousse.
    lines: { '0.0.1': { acceptDuplicate: true }, '0.0.2': { price: '15,50', name: 'Fictief tartaar van de chef' }, '0.1.0': { acceptCategory: true, acceptDuplicate: true }, '0.1.1': { exclude: true } },
    removed: { 'fictieve mousse': 'keep' },
  };
  const res = await handlersFor(supabase).saveVersion(request({ expected_version: 1, edits }), '1');
  assert.equal(res.status, 201);
  assert.equal(res.body.concept.version, 2);
  const [write] = inserts(supabase);
  assert.equal(write.insert, 'menu_snapshot_proposals');
  assert.equal(write.row.version, 2);
  assert.equal(write.row.created_by, REVIEWER);
  assert.equal(write.row.origin_receipt_id, 'r1');
  assert.equal(write.row.based_on_snapshot_id, 1);
  assert.equal(write.row.source_url, MENU_URL);
  assert.equal(write.row.content_hash, hash(write.row.captured_content));
  const items = write.row.captured_content.categories.flatMap((c) =>
    c.items.map((i) => [c.name, i.name, i.price, i.from || null, Boolean(i.categoryAccepted), Boolean(i.duplicateAccepted), Boolean(i.kept)])
  );
  assert.deepEqual(items, [
    ['Koud', 'Fictieve soep', '8.50', '0.0.0', false, false, false], // price change 7,50 → 8,50: visible, not blocking
    ['Koud', 'Fictieve salade', '12.50', '0.0.1', false, true, false],
    ['Koud', 'Fictief tartaar van de chef', '15.50', '0.0.2', false, false, false], // keeps its reference to the original line
    ['Koud', 'Fictieve mousse', '8.00', null, false, false, true], // kept from the current menu
    ['Overig', 'Fictieve salade', '13.00', '0.1.0', true, true, false],
  ]);
  assert.equal(rpcs(supabase).length, 0);
});

test('BE-53 correction: a renamed menukopje is the new version\'s heading; the previous version never changes', async () => {
  const { storedConceptInput, renameSectionEdits } = require('./menuConcept');
  const version1 = content({ resolved: true });
  const supabase = world({ snapshots: [snapshotRow(1, 1, version1)] });

  // The reviewer saw the stored version; the helper turns one menukopje into
  // the existing per-dish `path` edits.
  const stored = storedConceptInput(version1);
  const storedConcept = buildMenuConcept({ menus: stored.menus, liveLines: [], edits: stored.edits });
  const section = storedConcept.content.categories[0];
  assert.equal(section.name, 'Koud');
  const rename = renameSectionEdits(storedConcept.lines, section.path || [section.name], 'Koud gerechten');
  assert.equal(rename.ok, true);

  const res = await handlersFor(supabase).saveVersion(request({ expected_version: 1, edits: rename.edits }), '1');
  assert.equal(res.status, 201);
  assert.equal(res.body.concept.version, 2);

  // The new version carries the new heading and every dish of that menukopje.
  const [write] = inserts(supabase);
  const newSections = write.row.captured_content.categories;
  assert.deepEqual(newSections.map((c) => c.name), ['Koud gerechten', 'Kaas']);
  assert.deepEqual(
    newSections[0].items.map((i) => i.name),
    ['Fictieve soep', 'Fictieve salade', 'Fictief tartaar']
  );

  // Version 1 is untouched: same content, same version, still the stored row.
  const previous = supabase.tables.menu_snapshot_proposals.find((row) => row.id === 1);
  assert.equal(previous.version, 1);
  assert.deepEqual(previous.captured_content, version1);
  assert.equal(write.row.based_on_snapshot_id, 1);
  // Nothing is published or exported by a correction.
  assert.equal(rpcs(supabase).length, 0);
});

test('BE-53 correction: an empty or over-long menukopje name never becomes a stored heading', async () => {
  const { storedConceptInput } = require('./menuConcept');
  const version1 = content({ resolved: true });
  const stored = storedConceptInput(version1);
  const storedConcept = buildMenuConcept({ menus: stored.menus, liveLines: [], edits: stored.edits });
  const section = storedConcept.content.categories[0];
  const ids = storedConcept.lines.filter((l) => l.categoryPath[0] === section.name).map((l) => l.id);

  for (const name of ['', '   ', 'x'.repeat(201)]) {
    const edits = { lines: Object.fromEntries(ids.map((id) => [id, { path: [name] }])) };
    const supabase = world({ snapshots: [snapshotRow(1, 1, version1)] });
    // `sanitizeEdits` drops a label that is empty or above MAX_EDIT_TEXT, so the
    // server keeps the stored heading and writes no new version at all.
    const res = await handlersFor(supabase).saveVersion(request({ expected_version: 1, edits }), '1');
    assert.equal(res.status, 200, `${JSON.stringify(name)}: ${JSON.stringify(res.body)}`);
    assert.deepEqual([res.body.concept.version, res.body.concept.unchanged], [1, true]);
    assert.equal(inserts(supabase).length, 0);
    assert.equal(supabase.tables.menu_snapshot_proposals.length, 1);
    assert.deepEqual(supabase.tables.menu_snapshot_proposals[0].captured_content, version1);
  }
});

test('correction: a stale version is a conflict and is never overwritten; identical content makes no new version', async () => {
  const resolved = content({ resolved: true });
  const supabase = world({ snapshots: [snapshotRow(1, 1, content({ resolved: false })), snapshotRow(2, 2, resolved, { based_on_snapshot_id: 1 })] });
  const stale = await handlersFor(supabase).saveVersion(request({ expected_version: 1, edits: { lines: { '0.0.2': { price: '15,50' } } } }), '1');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, 'stale_version');
  const wrongExpectation = await handlersFor(supabase).saveVersion(request({ expected_version: 1, edits: {} }), '2');
  assert.equal(wrongExpectation.status, 409);
  const same = await handlersFor(supabase).saveVersion(request({ expected_version: 2, edits: {} }), '2');
  assert.equal(same.status, 200);
  assert.deepEqual([same.body.concept.version, same.body.concept.unchanged], [2, true]);
  assert.equal(inserts(supabase).length, 0);
  assert.equal((await handlersFor(supabase).saveVersion(request({ edits: {} }), '2')).status, 400);
});

test('correction: content a human rejected before does not come back as a new version', async () => {
  const resolved = content({ resolved: true });
  const supabase = world({
    snapshots: [snapshotRow(1, 1, resolved), snapshotRow(2, 2, { ...resolved, categories: resolved.categories.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, price: i.name === 'Fictieve soep' ? '9.00' : i.price })) })) }, { based_on_snapshot_id: 1 })],
    reviews: [{ id: 1, snapshot_id: 1, reviewer_id: MAKER, decision: 'rejected', reason: 'content_mismatch', decided_at: '2026-10-12T12:00:00Z' }],
  });
  // Setting the soup back to 8,50 recreates exactly the rejected public menu.
  const soup = resolved.categories.findIndex((c) => c.items.some((i) => i.name === 'Fictieve soep'));
  const res = await handlersFor(supabase).saveVersion(request({ expected_version: 2, edits: { lines: { [`0.${soup}.0`]: { price: '8,50' } } } }), '2');
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'previously_rejected');
  assert.equal(inserts(supabase).length, 0);
});

test('approve: refused with blockers in the stored version, for a stale version, or when the public menu was rejected before', async () => {
  const open = world({ snapshots: [snapshotRow(1, 1, content({ resolved: false }))] });
  const blocked = await handlersFor(open).decide(request({ expected_version: 1, decision: 'approved_internal', canSave: true }), '1');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.reason, 'blockers');
  assert.equal(rpcs(open).length, 0);

  const two = world({ snapshots: [snapshotRow(1, 1, content({ resolved: true })), snapshotRow(2, 2, content({ resolved: true }), { content_hash: 'c'.repeat(64) })] });
  const stale = await handlersFor(two).decide(request({ expected_version: 1, decision: 'approved_internal' }), '1');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, 'stale_version');
  assert.equal(rpcs(two).length, 0);

  const again = world({
    snapshots: [snapshotRow(1, 1, content({ resolved: true })), snapshotRow(2, 2, content({ resolved: true }), { content_hash: 'd'.repeat(64) })],
    reviews: [{ id: 1, snapshot_id: 1, reviewer_id: MAKER, decision: 'rejected', reason: 'other', decided_at: '2026-10-12T12:00:00Z' }],
  });
  const rejectedBefore = await handlersFor(again).decide(request({ expected_version: 2, decision: 'approved_internal' }), '2');
  assert.equal(rejectedBefore.status, 409);
  assert.equal(rejectedBefore.body.reason, 'previously_rejected');
});

test('approve: refused when the source is no longer confirmed or its latest analysis is blocked', async () => {
  const replaced = world({
    proposals: [
      { id: 'p1', restaurant_id: 'bistro', kind: 'add_candidate', proposed_url: MENU_URL, current_url: null, status: 'accepted', decided_at: '2026-10-12T09:30:00Z' },
      { id: 'p2', restaurant_id: 'bistro', kind: 'mark_unusable', proposed_url: null, current_url: MENU_URL, status: 'accepted', decided_at: '2026-10-13T07:00:00Z' },
    ],
  });
  const notConfirmed = await handlersFor(replaced).decide(request({ expected_version: 1, decision: 'approved_internal' }), '1');
  assert.equal(notConfirmed.status, 409);
  assert.equal(notConfirmed.body.reason, 'source_not_confirmed');

  const robots = world({
    jobs: [
      { id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-12T09:00:00Z' },
      { id: 'j2', canonical_source_url: SITE, status: 'failed', error_reason: 'robots_disallowed', created_at: '2026-10-13T06:00:00Z' },
    ],
  });
  const blocked = await handlersFor(robots).decide(request({ expected_version: 1, decision: 'approved_internal' }), '1');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.reason, 'source_blocked');
  assert.match(blocked.body.error, /Robots geblokkeerd/);
  assert.equal(rpcs(replaced).length + rpcs(robots).length, 0);
});

test('approve: the reviewer may approve their own corrected version; the same decision twice is one review; a price change does not block', async () => {
  const supabase = world({ snapshots: [snapshotRow(1, 1, content({ resolved: true }), { created_by: REVIEWER })] });
  const first = await handlersFor(supabase).decide(request({ expected_version: 1, decision: 'approved_internal' }), '1');
  assert.equal(first.status, 201);
  assert.equal(first.body.review.created, true);
  const second = await handlersFor(supabase).decide(request({ expected_version: 1, decision: 'approved_internal' }), '1');
  assert.equal(second.status, 200);
  assert.equal(second.body.review.created, false);
  assert.equal(supabase.tables.menu_snapshot_reviews.length, 1);
  const [call] = rpcs(supabase);
  assert.deepEqual(call.args, { p_snapshot_id: 1, p_expected_version: 1, p_decision: 'approved_internal', p_reason: null, p_note: null, p_actor_user_id: REVIEWER });
  assert.equal(inserts(supabase).length, 0); // a decision never writes a version, menus.json or anything public
});

test('reject: needs one of the fixed BE-17 reasons; then recorded once, even with blockers', async () => {
  const supabase = world({ snapshots: [snapshotRow(1, 1, content({ resolved: false }))] });
  const handlers = handlersFor(supabase);
  assert.equal((await handlers.decide(request({ expected_version: 1, decision: 'rejected' }), '1')).status, 400);
  assert.equal((await handlers.decide(request({ expected_version: 1, decision: 'rejected', reason: 'onzin' }), '1')).status, 400);
  assert.equal((await handlers.decide(request({ expected_version: 1, decision: 'approved_internal', reason: 'other' }), '1')).status, 400);
  assert.equal((await handlers.decide(request({ expected_version: 1, decision: 'needs_review' }), '1')).status, 400);
  assert.equal(rpcs(supabase).length, 0);
  const res = await handlers.decide(request({ expected_version: 1, decision: 'rejected', reason: 'content_mismatch', note: '  Prijzen horen bij de lunch.  ' }), '1');
  assert.equal(res.status, 201);
  assert.deepEqual(rpcs(supabase)[0].args.p_reason, 'content_mismatch');
  assert.equal(rpcs(supabase)[0].args.p_note, 'Prijzen horen bij de lunch.');
  assert.equal((await handlers.decide(request({ expected_version: 1, decision: 'rejected', reason: 'content_mismatch' }), '1')).status, 200);
  assert.equal(supabase.tables.menu_snapshot_reviews.length, 1);
});

test('a stale decision reported by the database is a conflict, never a silent decision', async () => {
  const supabase = world();
  supabase.rpc = async (name, args) => {
    supabase.calls.push({ rpc: name, args });
    return { data: null, error: { code: 'P0061' } };
  };
  const res = await handlersFor(supabase).decide(request({ expected_version: 1, decision: 'approved_internal' }), '1');
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'stale_version');
});
