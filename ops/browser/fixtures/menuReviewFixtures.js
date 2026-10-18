'use strict';

// Fictional fixtures for the #59 browser check of the EXISTING batch import and
// menu-review UI. They are generated through the real product helpers
// (summarizeRecognisedMenu, buildMenuConcept, buildExtractionResult) so the
// browser sees the same shapes the server sends. No production data, identity,
// credential or URL is used; every URL is on the .invalid TLD.

const { summarizeRecognisedMenu, buildMenuConcept } = require('../../../src/lib/menuConcept');
const { buildExtractionResult } = require('../../../src/lib/menuExtractionResult');

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
  scenarios: {
    review: overview(reviewDetail),
    readonly: overview(readOnlyDetail()),
    empty: overview(null),
    partial: overview(detailWith([partialItem])),
    error: null,
  },
  expected: {
    conceptBlockers: concept.blockers.map((blocker) => blocker.status),
    itemCount: menu.itemCount,
    categoryCount: menu.categoryCount,
    attentionGroupCount: extraction.attentionGroups.length,
  },
};

