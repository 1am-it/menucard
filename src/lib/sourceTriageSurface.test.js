'use strict';

// BE-24 Brontriage, moved to BE-31 (#74) "Bronnen beoordelen" — structural
// safety net for the screen and its styles, read from the source files (same
// convention as sourceWorkqueueSurface.test.js). Rendering, keyboard, phone
// behaviour and contrast are verified in a real browser separately
// (ops/browser/run-bronnen-browser-check.js).
//
// The screen now consists of app/internal/bronnen/page.js (data + existing write
// routes), BronnenView.js (the list and the one detail) and ProposalDetail.js
// (the BE-24 proposal UI, moved unchanged).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const PAGE_FILE = read('app/internal/bronnen/page.js');
const VIEW_FILE = read('app/internal/bronnen/BronnenView.js');
const DETAIL_FILE = read('app/internal/bronnen/ProposalDetail.js');
const PAGE = [PAGE_FILE, VIEW_FILE, DETAIL_FILE].join('\n');
const CSS = read('app/globals.css');
const code = PAGE
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

function brnRules() {
  const start = CSS.indexOf('/* ── BE-31 (#74) "Bronnen beoordelen"');
  assert.ok(start > 0, 'the BE-31 style block exists');
  const rest = CSS.slice(start);
  const next = rest.indexOf('\n/* ──', 10);
  return next > 0 ? rest.slice(0, next) : rest;
}

test('the screen shows the agreed notice through the shared constant, and never offers publishing', () => {
  assert.match(code, /TRIAGE_NOTICE/);
  assert.ok((code.match(/\{TRIAGE_NOTICE\}/g) || []).length >= 2, 'both proposal forms name the notice');
  assert.doesNotMatch(code, /\b(Publiceer|Publiceren|Direct toepassen|Nu verwerken)\b/i);
  assert.match(code, />\s*Voorstel opslaan\s*</);
  assert.match(code, />\s*Voorstel accepteren\s*</);
  assert.match(code, />\s*Voorstel afwijzen\s*</);
});

test('the screen talks only to the existing internal endpoints, always with the session token', () => {
  for (const endpoint of [
    "'/api/internal/v1/source-triage'",
    "'/api/internal/v1/batch-analysis'",
    '${BATCH_API}?batch=',
    '${BATCH_API}/${encodeURIComponent(task.batchId)}/confirm',
    '${TRIAGE_API}/proposals',
    '/proposals/${encodeURIComponent(id)}/decision',
  ]) {
    assert.ok(code.includes(endpoint), endpoint);
  }
  // Only same-origin internal endpoints: no external URL is ever contacted.
  assert.doesNotMatch(code.replace('placeholder="https://"', ''), /https?:\/\//);
  assert.match(code, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(code, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(code, /supabase\.from\(|\.rpc\(/);
  assert.doesNotMatch(code, /fetchWebsiteSafely|restaurant-analysis-jobs|onboarding-menu\/read-url/);
});

test('one list with chips and exactly one detail: the detail waits for a chosen task', () => {
  assert.match(code, /CHECK_COPY\.pickTask/);
  assert.match(code, /CHECK_COPY\.noWork/);
  assert.match(code, /TASK_FILTERS\.map\(\(key\) =>/);
  assert.match(code, /aria-pressed=\{filter === key\}/);
  assert.match(code, /\{counts\[key\]\}/);
  assert.match(code, /aria-controls="brn-detail"/);
  assert.match(code, /aria-current=\{selected && selected\.id === task\.id \? 'true' : undefined\}/);
  assert.match(code, /<section id="brn-detail" className="brn-detail" aria-label="Details">/);
  // The empty state has no chips and no detail pane: both live in the other branch.
  const emptyBranch = code.slice(code.indexOf('{empty ? ('), code.indexOf('{triage && !empty ? ('));
  assert.doesNotMatch(emptyBranch, /TASK_FILTERS\.map|id="brn-detail"/);
  assert.match(code, /href=\{COVERAGE_HREF\}/);
});

test('the same result row component renders the batch rows here and elsewhere', () => {
  assert.match(code, /import SourceResultRow from '@\/src\/components\/SourceResultRow'/);
  assert.match(code, /stepHref\(row, \{ batchId: task\.batchId, returnTo \}\)/);
  assert.match(code, /const returnTo = `\$\{BRONNEN_HREF\}\?batch=/);
  assert.match(code, /onConfirm=\{\(target\) => onConfirmRow\(task, target\)\}/);
  // One next step per row; the confirmation uses the existing route.
  assert.match(PAGE_FILE, /\/confirm`/);
});


test('every status badge renders an icon and text; status roles come from the shared mapping', () => {
  assert.match(code, /<span className={`status-badge status-badge--\$\{tone\} stg-badge`}>\s*<StatusIcon name=\{icon\} \/>\s*<span>\{children\}<\/span>/);
  assert.match(code, /Bron: \{SOURCE_LABELS\[entry\.source\]\}/);
  assert.match(code, /Menukaart: \{MENU_LABELS\[entry\.menu\]\}/);
  assert.match(code, /Voorstel: \{STATUS_LABELS\[status\]\}/);
  assert.doesNotMatch(code, /status-badge--action/);
});

test('forms are labelled, errors are announced, and the chosen task is exposed programmatically', () => {
  for (const id of ['${base}-url', '${base}-reason', '${base}-note', '${noteId}']) {
    assert.ok(code.includes(`htmlFor={\`${id}\`}`) || code.includes(`htmlFor={${id.replace(/^\$\{|\}$/g, '')}}`), id);
  }
  assert.match(code, /<legend className="stg-label">Soort voorstel<\/legend>/);
  assert.match(code, /role="alert"/);
  assert.match(code, /aria-invalid=/);
  assert.match(code, /tabIndex=\{-1\}[\s\S]{0,40}ref=\{headingRef\}/, 'focus moves to the detail heading after choosing');
  assert.match(VIEW_FILE, /aria-live="polite"/);
  assert.match(VIEW_FILE, /role="status"/);
});

test('external source links open explicitly in a new window with noopener and an announced icon', () => {
  assert.match(code, /target="_blank" rel="noopener noreferrer"/);
  assert.match(code, /<ExternalLinkIcon /);
});

test('no restaurant or dish image, and no hard-coded colour in the screen or its styles', () => {
  assert.doesNotMatch(code, /<img\b|background-image|url\(/);
  assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  const rules = brnRules();
  const noComments = rules.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(noComments, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|(?<![-\w])(white|black)(?![-\w])/i);
  assert.doesNotMatch(noComments, /--text-(muted|dim|faint)|var\(--green|var\(--warning|var\(--status-action/);
});

test('styles: list + detail from 960px, one list with its own task screen on a telephone', () => {
  const rules = brnRules();
  assert.match(rules, /\.brn-list \{ width: 470px; flex: none;/);
  assert.match(rules, /@media \(max-width: 900px\) \{\s*\.brn-list \{ width: 100%; \}\s*\.brn-layout \{ flex-direction: column; \}/);
  assert.match(rules, /\.brn-layout--selected \.brn-list \{ display: none; \}/);
  assert.match(rules, /\.brn-back \{ display: none; \}/);
  assert.match(rules, /@media \(max-width: 720px\) \{[\s\S]*\.brn-back \{ display: inline-flex;/);
  assert.match(rules, /\.brn-task:focus-visible \{ outline: 2px solid var\(--border-focus\)/);
});
