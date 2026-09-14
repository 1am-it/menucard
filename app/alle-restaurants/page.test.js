'use strict';

// Targeted correction: the light browse card's fallback for a restaurant
// with no valid address (e.g. id 10, "Salon de Provence" — see
// docs/api/restaurant-summary-shape.md "Known limitations") now says
// "Buurt: X" instead of showing a bare neighbourhood name in the exact
// same slot/style a real street address would occupy. This is a
// structural source test (fs.readFileSync + regex, this project's
// existing convention for app/ pages with no browser/DOM test harness —
// see src/lib/nvwaComplianceCopy.test.js), not a rendered-DOM test. The
// underlying data this fallback depends on (address: null, buurt:
// 'Binnenstad' for restaurant id 10) is already covered by
// src/services/restaurantIndex.test.js — this file only keeps the
// presentational copy/markup honest.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app/alle-restaurants/page.js');

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

test('address-less fallback explicitly labels the buurt value, not a bare neighbourhood name', () => {
  const source = readPageSource();
  assert.match(source, /Buurt: \{restaurant\.buurt\}/, 'the fallback branch must render an explicit "Buurt:" prefix');
});

test('the fallback span carries no aria-label — its accessible name must equal its visible "Buurt: X" text, not an overridden one', () => {
  const source = readPageSource();
  const fallbackLineMatch = source.match(/<span className="lrc-address">Buurt: \{restaurant\.buurt\}<\/span>/);
  assert.ok(fallbackLineMatch, 'expected the exact fallback element, with no aria-label or other accessible-name override applied to it');
});

test('a real, valid address is still rendered as-is, never prefixed with "Buurt:"', () => {
  const source = readPageSource();
  assert.match(source, /<span className="lrc-address">\{restaurant\.address\}<\/span>/, 'a valid address must render unprefixed and unchanged');
});
