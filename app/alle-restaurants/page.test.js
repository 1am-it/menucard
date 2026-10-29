'use strict';

// BE-28b (#68) — de pagina haalt de bestaande data via GET /api/restaurants
// en gebruikt de geteste regels uit src/lib/restaurantBrowse.js. Deze
// bronregressies bewaken de koppeling; de functionele regels zelf staan in
// src/lib/restaurantBrowse.test.js en de kaart in
// src/components/RestaurantListCard.test.js.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app/alle-restaurants/page.js');

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

test('renders the shared RestaurantListCard for each result, keyed by restaurantId', () => {
  const source = readPageSource();
  assert.match(source, /import RestaurantListCard from ['"]@\/src\/components\/RestaurantListCard['"]/);
  assert.match(source, /<RestaurantListCard key=\{restaurant\.restaurantId\} restaurant=\{restaurant\} \/>/);
  assert.doesNotMatch(source, /function RestaurantListCard\(/, 'the card must not be defined locally on this page');
});

test('the existing data source is unchanged: GET /api/restaurants with q and the existing pagination', () => {
  const source = readPageSource();
  assert.match(source, /fetch\(`\/api\/restaurants\?\$\{params\.toString\(\)\}`\)/);
  assert.match(source, /if \(query\) params\.set\('q', query\)/);
  assert.match(source, /params\.set\('limit', String\(PAGE_LIMIT\)\)/);
  assert.match(source, /if \(!data\.hasMore \|\| data\.nextCursor == null\) break/);
  assert.doesNotMatch(source, /from ['"]@\/data\/menus\.json['"]|require\(['"][^'"]*menus\.json['"]\)/, 'the page must never load data/menus.json');
});

test('the default sort is "Met menukaart eerst" and A–Z is the alternative, in the URL', () => {
  const source = readPageSource();
  assert.match(source, /DEFAULT_SORT/);
  assert.match(source, /<option value=\{DEFAULT_SORT\}>📋 Met menukaart eerst<\/option>/);
  assert.match(source, /<option value="az">A–Z<\/option>/);
  assert.match(source, /params\.set\('sort', 'az'\)/);
  assert.match(source, /normalizeSort\(searchParams\.get\('sort'\)\)/);
});

test('the filter row reuses the existing filter results: "📋 Met menukaart" and real cuisine chips', () => {
  const source = readPageSource();
  assert.match(source, /cuisineChips\(results\)/);
  assert.match(source, /<Emoji glyph="📋" \/> Met menukaart/);
  assert.match(source, /aria-pressed=\{onlyWithMenu\}/);
  assert.match(source, /aria-pressed=\{activeCuisine === chip\.family\}/);
  assert.match(source, /filterRestaurants\(results, \{ onlyWithMenu, family: activeCuisine \}\)/);
});

test('the count is computed from the real data: total restaurants and N with a menu', () => {
  const source = readPageSource();
  assert.match(source, /const totalWithMenu = countWithMenu\(results\)/);
  assert.match(source, /const visibleWithMenu = countWithMenu\(visible\)/);
  assert.match(source, /met menukaart/);
  assert.match(source, /withPlural\(total, 'restaurant', 'restaurants'\)/);
});

test('imports and renders the shared PrimaryNav component, before ThemeToggle, inside the existing header-right group', () => {
  const source = readPageSource();
  assert.match(source, /import PrimaryNav from ['"]@\/src\/components\/PrimaryNav['"]/);
  assert.match(source, /<div className="header-right">\s*<PrimaryNav \/>\s*<ThemeToggle \/>\s*<ShareSettingsButton \/>\s*<\/div>/);
});

test('the header-right group uses the shared .header-right class, not an inline style', () => {
  const source = readPageSource();
  assert.doesNotMatch(source, /style=\{\{\s*display:\s*'flex',\s*gap:\s*8/, 'the old inline right-hand header style must be gone');
});
