'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateMenuProductV2 } = require('./menuProductSchemaV2');
const {
  mapV1ToProductV2,
  projectProductV2ToV1,
  checkProductV2ExportSuitability,
} = require('./menuProductMappingV2');
const { mapStructuredOutputToMenuContexts } = require('./menuExtractionMapping');

const SOURCES = [
  {
    id: 'src-1',
    text: [
      'Fictieve burrata 13,00',
      'Fictieve wijn 6,50 / 25,00',
      'Extra brood 2,50',
      'Fictieve proeverij vanaf 35,00',
      'Fictieve salade 12,00',
      'Fictieve mousse 8,00',
      'Fictieve soep 6,50',
    ].join(' | '),
  },
];

const WRONG_AMOUNT_SOURCES = [
  {
    id: 'src-1',
    text: [
      SOURCES[0].text,
      'Fictief gerecht 13,50',
      'Fictief gerecht 13',
      'Fictieve wijn 13,50 / 25,00',
      'Fictieve wijn 13,5 / 25,00',
    ].join(' | '),
  },
];

function evidence(quote, locator = 'regel 1') {
  return { sourceId: 'src-1', locator, quote };
}

function v1Output() {
  return {
    menus: [
      {
        title: 'Fictief Diner',
        sourceId: 'src-1',
        variant: 'DINNER',
        order: 1,
        categories: [
          {
            name: 'Voorgerechten',
            path: ['DINNER', 'VOOR'],
            items: [
              { name: 'Fictieve burrata', description: 'Fictieve omschrijving', priceStatus: 'known', amountMinorUnits: 1300, currency: 'EUR', priceText: '13,00', evidence: evidence('Fictieve burrata 13,00') },
              {
                name: 'Fictieve wijn',
                priceStatus: 'multiple_undecomposed',
                priceText: '6,50 / 25,00',
                priceVariants: [
                  { label: 'Glas', amountMinorUnits: 650, currency: 'EUR' },
                  { label: 'Fles', amountMinorUnits: 2500, currency: 'EUR' },
                ],
                evidence: evidence('Fictieve wijn 6,50 / 25,00', 'regel 2'),
              },
              { name: 'Extra brood', priceStatus: 'known', amountMinorUnits: 250, currency: 'EUR', supplementOf: 'Fictieve burrata', evidence: evidence('Extra brood 2,50', 'regel 3') },
              { name: 'Fictieve proeverij', priceStatus: 'known', amountMinorUnits: 3500, currency: 'EUR', isFrom: true, evidence: evidence('Fictieve proeverij vanaf 35,00', 'regel 4') },
              { name: 'Fictieve salade', priceStatus: 'known', amountMinorUnits: 1200, currency: 'EUR', allergens: { status: 'explicit', values: ['melk'] }, evidence: evidence('Fictieve salade 12,00', 'regel 5') },
            ],
          },
          {
            name: 'Nagerechten',
            path: ['DINNER', 'NA'],
            items: [
              { name: 'Fictieve mousse', priceStatus: 'known', amountMinorUnits: 800, currency: 'EUR', allergens: { status: 'unknown', values: [] }, evidence: evidence('Fictieve mousse 8,00', 'regel 6') },
            ],
          },
        ],
      },
      {
        title: 'Fictief Lunch',
        sourceId: 'src-1',
        variant: 'LUNCH',
        order: 2,
        categories: [
          {
            name: 'Soepen',
            path: ['LUNCH', 'SOEP'],
            items: [
              { name: 'Fictieve soep', priceStatus: 'known', amountMinorUnits: 650, currency: 'EUR', evidence: evidence('Fictieve soep 6,50', 'regel 7') },
            ],
          },
        ],
      },
    ],
    coverage: {
      status: 'partial',
      sourcesRead: 1,
      pagesRead: 2,
      itemsExtracted: 7,
      unreadSources: [],
      limitations: ['Eén pagina was onleesbaar.'],
    },
  };
}

function mapped() {
  const result = mapV1ToProductV2(v1Output(), SOURCES);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  return result.value;
}

function itemOutput(item) {
  return {
    menus: [
      {
        title: 'Fictief Diner',
        sourceId: 'src-1',
        variant: 'DINNER',
        order: 1,
        categories: [
          { name: 'Voorgerechten', path: ['DINNER', 'VOOR'], items: [item] },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  };
}

test('v1 maps to complete v2 objects with variants, from-prices, supplements and explicit unknowns', () => {
  const value = mapped();
  assert.equal(value.schemaVersion, 'menu-extraction-product/v2');
  assert.deepEqual(validateMenuProductV2(value, SOURCES), []);
  assert.equal(value.menus.length, 2);
  assert.equal(value.menus[0].variant.label, 'DINNER');
  assert.equal(value.menus[0].variant.sourceLabel, 'DINNER');
  assert.equal(value.menus[0].variant.order, 1);
  assert.equal(value.menus[0].categories[0].sourcePath, null);
  assert.equal(value.menus[0].categories[0].kind, 'section');

  const items = value.menus[0].categories[0].items;
  assert.equal(items[0].kind, 'unknown');
  assert.equal(items[0].price.status, 'known');
  assert.equal(items[0].origins.name, 'extracted');
  assert.equal(items[1].price.status, 'multiple_undecomposed');
  assert.deepEqual(items[1].priceVariants.map((v) => [v.label, v.kind, v.amountMinorUnits]), [['Glas', 'glass', 650], ['Fles', 'bottle', 2500]]);
  assert.equal(items[1].primaryPriceRef, null);
  assert.equal(items[2].kind, 'supplement');
  assert.equal(items[2].supplementOf.status, 'unresolved');
  assert.deepEqual(items[2].supplementOf.context, { menuId: 'menu-1', categoryId: 'cat-1' });
  assert.equal(items[3].price.status, 'from');
  assert.equal(items[3].price.isFrom, true);
  assert.deepEqual(items[4].allergens, { status: 'explicit', codes: ['melk'], sourceText: null, sourceTextStatus: 'not_isolated' });
  assert.deepEqual(value.menus[0].categories[1].items[0].allergens, { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' });
  assert.equal(value.coverage.itemsExtracted, 7);

  const ids = new Set();
  for (const menu of value.menus) {
    ids.add(menu.id);
    ids.add(menu.variant.id);
    for (const category of menu.categories) {
      ids.add(category.id);
      for (const item of category.items) {
        ids.add(item.id);
        for (const variant of item.priceVariants) ids.add(variant.id);
      }
    }
  }
  assert.equal(ids.size, 2 + 2 + 3 + 7 + 2);
});

test('the v2 to v1 projection is content-lossless for everything v1 can carry', () => {
  const original = v1Output();
  const projected = projectProductV2ToV1(mapped(), { sources: SOURCES });
  assert.equal(projected.ok, true, JSON.stringify(projected.blockers));
  assert.equal(projected.value.menus.length, original.menus.length);
  original.menus.forEach((menu, m) => {
    const outMenu = projected.value.menus[m];
    assert.equal(outMenu.title, menu.title);
    assert.equal(outMenu.sourceId, menu.sourceId);
    assert.equal(outMenu.variant, menu.variant);
    assert.equal(outMenu.order, menu.order);
    menu.categories.forEach((category, c) => {
      const outCategory = outMenu.categories[c];
      assert.equal(outCategory.name, category.name);
      assert.deepEqual(outCategory.path, category.path);
      assert.equal('uncertain' in outCategory, false);
      category.items.forEach((item, i) => {
        const out = outCategory.items[i];
        assert.equal(out.name, item.name);
        assert.equal(out.description, item.description);
        assert.equal(out.priceStatus, item.priceStatus);
        assert.equal(out.amountMinorUnits, item.amountMinorUnits);
        assert.equal(out.currency, item.currency);
        assert.equal(out.priceText, item.priceText);
        assert.equal(out.isFrom, item.isFrom);
        assert.equal(out.supplementOf, item.supplementOf);
        assert.deepEqual(out.evidence, item.evidence);
        if (item.priceVariants) assert.deepEqual(out.priceVariants, item.priceVariants);
        if (item.allergens && item.allergens.status === 'explicit') assert.deepEqual(out.allergens, item.allergens);
        if (item.allergens && item.allergens.status === 'unknown') assert.equal('allergens' in out, false);
      });
    });
  });
  assert.deepEqual(projected.value.coverage, original.coverage);
});


test('a projection that would lose an explicit primary price refuses instead of choosing one', () => {
  const value = mapped();
  value.menus[0].categories[0].items[1].primaryPriceRef = 'pv-1';
  assert.deepEqual(validateMenuProductV2(value, SOURCES), []);
  const projected = projectProductV2ToV1(value, { sources: SOURCES });
  assert.equal(projected.ok, false);
  assert.equal(projected.reason, 'unsupported_v1_projection');
  assert.ok(projected.blockers.some((blocker) => blocker.code === 'primary_price_not_representable'));
  assert.equal(projected.preservedInput, value);
});

test('a projection refuses any construct or metadata v1 would silently lose', () => {
  const cases = [
    ['item kind', (value) => { value.menus[0].categories[0].items[0].kind = 'dish'; }, 'unsupported_item_kind'],
    ['dietary labels', (value) => { value.menus[0].categories[0].items[0].dietaryLabels = ['vegetarisch']; }, 'dietary_labels_not_representable'],
    ['menu locale', (value) => { value.menus[0].variant.locale = 'nl'; }, 'menu_variant_metadata_not_representable'],
    ['allergen passage', (value) => {
      value.menus[0].categories[0].items[4].allergens = { status: 'explicit', codes: ['melk'], sourceText: 'Fictieve salade 12,00', sourceTextStatus: 'recorded' };
    }, 'allergen_source_text_not_representable'],
    ['price evidence', (value) => {
      value.menus[0].categories[0].items[0].price.evidence = { sourceId: 'src-1', locator: 'regel 9', quote: 'Fictieve burrata 13,00' };
    }, 'price_evidence_not_representable'],
  ];
  for (const [name, mutate, code] of cases) {
    const value = mapped();
    mutate(value);
    assert.deepEqual(validateMenuProductV2(value, SOURCES), [], name);
    const projected = projectProductV2ToV1(value, { sources: SOURCES });
    assert.equal(projected.ok, false, name);
    assert.ok(projected.blockers.some((blocker) => blocker.code === code), `${name}: ${JSON.stringify(projected.blockers)}`);
  }
});

test('the export guard never treats a v2 menu as a lossless data/menus.json export', () => {
  const value = mapped();
  const guard = checkProductV2ExportSuitability(value, { sources: SOURCES });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, 'unsupported_export_construct');
  assert.ok(guard.blockers.some((blocker) => blocker.code === 'allergen_status_not_exportable'));
  assert.ok(guard.blockers.some((blocker) => blocker.code === 'price_variants_not_exportable'));
  assert.ok(guard.blockers.some((blocker) => blocker.code === 'price_status_not_exportable'));
  assert.ok(guard.blockers.some((blocker) => blocker.code === 'supplement_relation_not_exportable'));
  assert.equal('value' in guard, false);
});

test('zero extracted items stay an explicit no_items result and are never an export success', () => {
  const emptyV1 = {
    menus: [],
    coverage: { status: 'no_items', sourcesRead: 0, pagesRead: 0, itemsExtracted: 0, unreadSources: [], limitations: [] },
  };
  const result = mapV1ToProductV2(emptyV1, []);
  assert.equal(result.ok, true);
  assert.deepEqual(validateMenuProductV2(result.value, []), []);
  assert.equal(result.value.coverage.status, 'no_items');

  const projected = projectProductV2ToV1(result.value, { sources: [] });
  assert.equal(projected.ok, true);
  assert.deepEqual(projected.value.menus, []);

  const guard = checkProductV2ExportSuitability(result.value);
  assert.equal(guard.ok, false);
  assert.ok(guard.blockers.some((blocker) => blocker.code === 'empty_menu'));
});


test('a v1 variant without its own amount in the item quote refuses the whole mapping', () => {
  const output = v1Output();
  output.menus[0].categories[0].items[1].evidence = evidence('Fictieve wijn', 'regel 2');
  const result = mapV1ToProductV2(output, SOURCES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'price_evidence_missing');
  assert.ok(result.blockers.some((blocker) => blocker.path.includes('priceVariants[0]')));
  assert.equal(result.preservedInput, output);
});

test('a known v1 price whose quote only names the dish is refused, not given a copied amount', () => {
  const output = v1Output();
  output.menus[0].categories[0].items[0].evidence = evidence('Fictieve burrata');
  const result = mapV1ToProductV2(output, SOURCES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'price_evidence_missing');
  assert.equal(result.preservedInput, output);
});

test('v1 to v2 refuses a primary price proven only by a different decimal amount', () => {
  const output = v1Output();
  output.menus[0].categories[0].items[0].evidence = evidence('Fictief gerecht 13,50');
  const result = mapV1ToProductV2(output, WRONG_AMOUNT_SOURCES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'price_evidence_missing');
  assert.ok(result.blockers.some((blocker) => blocker.path === 'menus[0].categories[0].items[0].price.evidence'));
  assert.equal(result.preservedInput, output);

  const integer = v1Output();
  integer.menus[0].categories[0].items[0].evidence = evidence('Fictief gerecht 13');
  const integerResult = mapV1ToProductV2(integer, WRONG_AMOUNT_SOURCES);
  assert.equal(integerResult.ok, true, JSON.stringify(integerResult.problems));
  assert.equal(integerResult.value.menus[0].categories[0].items[0].price.amountMinorUnits, 1300);
  assert.equal(integerResult.value.menus[0].categories[0].items[0].price.evidence.quote, 'Fictief gerecht 13');
});

test('the reviewed one-item complete 13,50 quote cannot prove a 13,00 primary price', () => {
  const sources = [{ id: 'src-1', text: 'Fictief gerecht 13,50' }];
  const output = {
    menus: [
      {
        title: 'Fictief Diner',
        sourceId: 'src-1',
        variant: 'DINNER',
        order: 1,
        categories: [
          {
            name: 'Voorgerechten',
            path: ['DINNER', 'VOOR'],
            items: [
              { name: 'Fictief gerecht', priceStatus: 'known', amountMinorUnits: 1300, currency: 'EUR', priceText: '13,50', evidence: evidence('Fictief gerecht 13,50') },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  };
  const result = mapV1ToProductV2(output, sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'price_evidence_missing');
  assert.equal(result.preservedInput, output);
});

test('v1 to v2 refuses a whole-euro 50,00 claim proven only by a leading decimal', () => {
  const sources = [{ id: 'src-1', text: 'Fictief gerecht EUR .50 | Fictief gerecht EUR ,50' }];
  for (const quote of ['Fictief gerecht EUR .50', 'Fictief gerecht EUR ,50']) {
    const output = itemOutput({
      name: 'Fictief gerecht',
      priceStatus: 'known',
      amountMinorUnits: 5000,
      currency: 'EUR',
      priceText: '.50',
      evidence: evidence(quote),
    });
    const result = mapV1ToProductV2(output, sources);
    assert.equal(result.ok, false, quote);
    assert.equal(result.reason, 'price_evidence_missing', quote);
    assert.ok(result.blockers.some((blocker) => blocker.path === 'menus[0].categories[0].items[0].price.evidence'), quote);
    assert.equal(result.preservedInput, output, quote);
  }
});

test('v1 to v2 refuses signed prices and a signed glass variant while unsigned amounts keep working', () => {
  const sources = [{
    id: 'src-1',
    text: 'Fictief gerecht - EUR 13,50 | Fictief gerecht -€ 13,50 | Fictieve wijn - € 6,50 / 25,00 | Fictieve wijn 6,50 / 25,00',
  }];
  for (const quote of ['Fictief gerecht - EUR 13,50', 'Fictief gerecht -€ 13,50']) {
    const output = itemOutput({
      name: 'Fictief gerecht',
      priceStatus: 'known',
      amountMinorUnits: 1350,
      currency: 'EUR',
      priceText: quote.slice(-5),
      evidence: evidence(quote),
    });
    const result = mapV1ToProductV2(output, sources);
    assert.equal(result.ok, false, quote);
    assert.equal(result.reason, 'price_evidence_missing', quote);
    assert.ok(result.blockers.some((blocker) => blocker.path === 'menus[0].categories[0].items[0].price.evidence'), quote);
    assert.equal(result.preservedInput, output, quote);
  }

  const signedWine = itemOutput({
    name: 'Fictieve wijn',
    priceStatus: 'multiple_undecomposed',
    priceText: '- € 6,50 / 25,00',
    priceVariants: [
      { label: 'Glas', amountMinorUnits: 650, currency: 'EUR' },
      { label: 'Fles', amountMinorUnits: 2500, currency: 'EUR' },
    ],
    evidence: evidence('Fictieve wijn - € 6,50 / 25,00'),
  });
  const refused = mapV1ToProductV2(signedWine, sources);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'price_evidence_missing');
  assert.ok(refused.blockers.some((blocker) => blocker.path === 'menus[0].categories[0].items[0].priceVariants[0].evidence'));
  assert.equal(refused.preservedInput, signedWine);

  const unsignedWine = itemOutput({
    name: 'Fictieve wijn',
    priceStatus: 'multiple_undecomposed',
    priceText: '6,50 / 25,00',
    priceVariants: [
      { label: 'Glas', amountMinorUnits: 650, currency: 'EUR' },
      { label: 'Fles', amountMinorUnits: 2500, currency: 'EUR' },
    ],
    evidence: evidence('Fictieve wijn 6,50 / 25,00'),
  });
  const accepted = mapV1ToProductV2(unsignedWine, sources);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.problems));
  assert.deepEqual(
    accepted.value.menus[0].categories[0].items[0].priceVariants.map((variant) => [variant.label, variant.amountMinorUnits]),
    [['Glas', 650], ['Fles', 2500]],
  );
});

test('v1 to v2 refuses a glass amount proven only by a leading decimal', () => {
  const sources = [{ id: 'src-1', text: 'Fictieve wijn EUR .50 / 25,00' }];
  const output = itemOutput({
    name: 'Fictieve wijn',
    priceStatus: 'multiple_undecomposed',
    priceText: 'EUR .50 / 25,00',
    priceVariants: [
      { label: 'Glas', amountMinorUnits: 5000, currency: 'EUR' },
      { label: 'Fles', amountMinorUnits: 2500, currency: 'EUR' },
    ],
    evidence: evidence('Fictieve wijn EUR .50 / 25,00'),
  });
  const result = mapV1ToProductV2(output, sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'price_evidence_missing');
  assert.ok(result.blockers.some((blocker) => blocker.path === 'menus[0].categories[0].items[0].priceVariants[0].evidence'));
  assert.equal(result.preservedInput, output);
});

test('v1 to v2 refuses a glass variant proven by the bottle amount but keeps a correct decimal pair', () => {
  const wrong = v1Output();
  const wrongWine = wrong.menus[0].categories[0].items[1];
  wrongWine.evidence = evidence('Fictieve wijn 13,50 / 25,00');
  wrongWine.priceText = '13,50 / 25,00';
  wrongWine.priceVariants[0].amountMinorUnits = 1300;
  const refused = mapV1ToProductV2(wrong, WRONG_AMOUNT_SOURCES);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'price_evidence_missing');
  assert.ok(refused.blockers.some((blocker) => blocker.path === 'menus[0].categories[0].items[1].priceVariants[0].evidence'));

  const correct = v1Output();
  const correctWine = correct.menus[0].categories[0].items[1];
  correctWine.evidence = evidence('Fictieve wijn 13,5 / 25,00');
  correctWine.priceText = '13,5 / 25,00';
  correctWine.priceVariants[0].amountMinorUnits = 1350;
  const accepted = mapV1ToProductV2(correct, WRONG_AMOUNT_SOURCES);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.problems));
  const variants = accepted.value.menus[0].categories[0].items[1].priceVariants;
  assert.deepEqual(variants.map((variant) => [variant.label, variant.amountMinorUnits]), [['Glas', 1350], ['Fles', 2500]]);
});

test('an unknown version, an invalid v1 result and a foreign quote are refused concretely', () => {
  const v2 = mapped();
  const wrongVersion = mapV1ToProductV2({ ...v1Output(), schemaVersion: 'menu-extraction-product/v2' }, SOURCES);
  assert.equal(wrongVersion.ok, false);
  assert.equal(wrongVersion.reason, 'unsupported_schema_version');
  assert.equal(wrongVersion.preservedInput.schemaVersion, 'menu-extraction-product/v2');

  const untrusted = v1Output();
  untrusted.menus[0].categories[0].items[0].reviewReady = true;
  const invalid = mapV1ToProductV2(untrusted, SOURCES);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid_v1_output');
  assert.ok(invalid.problems.some((problem) => problem.includes('forbidden trust key')));

  const foreignQuote = v1Output();
  foreignQuote.menus[0].categories[0].items[0].evidence = evidence('Verzonnen passage 13,00');
  const foreign = mapV1ToProductV2(foreignQuote, SOURCES);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, 'invalid_v1_output');
  assert.ok(foreign.problems.some((problem) => problem.includes('not present in the cited source')));

  assert.equal(validateMenuProductV2(v2, SOURCES).length, 0);
});

test('the legacy v1 reader refuses a v2 envelope instead of reinterpreting it as v1', () => {
  assert.throws(
    () => mapStructuredOutputToMenuContexts(mapped(), SOURCES),
    /unsupported_schema_version: menu-extraction-product\/v2 requires a compatible reader/,
  );
});

test('manual field origins are explicit in v2; unknown origins are rejected and a lossy projection refuses', () => {
  const value = mapped();
  value.menus[0].categories[0].items[0].origins.price = 'manual';
  assert.deepEqual(validateMenuProductV2(value, SOURCES), []);
  const projected = projectProductV2ToV1(value, { sources: SOURCES });
  assert.equal(projected.ok, false, 'v1 cannot carry the manual/extracted distinction');
  assert.ok(projected.blockers.some((blocker) => blocker.code === 'origin_not_representable'));

  value.menus[0].categories[0].items[0].origins.price = 'guessed';
  assert.ok(validateMenuProductV2(value, SOURCES).some((problem) => problem.includes('origins.price is invalid')));
});


test('an explicit v1 version marker is accepted without leaking into v2', () => {
  const result = mapV1ToProductV2({ ...v1Output(), schemaVersion: 'menu-extraction-output/v1' }, SOURCES);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.value.schemaVersion, 'menu-extraction-product/v2');
  assert.equal('schemaVersion' in result.value.menus[0], false);
});

test('a resolved supplement relation is valid v2 and refuses the legacy projection', () => {
  const value = mapped();
  const supplement = value.menus[0].categories[0].items[2];
  supplement.supplementOf = { status: 'resolved', itemId: 'item-1' };
  assert.deepEqual(validateMenuProductV2(value, SOURCES), []);
  const projected = projectProductV2ToV1(value, { sources: SOURCES });
  assert.ok(projected.blockers.some((blocker) => blocker.code === 'resolved_supplement_not_representable'));
});

test('an arrangement stays validated and opaque, but is neither exportable nor v1-projectable', () => {
  const value = mapped();
  value.menus[0].categories[0].items[0].kind = 'arrangement';
  assert.deepEqual(validateMenuProductV2(value, SOURCES), []);
  const guard = checkProductV2ExportSuitability(value, { sources: SOURCES });
  assert.ok(guard.blockers.some((blocker) => blocker.code === 'item_kind_not_exportable'));
  const projected = projectProductV2ToV1(value, { sources: SOURCES });
  assert.ok(projected.blockers.some((blocker) => blocker.code === 'unsupported_item_kind'));
});


test('a separate source path is refused because v1 can only carry one path', () => {
  const value = mapped();
  value.menus[0].categories[0].sourcePath = [...value.menus[0].categories[0].path];
  assert.deepEqual(validateMenuProductV2(value, SOURCES), []);
  const projected = projectProductV2ToV1(value, { sources: SOURCES });
  assert.equal(projected.ok, false);
  assert.ok(projected.blockers.some((blocker) => blocker.code === 'category_source_path_not_representable'));
});

