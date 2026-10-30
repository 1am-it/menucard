'use strict';

// BE-56 (#137) — het korte QR-adres, criterium 5 van het contract.
//
// De test gebruikt de echte restaurantgegevens (data/restaurants.json), net als
// app/r/[id]/page.js: geen fixture die een id kan noemen dat niet bestaat.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  QR_ROUTE_PREFIX,
  RESTAURANT_ROUTE_PREFIX,
  qrRestaurantHref,
  qrRestaurantId,
  qrRestaurantTarget,
  restaurantHref,
} = require('./qrRoute');

const RESTAURANTS = require('../../data/restaurants.json');
const IDS = Object.keys(RESTAURANTS);

test('het korte adres wijst naar de juiste restaurantpagina', () => {
  assert.equal(QR_ROUTE_PREFIX, '/r');
  assert.equal(RESTAURANT_ROUTE_PREFIX, '/restaurant');
  // De echte gegevens: elk restaurant werkt, met en zonder naam erachter.
  for (const id of IDS) {
    const name = String(RESTAURANTS[id].name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-');
    assert.equal(qrRestaurantTarget({ id, restaurants: RESTAURANTS }), id);
    assert.equal(qrRestaurantTarget({ id: `${id}-${name}`, restaurants: RESTAURANTS }), id, `${id}-${name} moet ${id} geven`);
    assert.equal(restaurantHref(id), `/restaurant/${id}`);
  }
  assert.equal(qrRestaurantTarget({ id: '6', restaurants: RESTAURANTS }), '6');
  assert.equal(qrRestaurantTarget({ id: '6-blossem', restaurants: RESTAURANTS }), '6');
  assert.equal(qrRestaurantTarget({ id: '6-blossem-de-doorzon', restaurants: RESTAURANTS }), '6');
  assert.equal(restaurantHref('6'), '/restaurant/6');
  assert.equal(qrRestaurantHref('6'), '/r/6');
  assert.equal(qrRestaurantHref('6-blossem'), '/r/6-blossem');
});

test('een onbekend of ongeldig id geeft geen doel, dus een 404', () => {
  for (const id of ['', '   ', null, undefined, '99', '99-blossem', 'blossem', 'onbekend', '/', '6/7', '-', '--6']) {
    assert.equal(qrRestaurantTarget({ id, restaurants: RESTAURANTS }), null, `${String(id)} hoort geen doel te hebben`);
  }
  // Zonder gegevens is er ook geen doel.
  assert.equal(qrRestaurantTarget({ id: '6' }), null);
  assert.equal(qrRestaurantTarget({ id: '6', restaurants: null }), null);
  assert.equal(qrRestaurantTarget(), null);
  // Geen enkele stille doorverwijzing naar de home of naar een ander id.
  assert.notEqual(qrRestaurantTarget({ id: '99', restaurants: RESTAURANTS }), '1');
});

test('de id-lezer neemt alleen het stuk vóór de eerste streep', () => {
  assert.equal(qrRestaurantId('6-blossem'), '6');
  assert.equal(qrRestaurantId('6'), '6');
  assert.equal(qrRestaurantId(' 6-blossem '), '6');
  assert.equal(qrRestaurantId('6-'), '6');
  assert.equal(qrRestaurantId(''), null);
  assert.equal(qrRestaurantId('-6'), null);
  assert.equal(qrRestaurantId('blossem-6'), 'blossem');
  assert.equal(qrRestaurantId('6 7'), null);
});

test('een leeg id levert geen pad op in plaats van een half pad', () => {
  assert.equal(restaurantHref(''), null);
  assert.equal(restaurantHref(null), null);
  assert.equal(qrRestaurantHref(''), null);
  assert.equal(qrRestaurantHref(null), null);
});
