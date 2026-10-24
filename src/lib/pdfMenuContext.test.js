'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfContextToMenuContext, menusFromUnknownContexts } = require('./pdfMenuContext');

const context = (extra) => ({
  sourceUrl: 'https://smelt-fictief.example/menukaart.pdf',
  sourceId: 'source-2',
  extractionMethod: 'pdf_text',
  pageCount: 2,
  wordCount: 20,
  contentHash: 'pdfhash',
  usedFallback: false,
  recognizedSections: [
    { name: 'Fondue', items: [{ name: 'Fictieve kaasfondue', desc: 'Voor twee', price: '24.50', contentHash: 'itemhash' }] },
  ],
  ...extra,
});

test('named PDF sections become the same reviewable menu context as HTML, with source evidence', () => {
  const converted = pdfContextToMenuContext(context(), new Set());
  assert.ok(converted);
  assert.equal(converted.itemCount, 1);
  assert.equal(converted.menu.contextSlug, 'menukaart');
  assert.equal(converted.menu.extractionMethod, 'pdf_text');
  assert.equal(converted.menu.sourceUrl, 'https://smelt-fictief.example/menukaart.pdf');
  assert.equal(converted.menu.sourceId, 'source-2');
  assert.deepEqual(converted.menu.categories[0].path, ['Fondue']);
  assert.equal(converted.menu.categories[0].items[0].price, '24.50');
  assert.deepEqual(converted.menu.categories[0].items[0].evidence, {
    locator: 'pdf:1:item:1',
    contentHash: 'itemhash',
  });
});

test('a section without a heading is kept as a real, uncertain fallback section — never a guessed name', () => {
  const converted = pdfContextToMenuContext(
    context({ recognizedSections: [{ name: null, items: [{ name: 'Fictief gerecht', price: '9.00' }] }] }),
    new Set()
  );
  assert.ok(converted);
  assert.equal(converted.menu.categories[0].uncertain, true);
  assert.equal(converted.menu.structure, 'uncertain');
  assert.ok(converted.menu.categories[0].name);
});

test('a PDF with no reviewable item is not turned into an empty menu', () => {
  assert.equal(pdfContextToMenuContext(context({ recognizedSections: [] }), new Set()), null);
  assert.equal(
    pdfContextToMenuContext(context({ recognizedSections: [{ name: 'Leeg', items: [{ name: '   ', price: '4.00' }] }] }), new Set()),
    null
  );
});

test('several PDFs receive distinct context slugs and preserve their own source IDs', () => {
  const menus = menusFromUnknownContexts([context(), context({ sourceUrl: 'https://smelt-fictief.example/diner.pdf', sourceId: 'source-3' })]);
  assert.equal(menus.length, 2);
  assert.equal(new Set(menus.map((m) => m.contextSlug)).size, 2);
  assert.deepEqual(menus.map((m) => m.sourceId), ['source-2', 'source-3']);
});
