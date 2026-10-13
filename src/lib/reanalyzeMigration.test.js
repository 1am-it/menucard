'use strict';

// Structural safety net for supabase/migrations/0017_be25_reanalyze_one_url.sql
// ("Opnieuw analyseren": one fresh analysis after an explicit click) — read
// from the file itself, like the other migration tests. The
// validate-migrations workflow replays every migration on an empty Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '0017_be25_reanalyze_one_url.sql'), 'utf8');
const code = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const SIG = 'enqueue_source_reanalysis(uuid, uuid, uuid, text)';

test('0017 has a unique number and only adds one function — no table, column, index, grant on a table or change to 0016', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => f.startsWith('0017')), ['0017_be25_reanalyze_one_url.sql']);
  assert.deepEqual([...code.matchAll(/create or replace function (\w+)/g)].map((m) => m[1]), ['enqueue_source_reanalysis']);
  assert.doesNotMatch(code, /create table|alter table|create (unique )?index|\bdrop\b|\bdelete\b|grant [^;]* on (public\.)?\w+ to/i);
  assert.doesNotMatch(code, /function enqueue_source_analysis_batch|function claim_next_source_analysis_job/);
});

test('0017 privileges: security invoker, fixed search_path, revoked from every role, execute for service_role only', () => {
  assert.equal((code.match(/security invoker/g) || []).length, 1);
  assert.doesNotMatch(code, /security definer/i);
  assert.equal((code.match(/set search_path = public/g) || []).length, 1);
  const flat = code.replace(/\s+/g, ' ');
  const revoke = flat.indexOf(`revoke all on function ${SIG} from public, anon, authenticated, service_role;`);
  const grant = flat.indexOf(`grant execute on function ${SIG} to service_role;`);
  assert.ok(revoke >= 0 && revoke < grant);
  assert.deepEqual([...flat.matchAll(/\bgrant [^;]*;/g)].map((m) => m[0]), [`grant execute on function ${SIG} to service_role;`]);
});

test('0017 keeps every enqueue safeguard: lock, idempotency, one open batch, already-active URL, daily limit of 25 per Amsterdam day', () => {
  assert.match(code, /perform pg_advisory_xact_lock\(4025, 1\);/);
  assert.match(code, /if v_batch\.actor_user_id is distinct from p_actor_user_id then[\s\S]*?errcode = 'P0040'[\s\S]*?return v_batch;/);
  assert.match(code, /perform expire_idle_source_analysis_batches\(\);/);
  assert.match(code, /b\.closed_at is null and b\.item_count is not null[\s\S]*?errcode = 'P0043'/);
  assert.match(code, /o\.batch_id is not null\s+and o\.status in \('pending', 'running'\)\s+and o\.expired_at is null[\s\S]*?'already_active'/);
  assert.match(code, /v_tz constant text := 'Europe\/Amsterdam';/);
  assert.match(code, /if v_used > 25 then[\s\S]*?errcode = 'P0042'/);
  assert.match(code, /values \(p_batch_id, p_market_id, p_actor_user_id, now\(\), now\(\), 1\)/);
});

test('0017 is a fresh analysis: exactly one queued job, never the 7-day "recent" reuse', () => {
  assert.equal((code.match(/insert into restaurant_source_analysis_jobs/g) || []).length, 1);
  assert.match(code, /'queued', v_job_id/);
  assert.doesNotMatch(code, /'recent'|interval '7 days'|reused_job_id/);
});

test('0017 error codes: only existing meanings plus the new P0050, none colliding with earlier migrations', () => {
  const used = [...new Set([...code.matchAll(/errcode = '(P\d{4})'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(used, ['P0040', 'P0042', 'P0043', 'P0050']);
  const earlier = new Set();
  for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f < '0017')) {
    for (const m of fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').matchAll(/errcode = '(P\d{4})'/g)) earlier.add(m[1]);
  }
  assert.ok(!earlier.has('P0050'));
});
