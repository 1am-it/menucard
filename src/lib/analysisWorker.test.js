'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runAnalysisWorkerOnce } = require('./analysisWorker');

const batches = [
  { id: 'b1', actor_user_id: 'u1' },
  { id: 'b2', actor_user_id: 'u2' },
];

test('runs bounded jobs across open batches and stops when a batch is drained', async () => {
  const calls = [];
  const outcomes = { b1: ['claimed', 'claimed', 'done'], b2: ['claimed', 'done'] };
  const result = await runAnalysisWorkerOnce({
    listBatches: async () => batches,
    processBatch: async (batchId, actor) => {
      calls.push([batchId, actor]);
      const outcome = outcomes[batchId].shift();
      return { status: 200, body: { outcome } };
    },
    maxJobs: 10,
  });
  assert.equal(result.ok, true);
  assert.equal(result.claimed, 3);
  assert.deepEqual(calls, [['b1', 'u1'], ['b1', 'u1'], ['b1', 'u1'], ['b2', 'u2'], ['b2', 'u2']]);
  assert.deepEqual(result.results.map((r) => r.outcome), ['claimed', 'claimed', 'done', 'claimed', 'done']);
  assert.equal(result.stopped, 'drained');
});

test('never exceeds maxJobs even when the first batch keeps claiming', async () => {
  let calls = 0;
  const result = await runAnalysisWorkerOnce({
    listBatches: async () => [batches[0]],
    processBatch: async () => {
      calls += 1;
      return { status: 200, body: { outcome: 'claimed' } };
    },
    maxJobs: 2,
  });
  assert.equal(result.claimed, 2);
  assert.equal(calls, 2);
  assert.equal(result.stopped, 'job_limit');
});

test('a waiting/lease-lost/error outcome ends that batch rather than spinning', async () => {
  const calls = [];
  const result = await runAnalysisWorkerOnce({
    listBatches: async () => [batches[0], batches[1]],
    processBatch: async (batchId) => {
      calls.push(batchId);
      return { status: 200, body: { outcome: batchId === 'b1' ? 'waiting' : 'lease_lost' } };
    },
  });
  assert.equal(result.claimed, 0);
  assert.deepEqual(calls, ['b1', 'b2']);
  assert.equal(result.stopped, 'drained');
});

test('a worker without injected dependencies refuses instead of pretending to run', async () => {
  assert.deepEqual(await runAnalysisWorkerOnce({}), { ok: false, reason: 'worker_not_configured', claimed: 0, batches: 0, results: [] });
});
