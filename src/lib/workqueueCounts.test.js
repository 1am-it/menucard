'use strict';

// #62 — unit tests for the real workqueue counts: the pure reducers that define
// what "open werk" means, and the authenticated handler that only counts what
// the caller may open and never invents a number. Fictional rows only; no
// Supabase, no network.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CLOSED_SNAPSHOT_STATUSES,
  latestSnapshotPerLineage,
  countSnapshotConceptsAwaitingReview,
  countNewInboxCandidates,
  countCandidatesWithoutReview,
  sumAvailableCounts,
} = require('./workqueueCounts');
const { createWorkqueueCountsHandlers } = require('./workqueueCountsHandlers');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/workqueue-counts/route.js');

// ─── Snapshots: Menuconcepten beoordelen ───────────────────────────────

test('latestSnapshotPerLineage: keeps only the highest version per restaurant/menu_context', () => {
  const rows = [
    { id: 1, restaurant_id: '9001', menu_context: '9001-lunch', version: 1 },
    { id: 2, restaurant_id: '9001', menu_context: '9001-lunch', version: 3 },
    { id: 3, restaurant_id: '9001', menu_context: '9001-lunch', version: 2 },
    { id: 4, restaurant_id: '9002', menu_context: '9002-diner', version: 1 },
  ];
  const latest = latestSnapshotPerLineage(rows);
  assert.deepEqual(latest.map((row) => row.id).sort(), [2, 4]);
});

test('latestSnapshotPerLineage: skips malformed rows and never throws on non-array input', () => {
  assert.deepEqual(latestSnapshotPerLineage(null), []);
  assert.deepEqual(latestSnapshotPerLineage(undefined), []);
  assert.deepEqual(latestSnapshotPerLineage([null, {}, { id: 1 }]), []);
});

test('countSnapshotConceptsAwaitingReview: counts unreviewed, needs_review and deferred latest versions; approved and rejected are closed', () => {
  const snapshots = [
    { id: 11, restaurant_id: '9001', menu_context: '9001-lunch', version: 1 },
    { id: 12, restaurant_id: '9002', menu_context: '9002-lunch', version: 1 },
    { id: 13, restaurant_id: '9003', menu_context: '9003-lunch', version: 1 },
    { id: 14, restaurant_id: '9004', menu_context: '9004-lunch', version: 1 },
    { id: 15, restaurant_id: '9005', menu_context: '9005-lunch', version: 1 },
  ];
  const reviews = [
    { id: 1, snapshot_id: 12, decided_at: '2026-10-20T10:00:00.000Z', decision: 'needs_review' },
    { id: 2, snapshot_id: 13, decided_at: '2026-10-20T10:00:00.000Z', decision: 'approved_internal' },
    { id: 3, snapshot_id: 14, decided_at: '2026-10-20T10:00:00.000Z', decision: 'rejected' },
    { id: 4, snapshot_id: 15, decided_at: '2026-10-20T10:00:00.000Z', decision: 'needs_review' },
    { id: 5, snapshot_id: 15, decided_at: '2026-10-21T10:00:00.000Z', decision: 'deferred' },
  ];
  assert.equal(CLOSED_SNAPSHOT_STATUSES.includes('approved_internal'), true);
  assert.equal(countSnapshotConceptsAwaitingReview(snapshots, reviews), 3);
});

test('countSnapshotConceptsAwaitingReview: an older version\'s still-open review never counts once a newer version exists', () => {
  const snapshots = [
    { id: 21, restaurant_id: '9001', menu_context: '9001-lunch', version: 1 },
    { id: 22, restaurant_id: '9001', menu_context: '9001-lunch', version: 2 },
  ];
  const reviews = [
    { id: 1, snapshot_id: 21, decided_at: '2026-10-20T10:00:00.000Z', decision: 'needs_review' },
    { id: 2, snapshot_id: 22, decided_at: '2026-10-21T10:00:00.000Z', decision: 'approved_internal' },
  ];
  assert.equal(countSnapshotConceptsAwaitingReview(snapshots, reviews), 0);
});

test('countSnapshotConceptsAwaitingReview: no snapshots and no reviews is a real 0, not a missing number', () => {
  assert.equal(countSnapshotConceptsAwaitingReview([], []), 0);
  assert.equal(countSnapshotConceptsAwaitingReview(null, null), 0);
});

// ─── Import inbox: Nieuwe aanleveringen ────────────────────────────────

test('countNewInboxCandidates: counts candidates without any review row, never the reviewed ones', () => {
  const records = [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }, { id: 'c-4' }];
  const reviews = [
    { id: 'r1', candidate_id: 'c-1', decided_at: '2026-10-20T10:00:00.000Z', status: 'needs_enrichment' },
    { id: 'r2', candidate_id: 'c-2', decided_at: '2026-10-20T10:00:00.000Z', status: 'approved_internal' },
    { id: 'r3', candidate_id: 'c-3', decided_at: '2026-10-20T10:00:00.000Z', status: 'rejected' },
  ];
  assert.equal(countNewInboxCandidates(records, reviews), 1);
});

test('countNewInboxCandidates: the latest decision wins, and a review for an unknown candidate never adds a count', () => {
  const records = [{ id: 'c-1' }];
  const reviews = [
    { id: 'r1', candidate_id: 'c-1', decided_at: '2026-10-20T10:00:00.000Z', status: 'deferred' },
    { id: 'r2', candidate_id: 'c-1', decided_at: '2026-10-21T10:00:00.000Z', status: 'needs_enrichment' },
    { id: 'r3', candidate_id: 'c-unknown', decided_at: '2026-10-21T10:00:00.000Z', status: 'rejected' },
  ];
  assert.equal(countNewInboxCandidates(records, reviews), 0);
});

test('countNewInboxCandidates: no records is a real 0, and malformed input never throws', () => {
  assert.equal(countNewInboxCandidates([], []), 0);
  assert.equal(countNewInboxCandidates(null, null), 0);
  assert.equal(countNewInboxCandidates([null, {}], null), 0);
});

// ─── Combined workspace sum ────────────────────────────────────────────

test('sumAvailableCounts: adds every part, but never returns a partial total', () => {
  assert.equal(sumAvailableCounts([2, 3]), 5);
  assert.equal(sumAvailableCounts([0, 0]), 0);
  assert.equal(sumAvailableCounts([2, null]), null);
  assert.equal(sumAvailableCounts([2, undefined]), null);
  assert.equal(sumAvailableCounts([2, -1]), null);
  assert.equal(sumAvailableCounts([2, '3']), null);
  assert.equal(sumAvailableCounts([]), null);
  assert.equal(sumAvailableCounts(null), null);
});


// ─── Handler: authentication, role scoping, real numbers or null ───────

function createFakeSupabase(tables) {
  const calls = [];
  function from(table) {
    calls.push(table);
    const spec = Object.prototype.hasOwnProperty.call(tables || {}, table) ? tables[table] : { rows: [], count: 0 };
    let mode = 'rows';
    const builder = {
      select(columns, options) {
        if (options && options.head) mode = 'count';
        return builder;
      },
      eq() {
        return builder;
      },
      in() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(resolve) {
        if (spec.error) {
          resolve({ data: null, count: null, error: spec.error });
          return;
        }
        resolve(
          mode === 'count'
            ? { data: null, count: spec.count === undefined ? 0 : spec.count, error: null }
            : { data: spec.rows || [], count: null, error: null },
        );
      },
    };
    return builder;
  }
  return { client: { from }, calls };
}

function handlerFor(roles, tables, options = {}) {
  const fake = createFakeSupabase(tables);
  const state = { queried: false };
  const handlers = createWorkqueueCountsHandlers({
    authenticate: async () => {
      if (options.authFailure) return options.authFailure;
      return { ok: true, userId: 'fixture-user', roles };
    },
    getSupabase: () => {
      state.queried = true;
      return fake.client;
    },
  });
  return { handlers, fake, state };
}

test('handler: an unauthenticated request is refused and never reaches the database', async () => {
  const { handlers, state } = handlerFor([], {}, { authFailure: { ok: false, status: 401, error: 'Niet ingelogd.' } });
  const result = await handlers.getCounts({});
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'Niet ingelogd.');
  assert.equal(state.queried, false, 'no Supabase client may be created before authorization');
});

test('handler: an account without an internal or editor role is refused and never reaches the database', async () => {
  for (const roles of [[], [{ role: 'owner', restaurant_id: '9001' }], [{ role: 'something-else' }]]) {
    const { handlers, state } = handlerFor(roles, {});
    const result = await handlers.getCounts({});
    assert.equal(result.status, 403);
    assert.equal(state.queried, false);
  }
});

test('handler: an internal account gets the three internal counts and never triggers the editor-only moderation queries', async () => {
  const { handlers, fake } = handlerFor([{ role: 'internal' }], {
    menu_snapshot_proposals: {
      rows: [
        { id: 1, restaurant_id: '9001', menu_context: '9001-lunch', version: 1 },
        { id: 2, restaurant_id: '9002', menu_context: '9002-lunch', version: 1 },
      ],
    },
    menu_snapshot_reviews: { rows: [{ id: 1, snapshot_id: 2, decided_at: '2026-10-20T10:00:00.000Z', decision: 'approved_internal' }] },
    source_triage_proposals: { count: 4 },
    import_extraction_records: { rows: [{ id: 'c-1' }, { id: 'c-2' }] },
    import_candidate_reviews: { rows: [{ id: 'r1', candidate_id: 'c-1', decided_at: '2026-10-20T10:00:00.000Z', status: 'needs_enrichment' }] },
    pending_changes: { count: 7 },
    restaurant_claims: { count: 7 },
  });

  const result = await handlers.getCounts({});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.counts, { 'menu-concepts': 1, 'source-triage': 4, 'import-inbox': 1 });
  assert.ok(!fake.calls.includes('pending_changes'));
  assert.ok(!fake.calls.includes('restaurant_claims'));
});

test('handler: an editor-only account gets the moderation count only — the two queues of that one page, added', async () => {
  const { handlers, fake } = handlerFor([{ role: 'editor' }], {
    pending_changes: { count: 2 },
    restaurant_claims: { count: 3 },
    menu_snapshot_proposals: { rows: [] },
  });
  const result = await handlers.getCounts({});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.counts, { moderation: 5 });
  assert.deepEqual(fake.calls.sort(), ['pending_changes', 'restaurant_claims']);
});

test('handler: an internal + editor account gets every visible count, including moderation', async () => {
  const { handlers } = handlerFor([{ role: 'internal' }, { role: 'editor' }], {
    menu_snapshot_proposals: { rows: [] },
    source_triage_proposals: { count: 0 },
    import_extraction_records: { rows: [] },
    import_candidate_reviews: { rows: [] },
    pending_changes: { count: 1 },
    restaurant_claims: { count: 0 },
  });
  const result = await handlers.getCounts({});
  assert.deepEqual(result.body.counts, { 'menu-concepts': 0, 'source-triage': 0, 'import-inbox': 0, moderation: 1 });
});

test('handler: a failing count is null while the other counts stay real — never a silent 0', async () => {
  const { handlers } = handlerFor([{ role: 'internal' }], {
    menu_snapshot_proposals: { error: { message: 'boom' } },
    source_triage_proposals: { count: 4 },
    import_extraction_records: { rows: [{ id: 'c-1' }] },
    import_candidate_reviews: { rows: [] },
  });
  const result = await handlers.getCounts({});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.counts, { 'menu-concepts': null, 'source-triage': 4, 'import-inbox': 1 });
});

test('handler: a failed review lookup also makes its own count null, never 0', async () => {
  const { handlers } = handlerFor([{ role: 'internal' }], {
    menu_snapshot_proposals: { rows: [{ id: 1, restaurant_id: '9001', menu_context: '9001-lunch', version: 1 }] },
    menu_snapshot_reviews: { error: { message: 'boom' } },
    source_triage_proposals: { count: 0 },
    import_extraction_records: { error: { message: 'boom' } },
    import_candidate_reviews: { rows: [] },
  });
  const result = await handlers.getCounts({});
  assert.equal(result.body.counts['menu-concepts'], null);
  assert.equal(result.body.counts['import-inbox'], null);
  assert.equal(result.body.counts['source-triage'], 0);
});

test('handler: one failing moderation queue means no moderation number at all, not a partial sum', async () => {
  const { handlers } = handlerFor([{ role: 'editor' }], {
    pending_changes: { count: 2 },
    restaurant_claims: { error: { message: 'boom' } },
  });
  const result = await handlers.getCounts({});
  assert.equal(result.body.counts.moderation, null);
});

test('handler: never writes, never calls an RPC, and never fetches anything itself', () => {
  const source = fs.readFileSync(path.join(__dirname, 'workqueueCountsHandlers.js'), 'utf8');
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  assert.doesNotMatch(source, /fetch\(|https?:\/\//);
});

// ─── Structural safety net: the route itself ───────────────────────────

test('structural safety net: GET /api/internal/v1/workqueue-counts reuses authenticateInternalRequest and exposes GET only', () => {
  const source = fs.readFileSync(ROUTE_PATH, 'utf8');
  assert.match(source, /import \{ authenticateInternalRequest \} from '@\/src\/lib\/internalAuth'/);
  assert.match(source, /authenticate: authenticateInternalRequest/);
  assert.match(source, /export async function GET\(request\)/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /\.from\(['"]/, 'the route must not query a table itself — the tested handler does that');
  assert.match(source, /export const dynamic = 'force-dynamic'/);
});

// --- The cheaper count-route variant: reviewed candidate ids only ---

test('countCandidatesWithoutReview: a candidate counts once and only when no review row exists at all', () => {
  const records = [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }];
  const reviews = [{ candidate_id: 'c-1' }, { candidate_id: 'c-1' }, { candidate_id: 'c-3' }];
  assert.equal(countCandidatesWithoutReview(records, reviews), 1);
  assert.equal(countCandidatesWithoutReview([{ id: 'c-1' }], []), 1);
  assert.equal(countCandidatesWithoutReview(records, [{ candidate_id: 'c-unknown' }]), 3);
  assert.equal(countCandidatesWithoutReview([], []), 0);
  assert.equal(countCandidatesWithoutReview(null, null), 0);
});

test('handler: an empty inbox is a real 0 and triggers no review query at all', async () => {
  const { handlers, fake } = handlerFor([{ role: 'internal' }], {
    menu_snapshot_proposals: { rows: [] },
    source_triage_proposals: { count: 0 },
    import_extraction_records: { rows: [] },
  });
  const result = await handlers.getCounts({});
  assert.equal(result.body.counts['import-inbox'], 0);
  assert.ok(!fake.calls.includes('import_candidate_reviews'), 'no review query for an empty inbox');
});

test('handler: the inbox count only selects reviewed candidate ids, never every review row', () => {
  const source = fs.readFileSync(path.join(__dirname, 'workqueueCountsHandlers.js'), 'utf8');
  assert.match(source, /\.from\('import_candidate_reviews'\)\s*\.select\('candidate_id'\)/);
  assert.doesNotMatch(source, /\.from\('import_candidate_reviews'\)\s*\.select\('id, candidate_id/);
});
