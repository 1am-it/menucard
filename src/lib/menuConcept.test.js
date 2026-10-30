'use strict';

// BE-25 — Menukaartcontrole → concept v1: pure logic. Fictional data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePrice, summarizeRecognisedMenu, liveMenuLines, buildMenuConcept, conceptSectionCount } = require('./menuConcept');

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
      ['Fictief kaasplankje', 'Menukopje onduidelijk'],
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

test('section count: the same section name under two parents is two rubrieken, exactly as the concept stores them', () => {
  // Regression P3 of review 6309694854: counting by the last label merged
  // "Lunch › Dessert" and "Diner › Dessert" into one, so the overview said
  // fewer rubrieken than the structure card of the same concept.
  const menus = [
    { title: 'Lunch', categories: [{ name: 'Dessert', path: ['Dessert'], items: [{ name: 'Fictieve mousse', price: '8.50' }] }] },
    { title: 'Diner', categories: [{ name: 'Dessert', path: ['Dessert'], items: [{ name: 'Fictief ijs', price: '9.50' }] }] },
  ];
  const concept = buildMenuConcept({ menus, liveLines: [], edits: {} });
  assert.deepEqual(concept.content.categories.map((c) => c.path), [['Lunch', 'Dessert'], ['Diner', 'Dessert']]);
  assert.equal(conceptSectionCount(concept), 2);
  // What the old count did: one section name, one rubriek.
  assert.equal(new Set(concept.lines.map((l) => l.category)).size, 1);
  // The count follows the concept: excluding one dish removes its section.
  const withoutDiner = buildMenuConcept({ menus, liveLines: [], edits: { lines: { '1.0.0': { exclude: true } } } });
  assert.equal(conceptSectionCount(withoutDiner), 1);
  assert.equal(conceptSectionCount(null), 0);
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

  const legacyAccept = buildMenuConcept({
    menus,
    liveLines: [],
    edits: { lines: { '0.0.0': { accept: true }, '0.0.1': { accept: true } } },
  });
  assert.deepEqual(legacyAccept.lines.map((l) => l.status), ['duplicate', 'duplicate']);
  assert.equal(legacyAccept.canSave, false);
});

test('disappeared dishes are decided one by one; "Klopt zo" never settles a missing price', () => {
  const live = [...liveMenuLines(LIVE, '9'), { id: 'x', name: 'Fictieve taart', price: '6.00', category: 'Dessert' }];
  const base = { lines: { '0.1.1': { price: '19,5' }, '0.2.0': { accept: true }, '0.2.1': { exclude: true } } };
  const half = buildMenuConcept({ menus: MENUS, liveLines: live, edits: { ...base, removed: { 'fictieve mousse': 'keep' } } });
  assert.deepEqual(half.blockers.map((b) => b.status), ['removed']);
  assert.match(half.blockers[0].label, /^1 gerecht /);
  const both = buildMenuConcept({ menus: MENUS, liveLines: live, edits: { ...base, removed: { 'fictieve mousse': 'keep', 'fictieve taart': 'remove' } } });

test('REGRESSION (review 6253408889): an explicitly unheaded PDF row is a review blocker, never a silently savable category', () => {
  // Shapes the parser + pdfMenuContext fallback produce for a bridged row:
  // the fallback section label is generic, but sourcePath is empty and the
  // category stays uncertain. The existing gate must keep it unsavable until
  // a human names or accepts the category.
  const menus = [
    {
      name: 'Menukaart',
      contextSlug: 'menukaart',
      categories: [
        {
          name: 'Menukaart',
          path: ['Menukaart'],
          sourcePath: [],
          uncertain: true,
          items: [{ name: 'Blueberry & Lavender Lemonade', price: '4.8' }],
        },
      ],
    },
  ];
  const concept = buildMenuConcept({ menus, liveLines: [] });
  assert.equal(concept.lines[0].categoryUncertain, true);
  assert.equal(concept.lines[0].status, 'unclear_category');
  assert.equal(concept.canSave, false);
  assert.deepEqual(concept.blockers.map((blocker) => blocker.status), ['unclear_category']);

  const accepted = buildMenuConcept({ menus, liveLines: [], edits: { lines: { '0.0.0': { accept: true } } } });
  assert.equal(accepted.canSave, true);
});

  assert.equal(both.canSave, true);
  assert.deepEqual(both.content.removed, [{ name: 'Fictieve taart', decision: 'remove' }]);
  const accepted = buildMenuConcept({ menus: MENUS, liveLines: [], edits: { lines: { '0.1.1': { accept: true } } } });
  assert.equal(accepted.lines.find((l) => l.id === '0.1.1').status, 'missing_price');
});

const RENAME_MENUS = [
  {
    title: 'Menukaart',
    categories: [
      {
        name: 'Proef het beste van het seizoen — Hoofd',
        path: ['Proef het beste van het seizoen — Hoofd'],
        items: [
          { name: 'Fictieve zeebaars', price: '24,50' },
          { name: 'Fictieve lam', price: '26,00' },
        ],
      },
      { name: 'Dessert', path: ['Dessert'], items: [{ name: 'Fictieve taart', price: '8,50' }] },
    ],
  },
];

test('BE-53 rename: every dish under the menukopje gets the path edit, nothing else moves', () => {
  const { renameSectionEdits, sanitizeEdits, mergeEdits, storedConceptInput } = require('./menuConcept');
  const concept = buildMenuConcept({ menus: RENAME_MENUS, liveLines: [], edits: {} });
  const section = concept.content.categories[0];
  const sectionPath = section.path || [section.name];
  assert.deepEqual(sectionPath, ['Proef het beste van het seizoen — Hoofd']);

  const result = renameSectionEdits(concept.lines, sectionPath, '  Hoofdgerechten ');
  assert.equal(result.ok, true);
  assert.deepEqual(result.path, ['Hoofdgerechten']);
  // Exactly the two dishes of that menukopje, each with the existing path edit.
  assert.deepEqual(result.edits, {
    lines: { '0.0.0': { path: ['Hoofdgerechten'] }, '0.0.1': { path: ['Hoofdgerechten'] } },
  });
  assert.deepEqual(result.lineIds.sort(), ['0.0.0', '0.0.1']);

  // The server reduces the same payload to the same edits and the concept
  // really shows the new name with both dishes still under it.
  const clean = sanitizeEdits(result.edits);
  assert.deepEqual(clean.lines, result.edits.lines);
  const renamed = buildMenuConcept({ menus: RENAME_MENUS, liveLines: [], edits: mergeEdits({}, clean) });
  assert.deepEqual(renamed.content.categories.map((c) => c.name), ['Hoofdgerechten', 'Dessert']);
  assert.deepEqual(renamed.content.categories[0].items.map((i) => i.name), ['Fictieve zeebaars', 'Fictieve lam']);

  // A stored version keeps the choices: a second reviewer renames the stored
  // menukopje again without any dish moving to another menukopje.
  const stored = storedConceptInput(renamed.content);
  const storedConcept = buildMenuConcept({ menus: stored.menus, liveLines: [], edits: stored.edits });
  const storedSection = storedConcept.content.categories[0];
  const again = renameSectionEdits(storedConcept.lines, storedSection.path || [storedSection.name], 'Hoofd');
  assert.deepEqual(again.path, ['Hoofd']);
  assert.deepEqual(Object.keys(again.edits.lines).sort(), ['0.0.0', '0.0.1']);
});

test('BE-53 rename: only the last label changes; parent labels stay', () => {
  const { renameSectionEdits } = require('./menuConcept');
  const lines = [
    { id: '0.0.0', categoryPath: ['Lunch', 'Proef het beste', 'Hoofd'] },
    { id: '0.1.0', categoryPath: ['Diner', 'Hoofd'] },
  ];
  const result = renameSectionEdits(lines, ['Lunch', 'Proef het beste', 'Hoofd'], 'Hoofdgerechten');
  assert.deepEqual(result.edits, { lines: { '0.0.0': { path: ['Lunch', 'Proef het beste', 'Hoofdgerechten'] } } });
  // The same last label under another parent is a different menukopje: untouched.
  assert.equal(result.edits.lines['0.1.0'], undefined);
});

test('BE-53 rename: empty, blank and too long names are refused with a clear message', () => {
  const { renameSectionEdits, MAX_SECTION_NAME } = require('./menuConcept');
  const lines = [{ id: '0.0.0', categoryPath: ['Hoofd'] }];
  const refused = (name) => {
    const result = renameSectionEdits(lines, ['Hoofd'], name);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.endsWith('.') && result.error.length > 10, result.error);
    return result;
  };
  assert.equal(refused('').reason, 'empty_name');
  assert.equal(refused('   ').reason, 'empty_name');
  assert.equal(refused('\n\t ').reason, 'empty_name');
  assert.equal(refused(null).reason, 'empty_name');
  // Names above MAX_EDIT_TEXT are refused, and so is the longest name that
  // would be silently truncated to a shorter stored label.
  const tooLong = refused('x'.repeat(MAX_SECTION_NAME + 1));
  assert.equal(tooLong.reason, 'name_too_long');
  assert.match(tooLong.error, new RegExp(String(MAX_SECTION_NAME)));
  assert.equal(refused('x'.repeat(201)).reason, 'name_too_long');
  // Exactly the limit is fine and stored unchanged.
  const atLimit = renameSectionEdits(lines, ['Hoofd'], 'y'.repeat(MAX_SECTION_NAME));
  assert.equal(atLimit.ok, true);
  assert.equal(atLimit.path[0].length, MAX_SECTION_NAME);
});

test('BE-53 rename: a rename never merges, moves or rewrites the hierarchy', () => {
  const { renameSectionEdits } = require('./menuConcept');
  const lines = [
    { id: '0.0.0', categoryPath: ['Hoofd'] },
    { id: '0.1.0', categoryPath: ['Dessert'] },
  ];
  // Same name as the current one: nothing to correct.
  assert.equal(renameSectionEdits(lines, ['Hoofd'], 'Hoofd').reason, 'unchanged');
  // The path separator would create a new level instead of a new name.
  assert.equal(renameSectionEdits(lines, ['Hoofd'], 'Diner › Hoofd').reason, 'path_separator');
  // A name that already exists would merge two menukopjes.
  assert.equal(renameSectionEdits(lines, ['Hoofd'], 'Dessert').reason, 'duplicate_section');
  // A menukopje without dishes has nothing to rename (never an invented edit).
  assert.equal(renameSectionEdits([], ['Hoofd'], 'Hoofdgerechten').reason, 'no_dishes');
  assert.equal(renameSectionEdits(lines, [], 'Hoofdgerechten').reason, 'unknown_section');
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
test('BE-53 hulp: een gedeeld voorvoegsel wordt bij twee of meer kopjes herkend, met elk scheidingsteken', () => {
  const { sharedSectionPrefix } = require('./menuConcept');
  const dash = sharedSectionPrefix(['PROEF HET BESTE VAN HET SEIZOEN — HOOFD', 'PROEF HET BESTE VAN HET SEIZOEN — DESSERT', 'Dranken']);
  assert.equal(dash.prefix, 'PROEF HET BESTE VAN HET SEIZOEN — ');
  assert.equal(dash.separator, ' — ');
  assert.equal(dash.count, 2);
  assert.deepEqual(dash.shorten, {
    'PROEF HET BESTE VAN HET SEIZOEN — HOOFD': 'HOOFD',
    'PROEF HET BESTE VAN HET SEIZOEN — DESSERT': 'DESSERT',
  });
  const hyphen = sharedSectionPrefix(['Lunch - Koud', 'Lunch - Warm']);
  assert.equal(hyphen.prefix, 'Lunch - ');
  assert.deepEqual(hyphen.shorten, { 'Lunch - Koud': 'Koud', 'Lunch - Warm': 'Warm' });
  const colon = sharedSectionPrefix(['Diner: vis', 'Diner: vlees', 'Diner: vegan']);
  assert.equal(colon.prefix, 'Diner: ');
  assert.equal(colon.separator, ': ');
  assert.equal(colon.count, 3);
  // Without a separator, with a single kopje or with an empty remainder there is
  // no proposal: shortening would invent a name instead of removing an opening.
  assert.equal(sharedSectionPrefix(['HOOFD', 'DESSERT']), null);
  assert.equal(sharedSectionPrefix(['PROEF — HOOFD']), null);
  assert.equal(sharedSectionPrefix(['PROEF — ', 'PROEF — DESSERT']), null);
  assert.equal(sharedSectionPrefix([]), null);
  assert.equal(sharedSectionPrefix(null), null);
  // The most frequent opening wins; on a tie the longer (more specific) one.
  const frequent = sharedSectionPrefix(['A — B — HOOFD', 'A — B — DESSERT', 'A — ANDERS']);
  assert.equal(frequent.prefix, 'A — ');
  assert.equal(frequent.count, 3);
  const tie = sharedSectionPrefix(['A — B — HOOFD', 'A — B — DESSERT']);
  assert.equal(tie.prefix, 'A — B — ');
  assert.equal(tie.count, 2);
});

test('BE-53 hulp: normale hoofdletters, met cijfers en losse letters ongemoeid', () => {
  const { normalCaseSectionName, isCapsSectionName } = require('./menuConcept');
  assert.equal(normalCaseSectionName('VOOR'), 'Voor');
  assert.equal(normalCaseSectionName('PROEF HET BESTE VAN HET SEIZOEN'), 'Proef het beste van het seizoen');
  assert.equal(normalCaseSectionName('VOOR  —  HOOFD'), 'Voor — hoofd');
  // Words with a digit and single letters keep their spelling.
  assert.equal(normalCaseSectionName('MENU 2026'), 'Menu 2026');
test('BE-53 hulp: een gedeeld voorvoegsel wegknippen levert per kopje een eigen path-edit', () => {
  const { renameSectionsEdits, sharedSectionPrefix, buildMenuConcept } = require('./menuConcept');
  const menus = [
    {
      title: 'Menukaart',
      categories: [
        { name: 'Lunch - Koud', path: ['Lunch - Koud'], items: [{ name: 'Fictieve soep', price: '6,50' }] },
        { name: 'Lunch - Warm', path: ['Lunch - Warm'], items: [{ name: 'Fictieve pasta', price: '14,00' }, { name: 'Fictieve curry', price: '15,00' }] },
        { name: 'Dranken', path: ['Dranken'], items: [{ name: 'Fictieve thee', price: '3,00' }] },
      ],
    },
  ];
  const concept = buildMenuConcept({ menus, liveLines: [], edits: {} });
  const proposal = sharedSectionPrefix(concept.content.categories.map((category) => category.name));
  const renames = concept.content.categories
    .filter((category) => Object.prototype.hasOwnProperty.call(proposal.shorten, category.name))
    .map((category) => ({ path: category.path || [category.name], name: proposal.shorten[category.name] }));
  const result = renameSectionsEdits(concept.lines, renames);
  assert.equal(result.ok, true);
  assert.deepEqual(result.applied, [['Koud'], ['Warm']]);
  assert.deepEqual(result.refused, []);
  // Every dish under each shortened kopje carries its own path; Dranken is untouched.
  assert.deepEqual(result.edits.lines, {
    '0.0.0': { path: ['Koud'] },
    '0.1.0': { path: ['Warm'] },
    '0.1.1': { path: ['Warm'] },
  });
  assert.deepEqual([...result.lineIds].sort(), ['0.0.0', '0.1.0', '0.1.1']);
  const after = buildMenuConcept({ menus, liveLines: [], edits: result.edits });
  assert.deepEqual(after.content.categories.map((category) => category.name), ['Koud', 'Warm', 'Dranken']);
  // A batch never merges two kopjes into one name: the second rename is refused
  // with the same reason the single rename gives.
  const merge = renameSectionsEdits(concept.lines, [
    { path: ['Lunch - Koud'], name: 'Warm' },
    { path: ['Lunch - Warm'], name: 'Warm' },
  ]);
  assert.deepEqual(merge.applied, [['Warm']]);
  assert.equal(merge.refused.length, 1);
  assert.equal(merge.refused[0].reason, 'duplicate_section');
  assert.equal(merge.refused[0].error, 'Er is al een menukopje met deze naam; menukopjes samenvoegen kan hier niet.');
  // Nothing applicable: no empty correction is offered.
  assert.equal(renameSectionsEdits(concept.lines, [{ path: ['Onbekend'], name: 'Koud' }]).ok, false);
  assert.equal(renameSectionsEdits(concept.lines, []).ok, false);
});

  assert.equal(normalCaseSectionName('4 GANGEN'), '4 Gangen');
  assert.equal(normalCaseSectionName('A LA CARTE'), 'A la carte');
  // An already normal name is unchanged, so a caller can skip it.
  assert.equal(normalCaseSectionName('Hoofdgerechten'), 'Hoofdgerechten');
  assert.equal(normalCaseSectionName(''), '');
  assert.equal(normalCaseSectionName(null), '');
  // Only kopjes entirely in capitals offer the button.
  assert.equal(isCapsSectionName('VOOR'), true);
  assert.equal(isCapsSectionName('PROEF — HOOFD'), true);
  assert.equal(isCapsSectionName('Voor'), false);
  assert.equal(isCapsSectionName('Hoofd EN'), false);
  assert.equal(isCapsSectionName(' — '), false);
  assert.equal(isCapsSectionName(''), false);
});

test('BE-53 hulp: de standaardnamen voor de snelkeuze zijn vast en compleet', () => {
  const { DEFAULT_SECTION_NAMES } = require('./menuConcept');
  assert.deepEqual([...DEFAULT_SECTION_NAMES], [
    'Voorgerechten',
    'Tussengerechten',
    'Hoofdgerechten',
    'Bijgerechten',
    'Desserts',
    'Dranken',
    'Lunch',
    'Diner',
    'Kindermenu',
  ]);
  // A quick pick is a normal name the rename rule accepts as it is.
  for (const name of DEFAULT_SECTION_NAMES) {
    assert.equal(name, name.trim());
    assert.equal(name.length <= 160, true, name);
  }
});

