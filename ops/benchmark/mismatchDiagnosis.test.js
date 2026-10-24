'use strict';

// S4 regressions for the per-source mismatch diagnosis (#59 / BE-21, review
// 6376108648). Pure and offline: the input is the unchanged comparison result,
// never a model, a network call or a written report.

const test = require('node:test');
const assert = require('node:assert/strict');

const { compareControlledReference } = require('./referenceComparison');
const {
  CLASSIFICATIONS,
  DIAGNOSIS_SCHEMA_VERSION,
  diagnoseMismatches,
  mismatchSummary,
  pairNameVariants,
  pathReason,
} = require('./mismatchDiagnosis');

function categoryError(name, expectedPath, actualPath) {
  return { name, expectedPath, actualPath, price: ['21.50'], quote: `${name} 21,50`, locator: 'regel 3', actualLocator: 'regel 3' };
}

function comparisonWith(overrides = {}) {
  return {
    referenceItems: 1,
    actualItems: 1,
    matched: 0,
    missing: 0,
    invented: 0,
    priceErrors: 0,
    categoryErrors: 0,
    missingDishes: [],
    inventedDishes: [],
    priceErrorRows: [],
    categoryErrorRows: [],
    ...overrides,
  };
}

test('S4: a category error names the menu title when only the leading path segment differs', () => {
  // The live Chocolat shape: the reference keeps "LUNCHKAART CHOCOLAT" and the
  // model answered "Lunchkaart".
  const diagnosis = diagnoseMismatches(
    comparisonWith({ categoryErrorRows: [categoryError('Catch of the day', ['LUNCHKAART CHOCOLAT', 'LUNCHGERECHTEN'], ['Lunchkaart', 'Lunchgerechten'])] }),
  );
  assert.equal(diagnosis.schemaVersion, DIAGNOSIS_SCHEMA_VERSION);
  assert.equal(diagnosis.classes.category_path, 1);
  assert.equal(diagnosis.pathReasons.menu_title, 1);
  assert.equal(diagnosis.rows[0].pathReason, 'menu_title');
  assert.equal(diagnosis.rows[0].pathReasonLabel, 'menutitel verschilt');
  assert.deepEqual(diagnosis.rows[0].expectedPath, ['LUNCHKAART CHOCOLAT', 'LUNCHGERECHTEN']);
  assert.deepEqual(diagnosis.rows[0].actualPath, ['Lunchkaart', 'Lunchgerechten']);
  // Diagnosis only: no other class is touched.
  assert.equal(diagnosis.classes.price, 0);
});

test('S4: an extra rubric level and an unrelated path are told apart', () => {
  assert.equal(pathReason(['Diner'], ['Diner', 'À la carte']), 'extra_level');
  assert.equal(pathReason(['Diner', 'À la carte', 'Voor'], ['Diner', 'Voor']), 'extra_level');
  assert.equal(pathReason(['Lunch', 'Voor'], ['Diner', 'Hoofd']), 'other');
  const diagnosis = diagnoseMismatches(
    comparisonWith({
      categoryErrorRows: [
        categoryError('Soep', ['Diner'], ['Diner', 'À la carte']),
        categoryError('Biefstuk', ['Lunch', 'Voor'], ['Diner', 'Hoofd']),
      ],
    }),
  );
  assert.equal(diagnosis.classes.category_path, 2);
  assert.equal(diagnosis.pathReasons.extra_level, 1);
  assert.equal(diagnosis.pathReasons.other, 1);
});

test('S4: a price difference, a name variant and a real surplus are three different reasons', () => {
  const diagnosis = diagnoseMismatches(
    comparisonWith({
      priceErrors: 1,
      priceErrorRows: [
        { name: 'Soep', path: ['Lunch'], expectedPrices: ['6.50'], actualPrices: ['5.50'], actualPriceText: '5,50', quote: 'Soep 6,50', locator: 'regel 2' },
      ],
      missingDishes: [{ name: 'Côte de boeuf', prices: ['62.00'], path: ['Diner'], quote: 'Côte de boeuf 62,00', locator: 'regel 9' }],
      inventedDishes: [{ name: 'Cote de boeuf', prices: ['62.00'], path: ['Diner'], quote: 'Cote de boeuf 62,00', locator: 'regel 9' }],
    }),
  );
  assert.equal(diagnosis.classes.price, 1);
  assert.equal(diagnosis.classes.name_variant, 1);
  assert.equal(diagnosis.classes.not_extracted, 0);
  assert.equal(diagnosis.classes.not_in_reference, 0);
  const pair = diagnosis.rows.find((row) => row.classification === 'name_variant');
  assert.equal(pair.expectedName, 'Côte de boeuf');
  assert.equal(pair.actualName, 'Cote de boeuf');
  assert.ok(pair.similarity >= 0.75);
});

test('S4: a surplus without a comparable name stays "not in the reference", a miss without one stays "not extracted"', () => {
  const diagnosis = diagnoseMismatches(
    comparisonWith({
      missing: 1,
      invented: 1,
      missingDishes: [{ name: 'Oesters', prices: ['12.00'], path: ['Voor'], quote: 'Oesters 12,00', locator: 'regel 1' }],
      inventedDishes: [{ name: 'Wagyu A5', prices: ['48.00'], path: ['Hoofd'], quote: 'Wagyu A5 48,00', locator: 'regel 7' }],
    }),
  );
  assert.equal(diagnosis.classes.not_in_reference, 1);
  assert.equal(diagnosis.classes.not_extracted, 1);
  assert.equal(diagnosis.classes.name_variant, 0);
  assert.deepEqual(diagnosis.rows.map((row) => row.classification).sort(), ['not_extracted', 'not_in_reference']);
});

test('S4: pairing never reuses a row and reports every class count', () => {
  const missing = [{ name: 'Côte de boeuf' }, { name: 'Soep van de dag' }];
  const invented = [{ name: 'Cote de boeuf' }];
  const { pairs, usedMissing, usedSurplus } = pairNameVariants(missing, invented);
  assert.equal(pairs.length, 1);
  assert.equal(usedMissing.size, 1);
  assert.equal(usedSurplus.size, 1);
  const diagnosis = diagnoseMismatches(comparisonWith({ missing: 2, invented: 1, missingDishes: missing, inventedDishes: invented }));
  const total = CLASSIFICATIONS.reduce((sum, code) => sum + diagnosis.classes[code], 0);
  // Two missed reference rows and one surplus row, one pair: every accounted
  // row is classified exactly once, and the pair is not counted twice.
  assert.equal(total, missing.length + invented.length - pairs.length);
  assert.equal(diagnosis.classes.name_variant, 1);
  assert.equal(diagnosis.classes.not_extracted, 1);
  assert.equal(diagnosis.rowsNotReported, 0);
  assert.equal(mismatchSummary(diagnosis).classes.name_variant, 1);
});

test('S4: an empty comparison yields zero classes and an explicit "no difference"', () => {
  const diagnosis = diagnoseMismatches(comparisonWith());
  assert.deepEqual(diagnosis.classes, Object.fromEntries(CLASSIFICATIONS.map((code) => [code, 0])));
  assert.deepEqual(diagnosis.rows, []);
  assert.equal(mismatchSummary(diagnosis).text, 'geen verschil');
  assert.equal(mismatchSummary(null), null);
});


test('S4: the diagnosis works on the unchanged comparison of a Chocolat-shaped source', () => {
  const reference = {
    menus: [
      {
        title: 'LUNCHKAART CHOCOLAT',
        categories: [{ path: ['LUNCHKAART CHOCOLAT', 'LUNCHGERECHTEN'], items: [{ name: 'Catch of the day', price: '21.50' }] }],
      },
    ],
  };
  const menus = [
    {
      title: 'Lunchkaart',
      sourceId: 'chocolat-03',
      categories: [
        {
          name: 'Lunchgerechten',
          items: [
            {
              name: 'Catch of the day',
              priceStatus: 'known',
              amountMinorUnits: 2150,
              currency: 'EUR',
              evidence: { sourceId: 'chocolat-03', locator: 'Lunchgerechten', quote: 'Catch of the day' },
            },
          ],
        },
      ],
    },
  ];
  const comparison = compareControlledReference(reference, menus);
  // The unchanged counting rule: same dish, other rubric path.
  assert.equal(comparison.matched, 0);
  assert.equal(comparison.categoryErrors, 1);
  const diagnosis = diagnoseMismatches(comparison);
  assert.equal(diagnosis.classes.category_path, 1);
  assert.equal(diagnosis.pathReasons.menu_title, 1);
});
