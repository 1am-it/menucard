'use strict';

// Bounded server-side batch runner. It contains no fetch, Supabase or model
// call: the caller injects open-batch discovery and the existing
// processForWorker handler. The claim/lease RPC remains the only concurrency
// guard, so this loop can run beside a browser without double processing.
//
// A single invocation has a hard job count and wall-clock deadline. A
// recoverable waiting/lost-lease outcome ends that batch's turn and is never
// spun on; a future scheduler may call runOnce again later. This module does
// not create a schedule or activate a deployment.

const DEFAULT_MAX_JOBS = 10;
const DEFAULT_DEADLINE_MS = 60_000;

function bodyOf(result) {
  return result && result.body && typeof result.body === 'object' ? result.body : {};
}

async function runAnalysisWorkerOnce({ listBatches, processBatch, maxJobs = DEFAULT_MAX_JOBS, deadlineMs = DEFAULT_DEADLINE_MS, now = Date.now } = {}) {
  if (typeof listBatches !== 'function' || typeof processBatch !== 'function') {
    return { ok: false, reason: 'worker_not_configured', claimed: 0, batches: 0, results: [] };
  }
  const limit = Number.isInteger(maxJobs) && maxJobs > 0 ? maxJobs : DEFAULT_MAX_JOBS;
  const deadline = now() + (Number.isInteger(deadlineMs) && deadlineMs > 0 ? deadlineMs : DEFAULT_DEADLINE_MS);
  let batches
  try {
    batches = await listBatches();
  } catch {
    return { ok: false, reason: 'batch_list_failed', claimed: 0, batches: 0, results: [] };
  }
  const list = Array.isArray(batches) ? batches : [];
  let claimed = 0;
  const results = [];
  for (const batch of list) {
    if (!batch || typeof batch.id !== 'string' || typeof batch.actor_user_id !== 'string') continue;
    while (claimed < limit && now() < deadline) {
      let result;
      try {
        result = await processBatch(batch.id, batch.actor_user_id);
      } catch {
        results.push({ batchId: batch.id, outcome: 'error' });
        break;
      }
      const body = bodyOf(result);
      const outcome = typeof body.outcome === 'string' ? body.outcome : 'error';
      results.push({ batchId: batch.id, outcome });
      if (outcome !== 'claimed') break;
      claimed += 1;
    }
    if (claimed >= limit || now() >= deadline) break;
  }
  return { ok: true, claimed, batches: list.length, results, stopped: claimed >= limit ? 'job_limit' : now() >= deadline ? 'deadline' : 'drained' };
}

module.exports = { DEFAULT_MAX_JOBS, DEFAULT_DEADLINE_MS, runAnalysisWorkerOnce };
