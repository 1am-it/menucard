'use strict';

// Structural safety net for
// app/api/internal/v1/onboarding-menu/read-url/route.js — read directly
// from its actual source, not asserted from memory, exactly like the
// existing structural tests for the two BE-17 menu-snapshots routes in
// src/lib/menuSnapshotProposals.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/onboarding-menu/read-url/route.js');

function readRouteSource() {
  return fs.readFileSync(ROUTE_PATH, 'utf8');
}

test('structural safety net: the read-url route calls authenticateInternalRequest and requires isInternalOnly before doing anything else', () => {
  const source = readRouteSource();
  assert.match(source, /authenticateInternalRequest\(request\)/);
  assert.match(source, /if \(!auth\.ok\)/);
  assert.match(source, /isInternalOnly\(auth\.roles\)/);
});

test('structural safety net: the read-url route never touches Supabase or writes a menu_snapshot_proposals row', () => {
  const source = readRouteSource();
  assert.doesNotMatch(source, /getSupabaseAdmin/);
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
  assert.doesNotMatch(source, /menu_snapshot_proposals/);
});

test('structural safety net: the read-url route validates content-type before parsing, and rejects PDF distinctly', () => {
  const source = readRouteSource();
  const contentTypeCheckIndex = source.indexOf("fetchResult.contentType === 'application/pdf'");
  const parseCallIndex = source.indexOf('extractMenusFromHtml(');
  assert.ok(contentTypeCheckIndex !== -1 && parseCallIndex !== -1 && contentTypeCheckIndex < parseCallIndex, 'content-type must be checked before parsing');
  assert.match(source, /pdf_not_supported/);
  assert.match(source, /text\/html/);
});

test('structural safety net: robots.txt is checked fail-closed before the page itself is fetched, both with maxRedirects: 0', () => {
  const source = readRouteSource();
  const robotsGateIndex = source.indexOf('classifyRobotsGate(');
  const pageFetchIndex = source.lastIndexOf('fetchWebsiteSafely(sourceUrl.href');
  assert.ok(robotsGateIndex !== -1 && pageFetchIndex !== -1 && robotsGateIndex < pageFetchIndex, 'robots.txt gate must run before the page fetch');
  const maxRedirectsZeroCount = (source.match(/maxRedirects:\s*0/g) || []).length;
  assert.ok(maxRedirectsZeroCount >= 2, 'both the robots.txt fetch and the page fetch must disable redirects');
});

test('structural safety net: the fetch-attempt log never includes the full URL, query string, page content, tokens, or cookies', () => {
  const source = readRouteSource();
  const logCallStart = source.indexOf('function logUrlFetchAttempt');
  const logCallBody = source.slice(logCallStart, logCallStart + 800);
  assert.doesNotMatch(logCallBody, /rawUrl|sourceUrl\.href|fetchResult\.body|request\.headers|cookie/i);
  assert.match(logCallBody, /hostname/);
});

test('structural safety net: the log helper is never described as an "audit trail" or "audit log"', () => {
  const source = readRouteSource();
  assert.doesNotMatch(source, /audit[\s-]?(trail|log)/i);
});

test('structural safety net: no internal error detail (a caught error object) is ever serialized into a response', () => {
  const source = readRouteSource();
  assert.doesNotMatch(source, /NextResponse\.json\(\{[^}]*err(?:or)?\.(message|stack)/);
});
