'use strict';

// BE-14 — canonical back-navigation correction. Same convention as
// app/search/page.test.js: fs.readFileSync + regex, since this project has
// no rendered-DOM test harness for app/ pages. This is the homepage's own
// first test file; it exists solely to pin the one link this ticket
// touches — see be-14-fix-alle-restaurants-back-navigation.md.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app/page.js');

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

test('BE-14: "Bekijk alle restaurants →" is a real Link element pointing at /alle-restaurants, not the older /restaurants', () => {
  const source = readPageSource();
  assert.match(
    source,
    /<Link href="\/alle-restaurants" className="detail-menu-btn-outline">\s*Bekijk alle restaurants →/,
    'expected the homepage browse link to target /alle-restaurants, with its visible text unchanged'
  );
});

test('BE-14: the visible text "Bekijk alle restaurants →" is unchanged', () => {
  const source = readPageSource();
  assert.match(source, />\s*Bekijk alle restaurants →\s*</, 'the visible label itself must not change, only its link target');
});

test('BE-14: no link on this page still points at /restaurants under the "alle restaurants" wording — the separate, shorter "Restaurants" header link is unaffected', () => {
  const source = readPageSource();
  assert.doesNotMatch(
    source,
    /<Link href="\/restaurants"[^>]*>\s*Bekijk alle restaurants/,
    'the "Bekijk alle restaurants" link must no longer target /restaurants'
  );
  // The unrelated, differently-worded header link to /restaurants (BE-11's
  // own "Restaurants" link, out of this ticket's scope) must still exist,
  // unchanged.
  assert.match(source, /<Link href="\/restaurants" className="back-btn">Restaurants<\/Link>/);
});
