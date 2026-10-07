'use strict';

// BE-24 Brontriage — structural safety net for the page and its styles,
// read from the source files (same convention as
// sourceWorkqueueSurface.test.js). Rendering, keyboard and contrast are
// verified in a real browser separately (see the BE-24 report).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'app/internal/source-triage/page.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8');
const code = PAGE.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function stgRules() {
  const start = CSS.indexOf('/* ── Brontriage (BE-24');
  assert.ok(start > 0, 'BE-24 style block exists');
  const rest = CSS.slice(start);
  const next = rest.indexOf('\n/* ──', 10);
  return next > 0 ? rest.slice(0, next) : rest;
}

test('the page shows the agreed notice through the shared constant, and never offers publishing', () => {
  assert.match(code, /TRIAGE_NOTICE/);
  assert.match(code, /<strong>\{TRIAGE_NOTICE\}<\/strong>/);
  assert.ok((code.match(/\{TRIAGE_NOTICE\}/g) || []).length >= 4, 'header, both forms and footnote');
  assert.doesNotMatch(code, /(Publiceer|Publiceren|Direct toepassen|Nu verwerken)/i);
  assert.match(code, />\s*Voorstel opslaan\s*</);
  assert.match(code, />\s*Voorstel accepteren\s*</);
  assert.match(code, />\s*Voorstel afwijzen\s*</);
});

test('the page talks only to the three internal source-triage endpoints, always with the session token', () => {
  const urls = [...code.matchAll(/fetch\(\s*([`'"])([^`'"]+)\1/g)].map((m) => m[2]);
  assert.deepEqual(urls, ['/api/internal/v1/source-triage']);
  const posts = [...code.matchAll(/post\(\s*([`'"])([^`'"]+)\1/g)].map((m) => m[2]);
  assert.deepEqual(posts.sort(), ['/api/internal/v1/source-triage/proposals', '/api/internal/v1/source-triage/proposals/${encodeURIComponent(id)}/decision'].sort());
  assert.match(code, /Authorization: `Bearer \$\{token\}`/);
  assert.match(code, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.doesNotMatch(code, /supabase\.from\(|\.rpc\(/);
  assert.doesNotMatch(code, /fetchWebsiteSafely|restaurant-analysis-jobs|onboarding-menu\/read-url/);
});

test('every status badge renders an icon and text; status roles come from the shared mapping', () => {
  assert.match(code, /<span className=\{`status-badge status-badge--\$\{tone\} stg-badge`\}>\s*<StatusIcon name=\{icon\} \/>\s*<span>\{children\}<\/span>/);
  assert.match(code, /Bron: \{SOURCE_LABELS\[entry\.source\]\}/);
  assert.match(code, /Menukaart: \{MENU_LABELS\[entry\.menu\]\}/);
  assert.match(code, /Voorstel: \{STATUS_LABELS\[status\]\}/);
  assert.doesNotMatch(code, /status-badge--action/);
});

test('forms are labelled, errors are announced, and the selected restaurant is exposed programmatically', () => {
  for (const id of ['stg-search', '${base}-url', '${base}-reason', '${base}-note', '${noteId}']) {
    assert.ok(code.includes(`htmlFor={\`${id}\`}`) || code.includes(`htmlFor="${id}"`) || code.includes(`htmlFor={${id.replace(/^\$\{|\}$/g, '')}}`), id);
  }
  assert.match(code, /<legend className="stg-label">Soort voorstel<\/legend>/);
  assert.match(code, /role="alert"/);
  assert.match(code, /aria-invalid=/);
  assert.match(code, /aria-current=\{isSelected \? 'true' : undefined\}/);
  assert.match(code, /aria-pressed=\{filter === f\}/);
  assert.match(code, /tabIndex=\{-1\} ref=\{headingRef\}/, 'focus moves to the detail heading after selecting');
});

test('external source links open explicitly in a new window with noopener and an announced icon', () => {
  assert.match(code, /target="_blank" rel="noopener noreferrer"/);
  assert.match(code, /<ExternalLinkIcon /);
});

test('no restaurant or dish image, and no hard-coded colour in the page or its styles', () => {
  assert.doesNotMatch(code, /<img\b|background-image|url\(/);
  assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  const rules = stgRules();
  const noComments = rules.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(noComments, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|(?<![-\w])(white|black)(?![-\w])/i);
  assert.doesNotMatch(noComments, /--text-(muted|dim|faint)|var\(--green|var\(--warning|var\(--status-action/);
});

test('styles: visible focus on every control, list + detail from 960px, wrapping instead of overflow', () => {
  const rules = stgRules();
  assert.match(rules, /\.stg-filter:focus-visible, \.stg-item:focus-visible, \.stg-btn:focus-visible[^{]*\{ outline: 2px solid var\(--border-focus\)/);
  assert.match(rules, /@media \(min-width: 960px\) \{\s*\.stg-layout \{ grid-template-columns: minmax\(280px, 380px\) minmax\(0, 1fr\); \}/);
  assert.match(rules, /\.stg-url \{ overflow-wrap: anywhere;/);
  assert.match(rules, /\.stg-filters \{ display: flex; flex-wrap: wrap;/);
});
