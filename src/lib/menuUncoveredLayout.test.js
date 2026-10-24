'use strict';

// X4 of the Delivery Lead order 6382189724 (variant 1): a static guard on the
// real page and stylesheet. The block must sit above the nalopen list, carry
// the exact texts of the mockup and stay free of an AI call. The rendered
// behaviour (light/dark, 320/390 px, keyboard) is proven by
// ops/browser/run-menu-review-browser-check.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'app', 'internal', 'menu-import', 'page.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

test('X4: het oranje blok staat boven de nalopen-lijst', () => {
  const block = PAGE.indexOf('className="mai-uncovered"');
  const list = PAGE.indexOf('<ul className="mai-review-list">');
  const summary = PAGE.indexOf('<p className="mai-summary" role="status">');
  assert.ok(summary >= 0 && block > summary, 'the block comes after the summary');
  assert.ok(list > block, 'the block comes before the open rows');
  assert.equal((PAGE.match(/className="mai-uncovered"/g) || []).length, 1, 'exactly one block');
});

test('X4: de teksten van de mockup staan er letterlijk', () => {
  assert.match(PAGE, /regel met een prijs staat niet in het concept/);
  assert.match(PAGE, /regels met een prijs staan niet in het concept/);
  assert.match(PAGE, /Gratis: geen extra AI-aanroep nodig/);
  assert.match(PAGE, /Toevoegen/);
  assert.match(PAGE, /Geen gerecht/);
  assert.match(PAGE, /Pagina \{line\.sourceLabel\} · \{line\.locator\}/);
  assert.match(PAGE, /onder \$\{line\.section\}/);
  assert.match(PAGE, /Vergelijking niet beschikbaar voor dit concept|\{review\.uncovered\.message\}/);
});

test('X4: elke regel heeft een citaat, een bron en naam voor het toetsenbord', () => {
  assert.match(PAGE, /<p className="mai-quote">“\{line\.text\}”<\/p>/);
  assert.match(PAGE, /aria-label=\{`Toevoegen: \$\{line\.text\}`\}/);
  assert.match(PAGE, /aria-label=\{`Geen gerecht: \$\{line\.text\}`\}/);
  assert.match(PAGE, /<section className="mai-uncovered" aria-labelledby="mai-uncovered-title">/);
  assert.match(PAGE, /aria-labelledby/);
  // The block disappears with its last line: only rendered above zero.
  assert.match(PAGE, /review\.uncovered\.total > 0 \? \(/);
  // The bounded list names what it leaves out.
  assert.match(PAGE, /review\.uncovered\.omitted > 0/);
});

test('X4: de keuze gaat naar de bestaande beslisroute, zonder AI-aanroep', () => {
  assert.match(PAGE, /async function sendUncovered\(line, action\)/);
  assert.match(PAGE, /decision: \{ action, lineId: line\.id \}/);
  assert.match(PAGE, /`\/imports\/\$\{report\.importId\}\/decisions`/);
  const handler = PAGE.slice(PAGE.indexOf('async function sendUncovered'), PAGE.indexOf('function openReason'));
  assert.equal(handler.includes('AI_API'), false, 'no AI call in the uncovered handler');
  assert.equal(handler.includes('fetch('), false, 'the handler uses the existing api() helper only');
  assert.equal(CSS.includes('.mai-uncovered {'), true);
  assert.match(CSS, /\.mai-uncovered \{[\s\S]*?background: var\(--warning-bg\)/);
  assert.match(CSS, /\.mai-uncovered-row \{/);
});
