'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeHostname, matchRestaurantByHostname, buildRestaurantChoiceList } = require('./restaurantHostMatch');

const SAMPLE_RESTAURANTS = {
  '1': { name: 'Restaurant Een', website: 'https://www.restaurant-een.nl' },
  '2': { name: 'Restaurant Twee', website: 'https://restaurant-twee.nl/menu' },
  '3': { name: 'Restaurant Drie zonder website' },
};

test('normalizeHostname: strips protocol, path, and a leading www.', () => {
  assert.equal(normalizeHostname('https://www.Example.com/pad?x=1'), 'example.com');
  assert.equal(normalizeHostname('example.com'), 'example.com');
});

test('normalizeHostname: null for unparseable/empty input, never throws', () => {
  assert.equal(normalizeHostname(''), null);
  assert.equal(normalizeHostname(null), null);
  assert.equal(normalizeHostname(undefined), null);
});

test('matchRestaurantByHostname: exact match (www. difference ignored)', () => {
  const result = matchRestaurantByHostname(SAMPLE_RESTAURANTS, 'https://restaurant-een.nl/dinerkaart');
  assert.equal(result.matchType, 'exact');
  assert.equal(result.restaurantId, '1');
});

test('matchRestaurantByHostname: no match for an unrelated hostname', () => {
  const result = matchRestaurantByHostname(SAMPLE_RESTAURANTS, 'https://een-of-ander-platform.com/menu/123');
  assert.equal(result.matchType, 'none');
  assert.equal(result.restaurantId, null);
});

test('matchRestaurantByHostname: a restaurant with no website field is never a match target', () => {
  const result = matchRestaurantByHostname(SAMPLE_RESTAURANTS, 'https://restaurant-drie.nl');
  assert.equal(result.matchType, 'none');
});

test('matchRestaurantByHostname: multiple restaurants sharing the same hostname is reported, never guessed', () => {
  const restaurants = {
    ...SAMPLE_RESTAURANTS,
    '4': { name: 'Restaurant Vier', website: 'https://restaurant-een.nl/andere-vestiging' },
  };
  const result = matchRestaurantByHostname(restaurants, 'https://restaurant-een.nl/dinerkaart');
  assert.equal(result.matchType, 'multiple');
  assert.equal(result.restaurantId, null);
  assert.equal(result.candidates.length, 2);
});

test('matchRestaurantByHostname: never throws on malformed restaurant data', () => {
  assert.doesNotThrow(() => matchRestaurantByHostname({ '1': null, '2': 'not-an-object' }, 'https://example.com'));
});

test('buildRestaurantChoiceList: returns every restaurant, sorted by name', () => {
  const list = buildRestaurantChoiceList(SAMPLE_RESTAURANTS);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((r) => r.id), ['3', '1', '2']);
});
