'use strict';

// #59 Lead review 6351417692 K1 — the generic text-PDF row shapes behind the
// Bardot card, on an invented source only: an amount printed in its own column
// belongs to the name on the SAME printed row (a small baseline tolerance), the
// text printed between them is the dish's description and not a dish, a printed
// section heading becomes a rubriek, and the cover's letter-spaced title can
// label the menu. No real source, host, dish or price appears here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { structurePdfLinesIntoMenu } = require('./pdfMenuStructuring');

function line(y, ...items) {
  return { y, items: items.map(([str, x, dy = 0]) => ({ str, x, y: y + dy, width: Math.max(6, str.length * 4.5) })) };
}

test('K1: an amount printed in its own column belongs to the name on the same printed row', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['FICTIEVE KAART', 20]),
      line(380, ['Fictief voorgerecht,', 20], ['fictieve room 12.50', 130]),
      line(360, ['Fictief gerecht,', 20], ['fictieve saus 18.50', 130]),
      line(340, ['Fictief dessert,', 20], ['fictieve room 8.50', 130]),
    ],
  };
  const { categories, layout } = structurePdfLinesToMenuForTest(page);
  assert.equal(layout.sameRowPricePairs, 3);
  const items = categories[0].items.map((item) => [item.name, item.desc, item.price]);
  assert.deepEqual(items, [
    ['Fictief voorgerecht', 'fictieve room', '12.50'],
    ['Fictief gerecht', 'fictieve saus', '18.50'],
    ['Fictief dessert', 'fictieve room', '8.50'],
  ]);
});

test('K1: a small baseline difference between the name and its own amount still pairs that row', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['// FICTIEF', 20]),
      { y: 380, items: [{ str: 'Fictief gerecht', x: 20, y: 380, width: 70 }] },
      { y: 382, items: [{ str: '17.50', x: 130, y: 382, width: 22 }] },
      { y: 360, items: [{ str: 'Fictief tweede gerecht', x: 20, y: 360, width: 90 }] },
      { y: 362, items: [{ str: '19.50', x: 130, y: 362, width: 22 }] },
      { y: 340, items: [{ str: 'Fictief derde gerecht', x: 20, y: 340, width: 90 }] },
      { y: 342, items: [{ str: '21.50', x: 130, y: 342, width: 22 }] },
    ],
  };
  const { categories } = structurePdfLinesToMenuForTest(page);
  assert.deepEqual(
    categories[0].items.map((item) => [item.name, item.price]),
    [
      ['Fictief gerecht', '17.50'],
      ['Fictief tweede gerecht', '19.50'],
      ['Fictief derde gerecht', '21.50'],
    ],
  );
});

test('K1: a printed heading row becomes a rubriek and never a dish', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['FICTIEVE BORRELHAPPEN', 20]),
      line(380, ['Fictief hapje', 20], ['4.50', 130]),
      line(360, ['Ex TRA BI j GERECHTEN :', 20]),
      line(340, ['Fictief bijgerecht', 20], ['5.50', 130]),
      line(320, ['Fictief tweede bijgerecht', 20], ['6.50', 130]),
      line(300, ['Fictieve drank', 20], ['3.50', 130]),
    ],
  };
  const { categories } = structurePdfLinesToMenuForTest(page);
  // The letter-spaced heading is kept exactly as printed and sits below the
  // section it belongs to; neither heading line ever becomes a dish.
  assert.deepEqual(categories.map((category) => category.path), [
    ['FICTIEVE BORRELHAPPEN'],
    ['FICTIEVE BORRELHAPPEN', 'Ex TRA BI j GERECHTEN :'],
  ]);
  assert.deepEqual(categories[0].items.map((item) => item.name), ['Fictief hapje']);
  assert.deepEqual(categories[1].items.map((item) => item.name), ['Fictief bijgerecht', 'Fictief tweede bijgerecht', 'Fictieve drank']);
  const names = categories.flatMap((category) => category.items.map((item) => item.name));
  assert.equal(names.some((name) => /BORRELHAPPEN|GERECHTEN/.test(name)), false);
});

function structurePdfLinesToMenuForTest(page) {
  return structurePdfLinesIntoMenu([page]);
}
