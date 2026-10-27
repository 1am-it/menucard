'use strict';

// BE-34 (#81, criterion 1) — structural proof that the three screens really mount
// the one-click AI reading on the existing route, and that the review screen
// receives that reading instead of starting a second one. Structure only: this is
// not a browser check and not real acceptance.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

test('the row action uses the existing AI route and the existing review screen', () => {
  const flow = read('src/lib/aiReadFlow.js');
  assert.match(flow, /const AI_READ_API = '\/api\/internal\/v1\/menu-ai-import'/);
  assert.match(flow, /const AI_REVIEW_HREF = '\/internal\/menu-import'/);
  assert.match(flow, /const PASTE_LABEL = 'Liever zelf plakken'/);
  // No second AI path, no client-side provider call.
  assert.doesNotMatch(flow, /anthropic|api\.anthropic\.com|new Anthropic/i);
});

test('the shared result row renders the one-click reading for the ai_read step', () => {
  const row = read('src/components/SourceResultRow.js');
  assert.match(row, /import AiReadAction from '@\/src\/components\/AiReadAction'/);
  assert.match(row, /step\.key === 'ai_read' && typeof onAiRead === 'function'/);
  assert.match(row, /<AiReadAction/);
  assert.match(row, /onOpen=\{onOpenAiRead\}/);
});

test('the action shows progress, outcome, review and the honest manual fallback', () => {
  const action = read('src/components/AiReadAction.js');
  assert.match(action, /aiReadProgressLine\(\)/);
  assert.match(action, /aiReadEstimateLine\(\)/);
  assert.match(action, /aiReadOutcomeLine\(/);
  assert.match(action, /aiReadCostLine\(/);
  assert.match(action, /REVIEW_LABEL/);
  assert.match(action, /manualPasteHref\(row\)/);
  // The failure state's next step comes from the tested copy, never from here.
  assert.match(action, /state\.nextLabel/);
  assert.doesNotMatch(action, /fetch\(/);
});

test('the hook calls the one route with the row\'s own job and never retries', () => {
  const hook = read('src/components/useAiReading.js');
  assert.match(hook, /import \{[^}]*AI_READ_API/s);
  assert.match(hook, /aiReadRequestFor\(row\)/);
  assert.match(hook, /stashAiRead\(/);
  assert.match(hook, /aiReviewHref\(stashed\.key\)/);
  assert.doesNotMatch(hook, /setTimeout|retry|for \(/);
});

test('Dekking, Bronnen beoordelen and Toevoegen all offer it in their rows', () => {
  const coverage = read('app/internal/coverage/CoverageCheckSection.js');
  assert.match(coverage, /import useAiReading from '@\/src\/components\/useAiReading'/);
  assert.match(coverage, /const aiRead = useAiReading\(\{ token \}\)/);
  assert.match(coverage, /row\.step\.key === 'ai_read'/);
  assert.match(coverage, /onAiRead=\{aiRead\.read\}/);

  const bronnenView = read('app/internal/bronnen/BronnenView.js');
  assert.match(bronnenView, /import useAiReading from '@\/src\/components\/useAiReading'/);
  assert.match(bronnenView, /const aiRead = useAiReading\(\{ token \}\)/);
  assert.match(bronnenView, /onAiRead=\{aiRead\.read\}/);
  assert.match(read('app/internal/bronnen/page.js'), /<BronnenView\s+token=\{token\}/);

  const toevoegen = read('app/internal/toevoegen/page.js');
  assert.match(toevoegen, /import useAiReading from '@\/src\/components\/useAiReading'/);
  assert.match(toevoegen, /const aiRead = useAiReading\(\{ token \}\)/);
  assert.match(toevoegen, /onAiRead=\{aiRead\.read\}/);
});

test('the review screen takes the finished reading once, without a second call', () => {
  const page = read('app/internal/menu-import/page.js');
  assert.match(page, /import \{ aiHandoffKeyFromSearch, takeAiRead \} from '@\/src\/lib\/aiReadFlow'/);
  assert.match(page, /const handoffKey = aiHandoffKeyFromSearch\(window\.location\.search\)/);
  assert.match(page, /takeAiRead\(window\.sessionStorage, handoffKey\)/);
  assert.match(page, /setReviewOpen\(true\)/);
  // The handoff branch never starts the provider itself.
  const handoffBlock = page.slice(page.indexOf('BE-34 (#81, criterion 1)'), page.indexOf('const id = params.get'));
  assert.doesNotMatch(handoffBlock, /readWithAi|fetch\(/);
});
