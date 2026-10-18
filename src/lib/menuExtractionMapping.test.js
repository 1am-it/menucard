'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mapStructuredOutputToMenuContexts } = require('./menuExtractionMapping');

const sources = [{ id: 'source-1', url: 'https://fixture.example/menu.pdf' }];

function outputWith(menuOverrides = {}, categoryOverrides = {}, itemOverrides = {}) {
  return {
    menus: [
      {
        title: 'Lunch',
        sourceId: 'source-1',
        ...menuOverrides,
        categories: [
          {
            name: 'Voor',
            ...categoryOverrides,
            items: [
              {
                name: 'Fictieve soep',
                description: 'Warme soep',
                priceStatus: 'known',
                amountMinorUnits: 650,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'page:1', quote: 'Fictieve soep 6.50' },
                ...itemOverrides,
              },
            ],
          },
        ],
      },
    ],
  };
}

test('REGRESSION (review P2): menu variant and order survive the mapping instead of disappearing', () => {
  const [menu] = mapStructuredOutputToMenuContexts(outputWith({ variant: 'Lunchkaart', order: 2 }), sources);
  assert.equal(menu.variant, 'Lunchkaart');
  assert.equal(menu.order, 2);
  assert.equal(menu.title, 'Lunch');
});

test('REGRESSION (review P2): an uncertain section is mapped as an uncertain menu, never "normalized"', () => {
  const [uncertain] = mapStructuredOutputToMenuContexts(outputWith({}, { uncertain: true }), sources);
  assert.equal(uncertain.structure, 'uncertain');
  assert.equal(uncertain.categories[0].uncertain, true);

  const [normalized] = mapStructuredOutputToMenuContexts(outputWith(), sources);
  assert.equal(normalized.structure, 'normalized');
});

test('REGRESSION (review P2): source id and quote keep their provenance through the mapping', () => {
  const [menu] = mapStructuredOutputToMenuContexts(outputWith(), sources);
  const [item] = menu.categories[0].items;
  assert.equal(item.evidence.sourceId, 'source-1');
  assert.equal(item.evidence.quote, 'Fictieve soep 6.50');
  assert.equal(item.evidence.locator, 'page:1');
  assert.equal(item.evidence.sourceUrl, 'https://fixture.example/menu.pdf');
  assert.equal(item.price, '6.50');
});

test('a missing per-item source reference falls back to the menu source, never to nothing', () => {
  const [menu] = mapStructuredOutputToMenuContexts(outputWith({}, {}, { evidence: { locator: 'page:1', quote: 'Fictieve soep 6.50' } }), sources);
  assert.equal(menu.categories[0].items[0].evidence.sourceId, 'source-1');
});
