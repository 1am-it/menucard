'use strict';

// BE-28 (#65) — "Vanavond op de kaart" mag nooit een gerecht of prijs
// verzinnen. Deze test bewijst dat elke selectie terug te vinden is in de
// bestaande data (data/menus.json) met exact dezelfde prijs, dat de selectie
// deterministisch is per dag, en dat er niets uit een niet-bestaand restaurant
// komt. Zie src/lib/publicTonight.js.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { selectTonightDishes, dishEmoji, dayOfYear, MAX_DISHES } = require('./publicTonight');

const ROOT = path.join(__dirname, '..', '..');
const menus = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/menus.json'), 'utf8'));
const restaurants = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/restaurants.json'), 'utf8'));

// Every real dish of one menu entry, flattened.
function menuItems(menuKey) {
  const entry = menus[menuKey];
  assert.ok(entry, `menu ${menuKey} exists`);
  return (entry.categories || []).flatMap((category) => category.items || []);
}

test('returns at most three real diner dishes, each from a different restaurant', () => {
  const tonight = selectTonightDishes(new Date('2026-10-25T18:00:00Z'));
  assert.ok(tonight.length > 0, 'the real data contains at least one priced diner dish');
  assert.ok(tonight.length <= MAX_DISHES);
  assert.equal(new Set(tonight.map((d) => d.restaurantId)).size, tonight.length, 'one dish per restaurant');
  for (const dish of tonight) {
    assert.match(dish.menuLink, /^\/menu\/\d+-diner$/, 'a real existing diner menu link');
    assert.ok(restaurants[dish.restaurantId], 'the restaurant exists in data/restaurants.json');
    assert.equal(dish.restaurantName, restaurants[dish.restaurantId].name);
  }
});

test('every shown dish and price exists verbatim in data/menus.json — nothing is invented', () => {
  const tonight = selectTonightDishes(new Date('2026-10-25T18:00:00Z'));
  for (const dish of tonight) {
    const items = menuItems(dish.menuLink.replace('/menu/', ''));
    const match = items.find((item) => item.name === dish.name && item.price === dish.priceDisplay);
    assert.ok(match, `${dish.name} / ${dish.priceDisplay} must exist in ${dish.menuLink}`);
    assert.equal(dish.priceOnRequest, !!match.priceOnRequest);
    assert.ok(!dish.priceOnRequest, 'a dish without a price never makes the cut');
  }
});

test('is deterministic for one day and rotates with the day of the year', () => {
  const morning = selectTonightDishes(new Date('2026-10-25T08:00:00Z'));
  const evening = selectTonightDishes(new Date('2026-10-25T22:00:00Z'));
  assert.deepEqual(morning, evening, 'same day, same selection — the ISR cache never flickers per request');
  assert.equal(dayOfYear(new Date('2026-10-25T08:00:00Z')), 298);
  assert.equal(dayOfYear(new Date('2026-01-01T00:00:00Z')), 1);
});

test('carries the restaurant opening hours, so "Nu open" has a real source', () => {
  const tonight = selectTonightDishes(new Date('2026-10-25T18:00:00Z'));
  for (const dish of tonight) {
    assert.deepEqual(dish.openingHours, restaurants[dish.restaurantId].openingHours || null);
  }
});

test('the emoji is decorative: a known word gives a fitting glyph, everything else stays the neutral plate', () => {
  assert.equal(dishEmoji('Spaghetti aglio e olio', 'Pasta'), '🍝');
  assert.equal(dishEmoji('Pizza margherita', 'Pizza'), '🍕');
  assert.equal(dishEmoji('Bisque de homard', 'Voorgerechten'), '🍲');
  assert.equal(dishEmoji('Onbekend gerecht', 'Overig'), '🍽️');
});
