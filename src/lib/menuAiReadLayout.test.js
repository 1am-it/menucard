'use strict';

// Y2 of the Delivery Lead review 6381657192 (issue #59 / PR #60): the approved
// mockup makes the AI reading the primary route and the old manual import a
// secondary link. This is a static guard on the real page/component sources so
// a later edit cannot silently nest the AI card back inside step 1 or drop the
// collapsed manual route. The rendered behaviour is covered by
// ops/browser/run-menu-review-browser-check.js (fixture evidence).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'app', 'internal', 'menu-import', 'page.js'), 'utf8');
const BLOCK = fs.readFileSync(path.join(ROOT, 'src', 'components', 'AiMenuReadBlock.js'), 'utf8');
const BATCH = fs.readFileSync(path.join(ROOT, 'app', 'internal', 'bronnen', 'batch', 'BatchAnalysisView.js'), 'utf8');

test('Y2: the AI card comes after the source card and before the manual steps', () => {
  const steps = PAGE.indexOf('<div className="mai-steps">');
  const source = PAGE.indexOf('aria-labelledby="mai-bron"', steps);
  const ai = PAGE.indexOf('<AiMenuReadBlock', steps);
  const manual = PAGE.indexOf('{manualVisible ? (', steps);
  assert.ok(steps >= 0, 'the steps wrapper exists');
  assert.ok(source > steps, 'the source card comes first');
  assert.ok(ai > source, 'the AI card follows the source card');
  assert.ok(manual > ai, 'the manual steps follow the AI card');
  assert.equal((PAGE.match(/<AiMenuReadBlock/g) || []).length, 1, 'exactly one AI block, not a nested copy');
  assert.match(PAGE, /\{aiConfigured \? \(/);
});

test('Y2: the manual steps are a disclosure and the review opens after Nalopen', () => {
  assert.match(BLOCK, /aria-expanded=\{manualOpen\}/);
  assert.match(BLOCK, /aria-controls="mai-manual"/);
  assert.match(BLOCK, /Liever zelf invoeren of plakken/);
  assert.doesNotMatch(BLOCK, /manualHref/);
  assert.match(PAGE, /id="mai-manual"/);
  assert.match(PAGE, /const reviewVisible = !aiConfigured \|\| manualOpen \|\| reviewOpen/);
  assert.match(PAGE, /function focusReview\(\) \{\r?\n\s*setReviewOpen\(true\)/);
});

test('Y2: without AI the old manual flow stays and the quiet message is shown', () => {
  assert.match(PAGE, /const aiNotConfigured =/);
  assert.match(PAGE, /AI is niet ingesteld\./);
  // With AI the manual steps are 2 and 3; without AI they stay 1 and 2.
  assert.match(PAGE, /\{aiConfigured \? 2 : 1\}/);
  assert.match(PAGE, /\{aiConfigured \? 3 : 2\}/);
  // BB3 (review 6384867373): the review number follows the visible order, so
  // "Nalopen en opslaan" is 3 while only the AI route is visible and 4 when the
  // manual route is open. Without AI it stays 3.
  assert.match(PAGE, /const reviewStep = aiConfigured && !manualVisible \? 3 : aiConfigured \? 4 : 3/);
  assert.match(PAGE, /\{reviewStep\}/);
});

test('BB3: de stappen worden genummerd in de volgorde die de mens ziet', () => {
  // De AI-kaart is een genummerde stap zolang de handmatige route dicht is.
  assert.match(PAGE, /const aiStep = manualVisible \? null : 2/);
  assert.match(PAGE, /step=\{aiStep\}/);
  // En de kaart toont dat nummer in dezelfde kop als de andere stappen.
  assert.match(BLOCK, /step = null,/);
  assert.match(BLOCK, /<div className="mai-step-head">/);
  assert.match(BLOCK, /\{step === null \? null : \(/);
  assert.match(BLOCK, /<span className="step-num" aria-hidden="true">/);
});


test('Y2: the batch place is a standalone section with the same title and manual link', () => {
  assert.match(BATCH, /<section className="bta-ai-help"/);
  assert.ok(BATCH.includes('<h3 id={`bta-ai-${item.position}`} className="bta-ai-title">'));
  assert.match(BATCH, /Liever zelf invoeren of plakken/);
  assert.doesNotMatch(BATCH, /Geen AI, geen OCR/);
});
