'use strict';

// BE-71 (#176) — R6: een kaart waarvan minstens 90% van de gerechten aan de eis
// voldoet, mag zonder de twijfelgevallen in data/menus.json, met `incomplete`,
// `omittedCount` en de bron-url. De weggelaten gerechten staan met hun reden in
// het rapport. Geen netwerk: alleen opgeslagen menus en de pure functies.

const test = require('node:test');
const assert = require('node:assert/strict');

const { assessIncompleteMenu, retainAcceptedDishes, assessCompleteMenu } = require('./completeMenu');
const { buildExport } = require('./menuEntry');
const { buildReport, renderMarkdown } = require('./report');

function dish(name, price, desc = '') {
  return { name, desc, price };
}

function menuOf(items, { category = 'Hoofdgerechten', uncertain = false, attention = [] } = {}) {
  return { kind: 'html', title: null, categories: [{ name: category, items, uncertain }], attention };
}

function dishes(count, { start = 0 } = {}) {
  return Array.from({ length: count }, (_, i) => dish(`Gerecht ${start + i + 1}`, 10 + i));
}

test('R6: 9 van 10 gerechten aan de eis is genoeg, met het tiende als reden in het rapport', () => {
  const menu = menuOf([...dishes(9), dish('Soep van de dag', null)]);
  const full = assessCompleteMenu(menu);
  assert.equal(full.ok, false, 'zonder R6 zou deze kaart overgeslagen worden');

  const partial = assessIncompleteMenu(menu);
  assert.equal(partial.ok, true);
  assert.equal(partial.keptCount, 9);
  assert.equal(partial.omittedCount, 1);
  assert.equal(partial.omitted[0].reason, 'unpriced_dishes');
  assert.equal(partial.share, 0.9);

  const trimmed = retainAcceptedDishes(menu, partial);
  assert.equal(trimmed.categories[0].items.length, 9);
  assert.ok(!trimmed.categories[0].items.some((item) => item.name === 'Soep van de dag'));
});

test('R6: onder de 90% wordt de kaart nog steeds overgeslagen', () => {
  const menu = menuOf([...dishes(8), dish('Zonder prijs A', null), dish('Zonder prijs B', null)]);
  const partial = assessIncompleteMenu(menu);
  assert.equal(partial.share, 0.8);
  assert.equal(partial.ok, false);
});

test('R6: een onzekere sectie en een prijs buiten de grens vallen allebei af, met hun eigen reden', () => {
  const menu = {
    kind: 'html',
    title: null,
    categories: [
      { name: 'Hoofdgerechten', items: dishes(18) },
      { name: 'Onzeker', uncertain: true, items: [dish('Iets', 9)] },
      { name: 'Wijn', items: [...dishes(2, { start: 20 }), dish('Fles Grand Cru', 400)] },
    ],
    attention: [],
  };
  const partial = assessIncompleteMenu(menu);
  assert.equal(partial.omittedCount, 2);
  assert.deepEqual(partial.omitted.map((entry) => entry.reason).sort(), ['price_out_of_bounds', 'uncertain_sections']);
  assert.equal(partial.ok, true, '20 van 22 is meer dan 90%');

  const trimmed = retainAcceptedDishes(menu, partial);
  assert.deepEqual(trimmed.categories.map((category) => category.name), ['Hoofdgerechten', 'Wijn']);
  assert.ok(!trimmed.categories[1].items.some((item) => item.name === 'Fles Grand Cru'));
});

test('R6: een open aandachtspunt blijft de kaart blokkeren', () => {
  const menu = menuOf(dishes(9), { attention: [{ code: 'excluded_sections', detail: 'Kerstbestellijst' }] });
  const partial = assessIncompleteMenu(menu);
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.reasons.map((reason) => reason.code), ['excluded_sections']);
});

test('R6: de kaart in data/menus.json draagt incomplete, omittedCount en de bron-url', () => {
  const menu = menuOf([...dishes(9), dish('Soep van de dag', null)]);
  const partial = assessIncompleteMenu(menu);
  const trimmed = retainAcceptedDishes(menu, partial);
  const built = buildExport({
    restaurantId: '99',
    menu: trimmed,
    menus: {},
    sourceUrl: 'https://voorbeeld.nl/menukaart/',
    scraped: '2026-11-01',
  });
  const { categories, ...rest } = built.entry;
  const entry = { ...rest, incomplete: true, omittedCount: partial.omittedCount, categories };

  assert.equal(entry.incomplete, true);
  assert.equal(entry.omittedCount, 1);
  assert.equal(entry.source, 'https://voorbeeld.nl/menukaart/');
  assert.equal(entry.scraped, '2026-11-01');
  assert.equal(entry.categories[0].items.length, 9);
  assert.equal(entry.categories[0].items[0].priceValue, 10);
});

test('R6: het rapport noemt elk weggelaten gerecht met zijn reden', () => {
  const menu = menuOf([...dishes(9), dish('Soep van de dag', null)]);
  const partial = assessIncompleteMenu(menu);
  const trimmed = retainAcceptedDishes(menu, partial);
  const built = buildExport({ restaurantId: '99', menu: trimmed, menus: {}, sourceUrl: 'https://voorbeeld.nl/menukaart/', scraped: '2026-11-01' });
  const { categories, ...rest } = built.entry;
  const entry = { ...rest, incomplete: true, omittedCount: partial.omittedCount, categories };
  const result = {
    restaurantId: '99',
    name: 'Fictief',
    website: 'https://voorbeeld.nl/',
    status: 'done',
    reasons: [],
    candidates: [],
    sourceUrl: 'https://voorbeeld.nl/menukaart/',
    kind: 'html',
    dishCount: partial.keptCount,
    pricedCount: partial.pricedCount,
    pageCount: null,
    entry,
    entryKey: built.key,
    incomplete: true,
    omitted: partial.omitted,
  };
  const report = buildReport({ results: [result], previousMenus: {}, scraped: '2026-11-01', generatedAt: '2026-11-01T10:00:00.000Z' });
  const row = report.restaurants[0];
  assert.equal(row.incomplete, true);
  assert.equal(row.omittedCount, 1);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /## Kaarten met weggelaten gerechten \(R6\)/);
  assert.match(markdown, /weggelaten: Soep van de dag \(Hoofdgerechten\): gerechten zonder prijs/);
  assert.match(markdown, /https:\/\/voorbeeld\.nl\/menukaart\//);
});
