'use strict';

// BE-31 herstel (#74) — "Oude resultaten opruimen": the server rule that closes
// existing batch results by hand. Fictional rows only: no Supabase, no network,
// no clock. The marker goes into the existing job row's `field_evidence`, so no
// migration is needed and nothing is deleted.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createBatchResultHandlingHandlers, HANDLED_KEY, MAX_RESULTS_PER_REQUEST } = require('./batchResultHandling');

const MARKET = '11111111-1111-4111-8111-111111111111';
const JOB_A = '22222222-2222-4222-8222-222222222222';
const JOB_B = '33333333-3333-4333-8333-333333333333';
const JOB_ELSEWHERE = '44444444-4444-4444-8444-444444444444';

// A tiny in-memory stand-in with exactly the chained calls the handler makes.
function fakeSupabase({ jobs, batches, failUpdate = false }) {
  const updates = [];
  function table(name) {
    if (name === 'markets') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: MARKET }, error: null }) }),
        }),
      };
    }
    if (name === 'url_intake_batches') {
      return {
        select: () => ({
          eq: (column, value) => ({
            eq: (column2, marketValue) => ({
              maybeSingle: async () => {
                const match = batches.find((batch) => batch.id === value && batch.market_id === marketValue);
                return { data: match || null, error: null };
              },
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }
    if (name === 'restaurant_source_analysis_jobs') {
      return {
        select: () => ({
          eq: (column, value) => ({
            maybeSingle: async () => ({ data: jobs.find((job) => job.id === value) || null, error: null }),
          }),
        }),
        update: (values) => {
          const chain = {
            id: null,
            eq(column, value) {
              if (column === 'id') chain.id = value;
              if (column === 'batch_id') chain.batch = value;
              return chain;
            },
            then(resolve) {
              if (failUpdate) resolve({ error: { message: 'nope' } });
              else {
                updates.push({ id: chain.id, values });
                const job = jobs.find((row) => row.id === chain.id);
                if (job) job.field_evidence = values.field_evidence;
                resolve({ error: null });
              }
            },
          };
          return chain;
        },
      };
    }
    throw new Error(`unexpected table ${name}`);
  }
  return { client: { from: table }, updates };
}

function request(body) {
  return { json: async () => body };
}

function handlersFor(supabase, overrides = {}) {
  return createBatchResultHandlingHandlers({
    authenticate: async () => ({ ok: true, userId: 'staff-1', roles: [{ role: 'internal' }] }),
    getSupabase: () => supabase,
    now: () => new Date('2026-10-27T10:15:00.000Z'),
    ...overrides,
  });
}

function fixture() {
  return {
    jobs: [
      {
        id: JOB_A,
        batch_id: 'batch-1',
        field_evidence: { notes: ['Fictieve notitie'], structureAdvice: { kind: 'ai_suggested' } },
      },
      { id: JOB_B, batch_id: 'batch-1', field_evidence: null },
      // A job of another market: never touched.
      { id: JOB_ELSEWHERE, batch_id: 'batch-other', field_evidence: null },
    ],
    batches: [
      { id: 'batch-1', market_id: MARKET },
      { id: 'batch-other', market_id: 'other-market' },
    ],
  };
}

test('handled: closes exactly the chosen results, by this staff member and date', async () => {
  const { jobs, batches } = fixture();
  const fake = fakeSupabase({ jobs, batches });
  const handlers = handlersFor(fake.client);

  const result = await handlers.markHandled(request({ job_ids: [JOB_A, JOB_B, JOB_A] }));

  assert.equal(result.status, 200);
  assert.equal(result.body.handled, 2);
  assert.equal(result.body.already, 0);
  assert.equal(result.body.skipped, 0);
  assert.equal(result.body.at, '2026-10-27T10:15:00.000Z');
  // Nothing is deleted: the earlier evidence is still there, the marker is added.
  assert.deepEqual(jobs[0].field_evidence.notes, ['Fictieve notitie']);
  assert.deepEqual(jobs[0].field_evidence.structureAdvice, { kind: 'ai_suggested' });
  assert.deepEqual(jobs[0].field_evidence[HANDLED_KEY], {
    kind: 'batch_result_handled',
    by: 'staff-1',
    at: '2026-10-27T10:15:00.000Z',
  });
  assert.equal(jobs[1].field_evidence[HANDLED_KEY].by, 'staff-1');
});

test('handled: closing twice keeps the first record', async () => {
  const { jobs, batches } = fixture();
  const fake = fakeSupabase({ jobs, batches });
  const first = await handlersFor(fake.client).markHandled(request({ job_ids: [JOB_A] }));
  assert.equal(first.body.handled, 1);

  const later = handlersFor(fake.client, { now: () => new Date('2026-10-28T08:00:00.000Z') });
  const second = await later.markHandled(request({ job_ids: [JOB_A] }));
  assert.equal(second.status, 200);
  assert.equal(second.body.handled, 0);
  assert.equal(second.body.already, 1);
  assert.equal(jobs[0].field_evidence[HANDLED_KEY].at, '2026-10-27T10:15:00.000Z');
});

test('handled: a job of another market is skipped, never written', async () => {
  const { jobs, batches } = fixture();
  const fake = fakeSupabase({ jobs, batches });
  const result = await handlersFor(fake.client).markHandled(request({ job_ids: [JOB_ELSEWHERE] }));
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'De resultaten konden niet worden afgehandeld.');
  assert.equal(jobs[2].field_evidence, null);
  assert.equal(fake.updates.length, 0);
});

test('handled: only internal staff may close results', async () => {
  const { jobs, batches } = fixture();
  const fake = fakeSupabase({ jobs, batches });
  const editorOnly = handlersFor(fake.client, {
    authenticate: async () => ({ ok: true, userId: 'u', roles: [{ role: 'editor' }] }),
  });
  const denied = await editorOnly.markHandled(request({ job_ids: [JOB_A] }));
  assert.equal(denied.status, 403);
  assert.equal(fake.updates.length, 0);

  const anonymous = handlersFor(fake.client, { authenticate: async () => ({ ok: false, status: 401 }) });
  assert.equal((await anonymous.markHandled(request({ job_ids: [JOB_A] }))).status, 401);
});

test('handled: bad input is refused without a write', async () => {
  const { jobs, batches } = fixture();
  const fake = fakeSupabase({ jobs, batches });
  const handlers = handlersFor(fake.client);

  assert.equal((await handlers.markHandled(request({}))).status, 400);
  assert.equal((await handlers.markHandled(request({ job_ids: [] }))).status, 400);
  assert.equal((await handlers.markHandled(request({ job_ids: ['not-a-uuid'] }))).status, 400);
  const tooMany = Array.from({ length: MAX_RESULTS_PER_REQUEST + 1 }, (_, index) =>
    `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
  );
  assert.equal((await handlers.markHandled(request({ job_ids: tooMany }))).status, 400);
  assert.equal(fake.updates.length, 0);
  assert.equal(MAX_RESULTS_PER_REQUEST, 100);
});

test('handled: a failed write is an error, never a silent success', async () => {
  const { jobs, batches } = fixture();
  const fake = fakeSupabase({ jobs, batches, failUpdate: true });
  const result = await handlersFor(fake.client).markHandled(request({ job_ids: [JOB_A] }));
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'De resultaten konden niet worden afgehandeld.');
});
