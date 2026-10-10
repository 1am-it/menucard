'use strict';

// Structural safety net for supabase/migrations/0016_be25_batch_source_analysis.sql
// (BE-25 fase 1, batch source analysis) — read from the file itself, like
// the existing migration tests. Not a substitute for applying it: the
// existing validate-migrations workflow replays every migration on an
// empty Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '0016_be25_batch_source_analysis.sql'), 'utf8');
const code = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const flat = code.replace(/\s+/g, ' ').toLowerCase();

const FUNCTIONS = {
  expire_idle_source_analysis_batches: 'expire_idle_source_analysis_batches()',
  enqueue_source_analysis_batch: 'enqueue_source_analysis_batch(uuid, uuid, uuid, jsonb)',
  claim_next_source_analysis_job: 'claim_next_source_analysis_job(uuid, uuid)',
  complete_source_analysis_job: 'complete_source_analysis_job(uuid, uuid, uuid, jsonb)',
  fail_source_analysis_job: 'fail_source_analysis_job(uuid, uuid, text)',
  create_url_intake_from_batch_job: 'create_url_intake_from_batch_job(uuid, uuid, uuid, text)',
};
const CODES = ['P0040', 'P0041', 'P0042', 'P0043', 'P0044', 'P0045', 'P0046', 'P0047', 'P0048', 'P0049'];

function fn(name) {
  const start = code.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  const end = code.indexOf('$$;', start);
  return code.slice(start, end);
}

function statements(kind) {
  return [...code.matchAll(new RegExp(`\\b${kind}\\b[^;]*;`, 'gi'))].map((m) => m[0].replace(/\s+/g, ' ').trim().toLowerCase());
}

test('0016 has a unique migration number and is the only BE-25 migration', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => f.startsWith('0016')), ['0016_be25_batch_source_analysis.sql']);
  assert.equal(files.filter((f) => /be25/.test(f)).length, 1);
});

test('0016 is additive: one new table, new functions, and only added columns/constraints on existing tables', () => {
  const created = [...code.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created, ['url_intake_batch_items']);
  const functions = [...code.matchAll(/create or replace function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(functions, Object.keys(FUNCTIONS));
  // Never redefines an existing function, BE-19's redemption RPC included.
  assert.doesNotMatch(code, /function create_url_intake_from_receipt|function promote_url_intake|function create_source_triage|function decide_source_triage/);
  for (const m of code.matchAll(/alter table (\w+)\s+(\w+(?: \w+)?)/g)) {
    if (m[1] === 'url_intake_batch_items') {
      assert.equal(m[2], 'enable row');
    } else {
      assert.ok(['url_intake_batches', 'restaurant_source_analysis_jobs', 'url_intakes'].includes(m[1]), m[1]);
      assert.match(m[2], /^add (column|constraint)$/, `${m[1]}: ${m[2]}`);
    }
  }
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\b/i);
  assert.doesNotMatch(code, /alter column|rename/i);
  assert.doesNotMatch(code, /source_triage_proposals|menu_snapshot|restaurant_profile_drafts|pending_changes|field_provenance/);
});

test('0016 new job columns are nullable, so single-URL jobs (batch_id null) stay valid', () => {
  for (const col of ['source_host', 'lease_expires_at', 'next_attempt_at', 'claimed_at', 'finished_at', 'expired_at']) {
    const m = code.match(new RegExp(`add column if not exists ${col} ([^;]*);`));
    assert.ok(m, col);
    assert.doesNotMatch(m[1], /not null/, col);
  }
  assert.match(code, /check \(\(batch_id is null\) = \(source_host is null\)\)/);
  assert.match(code, /check \(batch_id is not null or lease_expires_at is null\)/);
  // Duplicates are blocked inside one batch only — no wider unique index on the URL.
  assert.match(code, /create unique index if not exists \w+\s+on restaurant_source_analysis_jobs \(batch_id, canonical_source_url\)\s+where batch_id is not null;/);
  const uniqueOnJobs = [...code.matchAll(/create unique index if not exists \w+\s+on restaurant_source_analysis_jobs \(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(uniqueOnJobs, ['batch_id, canonical_source_url']);
});

test('0016 batch lifecycle: closed_at/close_reason biconditional, one open batch per starter, item and outcome lists closed', () => {
  assert.match(code, /close_reason in \('completed', 'expired'\)/);
  assert.match(code, /check \(\(closed_at is null\) = \(close_reason is null\)\)/);
  assert.match(code, /item_count >= 1 and item_count <= 10/);
  assert.match(code, /create unique index if not exists \w+\s+on url_intake_batches \(actor_user_id\)\s+where closed_at is null and item_count is not null;/);
  assert.match(code, /outcome in \('queued', 'recent', 'duplicate', 'already_active', 'invalid'\)/);
  assert.match(code, /check \(\(outcome = 'queued'\) = \(job_id is not null\)\)/);
  assert.match(code, /check \(\(outcome = 'recent'\) = \(reused_job_id is not null\)\)/);
  assert.match(code, /check \(\(outcome = 'invalid'\) = \(canonical_source_url is null\)\)/);
  assert.match(code, /item_position\s+integer not null check \(item_position >= 1 and item_position <= 10\)/);
  assert.match(code, /primary key \(batch_id, item_position\)/);
});

test('0016 grants are exactly the minimum for service_role — nothing else, no GRANT ALL, no delete', () => {
  assert.deepEqual(statements('grant').sort(), [
    ...Object.values(FUNCTIONS).map((sig) => `grant execute on function ${sig} to service_role;`),
    'grant select, insert on public.url_intake_batch_items to service_role;',
    'grant update (last_activity_at, closed_at, close_reason) on public.url_intake_batches to service_role;',
    'grant update (lease_expires_at, next_attempt_at, claimed_at, finished_at, expired_at) on public.restaurant_source_analysis_jobs to service_role;',
    'grant usage on schema public to service_role;',
  ].sort());
  assert.doesNotMatch(code, /grant\s+all\b/i);
  assert.doesNotMatch(code, /grant[^;]*\b(delete|truncate)\b/i);
  assert.doesNotMatch(code, /grant[^;]*to (anon|authenticated|public)\b/i);
  assert.doesNotMatch(code, /alter default privileges/i);
});

test('0016 revokes the new table and every function from public, anon, authenticated and service_role before granting', () => {
  const revokes = statements('revoke');
  const required = [
    'revoke all on public.url_intake_batch_items from public, anon, authenticated;',
    'revoke all on public.url_intake_batch_items from service_role;',
    ...Object.values(FUNCTIONS).map((sig) => `revoke all on function ${sig} from public, anon, authenticated, service_role;`),
  ];
  for (const r of required) assert.ok(revokes.includes(r), `missing: ${r}`);
  assert.equal(revokes.length, required.length, 'no unexpected revoke (existing tables keep their grants)');
  for (const sig of Object.values(FUNCTIONS)) {
    const r = flat.indexOf(`revoke all on function ${sig}`);
    const g = flat.indexOf(`grant execute on function ${sig}`);
    assert.ok(r >= 0 && r < g, sig);
  }
  assert.ok(flat.indexOf('revoke all on public.url_intake_batch_items from service_role') < flat.indexOf('grant select, insert on public.url_intake_batch_items'));
  assert.match(code, /alter table url_intake_batch_items enable row level security;/);
  assert.doesNotMatch(code, /create policy/i);
});

test('0016 functions are security invoker with a fixed search_path and use P0040-P0049 only, none used before', () => {
  const n = Object.keys(FUNCTIONS).length;
  assert.equal((code.match(/security invoker/g) || []).length, n);
  assert.equal((code.match(/set search_path = public/g) || []).length, n);
  assert.doesNotMatch(code, /security definer/i);
  const used = [...code.matchAll(/errcode = '(P\d{4})'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), CODES);
  const earlier = new Set();
  for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f < '0016')) {
    for (const m of fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').matchAll(/errcode = '(P\d{4})'/g)) earlier.add(m[1]);
  }
  for (const c of CODES) assert.ok(!earlier.has(c), c);
});

test('0016 enqueue: serialized, idempotent per client batch id, 1-10 URLs, one open batch, 25 per Amsterdam day', () => {
  const f = fn('enqueue_source_analysis_batch');
  assert.match(f, /perform pg_advisory_xact_lock\(4025, 1\);/);
  // Idempotency comes first: a repeated id returns the batch before any limit or insert.
  const idem = f.indexOf('where b.id = p_batch_id');
  assert.ok(idem >= 0 && idem < f.indexOf('insert into url_intake_batches'));
  assert.match(f, /if v_batch\.actor_user_id is distinct from p_actor_user_id then[\s\S]*?errcode = 'P0040'[\s\S]*?return v_batch;/);
  assert.match(f, /if v_count < 1 or v_count > 10 then[\s\S]*?errcode = 'P0041'/);
  assert.match(f, /perform expire_idle_source_analysis_batches\(\);/);
  assert.match(f, /b\.closed_at is null and b\.item_count is not null[\s\S]*?errcode = 'P0043'/);
  assert.match(f, /v_tz constant text := 'Europe\/Amsterdam';/);
  assert.match(f, /\(u\.created_at at time zone v_tz\)::date = \(now\(\) at time zone v_tz\)::date/);
  assert.match(f, /u\.batch_id is not null/);
  assert.match(f, /if v_used > 25 then[\s\S]*?errcode = 'P0042'/);
});

test('0016 enqueue outcomes: invalid, duplicate, already_active (open batch job elsewhere), recent (7 days, not counted), queued', () => {
  const f = fn('enqueue_source_analysis_batch');
  assert.match(f, /values \(p_batch_id, v_item\.item_position, null, 'invalid'\)/);
  assert.match(f, /if v_url = any\(v_seen\) then[\s\S]*?'duplicate'/);
  assert.match(f, /o\.batch_id is not null\s+and o\.status in \('pending', 'running'\)\s+and o\.expired_at is null[\s\S]*?'already_active'/);
  assert.match(f, /r\.status = 'succeeded'\s+and coalesce\(r\.finished_at, r\.updated_at\) >= now\(\) - interval '7 days'/);
  assert.match(f, /'recent', v_reused_job_id/);
  // Only queued lines create a job; the daily count counts jobs, so recent lines never count.
  assert.equal((f.match(/insert into restaurant_source_analysis_jobs/g) || []).length, 1);
  assert.match(f, /v_job_id, p_market_id, p_actor_user_id, v_url, 'pending', p_batch_id, v_host/);
  assert.match(f, /'queued', v_job_id/);
  assert.match(f, /if v_queued = 0 then[\s\S]*?close_reason = 'completed'/);
});

test('0016 claim: starter of this batch only, serialized, one active job overall, 60 s per host, next_attempt_at, 3-minute lease', () => {
  const f = fn('claim_next_source_analysis_job');
  assert.match(f, /perform pg_advisory_xact_lock\(4025, 2\);/);
  assert.match(f, /v_batch\.actor_user_id is distinct from p_actor_user_id then[\s\S]*?errcode = 'P0044'/);
  assert.match(f, /where r\.status = 'running' and r\.lease_expires_at > now\(\);[\s\S]*?claim_outcome := 'busy';/);
  assert.match(f, /where j\.batch_id = p_batch_id\s+and j\.status = 'pending'\s+and j\.expired_at is null\s+and \(j\.next_attempt_at is null or j\.next_attempt_at <= now\(\)\)/);
  assert.match(f, /h\.source_host = j\.source_host\s+and h\.finished_at > now\(\) - interval '60 seconds'/);
  assert.match(f, /limit 1\s+for update skip locked;/);
  assert.match(f, /set status = 'running',\s+claimed_at = now\(\),\s+lease_expires_at = now\(\) \+ interval '3 minutes'/);
  for (const o of ['claimed', 'busy', 'waiting', 'done']) assert.match(f, new RegExp(`claim_outcome := '${o}';`), o);
});

test('0016 retries: expired lease or transient failure retries the same job (2/10/30/30 min), max five attempts, terminal reasons at once', () => {
  const backoff = /case j\.attempt_count \+ 1\s+when 2 then interval '2 minutes'\s+when 3 then interval '10 minutes'\s+else interval '30 minutes'\s+end/;
  const claim = fn('claim_next_source_analysis_job');
  assert.match(claim, backoff);
  assert.match(claim, /\(j\.lease_expires_at is null or j\.lease_expires_at <= now\(\)\)\s+and j\.attempt_count < 5;/);
  assert.match(claim, /set status = 'failed',\s+error_reason = 'internal_error'/);
  const fail = fn('fail_source_analysis_job');
  assert.match(fail, backoff);
  assert.match(fail, /if p_error_reason in \('fetch_failed', 'internal_error'\) and v_job\.attempt_count < 5 then/);
  assert.match(fail, /errcode = 'P0046'/);
  assert.equal((fail.match(/insert into restaurant_source_analysis_jobs/g) || []).length, 0, 'a retry is never a new job');
  for (const name of ['complete_source_analysis_job', 'fail_source_analysis_job']) {
    const f = fn(name);
    assert.match(f, /v_job\.lease_expires_at <= now\(\) then[\s\S]*?errcode = 'P0045'/, name);
    assert.match(f, /errcode = 'P0044'/, name);
    assert.match(f, /then null else 'completed' end/, name);
  }
});

test('0016 expiry: 24 hours without activity closes the batch as expired and marks open jobs expired_at, without a new status', () => {
  const f = fn('expire_idle_source_analysis_batches');
  assert.match(f, /set closed_at = now\(\), close_reason = 'expired'/);
  assert.match(f, /b\.last_activity_at < now\(\) - interval '24 hours'/);
  assert.match(f, /set expired_at = now\(\), lease_expires_at = null, updated_at = now\(\)/);
  assert.match(f, /j\.status in \('pending', 'running'\)/);
  assert.doesNotMatch(code, /status = 'expired'|'paused'|'cancelled'/);
});

test('0016 batch intake (B2): starter only in v1, 7 days from receipt.created_at, stored hash, single use, issued_via_job_id', () => {
  const f = fn('create_url_intake_from_batch_job');
  assert.match(f, /v_job\.batch_id is null or v_job\.status <> 'succeeded' then[\s\S]*?errcode = 'P0047'/);
  assert.match(f, /v_batch\.actor_user_id is distinct from p_actor_user_id then[\s\S]*?errcode = 'P0044'/);
  assert.match(f, /r\.id = v_job\.result_receipt_id and r\.consumed_at is null\s+for update;/);
  assert.match(f, /v_receipt\.created_at < now\(\) - interval '7 days'/);
  assert.match(f, /v_receipt\.analysis_result_hash is distinct from p_expected_analysis_result_hash then[\s\S]*?errcode = 'P0049'/);
  assert.match(f, /set consumed_at = now\(\)\s+where id = v_receipt\.id\s+and consumed_at is null;/);
  assert.match(f, /issued_via_receipt_id, menu_candidate_summary, issued_via_job_id/);
  assert.match(f, /v_receipt\.id, v_receipt\.candidate_summary -> 'menus', p_job_id/);
  // Never checks the receipt's ten-minute expiry or its actor against the redeemer.
  assert.doesNotMatch(f, /expires_at/);
  assert.match(code, /create unique index if not exists \w+\s+on url_intakes \(issued_via_job_id\)\s+where issued_via_job_id is not null;/);
});
