'use strict';

// Structural safety net for supabase/migrations/0019_be27_menu_concept_exports.sql
// (BE-27 "Maak review-PR") — read from the file itself, like the other
// migration tests. The validate-migrations workflow replays every migration.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.resolve(__dirname, '..', '..', 'supabase/migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '0019_be27_menu_concept_exports.sql'), 'utf8');
const code = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('0019 has a unique number and only adds one table with its indexes — nothing altered, dropped or deleted', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => f.startsWith('0019')), ['0019_be27_menu_concept_exports.sql']);
  assert.deepEqual([...code.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]), ['menu_snapshot_exports']);
  assert.doesNotMatch(code, /alter table (?!menu_snapshot_exports enable row level security)|\bdrop\b|\bdelete\b|\btruncate\b|create or replace function/i);
  assert.match(code, /snapshot_id\s+bigint not null references menu_snapshot_proposals\(id\)/);
  assert.match(code, /created_by\s+uuid not null references auth\.users\(id\)/);
});

test('0019 provenance and idempotency: version, hashes, branch, commit, PR link; one active export per version and per restaurant', () => {
  for (const col of ['content_hash', 'export_hash', 'branch', 'commit_sha', 'pr_number', 'pr_url']) assert.ok(code.includes(`  ${col} `), col);
  assert.match(code, /status in \('pending', 'opened', 'failed', 'merged', 'closed'\)/);
  assert.match(code, /pr_url ~ '\^https:\/\/github\\.com\//);
  assert.match(code, /create unique index if not exists idx_menu_snapshot_exports_one_active_per_snapshot\s+on menu_snapshot_exports \(snapshot_id\)\s+where status in \('pending', 'opened'\);/);
  assert.match(code, /create unique index if not exists idx_menu_snapshot_exports_one_active_per_restaurant\s+on menu_snapshot_exports \(restaurant_id\)\s+where status in \('pending', 'opened'\);/);
});

test('0019 privileges: RLS on, service_role only, updates limited to the outcome columns, never delete', () => {
  assert.match(code, /alter table menu_snapshot_exports enable row level security;/);
  assert.doesNotMatch(code, /create policy/i);
  const grants = [...code.replace(/\s+/g, ' ').matchAll(/\bgrant [^;]*;/g)].map((m) => m[0]);
  assert.deepEqual(grants, [
    'grant select, insert on public.menu_snapshot_exports to service_role;',
    'grant update (status, export_hash, branch, commit_sha, pr_number, pr_url, error_reason, updated_at) on public.menu_snapshot_exports to service_role;',
    'grant usage, select on sequence public.menu_snapshot_exports_id_seq to service_role;',
  ]);
  assert.match(code, /revoke all on public\.menu_snapshot_exports from public, anon, authenticated, service_role;/);
});
