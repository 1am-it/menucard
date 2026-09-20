'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_SNAPSHOT_STATUS,
  pickLatestSnapshotReviewRow,
  deriveEffectiveSnapshotStatus,
  validateSnapshotProposalInput,
  snapshotProposalValidationMessage,
  validateSnapshotReviewInput,
  snapshotReviewValidationMessage,
  groupReviewsBySnapshotId,
} = require('./menuSnapshotProposals');

// computeCanonicalContentHash's own tests moved to
// src/lib/menuSnapshotHash.test.js alongside the server-only module that
// now owns that logic (see this file's own structural safety-net test
// below for why it moved).

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

test('validateSnapshotProposalInput: accepts a well-formed proposal', () => {
  const result = validateSnapshotProposalInput({
    restaurantId: '23',
    menuContext: '23-borrel',
    sourceUrl: 'https://example.com/menu',
    sourceType: 'own_website',
    qualityScore: 'high',
    capturedContent: { categories: [] },
  });
  assert.equal(result.valid, true);
  assert.equal(result.restaurantId, '23');
});

test('validateSnapshotProposalInput: rejects a menu_context that does not match the migration\'s own regex', () => {
  const result = validateSnapshotProposalInput({
    restaurantId: '23',
    menuContext: 'not-valid-format-123',
    sourceUrl: 'https://example.com/menu',
    sourceType: 'own_website',
    qualityScore: 'high',
    capturedContent: { categories: [] },
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid-menu-context');
});

test('validateSnapshotProposalInput: rejects a non-http(s) source_url, an unknown source_type/quality_score, and non-object captured_content', () => {
  const base = { restaurantId: '23', menuContext: '23-borrel', sourceUrl: 'https://example.com/menu', sourceType: 'own_website', qualityScore: 'high', capturedContent: {} };
  assert.equal(validateSnapshotProposalInput({ ...base, sourceUrl: 'not a url' }).reason, 'invalid-source-url');
  assert.equal(validateSnapshotProposalInput({ ...base, sourceType: 'scraped' }).reason, 'invalid-source-type');
  assert.equal(validateSnapshotProposalInput({ ...base, qualityScore: 'excellent' }).reason, 'invalid-quality-score');
  assert.equal(validateSnapshotProposalInput({ ...base, capturedContent: 'a plain string' }).reason, 'invalid-captured-content');
  assert.equal(validateSnapshotProposalInput({ ...base, capturedContent: null }).reason, 'invalid-captured-content');
});

test('snapshotProposalValidationMessage: returns a human-readable message for every reason validateSnapshotProposalInput can return', () => {
  for (const reason of ['invalid-restaurant-id', 'invalid-menu-context', 'invalid-source-url', 'invalid-source-type', 'invalid-quality-score', 'invalid-captured-content']) {
    assert.equal(typeof snapshotProposalValidationMessage(reason), 'string');
  }
});

test('validateSnapshotReviewInput: reason required exactly when decision is rejected, mirroring the migration\'s own symmetric check', () => {
  assert.equal(validateSnapshotReviewInput({ decision: 'approved_internal' }).valid, true);
  assert.equal(validateSnapshotReviewInput({ decision: 'rejected' }).reason, 'missing-reason');
  assert.equal(validateSnapshotReviewInput({ decision: 'rejected', reason: 'other' }).valid, true);
  assert.equal(validateSnapshotReviewInput({ decision: 'approved_internal', reason: 'other' }).reason, 'reason-not-allowed');
  assert.equal(validateSnapshotReviewInput({ decision: 'rejected', reason: 'not-a-real-reason' }).reason, 'invalid-reason');
});

test('validateSnapshotReviewInput: rejects an unknown decision and an over-long note', () => {
  assert.equal(validateSnapshotReviewInput({ decision: 'archived' }).reason, 'invalid-decision');
  assert.equal(validateSnapshotReviewInput({ decision: 'approved_internal', note: 'x'.repeat(2001) }).reason, 'note-too-long');
});

test('groupReviewsBySnapshotId: groups by snapshot_id and ignores malformed rows without throwing', () => {
  const grouped = groupReviewsBySnapshotId([
    { snapshot_id: 1, decision: 'approved_internal' },
    { snapshot_id: 2, decision: 'rejected' },
    { snapshot_id: 1, decision: 'rejected' },
    null,
    { decision: 'approved_internal' },
  ]);
  assert.equal(grouped['1'].length, 2);
  assert.equal(grouped['2'].length, 1);
  assert.equal(grouped['3'], undefined);
});

// ─── Structural safety net: append-only shape and "never a public/
// canonical write" are read directly from the actual migration file, not
// asserted from memory — this fails the moment either guarantee is
// weakened by a future edit. The same discipline is applied below to the
// two BE-17 routes themselves, now that they exist. ────────────────────

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

// ─── Structural safety net: this module must stay importable from the
// 'use client' Onboarding Menu page — a Vercel production build once
// failed (commit 9fee5f7) because this file pulled `node:crypto` into
// the browser bundle via app/internal/onboarding-menu/page.js. The hash
// logic that needed `node:crypto` now lives in the separate, server-only
// src/lib/menuSnapshotHash.js instead; these tests fail the moment
// either file drifts back toward that regression. ──────────────────────

const MENU_SNAPSHOT_PROPOSALS_PATH = path.join(__dirname, 'menuSnapshotProposals.js');
const ONBOARDING_MENU_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/onboarding-menu/page.js');

test('structural safety net: src/lib/menuSnapshotProposals.js never reintroduces node:crypto or any other Node-only API', () => {
  const source = fs.readFileSync(MENU_SNAPSHOT_PROPOSALS_PATH, 'utf8');
  assert.doesNotMatch(source, /node:crypto/, 'menuSnapshotProposals.js must stay safely importable from a \'use client\' component');
  assert.doesNotMatch(source, /require\(['"]crypto['"]\)/);
});

test('structural safety net: the Onboarding Menu client page never imports the server-only hash module or node:crypto directly', () => {
  const source = fs.readFileSync(ONBOARDING_MENU_PAGE_PATH, 'utf8');
  assert.doesNotMatch(source, /menuSnapshotHash/, 'the hash module is server-only — a client page must never import it');
  assert.doesNotMatch(source, /node:crypto/);
});

test('structural safety net: Onboarding Menu passes roles to InternalNav unchanged — regression guard for the premature "No internal access" flash', () => {
  const source = fs.readFileSync(ONBOARDING_MENU_PAGE_PATH, 'utf8');
  assert.match(
    source,
    /<InternalNav accessToken={session\.access_token} roles={roles} \/>/,
    'InternalNav must receive the raw roles value (undefined while still loading), never a substituted value'
  );
  assert.doesNotMatch(
    source,
    /roles=\{rolesLoaded \? roles : \[\]\}/,
    'substituting [] for roles while still loading defeats InternalNav\'s own "roles !== undefined means already resolved" check and reintroduces the premature "No internal access" message in the shared nav'
  );
});

// ─── Structural safety net: the two BE-17 routes themselves — read
// directly from their actual source, not asserted from memory. ────────

const PROPOSALS_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/menu-snapshots/route.js');
const REVIEWS_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/menu-snapshots/[id]/reviews/route.js');
const FORBIDDEN_CANONICAL_IDENTIFIERS = ['data/restaurants.json', 'data/menus.json'];

test('structural safety net: both BE-17 routes call authenticateInternalRequest before doing anything else', () => {
  for (const routePath of [PROPOSALS_ROUTE_PATH, REVIEWS_ROUTE_PATH]) {
    const source = fs.readFileSync(routePath, 'utf8');
    assert.match(source, /authenticateInternalRequest\(request\)/);
    assert.match(source, /if \(!auth\.ok\)/);
  }
});

test('structural safety net: only "internal" may create a proposal, only "editor" may record a review decision', () => {
  const proposalsSource = fs.readFileSync(PROPOSALS_ROUTE_PATH, 'utf8');
  const postProposals = proposalsSource.slice(proposalsSource.indexOf('export async function POST'));
  assert.match(postProposals, /isInternalOnly\(auth\.roles\)/);
  assert.doesNotMatch(postProposals, /isEditor\(auth\.roles\)/);

  const reviewsSource = fs.readFileSync(REVIEWS_ROUTE_PATH, 'utf8');
  const postReviews = reviewsSource.slice(reviewsSource.indexOf('export async function POST'));
  assert.match(postReviews, /isEditor\(auth\.roles\)/);
  assert.doesNotMatch(postReviews, /isInternalOnly\(auth\.roles\)/);
});

test('structural safety net: neither BE-17 route ever calls .update( or .delete( on either table, and content_hash is never accepted from the request body', () => {
  for (const routePath of [PROPOSALS_ROUTE_PATH, REVIEWS_ROUTE_PATH]) {
    const source = fs.readFileSync(routePath, 'utf8');
    assert.doesNotMatch(source, /\.update\(/, `${routePath} must never attempt to update a row`);
    assert.doesNotMatch(source, /\.delete\(/, `${routePath} must never attempt to delete a row`);
    assert.doesNotMatch(source, /body\.content_hash|body\?\.content_hash/, `${routePath} must never read content_hash from the request body`);
  }
});

test('structural safety net: neither BE-17 route ever references public/canonical menu or restaurant data', () => {
  for (const routePath of [PROPOSALS_ROUTE_PATH, REVIEWS_ROUTE_PATH]) {
    const source = fs.readFileSync(routePath, 'utf8');
    for (const identifier of FORBIDDEN_CANONICAL_IDENTIFIERS) {
      assert.equal(source.includes(identifier), false, `${routePath} must never reference "${identifier}"`);
    }
  }
});

test('structural safety net: the proposals route computes content_hash itself via computeCanonicalContentHash before inserting', () => {
  const source = fs.readFileSync(PROPOSALS_ROUTE_PATH, 'utf8');
  assert.match(source, /computeCanonicalContentHash\(/);
  const insertCallIndex = source.indexOf(".from('menu_snapshot_proposals')\n    .insert(");
  const hashComputedIndex = source.indexOf('computeCanonicalContentHash(');
  assert.ok(hashComputedIndex !== -1 && insertCallIndex !== -1 && hashComputedIndex < insertCallIndex, 'content_hash must be computed before the insert call');
});
