'use strict';

// Structural safety net for supabase/migrations/0020_be25_menu_structure_reviews.sql
// (#59, Delivery Lead review 6307703713) — read from the file itself, like the
// other migration tests. The validate-migrations workflow replays every
// migration on an empty Postgres; this test guards the additive, append-only
// shape before that ever runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '0020_be25_menu_structure_reviews.sql'), 'utf8');
const code = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const flat = code.replace(/\s+/g, ' ');

test('0020 has a unique number and is additive: one new table, no dropped or changed object', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => f.startsWith('0020')), ['0020_be25_menu_structure_reviews.sql']);
  assert.deepEqual([...code.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]), ['menu_structure_reviews']);
  assert.doesNotMatch(code, /\bdrop\b|\bdelete\b|\btruncate\b|rename|alter column|set not null/i);
  // The only ALTER is enabling RLS on the new table.
  for (const m of code.matchAll(/alter table (\w+)\s+(.+);/gi)) {
    assert.equal(m[1], 'menu_structure_reviews');
    assert.match(m[2].trim(), /^enable row level security$/i);
  }
  assert.doesNotMatch(code, /create or replace function|\bcreate function\b|security definer/i);
  // It never touches existing contract tables.
  assert.doesNotMatch(code, /menu_snapshot|source_triage_proposals|url_intakes\b|menus\.json|pending_changes|field_provenance/);
});

test('0020 keeps the trail append-only: select + insert for service_role only, no update or delete anywhere', () => {
  assert.match(flat, /alter table menu_structure_reviews enable row level security;/);
  const grants = [...flat.matchAll(/\bgrant [^;]*;/g)].map((m) => m[0]);
  assert.deepEqual(grants, [
    'grant select, insert on public.menu_structure_reviews to service_role;',
    'grant usage, select on sequence public.menu_structure_reviews_id_seq to service_role;',
  ]);
  const revoke = 'revoke all on public.menu_structure_reviews from public, anon, authenticated;';
  assert.ok(flat.indexOf(revoke) >= 0);
  assert.ok(flat.indexOf(revoke) < flat.indexOf(grants[0]));
  assert.match(flat, /revoke all on public\.menu_structure_reviews from service_role;/);
  // The identity sequence needs the same explicit revoke/grant as 0015/0019,
  // otherwise an insert can fail or the sequence stays reachable for other roles.
  const sequenceRevoke = 'revoke all on sequence public.menu_structure_reviews_id_seq from public, anon, authenticated, service_role;';
  assert.ok(flat.includes(sequenceRevoke));
  assert.ok(flat.indexOf(sequenceRevoke) < flat.indexOf(grants[1]));
  assert.doesNotMatch(flat, /grant [^;]*(update|delete)/i);
  assert.doesNotMatch(flat, /to (public|anon|authenticated)\b/i);
  assert.doesNotMatch(flat, /grant [^;]* on (?:all )?sequences? in schema/i);
});

test('0020 pins a decision to one receipt section, with an auditable old → new path', () => {
  assert.match(flat, /decision text not null check \(decision in \('keep', 'correct'\)\)/);
  assert.match(flat, /unique \(receipt_id, path_key\)/);
  assert.match(flat, /check \(\(decision = 'correct'\) = \(corrected_path is not null\)\)/);
  for (const column of ['original_path', 'path_key', 'source_path', 'locator', 'corrected_path']) {
    assert.match(flat, new RegExp(`${column} `), column);
  }
  // Who, when, which batch/job/result: every binding is a real foreign key.
  assert.match(flat, /market_id uuid not null references markets\(id\)/);
  assert.match(flat, /batch_id uuid not null references url_intake_batches\(id\)/);
  assert.match(flat, /job_id uuid not null references restaurant_source_analysis_jobs\(id\)/);
  assert.match(flat, /receipt_id uuid not null references url_intake_analysis_receipts\(id\)/);
  assert.match(flat, /actor_user_id uuid not null references auth\.users\(id\)/);
  assert.match(flat, /created_at timestamptz not null default now\(\)/);
  assert.match(flat, /create index if not exists idx_menu_structure_reviews_batch\s+on menu_structure_reviews \(batch_id, receipt_id\);/);
  assert.match(flat, /create index if not exists idx_menu_structure_reviews_job\s+on menu_structure_reviews \(job_id\);/);
});

test('0020 writes nothing automatically: no review, confirmation or publication is triggered by the schema', () => {
  assert.doesNotMatch(code, /\binsert into\b|\bupdate\b|\bdelete\b/i);
  assert.doesNotMatch(code, /publish|activate|export|approve/i);
});
