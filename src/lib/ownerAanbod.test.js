'use strict';

// BE-55 stap B (#135) — de restaurants waarvoor deze houder aanbod beheert.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { eigenRestaurants } = require('./ownerAanbod');

test('alleen een owner-rol met restaurant_id telt', () => {
  const uitkomst = eigenRestaurants({
    roles: [
      { role: 'owner', restaurant_id: '6' },
      { role: 'internal', restaurant_id: null },
      { role: 'owner', restaurant_id: null },
      { role: 'editor', restaurant_id: '1' },
      { role: 'owner', restaurant_id: '6' },
    ],
    restaurantIndex: { 6: { name: 'De Groene Deur' } },
  });
  assert.deepEqual(uitkomst, [{ id: '6', name: 'De Groene Deur' }]);
});

test('onbekende namen vallen terug op het id en de lijst is gesorteerd', () => {
  const uitkomst = eigenRestaurants({
    roles: [
      { role: 'owner', restaurant_id: '2' },
      { role: 'owner', restaurant_id: '1' },
      { role: 'owner', restaurant_id: 'onbekend' },
    ],
    restaurantIndex: { 1: { name: 'Bistro Een' }, 2: { name: 'Café Twee' } },
  });
  assert.deepEqual(uitkomst.map((rij) => rij.id), ['1', '2', 'onbekend']);
  assert.deepEqual(uitkomst.map((rij) => rij.name), ['Bistro Een', 'Café Twee', 'onbekend']);
});

test('zonder rollen of index blijft de lijst leeg of eerlijk', () => {
  assert.deepEqual(eigenRestaurants(), []);
  assert.deepEqual(eigenRestaurants({ roles: null, restaurantIndex: null }), []);
  assert.deepEqual(eigenRestaurants({ roles: [{ role: 'owner', restaurant_id: '9' }] }), [{ id: '9', name: '9' }]);
});
