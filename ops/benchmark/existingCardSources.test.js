'use strict';

// Fixture-only guards for the existing-card comparison helpers. They never
// fetch a real card source: they pin the meaning of the historical export, the
// route matching and the structure-independent name+price diff.

const test = require('node:test');
const assert = require('node:assert/strict');

const menus = require('../../data/menus.json');
const manifest = require('./existing-card-sources.json');
const {
  validateExistingCardManifest,
  historicalEntries,
  liveMenusForHistoricalSource,
  namePriceComparison,
  summarizeLiveMenus,
} = require('./existingCardSources');

function source(overrides = {}) {
  return {
    id: 'fixture',
    label: 'Fixture',
    restaurantId: '999',
    entryUrl: 'https://fixture.invalid/',
    allowedHosts: ['fixture.invalid'],
    menuKeys: ['1-lunch'],
    probeUrls: ['https://fixture.invalid/menu'],
    ...overrides,
  };
}

test('the pinned four-card manifest matches the historical export', () => {
  const validation = validateExistingCardManifest(manifest, menus);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(manifest.sources.map((entry) => entry.id), ['wolfslaar', 'bardot', 'zuyd', 'thuis']);
  const keys = manifest.sources.flatMap((entry) => entry.menuKeys);
  assert.equal(keys.length, 11);
  for (const key of keys) assert.ok(menus[key], `${key} exists in data/menus.json`);
  assert.equal(manifest.authorization.appProviderActivation, false);
});

test('a manifest with an unknown historical menu key or host is refused', () => {
  const unknownKey = validateExistingCardManifest(
    { ...manifest, sources: [source({ menuKeys: ['999-lunch'] })] },
    menus,
  );
  assert.equal(unknownKey.ok, false);
  assert.match(unknownKey.errors.join('; '), /999-lunch does not exist/);

  const badHost = validateExistingCardManifest(
    { ...manifest, sources: [source({ probeUrls: ['https://evil.invalid/menu'] })] },
    menus,
  );
  assert.match(badHost.errors.join('; '), /pinned allowedHosts/);

  const noProviderRule = validateExistingCardManifest(
    { ...manifest, authorization: { reference: 'x' }, sources: [source()] },
    menus,
  );
  assert.match(noProviderRule.errors.join('; '), /provider activation/);
});

test('historical entries keep their own date, route and rows', () => {
  const entries = historicalEntries(menus, manifest.sources.find((entry) => entry.id === 'zuyd'));
  assert.deepEqual(entries.map((entry) => entry.key), ['19-lunch', '19-diner']);
  assert.equal(entries[0].scraped, '2026-03-28');
  assert.match(entries[0].sourceUrl, /restaurantzuyd\.nl\/lunch$/);
  assert.equal(entries[0].itemCount, 22);
  assert.equal(entries[1].itemCount, 20);
});

test('live menus are matched on the exact route, otherwise labelled as a union', () => {
  const actual = [
    { sourceUrl: 'https://www.restaurantzuyd.nl/lunch', categories: [] },
    { sourceUrl: 'https://www.restaurantzuyd.nl/diner', categories: [] },
  ];
  const exact = liveMenusForHistoricalSource(actual, 'https://www.restaurantzuyd.nl/lunch/');
  assert.equal(exact.liveMatch, 'source_url');
  assert.equal(exact.menus.length, 1);
  const union = liveMenusForHistoricalSource(actual, 'https://www.restaurantzuyd.nl/kerstmenu');
  assert.equal(union.liveMatch, 'source_union');
  assert.equal(union.menus.length, 2);
  assert.equal(liveMenusForHistoricalSource([], 'https://www.restaurantzuyd.nl/lunch').liveMatch, 'none');
});

test('name+price comparison is a multiset and separates price errors from missing rows', () => {
  const reference = [
    { name: 'Bites', items: [{ name: 'Soep', price: '€ 7,50' }, { name: 'Brood', price: '€3,00' }] },
    { name: 'Lunch', items: [{ name: 'Soep', price: '€ 7,50' }] },
  ];
  const actual = [
    {
      categories: [
        { path: ['Anders'], items: [{ name: 'Soep', price: '7.50' }, { name: 'Soep', price: '7.50' }, { name: 'Brood', price: '3.50' }] },
      ],
    },
  ];
  const comparison = namePriceComparison(reference, actual);
  assert.equal(comparison.referenceItems, 3);
  assert.equal(comparison.actualItems, 3);
  assert.equal(comparison.matched, 2);
  assert.deepEqual(comparison.missing, []);
  assert.deepEqual(comparison.priceMismatches, [{ name: 'Brood', expectedPrice: '3.00', actualPrice: '3.50' }]);
  assert.deepEqual(comparison.extra, []);
  assert.equal(comparison.balanced, true);
});

test('name+price comparison never discards an unmatched actual row', () => {
  const reference = [{ name: 'Bites', items: [{ name: 'Soep', price: '7,50' }] }];
  const actual = [{ categories: [{ path: ['Bites'], items: [{ name: 'Soep', price: '7.50' }, { name: 'Verzonnen', price: '9.00' }] }] }];
  const comparison = namePriceComparison(reference, actual);
  assert.equal(comparison.matched, 1);
  assert.deepEqual(comparison.extra, [{ name: 'Verzonnen', price: '9.00' }]);
  assert.equal(comparison.balanced, true);
});

test('summarizeLiveMenus keeps per-item locator and price status', () => {
  const live = summarizeLiveMenus([
    {
      title: 'Lunch',
      sourceUrl: 'https://fixture.invalid/lunch',
      categories: [{ path: ['Bites'], items: [{ name: 'Soep', price: '7.50', evidence: { locator: 'html>p[1]' } }] }],
    },
  ]);
  assert.equal(live.length, 1);
  assert.deepEqual(live[0].categories[0].path, ['Bites']);
  assert.deepEqual(live[0].items, [{ name: 'Soep', price: '7.50', priceStatus: null, locator: 'html>p[1]' }]);
});
