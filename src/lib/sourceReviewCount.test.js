'use strict';

// BE-31 (#74) — the Werkvoorraad number of "Bronnen beoordelen" must be the
// number of tasks the screen shows. These tests feed the counter with fictional
// bodies of the existing read handlers; no Supabase, no network.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createSourceReviewCounter, BATCH_DETAIL_LIMIT } = require('./sourceReviewCount');
const { createWorkqueueCountsHandlers } = require('./workqueueCountsHandlers');

function triage(entries) {
  return { restaurants: entries, proposals_available: true };
}

function entry(overrides) {
  return {
    restaurant_id: 'r-1',
    name: 'Restaurant Een',
    domain: 'een.nl',
    known_url: 'https://een.nl',
    not_in_queue_reason: null,
    open_proposal_id: null,
    next_step: 'check_via_onboarding',
    attention: null,
    ...overrides,
  };
}

function detail(id, items) {
  return {
    batch: { id, closed_at: '2026-10-27T10:00:00.000Z', is_starter: true, item_count: items.length },
    items,
    summary: { total: items.length },
  };
}

function item(overrides) {
  return {
    key: 'menu_found',
    position: 1,
    url: 'https://een.nl/menu',
    jobId: 'job-1',
    restaurant: { id: 'r-1', name: 'Restaurant Een' },
    actions: ['confirm'],
    ...overrides,
  };
}

test('counter: the same tasks as the screen — proposals, attention and open batch results', async () => {
  const counter = createSourceReviewCounter({
    getTriage: async () =>
      triage([
        entry({ restaurant_id: 'a', open_proposal_id: 'p1', next_step: 'review_proposal' }),
        entry({ restaurant_id: 'b', next_step: 'add_candidate' }),
        entry({ restaurant_id: 'c', not_in_queue_reason: 'never_checked' }),
        entry({ restaurant_id: 'd', next_step: 'check_via_onboarding' }),
      ]),
    getBatchOverview: async (id) => {
      if (!id) return { recent_batches: [{ id: 'batch-1' }, { id: 'batch-2' }] };
      if (id === 'batch-1') return { daily: { used: 1, limit: 25 }, detail: detail(id, [item({ key: 'confirmed', actions: [] }), item({ position: 2 })]) };
      return { detail: detail(id, [item({ key: 'confirmed', actions: [] })]) };
    },
  });
  assert.equal(await counter(), 3);
});

test('counter: a fully confirmed batch adds no task', async () => {
  const counter = createSourceReviewCounter({
    getTriage: async () => triage([entry({ restaurant_id: 'a', open_proposal_id: 'p1', next_step: 'review_proposal' })]),
    getBatchOverview: async (id) =>
      id ? { detail: detail(id, [item({ key: 'confirmed', actions: [] })]) } : { recent_batches: [{ id: 'batch-1' }] },
  });
  assert.equal(await counter(), 1);
});

test('counter: no tasks at all is a real 0, never null', async () => {
  const counter = createSourceReviewCounter({
    getTriage: async () => triage([entry({ restaurant_id: 'c', not_in_queue_reason: 'never_checked' })]),
    getBatchOverview: async () => ({ recent_batches: [] }),
  });
  assert.equal(await counter(), 0);
});

test('counter: a failed read is unknown (null), never a partial number', async () => {
  const failedTriage = createSourceReviewCounter({
    getTriage: async () => {
      throw new Error('boom');
    },
    getBatchOverview: async () => ({ recent_batches: [] }),
  });
  assert.equal(await failedTriage(), null);

  const failedOverview = createSourceReviewCounter({
    getTriage: async () => triage([]),
    getBatchOverview: async () => null,
  });
  // An unusable overview body means the recent batches are unknown.
  assert.equal(await failedOverview(), 0, 'no batches listed is the honest answer here');

  const failedDetail = createSourceReviewCounter({
    getTriage: async () => triage([]),
    getBatchOverview: async (id) => {
      if (!id) return { recent_batches: [{ id: 'batch-1' }] };
      throw new Error('detail');
    },
  });
  assert.equal(await failedDetail(), null, 'one unreadable batch makes the total unknown');
});

test('counter: the batch bound is the same as the screen', () => {
  assert.equal(BATCH_DETAIL_LIMIT, 10);
});

test('counts handler: the Bronnen number comes from the shared task counter', async () => {
  const calls = [];
  // The other sections still run their own (unchanged) queries; this stub keeps
  // them honest without Supabase.
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    then(resolve) {
      resolve({ data: [], error: null, count: 0 });
    },
  };
  const handlers = createWorkqueueCountsHandlers({
    authenticate: async () => ({ ok: true, status: 200, userId: 'u', roles: [{ role: 'internal' }] }),
    getSupabase: () => ({ from: () => query }),
    sourceReviewCount: async (request) => {
      calls.push(Boolean(request));
      return 4;
    },
  });
  const result = await handlers.getCounts({});
  assert.equal(result.status, 200);
  assert.equal(result.body.counts['source-triage'], 4);
  assert.deepEqual(calls, [true]);
});
