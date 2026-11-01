'use strict';

// BE-75 (#187) — de levende data zelf: vier gesloten restaurants zijn weg.
//
// Salon de Provence (10), The Chai Affairs (14), Con Fuego (3) en Masala (18)
// bestaan niet meer, dus staan ze niet meer in data/restaurants.json en horen
// ze ook niet in de sitemap. De tests die van die vier of van het oude totaal
// afhangen, draaien op de vaste kopie van de data van vóór deze wijziging
// (src/services/__fixtures__/be75-closed-restaurants/); dit bestand bewaakt
// juist de echte, levende data en de sitemap.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { sitemapEntries } = require('./seo');

const restaurants = require('../../data/restaurants.json');
const menus = require('../../data/menus.json');

const CLOSED = [
  { id: '3', name: 'Con Fuego' },
  { id: '10', name: 'Salon de Provence' },
  { id: '14', name: 'The Chai Affairs' },
  { id: '18', name: 'Masala' },
];

const SITE = 'https://onzemenukaarten.nl';

test('de vier gesloten restaurants staan niet meer in de levende restaurantlijst', () => {
  for (const { id, name } of CLOSED) {
    assert.equal(Object.prototype.hasOwnProperty.call(restaurants, id), false, `restaurant ${id} (${name}) is gesloten en hoort niet meer in de data`);
  }
  const names = Object.values(restaurants).map((restaurant) => restaurant.name);
  for (const { name } of CLOSED) {
    assert.equal(names.includes(name), false, `${name} is gesloten en hoort niet meer in de data`);
  }
});

test('de levende lijst telt 21 restaurants en houdt de overige ids gewoon', () => {
  const ids = Object.keys(restaurants);
  assert.equal(ids.length, 21, 'na BE-75 blijven er 21 restaurants over');
  assert.deepEqual(ids.slice().sort((a, b) => Number(a) - Number(b)), ['1', '2', '4', '5', '6', '7', '8', '9', '11', '12', '13', '15', '16', '17', '19', '20', '21', '22', '23', '24', '25']);
});

test('geen van de vier heeft een kaart in data/menus.json', () => {
  // BE-75 raakt data/menus.json niet aan (BE-74 werkt daar); dit is alleen een
  // controle dat er geen weeskaart achterblijft.
  const menuIds = Object.keys(menus);
  for (const { id } of CLOSED) {
    const own = menuIds.filter((menuId) => menuId === id || menuId.startsWith(`${id}-`));
    assert.deepEqual(own, [], `menu ${own.join(', ')} hoort bij gesloten restaurant ${id}`);
  }
});

test('de sitemap telt de vier vaste pagina\'s, de 21 levende restaurants en de echte kaarten', () => {
  const restaurantsIds = Object.keys(restaurants);
  const menuIds = Object.keys(menus);
  const entries = sitemapEntries({ siteUrl: SITE, restaurants: restaurantsIds, menus: menuIds });
  const urls = entries.map((entry) => entry.url);

  assert.equal(entries.length, 4 + 21 + menuIds.length, 'geen dubbele en geen ontbrekende pagina');
  for (const id of restaurantsIds) {
    assert.ok(urls.includes(`${SITE}/restaurant/${id}`), `restaurant ${id} ontbreekt in de sitemap`);
  }
  for (const { id } of CLOSED) {
    assert.equal(urls.includes(`${SITE}/restaurant/${id}`), false, `gesloten restaurant ${id} hoort niet in de sitemap`);
  }
});
