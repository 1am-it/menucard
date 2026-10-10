'use strict';

// BE-25 fase 2 — structural safety net for the Batchanalyse page, its
// routes and its styles: fixed copy, page-bound processing by the starter
// only, read-only colleagues, accessible states, Kleurtaal v2 tokens only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// The page (session, data, processing) and its presentational view.
const PAGE = read('app/internal/source-triage/batch/page.js') + read('app/internal/source-triage/batch/BatchAnalysisView.js');
const CSS = read('app/globals.css');
const BTA_CSS = CSS.slice(CSS.indexOf('/* ── Batchanalyse (BE-25 fase 2)'));

test('page: visible names, breadcrumb (desktop and mobile) and the fixed v1 copy', () => {
  assert.match(PAGE, /<h1 className="di-title">Batchanalyse<\/h1>/);
  assert.match(PAGE, /Werkvoorraad<\/span>/);
  assert.match(PAGE, /href="\/internal\/source-triage"/);
  assert.match(PAGE, /←\{' '\}/);
  assert.match(PAGE, /Bronnen beoordelen/);
  assert.match(PAGE, /COPY\.keepOpen/);
  assert.match(PAGE, /COPY\.nothingPublished/);
  assert.match(PAGE, /COPY\.colleaguePaused/);
  assert.match(PAGE, /Bron bevestigen voor \{restaurantName\}\?/);
  assert.match(PAGE, /Er wordt niets\s+gepubliceerd\./);
  assert.match(PAGE, /resultaten met voldoende zekerheid/);
  assert.match(PAGE, /Bevestig \{high\.length\} bronnen/);
  assert.doesNotMatch(PAGE, /gerust verlaten|scherm (mag|kan) (je )?(dicht|sluiten)|Bronnen die we met zekerheid|Naar Brontriage/i);
});

test('page: processing is page-bound — only the starter of an open batch calls /process, one call at a time', () => {
  assert.match(PAGE, /const processing = Boolean\(viewing && viewing\.batch\.is_starter && !viewing\.batch\.closed_at\)/);
  assert.equal((PAGE.match(/\/process`/g) || []).length, 1);
  assert.match(PAGE, /return \(\) => \{\s*loopToken\.current \+= 1/);
  assert.doesNotMatch(PAGE, /setInterval|serviceWorker|navigator\.sendBeacon|keepalive/);
});

test('page: colleagues get no actions; the starter is never named', () => {
  assert.match(PAGE, /const actions = canAct \? item\.actions : \[\]/);
  assert.match(PAGE, /const canAct = isStarter/);
  assert.match(PAGE, /\{isStarter && high\.length >= 2 && \(/);
  assert.doesNotMatch(PAGE, /actor_user_id|started_by|Gestart door \{/);
});

test('page: accessible states — progressbar with text, one polite live region, inline confirmation group with focus', () => {
  assert.match(PAGE, /role="progressbar"/);
  assert.match(PAGE, /aria-valuetext=\{`\$\{summary\.done\} van \$\{summary\.total\} klaar`\}/);
  assert.equal((PAGE.match(/aria-live="polite"/g) || []).length, 1);
  assert.match(PAGE, /role="group" aria-labelledby=\{`bta-confirm-\$\{item\.jobId\}`\}/);
  assert.match(PAGE, /confirmRef\.current\.focus\(\)/);
  assert.match(PAGE, /<label className="bta-label" htmlFor="bta-urls">/);
  assert.match(PAGE, /aria-describedby="bta-urls-help"/);
});

test('page: never fetches anything but its own internal API; no AI, OCR or external source', () => {
  const fetches = [...PAGE.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
  for (const target of fetches) assert.match(target, /^`?\$?\{?API|^API|^`\$\{API\}/, target);
  assert.doesNotMatch(PAGE, /openai|anthropic|tesseract|from ['"][^'"]*(ocr|claude)[^'"]*['"]/i);
});

test('styles: Kleurtaal v2 tokens only, 44px targets and no horizontal overflow on mobile, reduced motion respected', () => {
  assert.ok(BTA_CSS.length > 0);
  assert.doesNotMatch(BTA_CSS, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.match(BTA_CSS, /min-height: 44px/);
  assert.match(BTA_CSS, /overflow-wrap: anywhere/);
  assert.match(BTA_CSS, /prefers-reduced-motion: reduce/);
  assert.match(BTA_CSS, /\.bta-start \{ position: sticky; bottom: 0;/);
});

test('routes: internal-only handlers, process route bounded in time, nothing else exported', () => {
  const list = read('app/api/internal/v1/batch-analysis/route.js');
  const process = read('app/api/internal/v1/batch-analysis/[id]/process/route.js');
  const confirm = read('app/api/internal/v1/batch-analysis/[id]/confirm/route.js');
  assert.match(list, /export async function GET\(request\)/);
  assert.match(list, /export async function POST\(request\)/);
  assert.match(process, /export const maxDuration = 60/);
  for (const src of [list, process, confirm]) {
    assert.match(src, /batchAnalysisHandlers/);
    assert.doesNotMatch(src, /export async function (PUT|PATCH|DELETE)/);
  }
  const deps = read('src/lib/batchAnalysisRouteDeps.js');
  assert.match(deps, /authenticate: authenticateInternalRequest/);
  assert.match(deps, /analyze: analyzeSourceUrl/);
});
