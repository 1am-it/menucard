'use strict';

// BE-34 (#81, criterion 4) — structural proof that the screens really show that
// the app is working: the OSM spinner, the running step list with a progress
// bar, "⏳ Zoeken…" on the row being worked on, "Bijgewerkt om HH:MM" and one
// "Opnieuw proberen". Structure only, not a browser check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('"Nieuw gevonden" waits with a spinner and the exact sentence instead of "(0)"', () => {
  const section = read('app/internal/coverage/NewFoundSection.js');
  assert.match(section, /import \{ NEW_FOUND_LOADING, RETRY_LABEL, updatedLabel \}/);
  assert.match(section, /className="cov-spinner"/);
  assert.match(section, /\{NEW_FOUND_LOADING\}/);
  assert.match(section, /RETRY_LABEL/);
  assert.match(section, /setState\(\(prev\) => \(\{ \.\.\.prev, loading: true, error: null \}\)\)/);
  // The count only appears once the answer is in.
  assert.match(section, /state\.loading \? '🆕 Nieuw gevonden' : `🆕 Nieuw gevonden \(\$\{state\.items\.length\}\)`/);
});

test('"Vind bronnen" shows the running steps, a progress bar and one retry', () => {
  const section = read('app/internal/coverage/CoverageCheckSection.js');
  assert.match(section, /discoverySteps\(/);
  assert.match(section, /role="progressbar"/);
  assert.match(section, /className="cov-progress-fill"/);
  assert.match(section, /\{steps\.line\}/);
  assert.match(section, /\{ROW_SEARCHING\}/);
  assert.match(section, /discoveryRun\.currentId === row\.restaurantId/);
  assert.match(section, /updatedLabel\(discoveryRun\.finishedAt\)/);
  assert.match(section, /discoveryRun\.failure\.retryLabel/);
  // One request per restaurant, through the same route and the same limit.
  assert.match(section, /body: JSON\.stringify\(\{ restaurant_ids: \[id\] \}\)/);
  assert.match(section, /ids\.slice\(0, MAX_BATCH_URLS\)/);
});

test('the add form also says "Zoeken…" and offers one retry', () => {
  const page = read('app/internal/toevoegen/page.js');
  assert.match(page, /\{ROW_SEARCHING\}/);
  assert.match(page, /discoveryFailure\(\{/);
  assert.match(page, /Opnieuw proberen/);
  assert.match(page, /'✨ Bezig…'/);
});

test('the busy styles reuse the existing tokens and respect reduced motion', () => {
  const css = read('app/globals.css');
  assert.match(css, /\.cov-spinner \{/);
  assert.match(css, /@keyframes cov-spin/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.cov-progress-bar \{/);
  assert.match(css, /\.cov-progress-fill \{/);
  assert.match(css, /\.cov-row-searching \{/);
});
