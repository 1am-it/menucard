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
  assert.match(code, /aria-pressed=\{activeFilter === f\}/);
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

// ── Accessibility after saving and in forms ───────────────────────────────

function fnSource(name) {
  const start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = code.indexOf('\nfunction ', start + 10);
  const nextExport = code.indexOf('\nexport default function', start + 10);
  const ends = [next, nextExport].filter((i) => i > 0);
  return code.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test('save feedback uses permanent, pre-rendered live regions; only their content is conditional', () => {
  const region = fnSource('FeedbackRegion');
  assert.match(region, /<div role="status" aria-live="polite" aria-atomic="true">\s*\{message && !isError \? banner : null\}\s*<\/div>/);
  assert.match(region, /<div role="alert" aria-atomic="true">\s*\{isError \? banner : null\}\s*<\/div>/);
  assert.doesNotMatch(region, /if \(!message\)|message \?\s*\(\s*<div id="stg-feedback"/, 'the regions themselves never depend on a message');
  // Rendered unconditionally at the top of the detail pane, which exists
  // whenever data is shown (and every save needs shown data).
  assert.match(code, /<section id="stg-detail" className="stg-detail" aria-label="Details">\s*<FeedbackRegion message=\{message\} regionRef=\{feedbackRef\} \/>/);
  assert.doesNotMatch(code, /\{message && \(/, 'no banner that appears together with its own live region');
  // The page-level load error also sits in a region that exists before the error.
  assert.match(code, /<div role="alert" aria-atomic="true">\s*\{error && <div className="di-banner di-banner-danger">\{error\}<\/div>\}\s*<\/div>/);
});

test('after a save or a failed save, focus moves to the feedback, set only after the refresh has finished', () => {
  assert.match(code, /<div id="stg-feedback" className="stg-feedback" ref=\{regionRef\} tabIndex=\{-1\}>/);
  assert.match(code, /if \(message && focusFeedback\.current && feedbackRef\.current\) \{\s*focusFeedback\.current = false\s*feedbackRef\.current\.focus\(\)/);
  const post = code.slice(code.indexOf('async function post('), code.indexOf('function createProposal('));
  const refresh = post.indexOf('load(session.access_token, { refresh: true })');
  const focus = post.indexOf('focusFeedback.current = true');
  const show = post.indexOf('setMessage(saveFeedback(outcome))');
  assert.ok(refresh > 0 && focus > refresh && show > focus, 'refresh, then focus flag, then the message');
  assert.doesNotMatch(post, /finally/, 'the message is set on every path, not only on success');
  const rules = stgRules();
  assert.match(rules, /\.stg-feedback:focus-visible \{ outline: 2px solid var\(--border-focus\)/);
  assert.doesNotMatch(rules, /stg-feedback[^{]*\{[^}]*display: none/, 'a live region is never display:none');
});

test('"Andere reden" without a note: the textarea, not the select, is invalid, described, required and focused', () => {
  const form = fnSource('ProposalForm');
  assert.match(form, /const noteRequired = !needsUrl && reason === 'other'/);
  assert.match(form, /<textarea\s+id=\{`\$\{base\}-note`\}\s+ref=\{noteRef\}[\s\S]*?aria-required=\{noteRequired \? 'true' : undefined\}\s+aria-invalid=\{invalid\('note'\)\}\s+aria-describedby=\{describedBy\('note'\)\}/);
  assert.match(form, /<select\s+id=\{`\$\{base\}-reason`\}\s+ref=\{reasonRef\}[\s\S]*?aria-invalid=\{invalid\('reason'\)\}\s+aria-describedby=\{describedBy\('reason'\)\}/);
  assert.match(form, /aria-invalid=\{invalid\('url'\)\}\s+aria-describedby=\{describedBy\('url', `\$\{base\}-url-help`\)\}/);
  assert.match(form, /const invalid = \(field\) => \(error && error\.field === field \? 'true' : undefined\)/);
  assert.match(form, /validateProposalForm\(\{ kind, url, reason, note, knownUrl: entry\.known_url \}\)/);
  assert.match(form, /\{ url: urlRef, reason: reasonRef, note: noteRef \}\[error\.field\]/);
  assert.match(form, /ref\.current\.focus\(\)/);
  assert.match(form, /<p id=\{errorId\} className="stg-error" role="alert">\s*\{error\.message\}/);
  assert.match(form, /verplicht bij Andere reden/);
  const decision = fnSource('DecisionForm');
  assert.match(decision, /validateDecisionForm\(\{ decision, note \}\)/);
  assert.match(decision, /if \(error && noteRef\.current\) noteRef\.current\.focus\(\)/);
});

test('unknown proposals and a failed refresh never invent state or clear the page', () => {
  assert.doesNotMatch(code, /setData\(null\)/, 'a failed load keeps the last known list and detail');
  assert.match(code, /if \(!refresh\) setError\(body\.error \|\| LOAD_ERROR\)\s*return false/);
  assert.match(code, /countTriage\(entries, \{ proposalsAvailable \}\)/);
  assert.match(code, /const activeFilter = effectiveFilter\(filter, proposalsAvailable\)/);
  assert.match(code, /filterTriage\(entries, \{ filter: activeFilter, query \}\)/);
  assert.match(code, /const unknown = counts\[f\] === null/);
  assert.match(code, /disabled=\{unknown\}/);
  assert.match(code, /<span className="visually-hidden">aantal onbekend<\/span>/);
  assert.match(code, /\{e\.proposals_known === false && \(\s*<Badge tone="neutral" icon="dot">\s*Voorstellen: tijdelijk onbekend/);
  assert.match(code, /\{!proposalsAvailable \? \(\s*<p className="stg-muted">Voorstellen kunnen nu niet worden geladen of opgeslagen\.<\/p>/, 'forms stay hidden');
  const rules = stgRules();
  assert.match(rules, /\.stg-filter:disabled \{[^}]*color: var\(--text-secondary\)/);
});
