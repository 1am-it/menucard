'use strict';

// Regressions from the real De Botanist Breda PDF (2026-10-18). The source is
// a two-column magazine layout whose text layer:
// - repeats the same price for many items ("0.6" syrups, "4.2" drinks),
// - emits a name and its own price on slightly different baselines,
// - puts two section markers on one visual row,
// - includes ABV percentages next to a price,
// - uses a single flavour word as a continuation of the previous item.
// These fixtures are synthetic pages with the same shape; no real PDF bytes
// or restaurant content are embedded.

const test = require('node:test');
const assert = require('node:assert/strict');
const { structurePdfLinesIntoMenu, duplicateLayoutLayer } = require('./pdfMenuStructuring');

function line(y, ...items) {
  return { y, items: items.map(([str, x, extra = {}]) => ({ str, x, y: extra.y === undefined ? y : extra.y, ...(extra.seq === undefined ? {} : { seq: extra.seq }) })) };
}

test('a repeated price is not mistaken for a duplicate text layer', () => {
  const lines = [line(400, ['// WARME DRANKEN', 20])];
  for (let i = 0; i < 20; i += 1) {
    const y = 380 - i * 10;
    lines.push(line(y, [`Gerecht ${String.fromCharCode(65 + i)}`, 20, { seq: 1 + i * 2 }], [i % 4 === 0 ? '4.2' : String(10 + i), 100, { seq: 2 + i * 2 }]));
  }
  const page = { pageNumber: 1, lines };
  assert.equal(duplicateLayoutLayer(page).count, 0);
  const { categories, layout } = structurePdfLinesIntoMenu([page]);
  assert.equal(layout.duplicateLayerItems, 0);
  assert.equal(categories[0].items.length, 20);
  assert.equal(categories[0].items.filter((item) => item.price === '4.2').length, 5);
});

test('a name and its own price on two near baselines form one item', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['// WARME DRANKEN', 20]),
      line(380, ['Koffie', 20], ['3.5', 100, { y: 380.7 }]),
      line(360, ['Cappuccino', 20], ['3.8', 100, { y: 360.7 }]),
      line(340, ['Latte Macchiato', 20], ['4.2', 100, { y: 340.7 }]),
    ],
  };
  const { categories } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [
    ['Koffie', '3.5'],
    ['Cappuccino', '3.8'],
    ['Latte Macchiato', '4.2'],
  ]);
});

test('two section markers on one row define two columns, not one mixed section', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['// WARME DRANKEN', 20], ['// FRISDRANK', 220]),
      line(380, ['Koffie', 20], ['3.5', 100], ['Red Bull', 220], ['4.5', 300]),
      line(360, ['Espresso', 20], ['3.4', 100], ['Pepsi', 220], ['3.6', 300]),
      line(340, ['Cappuccino', 20], ['3.8', 100], ['Fristi', 220], ['3.6', 300]),
    ],
  };
  const { categories } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories.map((category) => category.path), [['WARME DRANKEN'], ['FRISDRANK']]);
  assert.deepEqual(categories[0].items.map((item) => item.name), ['Koffie', 'Espresso', 'Cappuccino']);
  assert.deepEqual(categories[1].items.map((item) => item.name), ['Red Bull', 'Pepsi', 'Fristi']);
});

test('an ABV percentage is never part of the name or a separate item', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['// BIER', 20]),
      line(380, ['Texels Skiller Wit', 20], ['5.0%', 100], ['5.5', 120]),
      line(360, ['Oedipus Saison', 20], ['6.0%', 100], ['5.8', 120]),
      line(340, ['Bier van het moment', 20], ['5.5', 120]),
    ],
  };
  const { categories } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [
    ['Texels Skiller Wit', '5.5'],
    ['Oedipus Saison', '5.8'],
    ['Bier van het moment', '5.5'],
  ]);
});

test('a single flavour word below an item stays a description, not a section', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['// FRISDRANK', 20]),
      line(380, ['Red Bull Red Edition', 20], ['4.5', 100]),
      line(360, ['Watermelon', 20]),
      line(340, ['Pepsi Cola', 20], ['3.6', 100]),
    ],
  };
  const { categories } = structurePdfLinesIntoMenu([page]);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].path[0], 'FRISDRANK');
  assert.equal(categories[0].items[0].desc, 'Watermelon');
  assert.equal(categories[0].items.some((item) => item.name === 'Watermelon'), false);
});

test('a prose fragment ending in punctuation is not promoted to a section', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['// FRISDRANK', 20]),
      line(380, ['Fritz limo', 20], ['4.6', 100]),
      line(360, ['Hun missie?', 20]),
      line(340, ['Blueberry Lemonade', 20], ['4.8', 100]),
    ],
  };
  const { categories } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories.map((category) => category.path), [['FRISDRANK']]);
  assert.equal(categories[0].items.some((item) => item.name === 'Hun missie?'), false);
});
