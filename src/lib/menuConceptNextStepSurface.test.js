'use strict';

// BE-41 — structural safety net over the list and the review screen:
//   * the list never starts an export (criterion 2 and its regression test);
//   * one card is one link, with a visible focus ring, and only the review-PR
//     link is a second link (criterion 1);
//   * the next step opens the right place (tab or Publicatie block);
//   * the original menu is one click away, http(s) only (criterion 4);
//   * the phone rules are the agreed 44 px / full-width ones (criterion 5);
//   * no colour, token or dependency is invented.
// Read as text, like the other surface tests: no DOM harness, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readCode = (rel) => read(rel).replace(/\r\n/g, '\n');
const VIEW_PATH = 'app/internal/menu-concepts/MenuConceptsView.js';
const VIEW = readCode(VIEW_PATH);
const LIST_PAGE = readCode('app/internal/menu-concepts/page.js');
const CSS = readCode('app/globals.css');

/** The list half of the view: ConceptItem and NextStepButton, no review screen. */
const LIST_VIEW = VIEW.slice(VIEW.indexOf('function NextStepButton'), VIEW.indexOf('function RejectForm'));
/** Only the card itself, so a count cannot include the list header links. */
const CARD_VIEW = VIEW.slice(VIEW.indexOf('function ConceptItem'), VIEW.indexOf('/** /internal/menu-concepts */'));
/** Only the visible button, where the review-PR link lives. */
const BUTTON_VIEW = VIEW.slice(VIEW.indexOf('function NextStepButton'), VIEW.indexOf('function ConceptItem'));
/** The rendered code without comments: comments may quote copy, code may not. */
const CODE = VIEW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('regression: the concept list can never start an export', () => {
  // No request, no POST, no export handler and no export route in the list.
  assert.doesNotMatch(LIST_VIEW, /\bfetch\(/);
  assert.doesNotMatch(LIST_VIEW, /method:\s*'POST'/);
  assert.doesNotMatch(LIST_VIEW, /onExport|exportReviewPr|\/export\b/);
  // "Maak review-PR →" is a link to the Publicatie block of the review screen.
  assert.match(VIEW, /if \(step\.target === 'publication'\) return `\$\{detailHref\}#mcr-publication`/);
  assert.match(VIEW, /<span className=\{classes\} aria-hidden="true">/);
  // The list page itself only reads the list.
  assert.match(LIST_PAGE, /fetch\(API, \{ headers: \{ Authorization: `Bearer \$\{token\}` \}, cache: 'no-store' \}\)/);
  assert.doesNotMatch(LIST_PAGE, /method: 'POST'/);
  // No write helper is imported into the list at all.
  assert.doesNotMatch(VIEW, /from '@\/src\/lib\/menuConceptExport'/);
});

test('every card is one link with a visible focus ring; only the review-PR is a second link', () => {
  // One anchor per card, the stretched title link; the PR button lives in
  // NextStepButton and is the one allowed second link.
  assert.equal((CARD_VIEW.match(/<a\b/g) || []).length, 1, 'the card itself has exactly one <a>');
  assert.equal((BUTTON_VIEW.match(/<a\b/g) || []).length, 1, 'the button has at most one <a>');
  // The link text stays the restaurant name (the card is one link, not a
  // sentence); its accessible name adds the step the card really goes to.
  assert.match(VIEW, /<a\n            className="mcr-item-link"\n            href=\{href\}\n            aria-label=\{step && step\.plainLabel \? `\$\{item\.restaurantName\} — \$\{step\.plainLabel\}` : undefined\}\n          >\n            \{item\.restaurantName\}/);
  assert.match(CSS, /\.mcr-item \{ display: grid; [^}]*position: relative; \}/);
  assert.match(CSS, /\.mcr-item-link::after \{ content: ""; position: absolute; inset: 0;/);
  assert.match(CSS, /\.mcr-item-link:focus-visible \{ outline: 2px solid var\(--border-focus\); outline-offset: 2px;/);
  // The one exception: a real second link to the stored PR, in a new tab.
  assert.match(
    VIEW,
    /<a className=\{`\$\{classes\} mcr-next--external`\} href=\{step\.externalUrl\} target="_blank" rel="noopener noreferrer">/,
  );
  assert.match(CSS, /\.mcr-next--external \{ position: relative; z-index: 1; \}/);
  // No nested links: the next step is a span inside the card, never inside <a>.
  assert.doesNotMatch(CARD_VIEW, /<a\b[^>]*>[\s\S]*<a\b/);
  assert.match(BUTTON_VIEW, /<span className=\{classes\} aria-hidden="true">/);
});

test('the next step is derived from the BE-39 rule for every card, never from its own copy', () => {
  assert.match(
    VIEW,
    /const step = deriveNextStep\(\{\n    status: item\.status,\n    publication: item\.publication,\n    blockerCount: item\.blockerCount,\n    prUrl: item\.exportPrUrl,\n  \}\)/,
  );
  // No second table of states in the rendered code: the labels come from the rule.
  assert.doesNotMatch(CODE, /Beoordelen →|blokkades oplossen →|Bron controleren →|Opnieuw proberen →|PR bekijken ↗|Bekijken →/);
  // The tab and block destinations exist on the review screen.
  assert.match(VIEW, /if \(step\.target === 'changes'\) return `\$\{detailHref\}\?tab=changes`/);
  assert.match(VIEW, /if \(step\.target === 'source'\) return `\$\{detailHref\}\?tab=source`/);
  assert.match(VIEW, /<section className="bta-side-card" aria-labelledby="mcr-publication">/);
  assert.match(VIEW, /id: 'changes', label: 'Wijzigingen'/);
  assert.match(VIEW, /id: 'source', label: 'Bron'/);
});

test('the review screen opens the tab or block the list asked for, from the real URL', () => {
  assert.match(VIEW, /const requested = new URLSearchParams\(window\.location\.search\)\.get\('tab'\)/);
  assert.match(VIEW, /if \(requested && TABS\.some\(\(t\) => t\.id === requested\)\) setTab\(requested\)/);
  assert.match(VIEW, /if \(window\.location\.hash === '#mcr-publication'\) \{/);
  assert.match(VIEW, /const block = document\.getElementById\('mcr-publication'\)/);
  // After mount only: no window access during the server render.
  assert.match(VIEW, /\}, \[\]\)/);
});

test('the original menu is one click away, http(s) only, with the small line under it', () => {
  assert.match(VIEW, /import \{ menuSourceLink \} from '@\/src\/lib\/menuConceptUrls'/);
  assert.match(VIEW, /function OriginalMenuLink\(\{ sourceUrl \}\) \{\n  const link = menuSourceLink\(sourceUrl\)\n  if \(!link\) return null/);
  assert.match(VIEW, /Originele menukaart openen ↗/);
  assert.match(VIEW, /<p className="mcr-origin-note">\{link\.note\}<\/p>/);
  assert.match(VIEW, /href=\{link\.href\} target="_blank" rel="noopener noreferrer"/);
  // Next to the title on both detail screens.
  assert.equal((VIEW.match(/<OriginalMenuLink sourceUrl=\{c\.sourceUrl\} \/>/g) || []).length, 2);
  // The rule itself refuses anything that is not http(s) — reviewed separately.
  const urls = read('src/lib/menuConceptUrls.js');
  assert.match(urls, /if \(!\/\^https\?:\\\/\\\/\[\^\/\?#\\s\]\/i\.test\(trimmed\)\) return false;/);
  assert.match(urls, /Opent in een nieuw tabblad · \$\{domain\} · \$\{kind\}/);
});

test('the phone gets a full-width next step of at least 44 px, without horizontal scroll', () => {
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 720px) {'));
  assert.match(mobile, /\.mcr-item-next \{ display: grid; justify-content: stretch; \}/);
  assert.match(mobile, /\.mcr-item-next \.mcr-next \{ width: 100%; min-height: 44px; \}/);
  assert.match(mobile, /\.mcr-origin \.bta-btn \{ width: 100%; min-height: 44px; \}/);
  // The buttons are 44 px in every theme and width, not only on the phone.
  assert.match(CSS, /\.mcr-next \{ min-height: 44px; \}/);
  // Nothing in the new rules widens the page: no fixed width, no min-width.
  const block = CSS.slice(CSS.indexOf('.mcr-item-link::after'), CSS.indexOf('.mcr-item-head'));
  assert.doesNotMatch(block, /min-width:\s*\d+px|width:\s*\d{3,}px/);
});

test('no colour, font size or dependency is invented for BE-41', () => {
  const block = CSS.slice(CSS.indexOf('/* BE-41: the whole card is one link'), CSS.indexOf('.mcr-item-head'));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  assert.match(block, /var\(--border-focus\)/);
  const origin = CSS.slice(CSS.indexOf('.mcr-origin {'), CSS.indexOf('.mcr-item-head'));
  assert.doesNotMatch(origin, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  assert.match(origin, /color: var\(--text-secondary\)/);
  // The badge roles stay the reviewed ones: no new class, no new token.
  assert.doesNotMatch(VIEW, /status-badge--(blocked|file|action)/);
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@anthropic-ai/sdk', '@supabase/supabase-js', 'next', 'pdfjs-dist', 'qrcode-generator', 'react', 'react-dom']);
});
