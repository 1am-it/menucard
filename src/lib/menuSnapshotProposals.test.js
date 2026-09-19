'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  computeCanonicalContentHash,
  DEFAULT_SNAPSHOT_STATUS,
  pickLatestSnapshotReviewRow,
  deriveEffectiveSnapshotStatus,
} = require('./menuSnapshotProposals');

test('computeCanonicalContentHash: identical content produces an identical hash', () => {
  const content = { categories: [{ name: 'Dinerkaart', items: [{ name: 'Tournedos', price: '22,50' }] }] };
  const hashA = computeCanonicalContentHash(content);
  const hashB = computeCanonicalContentHash(JSON.parse(JSON.stringify(content)));
  assert.equal(hashA, hashB);
  assert.match(hashA, /^[0-9a-f]{64}$/, 'must be exactly the 64-character lowercase hex shape the migration constraint requires');
});

test('computeCanonicalContentHash: key order never changes the hash', () => {
  const contentA = { b: 2, a: 1, categories: [{ name: 'Lunchkaart', items: [] }] };
  const contentB = { a: 1, categories: [{ items: [], name: 'Lunchkaart' }], b: 2 };
  assert.equal(computeCanonicalContentHash(contentA), computeCanonicalContentHash(contentB));
});

test('computeCanonicalContentHash: array order is preserved and does change the hash', () => {
  const dishesInOrder = { items: ['Tournedos', 'Zalm'] };
  const dishesReordered = { items: ['Zalm', 'Tournedos'] };
  assert.notEqual(computeCanonicalContentHash(dishesInOrder), computeCanonicalContentHash(dishesReordered));
});

test('computeCanonicalContentHash: genuinely different content produces a different hash', () => {
  const original = { categories: [{ name: 'Dinerkaart', items: [{ name: 'Tournedos', price: '22,50' }] }] };
  const changedPrice = { categories: [{ name: 'Dinerkaart', items: [{ name: 'Tournedos', price: '24,50' }] }] };
  assert.notEqual(computeCanonicalContentHash(original), computeCanonicalContentHash(changedPrice));
});

test('pickLatestSnapshotReviewRow: picks the row with the latest decided_at', () => {
  const rows = [
    { id: 1, decided_at: '2026-09-18T10:00:00Z', decision: 'needs_review' },
    { id: 2, decided_at: '2026-09-19T10:00:00Z', decision: 'approved_internal' },
  ];
  assert.equal(pickLatestSnapshotReviewRow(rows).decision, 'approved_internal');
});

test('pickLatestSnapshotReviewRow: ties on decided_at break toward the higher id', () => {
  const sameTimestamp = '2026-09-19T10:00:00Z';
  const rows = [
    { id: 5, decided_at: sameTimestamp, decision: 'rejected', reason: 'other' },
    { id: 7, decided_at: sameTimestamp, decision: 'approved_internal' },
  ];
  assert.equal(pickLatestSnapshotReviewRow(rows).id, 7);
});

test('pickLatestSnapshotReviewRow: null for no rows, never throws on malformed input', () => {
  assert.equal(pickLatestSnapshotReviewRow([]), null);
  assert.equal(pickLatestSnapshotReviewRow(null), null);
  assert.equal(pickLatestSnapshotReviewRow(undefined), null);
  assert.doesNotThrow(() => pickLatestSnapshotReviewRow([null, undefined, { id: 1 }]));
});

test('deriveEffectiveSnapshotStatus: unreviewed when no review rows exist yet', () => {
  assert.equal(deriveEffectiveSnapshotStatus([]), DEFAULT_SNAPSHOT_STATUS);
});

test('deriveEffectiveSnapshotStatus: reflects the latest decision, including a later correction', () => {
  const rows = [
    { id: 1, decided_at: '2026-09-18T10:00:00Z', decision: 'approved_internal' },
    { id: 2, decided_at: '2026-09-19T10:00:00Z', decision: 'rejected', reason: 'content_mismatch' },
  ];
  assert.equal(deriveEffectiveSnapshotStatus(rows), 'rejected');
});

// ─── Structural safety net: append-only shape and "never a public/
// canonical write" are read directly from the actual migration file, not
// asserted from memory — this fails the moment either guarantee is
// weakened by a future edit. No route exists against these tables yet,
// so there is nothing else to check this against besides the schema
// itself. ─────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase/migrations/0011_be17_menu_snapshot_foundation.sql');

// Consumer-facing canonical data does not live in a Supabase table in
// this project at all yet (see docs/api/import-inbox-api.md) — it is
// static JSON under data/. "Never a canonical/public write" therefore
// means: this migration never references any of these table/file
// identifiers.
test('structural safety net: the BE-17 migration grants only select/insert on both new tables, never update/delete/truncate', () => {
  const source = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(source, /grant select, insert on public\.menu_snapshot_proposals to service_role;/);
  assert.match(source, /grant select, insert on public\.menu_snapshot_reviews to service_role;/);
  assert.doesNotMatch(source, /grant[^;]*\bupdate\b[^;]*on public\.menu_snapshot_(proposals|reviews)/i);
  assert.doesNotMatch(source, /grant[^;]*\bdelete\b[^;]*on public\.menu_snapshot_(proposals|reviews)/i);
  assert.doesNotMatch(source, /grant[^;]*\btruncate\b[^;]*on public\.menu_snapshot_(proposals|reviews)/i);
});

test('structural safety net: the BE-17 migration only creates new tables — every ALTER TABLE targets one of the two new tables, and nothing is ever dropped', () => {
  const source = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const alterLines = source.split('\n').filter((line) => /^\s*alter table\b/i.test(line));
  assert.ok(alterLines.length > 0, 'expected at least the two RLS-enabling ALTER TABLE statements');
  for (const line of alterLines) {
    assert.match(line, /alter table menu_snapshot_(proposals|reviews)\b/i, `unexpected ALTER TABLE target: ${line}`);
  }
  assert.doesNotMatch(source, /\bdrop table\b/i);
  assert.doesNotMatch(source, /\bdrop column\b/i);
});

test('structural safety net: the BE-17 migration adds no review_status/publication_status column to menu_snapshot_proposals', () => {
  const source = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const tableDefinition = source.slice(
    source.indexOf('create table if not exists menu_snapshot_proposals'),
    source.indexOf('create table if not exists menu_snapshot_reviews')
  );
  assert.doesNotMatch(tableDefinition, /review_status|publication_status/);
});
