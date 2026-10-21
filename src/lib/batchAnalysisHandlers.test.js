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
          const rows = Array.isArray(row) ? row : [row];
          const stored = rows.map((entry) => ({ id: (tables[table] || []).length + 100, ...entry }));
          (tables[table] = tables[table] || []).push(...stored);
          const result = { error: null };
          return {
            select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: stored[0] ? stored[0].id : null }, error: null }) }),
            then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
          };
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

function makeHandlers({ userId = STARTER, roles = [{ role: 'internal' }], supabase, analyze, liveMenus } = {}) {
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
    computeMenuHash: (content) => require('node:crypto').createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    liveMenus: liveMenus || {},
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
      () => handlers.reanalyze(request({ batch_id: BATCH, url: 'https://a.nl' })),
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

test('service worker entry uses the same claim path without a browser request', async () => {
  const supabase = fakeSupabase({
    rpc: { claim_next_source_analysis_job: () => ({ data: [{ claimed_job_id: null, claim_outcome: 'done' }], error: null }) },
  });
  const { handlers } = makeHandlers({ supabase });
  const res = await handlers.processForWorker(BATCH, STARTER);
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'done');
  assert.equal(supabase.calls.filter((c) => c.rpc === 'claim_next_source_analysis_job').length, 1);
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

test('reanalyze ("Opnieuw analyseren"): one canonical URL through enqueue_source_reanalysis with the session actor — never the 7-day-reuse enqueue', async () => {
  let args;
  const supabase = fakeSupabase({
    tables: { markets: [{ id: 'm1', slug: 'breda' }] },
    rpc: {
      enqueue_source_reanalysis: (a) => {
        args = a;
        return { data: { id: a.p_batch_id }, error: null };
      },
    },
  });
  const { handlers } = makeHandlers({ supabase });
  const res = await handlers.reanalyze(request({ batch_id: BATCH, url: 'https://a.nl/menu?x=1', actor: COLLEAGUE }));
  assert.equal(res.status, 201);
  assert.deepEqual(args, { p_batch_id: BATCH, p_market_id: 'm1', p_actor_user_id: STARTER, p_url: 'https://a.nl/menu' });
  assert.equal(supabase.calls.filter((c) => c.rpc === 'enqueue_source_analysis_batch').length, 0);
  assert.equal((await handlers.reanalyze(request({ batch_id: BATCH, url: 'geen url' }))).status, 400);
  assert.equal((await handlers.reanalyze(request({ batch_id: 'nope', url: 'https://a.nl' }))).status, 400);
});

test('reanalyze keeps the daily limit, one-open-batch and actor rules (database codes mapped)', async () => {
  for (const [code, status, reason] of [['P0040', 409, 'other_actor'], ['P0042', 429, 'daily_limit'], ['P0043', 409, 'open_batch'], ['P0050', 400, 'invalid_url']]) {
    const failing = fakeSupabase({ tables: { markets: [{ id: 'm1', slug: 'breda' }] }, rpc: { enqueue_source_reanalysis: () => ({ data: null, error: { code } }) } });
    const res = await makeHandlers({ supabase: failing }).handlers.reanalyze(request({ batch_id: BATCH, url: 'https://a.nl' }));
    assert.equal(res.status, status);
    assert.equal(res.body.reason, reason);
  }
});

test('after a re-analysis the URL is a fresh queued job, not "Recent geanalyseerd" again', async () => {
  const supabase = fakeSupabase({
    tables: {
      markets: [{ id: 'm1', slug: 'breda' }],
      url_intake_batches: [{ id: BATCH, market_id: 'm1', actor_user_id: STARTER, created_at: '2026-10-13T12:00:00Z', closed_at: null, close_reason: null, item_count: 1 }],
      url_intake_batch_items: [{ batch_id: BATCH, item_position: 1, canonical_source_url: 'https://a.nl/', outcome: 'queued', job_id: JOB, reused_job_id: null }],
      restaurant_source_analysis_jobs: [{ id: JOB, status: 'pending', attempt_count: 1, actor_user_id: STARTER, batch_id: BATCH, created_at: '2026-10-13T12:00:00Z' }],
    },
  });
  const res = await makeHandlers({ supabase }).handlers.getOverview(request(), BATCH);
  const item = res.body.detail.items[0];
  assert.equal(item.label, 'In wachtrij');
  assert.notEqual(item.label, 'Recent geanalyseerd');
});

// ─── Menukaartcontrole → concept ───────────────────────────────────────

const FOUND = 'https://www.bistro-fictief-voorbeeld.nl/menukaart';
const CONCEPT_MENUS = [{ categories: [{ name: 'Koud', items: [{ name: 'Fictieve soep', price: '7.50' }, { name: 'Fictieve salade', price: '12.50' }, { name: 'Fictief tartaar', price: null }] }] }];

function conceptFixture({ actor = STARTER, existing = [], menus = CONCEPT_MENUS, receiptProduct = null } = {}) {
  // A confirmed source (accepted BE-24 proposal for the found URL) with a recognised menu.
  return fakeSupabase({
    tables: {
      markets: [{ id: 'm1', slug: 'breda' }],
      url_intake_batches: [{ id: BATCH, market_id: 'm1', actor_user_id: actor, created_at: '2026-10-10T11:00:00Z', closed_at: '2026-10-10T11:10:00Z', close_reason: 'completed', item_count: 1 }],
      url_intake_batch_items: [{ batch_id: BATCH, item_position: 1, canonical_source_url: 'https://www.bistro-fictief-voorbeeld.nl/', outcome: 'queued', job_id: JOB, reused_job_id: null }],
      restaurant_source_analysis_jobs: [{ id: JOB, status: 'succeeded', attempt_count: 1, finished_at: '2026-10-10T11:05:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: [FOUND], actor_user_id: actor, batch_id: BATCH, created_at: '2026-10-10T11:00:00Z' }],
      url_intake_analysis_receipts: [{ id: 'r1', restaurant_match_type: 'exact', matched_restaurant_id: 'bistro', menus, product: receiptProduct }],
      source_triage_proposals: [{ id: 'p1', restaurant_id: 'bistro', proposed_url: FOUND, status: 'accepted', decided_at: '2026-10-10T11:20:00Z' }],
      menu_snapshot_proposals: existing,
    },
  });
}

const LIVE_BISTRO = { 'bistro-diner': { categories: [{ name: 'Koud', items: [{ name: 'Fictieve soep', priceValue: 7.5 }, { name: 'Fictieve mousse', priceValue: 8 }] }] } };

test('overview: a confirmed source carries its concept data (recognised dishes, current menu, latest version)', async () => {
  const res = await makeHandlers({ supabase: conceptFixture(), liveMenus: LIVE_BISTRO }).handlers.getOverview(request(), BATCH);
  const item = res.body.detail.items[0];
  assert.equal(item.label, 'Bron bevestigd');
  assert.equal(item.text, 'Bevestigd om 13:20 na menselijke controle. Er is niets gepubliceerd.');
  assert.equal(item.menu.itemCount, 3);
  assert.deepEqual(item.concept.menus, CONCEPT_MENUS);
  assert.deepEqual(item.concept.liveLines.map((l) => l.name), ['Fictieve soep', 'Fictieve mousse']);
  assert.equal(item.concept.latest, null);
});

test('concept: blockers are refused server-side and nothing is written', async () => {
  const supabase = conceptFixture();
  const res = await makeHandlers({ supabase, liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'blockers');
  assert.deepEqual(res.body.blockers.map((b) => b.status).sort(), ['missing_price', 'removed']);
  assert.equal(supabase.calls.filter((c) => c.insert).length, 0);
});

test('concept: once resolved, it is saved as an internal BE-17 proposal (next version, own context) — never published', async () => {
  const supabase = conceptFixture({ existing: [{ id: 1, restaurant_id: 'bistro', menu_context: 'bistro-menukaart', version: 2, content_hash: 'b'.repeat(64) }] });
  const edits = { lines: { '0.0.2': { price: '15,5' } }, removed: 'keep' };
  const res = await makeHandlers({ supabase, liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits }), BATCH);
  assert.equal(res.status, 201);
  assert.equal(res.body.concept.version, 3);
  assert.equal(res.body.concept.unchanged, false);
  const inserts = supabase.calls.filter((c) => c.insert);
  assert.deepEqual(inserts.map((c) => c.insert), ['menu_snapshot_proposals']);
  const row = inserts[0].row;
  assert.equal(row.restaurant_id, 'bistro');
  assert.equal(row.menu_context, 'bistro-menukaart');
  assert.equal(row.source_url, FOUND);
  assert.equal(row.source_type, 'own_website');
  // Audit (0018): maker, analysis result, and no base version for a fresh concept from the analysis.
  assert.equal(row.created_by, STARTER);
  assert.equal(row.origin_receipt_id, 'r1');
  assert.equal(row.based_on_snapshot_id, null);
  assert.deepEqual(row.captured_content.categories[0].items.map((i) => i.from), ['0.0.0', '0.0.1', '0.0.2', undefined]);
  assert.deepEqual(row.captured_content.categories[0].items.map((i) => `${i.name} ${i.price}`), ['Fictieve soep 7.50', 'Fictieve salade 12.50', 'Fictief tartaar 15.50', 'Fictieve mousse 8.00']);
  assert.equal(supabase.calls.filter((c) => c.rpc).length, 0);
});

test('REGRESSION: server-side concept save keeps duplicate blockers after group category acceptance', async () => {
  const menus = [
    {
      categories: [
        { name: 'Warm', uncertain: true, items: [{ name: 'Fictieve soep', price: '6.50' }, { name: 'Fictieve soep', price: '6.50' }] },
      ],
    },
  ];
  const supabase = conceptFixture({ menus });
  const res = await makeHandlers({ supabase, liveMenus: {} }).handlers.saveConcept(
    request({ job_id: JOB, edits: { lines: { '0.0.0': { acceptCategory: true }, '0.0.1': { acceptCategory: true } } } }),
    BATCH
  );
  assert.equal(res.status, 409);
  assert.deepEqual(res.body.blockers.map((b) => b.status), ['duplicate', 'duplicate']);
  assert.equal(supabase.calls.filter((c) => c.insert).length, 0);
});

test('concept: the server re-checks every blocker itself and ignores what the browser claims; a price change does not block', async () => {
  const menus = [
    {
      categories: [
        { name: 'Koud', items: [{ name: 'Fictieve soep', price: '8.50' }, { name: 'Fictieve salade', price: '12.50' }, { name: 'Fictief tartaar', price: null }] },
        { name: 'Overig', items: [{ name: 'Fictieve salade', price: '13.00' }, { name: 'Fictief kaasplankje', price: '11.00' }] },
      ],
    },
  ];
  const forged = { canSave: true, blockers: [], lines: { '0.0.2': { accept: true, price: 'gratis', canSave: true } }, removed: 'nonsense' };
  const supabase = conceptFixture({ menus });
  const refused = await makeHandlers({ supabase, liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits: forged }), BATCH);
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body.blockers.map((b) => b.status).sort(), ['duplicate', 'missing_price', 'removed', 'unclear_category', 'unclear_category']);
  assert.equal(supabase.calls.filter((c) => c.insert).length, 0);

  const resolved = { lines: { '0.0.2': { price: '15,50' }, '0.1.0': { exclude: true }, '0.1.1': { category: 'Kaas' } }, removed: 'remove' };
  const saved = await makeHandlers({ supabase, liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits: resolved }), BATCH);
  assert.equal(saved.status, 201);
  const items = supabase.calls.find((c) => c.insert).row.captured_content.categories.flatMap((c) => c.items.map((i) => `${i.name} ${i.price}`));
  // The soup's price went from 7.50 to 8.50: visible as an attention point, never a blocker.
  assert.deepEqual(items, ['Fictieve soep 8.50', 'Fictieve salade 12.50', 'Fictief tartaar 15.50', 'Fictief kaasplankje 11.00']);
});

test('concept: identical content is not saved again', async () => {
  const edits = { lines: { '0.0.2': { exclude: true } }, removed: 'remove' };
  const first = conceptFixture();
  await makeHandlers({ supabase: first, liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits }), BATCH);
  const hash = first.calls.find((c) => c.insert).row.content_hash;
  const second = conceptFixture({ existing: [{ id: 1, restaurant_id: 'bistro', menu_context: 'bistro-menukaart', version: 1, content_hash: hash }] });
  const res = await makeHandlers({ supabase: second, liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits }), BATCH);
  assert.equal(res.status, 200);
  assert.equal(res.body.concept.version, 1);
  assert.equal(res.body.concept.unchanged, true);
  assert.equal(second.calls.filter((c) => c.insert).length, 0);
});

test('concept: only the starter, only for a confirmed known source', async () => {
  const colleague = await makeHandlers({ userId: COLLEAGUE, supabase: conceptFixture(), liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  assert.equal(colleague.status, 403);
  const notConfirmed = await makeHandlers({ supabase: confirmFixture({ menuUrl: FOUND }), liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  assert.equal(notConfirmed.status, 409);
  assert.equal(notConfirmed.body.reason, 'not_confirmed');
  assert.equal((await makeHandlers({ supabase: conceptFixture() }).handlers.saveConcept(request({ job_id: 'nope' }), BATCH)).status, 400);
});

function v2ProductFixture() {
  return {
    schemaVersion: 'menu-extraction-product/v2',
    menus: [{
      id: 'menu-1',
      title: 'Fictief Diner',
      sourceId: 'src-1',
      variant: { id: 'variant-1', label: 'Diner', sourceLabel: 'DINNER', locale: null, location: null, order: 1 },
      categories: [{
        id: 'cat-1',
        name: 'Koud',
        path: ['Diner', 'Koud'],
        sourcePath: ['DINNER', 'KOUD'],
        kind: 'section',
        choice: null,
        uncertain: false,
        items: [{
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
          origins: { name: 'extracted', description: 'unknown', price: 'extracted', allergens: 'unknown', supplementOf: 'unknown', availability: 'unknown', kind: 'unknown' },
        }],
      }],
    }],
    rejected: [],
    coverage: { status: 'partial', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: ['Fictieve beperking.'] },
  };
}

test('overview: a v2 receipt shows the versioned view and never the older v1 menus projection', async () => {
  const supabase = conceptFixture({ menus: [{ categories: [{ name: 'Verouderd', items: [{ name: 'Oude projectie', price: '1.00' }] }] }], receiptProduct: v2ProductFixture() });
  const res = await makeHandlers({ supabase, liveMenus: LIVE_BISTRO }).handlers.getOverview(request(), BATCH);
  const item = res.body.detail.items[0];
  assert.equal(item.productBlocked, true);
  assert.equal(item.product.schemaVersion, 'menu-extraction-product/v2');
  assert.equal(item.product.counts.items, 1);
  assert.equal(item.menu.itemCount, 1);
  assert.equal(item.menu.supplementCount, 0);
  assert.deepEqual(item.concept.menus, []);
  assert.equal(item.concept.productBlocked, true);
  assert.equal(item.concept.product.schemaVersion, 'menu-extraction-product/v2');
});

test('concept: a v2 receipt is refused before any version, hash or insert', async () => {
  const supabase = conceptFixture({ receiptProduct: v2ProductFixture() });
  const res = await makeHandlers({ supabase, liveMenus: LIVE_BISTRO }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'product_v2_read_only');
  assert.deepEqual(res.body.blockedActions, ['save', 'confirm', 'export', 'publish']);
  assert.equal(supabase.calls.filter((c) => c.insert).length, 0);
  assert.equal(supabase.calls.filter((c) => c.rpc).length, 0);
});

// ─── #59 review 6307703713: human structure review of an uncertain result ──
//
// A real source whose section structure is uncertain (Blossem/Smelt shape) can
// only move forward after a human handled every uncertain section. The server
// re-checks the submitted set against the stored receipt and never trusts a
// client claim.

const STRUCTURE_HASH = 'a'.repeat(64);
const STRUCTURE_MENUS = [
  {
    title: 'Fictief Diner',
    structure: 'uncertain',
    categories: [
      { name: 'Voor', path: ['Voor'], sourcePath: ['DINNER', 'VOOR'], locator: 'paneel Diner, regel 1', uncertain: true, items: [{ name: 'Fictieve burrata', price: '13.00' }] },
      { name: 'Hoofd', path: ['Hoofd'], sourcePath: ['DINNER', 'HOOFD'], items: [{ name: 'Fictieve zeebaars', price: '24.00' }] },
    ],
  },
  {
    title: 'Fictief Lunch',
    structure: 'uncertain',
    categories: [
      { name: 'Koud', path: ['Koud'], sourcePath: ['LUNCH', 'KOUD'], locator: 'paneel Lunch, regel 1', uncertain: true, items: [{ name: 'Fictieve salade', price: '12.50' }] },
      { name: 'Warm', path: ['Warm'], sourcePath: ['LUNCH', 'WARM'], items: [{ name: 'Fictieve pasta', price: '14.50' }] },
    ],
  },
];
const VOOR_PATH = ['Fictief Diner', 'Voor'];
const KOUD_PATH = ['Fictief Lunch', 'Koud'];

function structureFixture({ menus = STRUCTURE_MENUS, reviews = [], proposal = null, receiptHash = STRUCTURE_HASH, storedReviewError = null, existing = [] } = {}) {
  const tables = {
    markets: [{ id: 'm1', slug: 'breda' }],
    url_intake_batches: [{ id: BATCH, market_id: 'm1', actor_user_id: STARTER, created_at: '2026-10-10T11:00:00Z', closed_at: '2026-10-10T11:10:00Z', close_reason: 'completed', item_count: 1 }],
    url_intake_batch_items: [{ batch_id: BATCH, item_position: 1, canonical_source_url: 'https://www.bistro-fictief-voorbeeld.nl/', outcome: 'queued', job_id: JOB, reused_job_id: null }],
    restaurant_source_analysis_jobs: [
      { id: JOB, status: 'succeeded', attempt_count: 1, finished_at: '2026-10-10T11:05:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: [FOUND], actor_user_id: STARTER, batch_id: BATCH, created_at: '2026-10-10T11:00:00Z' },
    ],
    url_intake_analysis_receipts: [
      {
        id: 'r1',
        restaurant_match_type: 'exact',
        matched_restaurant_id: 'bistro',
        canonical_source_url: 'https://www.bistro-fictief-voorbeeld.nl/',
        actor_user_id: STARTER,
        analysis_result_hash: receiptHash,
        candidate_summary: { menus },
        menus,
      },
    ],
    source_triage_proposals: proposal ? [proposal] : [],
    menu_snapshot_proposals: existing,
    menu_structure_reviews: reviews,
  };
  const supabase = fakeSupabase({
    tables,
    rpc: {
      create_source_triage_proposal: (a) => ({ data: { id: a.p_proposal_id, status: 'open' }, error: null }),
      decide_source_triage_proposal: () => ({ data: { status: 'accepted' }, error: null }),
    },
  });
  if (storedReviewError) {
    const base = supabase.from;
    supabase.from = (table) => {
      const builder = base(table);
      if (table !== 'menu_structure_reviews') return builder;
      const wrapped = Object.create(builder);
      wrapped.select = () => ({
        in: () => Promise.resolve({ data: null, error: { code: '42P01' } }),
        eq: () => Promise.resolve({ data: null, error: { code: '42P01' } }),
      });
      return wrapped;
    };
  }
  return supabase;
}

const structureReview = (sections) => ({ job_id: JOB, receipt_hash: STRUCTURE_HASH, sections });
const KEEP_VOOR = { path: VOOR_PATH, action: 'keep' };
const KEEP_KOUD = { path: KOUD_PATH, action: 'keep' };
const CORRECT_KOUD = { path: KOUD_PATH, action: 'correct', corrected_path: ['Fictief Lunch', 'Salades'] };

test('structure review: no confirmation while any uncertain section is untreated — and nothing is written', async () => {
  const supabase = structureFixture();
  const partial = await makeHandlers({ supabase, liveMenus: {} }).handlers.confirmSources(
    request({ job_ids: [JOB], structure_reviews: [structureReview([KEEP_VOOR])] }),
    BATCH
  );
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.results, [
    { job_id: JOB, ok: false, reason: 'structure_unreviewed', missing: ['Fictief Lunch › Koud'], unknown: null },
  ]);
  assert.equal(supabase.calls.filter((c) => c.insert).length, 0);
  assert.equal(supabase.calls.filter((c) => c.rpc).length, 0);

  // The one-click request without any structure review is refused as well.
  const none = await makeHandlers({ supabase, liveMenus: {} }).handlers.confirmSources(request({ job_ids: [JOB] }), BATCH);
  assert.deepEqual(none.body.results, [{ job_id: JOB, ok: false, reason: 'structure_required', missing: null, unknown: null }]);
  assert.equal(supabase.calls.filter((c) => c.insert).length, 0);
  assert.equal(supabase.calls.filter((c) => c.rpc).length, 0);
});

test('structure review: an unknown, duplicated or non-correcting payload is refused without any write', async () => {
  const cases = [
    [[KEEP_VOOR, KEEP_KOUD, { path: ['Fictief Diner', 'Hoofd'], action: 'keep' }], 'structure_unknown_section'],
    [[KEEP_VOOR, KEEP_KOUD, KEEP_KOUD], 'structure_invalid'],
    [[KEEP_VOOR, { path: KOUD_PATH, action: 'correct', corrected_path: KOUD_PATH }], 'structure_invalid'],
    [[KEEP_VOOR, { path: KOUD_PATH, action: 'correct' }], 'structure_invalid'],
    [[KEEP_VOOR, { path: KOUD_PATH, action: 'approve' }], 'structure_invalid'],
  ];
  for (const [sections, reason] of cases) {
    const supabase = structureFixture();
    const res = await makeHandlers({ supabase, liveMenus: {} }).handlers.confirmSources(
      request({ job_ids: [JOB], structure_reviews: [structureReview(sections)] }),
      BATCH
    );
    assert.equal(res.status, 200, reason);
    assert.equal(res.body.results[0].reason, reason, JSON.stringify(sections));
    assert.equal(supabase.calls.filter((c) => c.insert).length, 0, reason);
    assert.equal(supabase.calls.filter((c) => c.rpc).length, 0, reason);
  }
});

test('structure review: a wrong or drifted receipt hash is refused before any row or proposal', async () => {
  const wrongHash = structureFixture();
  const mismatch = await makeHandlers({ supabase: wrongHash, liveMenus: {} }).handlers.confirmSources(
    request({ job_ids: [JOB], structure_reviews: [{ ...structureReview([KEEP_VOOR, KEEP_KOUD]), receipt_hash: 'b'.repeat(64) }] }),
    BATCH
  );
  assert.equal(mismatch.body.results[0].reason, 'receipt_mismatch');
  assert.equal(wrongHash.calls.filter((c) => c.insert).length, 0);

  // The stored binding must still produce the stored hash (computeHash is
  // injected; here it returns a different value than the stored receipt).
  const drifted = structureFixture({ receiptHash: 'c'.repeat(64) });
  const binding = await makeHandlers({ supabase: drifted, liveMenus: {} }).handlers.confirmSources(
    request({ job_ids: [JOB], structure_reviews: [{ ...structureReview([KEEP_VOOR, KEEP_KOUD]), receipt_hash: 'c'.repeat(64) }] }),
    BATCH
  );
  assert.equal(binding.body.results[0].reason, 'receipt_binding_mismatch');
  assert.equal(drifted.calls.filter((c) => c.insert).length, 0);
  assert.equal(drifted.calls.filter((c) => c.rpc).length, 0);
});


test('structure review: only the starter and only a real internal account may confirm', async () => {
  const colleague = structureFixture();
  const refused = await makeHandlers({ userId: COLLEAGUE, supabase: colleague, liveMenus: {} }).handlers.confirmSources(
    request({ job_ids: [JOB], structure_reviews: [structureReview([KEEP_VOOR, KEEP_KOUD])] }),
    BATCH
  );
  assert.equal(refused.status, 403);
  assert.equal(refused.body.reason, 'not_starter');
  assert.equal(colleague.calls.filter((c) => c.insert).length, 0);
  assert.equal(colleague.calls.filter((c) => c.rpc).length, 0);

  for (const roles of [[{ role: 'editor' }], [{ role: 'owner', restaurant_id: 'bistro' }], []]) {
    let dbCalls = 0;
    const handlers = createBatchAnalysisHandlers({
      authenticate: async () => ({ ok: true, userId: STARTER, roles }),
      getSupabase: () => {
        dbCalls += 1;
        return structureFixture();
      },
      restaurants: RESTAURANTS,
      generateId: () => 'x',
      analyze: async () => ({ ok: false }),
      computeHash: () => STRUCTURE_HASH,
    });
    const res = await handlers.confirmSources(request({ job_ids: [JOB], structure_reviews: [structureReview([KEEP_VOOR, KEEP_KOUD])] }), BATCH);
    assert.equal(res.status, 403, JSON.stringify(roles));
    assert.equal(dbCalls, 0, JSON.stringify(roles));
  }
});

test('structure review: a complete human set is recorded with who/when/old→new and confirms the source', async () => {
  const supabase = structureFixture();
  const res = await makeHandlers({ supabase, liveMenus: {} }).handlers.confirmSources(
    request({ job_ids: [JOB], structure_reviews: [structureReview([KEEP_VOOR, CORRECT_KOUD])] }),
    BATCH
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [{ job_id: JOB, ok: true }]);
  assert.equal(res.body.confirmed, 1);

  const reviewInsert = supabase.calls.find((c) => c.insert === 'menu_structure_reviews');
  assert.ok(reviewInsert, 'the human decisions are stored');
  assert.equal(reviewInsert.row.length, 2);
  const [kept, corrected] = reviewInsert.row;
  assert.equal(kept.decision, 'keep');
  assert.equal(kept.actor_user_id, STARTER);
  assert.equal(kept.receipt_id, 'r1');
  assert.equal(kept.job_id, JOB);
  assert.equal(kept.batch_id, BATCH);
  assert.deepEqual(JSON.parse(kept.original_path), VOOR_PATH);
  assert.equal(kept.source_path, JSON.stringify(['DINNER', 'VOOR']));
  assert.equal(kept.locator, 'paneel Diner, regel 1');
  assert.equal(kept.corrected_path, null);
  assert.equal(corrected.decision, 'correct');
  assert.deepEqual(JSON.parse(corrected.corrected_path), ['Fictief Lunch', 'Salades']);

  const create = supabase.calls.find((c) => c.rpc === 'create_source_triage_proposal').args;
  assert.equal(create.p_kind, 'add_candidate');
  assert.equal(create.p_proposed_url, FOUND);
  assert.match(create.p_note, /expliciete menselijke controle/);
  assert.equal(supabase.calls.find((c) => c.rpc === 'decide_source_triage_proposal').args.p_decision, 'accepted');
});

test('structure review: a retry with the same decisions is idempotent, a contradicting retry is refused', async () => {
  const stored = [
    { id: 1, receipt_id: 'r1', path_key: JSON.stringify(VOOR_PATH), original_path: JSON.stringify(VOOR_PATH), source_path: JSON.stringify(['DINNER', 'VOOR']), locator: 'paneel Diner, regel 1', decision: 'keep', corrected_path: null, actor_user_id: STARTER, created_at: '2026-10-10T11:20:00Z' },
    { id: 2, receipt_id: 'r1', path_key: JSON.stringify(KOUD_PATH), original_path: JSON.stringify(KOUD_PATH), source_path: JSON.stringify(['LUNCH', 'KOUD']), locator: 'paneel Lunch, regel 1', decision: 'correct', corrected_path: JSON.stringify(['Fictief Lunch', 'Salades']), actor_user_id: STARTER, created_at: '2026-10-10T11:20:00Z' },
  ];
  const same = structureFixture({ reviews: stored });
  const retry = await makeHandlers({ supabase: same, liveMenus: {} }).handlers.confirmSources(
    request({ job_ids: [JOB], structure_reviews: [structureReview([KEEP_VOOR, CORRECT_KOUD])] }),
    BATCH
  );
  assert.deepEqual(retry.body.results, [{ job_id: JOB, ok: true }]);
  assert.equal(same.calls.filter((c) => c.insert === 'menu_structure_reviews').length, 0);

  const changed = structureFixture({ reviews: stored });
  const contradiction = await makeHandlers({ supabase: changed, liveMenus: {} }).handlers.confirmSources(
    request({ job_ids: [JOB], structure_reviews: [structureReview([KEEP_VOOR, KEEP_KOUD])] }),
    BATCH
  );
  assert.equal(contradiction.body.results[0].reason, 'structure_already_reviewed');
  assert.equal(changed.calls.filter((c) => c.insert).length, 0);
  assert.equal(changed.calls.filter((c) => c.rpc).length, 0);
});

test('structure review: an unavailable store is an honest refusal, never a silent confirmation', async () => {
  const supabase = structureFixture({ storedReviewError: true });
  const res = await makeHandlers({ supabase, liveMenus: {} }).handlers.confirmSources(
    request({ job_ids: [JOB], structure_reviews: [structureReview([KEEP_VOOR, KEEP_KOUD])] }),
    BATCH
  );
  assert.equal(res.body.results[0].reason, 'structure_store_unavailable');
  assert.equal(supabase.calls.filter((c) => c.rpc).length, 0);
});


const ACCEPTED_PROPOSAL = { id: 'p1', restaurant_id: 'bistro', proposed_url: FOUND, status: 'accepted', decided_at: '2026-10-10T11:20:00Z' };
const STORED_REVIEWS = [
  { id: 1, receipt_id: 'r1', path_key: JSON.stringify(VOOR_PATH), original_path: JSON.stringify(VOOR_PATH), source_path: JSON.stringify(['DINNER', 'VOOR']), locator: 'paneel Diner, regel 1', decision: 'keep', corrected_path: null, actor_user_id: STARTER, created_at: '2026-10-10T11:20:00Z' },
  { id: 2, receipt_id: 'r1', path_key: JSON.stringify(KOUD_PATH), original_path: JSON.stringify(KOUD_PATH), source_path: JSON.stringify(['LUNCH', 'KOUD']), locator: 'paneel Lunch, regel 1', decision: 'correct', corrected_path: JSON.stringify(['Fictief Lunch', 'Salades']), actor_user_id: STARTER, created_at: '2026-10-10T11:20:00Z' },
];
const confirmedStructureFixture = (extra = {}) => structureFixture({ proposal: ACCEPTED_PROPOSAL, reviews: STORED_REVIEWS, ...extra });

test('concept after a structure review: the human corrections are the edits, and the preview base is the same', async () => {
  const supabase = confirmedStructureFixture();
  const overview = await makeHandlers({ supabase, liveMenus: {} }).handlers.getOverview(request(), BATCH);
  const item = overview.body.detail.items[0];
  assert.equal(item.key, 'confirmed');
  assert.equal(item.high, false);
  assert.deepEqual(item.concept.structureEdits, { '0.0.0': { acceptCategory: true }, '1.0.0': { path: ['Fictief Lunch', 'Salades'] } });
  assert.deepEqual(item.concept.structureReview.treated.map((r) => [r.key, r.action]), [[JSON.stringify(VOOR_PATH), 'keep'], [JSON.stringify(KOUD_PATH), 'correct']]);

  const res = await makeHandlers({ supabase, liveMenus: {} }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  assert.equal(res.status, 201);
  const row = supabase.calls.find((c) => c.insert === 'menu_snapshot_proposals').row;
  assert.equal(row.created_by, STARTER);
  assert.equal(row.origin_receipt_id, 'r1');
  const categories = row.captured_content.categories.map((c) => ({ name: c.name, path: c.path || null, sourcePath: c.sourcePath || null, items: c.items.map((i) => ({ name: i.name, categoryAccepted: i.categoryAccepted || false })) }));
  assert.deepEqual(categories, [
    { name: 'Voor', path: ['Fictief Diner', 'Voor'], sourcePath: ['DINNER', 'VOOR'], items: [{ name: 'Fictieve burrata', categoryAccepted: true }] },
    { name: 'Hoofd', path: ['Fictief Diner', 'Hoofd'], sourcePath: ['DINNER', 'HOOFD'], items: [{ name: 'Fictieve zeebaars', categoryAccepted: false }] },
    { name: 'Salades', path: ['Fictief Lunch', 'Salades'], sourcePath: null, items: [{ name: 'Fictieve salade', categoryAccepted: false }] },
    { name: 'Warm', path: ['Fictief Lunch', 'Warm'], sourcePath: ['LUNCH', 'WARM'], items: [{ name: 'Fictieve pasta', categoryAccepted: false }] },
  ]);
});

test('concept after a structure review: the same decisions give a stable hash and never a second version', async () => {
  const first = confirmedStructureFixture();
  await makeHandlers({ supabase: first, liveMenus: {} }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  const hash = first.calls.find((c) => c.insert === 'menu_snapshot_proposals').row.content_hash;
  assert.match(hash, /^[0-9a-f]{64}$/);
  // The same lineage already holds that exact content.
  const second = confirmedStructureFixture({ existing: [{ id: 1, restaurant_id: 'bistro', menu_context: 'bistro-menukaart', version: 1, content_hash: hash }] });
  const res = await makeHandlers({ supabase: second, liveMenus: {} }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  assert.equal(res.status, 200);
  assert.equal(res.body.concept.unchanged, true);
  assert.equal(res.body.concept.version, 1);
  assert.equal(second.calls.filter((c) => c.insert === 'menu_snapshot_proposals').length, 0);
});

test('concept after a structure review: a missing price stays a blocker; a human price edit still applies on top', async () => {
  const menus = JSON.parse(JSON.stringify(STRUCTURE_MENUS));
  menus[0].categories[0].items.push({ name: 'Fictieve soep', price: null });
  const supabase = confirmedStructureFixture({ menus });
  const blocked = await makeHandlers({ supabase, liveMenus: {} }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body.blockers.map((b) => b.status), ['missing_price']);
  assert.equal(supabase.calls.filter((c) => c.insert === 'menu_snapshot_proposals').length, 0);

  const fixed = await makeHandlers({ supabase, liveMenus: {} }).handlers.saveConcept(
    request({ job_id: JOB, edits: { lines: { '0.0.1': { price: '9,50' } } } }),
    BATCH
  );
  assert.equal(fixed.status, 201);
  const row = supabase.calls.find((c) => c.insert === 'menu_snapshot_proposals').row;
  const voor = row.captured_content.categories.find((c) => c.name === 'Voor');
  assert.deepEqual(voor.items.map((i) => `${i.name} ${i.price}`), ['Fictieve burrata 13.00', 'Fictieve soep 9.50']);
  // The corrected section from the review is still there.
  assert.ok(row.captured_content.categories.some((c) => c.name === 'Salades' && c.path.join('›') === 'Fictief Lunch›Salades'));
});

test('concept after a structure review: an unreadable review trail refuses the concept instead of saving without it', async () => {
  const supabase = confirmedStructureFixture({ storedReviewError: true });
  const res = await makeHandlers({ supabase, liveMenus: {} }).handlers.saveConcept(request({ job_id: JOB, edits: {} }), BATCH);
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'structure_store_unavailable');
  assert.equal(supabase.calls.filter((c) => c.insert === 'menu_snapshot_proposals').length, 0);
});

// Regression (d) of the order: a certain (normalized) receipt keeps the
// unchanged one-click confirmation. A client-sent structure_reviews list never
// activates the human route and never writes an audit row for it.
test('certain outcome (regression d): a normalized receipt confirms one-click and ignores a sent structure list', async () => {
  const supabase = confirmFixture();
  const res = await makeHandlers({ supabase, liveMenus: {} }).handlers.confirmSources(
    request({
      job_ids: [JOB],
      structure_reviews: [{ job_id: JOB, receipt_hash: 'a'.repeat(64), sections: [{ path: ['Fictief'], action: 'keep' }] }],
    }),
    BATCH
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [{ job_id: JOB, ok: true }]);
  const create = supabase.calls.find((c) => c.rpc === 'create_source_triage_proposal').args;
  assert.equal(create.p_note, 'Bevestigd vanuit Batchanalyse na menselijke controle.');
  assert.equal(supabase.calls.filter((c) => c.insert === 'menu_structure_reviews').length, 0);
});


