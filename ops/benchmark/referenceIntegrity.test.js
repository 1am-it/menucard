'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  htmlVisibleText,
  normalizeQuoteText,
  validateReferenceShape,
  verifyReferenceQuotes,
} = require('./referenceIntegrity');

test('HTML entities and numeric apostrophes are decoded before a quote is located', () => {
  const text = htmlVisibleText('<h1>Caf&eacute;</h1><p>Soep &euro;6,50 &amp; brood</p><p>Gamba&#8217;s</p>');
  assert.match(text, /Café/);
  assert.match(text, /Soep €6,50 & brood/);
  assert.match(text, /Gamba’s/);
  assert.equal(normalizeQuoteText('  Gamba’s  '), "gamba's");
});

test('a quote that is not in the pinned text blocks the reference', () => {
  const reference = {
    version: '1.0.0',
    sourceId: 'fixture',
    menus: [
      {
        title: 'Lunch',
        captureKey: 'fixture.html',
        categories: [
          {
            path: ['Lunch', 'Voor'],
            items: [{ name: 'Soep', price: '6.50', quote: 'Soep 6,50', locator: 'regel 1' }],
          },
        ],
      },
    ],
  };
  assert.equal(verifyReferenceQuotes(reference, { 'fixture.html': '<p>Soep 6,50</p>' }).ok, true);
  const missing = verifyReferenceQuotes(reference, { 'fixture.html': '<p>Iets anders</p>' });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /quote not found/);
});

test('a reference row without a locator or price is refused', () => {
  const reference = {
    version: '1.0.0',
    sourceId: 'fixture',
    menus: [
      {
        title: 'Lunch',
        captureKey: 'fixture.html',
        categories: [{ path: ['Lunch', 'Voor'], items: [{ name: 'Soep', quote: 'Soep' }] }],
      },
    ],
  };
  const result = verifyReferenceQuotes(reference, { 'fixture.html': 'Soep' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /locator is required/);
  assert.match(result.errors.join(' '), /price or priceVariants is required/);
});

test('the rubric path must start with its own menu title and may not pre-contain duplicates', () => {
  const badPath = {
    version: '1.0.0',
    sourceId: 'fixture',
    menus: [
      {
        title: 'Lunch',
        captureKey: 'fixture.html',
        categories: [{ path: ['Diner', 'Voor'], items: [{ name: 'Soep', price: '6.50', quote: 'Soep', locator: '1' }] }],
      },
    ],
  };
  assert.match(validateReferenceShape(badPath).errors.join(' '), /must start with the menu title/);

  const duplicate = JSON.parse(JSON.stringify(badPath));
  duplicate.menus[0].categories[0].path = ['Lunch', 'Voor'];
  duplicate.menus[0].categories[0].items.push({ name: 'Soep', price: '6.50', quote: 'Soep', locator: '2' });
  assert.match(validateReferenceShape(duplicate).errors.join(' '), /duplicate reference item/);
});
