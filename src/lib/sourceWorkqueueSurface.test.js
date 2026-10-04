'use strict';

// Bronwerkvoorraad — structural safety-net tests (fs.readFileSync + regex,
// this project's existing convention, see src/lib/internalNav.test.js) for
// the read-only API route and the internal page. They pin the scope: read
// only, no outbound fetch, no bulk/publish/approve/AI actions, one shared
// vocabulary.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const ROUTE = fs.readFileSync(path.join(ROOT, 'app/api/internal/v1/source-workqueue/route.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'app/internal/source-workqueue/page.js'), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ─── Route ──────────────────────────────────────────────────────────────────

test('route: only a GET handler, behind the existing internal auth gate', () => {
  const src = code(ROUTE);
  assert.match(src, /export async function GET\(/);
  assert.doesNotMatch(src, /export (async )?function (POST|PUT|PATCH|DELETE)\b/);
  assert.match(src, /authenticateInternalRequest\(request\)/);
  assert.match(src, /isInternalOnly\(auth\.roles\)/);
});

test('route: read only — no insert, update, upsert, delete or RPC, and no outbound fetch', () => {
  const src = code(ROUTE);
  for (const forbidden of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/, /fetchWebsiteSafely/, /\bfetch\(/, /restaurantSourceFetch/, /runRestaurantSourceAnalysis/]) {
    assert.doesNotMatch(src, forbidden, String(forbidden));
  }
  assert.doesNotMatch(src, /\.select\(\s*['"`]\*['"`]\s*\)/, 'never select *');
});

test('route: classification comes only from the pure, tested library', () => {
  assert.match(ROUTE, /from '@\/src\/lib\/sourceWorkqueue'/);
  assert.match(code(ROUTE), /buildSourceWorkqueue\(/);
});

test('route: the response never carries a full URL, an error reason, an HTTP status, a log or a score', () => {
  const response = code(ROUTE).slice(code(ROUTE).indexOf('return NextResponse.json({\n    city'));
  assert.ok(response.length > 0, 'response object found');
  for (const forbidden of ['canonical_source_url', 'error_reason', 'http', 'log', 'score', 'attempt', 'website']) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b\\s*:`, 'i').test(response), `response must not expose ${forbidden}`);
  }
});

// ─── Page ───────────────────────────────────────────────────────────────────

test('page: reuses the existing InternalNav shell and the authenticated API — no direct Supabase table access', () => {
  const src = code(PAGE);
  assert.match(src, /<InternalNav accessToken=\{session\.access_token\}/);
  assert.match(src, /fetch\('\/api\/internal\/v1\/source-workqueue'/);
  const fetchTargets = [...src.matchAll(/fetch\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
  assert.deepEqual(fetchTargets, ['/api/internal/v1/source-workqueue']);
  assert.doesNotMatch(src, /\.from\(['"`]/);
});

test('page: no bulk selection, bulk action, "check all sources", publish, approve or AI action', () => {
  const src = code(PAGE);
  assert.doesNotMatch(src, /type="checkbox"/);
  for (const forbidden of [/Alle bronnen controleren/i, /\bAI\b/, /method:\s*['"`](POST|PUT|PATCH|DELETE)/]) {
    assert.doesNotMatch(src, forbidden, String(forbidden));
  }
  // No button or link whose own text is a publish/approve/confirm verb
  // (prose such as "gepubliceerd" or "bevestigt" is fine).
  const controlTexts = [...src.matchAll(/<(button|a)\b[\s\S]*?>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>|\{[^}]*\}/g, ' ').trim());
  assert.ok(controlTexts.length > 0);
  for (const t of controlTexts) {
    assert.doesNotMatch(t, /\b(publiceer|publiceren|goedkeuren|keur goed|bevestig|bevestigen|alles controleren)\b/i, t);
  }
});

test('page: shows "Niets wordt automatisch gepubliceerd." visibly', () => {
  assert.match(PAGE, /Niets wordt automatisch gepubliceerd\./);
});

test('page: every status, action, queue and sort label comes from the shared vocabulary', () => {
  const src = code(PAGE);
  for (const name of ['SOURCE_LABELS', 'MENU_LABELS', 'ACTION_LABELS', 'QUEUE_LABELS', 'SORT_LABELS', 'NOT_IN_QUEUE_LABELS']) {
    assert.match(src, new RegExp(`\\b${name}\\b`), name);
  }
  // No hardcoded copy of a status label outside the library.
  for (const label of ['Bereikbaar', 'Niet bereikbaar', 'Toegang beperkt', 'Klaar voor review', 'Structuur niet herkend', 'Geen menukaart aangetroffen']) {
    assert.ok(!src.includes(`>${label}<`), `hardcoded label ${label}`);
  }
});

test('page: the identity panel offers only "Later" — never a confirm button', () => {
  const src = code(PAGE);
  const start = src.indexOf("if (row.action === 'check_identity')");
  const end = src.indexOf('const texts = {', start);
  assert.ok(start > 0 && end > start);
  const identityBranch = src.slice(start, end);
  const buttons = [...identityBranch.matchAll(/<button[\s\S]*?>([\s\S]*?)<\/button>/g)].map((m) => m[1].trim());
  assert.deepEqual(buttons, ['Later']);
  assert.match(identityBranch, /Er wordt niets overgenomen/);
});

test('page: accessible structure — table caption, column and row headers, labelled filters, pressed state, live result count', () => {
  const src = code(PAGE);
  assert.match(src, /<caption className="swq-sr-only">/);
  assert.equal((src.match(/<th scope="col">/g) || []).length, 5);
  assert.match(src, /<th scope="row"/);
  for (const id of ['swq-search', 'swq-filter-source', 'swq-filter-menu', 'swq-filter-wijk', 'swq-sort']) {
    assert.match(src, new RegExp(`htmlFor="${id}"`), id);
    assert.match(src, new RegExp(`id="${id}"`), id);
  }
  assert.match(src, /aria-pressed=\{queue === q\}/);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /aria-controls=\{panelId\}/);
});
