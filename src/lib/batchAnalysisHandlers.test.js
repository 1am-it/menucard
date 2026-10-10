'use strict';

// BE-25 fase 2 — Batchanalyse handlers, tested behaviourally with an
// injected fake Supabase client: authorization before any database call,
// enqueue error mapping, one-job processing, starter-only confirmation, and
// colleagues never learning who started a batch.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBatchAnalysisHandlers } = require('./batchAnalysisHandlers');

const STARTER = '11111111-1111-4111-8111-111111111111';
const COLLEAGUE = '22222222-2222-4222-8222-222222222222';
const BATCH = '0192f000-0000-7000-8000-000000000001';
const JOB = '0192f000-0000-7000-8000-0000000000a1';
const RESTAURANTS = {
  bistro: { name: 'Bistro Fictief', website: 'https://www.bistro-fictief-voorbeeld.nl' },
};

/** A small fake of the supabase-js query builder over in-memory tables. */
function fakeSupabase({ tables = {}, rpc = {} } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const state = { table, filters: [], op: 'select', head: false, count: false };
      const rows = () => (tables[table] || []).filter((r) => state.filters.every((f) => f(r)));
      const builder = {
        select(_cols, opts) {
          if (opts && opts.head) state.head = true;
          if (opts && opts.count) state.count = true;
          return builder;
        },
        insert(row) {
          calls.push({ insert: table, row });
          (tables[table] = tables[table] || []).push(row);
          return Promise.resolve({ error: null });
        },
        eq(col, val) {
          state.filters.push((r) => r[col] === val);
          return builder;
        },
        in(col, vals) {
          state.filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        not(col, _op, _val) {
          state.filters.push((r) => r[col] !== null && r[col] !== undefined);
          return builder;
        },
        gte(col, val) {
          state.filters.push((r) => r[col] >= val);
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
        then(resolve) {
          calls.push({ select: table });
          const data = rows();
          return resolve(state.count ? { count: data.length, data: state.head ? null : data, error: null } : { data, error: null });
        },
      };
      return builder;
    },
    rpc(name, args) {
      calls.push({ rpc: name, args });
      const handler = rpc[name];
      return Promise.resolve(handler ? handler(args) : { data: null, error: { code: 'XX000' } });
    },
  };
  return client;
}

function makeHandlers({ userId = STARTER, roles = [{ role: 'internal' }], supabase, analyze } = {}) {
  let created = 0;
  const client = supabase || fakeSupabase();
  const handlers = createBatchAnalysisHandlers({
    authenticate: async () => ({ ok: true, userId, roles }),
    getSupabase: () => {
      created += 1;
      return client;
    },
    restaurants: RESTAURANTS,
    generateId: () => '0192f000-0000-7000-8000-0000000000ff',
    analyze: analyze || (async () => ({ ok: false, errorReason: 'fetch_failed' })),
    computeHash: () => 'a'.repeat(64),
    now: () => new Date('2026-10-10T12:00:00Z'),
  });
  return { handlers, client, created: () => created };
}

const request = (body) => ({ json: async () => body });

test('every handler refuses a missing session, editor or owner with 401/403 and makes no database call', async () => {
  const cases = [
    { auth: { ok: false, status: 401, error: 'Missing bearer token' }, status: 401 },
    { auth: { ok: true, userId: STARTER, roles: [{ role: 'editor' }] }, status: 403 },
    { auth: { ok: true, userId: STARTER, roles: [{ role: 'owner', restaurant_id: 'bistro' }] }, status: 403 },
  ];
  for (const c of cases) {
    let dbCalls = 0;
    const handlers = createBatchAnalysisHandlers({
      authenticate: async () => c.auth,
      getSupabase: () => {
        dbCalls += 1;
        return fakeSupabase();
      },
      restaurants: RESTAURANTS,
      generateId: () => 'x',
      analyze: async () => {
        throw new Error('never');
      },
      computeHash: () => 'x',
    });
    for (const call of [
      () => handlers.getOverview(request(), null),
      () => handlers.createBatch(request({ batch_id: BATCH, urls: ['https://a.nl'] })),
      () => handlers.processNext(request(), BATCH),
      () => handlers.confirmSources(request({ job_ids: [JOB] }), BATCH),
    ]) {
      const res = await call();
      assert.equal(res.status, c.status);
    }
    assert.equal(dbCalls, 0);
  }
});

test('create: 1-10 lines, canonicalised server-side (invalid → null), enqueue with the session actor, error codes mapped', async () => {
  let args;
  const supabase = fakeSupabase({
    tables: { markets: [{ id: 'm1', slug: 'breda' }] },
    rpc: {
      enqueue_source_analysis_batch: (a) => {
        args = a;
        return { data: { id: a.p_batch_id }, error: null };
      },
    },
  });
  const { handlers } = makeHandlers({ supabase });
  const ok = await handlers.createBatch(request({ batch_id: BATCH, urls: ['https://a.nl/menu?x=1', 'geen url', 'https://b.nl'], actor: COLLEAGUE }));
  assert.equal(ok.status, 201);
  assert.deepEqual(args.p_urls, ['https://a.nl/menu', null, 'https://b.nl/']);
  assert.equal(args.p_actor_user_id, STARTER);
  assert.equal(args.p_market_id, 'm1');

  assert.equal((await handlers.createBatch(request({ batch_id: BATCH, urls: Array(11).fill('https://a.nl') }))).status, 400);
  assert.equal((await handlers.createBatch(request({ batch_id: 'nope', urls: ['https://a.nl'] }))).status, 400);

  for (const [code, status, reason] of [['P0040', 409, 'other_actor'], ['P0042', 429, 'daily_limit'], ['P0043', 409, 'open_batch']]) {
    const failing = fakeSupabase({ tables: { markets: [{ id: 'm1', slug: 'breda' }] }, rpc: { enqueue_source_analysis_batch: () => ({ data: null, error: { code } }) } });
    const res = await makeHandlers({ supabase: failing }).handlers.createBatch(request({ batch_id: BATCH, urls: ['https://a.nl'] }));
    assert.equal(res.status, status);
    assert.equal(res.body.reason, reason);
  }
});

test('process: a non-starter is refused by the claim (P0044) and nothing is analysed', async () => {
  let analysed = false;
  const supabase = fakeSupabase({ rpc: { claim_next_source_analysis_job: () => ({ data: null, error: { code: 'P0044' } }) } });
  const { handlers } = makeHandlers({ userId: COLLEAGUE, supabase, analyze: async () => (analysed = true) });
  const res = await handlers.processNext(request(), BATCH);
  assert.equal(res.status, 403);
  assert.equal(analysed, false);
});

test('process: waiting/busy/done are passed through without analysing', async () => {
  for (const outcome of ['waiting', 'busy', 'done']) {
    let analysed = false;
    const supabase = fakeSupabase({ rpc: { claim_next_source_analysis_job: () => ({ data: [{ claimed_job_id: null, claim_outcome: outcome, retry_at: '2026-10-10T12:01:00Z' }], error: null }) } });
    const res = await makeHandlers({ supabase, analyze: async () => (analysed = true) }).handlers.processNext(request(), BATCH);
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, outcome);
    assert.equal(analysed, false);
  }
});

test('process: one claimed job is analysed once; success writes a receipt bound to the job URL and completes with menu sources', async () => {
  const job = { id: JOB, market_id: 'm1', actor_user_id: STARTER, canonical_source_url: 'https://www.bistro-fictief-voorbeeld.nl/' };
  let completeArgs;
  const supabase = fakeSupabase({
    tables: { restaurant_source_analysis_jobs: [job] },
    rpc: {
      claim_next_source_analysis_job: () => ({ data: [{ claimed_job_id: JOB, claim_outcome: 'claimed' }], error: null }),
      complete_source_analysis_job: (a) => {
        completeArgs = a;
        return { data: {}, error: null };
      },
    },
  });
  let analysedUrl;
  const analyze = async (url) => {
    analysedUrl = url;
    return {
      ok: true,
      finalUrl: 'https://www.bistro-fictief-voorbeeld.nl/',
      analysis: {
        restaurantCandidateFields: {},
        fieldEvidence: {},
        menuContexts: [{ sourceUrl: 'https://www.bistro-fictief-voorbeeld.nl/menukaart', categories: [{ name: 'Voor', items: [{ name: 'Soep' }] }] }],
        unknownMenuContexts: [],
        description: '',
        notes: [],
      },
    };
  };
  const res = await makeHandlers({ supabase, analyze }).handlers.processNext(request(), BATCH);
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'claimed');
  assert.equal(analysedUrl, job.canonical_source_url);
  const receipt = supabase.calls.find((c) => c.insert === 'url_intake_analysis_receipts').row;
  assert.equal(receipt.canonical_source_url, job.canonical_source_url);
  assert.equal(receipt.actor_user_id, STARTER);
  assert.equal(receipt.restaurant_match_type, 'exact');
  assert.equal(receipt.matched_restaurant_id, 'bistro');
  assert.equal(completeArgs.p_receipt_id, receipt.id);
  assert.deepEqual(completeArgs.p_field_evidence.menu_source_urls, ['https://www.bistro-fictief-voorbeeld.nl/menukaart']);
  assert.equal(supabase.calls.filter((c) => c.rpc === 'fail_source_analysis_job').length, 0);
});

test('process: a failed analysis is recorded through fail_source_analysis_job with its closed reason (retries happen in the database)', async () => {
  const job = { id: JOB, market_id: 'm1', actor_user_id: STARTER, canonical_source_url: 'https://a.nl/' };
  let failArgs;
  const supabase = fakeSupabase({
    tables: { restaurant_source_analysis_jobs: [job] },
    rpc: {
      claim_next_source_analysis_job: () => ({ data: [{ claimed_job_id: JOB, claim_outcome: 'claimed' }], error: null }),
      fail_source_analysis_job: (a) => {
        failArgs = a;
        return { data: {}, error: null };
      },
    },
  });
  await makeHandlers({ supabase, analyze: async () => ({ ok: false, errorReason: 'robots_disallowed' }) }).handlers.processNext(request(), BATCH);
  assert.equal(failArgs.p_error_reason, 'robots_disallowed');
  await makeHandlers({
    supabase,
    analyze: async () => {
      throw new Error('boom');
    },
  }).handlers.processNext(request(), BATCH);
  assert.equal(failArgs.p_error_reason, 'internal_error');
});

function confirmFixture({ actor = STARTER, menuUrl = 'https://www.bistro-fictief-voorbeeld.nl/menukaart' } = {}) {
  return fakeSupabase({
    tables: {
      markets: [{ id: 'm1', slug: 'breda' }],
      url_intake_batches: [{ id: BATCH, market_id: 'm1', actor_user_id: actor, created_at: '2026-10-10T11:00:00Z', closed_at: '2026-10-10T11:10:00Z', close_reason: 'completed', item_count: 1 }],
      url_intake_batch_items: [{ batch_id: BATCH, item_position: 1, canonical_source_url: 'https://www.bistro-fictief-voorbeeld.nl/', outcome: 'queued', job_id: JOB, reused_job_id: null }],
      restaurant_source_analysis_jobs: [
        { id: JOB, status: 'succeeded', attempt_count: 1, finished_at: '2026-10-10T11:05:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: [menuUrl], actor_user_id: actor, batch_id: BATCH, created_at: '2026-10-10T11:00:00Z' },
      ],
      url_intake_analysis_receipts: [{ id: 'r1', restaurant_match_type: 'exact', matched_restaurant_id: 'bistro', menus: [{ categories: [{ items: [{ name: 'Soep' }] }] }] }],
      source_triage_proposals: [],
    },
    rpc: {
      create_source_triage_proposal: (a) => ({ data: { id: a.p_proposal_id, status: 'open' }, error: null }),
      decide_source_triage_proposal: () => ({ data: { status: 'accepted' }, error: null }),
    },
  });
}

test('confirm: the starter confirms a high-certainty result as one accepted BE-24 proposal (add_candidate), nothing else is written', async () => {
  const supabase = confirmFixture();
  const res = await makeHandlers({ supabase }).handlers.confirmSources(request({ job_ids: [JOB] }), BATCH);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [{ job_id: JOB, ok: true }]);
  const create = supabase.calls.find((c) => c.rpc === 'create_source_triage_proposal').args;
  assert.equal(create.p_kind, 'add_candidate');
  assert.equal(create.p_restaurant_id, 'bistro');
  assert.equal(create.p_proposed_url, 'https://www.bistro-fictief-voorbeeld.nl/menukaart');
  assert.equal(create.p_actor_user_id, STARTER);
  assert.equal(supabase.calls.find((c) => c.rpc === 'decide_source_triage_proposal').args.p_decision, 'accepted');
  const writes = supabase.calls.filter((c) => c.insert || (c.rpc && !['create_source_triage_proposal', 'decide_source_triage_proposal'].includes(c.rpc)));
  assert.deepEqual(writes, []);
});

test('confirm: a colleague is refused; a result without high certainty is never confirmed', async () => {
  const supabase = confirmFixture();
  const refused = await makeHandlers({ userId: COLLEAGUE, supabase }).handlers.confirmSources(request({ job_ids: [JOB] }), BATCH);
  assert.equal(refused.status, 403);
  assert.equal(supabase.calls.filter((c) => c.rpc).length, 0);

  const doubtful = confirmFixture({ menuUrl: 'https://elders-fictief.nl/menu' });
  const res = await makeHandlers({ supabase: doubtful }).handlers.confirmSources(request({ job_ids: [JOB] }), BATCH);
  assert.deepEqual(res.body.results, [{ job_id: JOB, ok: false, reason: 'not_eligible' }]);
  assert.equal(doubtful.calls.filter((c) => c.rpc).length, 0);
});

test('overview: a colleague sees the batch read-only, without the starter\'s identity', async () => {
  const supabase = confirmFixture();
  const res = await makeHandlers({ userId: COLLEAGUE, supabase }).handlers.getOverview(request(), BATCH);
  assert.equal(res.status, 200);
  assert.equal(res.body.detail.batch.is_starter, false);
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(STARTER));
  assert.equal(res.body.recent_batches[0].is_own, false);
  const own = await makeHandlers({ userId: STARTER, supabase }).handlers.getOverview(request(), BATCH);
  assert.equal(own.body.detail.batch.is_starter, true);
  assert.equal(own.body.detail.items[0].label, 'Menukaart gevonden · controle nodig');
});
