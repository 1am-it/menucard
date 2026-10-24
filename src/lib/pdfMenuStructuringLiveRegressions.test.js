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

// ── Review 6250261342: section/name coverage on the same pinned layout ──────
// These fixtures reproduce the *shapes* that lost sections/names, not the
// restaurant: a right-hand column that continues the left heading, a brand
// marker below its parent section, wrapped names with explicit connectors,
// a portion label, a description directly below a priced item, and an amount
// printed a hair above its own name.

test('a column without its own heading continues the adjacent section, marked reviewable', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['// SHARED DINING 17:00 - 21:00', 120]),
      line(380, ['// STARTERS', 20]),
      line(360, ['Brood met smeersels', 20], ['8.5', 180], ['Crispy Coconut Gyoza', 220], ['12.5', 360]),
      line(340, ['Fromage Festif', 20], ['12.5', 180], ['Pepper Beef Tataki', 220], ['16.5', 360]),
      line(320, ['Il Magnifico', 20], ['14.0', 180], ['Tuna al Mare', 220], ['14.5', 360]),
    ],
  };
  const { categories, layout } = structurePdfLinesIntoMenu([page]);
  // The centered menu title is not a column heading, so it is never a parent.
  assert.deepEqual(categories.map((category) => category.path), [['STARTERS']]);
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [
    // Items are grouped per column: the left column's own items first, then the
    // right column whose section was inherited.
    ['Brood met smeersels', '8.5'],
    ['Fromage Festif', '12.5'],
    ['Il Magnifico', '14.0'],
    ['Crispy Coconut Gyoza', '12.5'],
    ['Pepper Beef Tataki', '16.5'],
    ['Tuna al Mare', '14.5'],
  ]);
  assert.equal(categories[0].uncertain, true);
  assert.equal(layout.inheritedSectionColumns, 1);
});

test('a brand marker directly below its parent section is nested, not a second top-level section', () => {
  const page = {
    pageNumber: 3,
    lines: [
      line(546, ['// PREMIUM FRISDRANKEN', 36]),
      line(526, ['Cultcha Kombucha', 42], ['5.5', 184], ['// Double Dutch', 227]),
      line(514, ['Passionfruit & Lime', 42], ['Ginger Beer', 227], ['4.6', 369]),
      line(504, ['Cultcha Kombucha', 42], ['5.5', 184], ['Pink Grapefruit Soda', 227], ['4.6', 369]),
    ],
  };
  const { categories, layout } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories.map((category) => category.path), [
    ['PREMIUM FRISDRANKEN'],
    ['PREMIUM FRISDRANKEN', 'Double Dutch'],
  ]);
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [
    ['Cultcha Kombucha Passionfruit & Lime', '5.5'],
    ['Cultcha Kombucha', '5.5'],
  ]);
  assert.deepEqual(categories[1].items.map((item) => [item.name, item.price]), [
    ['Ginger Beer', '4.6'],
    ['Pink Grapefruit Soda', '4.6'],
  ]);
  assert.equal(layout.inheritedSubheadingColumns, 1);
});

test('wrapped names join on explicit connectors and portions, while portions stay out of the name', () => {
  const page = {
    pageNumber: 2,
    lines: [
      line(400, ['// DRANKEN', 20]),
      line(380, ['Lipton Ice Tea Sparkling /', 20], ['3.8', 180]),
      line(360, ['Ice Tea Green / Ice Tea Peach /', 20]),
      line(340, ['Ice Tea Green Zero', 20]),
      line(320, ['Royal Club Tonic / Bitter Lemon', 20], ['3.8', 180]),
      line(300, ['/ Ginger Ale', 20]),
      line(280, ['Holtkamp ambachtelijke', 20], ['9.5', 180]),
      line(260, ['draadjesvlees bitterbal', 20], ['8st.', 140]),
      line(240, ['Vegan draadjesvlees bitterbal', 20], ['9.5', 180]),
      line(220, ['8st.', 20]),
    ],
  };
  const { categories, layout } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [
    ['Lipton Ice Tea Sparkling / Ice Tea Green / Ice Tea Peach / Ice Tea Green Zero', '3.8'],
    ['Royal Club Tonic / Bitter Lemon / Ginger Ale', '3.8'],
    ['Holtkamp ambachtelijke draadjesvlees bitterbal', '9.5'],
    ['Vegan draadjesvlees bitterbal', '9.5'],
  ]);
  assert.equal(layout.nameContinuationLines, 4);
  assert.equal(layout.portionLines, 2);
  assert.equal(categories.some((category) => category.items.some((item) => /\b8st\.?$/.test(item.name))), false);
});

test('a description below a priced item stays a description: it is neither a name continuation nor a heading', () => {
  const page = {
    pageNumber: 1,
    lines: [
      line(400, ['// BROUWERIJ', 20]),
      line(380, ['Juice Punch New', 20], ['6.5', 180]),
      line(360, ['England IPA', 20]),
      line(340, ['Head First Tropical IPA', 20], ['6.0', 180]),
      line(320, ['Oester naturel', 20], ['4.0', 180]),
      line(300, ['met klassieke mignonette-azijn en citroen', 20]),
      line(280, ['Oester oosters', 20], ['4.5', 180]),
      line(260, ['Krokante sprinkhaan', 20]),
      line(240, ['met Kewpie-mayo', 20]),
    ],
  };
  const { categories } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories.map((category) => category.path), [['BROUWERIJ']]);
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.desc]), [
    ['Juice Punch New', 'England IPA'],
    ['Head First Tropical IPA', null],
    ['Oester naturel', 'met klassieke mignonette-azijn en citroen'],
    ['Oester oosters', 'Krokante sprinkhaan met Kewpie-mayo'],
  ]);
});

test('a three-word item above a local price-only baseline is paired, never lost', () => {
  const page = {
    pageNumber: 1,
    lines: [line(400, ['// MEDITERRAANS', 20]), line(380, ['Blue Velvet Gnocchi', 20]), line(378, ['13.5', 160])],
  };
  const { categories } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [['Blue Velvet Gnocchi', '13.5']]);
});

test('an ABV micro-baseline above its own amount is not glued to the name', () => {
  const page = {
    pageNumber: 4,
    lines: [
      line(400, ['// BIEREN', 20]),
      line(380, ['Sol', 20], ['5.7', 180]),
      line(365, ['4.0%', 160], ['5.2', 180]),
      line(363, ['Mort Subite Kriek', 20]),
    ],
  };
  const { categories, layout } = structurePdfLinesIntoMenu([page]);
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [
    ['Sol', '5.7'],
    ['Mort Subite Kriek', '5.2'],
  ]);
  assert.equal(categories[0].items.some((item) => item.name.includes('%')), false);
  assert.equal(layout.unlinkedPriceLines, 0);
});
