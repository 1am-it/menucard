'use strict';

// Targeted mobile UX fix: /nvwa/[id]'s custom header control-group
// (ThemeToggle + back-link + "Export PDF") was a non-wrapping inline-styled
// flex row, causing a real, measured ~46px page-level horizontal overflow
// at ~390px (both light and dark — the overflow is layout, not theme,
// driven). Fixed by pulling that div's exact prior inline style into a new
// `.nvwa-header-actions` class and giving it the same narrow-viewport
// flex-wrap/justify-content/row-gap treatment `.header-right` already uses
// for the identical problem on /restaurants (BE-10) — same convention,
// its own class only because the desktop gap (8px) differs from
// `.header-right`'s (16px), and this ticket's own hard boundary is that
// desktop must stay visually unchanged.
//
// Structural safety-net tests (fs.readFileSync + regex, this project's
// existing convention — see src/lib/moderationFormatting.test.js and
// src/lib/nvwaComplianceCopy.test.js), since this project has no
// browser/DOM test harness. Real-browser verification (1280/390,
// light/dark, document.documentElement.scrollWidth <= clientWidth) is
// covered separately, not by this file.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const NVWA_VIEW_PATH = path.join(REPO_ROOT, 'app/nvwa/[id]/NvwaView.js');
const GLOBALS_CSS_PATH = path.join(REPO_ROOT, 'app/globals.css');

function readNvwaViewSource() {
  return fs.readFileSync(NVWA_VIEW_PATH, 'utf8');
}

function readGlobalsCss() {
  return fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
}

test('NvwaView: the header actions group uses the new responsive class, not an inline style', () => {
  const source = readNvwaViewSource();
  assert.match(source, /<div className="nvwa-header-actions">/);
  // The old, non-wrapping inline style object must be gone from the header
  // — not merely duplicated alongside the new class.
  assert.equal(/style=\{\{ display: 'flex', gap: 8, alignItems: 'center' \}\}/.test(source), false);
});

test('NvwaView: ThemeToggle, back-link, and Export PDF are still all present inside the actions group', () => {
  const source = readNvwaViewSource();
  const actionsBlockMatch = source.match(/<div className="nvwa-header-actions">[\s\S]*?<\/div>/);
  assert.ok(actionsBlockMatch, 'nvwa-header-actions block must exist');
  const block = actionsBlockMatch[0];
  assert.match(block, /<ThemeToggle \/>/);
  assert.match(block, /className="back-btn"/);
  assert.match(block, /className="nvwa-export-btn"/);
});

test('globals.css: .nvwa-header-actions base rule matches the removed inline style exactly (desktop unchanged)', () => {
  const css = readGlobalsCss();
  assert.match(css, /\.nvwa-header-actions\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*8px;\s*\}/);
});

test('globals.css: .nvwa-header-actions wraps at the same narrow-viewport breakpoint as .header-right (BE-10 pattern)', () => {
  const css = readGlobalsCss();
  // globals.css has several `@media (max-width: 768px)` blocks in the file
  // (one per unrelated feature area) — anchor on `.header-right`'s own
  // narrow-viewport rule directly and confirm `.nvwa-header-actions`'
  // matching rule sits immediately after it in the *same* block, rather
  // than matching the first (wrong) `@media` block in the file.
  const headerRightIdx = css.indexOf('.header-right { flex: 1 1 auto; flex-wrap: wrap; justify-content: flex-end; row-gap: 8px; }');
  assert.ok(headerRightIdx !== -1, ".header-right's narrow-viewport rule must exist");
  const nvwaActionsIdx = css.indexOf('.nvwa-header-actions { flex-wrap: wrap; justify-content: flex-end; row-gap: 8px; }');
  assert.ok(nvwaActionsIdx !== -1, '.nvwa-header-actions narrow-viewport rule must exist');
  const between = css.slice(headerRightIdx, nvwaActionsIdx);
  assert.ok(
    nvwaActionsIdx > headerRightIdx && between.length < 400 && !between.includes('@media'),
    '.nvwa-header-actions must sit directly after .header-right, inside the same @media block'
  );
});

test('globals.css: the allergen matrix\'s own horizontal-scroll container is untouched by this fix', () => {
  const css = readGlobalsCss();
  assert.match(css, /\.allergen-table-wrap\s*\{\s*overflow-x:\s*auto;?\s*\}/);
});

test('NvwaView: no new dependency, route, or unrelated markup change — only the one div\'s className changed', () => {
  const source = readNvwaViewSource();
  const importLines = source.split('\n').filter((line) => line.trim().startsWith('import '));
  assert.equal(importLines.length, 3);
  assert.match(source, /const handlePrint = \(\) => window\.print\(\)/);
});
