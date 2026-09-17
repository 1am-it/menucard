'use strict';

// BE-14 — canonical back-navigation correction. Same convention as
// app/search/page.test.js: fs.readFileSync + regex, since this project has
// no rendered-DOM test harness for app/ pages. This is this component's
// first test file; it exists solely to pin the one back-link this ticket
// touches — see be-14-fix-alle-restaurants-back-navigation.md.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const COMPONENT_PATH = path.join(REPO_ROOT, 'app/restaurant/[id]/RestaurantDetailView.js');

function readComponentSource() {
  return fs.readFileSync(COMPONENT_PATH, 'utf8');
}

test('BE-14: "← Alle restaurants" is a real Link element pointing at /alle-restaurants, not the older /restaurants', () => {
  const source = readComponentSource();
  assert.match(
    source,
    /<Link href="\/alle-restaurants" className="back-btn">← Alle restaurants<\/Link>/,
    'expected the header back-link to target /alle-restaurants, with its visible text unchanged'
  );
});

test('BE-14: no header link on this page still points at /restaurants', () => {
  const source = readComponentSource();
  assert.doesNotMatch(
    source,
    /<Link href="\/restaurants"/,
    'the older /restaurants target must be fully gone from this file'
  );
});
