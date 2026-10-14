'use strict';

// Structural safety net for supabase/migrations/0018_be17_menu_concept_review.sql
// (BE-17 Menuconcepten beoordelen v1) — read from the file itself, like the
// other migration tests. The validate-migrations workflow replays every
// migration on an empty Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '0018_be17_menu_concept_review.sql'), 'utf8');
const code = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const SIG = 'record_menu_snapshot_decision(bigint, integer, text, text, text, uuid)';

test('0018 has a unique number and is additive: three nullable audit columns, two indexes, one function — nothing dropped or deleted', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => f.startsWith('0018')), ['0018_be17_menu_concept_review.sql']);
  assert.doesNotMatch(code, /\bdrop\b|\bdelete\b|\btruncate\b|create table|set not null/i);
  for (const m of code.matchAll(/add column [^,;]+/g)) assert.doesNotMatch(m[0], /not null|default/);
  assert.match(code, /add column if not exists created_by uuid references auth\.users\(id\)/);
  assert.match(code, /add column if not exists origin_receipt_id uuid references url_intake_analysis_receipts\(id\)/);
  assert.match(code, /add column if not exists based_on_snapshot_id bigint references menu_snapshot_proposals\(id\)/);
  assert.match(code, /check \(based_on_snapshot_id is null or based_on_snapshot_id <> id\)/);
  assert.match(code, /create index if not exists idx_menu_snapshot_proposals_origin_receipt[\s\S]*?where origin_receipt_id is not null/);
  assert.match(code, /create index if not exists idx_menu_snapshot_proposals_based_on[\s\S]*?where based_on_snapshot_id is not null/);
  assert.deepEqual([...code.matchAll(/create or replace function (\w+)/g)].map((m) => m[1]), ['record_menu_snapshot_decision']);
});

test('0018 keeps versions and reviews append-only: no table grant, no update path; execute for service_role only', () => {
  assert.doesNotMatch(code, /\bupdate\b/i);
  const flat = code.replace(/\s+/g, ' ');
  assert.deepEqual([...flat.matchAll(/\bgrant [^;]*;/g)].map((m) => m[0]), [`grant execute on function ${SIG} to service_role;`]);
  assert.ok(flat.indexOf(`revoke all on function ${SIG} from public, anon, authenticated, service_role;`) < flat.indexOf(`grant execute on function ${SIG}`));
  assert.equal((code.match(/security invoker/g) || []).length, 1);
  assert.doesNotMatch(code, /security definer/i);
  assert.match(code, /set search_path = public/);
});

test('0018 decision: only approve/reject, latest expected version under a lineage lock, idempotent, one insert into reviews', () => {
  assert.match(code, /p_decision not in \('approved_internal', 'rejected'\)[\s\S]*?errcode = 'P0062'/);
  assert.match(code, /errcode = 'P0060'/);
  assert.match(code, /perform pg_advisory_xact_lock\(4026, hashtext\(v_snapshot\.restaurant_id \|\| '\/' \|\| v_snapshot\.menu_context\)\);/);
  assert.match(code, /v_snapshot\.version is distinct from p_expected_version or v_snapshot\.version <> v_latest[\s\S]*?errcode = 'P0061'/);
  assert.match(code, /v_last\.decision = p_decision\s+and v_last\.reason is not distinct from p_reason[\s\S]*?created := false;/);
  assert.equal((code.match(/insert into menu_snapshot_reviews/g) || []).length, 1);
  assert.doesNotMatch(code, /insert into menu_snapshot_proposals|menus\.json|pending_changes|field_provenance/);
});

test('0018 error codes are new and do not collide with earlier migrations', () => {
  const used = [...new Set([...code.matchAll(/errcode = '(P\d{4})'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(used, ['P0060', 'P0061', 'P0062']);
  const earlier = new Set();
  for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f < '0018')) {
    for (const m of fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').matchAll(/errcode = '(P\d{4})'/g)) earlier.add(m[1]);
  }
  for (const c of used) assert.ok(!earlier.has(c), c);
});
