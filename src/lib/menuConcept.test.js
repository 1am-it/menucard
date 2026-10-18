'use strict';

// BE-25 — Menukaartcontrole → concept v1: pure logic. Fictional data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePrice, summarizeRecognisedMenu, liveMenuLines, buildMenuConcept } = require('./menuConcept');

const MENUS = [
  {
    name: 'Menukaart',
    contextSlug: 'menukaart',
    categories: [
      { name: 'Koud', items: [{ name: 'Fictieve salade', price: '14.50' }, { name: 'Fictief tartaar', price: '16.50' }] },
      { name: 'Warm', items: [{ name: 'Fictieve risotto', price: '18.50' }, { name: 'Fictieve vis', price: null }] },
      { name: 'Menukaart', items: [{ name: 'Fictief kaasplankje', price: '12.00' }, { name: 'Fictieve salade', price: '15.00' }] },
    ],
  },
];
const LIVE = {
  '9-diner': {
    categories: [
      { name: 'Koud', items: [{ name: 'Fictieve salade', price: '€14,50', priceValue: 14.5 }, { name: 'Fictief tartaar', price: '€15,00', priceValue: 15 }] },
      { name: 'Dessert', items: [{ name: 'Fictieve mousse', price: '€8,50', priceValue: 8.5 }] },
    ],
  },
  '10-diner': { categories: [{ name: 'Warm', items: [{ name: 'Ander restaurant', priceValue: 20 }] }] },
};

test('prices: common notations normalise, nonsense and out-of-range values do not', () => {
  assert.equal(normalizePrice('14,50'), '14.50');
  assert.equal(normalizePrice('14.5'), '14.50');
  assert.equal(normalizePrice('€ 9'), '9.00');
  assert.equal(normalizePrice('12,-'), '12.00');
  assert.equal(normalizePrice(8.5), '8.50');
  for (const bad of ['', 'gratis', '1.000,00', '0', '999', null, undefined]) assert.equal(normalizePrice(bad), null, String(bad));
});

test('control view: dishes and prices per section, counts, and only uncertain lines as attention points', () => {
  const summary = summarizeRecognisedMenu(MENUS);
  assert.equal(summary.itemCount, 6);
  assert.equal(summary.categoryCount, 3);
  assert.deepEqual(summary.categories[0].items.map((i) => [i.name, i.price]), [['Fictieve salade', '€ 14,50'], ['Fictief tartaar', '€ 16,50']]);
  assert.deepEqual(
    summary.attention.map((a) => [a.name, a.reason]),
    [
      ['Fictieve salade', 'Komt meer dan eens voor'],
      ['Fictieve vis', 'Prijs ontbreekt'],
      ['Fictief kaasplankje', 'Rubriek onduidelijk'],
      ['Fictieve salade', 'Komt meer dan eens voor'],
    ]
  );
});

test('live menu lines: only the restaurant\'s own published menus', () => {
  const lines = liveMenuLines(LIVE, '9');
  assert.deepEqual(lines.map((l) => [l.name, l.price, l.category]), [['Fictieve salade', '14.50', 'Koud'], ['Fictief tartaar', '15.00', 'Koud'], ['Fictieve mousse', '8.50', 'Dessert']]);
});

test('concept: unchanged, new and price changes are compared with the current menu; problems block saving', () => {
  const concept = buildMenuConcept({ menus: MENUS, liveLines: liveMenuLines(LIVE, '9'), edits: {} });
  const byName = (n) => concept.lines.filter((l) => l.name === n).map((l) => l.status);
  assert.deepEqual(byName('Fictief tartaar'), ['price_changed']);
  assert.deepEqual(byName('Fictieve risotto'), ['new']);
  assert.deepEqual(byName('Fictieve vis'), ['missing_price']);
  assert.deepEqual(byName('Fictief kaasplankje'), ['unclear_category']);
  // The second salad also sits in a vague section; that blocker comes first.
  assert.deepEqual(byName('Fictieve salade'), ['duplicate', 'unclear_category']);
  assert.deepEqual(concept.removed.map((l) => l.name), ['Fictieve mousse']);
  assert.equal(concept.canSave, false);
  const blockerStatuses = concept.blockers.map((b) => b.status).sort();
  assert.deepEqual(blockerStatuses, ['duplicate', 'missing_price', 'removed', 'unclear_category', 'unclear_category']);
  // A price change is an attention point, never silently published, but not a blocker.
  assert.ok(concept.attentionLines.some((l) => l.status === 'price_changed'));
});

test('concept: corrections, exclusions, explicit acceptance and a decision on removed dishes clear every blocker', () => {
  const edits = {
    lines: {
      '0.1.1': { price: '19,5' }, // missing price fixed
      '0.2.0': { category: 'Dessert' }, // unclear category corrected
      '0.2.1': { exclude: true }, // duplicate salad excluded
    },
    removed: 'keep',
  };
  const concept = buildMenuConcept({ menus: MENUS, liveLines: liveMenuLines(LIVE, '9'), edits });
  assert.deepEqual(concept.blockers, []);
  assert.equal(concept.canSave, true);
  assert.equal(concept.lines.find((l) => l.id === '0.1.1').price, '19.50');
  assert.deepEqual(
    concept.content.categories.map((c) => [c.name, c.items.map((i) => `${i.name} ${i.price}`)]),
    [
      ['Koud', ['Fictieve salade 14.50', 'Fictief tartaar 16.50']],
      ['Warm', ['Fictieve risotto 18.50', 'Fictieve vis 19.50']],
      ['Dessert', ['Fictief kaasplankje 12.00', 'Fictieve mousse 8.50']],
    ]
  );
});

test('concept: removing missing dishes is an explicit choice; without a decision nothing can be saved', () => {
  const base = { lines: { '0.1.1': { exclude: true }, '0.2.0': { accept: true }, '0.2.1': { exclude: true } } };
  assert.equal(buildMenuConcept({ menus: MENUS, liveLines: liveMenuLines(LIVE, '9'), edits: base }).canSave, false);
  const removed = buildMenuConcept({ menus: MENUS, liveLines: liveMenuLines(LIVE, '9'), edits: { ...base, removed: 'remove' } });
  assert.equal(removed.canSave, true);
  assert.ok(!JSON.stringify(removed.content.categories).includes('Fictieve mousse'));
  // The decision itself travels with the version, so it is never asked again.
  assert.deepEqual(removed.content.removed, [{ name: 'Fictieve mousse', decision: 'remove' }]);
});

test('concept: an invalid corrected price stays a blocker; a restaurant without a published menu has no removals', () => {
  const concept = buildMenuConcept({ menus: MENUS, liveLines: [], edits: { lines: { '0.1.1': { price: 'gratis' } } } });
  assert.equal(concept.lines.find((l) => l.id === '0.1.1').status, 'missing_price');
  assert.deepEqual(concept.removed, []);
  assert.ok(concept.lines.filter((l) => l.status === 'new').length >= 2);
});

test('stored version: choices travel with it — accepted dishes and per-dish decisions are not asked again', () => {
  const { storedConceptInput, mergeEdits } = require('./menuConcept');
  const live = liveMenuLines(LIVE, '9');
  const edits = { lines: { '0.1.1': { price: '19,5' }, '0.2.0': { accept: true }, '0.2.1': { exclude: true } }, removed: { 'fictieve mousse': 'remove' } };
  const saved = buildMenuConcept({ menus: MENUS, liveLines: live, edits });
  assert.equal(saved.canSave, true);
  const stored = storedConceptInput(saved.content);
  const reloaded = buildMenuConcept({ menus: stored.menus, liveLines: live, edits: stored.edits });
  assert.deepEqual(reloaded.blockers, []);
  assert.deepEqual(reloaded.content, saved.content); // a round trip changes nothing, so its hash is identical
  assert.equal(reloaded.lines.find((l) => l.name === 'Fictief kaasplankje').from, '0.2.0');
  // A reviewer may undo a stored acceptance; the blocker returns.
  const undone = buildMenuConcept({ menus: stored.menus, liveLines: live, edits: mergeEdits(stored.edits, { lines: { '0.2.0': { accept: false } } }) });
  assert.deepEqual(undone.blockers.map((b) => b.status), ['unclear_category']);
});

test('REGRESSION: a shared category acceptance never settles duplicate dishes; the server keeps the duplicate blocker', () => {
  const menus = [
    {
      categories: [
        { name: 'Warm', uncertain: true, items: [{ name: 'Fictieve soep', price: '6.50' }, { name: 'Fictieve soep', price: '6.50' }] },
      ],
    },
  ];
  const categoryAccepted = buildMenuConcept({
    menus,
    liveLines: [],
    edits: { lines: { '0.0.0': { acceptCategory: true }, '0.0.1': { acceptCategory: true } } },
  });
  assert.deepEqual(categoryAccepted.lines.map((l) => l.status), ['duplicate', 'duplicate']);
  assert.equal(categoryAccepted.canSave, false);
  assert.deepEqual(categoryAccepted.blockers.map((b) => b.status), ['duplicate', 'duplicate']);
  assert.equal(categoryAccepted.lines.every((l) => l.categoryAccepted === true && l.duplicateAccepted === false), true);

  const duplicateAccepted = buildMenuConcept({
    menus,
    liveLines: [],
    edits: { lines: { '0.0.0': { acceptDuplicate: true }, '0.0.1': { acceptDuplicate: true } } },
  });
  assert.deepEqual(duplicateAccepted.lines.map((l) => l.status), ['unclear_category', 'unclear_category']);
  assert.equal(duplicateAccepted.canSave, false);
});

test('disappeared dishes are decided one by one; "Klopt zo" never settles a missing price', () => {
  const live = [...liveMenuLines(LIVE, '9'), { id: 'x', name: 'Fictieve taart', price: '6.00', category: 'Dessert' }];
  const base = { lines: { '0.1.1': { price: '19,5' }, '0.2.0': { accept: true }, '0.2.1': { exclude: true } } };
  const half = buildMenuConcept({ menus: MENUS, liveLines: live, edits: { ...base, removed: { 'fictieve mousse': 'keep' } } });
  assert.deepEqual(half.blockers.map((b) => b.status), ['removed']);
  assert.match(half.blockers[0].label, /^1 gerecht /);
  const both = buildMenuConcept({ menus: MENUS, liveLines: live, edits: { ...base, removed: { 'fictieve mousse': 'keep', 'fictieve taart': 'remove' } } });
  assert.equal(both.canSave, true);
  assert.deepEqual(both.content.removed, [{ name: 'Fictieve taart', decision: 'remove' }]);
  const accepted = buildMenuConcept({ menus: MENUS, liveLines: [], edits: { lines: { '0.1.1': { accept: true } } } });
  assert.equal(accepted.lines.find((l) => l.id === '0.1.1').status, 'missing_price');
});

test('browser edits are reduced to known keys and short values', () => {
  const { sanitizeEdits } = require('./menuConcept');
  const clean = sanitizeEdits({
    canSave: true,
    lines: { '0.0.1': { exclude: false, accept: 'yes', price: '9', status: 'new', name: 'x'.repeat(201) }, '../etc': { exclude: true } },
    removed: { 'fictieve mousse': 'keep', 'fictieve taart': 'misschien' },
  });
  assert.deepEqual(clean, { lines: { '0.0.1': { exclude: false, price: '9' } }, removed: { 'fictieve mousse': 'keep' } });
  assert.deepEqual(sanitizeEdits(null), { lines: {}, removed: null });
});
