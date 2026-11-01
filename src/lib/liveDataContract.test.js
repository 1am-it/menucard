'use strict';

// BE-76 (#189) — het enige contract op de levende kaartdata.
//
// Alle andere tests draaien op de vaste kopie in src/test-fixtures/frozen-data/
// (zie src/test-fixtures/useFrozenData.js). Deze test kijkt juist naar
// data/menus.json en data/restaurants.json zelf en controleert alleen regels,
// nooit aantallen: een nieuwe of ververste kaart mag hem niet breken, een
// kapotte kaart wel.
//
// Regels (uitkomst 4 van #189):
//   1. elk restaurant heeft een id, een naam en een geldige buurt;
//   2. elke menuLink verwijst naar een bestaande kaart, en elke kaart hoort bij
//      een bestaand restaurant;
//   3. elke prijs is een getal, of null met priceOnRequest;
//   4. elke nieuwe kaart (niet in de vaste kopie) heeft source, scraped en
//      leadChecked.
//
// Deze test laadt de levende data bewust zonder useFrozenData; de bewaker in
// src/lib/frozenDataGuard.test.js staat dat alleen hier toe.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FROZEN = path.join(__dirname, '..', 'test-fixtures', 'frozen-data');

const restaurants = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'restaurants.json'), 'utf8'));
const menus = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'menus.json'), 'utf8'));
const frozenMenus = JSON.parse(fs.readFileSync(path.join(FROZEN, 'menus.json'), 'utf8'));

const RESTAURANT_IDS = Object.keys(restaurants);
const MENU_IDS = Object.keys(menus);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function restaurantIdOfMenu(menuId) {
  return String(menuId).split('-')[0];
}

function dishesOf(menu) {
  return (menu.categories || []).reduce((all, category) => all.concat(category.items || []), []);
}

test('elk restaurant heeft een id, een naam en een geldige buurt', () => {
  for (const id of RESTAURANT_IDS) {
    const restaurant = restaurants[id];
    assert.match(id, /^\d+$/, `restaurant-id "${id}" is geen getal`);
    assert.equal(typeof restaurant.name, 'string', `restaurant ${id} heeft geen naam`);
    assert.ok(restaurant.name.trim(), `restaurant ${id} heeft een lege naam`);
    assert.equal(typeof restaurant.buurt, 'string', `restaurant ${id} (${restaurant.name}) heeft geen buurt`);
    assert.ok(restaurant.buurt.trim(), `restaurant ${id} (${restaurant.name}) heeft een lege buurt`);
    assert.doesNotMatch(restaurant.buurt, /onbekend|unknown|n\/a|tbd/i, `restaurant ${id} heeft een plaatsvervangende buurt ("${restaurant.buurt}")`);
  }
});

test('elke menuLink verwijst naar een bestaande kaart, en elke kaart hoort bij een bestaand restaurant', () => {
  for (const id of RESTAURANT_IDS) {
    const restaurant = restaurants[id];
    for (const link of restaurant.menuLinks || []) {
      assert.ok(link && typeof link.id === 'string' && link.id.trim(), `restaurant ${id} heeft een menuLink zonder id`);
      assert.ok(MENU_IDS.includes(link.id), `restaurant ${id} (${restaurant.name}) linkt naar kaart "${link.id}", die niet in data/menus.json staat`);
    }
  }

  for (const menuId of MENU_IDS) {
    const restaurantId = restaurantIdOfMenu(menuId);
    assert.ok(RESTAURANT_IDS.includes(restaurantId), `kaart "${menuId}" hoort bij restaurant ${restaurantId}, dat niet in data/restaurants.json staat`);
    const menu = menus[menuId];
    assert.ok(Array.isArray(menu.categories) && menu.categories.length, `kaart "${menuId}" heeft geen categorieën`);
    assert.ok(dishesOf(menu).length, `kaart "${menuId}" heeft geen gerechten`);
  }
});

test('elke prijs is een getal, of null met priceOnRequest', () => {
  for (const menuId of MENU_IDS) {
    for (const dish of dishesOf(menus[menuId])) {
      const where = `kaart "${menuId}", gerecht "${dish.name}"`;
      assert.ok(Object.prototype.hasOwnProperty.call(dish, 'priceValue'), `${where} heeft geen priceValue`);
      if (dish.priceValue === null) {
        assert.equal(dish.priceOnRequest, true, `${where} heeft geen prijs en staat niet op priceOnRequest`);
      } else {
        assert.equal(typeof dish.priceValue, 'number', `${where} heeft een priceValue van ${typeof dish.priceValue}`);
        assert.ok(Number.isFinite(dish.priceValue), `${where} heeft een priceValue dat geen getal is`);
        assert.ok(dish.priceValue >= 0, `${where} heeft een negatieve prijs (${dish.priceValue})`);
        assert.notEqual(dish.priceOnRequest, true, `${where} heeft én een prijs én priceOnRequest`);
      }
    }
  }
});

test('elke nieuwe kaart heeft source, scraped en leadChecked', () => {
  const known = new Set(Object.keys(frozenMenus));
  const added = MENU_IDS.filter((menuId) => !known.has(menuId));

  for (const menuId of MENU_IDS) {
    const menu = menus[menuId];
    assert.ok(typeof menu.source === 'string' && menu.source.trim(), `kaart "${menuId}" heeft geen source`);
    assert.match(String(menu.scraped), DATE, `kaart "${menuId}" heeft geen datum in scraped ("${menu.scraped}")`);
  }

  for (const menuId of added) {
    const menu = menus[menuId];
    assert.ok(String(menu.leadChecked || '').trim(), `nieuwe kaart "${menuId}" heeft geen leadChecked`);
    assert.match(String(menu.leadChecked), DATE, `nieuwe kaart "${menuId}" heeft geen datum in leadChecked ("${menu.leadChecked}")`);
  }

  // Zonder nieuwe kaarten is deze regel hol; dat mag, maar maak het zichtbaar.
  if (!added.length) {
    assert.deepEqual(added, [], 'geen nieuwe kaarten sinds de vaste kopie');
  }
});
