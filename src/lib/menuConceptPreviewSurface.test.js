'use strict';

// Publicatievoorbeeld — structural safety net over the files themselves (this
// project has no rendered-DOM harness for app/ pages): one shared public menu
// body, no page chrome inside the internal page, the preview only for
// approved concepts by default, and accessible tabs and toggle.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const BODY = read('src/components/MenuBody.js');
const BODY_CODE = BODY.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
const PUBLIC = read('app/menu/[id]/MenuView.js');
const VIEW = read('app/internal/menu-concepts/MenuConceptsView.js');

test('one shared menu body: the public page and the preview both render dishes through MenuBody', () => {
  assert.match(PUBLIC, /import \{[^}]*\bMenuItem\b[^}]*\bMenuSection\b[^}]*\} from '@\/src\/components\/MenuBody'/);
  assert.doesNotMatch(PUBLIC, /^function MenuItem|className="menu-card/m, 'the public page no longer has its own dish markup');
  assert.match(VIEW, /import \{ StaticMenu, menuTitle \} from '@\/src\/components\/MenuBody'/);
  assert.match(BODY, /export function StaticMenu[\s\S]*<MenuSection[\s\S]*<MenuItem key=\{j\} item=\{item\}[^>]*\/>/);
  assert.doesNotMatch(VIEW, /className="menu-card|className="td-price/, 'the preview renders no dish markup of its own');
});

test('the shared body is presentation only: no page chrome, URL parameters, filters or reservation actions', () => {
  assert.doesNotMatch(BODY_CODE, /useSearchParams|useState|useEffect|ThemeToggle|Wordmark|reservation|<header|mf-search|fetch\(/);
});

test('the preview data comes from the server; the browser builds or normalises no menu data', () => {
  assert.match(VIEW, /<PublicationPreview preview=\{data\.preview\}/);
  assert.doesNotMatch(VIEW, /buildMenuEntry|applyExport|formatEuro|restaurantMenuEntries|menuExport/);
  assert.doesNotMatch(VIEW, /fetch\(/);
});

test('Publicatievoorbeeld is the default tab only for an internally approved concept', () => {
  assert.match(VIEW, /useState\(\(\) => \(data && data\.concept\.status === 'approved' && data\.preview && data\.preview\.concept \? 'preview' : 'changes'\)\)/);
  assert.deepEqual([...VIEW.matchAll(/\{ id: '(\w+)', label: '([^']+)' \}/g)].map((m) => m[2]), ['Publicatievoorbeeld', 'Wijzigingen', 'Bron', 'Versiegeschiedenis']);
});

test('accessible tabs (tablist, tab, tabpanel, arrow keys) and toggle (aria-pressed buttons)', () => {
  assert.match(VIEW, /role="tablist" aria-label="Weergave van het menuconcept"/);
  assert.match(VIEW, /role="tab"[\s\S]*?aria-selected=\{active === t\.id\}[\s\S]*?aria-controls=/);
  assert.match(VIEW, /tabIndex=\{active === t\.id \? 0 : -1\}/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.ok(VIEW.includes(`event.key === '${key}'`), key);
  assert.equal((VIEW.match(/role="tabpanel"/g) || []).length, 4);
  assert.match(VIEW, /role="group" aria-label="Welke menukaart tonen"/);
  assert.match(VIEW, /aria-pressed=\{mode === 'concept'\}[\s\S]*?Nieuw concept/);
  assert.match(VIEW, /aria-pressed=\{mode === 'current'\}[\s\S]*?Huidige publieke kaart/);
  assert.match(read('app/globals.css'), /\.mcr-tab:focus-visible, \.mcr-toggle-btn:focus-visible \{ outline: 2px solid var\(--border-focus\)/);
});

test('the review-PR action is still the only publication step and the preview says nothing is published', () => {
  assert.match(VIEW, /<PublicationCard/);
  assert.match(VIEW, /Precies wat de review-PR voor versie \$\{version\} schrijft\. Nog niet gepubliceerd\./);
});

test('nested menus: the shared body renders group headings; the public page uses the same component and keeps unique anchors', () => {
  assert.match(BODY, /export function MenuGroupHeadings\(\{ categories, index \}\)/);
  assert.match(BODY, /groupHeadingsBefore\(categories, index\)/);
  assert.match(BODY, /export function StaticMenu[\s\S]*<MenuGroupHeadings categories=\{list\} index=\{i\} \/>/);
  assert.match(PUBLIC, /<MenuGroupHeadings categories=\{filteredCategories\} index=\{i\} \/>/);
  assert.match(PUBLIC, /c\.name === cat\.name && JSON\.stringify\(c\.path \|\| null\) === JSON\.stringify\(cat\.path \|\| null\)/);
  assert.match(BODY, /\(entry && entry\.title\)/);
});
