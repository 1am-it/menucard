'use strict';

// BE-27 — pure export generation: one complete menu for exactly one
// restaurant, nothing else in the static data changes. Fictional data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatEuro, buildMenuEntry, applyExport, serialize, exportScopeViolations, restaurantMenuEntries } = require('./menuExport');

const MENUS = {
  '1-lunch': { subtitle: 'Lunchkaart', categories: [{ name: 'Lunch', items: [{ name: 'Fictieve soep', desc: 'Huisgemaakt', price: '€7,50', priceValue: 7.5, tags: ['aanbevolen'], allergens: [9], wine: 'Fictieve wijn' }] }] },
  '1-diner': { subtitle: 'Dinerkaart', categories: [{ name: 'Hoofd', items: [{ name: 'Fictieve entrecote', price: '€24,50', priceValue: 24.5, tags: [] }] }] },
  '19-diner': { subtitle: 'Dinerkaart', categories: [{ name: 'Hoofd', items: [{ name: 'Ander gerecht', price: '€20', tags: [] }] }] },
};
const RESTAURANTS = {
  1: { name: 'Fictief Eén', address: 'Fictieve straat 1', menuLinks: [{ id: '1-lunch', label: 'Lunch' }, { id: '1-diner', label: 'Diner' }], phone: '000' },
  2: { name: 'Fictief Twee', address: 'Fictieve straat 2' },
  19: { name: 'Fictief Negentien', menuLinks: [{ id: '19-diner', label: 'Diner' }] },
};
const CONTENT = {
  categories: [
    { name: 'Voorgerechten', items: [{ name: 'Fictieve soep', desc: null, price: '8.50', from: '0.0.0' }] },
    { name: 'Hoofdgerechten', items: [{ name: 'Fictieve risotto', desc: 'Paddenstoelen', price: '18.00' }] },
  ],
  removed: [{ name: 'Fictieve entrecote', decision: 'remove' }],
};

test('prices use the existing notation', () => {
  assert.equal(formatEuro('14.50'), '€14,50');
  assert.equal(formatEuro('85.00'), '€85');
  assert.equal(formatEuro('0.95'), '€0,95');
  assert.equal(formatEuro(null), null);
});

test('one complete entry: concept prices and sections, published enrichment kept for known dishes, no business fields', () => {
  const entry = buildMenuEntry({ content: CONTENT, currentEntries: restaurantMenuEntries(MENUS, '1'), sourceUrl: 'https://fictief.example/menu', scraped: '2026-10-14' });
  assert.deepEqual(Object.keys(entry), ['subtitle', 'scraped', 'source', 'categories']);
  const soup = entry.categories[0].items[0];
  assert.deepEqual(soup, { name: 'Fictieve soep', desc: 'Huisgemaakt', price: '€8,50', priceValue: 8.5, priceOnRequest: false, priceIsSupplement: false, priceIsFrom: false, priceIsMultiple: false, tags: ['aanbevolen'], allergens: [9], wine: 'Fictieve wijn' });
  assert.equal(entry.categories[1].items[0].price, '€18');
  assert.ok(!('from' in soup) && !('accepted' in soup) && !('kept' in soup));
});

test('never a partial menu: a dish without price or an empty menu throws', () => {
  assert.throws(() => buildMenuEntry({ content: { categories: [{ name: 'X', items: [{ name: 'Zonder prijs', price: null }] }] }, currentEntries: {} }), /export_incomplete/);
  assert.throws(() => buildMenuEntry({ content: { categories: [] }, currentEntries: {} }), /export_incomplete/);
});

test('apply: all menus of exactly this restaurant become one menukaart at the same place; only its menuLinks change', () => {
  const entry = buildMenuEntry({ content: CONTENT, currentEntries: restaurantMenuEntries(MENUS, '1'), sourceUrl: 'https://fictief.example/menu', scraped: '2026-10-14' });
  const after = applyExport({ menus: MENUS, restaurants: RESTAURANTS, restaurantId: '1', entry });
  assert.deepEqual(Object.keys(after.menus), ['1-menukaart', '19-diner']);
  assert.deepEqual(after.menus['19-diner'], MENUS['19-diner']); // "1-" never matches "19-"
  assert.deepEqual(after.restaurants['1'].menuLinks, [{ id: '1-menukaart', label: '📋 Menukaart' }]);
  assert.deepEqual(Object.keys(after.restaurants['1']), Object.keys(RESTAURANTS['1'])); // field order kept
  assert.equal(after.restaurants['1'].address, 'Fictieve straat 1');
  assert.deepEqual(exportScopeViolations({ before: { menus: MENUS, restaurants: RESTAURANTS }, after, restaurantId: '1' }), []);
  // A restaurant without a menu gets one appended, plus menuLinks.
  const fresh = applyExport({ menus: MENUS, restaurants: RESTAURANTS, restaurantId: '2', entry });
  assert.deepEqual(Object.keys(fresh.menus), ['1-lunch', '1-diner', '19-diner', '2-menukaart']);
  assert.deepEqual(fresh.restaurants['2'].menuLinks, [{ id: '2-menukaart', label: '📋 Menukaart' }]);
  assert.throws(() => applyExport({ menus: MENUS, restaurants: RESTAURANTS, restaurantId: '99', entry }), /export_unknown_restaurant/);
});

test('scope check catches any change outside this restaurant menu', () => {
  const before = { menus: MENUS, restaurants: RESTAURANTS };
  const tampered = { menus: { ...MENUS, '19-diner': { categories: [] } }, restaurants: { ...RESTAURANTS, 1: { ...RESTAURANTS['1'], phone: '111' }, 2: { ...RESTAURANTS['2'], name: 'Anders' } } };
  assert.deepEqual(exportScopeViolations({ before, after: tampered, restaurantId: '1' }).sort(), ['menus:19-diner', 'restaurants:1.phone', 'restaurants:2']);
});

test('serialisation matches the repository files: 2-space JSON with a trailing newline, a round trip changes nothing', () => {
  const fs = require('node:fs');
  const { frozenPath } = require('../test-fixtures/useFrozenData');
  for (const name of ['menus', 'restaurants']) {
    const raw = fs.readFileSync(frozenPath('current', name), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(serialize(JSON.parse(raw)), raw, `frozen-data/${name}.json`);
  }
});
