'use strict';

// Structural safety net for the v2 read/guard integration: every existing
// write/approve/export ingress refuses before its hash, insert, update, RPC or
// GitHub call, and no UI renders source text as HTML.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => read(rel).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
const before = (src, a, b, label) => {
  const ai = src.indexOf(a);
  const bi = src.indexOf(b);
  assert.ok(ai >= 0, `${label}: missing ${a}`);
  assert.ok(bi >= 0, `${label}: missing ${b}`);
  assert.ok(ai < bi, `${label}: ${a} must come before ${b}`);
};

test('the generic snapshot route validates before hashing or inserting; the review route delegates and guards before the insert', () => {
  const snapshots = code('app/api/internal/v1/menu-snapshots/route.js');
  const snapshotsPost = snapshots.slice(snapshots.indexOf('export async function POST'));
  before(snapshotsPost, 'validateSnapshotProposalInput(', 'computeCanonicalContentHash(', 'snapshots POST');
  before(snapshotsPost, 'validateSnapshotProposalInput(', ".from('menu_snapshot_proposals')", 'snapshots POST');
  const reviews = code('app/api/internal/v1/menu-snapshots/[id]/reviews/route.js');
  assert.match(reviews, /createMenuSnapshotReviewHandlers\(/);
  assert.match(reviews, /handlers\.record\(request, id\)/);
  const handler = code('src/lib/menuSnapshotReviewHandlers.js');
  before(handler, 'readConceptProduct(', ".from('menu_snapshot_reviews')", 'reviews POST');
  assert.doesNotMatch(handler, /\.update\(|\.delete\(|menus\.json|analyzeSourceUrl/);
});

test('url-intakes refuses a v2 receipt before the redemption RPC', () => {
  const route = code('app/api/internal/v1/url-intakes/route.js');
  before(route, 'readReceiptProduct(receiptRow.candidate_summary)', "supabase.rpc('create_url_intake_from_receipt'", 'url-intakes');
  assert.doesNotMatch(route, /candidate_summary\.menus|menuExtractionV2\s*=/);
});

test('review, export and batch handlers guard before every side effect', () => {
  const review = code('src/lib/menuConceptReviewHandlers.js');
  before(review, 'productActionRefusal(\'save\'', 'createConceptVersion(', 'saveVersion');
  before(review, 'productActionRefusal(\'decide\'', 'record_menu_snapshot_decision', 'decide');
  const exporter = code('src/lib/menuConceptExport.js');
  const exportHandler = exporter.slice(exporter.indexOf('async function exportToReviewPr'));
  before(exportHandler, "productActionRefusal('export'", 'activeExports(', 'export');
  before(exportHandler, "productActionRefusal('export'", ".from('menu_snapshot_exports')", 'export');
  before(exportHandler, "productActionRefusal('export'", 'github.', 'export');
  const batch = code('src/lib/batchAnalysisHandlers.js');
  before(batch, 'productActionRefusal(\'save\'', 'createConceptVersion(', 'batch concept save');
});

test('the v1 concept reader is guarded and never flattens a versioned envelope', () => {
  const concept = code('src/lib/menuConcept.js');
  before(concept, 'assertLegacyConceptContent(captured)', 'captured.categories', 'storedConceptInput');
  assert.match(concept, /require\('\.\/menuProductGuardsV2'\)/);
});

test('UI renders the v2 view as text only and keeps the v1 click path', () => {
  for (const file of ['app/internal/source-triage/batch/MenuReview.js', 'app/internal/menu-concepts/MenuConceptsView.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML\s*=/, file);
    assert.doesNotMatch(src, /eval\(|new Function\(/, file);
  }
  const review = read('app/internal/source-triage/batch/MenuReview.js');
  assert.match(review, /export function ProductReview\(/);
  assert.match(review, /Alleen-lezen/);
  assert.match(review, /item\.product && <ProductReview/);
  const view = read('app/internal/menu-concepts/MenuConceptsView.js');
  assert.match(view, /ProductReview/);
  assert.match(view, /blockedContent/);
  assert.match(view, /if \(blockedContent\)/);
});

test('no migration, DDL, SQL or public-menu change is introduced by the integration', () => {
  const files = ['src/lib/menuProductIntegrationV2.js', 'src/lib/menuProductIntegrationV2.test.js', 'src/lib/menuSnapshotReviewHandlers.js'];
  for (const file of files) {
    const src = code(file);
    assert.doesNotMatch(src, /\bcreate table\b|\balter table\b|\binsert into\b|\bupdate\s+\w+\s+set\b|\.rpc\(/i, file);
    assert.doesNotMatch(src, /data\/menus\.json|writeFile|require\(['"](node:)?(fs|http|https|net|tls)['"]\)/, file);
  }
});
