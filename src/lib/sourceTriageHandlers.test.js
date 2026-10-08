'use strict';

// BE-24 Brontriage — behavioural tests for the route handlers, with an
// injected fake Supabase client that records every call. Proves: a
// refused caller causes zero database calls; invalid input never reaches
// the database; the only writes are the two 0015 RPCs; the actor is the
// authenticated user; nothing is fetched. Fictional data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSourceTriageHandlers } = require('./sourceTriageHandlers');

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROPOSAL_ID = '0191f2a0-1234-7abc-8def-0123456789ab';
const RESTAURANTS = {
  1: { name: 'Fictief Bistro Haven', buurt: 'Centrum', website: 'https://bistrohaven.example.com' },
  2: { name: 'Fictief Eetcafé Molen', buurt: 'Ginneken', website: '' },
};

// A fake Supabase client: every from()/rpc() is recorded; results come
// from `tables`/`rpcResults`.
function fakeSupabase({ tables = {}, rpcResults = {}, failTables = [] } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const call = { kind: 'from', table, chain: [] };
      calls.push(call);
      const builder = {
        select(cols) { call.chain.push(['select', cols]); return builder; },
        eq(...a) { call.chain.push(['eq', ...a]); return builder; },
        in(...a) { call.chain.push(['in', ...a]); return builder; },
        order(...a) { call.chain.push(['order', ...a]); return builder; },
        limit(...a) { call.chain.push(['limit', ...a]); return builder; },
        insert() { throw new Error('direct insert is not allowed'); },
        update() { throw new Error('direct update is not allowed'); },
        delete() { throw new Error('direct delete is not allowed'); },
        upsert() { throw new Error('direct upsert is not allowed'); },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      function result() {
        if (failTables.includes(table)) return { data: null, error: { code: '42P01', message: 'missing' } };
        if (table === 'markets') return { data: { id: 'market-breda' }, error: null };
        return { data: tables[table] || [], error: null };
      }
      return builder;
    },
    rpc(name, args) {
      calls.push({ kind: 'rpc', name, args });
      const r = rpcResults[name] || { data: { id: args.p_proposal_id, status: name === 'decide_source_triage_proposal' ? args.p_decision : 'open' }, error: null };
      return Promise.resolve(r);
    },
  };
  return client;
}

function setup({ auth = { ok: true, userId: USER, roles: [{ role: 'internal' }] }, supabase = fakeSupabase() } = {}) {
  let supabaseCreated = 0;
  const handlers = createSourceTriageHandlers({
    authenticate: async () => auth,
    getSupabase: () => {
      supabaseCreated += 1;
      return supabase;
    },
    restaurants: RESTAURANTS,
    generateId: () => PROPOSAL_ID,
  });
  return { handlers, supabase, created: () => supabaseCreated };
}

function req(body, { raw } = {}) {
  let bodyRead = false;
  return {
    get bodyRead() { return bodyRead; },
    async json() {
      bodyRead = true;
      if (raw !== undefined) return JSON.parse(raw);
      return body;
    },
  };
}

// ── Authorization: refusal without any database call ─────────────────────

const REFUSALS = [
  ['no session', { ok: false, status: 401, error: 'Missing bearer token' }, 401],
  ['expired session', { ok: false, status: 401, error: 'Invalid or expired session' }, 401],
  ['no staff role', { ok: false, status: 403, error: 'No staff role assigned for this account' }, 403],
  ['editor only', { ok: true, userId: USER, roles: [{ role: 'editor', restaurant_id: null }] }, 403],
  ['owner only', { ok: true, userId: USER, roles: [{ role: 'owner', restaurant_id: '1' }] }, 403],
  ['editor + owner', { ok: true, userId: USER, roles: [{ role: 'editor' }, { role: 'owner', restaurant_id: '1' }] }, 403],
];

for (const [label, auth, status] of REFUSALS) {
  test(`refused (${label}): every handler answers ${status} before reading the body or creating a database client`, async () => {
    for (const run of [
      (h, r) => h.getTriage(r),
      (h, r) => h.createProposal(r),
      (h, r) => h.decideProposal(r, PROPOSAL_ID),
    ]) {
      const { handlers, supabase, created } = setup({ auth });
      const request = req({ restaurant_id: '1', kind: 'add_candidate', proposed_url: 'https://a.example.com/', decision: 'accepted' });
      const res = await run(handlers, request);
      assert.equal(res.status, status);
      assert.ok(res.body.error);
      assert.equal(created(), 0, 'no database client');
      assert.equal(supabase.calls.length, 0, 'no database call');
      assert.equal(request.bodyRead, false, 'body not read');
    }
  });
}

test('an internal + editor account is allowed (internal is what counts)', async () => {
  const { handlers } = setup({ auth: { ok: true, userId: USER, roles: [{ role: 'editor' }, { role: 'internal' }] } });
  assert.equal((await handlers.getTriage(req())).status, 200);
});

// ── Create ────────────────────────────────────────────────────────────────

test('create: invalid input is refused with 400/404 and never reaches the database', async () => {
  const bad = [
    [{ restaurant_id: '1', kind: 'add_candidate', proposed_url: 'http://127.0.0.1/' }, 400, 'url_ip_literal'],
    [{ restaurant_id: '1', kind: 'add_candidate', proposed_url: 'https://intranet.corp/' }, 400, 'url_reserved_host'],
    [{ restaurant_id: '1', kind: 'publish', proposed_url: 'https://a.example.com/' }, 400, 'kind'],
    [{ restaurant_id: '1', kind: 'mark_unusable', unusable_reason: 'other' }, 400, 'note_required'],
    [{ restaurant_id: '2', kind: 'replace_source', proposed_url: 'https://a.example.com/' }, 400, 'no_current_url'],
    [{ restaurant_id: '99', kind: 'add_candidate', proposed_url: 'https://a.example.com/' }, 404, 'restaurant_unknown'],
    [{ restaurant_id: '__proto__', kind: 'add_candidate', proposed_url: 'https://a.example.com/' }, 404, 'restaurant_unknown'],
    [{ restaurant_id: 'constructor', kind: 'add_candidate', proposed_url: 'https://a.example.com/' }, 404, 'restaurant_unknown'],
  ];
  for (const [body, status, reason] of bad) {
    const { handlers, supabase, created } = setup();
    const res = await handlers.createProposal(req(body));
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(res.body.reason, reason, JSON.stringify(body));
    assert.equal(created(), 0);
    assert.equal(supabase.calls.length, 0);
  }
  const { handlers, supabase } = setup();
  const res = await handlers.createProposal(req(null, { raw: '{not json' }));
  assert.equal(res.status, 400);
  assert.equal(supabase.calls.length, 0);
});

test('create: one RPC call with server-derived values; the actor and current_url never come from the body', async () => {
  const { handlers, supabase } = setup();
  const res = await handlers.createProposal(
    req({
      restaurant_id: '1',
      kind: 'replace_source',
      proposed_url: 'https://haven-nieuw.example.com/menu?utm=x#top',
      note: '  Nieuwe website sinds september  ',
      current_url: 'https://evil.example.com/',
      actor_user_id: 'ffffffff-0000-4000-8000-000000000000',
      status: 'accepted',
    })
  );
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { proposal: { id: PROPOSAL_ID, status: 'open' } });
  const rpcs = supabase.calls.filter((c) => c.kind === 'rpc');
  assert.equal(rpcs.length, 1);
  assert.equal(rpcs[0].name, 'create_source_triage_proposal');
  assert.deepEqual(rpcs[0].args, {
    p_proposal_id: PROPOSAL_ID,
    p_market_id: 'market-breda',
    p_restaurant_id: '1',
    p_kind: 'replace_source',
    p_proposed_url: 'https://haven-nieuw.example.com/menu',
    p_current_url: 'https://bistrohaven.example.com/',
    p_unusable_reason: null,
    p_note: 'Nieuwe website sinds september',
    p_actor_user_id: USER,
  });
  // Besides the RPC only the market lookup (a read) happened.
  assert.deepEqual(supabase.calls.filter((c) => c.kind === 'from').map((c) => c.table), ['markets']);
});

test('create: an existing open proposal gives 409; other database errors give a generic message without detail', async () => {
  const open = setup({ supabase: fakeSupabase({ rpcResults: { create_source_triage_proposal: { data: null, error: { code: 'P0030', message: 'An open proposal already exists' } } } }) });
  const r1 = await open.handlers.createProposal(req({ restaurant_id: '1', kind: 'mark_unusable', unusable_reason: 'site_offline' }));
  assert.equal(r1.status, 409);
  assert.equal(r1.body.reason, 'open_exists');
  const broken = setup({ supabase: fakeSupabase({ rpcResults: { create_source_triage_proposal: { data: null, error: { code: 'XX000', message: 'secret internal detail' } } } }) });
  const r2 = await broken.handlers.createProposal(req({ restaurant_id: '1', kind: 'mark_unusable', unusable_reason: 'site_offline' }));
  assert.equal(r2.status, 500);
  assert.doesNotMatch(JSON.stringify(r2.body), /secret internal detail/);
});

// ── Decide ────────────────────────────────────────────────────────────────

test('decide: accept and reject go through the one RPC with the authenticated actor', async () => {
  const a = setup();
  const accepted = await a.handlers.decideProposal(req({ decision: 'accepted', actor_user_id: 'x' }), PROPOSAL_ID);
  assert.equal(accepted.status, 200);
  assert.deepEqual(a.supabase.calls, [{ kind: 'rpc', name: 'decide_source_triage_proposal', args: { p_proposal_id: PROPOSAL_ID, p_decision: 'accepted', p_actor_user_id: USER, p_note: null } }]);
  const r = setup();
  const rejected = await r.handlers.decideProposal(req({ decision: 'rejected', note: ' Hoort bij andere zaak ' }), PROPOSAL_ID);
  assert.equal(rejected.status, 200);
  assert.equal(r.supabase.calls[0].args.p_note, 'Hoort bij andere zaak');
  assert.equal(r.supabase.calls[0].args.p_decision, 'rejected');
});

test('decide: a rejection without a reason, an unknown decision or a malformed id never reaches the database', async () => {
  for (const [body, id, status] of [
    [{ decision: 'rejected' }, PROPOSAL_ID, 400],
    [{ decision: 'published' }, PROPOSAL_ID, 400],
    [{ decision: 'accepted' }, 'not-a-uuid', 404],
    [{ decision: 'accepted' }, "x'; drop table", 404],
  ]) {
    const { handlers, supabase, created } = setup();
    const res = await handlers.decideProposal(req(body), id);
    assert.equal(res.status, status, JSON.stringify(body) + id);
    assert.equal(created(), 0);
    assert.equal(supabase.calls.length, 0);
  }
});

test('decide: an already decided or unknown proposal gives 409 (decided proposals are final)', async () => {
  const { handlers } = setup({ supabase: fakeSupabase({ rpcResults: { decide_source_triage_proposal: { data: null, error: { code: 'P0031' } } } }) });
  const res = await handlers.decideProposal(req({ decision: 'accepted' }), PROPOSAL_ID);
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'not_open');
});

// ── Read ──────────────────────────────────────────────────────────────────

test('read: only selects (no RPC), combines BE-23 data with proposals, and exposes no full user id', async () => {
  const other = 'bbbbbbbb-0000-4000-8000-000000000002';
  const supabase = fakeSupabase({
    tables: {
      restaurant_source_analysis_jobs: [],
      source_triage_proposals: [
        { id: PROPOSAL_ID, restaurant_id: '1', kind: 'add_candidate', proposed_url: 'https://bistrohaven.example.com/menu', current_url: 'https://bistrohaven.example.com/', status: 'open', proposed_by: other, proposed_at: '2026-10-07T10:00:00Z', source_triage_proposal_events: [{ event: 'proposed', actor_user_id: other, note: null, created_at: '2026-10-07T10:00:00Z' }] },
      ],
    },
  });
  const { handlers } = setup({ supabase });
  const res = await handlers.getTriage(req());
  assert.equal(res.status, 200);
  assert.equal(supabase.calls.filter((c) => c.kind === 'rpc').length, 0);
  assert.deepEqual(supabase.calls.map((c) => c.table), ['markets', 'restaurant_source_analysis_jobs', 'source_triage_proposals']);
  assert.equal(res.body.proposals_available, true);
  assert.equal(res.body.restaurants.length, 2);
  const haven = res.body.restaurants.find((r) => r.restaurant_id === '1');
  assert.equal(haven.next_step, 'review_proposal');
  assert.equal(haven.proposals[0].proposed_by.ref, 'bbbbbbbb');
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(other));
});

test('read: when proposals cannot be loaded the page still gets the BE-23 data, with no proposal state derived', async () => {
  const { handlers } = setup({ supabase: fakeSupabase({ failTables: ['source_triage_proposals'] }) });
  const res = await handlers.getTriage(req());
  assert.equal(res.status, 200);
  assert.equal(res.body.proposals_available, false);
  assert.equal(res.body.proposal_limit_reached, false);
  assert.equal(res.body.restaurants.length, 2);
  for (const r of res.body.restaurants) {
    assert.equal(r.proposals_known, false);
    assert.equal(r.open_proposal_id, null);
    assert.equal(r.next_step, 'proposals_unknown');
  }
  assert.doesNotMatch(JSON.stringify(res.body), /42P01|missing/, 'no database error detail reaches the browser');
});

test('read: a failing workqueue query is a load error, never partial data', async () => {
  const { handlers } = setup({ supabase: fakeSupabase({ failTables: ['restaurant_source_analysis_jobs'] }) });
  const res = await handlers.getTriage(req());
  assert.equal(res.status, 500);
  assert.equal(res.body.restaurants, undefined);
});

// ── Structural: no fetch, no analysis, no publication ─────────────────────

test('the handlers and routes never fetch, analyse, publish or write outside the two RPCs', () => {
  const root = path.resolve(__dirname, '..', '..');
  const files = [
    'src/lib/sourceTriageHandlers.js',
    'app/api/internal/v1/source-triage/route.js',
    'app/api/internal/v1/source-triage/proposals/route.js',
    'app/api/internal/v1/source-triage/proposals/[id]/decision/route.js',
  ];
  for (const f of files) {
    const code = fs
      .readFileSync(path.join(root, f), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.doesNotMatch(code, /\bfetch\(|fetchWebsiteSafely|safeOutboundFetch|restaurantSourceFetch|restaurantSourceAnalysis|claudeStructuring|pdfTextExtraction/, f);
    assert.doesNotMatch(code, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, f);
    assert.doesNotMatch(code, /restaurant_source_analysis_jobs['"]\)\s*\.\s*(insert|update)|menu_snapshot|restaurant_profile_drafts|url_intakes['"]/, f);
    const rpcs = [...code.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]);
    for (const r of rpcs) assert.ok(['create_source_triage_proposal', 'decide_source_triage_proposal'].includes(r), `${f}: ${r}`);
  }
  for (const f of files.slice(1)) {
    const code = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(code, /authenticate: authenticateInternalRequest/, f);
    assert.match(code, /createSourceTriageHandlers\(/, f);
  }
});
