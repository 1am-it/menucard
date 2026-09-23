'use strict';

// Structural safety net for
// app/api/internal/v1/url-intakes/route.js — read directly from its
// actual source, exactly like the existing structural tests for the
// other BE-17/BE-19 routes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/url-intakes/route.js');

function readRouteSource() {
  return fs.readFileSync(ROUTE_PATH, 'utf8');
}

test('structural safety net: the url-intakes route calls authenticateInternalRequest and requires isInternalOnly before doing anything else', () => {
  const source = readRouteSource();
  assert.match(source, /authenticateInternalRequest\(request\)/);
  assert.match(source, /if \(!auth\.ok\)/);
  assert.match(source, /isInternalOnly\(auth\.roles\)/);
});

test('structural safety net: the url-intakes route recomputes the analysis hash from the stored receipt row — never accepts a hash, restaurant match, or candidate field from the client', () => {
  const source = readRouteSource();
  assert.match(source, /computeAnalysisResultHash\(\{/);
  assert.doesNotMatch(source, /body\.analysis_result_hash/);
  assert.doesNotMatch(source, /body\.matched_restaurant_id/);
  assert.doesNotMatch(source, /body\.restaurant_match_type/);
  assert.doesNotMatch(source, /body\.candidate_summary/);
});

test('structural safety net: the url-intakes route generates the url_intake id application-side — never lets Postgres default it', () => {
  const source = readRouteSource();
  assert.match(source, /generateUuidV7\(\)/);
  assert.match(source, /p_url_intake_id: urlIntakeId/);
});

test('structural safety net: the url-intakes route never inserts, updates, or deletes anything directly — the RPC is the only write path', () => {
  const source = readRouteSource();
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
  assert.match(source, /\.rpc\('create_url_intake_from_receipt'/);
});

test('structural safety net: the url-intakes route never references menu_snapshot_proposals or restaurant_profile_drafts — this route only ever creates a url_intakes row', () => {
  const source = readRouteSource();
  assert.doesNotMatch(source, /menu_snapshot_proposals/);
  assert.doesNotMatch(source, /restaurant_profile_drafts/);
});

test('structural safety net: no internal error detail (a caught error object) is ever serialized into a response', () => {
  const source = readRouteSource();
  assert.doesNotMatch(source, /NextResponse\.json\(\{[^}]*err(?:or)?\.(message|stack)/);
});
