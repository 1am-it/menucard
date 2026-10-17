'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExtractionResult, validateExtractionResult, attentionGroupsForMenus } = require('./menuExtractionResult');

const menus = [
  {
    contextSlug: 'menukaart',
    sourceId: 'source-2',
    sourceUrl: 'https://smelt-fictief.example/menukaart.pdf',
    categories: [
      { name: 'Fondue', path: ['Fondue'], items: [{ name: 'Fictieve fondue', price: '24.50' }] },
      { name: 'Dessert', path: ['Dessert'], uncertain: true, items: [{ name: 'Fictief dessert', price: '7.50' }] },
    ],
  },
];

test('items extracted: sources, coverage and shared uncertainty are explicit, never "complete"', () => {
  const result = buildExtractionResult({
    sourceInventory: [
      { id: 'source-1', url: 'https://smelt-fictief.example/', kind: 'html', status: 'read', contentHash: 'abc' },
      { id: 'source-2', url: 'https://smelt-fictief.example/menukaart.pdf', kind: 'pdf', status: 'read', contentHash: 'def', pageCount: 2, wordCount: 20, itemCount: 2 },
      { id: 'source-3', url: 'https://smelt-fictief.example/geheim.pdf', kind: 'pdf', status: 'blocked', limitation: 'robots.txt' },
    ],
    menus,
    limitations: ['Alleen digitale tekst; geen OCR.'],
    notes: ['Controleer de pagina’s.'],
  });
  assert.equal(result.status, 'items_extracted');
  assert.equal(result.coverage.itemCount, 2);
  assert.equal(result.coverage.readCount, 2);
  assert.equal(result.coverage.blockedCount, 1);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.reviewRequired, true);
  assert.equal(result.attentionGroups.length, 1);
  assert.equal(result.attentionGroups[0].label, 'Dessert');
  assert.equal(result.attentionGroups[0].itemCount, 1);
  assert.deepEqual(result.limitations, ['robots.txt', 'Alleen digitale tekst; geen OCR.']);
  assert.deepEqual(validateExtractionResult(result), []);
});

test('a candidate without items is not "items extracted" and never complete', () => {
  const result = buildExtractionResult({
    sourceInventory: [{ id: 'source-1', url: 'https://x.example/', kind: 'html', status: 'read' }],
    menus: [],
    unknownMenuContexts: [{ sourceUrl: 'https://x.example/menu.pdf', recognizedSections: [] }],
  });
  assert.equal(result.status, 'candidate_without_items');
  assert.equal(result.coverage.itemCount, 0);
  assert.equal(result.coverage.candidateCount, 1);
  assert.deepEqual(validateExtractionResult(result), []);
});

test('the envelope rejects a result that claims completeness or an unknown schema', () => {
  const result = buildExtractionResult({ menus });
  assert.deepEqual(validateExtractionResult({ ...result, schemaVersion: 999 }), ['schemaVersion is not supported']);
  assert.ok(validateExtractionResult({ ...result, coverage: { ...result.coverage, complete: true } }).includes('coverage.complete must be false'));
});

test('attention groups are per variant + section, never one flattened global list', () => {
  const groups = attentionGroupsForMenus([
    ...menus,
    { contextSlug: 'diner', sourceId: 'source-4', categories: [{ name: 'Dessert', path: ['Diner', 'Dessert'], uncertain: true, items: [{ name: 'X' }] }] },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.label), ['Dessert', 'Diner › Dessert']);
});
