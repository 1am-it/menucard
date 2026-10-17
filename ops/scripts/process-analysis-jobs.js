#!/usr/bin/env node
'use strict';

// Explicit server-side worker entry point for the existing batch-analysis
// claim/lease contract. It is NOT a cron, workflow or deployment: an operator
// or an already-approved scheduler must invoke it. It reads credentials only
// from the process environment and never prints them or source content.
//
// Usage:
//   node --env-file=.env.local ops/scripts/process-analysis-jobs.js --max=10
//
// It refuses to run without the service-role configuration. It does not create
// concepts, confirm sources, export, publish or call an AI provider.

const { createClient } = require('@supabase/supabase-js');
const { createBatchAnalysisHandlers } = require('../../src/lib/batchAnalysisHandlers');
const { analyzeSourceUrl } = require('../../src/lib/sourceAnalysisPipeline');
const { computeAnalysisResultHash } = require('../../src/lib/urlIntakeReceiptHash');
const { computeCanonicalContentHash } = require('../../src/lib/menuSnapshotHash');
const { generateUuidV7 } = require('../../src/lib/uuidv7');
const { runAnalysisWorkerOnce } = require('../../src/lib/analysisWorker');
const restaurants = require('../../data/restaurants.json');
const liveMenus = require('../../data/menus.json');

function argMax(argv) {
  const value = argv.find((arg) => arg.startsWith('--max='));
  if (!value) return 10;
  const parsed = Number(value.slice('--max='.length));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) throw new Error('--max must be an integer from 1 to 50.');
  return parsed;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const handlers = createBatchAnalysisHandlers({
    // processForWorker deliberately bypasses user authentication; this script
    // itself is the server-only boundary and must never be exposed as a route.
    authenticate: async () => ({ ok: false, status: 401, error: 'worker' }),
    getSupabase: () => supabase,
    restaurants,
    generateId: generateUuidV7,
    analyze: analyzeSourceUrl,
    computeHash: computeAnalysisResultHash,
    computeMenuHash: computeCanonicalContentHash,
    liveMenus,
  });

  const result = await runAnalysisWorkerOnce({
    maxJobs: argMax(process.argv.slice(2)),
    listBatches: async () => {
      const { data, error } = await supabase
        .from('url_intake_batches')
        .select('id, actor_user_id')
        .is('closed_at', null)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw new Error('Could not list open batches.');
      return data || [];
    },
    processBatch: (batchId, actorUserId) => handlers.processForWorker(batchId, actorUserId),
  });

  // Only aggregate counters; never URLs, content, credentials or user ids.
  process.stdout.write(JSON.stringify({ ok: result.ok, claimed: result.claimed, batches: result.batches, stopped: result.stopped, reason: result.reason || null }) + '\n');
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`analysis worker refused: ${err && err.message ? err.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
