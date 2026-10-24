'use strict';

// Source workqueue: a v2 receipt is classified from the validated envelope,
// never from the legacy `candidate_summary.menus` projection. A present but
// invalid/empty envelope is a menu candidate, not "no menu assessed".

const test = require('node:test');
const assert = require('node:assert/strict');
const { observeJob } = require('./sourceWorkqueue');

function product(itemCount = 1) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i + 1}`,
    kind: 'dish',
    name: `Fictief gerecht ${i + 1}`,
    description: null,
    price: { status: 'known', amountMinorUnits: 750, currency: 'EUR', text: null, isFrom: false, evidence: { sourceId: 'src-1', locator: `regel ${i + 1}`, quote: `Fictief gerecht ${i + 1} 7,50` } },
    priceVariants: [],
    primaryPriceRef: null,
    supplementOf: null,
    choiceGroupRef: null,
    allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
    dietaryLabels: [],
    availability: null,
    evidence: { sourceId: 'src-1', locator: `regel ${i + 1}`, quote: `Fictief gerecht ${i + 1} 7,50` },
    origins: { name: 'extracted', description: 'unknown', price: 'extracted', allergens: 'unknown', supplementOf: 'unknown', availability: 'unknown', kind: 'unknown' },
  }));
  return {
    schemaVersion: 'menu-extraction-product/v2',
    menus: [{ id: 'menu-1', title: 'Fictief', sourceId: 'src-1', variant: { id: 'variant-1', label: null, sourceLabel: null, locale: null, location: null, order: null }, categories: [{ id: 'cat-1', name: 'Koud', path: ['Koud'], sourcePath: ['KOUD'], kind: 'section', choice: null, uncertain: false, items }] }],
    rejected: [],
    coverage: itemCount > 0
      ? { status: 'partial', sourcesRead: 1, pagesRead: 1, itemsExtracted: itemCount, unreadSources: [], limitations: ['Fictieve beperking.'] }
      : { status: 'no_items', sourcesRead: 1, pagesRead: 1, itemsExtracted: 0, unreadSources: [], limitations: [] },
  };
}

const job = { status: 'succeeded', unknown_menu_contexts: [] };

test('a v2 receipt with items is ready for review even without the legacy menus key', () => {
  const observation = observeJob(job, { menus: null, product: product(1) });
  assert.deepEqual(observation, { kind: 'classified', source: 'reachable', menu: 'ready_for_review' });
});

test('a v2 envelope with zero items or an invalid version is a menu candidate, never "not assessed"', () => {
  for (const receipt of [
    { menus: null, product: product(0) },
    { menus: null, product: { ...product(1), coverage: { status: 'complete', sourcesRead: 0, pagesRead: 0, itemsExtracted: 99, unreadSources: [], limitations: [] } } },
    { menus: null, product: { schemaVersion: 'menu-extraction-product/v9', menus: [] } },
  ]) {
    const observation = observeJob(job, receipt);
    assert.deepEqual(observation, { kind: 'classified', source: 'reachable', menu: 'structure_not_recognized' });
  }
});

test('legacy v1 classification is unchanged', () => {
  const observation = observeJob(job, { menus: [{ categories: [{ items: [{ name: 'Fictieve soep' }] }] }] });
  assert.deepEqual(observation, { kind: 'classified', source: 'reachable', menu: 'ready_for_review' });
  const empty = observeJob(job, { menus: [], product: null });
  assert.deepEqual(empty, { kind: 'classified', source: 'reachable', menu: 'not_assessed' });
});
