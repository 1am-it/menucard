'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  flattenMenuSections,
  extractMenuItem,
  extractPrice,
  deriveUniqueMenuContextSlug,
  extractMenusFromHtml,
} = require('./menuJsonLdExtraction');

function ldJsonScript(node) {
  return `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
}

const SAMPLE_MENU_SECTION = {
  name: 'Voorgerechten',
  hasMenuItem: [
    { '@type': 'MenuItem', name: 'Tomatensoep', description: 'Met basilicum', offers: { price: '8,50' } },
    { '@type': 'MenuItem', name: 'Carpaccio', offers: [{ priceSpecification: { price: 12 } }] },
  ],
};

test('extractMenusFromHtml: reads a top-level Menu node with hasMenuSection/hasMenuItem', () => {
  const html = ldJsonScript({
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: 'Dinerkaart',
    hasMenuSection: [SAMPLE_MENU_SECTION],
  });
  const menus = extractMenusFromHtml(html);
  assert.equal(menus.length, 1);
  assert.equal(menus[0].name, 'Dinerkaart');
  assert.equal(menus[0].categories.length, 1);
  assert.equal(menus[0].categories[0].name, 'Voorgerechten');
  assert.equal(menus[0].categories[0].items.length, 2);
  assert.equal(menus[0].categories[0].items[0].price, '8,50');
  assert.equal(menus[0].categories[0].items[1].price, '12');
});

test('extractMenusFromHtml: reads an embedded menu on a Restaurant node via hasMenu', () => {
  const html = ldJsonScript({
    '@type': 'Restaurant',
    name: 'Test Bistro',
    hasMenu: { '@type': 'Menu', name: 'Lunchkaart', hasMenuSection: [SAMPLE_MENU_SECTION] },
  });
  const menus = extractMenusFromHtml(html);
  assert.equal(menus.length, 1);
  assert.equal(menus[0].name, 'Lunchkaart');
});

test('extractMenusFromHtml: an array under hasMenu produces separate, independent menus', () => {
  const html = ldJsonScript({
    '@type': 'FoodEstablishment',
    name: 'Test Bistro',
    hasMenu: [
      { '@type': 'Menu', name: 'Lunch Menu', hasMenuSection: [SAMPLE_MENU_SECTION] },
      { '@type': 'Menu', name: 'Dinner Menu', hasMenuSection: [SAMPLE_MENU_SECTION] },
    ],
  });
  const menus = extractMenusFromHtml(html);
  assert.equal(menus.length, 2);
  assert.equal(menus[0].contextSlug, 'lunch');
  assert.equal(menus[1].contextSlug, 'diner');
  assert.notEqual(menus[0].contextSlug, menus[1].contextSlug);
});

test('extractMenusFromHtml: a menu property that is only a URL string is never followed', () => {
  const html = ldJsonScript({
    '@type': 'Restaurant',
    name: 'Test Bistro',
    menu: 'https://example.com/menu.pdf',
  });
  assert.deepEqual(extractMenusFromHtml(html), []);
});

test('extractMenusFromHtml: nested hasMenuSection is flattened with combined names', () => {
  const html = ldJsonScript({
    '@type': 'Menu',
    name: 'Kaart',
    hasMenuSection: [
      {
        name: 'Hoofdgerechten',
        hasMenuSection: [
          { name: 'Vlees', hasMenuItem: [{ name: 'Steak' }] },
          { name: 'Vis', hasMenuItem: [{ name: 'Zalm' }] },
        ],
      },
    ],
  });
  const menus = extractMenusFromHtml(html);
  assert.equal(menus.length, 1);
  assert.deepEqual(
    menus[0].categories.map((c) => c.name),
    ['Hoofdgerechten — Vlees', 'Hoofdgerechten — Vis']
  );
});

test('extractMenusFromHtml: a Menu node with no usable sections/items is dropped entirely, never a guessed empty proposal', () => {
  const html = ldJsonScript({ '@type': 'Menu', name: 'Kaart', hasMenuSection: [{ name: 'Leeg' }] });
  assert.deepEqual(extractMenusFromHtml(html), []);
});

test('extractMenusFromHtml: no JSON-LD at all returns an empty array, never throws', () => {
  assert.deepEqual(extractMenusFromHtml('<html><body>Geen structuur hier</body></html>'), []);
});

test('extractMenusFromHtml: malformed JSON-LD is skipped, never crashes the whole parse', () => {
  const html = `<script type="application/ld+json">{not valid json</script>${ldJsonScript({
    '@type': 'Menu',
    name: 'Kaart',
    hasMenuSection: [SAMPLE_MENU_SECTION],
  })}`;
  const menus = extractMenusFromHtml(html);
  assert.equal(menus.length, 1);
});

test('extractMenusFromHtml: an irrelevant schema type (e.g. BlogPosting) contributes no menu', () => {
  const html = ldJsonScript({ '@type': 'BlogPosting', name: 'Een blogpost', menu: { hasMenuSection: [SAMPLE_MENU_SECTION] } });
  assert.deepEqual(extractMenusFromHtml(html), []);
});

test('extractMenuItem: requires a name, returns null otherwise', () => {
  assert.equal(extractMenuItem({ description: 'zonder naam' }), null);
  assert.equal(extractMenuItem(null), null);
  assert.deepEqual(extractMenuItem({ name: 'Tosti' }), { name: 'Tosti', desc: null, price: null });
});

test('extractPrice: reads offers.price, an array of offers, and priceSpecification.price, in that tolerance', () => {
  assert.equal(extractPrice({ offers: { price: '5' } }), '5');
  assert.equal(extractPrice({ offers: [{ priceSpecification: { price: 6 } }] }), '6');
  assert.equal(extractPrice({ offers: null }), null);
});

test('flattenMenuSections: a section with items and no name still gets a fallback category name', () => {
  const categories = flattenMenuSections([{ hasMenuItem: [{ name: 'X' }] }], null);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, 'Categorie');
});

test('deriveUniqueMenuContextSlug: recognizes known Dutch/English daypart keywords', () => {
  const used = new Set();
  assert.equal(deriveUniqueMenuContextSlug('Lunchkaart', 0, used), 'lunch');
  assert.equal(deriveUniqueMenuContextSlug('Dinner Menu', 1, used), 'diner');
  assert.equal(deriveUniqueMenuContextSlug('Borrelplank', 2, used), 'borrel');
});

test('deriveUniqueMenuContextSlug: sanitizes an unrecognized name to lowercase letters only', () => {
  const used = new Set();
  const slug = deriveUniqueMenuContextSlug('Kaart 2025!', 0, used);
  assert.match(slug, /^[a-z]+$/);
});

test('deriveUniqueMenuContextSlug: falls back to a positional slug when the name sanitizes to nothing', () => {
  const used = new Set();
  const slug = deriveUniqueMenuContextSlug('2025', 0, used);
  assert.match(slug, /^[a-z]+$/);
});

test('deriveUniqueMenuContextSlug: never returns a duplicate slug within the same batch', () => {
  const used = new Set();
  const first = deriveUniqueMenuContextSlug('Lunch', 0, used);
  const second = deriveUniqueMenuContextSlug('Lunch', 1, used);
  assert.notEqual(first, second);
  assert.match(second, /^[a-z]+$/);
});
