'use strict';

// BE-28b (#68) — regressies voor de sorteer-, filter-, tel- en kaartregels
// van /alle-restaurants. Fictieve fixtures in dezelfde vorm als
// docs/api/restaurant-summary-shape.md, plus de echte verhoudingen
// (25 restaurants, 4 met menukaart) als controle op de telling.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEFAULT_SORT,
  normalizeSort,
  sortRestaurants,
  filterRestaurants,
  countWithMenu,
  cuisineChips,
  cardModel,
} = require('./restaurantBrowse');

const fixture = [
  { restaurantId: 'a', name: 'Al Dente', cuisine: 'Italiaans · Klassiek', priceLevel: 2, address: 'Straat 1', buurt: 'Binnenstad', hasMenu: false, menuLinks: [] },
  { restaurantId: 'b', name: 'Bardot', cuisine: 'Franse Brasserie · Wijnbar', priceLevel: 2, address: 'Straat 2', buurt: 'Binnenstad', hasMenu: true, menuLinks: [{ id: 'b-lunch', label: '🥗 Lunchkaart' }, { id: 'b-diner', label: '🍽 Dinerkaart' }] },
  { restaurantId: 'c', name: 'Con Fuego', cuisine: 'Grill · Steakhouse', priceLevel: 3, address: null, buurt: 'Binnenstad', hasMenu: false, menuLinks: [] },
  { restaurantId: 'd', name: 'Dolce', cuisine: 'Italiaans · Pizza & Pasta', priceLevel: 2, address: 'Straat 4', buurt: 'Binnenstad', hasMenu: false, menuLinks: [] },
];

test('de standaardsortering is "Met menukaart eerst" en dat is ook de terugval', () => {
  assert.equal(DEFAULT_SORT, 'menu-first');
  assert.equal(normalizeSort(undefined), 'menu-first');
  assert.equal(normalizeSort('iets-anders'), 'menu-first');
  assert.equal(normalizeSort('az'), 'az');
});

test('met menukaart eerst: kaarten met menu bovenaan, daarbinnen alfabetisch', () => {
  const sorted = sortRestaurants(fixture, 'menu-first');
  assert.deepEqual(sorted.map((r) => r.name), ['Bardot', 'Al Dente', 'Con Fuego', 'Dolce']);
  assert.equal(sorted[0].hasMenu, true);
});

test('A–Z sorteert alles alfabetisch, ongeacht menukaart', () => {
  const sorted = sortRestaurants(fixture, 'az');
  assert.deepEqual(sorted.map((r) => r.name), ['Al Dente', 'Bardot', 'Con Fuego', 'Dolce']);
});

test('sorteren muteert de aangeleverde lijst niet', () => {
  const before = fixture.map((r) => r.name);
  sortRestaurants(fixture, 'az');
  assert.deepEqual(fixture.map((r) => r.name), before);
});

test('filteren op menukaart en op keuken gebruikt dezelfde echte velden', () => {
  assert.deepEqual(filterRestaurants(fixture, { onlyWithMenu: true }).map((r) => r.name), ['Bardot']);
  assert.deepEqual(filterRestaurants(fixture, { family: 'Italiaans' }).map((r) => r.name), ['Al Dente', 'Dolce']);
  assert.deepEqual(filterRestaurants(fixture, { onlyWithMenu: true, family: 'Italiaans' }), []);
});

test('de telling "met menukaart" komt uit de echte data', () => {
  assert.equal(countWithMenu(fixture), 1);
  assert.equal(countWithMenu([]), 0);
});

test('keukenchips komen alleen uit voorkomende keukens, met emoji en aantal', () => {
  const chips = cuisineChips(fixture);
  assert.deepEqual(chips.map((chip) => [chip.family, chip.count, chip.emoji]), [
    ['Italiaans', 2, '🍝'],
    ['Frans', 1, '🥂'],
    ['Grill', 1, '🥩'],
  ]);
});

test('een onbekende keuken maakt een eigen chip met de neutrale 🍽️', () => {
  const chips = cuisineChips([{ cuisine: 'Peruaans · Ceviche', hasMenu: false, menuLinks: [] }]);
  assert.deepEqual(chips, [{ family: 'Peruaans', count: 1, emoji: '🍽️' }]);
});

test('kaartmodel met menukaart: één CTA met het echte aantal en de bestaande labels', () => {
  const model = cardModel(fixture[1]);
  assert.equal(model.href, '/restaurant/b');
  assert.equal(model.emoji, '🥂');
  assert.equal(model.kind, 'Franse Brasserie · Wijnbar · €€');
  assert.equal(model.address, 'Straat 2');
  assert.equal(model.hasMenu, true);
  assert.equal(model.ctaLabel, 'Bekijk 2 menukaarten');
  assert.deepEqual(model.menuLabels, ['🥗 Lunchkaart', '🍽 Dinerkaart']);
});

test('kaartmodel zonder menukaart: geen grote CTA, wel het neutrale label en de restaurantlink', () => {
  const model = cardModel(fixture[0]);
  assert.equal(model.hasMenu, false);
  assert.equal(model.ctaLabel, null);
  assert.equal(model.noMenuLabel, 'Nog geen menukaart');
  assert.equal(model.restaurantLabel, 'Bekijk restaurant');
});

test('kaartmodel met één menukaart zegt "Bekijk menukaart" (enkelvoud)', () => {
  const model = cardModel({ restaurantId: 'e', name: 'Een', cuisine: 'Frans', hasMenu: true, menuLinks: [{ id: 'e-diner', label: '🍽 Dinerkaart' }] });
  assert.equal(model.ctaLabel, 'Bekijk menukaart');
});

test('een ontbrekend adres valt terug op een expliciet "Buurt:"-label, nooit op een kale buurtnaam', () => {
  const model = cardModel(fixture[2]);
  assert.equal(model.address, 'Buurt: Binnenstad');
});
