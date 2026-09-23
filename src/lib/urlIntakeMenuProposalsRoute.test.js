'use strict';

// Structural safety net for
// app/api/internal/v1/url-intakes/[id]/menu-proposals/route.js — the
// single, structural enforcement point of BE-19's hard boundary: a menu
// snapshot proposal may only ever be created against an already
// confirmed, existing restaurant identity.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/url-intakes/[id]/menu-proposals/route.js');

function readRouteSource() {
  return fs.readFileSync(ROUTE_PATH, 'utf8');
}

test('structural safety net: the menu-proposals route calls authenticateInternalRequest and requires isInternalOnly before doing anything else', () => {
  const source = readRouteSource();
  assert.match(source, /authenticateInternalRequest\(request\)/);
  assert.match(source, /if \(!auth\.ok\)/);
  assert.match(source, /isInternalOnly\(auth\.roles\)/);
});

test('structural safety net: refuses to create any proposal when matched_restaurant_id is absent — the hard boundary\'s only enforcement point', () => {
  const source = readRouteSource();
  const guardIndex = source.indexOf('if (!intake.matched_restaurant_id)');
  const insertIndex = source.indexOf(".from('menu_snapshot_proposals')");
  assert.ok(guardIndex !== -1, 'expected an explicit matched_restaurant_id guard');
  assert.ok(insertIndex !== -1, 'expected the menu_snapshot_proposals insert');
  assert.ok(guardIndex < insertIndex, 'the matched_restaurant_id guard must run before any insert is possible');
  assert.match(source, /status: 409/);
});

test('structural safety net: restaurant_id and captured_content are read exclusively from the stored url_intakes row — never from the request body', () => {
  const source = readRouteSource();
  assert.match(source, /restaurantId: intake\.matched_restaurant_id/);
  assert.doesNotMatch(source, /body\.restaurant_id/);
  assert.doesNotMatch(source, /body\.captured_content/);
  assert.doesNotMatch(source, /body\.category/);
  // The client may only choose WHICH already-found menu context to use,
  // by slug — never supply new content.
  assert.match(source, /body\.menu_context_slugs/);
});

test('structural safety net: source_url passed to the menu snapshot is the real, stored canonical_source_url — never a placeholder or client-supplied value', () => {
  const source = readRouteSource();
  assert.match(source, /sourceUrl: intake\.canonical_source_url/);
  assert.doesNotMatch(source, /\.invalid\//, 'no placeholder URL may ever reach the actual insert');
});

test('structural safety net: reuses the existing, unchanged BE-17 validation and hash functions — never a re-implementation', () => {
  const source = readRouteSource();
  assert.match(source, /require\(['"]@\/src\/lib\/menuSnapshotHash['"]\)|from '@\/src\/lib\/menuSnapshotHash'/);
  assert.match(source, /computeCanonicalContentHash\(/);
  assert.match(source, /validateSnapshotProposalInput\(/);
});

test('structural safety net: never calls .update() or .delete() — only ever inserts new menu_snapshot_proposals rows', () => {
  const source = readRouteSource();
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
});

test('structural safety net: never references restaurant_profile_drafts or url_intake_analysis_receipts — this route only ever reads url_intakes and writes menu_snapshot_proposals', () => {
  const source = readRouteSource();
  assert.doesNotMatch(source, /restaurant_profile_drafts/);
  assert.doesNotMatch(source, /url_intake_analysis_receipts/);
});
