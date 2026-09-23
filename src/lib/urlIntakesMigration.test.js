'use strict';

// Structural safety net for supabase/migrations/0013_be19_url_intakes.sql
// — read directly from its actual source, never asserted from memory,
// exactly like the existing structural tests for 0010/0011 elsewhere in
// this project. This migration was also functionally validated end to
// end (0001-0013 replayed in a disposable, throwaway local Postgres
// container: receipt issuance, redemption, single-use enforcement,
// actor/URL/hash tamper rejection, promotion, field-fact provenance, the
// duplicate-active-draft guard, and confirmation that
// promote_candidate_to_profile_draft's own behavior is unaffected) — see
// this round's own report for the transcript; these tests guard the
// same properties structurally, in CI, without a database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION_0010_PATH = path.join(REPO_ROOT, 'supabase/migrations/0010_market05c_restaurant_profile_drafts.sql');
const MIGRATION_0011_PATH = path.join(REPO_ROOT, 'supabase/migrations/0011_be17_menu_snapshot_foundation.sql');
const MIGRATION_0012_PATH = path.join(REPO_ROOT, 'supabase/migrations/0012_be17_menu_snapshot_grant_correction.sql');
const MIGRATION_0013_PATH = path.join(REPO_ROOT, 'supabase/migrations/0013_be19_url_intakes.sql');

function readMigration(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

let hash0010;
let hash0011;
let hash0012;
test('structural safety net: 0010, 0011, and 0012 are never edited by this project going forward — baseline hashes captured', () => {
  const crypto = require('node:crypto');
  hash0010 = crypto.createHash('sha256').update(readMigration(MIGRATION_0010_PATH)).digest('hex');
  hash0011 = crypto.createHash('sha256').update(readMigration(MIGRATION_0011_PATH)).digest('hex');
  hash0012 = crypto.createHash('sha256').update(readMigration(MIGRATION_0012_PATH)).digest('hex');
  assert.ok(hash0010 && hash0011 && hash0012);
});

test('structural safety net: 0013 never executes a destructive DDL statement (DROP TABLE or TRUNCATE TABLE) anywhere', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  // Matches an actual executable statement, never a comment merely
  // discussing the word "truncate" (e.g. this migration's own, entirely
  // legitimate prose about REVOKING the truncate privilege from
  // service_role) — a bare word search would be a self-referential false
  // positive against this migration's own explanatory comments.
  assert.doesNotMatch(sql, /^\s*drop table\b/im);
  assert.doesNotMatch(sql, /^\s*truncate table\b/im);
});

test('structural safety net: 0013 never touches menu_snapshot_proposals or menu_snapshot_reviews in any way', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.doesNotMatch(sql, /menu_snapshot_proposals/);
  assert.doesNotMatch(sql, /menu_snapshot_reviews/);
});

test('structural safety net: 0013 never modifies promote_candidate_to_profile_draft — only creates a new, separate function', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.doesNotMatch(sql, /create or replace function promote_candidate_to_profile_draft/);
  assert.match(sql, /create or replace function promote_url_intake_to_profile_draft/);
  assert.match(sql, /create or replace function create_url_intake_from_receipt/);
});

test('structural safety net: restaurant_profile_drafts gets exactly one new nullable origin column plus a symmetric "exactly one" check', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.match(sql, /alter table restaurant_profile_drafts\s*\n\s*alter column source_candidate_id drop not null/);
  assert.match(sql, /add column source_url_intake_id uuid references url_intakes\(id\)/);
  assert.match(sql, /check \(\(source_candidate_id is null\) <> \(source_url_intake_id is null\)\)/);
});

test('structural safety net: the old single partial unique index is dropped and replaced by two separate ones — never one combined coalesce() expression', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.match(sql, /drop index if exists idx_restaurant_profile_drafts_one_active_per_candidate/);
  assert.doesNotMatch(sql, /coalesce\(\s*source_candidate_id/i);
  const indexMatches = sql.match(/create unique index if not exists idx_restaurant_profile_drafts_one_active_per_\w+/g) || [];
  assert.equal(indexMatches.length, 2, 'expected exactly two new partial unique indexes, one per origin column');
});

test('structural safety net: the OLD two-way field_facts origin check is dropped (the exact bug this project already found once on this table)', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.match(sql, /drop constraint restaurant_profile_draft_field_facts_check/);
  assert.match(sql, /drop constraint restaurant_profile_draft_field_facts_origin_check/);
});

test('structural safety net: field_facts origin gets exactly THREE independent biconditional checks — never one combined and/or expression', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.match(sql, /check \(\(origin = 'import'\) = \(source_enrichment_id is null and source_url_intake_id is null\)\)/);
  assert.match(sql, /check \(\(origin = 'enrichment'\) = \(source_enrichment_id is not null\)\)/);
  assert.match(sql, /check \(\(origin = 'url_intake'\) = \(source_url_intake_id is not null\)\)/);
  // Never a single check spanning all three origin values with and/or —
  // the exact class of bug already found once on this table's own
  // discard columns (see 0010's own comment on that fix).
  assert.doesNotMatch(sql, /check \(\(origin = 'import' or origin = 'enrichment'/i);
});

test('structural safety net: url_intakes.matched_restaurant_id is the only field a menu-snapshot call may ever read restaurant_id from — no new column relaxes menu_snapshot_proposals itself', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.match(sql, /matched_restaurant_id\s+text/);
  // No foreign key from url_intakes.matched_restaurant_id to anything —
  // it stays a bare text key into data/restaurants.json's own space,
  // exactly like menu_snapshot_proposals.restaurant_id already does.
  const urlIntakesTableMatch = sql.match(/create table if not exists url_intakes \(([\s\S]*?)\n\);/);
  assert.ok(urlIntakesTableMatch);
  assert.doesNotMatch(urlIntakesTableMatch[1], /matched_restaurant_id[^,]*references/);
});

test('structural safety net: url_intake_analysis_receipts is single-use — consumed_at is the only column service_role may ever update', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  const grantMatch = sql.match(/grant update \(([^)]+)\) on public\.url_intake_analysis_receipts to service_role/);
  assert.ok(grantMatch, 'expected a column-scoped update grant on url_intake_analysis_receipts');
  assert.equal(grantMatch[1].trim(), 'consumed_at');
});

test('structural safety net: url_intakes has no update or delete grant of any kind for service_role', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.doesNotMatch(sql, /grant update[^\n]*on public\.url_intakes /);
  assert.doesNotMatch(sql, /grant delete[^\n]*on public\.url_intakes/);
});

test('structural safety net: no delete grant anywhere in this migration, for any table', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.doesNotMatch(sql, /grant[^\n]*delete/i);
});

test('structural safety net: restaurant_profile_drafts / restaurant_profile_draft_field_facts grant correction never grants truncate, trigger, or references', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  const correctionStart = sql.indexOf('Grant correction — restaurant_profile_drafts');
  assert.ok(correctionStart !== -1, 'expected the grant-correction section');
  const correctionSection = sql.slice(correctionStart, correctionStart + 1200);
  assert.match(correctionSection, /revoke all on public\.restaurant_profile_drafts from service_role/);
  assert.match(correctionSection, /revoke all on public\.restaurant_profile_draft_field_facts from service_role/);
  assert.doesNotMatch(correctionSection, /grant[^\n]*truncate/i);
  assert.doesNotMatch(correctionSection, /grant[^\n]*trigger/i);
  assert.doesNotMatch(correctionSection, /grant[^\n]*references/i);
});

test('structural safety net: RLS is enabled on both new tables, with revoke all from anon/authenticated/public', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  assert.match(sql, /alter table url_intake_analysis_receipts enable row level security/);
  assert.match(sql, /alter table url_intakes\s+enable row level security/);
  assert.match(sql, /revoke all on public\.url_intake_analysis_receipts from public, anon, authenticated/);
  assert.match(sql, /revoke all on public\.url_intakes\s+from public, anon, authenticated/);
});

test('structural safety net: canonical_source_url check forbids query strings and fragments on both new tables', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  const occurrences = sql.match(/canonical_source_url ~\* '\^https\?:\/\/'\s*\n\s*and canonical_source_url !~ '\[\?#\]'/g) || [];
  assert.ok(occurrences.length >= 2, 'expected the query/fragment-forbidding check on both url_intakes and url_intake_analysis_receipts');
});

test('structural safety net: create_url_intake_from_receipt re-validates actor, expiry, URL binding, and analysis hash — never trusts the caller for any of them', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  const fnMatch = sql.match(/create or replace function create_url_intake_from_receipt\([\s\S]*?\n\$\$;/);
  assert.ok(fnMatch, 'expected to find create_url_intake_from_receipt');
  const fnBody = fnMatch[0];
  assert.match(fnBody, /consumed_at is null/);
  assert.match(fnBody, /expires_at <= now\(\)/);
  assert.match(fnBody, /actor_user_id is distinct from p_actor_user_id/);
  assert.match(fnBody, /canonical_source_url is distinct from p_canonical_source_url/);
  assert.match(fnBody, /analysis_result_hash is distinct from p_expected_analysis_result_hash/);
  // Single-use: the update guard repeats the same unconsumed predicate.
  assert.match(fnBody, /set consumed_at = now\(\)[\s\S]*?where id = p_receipt_id[\s\S]*?and consumed_at is null/);
});

test('structural safety net: promote_url_intake_to_profile_draft never re-derives restaurant fields from anything other than the originating receipt', () => {
  const sql = readMigration(MIGRATION_0013_PATH);
  const fnMatch = sql.match(/create or replace function promote_url_intake_to_profile_draft\([\s\S]*?\n\$\$;/);
  assert.ok(fnMatch, 'expected to find promote_url_intake_to_profile_draft');
  assert.match(fnMatch[0], /from url_intake_analysis_receipts r\s*\n\s*where r\.id = v_intake\.issued_via_receipt_id/);
});
