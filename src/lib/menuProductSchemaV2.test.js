'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MENU_PRODUCT_SCHEMA_VERSION,
  READER_BLOCKED_ACTIONS,
  validateMenuProductV2,
  detectProductSchema,
  readProductRecord,
  quoteContainsAmount,
} = require('./menuProductSchemaV2');

const SOURCES = [{ id: 'src-1', text: 'Fictieve burrata 13,00 Fictieve wijn 6,50 / 25,00 Glas 6,50 Fles 25,00 Extra brood 2,00 Fictieve salade 12,00 Bevat melk' }];

function origins(overrides = {}) {
  return {
    name: 'extracted',
    description: 'unknown',
    price: 'extracted',
    allergens: 'unknown',
    supplementOf: 'unknown',
    availability: 'unknown',
    kind: 'unknown',
    ...overrides,
  };
}

function knownPrice(amount, quote, locator = 'regel 1') {
  return { status: 'known', amountMinorUnits: amount, currency: 'EUR', text: null, isFrom: false, evidence: { sourceId: 'src-1', locator, quote } };
}

function simpleItem(overrides = {}) {
  const evidence = overrides.evidence || { sourceId: 'src-1', locator: 'regel 1', quote: 'Fictieve burrata 13,00' };
  return {
    id: 'item-1',
    kind: 'unknown',
    name: 'Fictieve burrata',
    description: null,
    price: knownPrice(1300, evidence.quote),
    priceVariants: [],
    primaryPriceRef: null,
    supplementOf: null,
    choiceGroupRef: null,
    allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
    dietaryLabels: [],
    availability: null,
    evidence,
    origins: origins(),
    ...overrides,
  };
}

function productWith(items, overrides = {}) {
  return {
    schemaVersion: MENU_PRODUCT_SCHEMA_VERSION,
    menus: [
      {
        id: 'menu-1',
        title: 'Fictief Diner',
        sourceId: 'src-1',
        variant: { id: 'variant-1', label: 'Diner', sourceLabel: 'DINNER', locale: null, location: null, order: 1 },
        categories: [
          {
            id: 'cat-1',
            name: 'Voorgerechten',
            path: ['Diner', 'Voorgerechten'],
            sourcePath: ['DINNER', 'VOOR'],
            kind: 'section',
            choice: null,
            uncertain: false,
            items,
          },
        ],
      },
    ],
    coverage: { status: 'partial', sourcesRead: 1, pagesRead: 1, itemsExtracted: items.length, unreadSources: [], limitations: ['Fictief voorbeeld.'] },
    ...overrides,
  };
}

test('a fully explicit v2 product validates; unknown stays explicit and no trust field exists', () => {
  const product = productWith([simpleItem()]);
  assert.deepEqual(validateMenuProductV2(product, SOURCES), []);
  assert.equal(product.menus[0].categories[0].items[0].allergens.status, 'unknown');
  assert.equal(detectProductSchema(product), 'v2');
});

test('an unknown or missing schema version is a concrete error, never a v1 default', () => {
  const product = productWith([simpleItem()]);
  assert.deepEqual(validateMenuProductV2({ ...product, schemaVersion: 'menu-extraction-product/v3' }, SOURCES), [
    'unsupported_schema_version: expected menu-extraction-product/v2',
  ]);
  const { schemaVersion, ...withoutVersion } = product;
  assert.deepEqual(validateMenuProductV2(withoutVersion, SOURCES), ['unsupported_schema_version: expected menu-extraction-product/v2']);
});

test('forbidden trust keys are rejected at any depth', () => {
  const item = simpleItem();
  item.reviewReady = true;
  const problems = validateMenuProductV2(productWith([item]), SOURCES);
  assert.ok(problems.includes('forbidden trust key: reviewReady'));
});

test('a known price needs its own quote containing the amount (price_evidence_missing)', () => {
  const item = simpleItem({ price: knownPrice(1300, 'Fictieve burrata') });
  const problems = validateMenuProductV2(productWith([item]), SOURCES);
  assert.ok(problems.some((problem) => problem.includes('price_evidence_missing')));
});

test('every price variant needs its own quote containing its own amount', () => {
  const item = simpleItem({
    id: 'item-2',
    kind: 'beverage',
    name: 'Fictieve wijn',
    price: { status: 'multiple_undecomposed', amountMinorUnits: null, currency: null, text: '6,50 / 25,00', isFrom: false, evidence: null },
    priceVariants: [
      { id: 'pv-1', label: 'Glas', kind: 'glass', amountMinorUnits: 650, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Glas 6,50' }, origin: 'extracted' },
      { id: 'pv-2', label: 'Fles', kind: 'bottle', amountMinorUnits: 2500, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Glas 6,50' }, origin: 'extracted' },
    ],
    evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Fictieve wijn 6,50 / 25,00' },
    origins: origins({ price: 'unknown' }),
  });
  const problems = validateMenuProductV2(productWith([item]), SOURCES);
  assert.ok(problems.some((problem) => problem.includes('priceVariants[1].evidence.quote does not contain the claimed amount')));
});

test('a supplement variant can never be the primary price and a primary reference must exist', () => {
  const item = simpleItem({
    id: 'item-2',
    price: { status: 'multiple_undecomposed', amountMinorUnits: null, currency: null, text: '6,50', isFrom: false, evidence: null },
    priceVariants: [{ id: 'pv-1', label: 'Glas', kind: 'glass', amountMinorUnits: 650, currency: 'EUR', text: null, isSupplement: true, perPerson: false, evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Glas 6,50' }, origin: 'extracted' }],
    primaryPriceRef: 'pv-1',
    evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Glas 6,50' },
    origins: origins({ price: 'unknown' }),
  });
  const problems = validateMenuProductV2(productWith([item]), SOURCES);
  assert.ok(problems.some((problem) => problem.includes('must never point at a supplement variant')));

  const missing = simpleItem({ primaryPriceRef: 'pv-404' });
  const missingProblems = validateMenuProductV2(productWith([missing]), SOURCES);
  assert.ok(missingProblems.some((problem) => problem.includes("must reference one of this item's price variants")));
});


test('unresolved supplements need a proven menu/category context and a limitation', () => {
  const supplement = simpleItem({
    id: 'item-2',
    kind: 'supplement',
    name: 'Extra brood',
    price: knownPrice(200, 'Extra brood 2,00'),
    supplementOf: { status: 'unresolved', label: 'Fictieve burrata', context: { menuId: 'menu-1', categoryId: 'cat-1' }, limitation: 'geen expliciete relatie in de bron' },
    evidence: { sourceId: 'src-1', locator: 'regel 3', quote: 'Extra brood 2,00' },
  });
  assert.deepEqual(validateMenuProductV2(productWith([simpleItem(), supplement]), SOURCES), []);

  const wrongContext = {
    ...supplement,
    supplementOf: { ...supplement.supplementOf, context: { menuId: 'menu-1', categoryId: 'cat-404' } },
  };
  const problems = validateMenuProductV2(productWith([simpleItem(), wrongContext]), SOURCES);
  assert.ok(problems.some((problem) => problem.includes('must be the containing category')));

  const noLimitation = { ...supplement, supplementOf: { status: 'unresolved', label: null, context: { menuId: 'menu-1', categoryId: 'cat-1' }, limitation: '' } };
  assert.ok(validateMenuProductV2(productWith([simpleItem(), noLimitation]), SOURCES).some((problem) => problem.includes('limitation must state why')));
});

test('resolved supplement targets must exist, must not be self and must not chain to another supplement', () => {
  const base = simpleItem();
  const targetMissing = simpleItem({ id: 'item-2', kind: 'supplement', name: 'Extra brood', price: knownPrice(200, 'Extra brood 2,00'), supplementOf: { status: 'resolved', itemId: 'item-404' } });
  assert.ok(validateMenuProductV2(productWith([base, targetMissing]), SOURCES).some((problem) => problem.includes('references a missing item')));

  const self = simpleItem({ id: 'item-2', kind: 'supplement', name: 'Extra brood', price: knownPrice(200, 'Extra brood 2,00'), supplementOf: { status: 'resolved', itemId: 'item-2' } });
  assert.ok(validateMenuProductV2(productWith([self]), SOURCES).some((problem) => problem.includes('cannot reference the supplement itself')));

  const first = simpleItem({ id: 'item-2', kind: 'supplement', name: 'Extra brood', price: knownPrice(200, 'Extra brood 2,00'), supplementOf: { status: 'resolved', itemId: 'item-1' } });
  const chained = simpleItem({ id: 'item-3', kind: 'supplement', name: 'Extra boter', price: knownPrice(100, 'Extra boter 1,00'), supplementOf: { status: 'resolved', itemId: 'item-2' }, evidence: { sourceId: 'src-1', locator: 'regel 4', quote: 'Extra boter 1,00' } });
  const problems = validateMenuProductV2(productWith([base, first, chained]), SOURCES);
  assert.ok(problems.some((problem) => problem.includes('must reference a non-supplement item')));
});

test('a choice needs a real choice_group category and valid min/max', () => {
  const product = productWith([simpleItem({ kind: 'choice', choiceGroupRef: 'cat-1' })]);
  assert.ok(validateMenuProductV2(product, SOURCES).some((problem) => problem.includes('must reference a choice_group category')));

  const choiceCategory = productWith([simpleItem({ kind: 'choice', choiceGroupRef: 'cat-1' })]);
  choiceCategory.menus[0].categories[0] = {
    ...choiceCategory.menus[0].categories[0],
    kind: 'choice_group',
    choice: { min: 1, max: 2 },
  };
  assert.deepEqual(validateMenuProductV2(choiceCategory, SOURCES), []);

  choiceCategory.menus[0].categories[0].choice = { min: 3, max: 2 };
  assert.ok(validateMenuProductV2(choiceCategory, SOURCES).some((problem) => problem.includes('min must not exceed max')));
});

test('explicit allergens need codes and a source status; unknown is not an empty claim', () => {
  const explicit = simpleItem({ allergens: { status: 'explicit', codes: ['melk'], sourceText: null, sourceTextStatus: 'not_isolated' } });
  assert.deepEqual(validateMenuProductV2(productWith([explicit]), SOURCES), []);

  const emptyExplicit = simpleItem({ allergens: { status: 'explicit', codes: [], sourceText: null, sourceTextStatus: 'not_isolated' } });
  assert.ok(validateMenuProductV2(productWith([emptyExplicit]), SOURCES).some((problem) => problem.includes('at least one code')));

  const explicitUnknown = simpleItem({ allergens: { status: 'explicit', codes: ['melk'], sourceText: null, sourceTextStatus: 'unknown' } });
  assert.ok(validateMenuProductV2(productWith([explicitUnknown]), SOURCES).some((problem) => problem.includes('"recorded" or "not_isolated"')));

  const recorded = simpleItem({ allergens: { status: 'explicit', codes: ['melk'], sourceText: 'Bevat melk', sourceTextStatus: 'recorded' } });
  assert.deepEqual(validateMenuProductV2(productWith([recorded]), SOURCES), []);

  const outside = simpleItem({ allergens: { status: 'explicit', codes: ['melk'], sourceText: 'Bevat noten', sourceTextStatus: 'recorded' } });
  assert.ok(validateMenuProductV2(productWith([outside]), SOURCES).some((problem) => problem.includes('not present in the cited sources')));

  const unknownWithCodes = simpleItem({ allergens: { status: 'unknown', codes: ['melk'], sourceText: null, sourceTextStatus: 'unknown' } });
  assert.ok(validateMenuProductV2(productWith([unknownWithCodes]), SOURCES).some((problem) => problem.includes('unknown allergens must not carry codes')));
});


test('IDs are unique across menus, categories, items and variants', () => {
  const duplicate = simpleItem({ id: 'item-1' });
  const problems = validateMenuProductV2(productWith([simpleItem(), duplicate]), SOURCES);
  assert.ok(problems.some((problem) => problem.includes('is not unique')));
});

test('coverage cannot claim items it does not contain or an empty success', () => {
  const product = productWith([simpleItem()]);
  product.coverage = { ...product.coverage, itemsExtracted: 2 };
  assert.ok(validateMenuProductV2(product, SOURCES).some((problem) => problem.includes('must equal the number of extracted items')));

  const empty = productWith([], { coverage: { status: 'no_items', sourcesRead: 0, pagesRead: 0, itemsExtracted: 0, unreadSources: [], limitations: [] } });
  assert.deepEqual(validateMenuProductV2(empty, SOURCES), []);

  const emptyAsSuccess = productWith([], { coverage: { status: 'partial', sourcesRead: 0, pagesRead: 0, itemsExtracted: 0, unreadSources: [], limitations: ['geen inhoud'] } });
  assert.ok(validateMenuProductV2(emptyAsSuccess, SOURCES).some((problem) => problem.includes('requires at least one extracted item')));
});

test('quotes must exist in the cited source and the currency is contract-fixed EUR', () => {
  const outside = simpleItem({ evidence: { sourceId: 'src-1', locator: 'regel 1', quote: 'Verzonnen passage 99,00' } });
  assert.ok(validateMenuProductV2(productWith([outside]), SOURCES).some((problem) => problem.includes('is not present in the cited source')));

  const usd = simpleItem({ price: { ...knownPrice(1300, 'Fictieve burrata 13,00'), currency: 'USD' } });
  assert.ok(validateMenuProductV2(productWith([usd]), SOURCES).some((problem) => problem.includes('currency must be EUR')));
});

test('amount matching is conservative and does not accept a different price', () => {
  assert.equal(quoteContainsAmount('Fictieve burrata 13,00', 1300), true);
  assert.equal(quoteContainsAmount('Fictieve burrata 113,00', 1300), false);
  assert.equal(quoteContainsAmount('Glas 6,5', 650), true);
  assert.equal(quoteContainsAmount('Fles 25,00', 2500), true);
  assert.equal(quoteContainsAmount('Fles 125,00', 2500), false);
});

test('the reader classifies v1, v2 and unknown versions without reinterpreting v2 as v1', () => {
  const v2 = productWith([simpleItem()]);
  const readV2 = readProductRecord(v2, SOURCES);
  assert.equal(readV2.status, 'v2');
  assert.equal(readV2.ok, true);
  assert.deepEqual(readV2.blockedActions, []);

  const v1 = { menus: [] };
  const readV1 = readProductRecord(v1);
  assert.equal(readV1.status, 'v1');
  assert.equal(readV1.value, v1);

  const unknown = { schemaVersion: 'menu-extraction-product/v3', menus: [], raw: 'bewaard' };
  const readUnknown = readProductRecord(unknown);
  assert.equal(readUnknown.status, 'unsupported_schema_version');
  assert.equal(readUnknown.ok, false);
  assert.equal(readUnknown.preservedRaw, unknown);
  assert.deepEqual(readUnknown.blockedActions, READER_BLOCKED_ACTIONS);

  const invalid = { ...v2, coverage: undefined };
  const readInvalid = readProductRecord(invalid, SOURCES);
  assert.equal(readInvalid.status, 'invalid');
  assert.equal(readInvalid.preservedRaw, invalid);
  assert.deepEqual(readInvalid.blockedActions, READER_BLOCKED_ACTIONS);
});


test('price-variant IDs share the same uniqueness rule as every other ID', () => {
  const item = simpleItem({
    id: 'item-2',
    price: { status: 'multiple_undecomposed', amountMinorUnits: null, currency: null, text: '6,50 / 25,00', isFrom: false, evidence: null },
    priceVariants: [
      { id: 'pv-1', label: 'Glas', kind: 'glass', amountMinorUnits: 650, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Glas 6,50' }, origin: 'extracted' },
      { id: 'pv-1', label: 'Fles', kind: 'bottle', amountMinorUnits: 2500, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Fles 25,00' }, origin: 'extracted' },
    ],
    evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Fictieve wijn 6,50 / 25,00' },
    origins: origins({ price: 'unknown' }),
  });
  const problems = validateMenuProductV2(productWith([item]), SOURCES);
  assert.ok(problems.some((problem) => problem.includes('priceVariants[1].id "pv-1" is not unique')));
});

test('a legacy row with a forbidden trust key is refused by the reader, not accepted as v1', () => {
  const legacy = { menus: [], reviewReady: true };
  const read = readProductRecord(legacy);
  assert.equal(read.status, 'invalid');
  assert.equal(read.preservedRaw, legacy);
  assert.ok(read.problems.includes('forbidden trust key: reviewReady'));
  assert.deepEqual(read.blockedActions, READER_BLOCKED_ACTIONS);
});

