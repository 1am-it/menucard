'use strict';

// BE-65 (#157) — het bewaarde gerecht opbouwen uit de compacte gerechtregel
// die de home en /search al hebben. De id draagt de plek in de menukaart, dus
// er is geen tweede databron nodig; ongeldige regels leveren geen knop op.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const menusData = require('../../data/menus.json');
const restaurantsData = require('../../data/restaurants.json');
const { entryFromDish } = require('./dishList');

const MENU_ID = '6-diner';
const DISH_ID = '6-diner-0-0';
const menu = menusData[MENU_ID];
const restaurant = restaurantsData['6'];
const item = menu.categories[0].items[0];

test('entryFromDish: dezelfde id en dezelfde gegevens als buildEntry op de menukaart', () => {
  const entry = entryFromDish({
    dishId: DISH_ID,
    name: item.name,
    category: menu.categories[0].name,
    price: '€ 20,95',
    restaurantName: restaurant.name,
  });
  assert.equal(entry.id, DISH_ID);
  assert.equal(entry.menuId, MENU_ID);
  assert.equal(entry.catIdx, 0);
  assert.equal(entry.itemIdx, 0);
  assert.equal(entry.name, item.name);
  assert.equal(entry.category, menu.categories[0].name);
  assert.equal(entry.price, '€ 20,95');
  assert.equal(entry.restaurant, restaurant.name);
});

test('entryFromDish: zonder echte prijs blijft "op aanvraag" staan', () => {
  const entry = entryFromDish({ dishId: DISH_ID, name: 'Poussin', price: '', restaurantName: 'Restaurant' });
  assert.equal(entry.price, 'op aanvraag');
});

test('entryFromDish: een ongeldige of onvolledige regel geeft geen gerecht', () => {
  assert.equal(entryFromDish({ dishId: 'geen-id', name: 'Pasta' }), null);
  assert.equal(entryFromDish({ dishId: DISH_ID }), null);
  assert.equal(entryFromDish({ dishId: DISH_ID, name: '   ' }), null);
  assert.equal(entryFromDish(), null);
});

test('entryFromDish: een id met dezelfde vorm als de echte menukaarten blijft heel', () => {
  const entry = entryFromDish({ dishId: '12-lunch-3-7', name: 'Soep', category: 'Voorgerechten' });
  assert.equal(entry.id, '12-lunch-3-7');
  assert.equal(entry.catIdx, 3);
  assert.equal(entry.itemIdx, 7);
});
