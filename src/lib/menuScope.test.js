'use strict';

// Menu scope: the same dish legitimately appears on several menu variants
// (lunch, diner). Duplicates, the comparison with the published menu, price
// changes and disappeared dishes are judged per variant. Fictional data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMenuConcept, summarizeRecognisedMenu, liveMenuLines, storedConceptInput, removalKey } = require('./menuConcept');
const { buildMenuEntry } = require('./menuExport');
const { menuScopeOf } = require('./menuGroups');

const dish = (name, price) => ({ name, price });
const LUNCH_AND_DINER = [
  { title: 'Lunch', categories: [{ name: 'Gerechten', path: ['Gerechten'], items: [dish('Fictieve soep', '7.50'), dish('Fictieve salade', '13.50'), dish('Fictief broodje', '8.50')] }] },
  { title: 'Diner', categories: [{ name: 'Gerechten', path: ['Gerechten'], items: [dish('Fictieve soep', '7.50'), dish('Fictieve salade', '15.50'), dish('Fictieve stoof', '24.00')] }] },
];

test('the canonical menu scope is the outermost group the export writes; flat sections have none', () => {
  assert.equal(menuScopeOf(['Lunch', 'Gerechten']), 'Lunch');
  assert.equal(menuScopeOf(['Diner', 'Voor', 'Warm']), 'Diner');
  assert.equal(menuScopeOf(['Voorgerechten']), '');
});

test('the same dish on the lunch and the diner menu is no duplicate, and stays in both menus in preview and export', () => {
  const concept = buildMenuConcept({ menus: LUNCH_AND_DINER, liveLines: [], edits: {} });
  assert.deepEqual(concept.blockers, []);
  assert.ok(!concept.lines.some((l) => l.status === 'duplicate'));
  assert.deepEqual(concept.lines.map((l) => [l.menuScope, l.name]).filter(([, n]) => n === 'Fictieve soep'), [['Lunch', 'Fictieve soep'], ['Diner', 'Fictieve soep']]);
  assert.deepEqual(summarizeRecognisedMenu(LUNCH_AND_DINER).attention, []);
  const entry = buildMenuEntry({ content: concept.content, currentEntries: {}, sourceUrl: 'https://fictief.example/', scraped: '2026-10-14' });
  assert.deepEqual(entry.categories.map((c) => [c.path, c.items.map((i) => `${i.name} ${i.price}`)]), [
    [['Lunch', 'Gerechten'], ['Fictieve soep €7,50', 'Fictieve salade €13,50', 'Fictief broodje €8,50']],
    [['Diner', 'Gerechten'], ['Fictieve soep €7,50', 'Fictieve salade €15,50', 'Fictieve stoof €24']],
  ]);
  // A stored version reads back the same, without new blockers.
  const stored = storedConceptInput(concept.content);
  const reloaded = buildMenuConcept({ menus: stored.menus, liveLines: [], edits: stored.edits });
  assert.deepEqual(reloaded.blockers, []);
  assert.deepEqual(reloaded.content, concept.content);
});

test('many shared dishes across variants (a whole lunch menu repeated at diner): zero duplicate blockers', () => {
  const shared = Array.from({ length: 13 }, (_, i) => dish(`Fictief gerecht ${i + 1}`, `${10 + i}.00`));
  const menus = [
    { title: 'Lunch', categories: [{ name: 'Gerechten', path: ['Gerechten'], items: shared }] },
    { title: 'Diner', categories: [{ name: 'Gerechten', path: ['Gerechten'], items: shared }] },
  ];
  const concept = buildMenuConcept({ menus, liveLines: [], edits: {} });
  assert.equal(concept.lines.length, 26);
  assert.equal(concept.blockers.length, 0);
});

test('the same dish twice inside one variant stays a duplicate blocker on both lines', () => {
  const menus = [
    { title: 'Lunch', categories: [{ name: 'Warm', path: ['Warm'], items: [dish('Fictieve soep', '7.50')] }, { name: 'Koud', path: ['Koud'], items: [dish('Fictieve soep', '8.00')] }] },
    { title: 'Diner', categories: [{ name: 'Gerechten', path: ['Gerechten'], items: [dish('Fictieve soep', '7.50')] }] },
  ];
  const concept = buildMenuConcept({ menus, liveLines: [], edits: {} });
  assert.deepEqual(concept.lines.map((l) => [l.menuScope, l.status]), [['Lunch', 'duplicate'], ['Lunch', 'duplicate'], ['Diner', 'new']]);
});

test('a flat single menu works exactly as before: duplicates over the whole menu, by-name comparison, unchanged content shape', () => {
  const flat = [{ categories: [{ name: 'Warm', items: [dish('Fictieve soep', '7.50')] }, { name: 'Koud', items: [dish('Fictieve soep', '8.00'), dish('Fictieve salade', '9.00')] }] }];
  const live = liveMenuLines({ '9-lunch': { categories: [{ name: 'Lunch', items: [{ name: 'Fictieve salade', priceValue: 9 }, { name: 'Fictieve taart', priceValue: 4 }] }] } }, '9');
  const concept = buildMenuConcept({ menus: flat, liveLines: live, edits: { removed: { 'fictieve taart': 'remove' } } });
  assert.deepEqual(concept.lines.map((l) => [l.menuScope, l.status]), [['', 'duplicate'], ['', 'duplicate'], ['', 'unchanged']]);
  assert.deepEqual(concept.content.removed, [{ name: 'Fictieve taart', decision: 'remove' }]);
  assert.deepEqual(Object.keys(concept.content.categories[0]), ['name', 'items']);
});

const LIVE_TWO = {
  '7-lunch': { subtitle: 'Lunchkaart', categories: [{ name: 'Lunch', items: [{ name: 'Fictieve soep', priceValue: 7.5 }, { name: 'Fictieve salade', priceValue: 13.5 }] }] },
  '7-diner': { subtitle: 'Dinerkaart', categories: [{ name: 'Diner', items: [{ name: 'Fictieve soep', priceValue: 9.5 }, { name: 'Fictieve stoof', priceValue: 24 }] }] },
};

test('the published comparison is per variant: same name, different price per menu is no false price change', () => {
  const live = liveMenuLines(LIVE_TWO, '7');
  assert.deepEqual(live.map((l) => [l.menuScope, l.name]), [['Lunch', 'Fictieve soep'], ['Lunch', 'Fictieve salade'], ['Diner', 'Fictieve soep'], ['Diner', 'Fictieve stoof']]);
  const menus = [
    { title: 'Lunch', categories: [{ name: 'Lunch', path: ['Lunch'], items: [dish('Fictieve soep', '7.50'), dish('Fictieve salade', '13.50')] }] },
    { title: 'Diner', categories: [{ name: 'Diner', path: ['Diner'], items: [dish('Fictieve soep', '9.50'), dish('Fictieve stoof', '26.00')] }] },
  ];
  const concept = buildMenuConcept({ menus, liveLines: live, edits: {} });
  assert.deepEqual(concept.lines.map((l) => [l.menuScope, l.name, l.status, l.livePrice]), [
    ['Lunch', 'Fictieve soep', 'unchanged', '7.50'],
    ['Lunch', 'Fictieve salade', 'unchanged', '13.50'],
    ['Diner', 'Fictieve soep', 'unchanged', '9.50'],
    ['Diner', 'Fictieve stoof', 'price_changed', '24.00'],
  ]);
  assert.deepEqual(concept.removed, []);
});

test('no dish disappears silently: a dish missing from one variant needs a per-variant keep/remove decision, which is stored with its scope', () => {
  const live = liveMenuLines(LIVE_TWO, '7');
  // The diner page no longer lists the soup; lunch still does.
  const menus = [
    { title: 'Lunch', categories: [{ name: 'Lunch', path: ['Lunch'], items: [dish('Fictieve soep', '7.50'), dish('Fictieve salade', '13.50')] }] },
    { title: 'Diner', categories: [{ name: 'Diner', path: ['Diner'], items: [dish('Fictieve stoof', '24.00')] }] },
  ];
  const open = buildMenuConcept({ menus, liveLines: live, edits: {} });
  assert.deepEqual(open.removed.map((l) => [l.menuScope, l.name, l.decision]), [['Diner', 'Fictieve soep', null]]);
  assert.deepEqual(open.blockers.map((b) => b.status), ['removed']);

  const key = removalKey(open.removed[0]);
  assert.equal(key, 'diner|fictieve soep');
  const kept = buildMenuConcept({ menus, liveLines: live, edits: { removed: { [key]: 'keep' } } });
  assert.deepEqual(kept.blockers, []);
  assert.deepEqual(kept.content.categories.map((c) => [c.path || [c.name], c.items.map((i) => i.name)]), [
    [['Lunch', 'Lunch'], ['Fictieve soep', 'Fictieve salade']],
    [['Diner', 'Diner'], ['Fictieve stoof', 'Fictieve soep']],
  ]);

  const removedOne = buildMenuConcept({ menus, liveLines: live, edits: { removed: { [key]: 'remove' } } });
  assert.deepEqual(removedOne.content.removed, [{ name: 'Fictieve soep', scope: 'Diner', decision: 'remove' }]);
  const stored = storedConceptInput(removedOne.content);
  assert.deepEqual(buildMenuConcept({ menus: stored.menus, liveLines: live, edits: stored.edits }).blockers, []);
  // Every recognised and every published dish is accounted for.
  const names = (c) => c.content.categories.flatMap((x) => x.items.map((i) => `${x.path ? x.path[0] : ''}|${i.name}`)).sort();
  assert.deepEqual(names(kept), ['Diner|Fictieve soep', 'Diner|Fictieve stoof', 'Lunch|Fictieve salade', 'Lunch|Fictieve soep']);
});

// ─── Fail closed between explicit variants ───

const LIVE_DINER_SOUP = {
  '8-lunch': { subtitle: 'Lunchkaart', categories: [{ name: 'Lunch', items: [{ name: 'Fictieve salade', priceValue: 13.5 }] }] },
  '8-diner': { subtitle: 'Dinerkaart', categories: [{ name: 'Diner', items: [{ name: 'Fictieve soep', priceValue: 9.5 }] }] },
};

test('a Lunch dish never takes over a Diner dish of the same unique name: Lunch is new and Diner needs an explicit choice', () => {
  const live = liveMenuLines(LIVE_DINER_SOUP, '8');
  const menus = [{ title: 'Lunch', categories: [{ name: 'Lunch', path: ['Lunch'], items: [dish('Fictieve soep', '7.50'), dish('Fictieve salade', '13.50')] }] }, { title: 'Diner', categories: [{ name: 'Diner', path: ['Diner'], items: [dish('Fictieve stoof', '24.00')] }] }];
  const concept = buildMenuConcept({ menus, liveLines: live, edits: {} });
  const soup = concept.lines.find((l) => l.name === 'Fictieve soep');
  assert.equal(soup.menuScope, 'Lunch');
  assert.equal(soup.status, 'new');
  assert.equal(soup.live, null);
  assert.deepEqual(concept.removed.map((l) => [l.menuScope, l.name, l.decision]), [['Diner', 'Fictieve soep', null]]);
  assert.deepEqual(concept.blockers.map((b) => b.status), ['removed']);
  // Nothing moved silently: with "keep" the diner soup stays on the diner menu.
  const kept = buildMenuConcept({ menus, liveLines: live, edits: { removed: { 'diner|fictieve soep': 'keep' } } });
  assert.deepEqual(kept.blockers, []);
  assert.deepEqual(kept.content.categories.map((c) => [c.path, c.items.map((i) => i.name)]), [
    [['Lunch', 'Lunch'], ['Fictieve soep', 'Fictieve salade']],
    [['Diner', 'Diner'], ['Fictieve stoof', 'Fictieve soep']],
  ]);
});

test('the same explicit variant still matches: unchanged and price change within Diner', () => {
  const live = liveMenuLines(LIVE_DINER_SOUP, '8');
  const menus = [{ title: 'Lunch', categories: [{ name: 'Lunch', path: ['Lunch'], items: [dish('Fictieve salade', '13.50')] }] }, { title: 'Diner', categories: [{ name: 'Diner', path: ['Diner'], items: [dish('Fictieve soep', '10.00')] }] }];
  const concept = buildMenuConcept({ menus, liveLines: live, edits: {} });
  assert.deepEqual(concept.lines.map((l) => [l.menuScope, l.name, l.status, l.livePrice]), [['Lunch', 'Fictieve salade', 'unchanged', '13.50'], ['Diner', 'Fictieve soep', 'price_changed', '9.50']]);
  assert.deepEqual(concept.removed, []);
});

test('compatibility only for an old, unscoped published dish (one flat published menu)', () => {
  const live = liveMenuLines({ '5-menu': { categories: [{ name: 'Gerechten', items: [{ name: 'Fictieve soep', priceValue: 7.5 }] }] } }, '5');
  assert.equal(live[0].menuScope, '');
  const menus = [{ title: 'Lunch', categories: [{ name: 'Gerechten', path: ['Gerechten'], items: [dish('Fictieve soep', '7.50')] }] }, { title: 'Diner', categories: [{ name: 'Gerechten', path: ['Gerechten'], items: [dish('Fictieve soep', '7.50')] }] }];
  const concept = buildMenuConcept({ menus, liveLines: live, edits: {} });
  assert.deepEqual(concept.lines.map((l) => [l.menuScope, l.status]), [['Lunch', 'unchanged'], ['Diner', 'unchanged']]);
  assert.deepEqual(concept.removed, []);
  assert.deepEqual(concept.blockers, []);
});
