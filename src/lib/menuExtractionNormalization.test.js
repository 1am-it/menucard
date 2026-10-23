'use strict';

// R1/R2 of the Delivery Lead order for #59 / BE-21 (review 6375740447):
// regressions for the adapter-side bookkeeping normalizations. Everything here
// is offline and pure; no key, no network, no paid call.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NORMALIZATION_RULES,
  NORMALIZATION_SCHEMA_VERSION,
  applyDerivableNormalizations,
  countExtractedItems,
} = require('./menuExtractionNormalization');
const { validateStructuredOutput } = require('./menuExtractionSchema');

const sources = [{ id: 'source-1', url: 'https://fictief.example/menu', kind: 'html', status: 'read', text: 'Fictieve soep 6.50 Fictieve kroket 4.00 Fictieve taart 5.00' }];

function itemOf(name, quote) {
  return { name, priceStatus: 'known', amountMinorUnits: 650, currency: 'EUR', evidence: { sourceId: 'source-1', locator: 'regel 1', quote } };
}

function answerOf({ itemsExtracted, status = 'complete', limitations = [] } = {}) {
  return {
    menus: [
      {
        title: 'Lunch',
        sourceId: 'source-1',
        categories: [
          { name: 'Voor', items: [itemOf('Fictieve soep', 'Fictieve soep 6.50'), itemOf('Fictieve kroket', 'Fictieve kroket 4.00')] },
          { name: 'Na', items: [itemOf('Fictieve taart', 'Fictieve taart 5.00')] },
        ],
      },
    ],
    rejected: [],
    coverage: { status, sourcesRead: 1, pagesRead: 1, itemsExtracted, unreadSources: [], limitations },
  };
}

test('R1: a wrong itemsExtracted is replaced by the number of items actually present, and recorded', () => {
  const answer = answerOf({ itemsExtracted: 99 });
  const { output, normalizations } = applyDerivableNormalizations(answer);

  assert.equal(output.coverage.itemsExtracted, 3);
  assert.equal(countExtractedItems(answer), 3);
  assert.deepEqual(normalizations, [
    {
      rule: NORMALIZATION_RULES.derivedItemCount,
      field: 'coverage.itemsExtracted',
      from: 99,
      to: 3,
      reason: 'the adapter counts the extracted items; the model does not supply this number',
    },
  ]);
  // The corrected output is valid for the unchanged validator.
  assert.deepEqual(validateStructuredOutput(output, sources), []);
  // Not normalized by hand: the input object is untouched.
  assert.equal(answer.coverage.itemsExtracted, 99);
});

test('R1: a missing itemsExtracted is derived too — the provider schema no longer asks for it', () => {
  const answer = answerOf({});
  delete answer.coverage.itemsExtracted;
  const { output, normalizations } = applyDerivableNormalizations(answer);

  assert.equal(output.coverage.itemsExtracted, 3);
  assert.equal(normalizations.length, 1);
  assert.equal(normalizations[0].from, null);
  assert.equal(normalizations[0].to, 3);
  assert.deepEqual(validateStructuredOutput(output, sources), []);
});

test('R2: a claimed complete status with limitations is downgraded to partial and recorded', () => {
  const answer = answerOf({ itemsExtracted: 99, status: 'complete', limitations: ['onderaan afgesneden'] });
  const { output, normalizations } = applyDerivableNormalizations(answer);

  assert.equal(output.coverage.status, 'partial');
  assert.equal(output.coverage.itemsExtracted, 3);
  const status = normalizations.find((entry) => entry.field === 'coverage.status');
  assert.deepEqual(status, {
    rule: NORMALIZATION_RULES.completeWithLimitations,
    field: 'coverage.status',
    from: 'complete',
    to: 'partial',
    reason: 'complete coverage cannot contain limitations; downgraded, never upgraded',
  });
  // Without this correction the unchanged validator would have rejected the
  // answer with "complete coverage cannot contain limitations".
  assert.deepEqual(validateStructuredOutput(output, sources), []);
  assert.ok(validateStructuredOutput(answer, sources).includes('complete coverage cannot contain limitations'));
});

test('R2: complete with limitations and zero items becomes no_items, still never upgraded', () => {
  const answer = {
    menus: [{ title: 'Lunch', sourceId: 'source-1', categories: [{ name: 'Voor', items: [] }] }],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 0, unreadSources: [], limitations: ['alleen afbeeldingen'] },
  };
  const { output, normalizations } = applyDerivableNormalizations(answer);

  assert.equal(output.coverage.status, 'no_items');
  assert.equal(normalizations.find((entry) => entry.field === 'coverage.status').to, 'no_items');
  assert.deepEqual(validateStructuredOutput(output, sources), []);
});

test('R2: a partial or no_items claim is never rewritten, and a clean complete answer stays complete', () => {
  const partial = answerOf({ itemsExtracted: 3, status: 'partial', limitations: ['één regel onleesbaar'] });
  const partialResult = applyDerivableNormalizations(partial);
  assert.equal(partialResult.output.coverage.status, 'partial');
  assert.deepEqual(partialResult.normalizations, [], 'a correct answer is not touched');

  const complete = answerOf({ itemsExtracted: 3, status: 'complete' });
  const completeResult = applyDerivableNormalizations(complete);
  assert.equal(completeResult.output.coverage.status, 'complete');
  assert.deepEqual(completeResult.normalizations, []);

  const noItems = {
    menus: [],
    rejected: [],
    coverage: { status: 'no_items', sourcesRead: 1, pagesRead: 1, itemsExtracted: 0, unreadSources: [], limitations: ['geen gerechten'] },
  };
  assert.equal(applyDerivableNormalizations(noItems).output.coverage.status, 'no_items');
});

test('R1: a malformed answer is left to the validator, never counted as a valid extraction', () => {
  for (const malformed of [null, 'tekst', [], { menus: 'geen array', coverage: { status: 'complete' } }, { menus: [], coverage: null }, { coverage: { status: 'complete' } }]) {
    const result = applyDerivableNormalizations(malformed);
    assert.deepEqual(result.normalizations, []);
    assert.equal(result.output, malformed, 'nothing is invented for a shape that cannot be counted');
  }
  assert.equal(countExtractedItems({ menus: 'geen array' }), null);
  // The validator still refuses a payload without a coverage object.
  assert.ok(validateStructuredOutput({ menus: [] }, sources).length > 0);
});

test('R4: the manual import keeps the unchanged validator — no adapter normalization applies there', () => {
  // The same wrong answers the adapter repairs are still refused on the direct
  // validation path used by the manual import (src/lib/manualMenuImportImport.js).
  const wrongCount = answerOf({ itemsExtracted: 99 });
  assert.ok(validateStructuredOutput(wrongCount, sources).includes('coverage.itemsExtracted must equal the number of extracted items'));

  const completeWithLimitations = answerOf({ itemsExtracted: 3, status: 'complete', limitations: ['onvolledig'] });
  assert.ok(validateStructuredOutput(completeWithLimitations, sources).includes('complete coverage cannot contain limitations'));

  // Applying the adapter normalization is the only place the correction exists.
  assert.equal(NORMALIZATION_SCHEMA_VERSION, 'menu-extraction-normalization/v1');
});
