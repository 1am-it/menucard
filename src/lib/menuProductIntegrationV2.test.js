'use strict';

// Read-only v2 integration guards: fixture-driven tests proving that a v2
// envelope is shown version-faithfully, that structural validity is not
// source verification, and that unknown/invalid versions never fall back to
// v1. No network, database, provider or credential is involved.

const test = require('node:test');
const assert = require('node:assert/strict');

const { MENU_PRODUCT_SCHEMA_VERSION } = require('./menuProductSchemaV2');
const {
  RECEIPT_PRODUCT_KEY,
  PRODUCT_READ_ONLY_MESSAGE,
  SOURCE_UNVERIFIED_MESSAGE,
  readReceiptProduct,
  readReceiptProjection,
  readConceptProduct,
  isUnsupportedConceptEnvelope,
  assertLegacyConceptContent,
  summarizeProductMenu,
  productActionRefusal,
  cleanText,
} = require('./menuProductIntegrationV2');

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

function price(amount, quote) {
  return { status: 'known', amountMinorUnits: amount, currency: 'EUR', text: null, isFrom: false, evidence: { sourceId: 'src-1', locator: 'regel 1', quote } };
}

function fixtureProduct() {
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
            items: [
              {
                id: 'item-1',
                kind: 'dish',
                name: 'Fictieve burrata',
                description: 'Met fictieve tomaten',
                price: price(1300, 'Fictieve burrata 13,00'),
                priceVariants: [],
                primaryPriceRef: null,
                supplementOf: null,
                choiceGroupRef: null,
                allergens: { status: 'explicit', codes: ['melk'], sourceText: 'Bevat melk', sourceTextStatus: 'recorded' },
                dietaryLabels: [],
                availability: null,
                evidence: { sourceId: 'src-1', locator: 'regel 1', quote: 'Fictieve burrata 13,00' },
                origins: origins({ allergens: 'extracted' }),
              },
              {
                id: 'item-2',
                kind: 'beverage',
                name: 'Fictieve wijn',
                description: null,
                price: { status: 'multiple_undecomposed', amountMinorUnits: null, currency: null, text: 'Glas 6,50 / Fles 25,00', isFrom: false, evidence: null },
                priceVariants: [
                  { id: 'pv-1', label: 'Glas', kind: 'glass', amountMinorUnits: 650, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' }, origin: 'extracted' },
                  { id: 'pv-2', label: 'Fles', kind: 'bottle', amountMinorUnits: 2500, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' }, origin: 'extracted' },
                ],
                primaryPriceRef: null,
                supplementOf: null,
                choiceGroupRef: null,
                allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
                dietaryLabels: [],
                availability: null,
                evidence: { sourceId: 'src-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' },
                origins: origins({ price: 'unknown' }),
              },
              {
                id: 'item-3',
                kind: 'supplement',
                name: 'Extra brood',
                description: null,
                price: price(200, 'Extra brood 2,00'),
                priceVariants: [],
                primaryPriceRef: null,
                supplementOf: { status: 'unresolved', label: 'Bij de maaltijd', context: { menuId: 'menu-1', categoryId: 'cat-1' }, limitation: 'Geen expliciet doelitem in de bron.' },
                choiceGroupRef: null,
                allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
                dietaryLabels: [],
                availability: null,
                evidence: { sourceId: 'src-1', locator: 'regel 3', quote: 'Extra brood 2,00' },
                origins: origins({ supplementOf: 'extracted' }),
              },
            ],
          },
        ],
      },
    ],
    rejected: [{ sourceId: 'src-1', locator: 'regel 9', reason: 'unreadable', text: 'Onleesbare regel' }],
    coverage: { status: 'partial', sourcesRead: 1, pagesRead: 1, itemsExtracted: 3, unreadSources: [{ sourceId: 'src-1', locator: 'pagina 2', reason: 'unreadable' }], limitations: ['Fictieve beperking.'] },
  };
}

test('a structurally valid v2 envelope is shown read-only with variants and supplements intact', () => {
  const info = readConceptProduct(fixtureProduct());
  assert.equal(info.kind, 'v2');
  assert.equal(info.view.readOnly, true);
  assert.equal(info.view.sourceVerification, 'unverified');
  assert.deepEqual(info.view.blockedActions, ['save', 'confirm', 'export', 'publish']);
  assert.ok(info.view.blockers.some((blocker) => blocker.code === 'product_v2_read_only' && blocker.label === PRODUCT_READ_ONLY_MESSAGE));
  assert.ok(info.view.blockers.some((blocker) => blocker.code === 'source_not_verified' && blocker.label === SOURCE_UNVERIFIED_MESSAGE));
  assert.deepEqual(info.view.counts, { menus: 1, categories: 1, items: 3, priceVariants: 2, supplements: 1 });

  const [menu] = info.view.menus;
  assert.equal(menu.variant.label, 'Diner');
  assert.equal(menu.variant.sourceLabel, 'DINNER');
  assert.deepEqual(menu.categories[0].path, ['Diner', 'Voorgerechten']);

  const wine = menu.categories[0].items[1];
  assert.equal(wine.price.status, 'multiple_undecomposed');
  assert.equal(wine.price.display, null, 'a decomposed multiple price is never flattened to one amount');
  assert.equal(wine.primaryPriceRef, null);
  assert.deepEqual(wine.priceVariants.map((variant) => [variant.label, variant.kind, variant.display]), [['Glas', 'glass', '€ 6,50'], ['Fles', 'bottle', '€ 25,00']]);

  const supplement = menu.categories[0].items[2];
  assert.equal(supplement.kind, 'supplement');
  assert.equal(supplement.supplementOf.status, 'unresolved');
  assert.equal(supplement.supplementOf.label, 'Bij de maaltijd');
  assert.deepEqual(supplement.supplementOf.context, { menuId: 'menu-1', categoryId: 'cat-1' });
  assert.ok(info.view.notes.some((note) => note.code === 'supplement_target_unresolved'));
  assert.ok(info.view.notes.some((note) => note.code === 'primary_price_not_chosen'));
  assert.equal(menu.categories[0].items[0].allergens.codes[0], 'melk');
});

test('a receipt keeps v2 authoritative next to an older v1 menus projection', () => {
  const info = readReceiptProduct({ menus: [{ categories: [] }], [RECEIPT_PRODUCT_KEY]: fixtureProduct() });
  assert.equal(info.kind, 'v2');
  assert.equal(info.legacyMenusPresent, true);
  assert.equal(info.view.counts.items, 3);
  const summary = summarizeProductMenu(info.view);
  assert.equal(summary.itemCount, 3);
  assert.equal(summary.categoryCount, 1);
  assert.equal(summary.priceVariantCount, 2);
  assert.equal(summary.supplementCount, 1);
  assert.deepEqual(summary.variantLabels, ['Diner']);
  assert.deepEqual(summary.categories, [], 'the v2 view is rendered by ProductReview, not the v1 section list');
});

test('a missing receipt key or a PostgREST null projection stays legacy v1', () => {
  assert.equal(readReceiptProduct({ menus: [] }).kind, 'v1');
  assert.equal(readReceiptProduct({ menus: [], [RECEIPT_PRODUCT_KEY]: null }).kind, 'v1');
  assert.equal(readReceiptProjection({ menus: [], product: null }).kind, 'v1');
  assert.equal(readReceiptProjection(null).kind, 'v1');
});

test('an unknown, missing or malformed version is never a v1 default', () => {
  const unknown = readReceiptProduct({ [RECEIPT_PRODUCT_KEY]: { ...fixtureProduct(), schemaVersion: 'menu-extraction-product/v3' } });
  assert.equal(unknown.kind, 'unsupported');
  assert.equal(unknown.reason, 'unsupported_schema_version');
  assert.deepEqual(unknown.blockedActions, ['save', 'confirm', 'export', 'publish']);

  const { schemaVersion, ...withoutVersion } = fixtureProduct();
  assert.equal(readReceiptProduct({ [RECEIPT_PRODUCT_KEY]: withoutVersion }).kind, 'unsupported');
  assert.equal(readConceptProduct(withoutVersion).kind, 'v1', 'legacy concept content has no version at all');

  const invalid = readConceptProduct({ ...fixtureProduct(), coverage: { status: 'complete', sourcesRead: 0, pagesRead: 0, itemsExtracted: 99, unreadSources: [], limitations: [] } });
  assert.equal(invalid.kind, 'invalid');
  assert.equal(invalid.reason, 'invalid_product_version');
  assert.equal(invalid.view, null);
});

test('the existing concept reader is guarded and never flattens a versioned envelope', () => {
  assert.equal(isUnsupportedConceptEnvelope({ title: 'x', categories: [] }), false);
  assert.equal(isUnsupportedConceptEnvelope(fixtureProduct()), true);
  assert.equal(isUnsupportedConceptEnvelope({ menus: [{ categories: [] }] }), true);
  assert.equal(isUnsupportedConceptEnvelope({ title: 'x', categories: [], menus: [] }), false, 'legacy content with an extra key is left to the v1 reader');
  assert.throws(() => assertLegacyConceptContent(fixtureProduct()), (error) => error.code === 'unsupported_product_schema' && error.productInfo.kind === 'v2');
  assert.doesNotThrow(() => assertLegacyConceptContent({ title: 'Fictief', categories: [] }));
});

test('the refusal shape names one concrete reason and blocks every action', () => {
  const info = readConceptProduct(fixtureProduct());
  const refusal = productActionRefusal('approve', info);
  assert.equal(refusal.status, 409);
  assert.equal(refusal.body.reason, 'product_v2_read_only');
  assert.equal(refusal.body.action, 'approve');
  assert.equal(refusal.body.schemaVersion, MENU_PRODUCT_SCHEMA_VERSION);
  assert.deepEqual(refusal.body.blockedActions, ['save', 'confirm', 'export', 'publish']);
  const unsupported = productActionRefusal('export', { reason: 'unsupported_schema_version', schemaVersion: 'v9', problems: ['x'] });
  assert.equal(unsupported.body.reason, 'unsupported_schema_version');
  assert.deepEqual(unsupported.body.problems, ['x']);
});

test('displayed strings are sanitized and bounded; quotes stay plain data', () => {
  assert.equal(cleanText('  a\u0000b\n  c  ', 10), 'ab c');
  assert.equal(cleanText('x'.repeat(20), 5), 'xxxxx');
  assert.equal(cleanText(null, 5), null);
  const product = fixtureProduct();
  product.menus[0].categories[0].items[0].name = 'Fictief\u0007 <b>gerecht</b>';
  product.menus[0].categories[0].items[0].evidence.quote = '<script>alert(1)</script> 13,00';
  const view = readConceptProduct(product).view;
  const item = view.menus[0].categories[0].items[0];
  assert.equal(item.name, 'Fictief <b>gerecht</b>', 'control characters removed; no HTML interpretation happens here');
  assert.equal(item.evidence.quote, '<script>alert(1)</script> 13,00', 'the quote remains data for React to render as text');
});


