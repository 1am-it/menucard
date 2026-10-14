'use strict';

// BE-27 "Maak review-PR" — tested behaviourally with a fake Supabase client
// and a fake GitHub client: every export condition, idempotency, GitHub
// failures without a second export, the exact scope of the change and no
// direct public change. Fictional data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMenuConceptExportHandler, marker } = require('./menuConceptExport');
const { sourceStatus } = require('./menuConceptReviewHandlers');
const { buildMenuConcept, liveMenuLines } = require('./menuConcept');
const { serialize } = require('./menuExport');

const REVIEWER = '33333333-3333-4333-8333-333333333333';
const MENU_URL = 'https://bistro-fictief.example/menukaart';
const SITE = 'https://www.bistro-fictief.example/';
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

const LIVE = {
  '1-lunch': { subtitle: 'Lunchkaart', categories: [{ name: 'Lunch', items: [{ name: 'Fictieve soep', desc: 'Huisgemaakt', price: '€7,50', priceValue: 7.5, tags: ['aanbevolen'], allergens: [] }] }] },
  '1-diner': { subtitle: 'Dinerkaart', categories: [{ name: 'Hoofd', items: [{ name: 'Fictieve entrecote', price: '€24,50', priceValue: 24.5, tags: [] }] }] },
  '19-diner': { subtitle: 'Dinerkaart', categories: [{ name: 'Hoofd', items: [{ name: 'Ander gerecht', price: '€20', priceValue: 20, tags: [] }] }] },
};
const RESTAURANTS = {
  1: { name: 'Bistro Fictief', address: 'Fictieve straat 1', menuLinks: [{ id: '1-lunch', label: 'Lunch' }, { id: '1-diner', label: 'Diner' }] },
  19: { name: 'Ander Fictief', menuLinks: [{ id: '19-diner', label: 'Diner' }] },
};
const RECEIPT_MENUS = [{ categories: [{ name: 'Voorgerechten', items: [{ name: 'Fictieve soep', price: '8.50' }, { name: 'Fictieve risotto', price: '18.00' }] }] }];

function approvedContent(edits = { removed: { 'fictieve entrecote': 'remove' } }) {
  return buildMenuConcept({ menus: RECEIPT_MENUS, liveLines: liveMenuLines(LIVE, '1'), edits }).content;
}

function snapshotRow(id, version, captured) {
  return { id, restaurant_id: '1', menu_context: '1-menukaart', version, content_hash: hash(captured), captured_content: captured, source_url: MENU_URL, source_type: 'own_website', quality_score: 'medium', originally_fetched_at: '2026-10-12T09:00:00Z', created_at: `2026-10-12T1${version}:00:00Z`, created_by: REVIEWER, origin_receipt_id: 'r1', based_on_snapshot_id: null };
}

function fakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    tables,
    from(table) {
      const filters = [];
      let patch = null;
      const rows = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)));
      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          filters.push((r) => r[col] === val);
          if (patch) {
            calls.push({ update: table, patch });
            for (const r of rows()) Object.assign(r, patch);
            return Promise.resolve({ error: null });
          }
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
        update(p) {
          patch = p;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows()[0] || null, error: null });
        },
        insert(row) {
          calls.push({ insert: table, row });
          const list = (tables[table] = tables[table] || []);
          const active = (r) => r.status === 'pending' || r.status === 'opened';
          if (table === 'menu_snapshot_exports' && list.some((r) => active(r) && (r.snapshot_id === row.snapshot_id || r.restaurant_id === row.restaurant_id))) {
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: '23505' } }) }) };
          }
          const stored = { id: list.length + 1, created_at: '2026-10-14T10:00:00Z', updated_at: '2026-10-14T10:00:00Z', ...row };
          list.push(stored);
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: stored, error: null }) }) };
        },
        then(resolve) {
          return resolve({ data: rows(), error: null });
        },
      };
      return builder;
    },
  };
}

function world({ snapshots, reviews, proposals, jobs, exports = [] } = {}) {
  return fakeSupabase({
    menu_snapshot_proposals: snapshots || [snapshotRow(5, 1, approvedContent())],
    menu_snapshot_reviews: reviews || [{ id: 1, snapshot_id: 5, reviewer_id: REVIEWER, decision: 'approved_internal', reason: null, decided_at: '2026-10-13T09:00:00Z' }],
    url_intake_analysis_receipts: [{ id: 'r1', canonical_source_url: SITE }],
    source_triage_proposals: proposals || [{ id: 'p1', restaurant_id: '1', kind: 'add_candidate', proposed_url: MENU_URL, current_url: null, status: 'accepted', decided_at: '2026-10-12T09:30:00Z' }],
    restaurant_source_analysis_jobs: jobs || [{ id: 'j1', canonical_source_url: SITE, status: 'succeeded', error_reason: null, created_at: '2026-10-12T09:00:00Z' }],
    menu_snapshot_exports: exports,
  });
}

/** A fake GitHub: base branch files, open pull requests, and failure injection per operation. */
function fakeGithub({ baseMenus = LIVE, baseRestaurants = RESTAURANTS, failOn = null } = {}) {
  const state = { commits: [], branches: {}, pulls: [], calls: [] };
  const step = (name) => {
    state.calls.push(name);
    if (failOn === name) throw Object.assign(new Error(`GitHub ${name} failed`), { status: 500 });
  };
  return {
    state,
    async baseSha() {
      step('baseSha');
      return 'a'.repeat(40);
    },
    async readFile(path) {
      step(`read:${path}`);
      return serialize(path === 'data/menus.json' ? baseMenus : baseRestaurants);
    },
    async commitToNewBranch({ branch, parentSha, files, message }) {
      step('commit');
      if (state.branches[branch]) throw Object.assign(new Error('exists'), { status: 422 });
      const commitSha = String(state.commits.length + 1).padStart(40, 'c');
      state.commits.push({ branch, parentSha, files, message, commitSha });
      state.branches[branch] = commitSha;
      return { commitSha };
    },
    async openPullRequest({ branch, title, body }) {
      step('openPullRequest');
      const number = state.pulls.length + 40;
      state.pulls.push({ number, url: `https://github.com/voorbeeld/menucard/pull/${number}`, body, branch, headSha: state.branches[branch], title, state: 'open' });
      return { number, url: `https://github.com/voorbeeld/menucard/pull/${number}` };
    },
    async openPullRequests() {
      step('openPullRequests');
      return state.pulls.filter((p) => p.state === 'open');
    },
    async pullRequestState(number) {
      step('pullRequestState');
      return state.pulls.find((p) => p.number === number).state;
    },
  };
}

function handler(supabase, github, { roles = [{ role: 'internal' }], liveMenus = LIVE } = {}) {
  return createMenuConceptExportHandler({
    authenticate: async () => ({ ok: true, userId: REVIEWER, roles }),
    getSupabase: () => supabase,
    restaurants: RESTAURANTS,
    liveMenus,
    computeMenuHash: hash,
    github,
    sourceStatus,
    now: () => new Date('2026-10-14T10:05:00Z'),
  });
}

const request = (body) => ({ json: async () => body });
const go = (supabase, github, opts, body = { expected_version: 1 }, id = '5') => handler(supabase, github, opts).exportToReviewPr(request(body), id);

test('only the internal role; a missing session, editor or owner is refused before any database or GitHub call', async () => {
  for (const auth of [{ ok: false, status: 401, error: 'x' }, { ok: true, userId: REVIEWER, roles: [{ role: 'editor' }] }, { ok: true, userId: REVIEWER, roles: [{ role: 'owner', restaurant_id: '1' }] }]) {
    let db = 0;
    const github = fakeGithub();
    const h = createMenuConceptExportHandler({ authenticate: async () => auth, getSupabase: () => (db += 1), restaurants: RESTAURANTS, liveMenus: LIVE, computeMenuHash: hash, github, sourceStatus });
    const res = await h.exportToReviewPr(request({ expected_version: 1 }), '5');
    assert.ok(res.status === 401 || res.status === 403);
    assert.equal(db, 0);
    assert.equal(github.state.calls.length, 0);
  }
});

test('export: one branch, one commit with only the two static files, one ordinary pull request; nothing merged', async () => {
  const supabase = world();
  const github = fakeGithub();
  const res = await go(supabase, github);
  assert.equal(res.status, 201);
  assert.equal(res.body.message, 'Nog niet gepubliceerd. Handmatig mergen vereist.');
  assert.equal(res.body.export.status, 'opened');
  assert.equal(res.body.export.prUrl, 'https://github.com/voorbeeld/menucard/pull/40');
  assert.equal(github.state.commits.length, 1);
  assert.equal(github.state.pulls.length, 1);
  const [commit] = github.state.commits;
  assert.equal(commit.parentSha, 'a'.repeat(40));
  assert.match(commit.branch, /^menu-export\/1-v1-e1$/);
  assert.deepEqual(commit.files.map((f) => f.path), ['data/menus.json', 'data/restaurants.json']);
  // The diff holds only this restaurant's menu: lunch + diner become one complete menukaart.
  const menus = JSON.parse(commit.files[0].content);
  assert.deepEqual(Object.keys(menus), ['1-menukaart', '19-diner']);
  assert.deepEqual(menus['19-diner'], LIVE['19-diner']);
  assert.deepEqual(menus['1-menukaart'].categories[0].items.map((i) => [i.name, i.price, i.tags]), [['Fictieve soep', '€8,50', ['aanbevolen']], ['Fictieve risotto', '€18', []]]);
  const restaurants = JSON.parse(commit.files[1].content);
  assert.deepEqual(restaurants['1'], { ...RESTAURANTS['1'], menuLinks: [{ id: '1-menukaart', label: '📋 Menukaart' }] });
  assert.deepEqual(restaurants['19'], RESTAURANTS['19']);
  assert.ok(github.state.pulls[0].body.includes(marker(5)));
  assert.match(github.state.pulls[0].body, /Nog niet gepubliceerd/);
  // Durable provenance: version, content hash, export hash, branch, commit and PR.
  const [row] = supabase.tables.menu_snapshot_exports;
  assert.equal(row.snapshot_id, 5);
  assert.equal(row.content_hash, supabase.tables.menu_snapshot_proposals[0].content_hash);
  assert.match(row.export_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual([row.status, row.branch, row.commit_sha, row.pr_number, row.pr_url], ['opened', commit.branch, commit.commitSha, 40, 'https://github.com/voorbeeld/menucard/pull/40']);
  assert.equal(row.created_by, REVIEWER);
  // No direct public change: only the export row is written in the database.
  assert.deepEqual([...new Set(supabase.calls.map((c) => c.insert || c.update))], ['menu_snapshot_exports']);
});

test('idempotent: a second click returns the same open pull request, never a second branch or PR', async () => {
  const supabase = world();
  const github = fakeGithub();
  await go(supabase, github);
  const again = await go(supabase, github);
  assert.equal(again.status, 200);
  assert.equal(again.body.existing, true);
  assert.equal(again.body.export.prUrl, 'https://github.com/voorbeeld/menucard/pull/40');
  assert.equal(github.state.commits.length, 1);
  assert.equal(github.state.pulls.length, 1);
  assert.equal(supabase.tables.menu_snapshot_exports.length, 1);
  // Concurrent click while the first is still pending.
  const busy = world({ exports: [{ id: 1, snapshot_id: 5, restaurant_id: '1', content_hash: 'a'.repeat(64), status: 'pending', created_at: '2026-10-14T10:04:00Z', updated_at: '2026-10-14T10:04:00Z' }] });
  const pending = await go(busy, fakeGithub());
  assert.equal(pending.status, 409);
  assert.equal(pending.body.reason, 'export_in_progress');
});

test('a GitHub failure records the attempt as failed; the retry creates exactly one pull request', async () => {
  const supabase = world();
  const broken = fakeGithub({ failOn: 'openPullRequest' });
  const failed = await go(supabase, broken);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.reason, 'github_error');
  assert.equal(supabase.tables.menu_snapshot_exports[0].status, 'failed');
  assert.equal(supabase.tables.menu_snapshot_exports[0].error_reason, 'github_error');
  assert.equal(broken.state.pulls.length, 0);

  // A pull request that was opened but not recorded is found by its marker, not created again.
  const recorded = world();
  const github = fakeGithub();
  github.state.pulls.push({ number: 77, url: 'https://github.com/voorbeeld/menucard/pull/77', body: `x\n${marker(5)}`, branch: 'menu-export/1-v1-e9', headSha: 'd'.repeat(40), state: 'open' });
  const retry = await go(recorded, github);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.existing, true);
  assert.equal(retry.body.export.prNumber, 77);
  assert.equal(github.state.commits.length, 0);
  assert.equal(github.state.pulls.length, 1);
});

test('refused: stale version, not approved, rejected, blockers, rejected-before content', async () => {
  const two = world({ snapshots: [snapshotRow(5, 1, approvedContent()), snapshotRow(6, 2, approvedContent({ removed: { 'fictieve entrecote': 'keep' } }))] });
  assert.equal((await go(two, fakeGithub())).body.reason, 'stale_version');
  assert.equal((await go(world(), fakeGithub(), {}, { expected_version: 2 })).body.reason, 'stale_version');

  assert.equal((await go(world({ reviews: [] }), fakeGithub())).body.reason, 'not_approved');
  const rejected = world({ reviews: [{ id: 1, snapshot_id: 5, decision: 'approved_internal', decided_at: '2026-10-13T09:00:00Z' }, { id: 2, snapshot_id: 5, decision: 'rejected', reason: 'other', decided_at: '2026-10-13T10:00:00Z' }] });
  assert.equal((await go(rejected, fakeGithub())).body.reason, 'rejected');

  // Undecided disappeared dish: a partial menu never exports.
  const partial = world({ snapshots: [snapshotRow(5, 1, approvedContent({}))] });
  const res = await go(partial, fakeGithub());
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'blockers');

  const again = world({
    snapshots: [snapshotRow(4, 1, approvedContent()), { ...snapshotRow(5, 2, approvedContent()), content_hash: 'e'.repeat(64) }],
    reviews: [{ id: 1, snapshot_id: 4, decision: 'rejected', reason: 'other', decided_at: '2026-10-13T08:00:00Z' }, { id: 2, snapshot_id: 5, decision: 'approved_internal', decided_at: '2026-10-13T09:00:00Z' }],
  });
  assert.equal((await go(again, fakeGithub(), {}, { expected_version: 2 })).body.reason, 'previously_rejected');
});

test('refused: source withdrawn or blocked', async () => {
  const withdrawn = world({
    proposals: [
      { id: 'p1', restaurant_id: '1', kind: 'add_candidate', proposed_url: MENU_URL, status: 'accepted', decided_at: '2026-10-12T09:30:00Z' },
      { id: 'p2', restaurant_id: '1', kind: 'mark_unusable', current_url: MENU_URL, status: 'accepted', decided_at: '2026-10-13T07:00:00Z' },
    ],
  });
  assert.equal((await go(withdrawn, fakeGithub())).body.reason, 'source_not_confirmed');
  const blocked = world({ jobs: [{ id: 'j2', canonical_source_url: SITE, status: 'failed', error_reason: 'robots_disallowed', created_at: '2026-10-14T06:00:00Z' }] });
  const res = await go(blocked, fakeGithub());
  assert.equal(res.body.reason, 'source_blocked');
  assert.match(res.body.error, /Robots geblokkeerd/);
});

test('refused: the menu on GitHub changed since the concept was checked (stale base)', async () => {
  const changed = { ...LIVE, '1-lunch': { ...LIVE['1-lunch'], categories: [{ name: 'Lunch', items: [{ name: 'Fictieve soep', price: '€7,95', priceValue: 7.95, tags: [] }] }] } };
  const github = fakeGithub({ baseMenus: changed });
  const res = await go(world(), github);
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'base_changed');
  assert.equal(github.state.commits.length, 0);
});

test('without the GitHub integration: a clear refusal, nothing written', async () => {
  const supabase = world();
  const res = await go(supabase, null);
  assert.equal(res.status, 503);
  assert.equal(res.body.reason, 'github_not_configured');
  assert.equal(supabase.calls.length, 0);
});

test('another open review PR for the same restaurant blocks a second export; a closed one does not', async () => {
  const open = fakeGithub();
  open.state.pulls.push({ number: 12, url: 'https://github.com/voorbeeld/menucard/pull/12', body: marker(3), branch: 'menu-export/1-v1-e1', headSha: 'f'.repeat(40), state: 'open' });
  const other = { id: 1, snapshot_id: 3, restaurant_id: '1', content_hash: 'a'.repeat(64), status: 'opened', branch: 'menu-export/1-v1-e1', commit_sha: 'f'.repeat(40), pr_number: 12, pr_url: 'https://github.com/voorbeeld/menucard/pull/12', created_at: '2026-10-13T10:00:00Z' };
  const res = await go(world({ exports: [{ ...other }] }), open);
  assert.equal(res.body.reason, 'other_export_open');

  open.state.pulls[0].state = 'closed';
  const supabase = world({ exports: [{ ...other }] });
  const next = await go(supabase, open);
  assert.equal(next.status, 201);
  assert.equal(supabase.tables.menu_snapshot_exports[0].status, 'closed');
});
