'use strict';

// Fictional fixtures for the #59 browser check of the EXISTING batch import and
// menu-review UI. They are generated through the real product helpers
// (summarizeRecognisedMenu, buildMenuConcept, buildExtractionResult) so the
// browser sees the same shapes the server sends. No production data, identity,
// credential or URL is used; every URL is on the .invalid TLD.

const { summarizeRecognisedMenu, buildMenuConcept } = require('../../../src/lib/menuConcept');
const { buildExtractionResult } = require('../../../src/lib/menuExtractionResult');
const { buildProductReviewView, summarizeProductMenu } = require('../../../src/lib/menuProductIntegrationV2');

const BATCH_ID = 'batch-fictief-0001';
const RESTAURANT = { id: '9001', name: 'Fictief Brasserie Noord', known: true };
const SOURCE_URL = 'https://fictief-brasserie.invalid/menu';
const FOUND_URL = 'https://fictief-bron.invalid/menu';

const evidence = (locator, quote) => ({ sourceId: 'src-fictief-1', locator, quote });

const reviewMenus = [
  {
    title: 'Fictief Lunch',
    sourceId: 'src-fictief-1',
    categories: [
      {
        name: 'Koud',
        path: ['Fictief Lunch', 'Koud'],
        sourcePath: ['LUNCH', 'KOUD'],
        items: [
          { name: 'Fictieve salade', desc: 'Fictieve groenten en fictieve dressing', price: '12.50', evidence: evidence('LUNCH > KOUD > regel 1', 'Fictieve salade 12,50') },
          { name: 'Fictieve soep', price: '8.00', evidence: evidence('LUNCH > KOUD > regel 2', 'Fictieve soep 8,00') },
          { name: 'Fictieve soep', price: '8.00', evidence: evidence('LUNCH > KOUD > regel 3', 'Fictieve soep 8,00') },
        ],
      },
      {
        name: 'Warm',
        path: ['Fictief Lunch', 'Warm'],
        sourcePath: ['LUNCH', 'WARM'],
        uncertain: true,
        items: [
          { name: 'Fictieve pasta', price: '14.50', evidence: evidence('LUNCH > WARM > regel 1', 'Fictieve pasta 14,50') },
          { name: 'Fictief stoofpotje', priceText: '9.50 / 18.00', priceStatus: 'multiple_undecomposed', evidence: evidence('LUNCH > WARM > regel 2', 'Fictief stoofpotje 9,50 / 18,00') },
        ],
      },
    ],
  },
  {
    title: 'Fictief Diner',
    sourceId: 'src-fictief-1',
    categories: [
      {
        name: 'Voor',
        path: ['Fictief Diner', 'Voor'],
        sourcePath: ['DINER', 'VOOR'],
        uncertain: true,
        items: [{ name: 'Fictieve burrata', price: '13.00', evidence: evidence('DINER > VOOR > regel 1', 'Fictieve burrata 13,00') }],
      },
      {
        name: 'Hoofd',
        path: ['Fictief Diner', 'Hoofd'],
        sourcePath: ['DINER', 'HOOFD'],
        items: [
          { name: 'Fictieve zeebaars', price: '24.00', evidence: evidence('DINER > HOOFD > regel 1', 'Fictieve zeebaars 24,00') },
          { name: 'Fictieve kaasplank', desc: 'Fictieve kazen zonder bronprijs' },
        ],
      },
    ],
  },
];

const limitations = ['Fictief: arrangementen en supplementen worden niet als gerecht opgeslagen.'];
const extraction = buildExtractionResult({
  sourceInventory: [{ id: 'src-fictief-1', url: SOURCE_URL, kind: 'html', status: 'read', contentHash: 'fictief-hash', itemCount: 8 }],
  menus: reviewMenus,
  unknownMenuContexts: [],
  limitations,
});
const menu = summarizeRecognisedMenu(reviewMenus);
const concept = buildMenuConcept({ menus: reviewMenus, liveLines: [], edits: {} });

// A fictional v2 view: one dish, one glass/bottle wine, one unresolved
// supplement. It is built through the same sanitized reader the app uses.
const v2Product = {
  schemaVersion: 'menu-extraction-product/v2',
  menus: [
    {
      id: 'menu-1',
      title: 'Fictief Diner',
      sourceId: 'src-fictief-1',
      variant: { id: 'variant-1', label: 'Diner', sourceLabel: 'DINNER', locale: 'nl', location: null, order: 1 },
      categories: [
        {
          id: 'cat-1',
          name: 'Hoofd',
          path: ['Diner', 'Hoofd'],
          sourcePath: ['DINNER', 'HOOFD'],
          kind: 'section',
          choice: null,
          uncertain: false,
          items: [
            {
              id: 'item-1',
              kind: 'beverage',
              name: 'Fictieve wijn',
              description: 'Fictief, per glas of fles',
              price: { status: 'multiple_undecomposed', amountMinorUnits: null, currency: null, text: 'Glas 6,50 / Fles 25,00', isFrom: false, evidence: null },
              priceVariants: [
                { id: 'pv-1', label: 'Glas', kind: 'glass', amountMinorUnits: 650, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-fictief-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' }, origin: 'extracted' },
                { id: 'pv-2', label: 'Fles', kind: 'bottle', amountMinorUnits: 2500, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-fictief-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' }, origin: 'extracted' },
              ],
              primaryPriceRef: null,
              supplementOf: null,
              choiceGroupRef: null,
              allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
              dietaryLabels: [],
              availability: null,
              evidence: { sourceId: 'src-fictief-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' },
              origins: { name: 'extracted', description: 'extracted', price: 'unknown', allergens: 'unknown', supplementOf: 'unknown', availability: 'unknown', kind: 'extracted' },
            },
            {
              id: 'item-2',
              kind: 'supplement',
              name: 'Extra fictief brood',
              description: null,
              price: { status: 'known', amountMinorUnits: 200, currency: 'EUR', text: null, isFrom: false, evidence: { sourceId: 'src-fictief-1', locator: 'regel 3', quote: 'Extra fictief brood 2,00' } },
              priceVariants: [],
              primaryPriceRef: null,
              supplementOf: { status: 'unresolved', label: 'Bij de maaltijd', context: { menuId: 'menu-1', categoryId: 'cat-1' }, limitation: 'Geen expliciet doelitem in de bron.' },
              choiceGroupRef: null,
              allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
              dietaryLabels: [],
              availability: null,
              evidence: { sourceId: 'src-fictief-1', locator: 'regel 3', quote: 'Extra fictief brood 2,00' },
              origins: { name: 'extracted', description: 'unknown', price: 'extracted', allergens: 'unknown', supplementOf: 'extracted', availability: 'unknown', kind: 'extracted' },
            },
          ],
        },
      ],
    },
  ],
  rejected: [],
  coverage: { status: 'partial', sourcesRead: 1, pagesRead: 2, itemsExtracted: 2, unreadSources: [], limitations: ['Fictieve v2-beperking: één pagina was onleesbaar.'] },
};
const v2View = buildProductReviewView(v2Product);
const v2Menu = summarizeProductMenu(v2View);

const v2Item = item({
  menu: v2Menu,
  product: v2View,
  productBlocked: true,
  productReason: 'product_v2_read_only',
  productSchemaVersion: 'menu-extraction-product/v2',
  coverage: v2View.coverage,
  limitations: ['Fictieve v2-beperking: één pagina was onleesbaar.'],
  attentionGroups: [],
  notes: ['Fictief: v2-envelope, alleen-lezen.'],
  concept: {
    menus: [],
    product: v2View,
    productBlocked: true,
    productReason: 'product_v2_read_only',
    productSchemaVersion: 'menu-extraction-product/v2',
    liveLines: [],
    latest: null,
  },
});


function item(overrides) {
  return {
    position: 1,
    url: 'https://fictief-restaurant.invalid/',
    key: 'confirmed',
    label: 'Bron bevestigd',
    role: 'positive',
    icon: 'check',
    terminal: true,
    actions: ['review_manually'],
    text: null,
    high: false,
    jobId: 'job-fictief-1',
    restaurant: RESTAURANT,
    foundUrl: FOUND_URL,
    menu,
    coverage: extraction.coverage,
    limitations,
    attentionGroups: extraction.attentionGroups,
    notes: ['Fictief: 1 arrangementregel is uitgesloten en gemeld.'],
    concept: { menus: reviewMenus, liveLines: [], latest: null },
    ...overrides,
  };
}

function detailWith(items) {
  return {
    batch: {
      id: BATCH_ID,
      created_at: '2026-10-18T09:00:00.000Z',
      closed_at: '2026-10-18T09:01:00.000Z',
      close_reason: 'completed',
      item_count: items.length,
      is_starter: true,
    },
    items,
    summary: {
      total: items.length,
      done: items.length,
      running: 0,
      queued: 0,
      open: 0,
      highCertainty: 0,
      byAction: { review_manually: items.length },
    },
  };
}

const reviewDetail = detailWith([item()]);

const partialItem = item({
  key: 'no_menu',
  label: 'Geen bruikbare menukaart',
  role: 'neutral',
  icon: 'warning',
  text: 'De menukaart is gevonden, maar er zijn geen gerechten met een betrouwbare prijs herkend.',
  menu: null,
  concept: null,
  foundUrl: null,
  coverage: { status: 'candidate_without_items', itemCount: 0, readCount: 1 },
  attentionGroups: [],
});

const overview = (detail) => ({
  daily: { used: detail ? 1 : 0, limit: 25 },
  own_open_batch_id: null,
  recent_batches: detail
    ? [{ id: BATCH_ID, created_at: detail.batch.created_at, closed_at: detail.batch.closed_at, close_reason: 'completed', item_count: detail.batch.item_count, is_own: detail.batch.is_starter }]
    : [],
  detail,
});

function readOnlyDetail() {
  const detail = JSON.parse(JSON.stringify(reviewDetail));
  detail.batch.is_starter = false;
  for (const entry of detail.items) {
    entry.actions = [];
    entry.high = false;
  }
  return detail;
}

module.exports = {
  BATCH_ID,
  RESTAURANT,
  SOURCE_URL,
  FOUND_URL,
  reviewDetail,
  v2Product,
  v2View,
  scenarios: {
    review: overview(reviewDetail),
    readonly: overview(readOnlyDetail()),
    empty: overview(null),
    partial: overview(detailWith([partialItem])),
    v2: overview(detailWith([v2Item])),
    error: null,
  },
  expected: {
    conceptBlockers: concept.blockers.map((blocker) => blocker.status),
    itemCount: menu.itemCount,
    categoryCount: menu.categoryCount,
    attentionGroupCount: extraction.attentionGroups.length,
  },
};

