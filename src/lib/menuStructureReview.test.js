'use strict';

// #59 (Delivery Lead review 6307703713) — the human structure review as pure
// logic: which sections must be handled, what the server accepts, and how the
// decisions become concept edits. No fetch, no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  uncertainSections,
  structureUncertain,
  validateStructureReviews,
  structureEdits,
  recordedSections,
  parsePathText,
  reviewKey,
  boundedLocator,
  keepAllChoices,
  sourceLinkOf,
  pdfPageOf,
  safeSourceUrl,
  uncertaintyReason,
  MAX_LOCATOR,
  MAX_SECTION_ITEMS,
} = require('./menuStructureReview');
const { buildMenuConcept, recognisedLines } = require('./menuConcept');

const HASH = 'c'.repeat(64);

// Two menu variants, each with one flagged section, as a receipt stores them:
// the menu title is separate, the category path is relative.
const MENUS = [
  {
    title: 'Fictief Diner',
    structure: 'uncertain',
    categories: [
      {
        name: 'Voor',
        path: ['Voor'],
        sourcePath: ['DINNER', 'VOOR'],
        locator: 'paneel Diner, regel 1',
        uncertain: true,
        items: [
          { name: 'Fictieve burrata', price: '13.00' },
          { name: 'Fictieve soep', price: '8.00' },
        ],
      },
      { name: 'Hoofd', path: ['Hoofd'], sourcePath: ['DINNER', 'HOOFD'], items: [{ name: 'Fictieve zeebaars', price: '24.00' }] },
    ],
  },
  {
    title: 'Fictief Lunch',
    structure: 'uncertain',
    categories: [
      { name: 'Koud', path: ['Koud'], sourcePath: ['LUNCH', 'KOUD'], locator: 'paneel Lunch, regel 1', uncertain: true, items: [{ name: 'Fictieve salade', price: '12.50' }] },
      { name: 'Warm', path: ['Warm'], sourcePath: ['LUNCH', 'WARM'], items: [{ name: 'Fictieve pasta', price: '14.50' }] },
    ],
  },
];

const [VOOR, KOUD] = uncertainSections(MENUS);

function submission(sections) {
  return { receipt_hash: HASH, sections };
}

test('uncertainSections: exactly the flagged sections, with path, source route, locator and items', () => {
  assert.equal(structureUncertain(MENUS), true);
  const sections = uncertainSections(MENUS);
  assert.deepEqual(sections.map((s) => s.label), ['Fictief Diner › Voor', 'Fictief Lunch › Koud']);
  assert.deepEqual(sections.map((s) => s.sourceRoute), ['DINNER › VOOR', 'LUNCH › KOUD']);
  assert.deepEqual(sections.map((s) => s.locator), ['paneel Diner, regel 1', 'paneel Lunch, regel 1']);
  assert.deepEqual(sections.map((s) => s.itemCount), [2, 1]);
  // The keys are the concept's own line paths, not a second interpretation.
  const conceptPaths = new Set(recognisedLines(MENUS).map((line) => reviewKey(line.categoryPath)));
  for (const section of sections) assert.ok(conceptPaths.has(section.key), section.key);
  assert.equal(structureUncertain([{ structure: 'normalized', categories: [] }]), false);
  assert.deepEqual(uncertainSections([{ categories: [{ name: 'Koud', path: ['Koud'], items: [] }] }]), []);
});

test('validation: keeping every uncertain section is accepted, in receipt order', () => {
  const result = validateStructureReviews({
    menus: MENUS,
    receiptHash: HASH,
    submitted: submission([
      { path: ['Fictief Lunch', 'Koud'], action: 'keep' },
      { path: ['Fictief Diner', 'Voor'], action: 'keep' },
    ]),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.sections.map((s) => s.label), ['Fictief Diner › Voor', 'Fictief Lunch › Koud']);
  assert.deepEqual(result.sections.map((s) => s.action), ['keep', 'keep']);
});

test('validation: a single untreated section refuses the whole confirmation', () => {
  const result = validateStructureReviews({
    menus: MENUS,
    receiptHash: HASH,
    submitted: submission([{ path: VOOR.path, action: 'keep' }]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'structure_unreviewed');
  assert.deepEqual(result.missing, ['Fictief Lunch › Koud']);
});

test('validation: an unknown or non-uncertain path is refused, never silently ignored', () => {
  const unknown = validateStructureReviews({
    menus: MENUS,
    receiptHash: HASH,
    submitted: submission([
      { path: VOOR.path, action: 'keep' },
      { path: KOUD.path, action: 'keep' },
      { path: ['Fictief Diner', 'Hoofd'], action: 'keep' },
    ]),
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'structure_unknown_section');
  assert.deepEqual(unknown.unknown, ['Fictief Diner › Hoofd']);
});


test('validation: duplicates, missing sections, invalid actions and invalid corrections are refused', () => {
  const cases = [
    [{ path: VOOR.path, action: 'keep' }, { path: KOUD.path, action: 'keep' }, { path: KOUD.path, action: 'keep' }],
    [],
    [{ path: VOOR.path, action: 'accept' }, { path: KOUD.path, action: 'keep' }],
    [{ path: VOOR.path, action: 'correct' }, { path: KOUD.path, action: 'keep' }],
    [{ path: VOOR.path, action: 'correct', corrected_path: [] }, { path: KOUD.path, action: 'keep' }],
    // "Correcting" to the same path is not a human correction.
    [{ path: VOOR.path, action: 'correct', corrected_path: VOOR.path }, { path: KOUD.path, action: 'keep' }],
    [{ path: [''], action: 'keep' }, { path: KOUD.path, action: 'keep' }],
    [{ path: ['x'.repeat(121)], action: 'keep' }, { path: KOUD.path, action: 'keep' }],
  ];
  for (const sections of cases) {
    const result = validateStructureReviews({ menus: MENUS, receiptHash: HASH, submitted: submission(sections) });
    assert.equal(result.ok, false, JSON.stringify(sections));
    assert.ok(['structure_required', 'structure_invalid'].includes(result.code), `${result.code} for ${JSON.stringify(sections)}`);
  }
});

test('validation: the receipt hash and the stored receipt are the binding, not the client claim', () => {
  const good = [{ path: VOOR.path, action: 'keep' }, { path: KOUD.path, action: 'keep' }];
  assert.equal(validateStructureReviews({ menus: MENUS, receiptHash: HASH, submitted: { sections: good } }).code, 'receipt_mismatch');
  assert.equal(validateStructureReviews({ menus: MENUS, receiptHash: HASH, submitted: { receipt_hash: 'd'.repeat(64), sections: good } }).code, 'receipt_mismatch');
  assert.equal(validateStructureReviews({ menus: MENUS, receiptHash: null, submitted: submission(good) }).code, 'receipt_unavailable');
  assert.equal(validateStructureReviews({ menus: MENUS, receiptHash: HASH, submitted: null }).code, 'structure_required');
  // An uncertain menu without a flagged section has no per-section route.
  const inconsistent = [{ structure: 'uncertain', categories: [{ name: 'Koud', path: ['Koud'], items: [] }] }];
  assert.equal(validateStructureReviews({ menus: inconsistent, receiptHash: HASH, submitted: submission(good) }).code, 'structure_sections_unknown');
});

test('validation: a real correction is accepted and keeps its old → new paths', () => {
  const result = validateStructureReviews({
    menus: MENUS,
    receiptHash: HASH,
    submitted: submission([
      { path: VOOR.path, action: 'keep' },
      { path: KOUD.path, action: 'correct', corrected_path: ['Fictief Lunch', 'Salades'] },
    ]),
  });
  assert.equal(result.ok, true);
  const corrected = result.sections.find((s) => s.action === 'correct');
  assert.deepEqual(corrected.path, ['Fictief Lunch', 'Koud']);
  assert.deepEqual(corrected.correctedPath, ['Fictief Lunch', 'Salades']);
  assert.equal(corrected.sourceRoute, 'LUNCH › KOUD');
});

test('structureEdits + buildMenuConcept: kept sections are accepted, corrected ones move, nothing else changes', () => {
  const sections = [
    { key: VOOR.key, path: VOOR.path, action: 'keep', correctedPath: null },
    { key: KOUD.key, path: KOUD.path, action: 'correct', correctedPath: ['Fictief Lunch', 'Salades'] },
  ];
  const edits = structureEdits(MENUS, sections);
  assert.deepEqual(Object.keys(edits.lines).sort(), ['0.0.0', '0.0.1', '1.0.0']);
  assert.deepEqual(edits.lines['0.0.0'], { acceptCategory: true });
  assert.deepEqual(edits.lines['1.0.0'], { path: ['Fictief Lunch', 'Salades'] });

  const concept = buildMenuConcept({ menus: MENUS, liveLines: [], edits });
  assert.deepEqual(concept.blockers, []);
  assert.equal(concept.canSave, true);
  // Burrata stays under its kept section; the salad moved into the corrected one.
  const categories = concept.content.categories.map((category) => ({ name: category.name, path: category.path || null, items: category.items.map((i) => i.name) }));
  assert.deepEqual(categories, [
    { name: 'Voor', path: ['Fictief Diner', 'Voor'], items: ['Fictieve burrata', 'Fictieve soep'] },
    { name: 'Hoofd', path: ['Fictief Diner', 'Hoofd'], items: ['Fictieve zeebaars'] },
    { name: 'Salades', path: ['Fictief Lunch', 'Salades'], items: ['Fictieve salade'] },
    { name: 'Warm', path: ['Fictief Lunch', 'Warm'], items: ['Fictieve pasta'] },
  ]);
  // The correction is traceable: the kept section keeps its source route, the
  // corrected one does not claim the old route any more.
  assert.deepEqual(concept.content.categories[0].sourcePath, ['DINNER', 'VOOR']);
  assert.equal(concept.content.categories[2].sourcePath, undefined);
});

test('structureEdits: without decisions nothing is accepted (the uncertain blocker stays)', () => {
  const bare = buildMenuConcept({ menus: MENUS, liveLines: [], edits: {} });
  // One blocker per dish in an uncertain section: two in "Voor", one in "Koud".
  assert.equal(bare.blockers.length, 3);
  assert.ok(bare.blockers.every((b) => b.status === 'unclear_category'));
  assert.equal(bare.canSave, false);
  assert.deepEqual(structureEdits(MENUS, []), { lines: {}, removed: null });
});

test('recordedSections: stored rows become review sections; unreadable or contradicting rows are skipped', () => {
  const rows = [
    {
      path_key: VOOR.key,
      original_path: JSON.stringify(VOOR.path),
      source_path: JSON.stringify(['DINNER', 'VOOR']),
      locator: 'paneel Diner, regel 1',
      decision: 'keep',
      corrected_path: null,
      created_at: '2026-10-20T10:00:00Z',
    },
    {
      path_key: KOUD.key,
      original_path: JSON.stringify(KOUD.path),
      source_path: null,
      locator: null,
      decision: 'correct',
      corrected_path: JSON.stringify(['Fictief Lunch', 'Salades']),
      created_at: '2026-10-20T10:01:00Z',
    },
    { path_key: 'x', original_path: 'geen json', decision: 'keep', corrected_path: null },
    // A "correct" row without a new path can never become an acceptance.
    { path_key: 'y', original_path: JSON.stringify(['A']), decision: 'correct', corrected_path: null },
    { path_key: 'z', original_path: JSON.stringify(['B']), decision: 'approve', corrected_path: null },
  ];
  const recorded = recordedSections(rows);
  assert.deepEqual(recorded.map((r) => [r.key, r.action]), [[VOOR.key, 'keep'], [KOUD.key, 'correct']]);
  assert.deepEqual(recorded[1].correctedPath, ['Fictief Lunch', 'Salades']);
  assert.equal(recorded[0].reviewedAt, '2026-10-20T10:00:00Z');
  assert.deepEqual(recordedSections(null), []);
});

test('structureEdits: accepting a section never settles a duplicate or a missing price', () => {
  const menus = [
    {
      title: 'Fictief Lunch',
      structure: 'uncertain',
      categories: [
        {
          name: 'Koud',
          path: ['Koud'],
          uncertain: true,
          items: [
            { name: 'Fictieve soep', price: '6.00' },
            { name: 'Fictieve soep', price: '6.00' },
            { name: 'Fictief brood', price: null },
          ],
        },
      ],
    },
  ];
  const sections = uncertainSections(menus).map((section) => ({ ...section, action: 'keep', correctedPath: null }));
  const concept = buildMenuConcept({ menus, liveLines: [], edits: structureEdits(menus, sections) });
  // "Rubriek klopt zo" settles the section only: the duplicate dishes and the
  // missing price remain blockers (the same rule as the manual line editor).
  assert.deepEqual(concept.blockers.map((b) => b.status).sort(), ['duplicate', 'duplicate', 'missing_price']);
  assert.equal(concept.canSave, false);
});

test('uncertainSections: a locator is trimmed and bounded exactly like the concept shows it', () => {
  const [bounded, empty] = uncertainSections([
    { title: 'Fictief', structure: 'uncertain', categories: [{ name: 'X', path: ['X'], uncertain: true, locator: `  ${'x'.repeat(200)}  `, items: [] }] },
    { title: 'Fictief 2', structure: 'uncertain', categories: [{ name: 'Y', path: ['Y'], uncertain: true, locator: '   ', items: [] }] },
  ]);
  assert.equal(bounded.locator.length, MAX_LOCATOR);
  assert.equal(bounded.locator, 'x'.repeat(MAX_LOCATOR));
  assert.equal(empty.locator, null);
  // A non-text locator is never invented into a value.
  assert.equal(boundedLocator(42), null);
});

test('parsePathText: reviewer input becomes bounded labels, or null', () => {
  assert.deepEqual(parsePathText('Diner › Voorgerechten'), ['Diner', 'Voorgerechten']);
  assert.deepEqual(parsePathText('Diner > Voor > Koud'), ['Diner', 'Voor', 'Koud']);
  assert.deepEqual(parsePathText('  Lunch |  Salades '), ['Lunch', 'Salades']);
  assert.equal(parsePathText(''), null);
  assert.equal(parsePathText('› ›'), null);
  assert.equal(parsePathText('x'.repeat(121)), null);
  assert.equal(parsePathText('a›b›c›d›e›f›g'), null);
});

// ── BE-30 (#72): the reviewer sees the dishes, the reason and the page --------

test('BE-30 criterion 1: every uncertain section carries its dishes with the price from the source', () => {
  const menus = [
    {
      title: 'Fictief Diner',
      structure: 'uncertain',
      sourceUrl: 'https://voorbeeld.example/menukaart.pdf',
      categories: [
        {
          name: 'Voor',
          path: ['Voor'],
          sourcePath: ['DINNER', 'VOOR'],
          locator: 'pdf:3',
          uncertain: true,
          items: [
            { name: 'Fictieve burrata', price: '13.00' },
            { name: 'Fictieve soep', price: null, priceText: '8,00 / 12,00' },
            { name: '   ' },
            null,
            { name: 'Fictieve carpaccio', price: '12.50' },
          ],
        },
      ],
    },
  ];
  const [section] = uncertainSections(menus);
  assert.deepEqual(section.items.map((item) => [item.name, item.price, item.priceText]), [
    ['Fictieve burrata', '13.00', null],
    ['Fictieve soep', null, '8,00 / 12,00'],
    ['Fictieve carpaccio', '12.50', null],
  ]);
  // The ids stay stable per section, so React keys and tests do not shift.
  assert.deepEqual(section.items.map((item) => item.id), ['0.0.0', '0.0.1', '0.0.2']);
  assert.equal(section.itemCount, 3);
  assert.equal(section.reason, 'Kopje anders gelezen dan in de bron ("DINNER › VOOR").');
  assert.deepEqual(section.sourceLink, {
    url: 'https://voorbeeld.example/menukaart.pdf#page=3',
    page: 3,
    text: 'Bekijk pagina 3',
  });
});

test('BE-30 criterion 1: a section list is bounded exactly like the menu control', () => {
  const items = Array.from({ length: MAX_SECTION_ITEMS + 5 }, (_, i) => ({ name: `Fictief gerecht ${i + 1}`, price: '9.50' }));
  const [section] = uncertainSections([
    { title: 'Fictief', structure: 'uncertain', categories: [{ name: 'X', path: ['X'], uncertain: true, items }] },
  ]);
  assert.equal(section.items.length, MAX_SECTION_ITEMS);
  assert.equal(section.itemCount, MAX_SECTION_ITEMS + 5);
});

test('BE-30 criterion 2: "Bekijk pagina N" only for a pdf locator, the plain source URL for a website', () => {
  assert.equal(pdfPageOf('pdf:12:item:2'), 12);
  assert.equal(pdfPageOf('pdf:7'), 7);
  assert.equal(pdfPageOf('paneel Diner, regel 1'), null);
  assert.equal(pdfPageOf('pdf:0'), null);
  assert.equal(pdfPageOf(42), null);

  const url = 'https://voorbeeld.example/menukaart.pdf';
  assert.deepEqual(sourceLinkOf({ sourceUrl: url, locator: 'pdf:2' }), { url: `${url}#page=2`, page: 2, text: 'Bekijk pagina 2' });
  assert.deepEqual(sourceLinkOf({ sourceUrl: 'https://voorbeeld.example/menu', locator: 'paneel Diner, regel 1' }), {
    url: 'https://voorbeeld.example/menu',
    page: null,
    text: 'Bekijk bron',
  });
  // An existing fragment is replaced, never appended twice.
  assert.equal(sourceLinkOf({ sourceUrl: `${url}#page=9`, locator: 'pdf:4' }).url, `${url}#page=4`);
  // No usable address: no link at all, never an invented one.
  assert.equal(sourceLinkOf({ sourceUrl: 'javascript:alert(1)', locator: 'pdf:2' }), null);
  assert.equal(sourceLinkOf({ sourceUrl: 'niet-een-url', locator: 'pdf:2' }), null);
  assert.equal(sourceLinkOf({}), null);
  assert.equal(safeSourceUrl('ftp://voorbeeld.example/menu'), null);
});

test('BE-30 criterion 2: the reason is plain Dutch and only what the analysis knows', () => {
  assert.equal(
    uncertaintyReason({ sourcePath: null, path: ['Koud'], locator: 'paneel Lunch, regel 1' }),
    'Kopje niet herkend in de bron.',
  );
  assert.equal(
    uncertaintyReason({ sourcePath: ['DINNER', 'VOOR'], path: ['Voor'], locator: 'pdf:1' }),
    'Kopje anders gelezen dan in de bron ("DINNER › VOOR").',
  );
  assert.equal(
    uncertaintyReason({ sourcePath: ['Voor'], path: ['Voor'], locator: 'pdf:1' }),
    'De indeling van dit kopje is niet zeker.',
  );
  assert.equal(
    uncertaintyReason({ sourcePath: null, path: ['Koud'], locator: null }),
    'Kopje niet herkend in de bron; vindplaats niet vastgelegd.',
  );
});

test('BE-30 criterion 4: "Alles klopt zo" fills the same keep choices a human would, and nothing else', () => {
  const reviews = uncertainSections(MENUS);
  const choices = keepAllChoices(reviews);
  assert.equal(Object.keys(choices).length, reviews.length);
  for (const section of reviews) {
    assert.deepEqual(choices[section.key], { action: 'keep', text: section.label });
  }
  // The bulk choices are exactly the payload the server accepts.
  const validated = validateStructureReviews({
    menus: MENUS,
    receiptHash: HASH,
    submitted: {
      receipt_hash: HASH,
      sections: Object.entries(choices).map(([, choice]) => ({ path: choice.text.split(' › '), action: choice.action })),
    },
  });
  assert.equal(validated.ok, true, JSON.stringify(validated));
  assert.deepEqual(keepAllChoices(null), {});
  assert.deepEqual(keepAllChoices([{ key: 'x' }]), {});
});
