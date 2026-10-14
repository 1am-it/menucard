'use strict';

// BE-17 Menuconcepten beoordelen v1 — structural safety net over the files
// themselves: the routes only delegate, the pages only talk to their own
// internal API, and nothing writes public data, fetches a source or
// publishes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => read(rel).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const ROUTES = {
  'app/api/internal/v1/menu-concepts/route.js': ['GET', 'list'],
  'app/api/internal/v1/menu-concepts/[id]/route.js': ['GET', 'detail'],
  'app/api/internal/v1/menu-concepts/[id]/versions/route.js': ['POST', 'saveVersion'],
  'app/api/internal/v1/menu-concepts/[id]/decision/route.js': ['POST', 'decide'],
};

test('each route exports one method that only delegates to its handler', () => {
  for (const [file, [method, handler]] of Object.entries(ROUTES)) {
    const src = code(file);
    assert.deepEqual([...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]), [method], file);
    assert.match(src, new RegExp(`menuConceptReviewHandlers\\.${handler}\\(request`), file);
    assert.match(src, /export const dynamic = 'force-dynamic'/, file);
    assert.doesNotMatch(src, /getSupabaseAdmin|\.from\(|\.rpc\(/, file);
  }
});

test('server logic never fetches, never writes public data and only inserts concept versions or calls the decision RPC', () => {
  for (const file of ['src/lib/menuConceptReviewHandlers.js', 'src/lib/menuConceptStore.js', 'src/lib/menuConcept.js']) {
    const src = code(file);
    assert.doesNotMatch(src, /\bfetch\(|analyzeSourceUrl|require\(['"](node:)?(fs|http|https)['"]\)/, file);
    assert.doesNotMatch(src, /writeFile|menus\.json['"]\)|pending_changes|field_provenance|\.update\(|\.delete\(|\.upsert\(/, file);
  }
  const store = code('src/lib/menuConceptStore.js');
  assert.deepEqual([...store.matchAll(/\.from\('(\w+)'\)\s*\.insert/g)].map((m) => m[1]), ['menu_snapshot_proposals']);
  for (const field of ['created_by: input.createdBy', 'origin_receipt_id: input.originReceiptId', 'based_on_snapshot_id: input.basedOnSnapshotId']) assert.ok(store.includes(field), field);
  const handlers = code('src/lib/menuConceptReviewHandlers.js');
  assert.doesNotMatch(handlers, /\.insert\(/);
  assert.deepEqual([...handlers.matchAll(/\.rpc\('(\w+)'/g)].map((m) => m[1]), ['record_menu_snapshot_decision']);
  assert.equal((handlers.match(/const \{ auth, denied \} = await authorize\(request\);/g) || []).length, 4);
});

test('the pages talk only to their own internal API; the source opens in a new tab; approval says nothing is published', () => {
  for (const file of ['app/internal/menu-concepts/page.js', 'app/internal/menu-concepts/[id]/page.js']) {
    const src = code(file);
    const urls = [...src.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
    assert.ok(urls.length > 0, file);
    for (const u of urls) assert.match(u, /^`\$\{API\}|^API$/, `${file}: ${u}`);
    assert.match(src, /const API = '\/api\/internal\/v1\/menu-concepts'/, file);
  }
  const view = read('app/internal/menu-concepts/MenuConceptsView.js');
  assert.doesNotMatch(view, /\bfetch\(/);
  assert.match(view, /target="_blank" rel="noopener noreferrer"/);
  assert.match(view, /Publieke menukaart ongewijzigd/);
  assert.match(view, /er wordt niets gepubliceerd/);
  assert.doesNotMatch(view, /Publiceer|publiceren\b/);
  for (const file of ['app/internal/menu-concepts/MenuConceptsView.js', 'app/internal/source-triage/batch/MenuReview.js']) {
    assert.doesNotMatch(read(file), /status-badge--(blocked|old)|di-banner-danger" role="status"/, `${file}: uncertainty is neutral`);
  }
});
