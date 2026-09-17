'use strict';

// BE-14 — canonical back-navigation correction. Same convention as
// app/search/page.test.js: fs.readFileSync + regex, since this project has
// no rendered-DOM test harness for app/ pages. This is this component's
// first test file; it exists solely to pin the honest structural parent
// link this ticket adds — see
// be-14-fix-alle-restaurants-back-navigation.md.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const COMPONENT_PATH = path.join(REPO_ROOT, 'app/menu/[id]/MenuView.js');

function readComponentSource() {
  return fs.readFileSync(COMPONENT_PATH, 'utf8');
}

test('BE-14: the back-link is a real Link element pointing at this menu\'s own restaurant (/restaurant/{baseId}), not the browse-level /restaurants', () => {
  const source = readComponentSource();
  assert.match(
    source,
    /<Link href=\{`\/restaurant\/\$\{baseId\}`\} className="back-btn">← \{r\.name \|\| restaurant\.name\}<\/Link>/,
    'expected an honest structural parent link naming the restaurant and pointing at its own /restaurant/[id] route'
  );
});

test('BE-14: baseId is the same, already-existing restaurant id this file already derives — no new computation added', () => {
  const source = readComponentSource();
  assert.match(source, /const baseId\s*=\s*id\.split\('-'\)\[0\]/, 'baseId must remain this file\'s existing, unmodified derivation');
});

test('BE-14: the restaurant name source (r.name || restaurant.name) matches the pattern already used elsewhere in this file', () => {
  const source = readComponentSource();
  const occurrences = source.match(/r\.name \|\| restaurant\.name/g) || [];
  assert.ok(occurrences.length >= 2, 'expected the back-link to reuse the same r.name || restaurant.name source already read elsewhere in this file');
});

test('BE-14: the old browse-level "← Alle restaurants" back-link to /restaurants no longer exists on this page', () => {
  const source = readComponentSource();
  assert.doesNotMatch(source, /<Link href="\/restaurants"/, 'the old, mislabelled /restaurants target must be fully gone');
  assert.doesNotMatch(source, /← Alle restaurants/, 'the generic "Alle restaurants" back-link text must be replaced by the honest restaurant-name link');
});

test('BE-14: the back-link remains a real, accessible <Link> element — never a <div> or <span> with a click handler standing in for a link', () => {
  const source = readComponentSource();
  const backLinkMatch = source.match(/<Link href=\{`\/restaurant\/\$\{baseId\}`\}[^]*?<\/Link>/);
  assert.ok(backLinkMatch, 'expected to find the back-link as a real <Link> element');
  assert.doesNotMatch(backLinkMatch[0], /onClick/, 'the back-link itself must not rely on a click handler in place of real link semantics');
});
