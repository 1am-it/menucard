'use strict';

// BE-11 Fase 2 — RestaurantBrowseCard was extracted from this page into
// src/components/RestaurantBrowseCard.js (see that file's own
// RestaurantBrowseCard.test.js for the presentational/accessibility
// assertions that used to live here). This file now only confirms the
// page still wires up the shared component correctly, rather than
// defining its own copy of the card.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app/alle-restaurants/page.js');

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

test('imports the shared RestaurantBrowseCard component rather than defining its own copy', () => {
  const source = readPageSource();
  assert.match(source, /import RestaurantBrowseCard from ['"]@\/src\/components\/RestaurantBrowseCard['"]/);
  assert.doesNotMatch(source, /function RestaurantBrowseCard\(/, 'the card must no longer be defined locally on this page');
});

test('renders the shared card for each result, keyed by restaurantId', () => {
  const source = readPageSource();
  assert.match(source, /<RestaurantBrowseCard key=\{restaurant\.restaurantId\} restaurant=\{restaurant\} \/>/);
});
