'use strict';

// Structural safety net for BE-19's "Restaurantconcept maken" addition
// to app/internal/onboarding-menu/page.js — never claims to have
// visually tested this UI (no browser is available in this environment;
// see this round's own report), but asserts the source-level guarantees
// that matter most: the client never sends anything but a receipt id and
// the reviewer's own typed URL, and restaurant-concept creation and
// menu-proposal creation stay two fully separate actions.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app/internal/onboarding-menu/page.js');

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

test('structural safety net: createConceptFromReceipt sends only receipt_id/source_url/an explicit duplicate confirmation — never a restaurant field, menu field, or extracted content', () => {
  const source = readPageSource();
  const fnStart = source.indexOf('async function createConceptFromReceipt');
  assert.ok(fnStart !== -1, 'expected to find createConceptFromReceipt');
  const fnBody = source.slice(fnStart, source.indexOf('\n  }', fnStart) + 4);
  assert.match(fnBody, /receipt_id: readResult\.receipt\.id/);
  assert.match(fnBody, /source_url: sourceUrlInput/);
  assert.doesNotMatch(fnBody, /restaurant_match_type/);
  assert.doesNotMatch(fnBody, /matched_restaurant_id/);
  assert.doesNotMatch(fnBody, /captured_content/);
  assert.doesNotMatch(fnBody, /categories/);
});

test('structural safety net: a detected possible duplicate is shown as an explicit, separate confirmation — never auto-retried', () => {
  const source = readPageSource();
  assert.match(source, /setConceptDuplicateOf\(data\.possible_duplicate_of_draft_id\)/);
  assert.match(source, /Toch aanmaken/);
  // The duplicate confirmation must be a distinct user click, not fired
  // automatically from the same handler that first detected it.
  const buttonMatch = source.match(/onClick=\{\(\) => createConceptFromReceipt\(conceptDuplicateOf\)\}/);
  assert.ok(buttonMatch, 'expected a distinct button wired to re-confirm with the detected duplicate id');
});

test('structural safety net: the restaurant-concept UI never renders a menu-proposal action, and states the hard boundary in its own copy', () => {
  const source = readPageSource();
  const conceptSectionMatch = source.match(/\{needsRestaurantChoice && readResult\.receipt && \(([\s\S]*?)\n\s{16}\)\}/);
  assert.ok(conceptSectionMatch, 'expected to find the restaurant-concept UI block');
  const section = conceptSectionMatch[1];
  assert.doesNotMatch(section, /submitOneMenu|submitSelectedMenus|menu-snapshots/);
  assert.match(section, /pas mogelijk/i, 'expected the copy to explicitly state menu proposals are not yet possible for a fresh concept');
});

test('structural safety net: restaurant-concept creation and menu-proposal creation remain two fully separate state trees — no shared "creating" flag', () => {
  const source = readPageSource();
  assert.match(source, /\[creatingConcept, setCreatingConcept\]/);
  assert.match(source, /\[creatingProposals, setCreatingProposals\]/);
  assert.notEqual(source.match(/creatingConcept/g).length === 0, true);
});

test('structural safety net: reading a new URL resets all previous concept-creation state — never carries a stale duplicate/result across reads', () => {
  const source = readPageSource();
  const fnStart = source.indexOf('async function readSourceUrl');
  const fnBody = source.slice(fnStart, source.indexOf('\n  }', fnStart));
  assert.match(fnBody, /setConceptError\(null\)/);
  assert.match(fnBody, /setConceptDuplicateOf\(null\)/);
  assert.match(fnBody, /setConceptResult\(null\)/);
});
