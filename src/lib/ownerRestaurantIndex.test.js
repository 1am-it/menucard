'use strict';

// BE-57 (#139, deel 2) — de statische index van "Mijn restaurant" levert ook de
// laatste bijwerkdatum en de gerechtnamen die de top 4 nodig heeft.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildOwnerRestaurantIndex, menuSummary } = require('./ownerRestaurantIndex');

const MENUS = {
  '7-lunch': {
    name: 'Brasserie Zeven',
    subtitle: 'Lunchkaart',
    scraped: '2026-03-20',
    categories: [
      { name: 'Brood', items: [{ name: 'Croissant', price: '€3' }, { name: 'Bolletje', price: '€2' }] },
      { name: 'Warm', items: [{ name: 'Soep van de dag', price: '€6' }] },
    ],
  },
  '7-diner': {
    name: 'Brasserie Zeven',
    subtitle: 'Dinerkaart',
    scraped: '2026-04-02',
    categories: [{ name: 'Hoofd', items: [{ name: 'Kabeljauw', price: '€24' }] }],
  },
};

const RESTAURANTS = {
  '7': { name: 'Brasserie Zeven', menuLinks: [{ id: '7-lunch' }, { id: '7-diner' }] },
  '8': { name: 'Zonder kaart', menuLinks: [] },
};

test('BE-57: de index noemt de laatste bijwerkdatum van de gepubliceerde kaarten', () => {
  const index = buildOwnerRestaurantIndex(RESTAURANTS, MENUS);
  assert.deepEqual(index['7'].menuIds, ['7-lunch', '7-diner']);
  // De nieuwste kaart bepaalt de datum, niet de eerste.
  assert.equal(index['7'].menuUpdatedOn, '2026-04-02');
  assert.equal(index['8'].menuUpdatedOn, null);
});

test('BE-57: de index geeft alleen gerechtnamen, met dezelfde id als de tellers', () => {
  const index = buildOwnerRestaurantIndex(RESTAURANTS, MENUS);
  assert.deepEqual(index['7'].dishes, {
    '7-lunch-0-0': 'Croissant',
    '7-lunch-0-1': 'Bolletje',
    '7-lunch-1-0': 'Soep van de dag',
    '7-diner-0-0': 'Kabeljauw',
  });
  // Geen prijs, beschrijving of allergeen in de index.
  const serialised = JSON.stringify(index['7'].dishes);
  assert.equal(serialised.includes('€'), false);
});

test('BE-57: een kaart die niet in data/menus.json staat levert geen datum of namen', () => {
  const summary = menuSummary({ tabs: [{ id: '7-lunch' }, { id: '9-weg' }, {}], menusData: MENUS });
  assert.deepEqual(summary.menuIds, ['7-lunch', '9-weg']);
  assert.equal(summary.menuUpdatedOn, '2026-03-20');
  assert.deepEqual(Object.keys(summary.dishes), ['7-lunch-0-0', '7-lunch-0-1', '7-lunch-1-0']);
  assert.equal(menuSummary().menuUpdatedOn, null);
});

test('BE-57: met de echte data heeft elk restaurant met een kaart een datum en namen', () => {
  const restaurants = require('../../data/restaurants.json');
  const menus = require('../../data/menus.json');
  const index = buildOwnerRestaurantIndex(restaurants, menus);
  const withMenu = Object.values(index).filter((entry) => entry.menuIds.length > 0);
  assert.ok(withMenu.length > 0);
  for (const entry of withMenu) {
    assert.match(entry.menuUpdatedOn || '', /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Object.keys(entry.dishes).length > 0);
  }
  // Een datum zonder bijbehorende kaart bestaat niet.
  for (const entry of Object.values(index)) {
    if (entry.menuIds.length === 0) assert.equal(entry.menuUpdatedOn, null);
  }
});
