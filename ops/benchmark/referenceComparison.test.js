'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aggregateControlledReferences,
  compareControlledReference,
  priceSetFromActual,
  priceSetFromVariants,
} = require('./referenceComparison');

function reference(items) {
  return {
    label: 'Fixture',
    sourceId: 'fixture',
    menus: [
      {
        title: 'Lunch',
        captureKey: 'fixture.html',
        categories: [{ path: ['Lunch', 'Voor'], items }],
      },
    ],
  };
}

function menus(items, path = ['Voor'], title = 'Lunch') {
  return [
    {
      title,
      categories: [
        {
          path,
          items: items.map((item) => ({
            ...item,
            evidence: { locator: `locator ${item.name}`, quote: `quote ${item.name}` },
          })),
        },
      ],
    },
  ];
}

test('an exact name, price and rubric path is matched once', () => {
  const result = compareControlledReference(
    reference([{ name: 'Soep', price: '6.50', quote: 'Soep 6,50', locator: 'regel 1' }]),
    menus([{ name: 'Soep', price: '6.50' }]),
  );
  assert.equal(result.matched, 1);
  assert.equal(result.missing, 0);
  assert.equal(result.invented, 0);
  assert.equal(result.priceErrors, 0);
  assert.equal(result.categoryErrors, 0);
  assert.equal(result.precision, 100);
  assert.equal(result.recall, 100);
  assert.equal(result.accounting.reference.balanced, true);
  assert.equal(result.accounting.actual.balanced, true);
});

test('missed, invented, price and rubric errors are reported separately', () => {
  const result = compareControlledReference(
    reference([
      { name: 'Soep', price: '6.50', quote: 'Soep 6,50', locator: 'regel 1' },
      { name: 'Brood', price: '2.00', quote: 'Brood 2,00', locator: 'regel 2' },
      { name: 'Kaas', price: '5.00', quote: 'Kaas 5,00', locator: 'regel 3' },
    ]),
    menus([
      { name: 'Soep', price: '6.50' },
      { name: 'Brood', price: '9.00' },
      { name: 'Supplement truffel', price: '2.50' },
    ]),
  );
  assert.equal(result.matched, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.missingDishes[0].name, 'Kaas');
  assert.equal(result.invented, 1);
  assert.equal(result.inventedDishes[0].name, 'Supplement truffel');
  assert.equal(result.priceErrors, 1);
  assert.deepEqual(result.priceErrorRows[0].expectedPrices, ['2.00']);
  assert.deepEqual(result.priceErrorRows[0].actualPrices, ['9.00']);
  assert.equal(result.accounting.reference.accounted, 3);
  assert.equal(result.accounting.actual.accounted, 3);
});

test('a dish with the right name and amount in another rubric path is a rubric error', () => {
  const result = compareControlledReference(
    reference([{ name: 'Soep', price: '6.50', quote: 'Soep 6,50', locator: 'regel 1' }]),
    menus([{ name: 'Soep', price: '6.50' }], ['Nagerechten']),
  );
  assert.equal(result.matched, 0);
  assert.equal(result.missing, 0);
  assert.equal(result.invented, 0);
  assert.equal(result.categoryErrors, 1);
  assert.deepEqual(result.categoryErrorRows[0].expectedPath, ['Lunch', 'Voor']);
  assert.deepEqual(result.categoryErrorRows[0].actualPath, ['Lunch', 'Nagerechten']);
});

test('a missing or wrong price variant is one price error, not a missing dish', () => {
  const result = compareControlledReference(
    reference([
      {
        name: 'Wijn',
        priceVariants: [{ label: 'glas', price: '6.50' }, { label: 'fles', price: '25.00' }],
        quote: 'Wijn glas 6,50 fles 25,00',
        locator: 'regel 1',
      },
    ]),
    menus([{ name: 'Wijn', priceText: '9.50 / 18.00', priceStatus: 'multiple_undecomposed' }]),
  );
  assert.equal(result.matched, 0);
  assert.equal(result.missing, 0);
  assert.equal(result.priceErrors, 1);
  assert.deepEqual(result.priceErrorRows[0].expectedPrices, ['6.50', '25.00']);
  assert.deepEqual(result.priceErrorRows[0].actualPrices, ['9.50', '18.00']);
});

test('an extracted row without a usable name is still an invented row, never silently dropped', () => {
  const result = compareControlledReference(
    reference([{ name: 'Soep', price: '6.50', quote: 'Soep 6,50', locator: 'regel 1' }]),
    menus([{ name: 'Soep', price: '6.50' }, { name: '€', price: '39.50' }]),
  );
  assert.equal(result.matched, 1);
  assert.equal(result.invented, 1);
  assert.equal(result.inventedDishes[0].name, '€');
  assert.equal(result.accounting.actual.balanced, true);
});

test('price normalisation reads all undecomposed amounts', () => {
  assert.deepEqual(priceSetFromActual({ priceText: '9.50 / 18,00', priceStatus: 'multiple_undecomposed' }), ['9.50', '18.00']);
  assert.deepEqual(priceSetFromVariants({ priceVariants: [{ price: '6,50' }, { price: '25' }] }), ['6.50', '25.00']);
});

test('the aggregate never counts a blocked source as measured', () => {
  const captured = compareControlledReference(
    reference([{ name: 'Soep', price: '6.50', quote: 'Soep 6,50', locator: 'regel 1' }]),
    menus([{ name: 'Soep', price: '6.50' }]),
  );
  const totals = aggregateControlledReferences([
    { ...captured, captureStatus: 'captured' },
    { sourceId: 'blocked', label: 'Blocked', captureStatus: 'blocked', blockedReason: 'HTTP 503', referenceItems: 0, actualItems: 0, matched: 0, missing: 0, invented: 0, priceErrors: 0, categoryErrors: 0 },
  ]);
  assert.equal(totals.sources, 2);
  assert.equal(totals.capturedSources, 1);
  assert.equal(totals.blockedSources, 1);
  assert.equal(totals.referenceItems, 1);
  assert.equal(totals.blocked[0].reason, 'HTTP 503');
});
