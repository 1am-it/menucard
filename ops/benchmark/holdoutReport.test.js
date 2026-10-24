'use strict';

// Fixture-only tests for the holdout aggregate report. They prove that the
// report groups per outcome type, never claims a measured invented-item count
// without a controlled reference, and that evidence percentages come from
// per-item locators/patterns/hashes (not model confidence).

const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeMenus, itemSupport, resultType, aggregateHoldoutReport, THRESHOLDS } = require('./holdoutReport');

function item(name, extra = {}) {
  return { name, price: '10.00', priceStatus: 'known', amountMinorUnits: 1000, evidence: { locator: 'html>p[1]', pattern: 'formatted_block' }, ...extra };
}

function menu(items, extra = {}) {
  return {
    sourceId: 'source-1',
    categories: [{ name: 'Lunch', path: ['Lunch'], items }],
    ...extra,
  };
}

test('summarizeMenus reports item, section, price and evidence coverage per item', () => {
  const menus = [
    menu([
      item('Soep'),
      item('Brood', { priceStatus: 'multiple_undecomposed', amountMinorUnits: null, price: null }),
      { name: 'Zonder bewijs', priceStatus: 'known', amountMinorUnits: 500 },
    ]),
  ];
  const summary = summarizeMenus(menus);
  assert.equal(summary.itemCount, 3);
  assert.equal(summary.categoryCount, 1);
  assert.deepEqual(summary.priceStatus, { known: 2, multiple_undecomposed: 1 });
  assert.equal(summary.evidence.withSourceId, 3, 'menu sourceId covers every item');
  assert.equal(summary.evidence.withLocator, 2);
  assert.equal(summary.evidence.withSupport, 2);
  assert.equal(summary.evidence.sourceIdPercent, 100);
  assert.equal(summary.evidence.locatorPercent, 67);
  assert.equal(summary.evidence.supportPercent, 67);
  assert.deepEqual(summary.evidence.missingLocator, ['Zonder bewijs']);
});

test('a missing-evidence count above the sample limit still lowers the percentage', () => {
  const items = Array.from({ length: 8 }, (_v, index) => ({ name: `Gerecht ${index + 1}`, priceStatus: 'known', amountMinorUnits: 500 }));
  const summary = summarizeMenus([menu(items)]);
  assert.equal(summary.evidence.withLocator, 0);
  assert.equal(summary.evidence.locatorPercent, 0);
  assert.equal(summary.evidence.missingLocator.length, 5, 'samples are bounded');
});

test('a menu-context price string counts as known, not as unknown', () => {
  const summary = summarizeMenus([menu([
    { name: 'Soep', price: '7.50', evidence: { locator: 'ul>li[1]', quote: 'Soep 7,50' } },
    { name: 'Onbekend', price: null, priceStatus: 'on_request', evidence: { locator: 'ul>li[2]', quote: 'Onbekend' } },
  ])]);
  assert.deepEqual(summary.priceStatus, { known: 1, on_request: 1 });
  assert.equal(summary.knownWithoutAmount, 0);
});

test('support can be a pattern, a content hash or a quote, never a confidence value', () => {
  assert.equal(itemSupport({ evidence: { locator: 'x', pattern: 'table_row' } }), 'table_row');
  assert.equal(itemSupport({ evidence: { locator: 'x', contentHash: 'abc' } }), 'abc');
  assert.equal(itemSupport({ evidence: { locator: 'x', quote: 'Soep 10,00' } }), 'Soep 10,00');
  assert.equal(itemSupport({ evidence: { locator: 'x', confidence: 'hoog' } }), null);
  assert.equal(itemSupport({}), null);
});

test('resultType separates blocked, no-menu, html and pdf outcomes', () => {
  assert.equal(resultType({ status: 'blocked', itemCount: 0 }), 'blocked');
  assert.equal(resultType({ status: 'executed', itemCount: 0, kind: 'html' }), 'no_menu');
  assert.equal(resultType({ status: 'executed_with_limitation', itemCount: 2, kind: 'html' }), 'html');
  assert.equal(resultType({ status: 'executed_with_limitation', itemCount: 2, kind: 'pdf' }), 'pdf');
});

test('the aggregate groups per source type and records the reason for a blockage', () => {
  const results = {
    'H2-01': {
      label: 'HTML fixture',
      kind: 'html',
      status: 'executed_with_limitation',
      itemCount: 2,
      categoryCount: 1,
      menuCount: 1,
      sourceVersionMatches: true,
      priceStatus: { known: 2 },
      evidence: { itemCount: 2, withSourceId: 2, withLocator: 2, withSupport: 2 },
      coverage: { status: 'items_extracted', complete: false, reviewRequired: true },
      limitations: ['Een arrangement is niet als gerecht opgenomen.'],
    },
    'H2-02': {
      label: 'PDF fixture',
      kind: 'pdf',
      status: 'executed_with_limitation',
      itemCount: 1,
      categoryCount: 1,
      menuCount: 1,
      sourceVersionMatches: false,
      priceStatus: { known: 1 },
      evidence: { itemCount: 1, withSourceId: 1, withLocator: 0, withSupport: 1 },
      limitations: ['PDF-sectie niet herkend.'],
    },
    'H2-03': {
      label: 'Blocked fixture',
      kind: 'unsupported',
      status: 'blocked',
      itemCount: 0,
      categoryCount: 0,
      menuCount: 0,
      blockedReason: 'HTTP 404 on the pinned entry URL.',
      errors: '404',
      limitations: [],
    },
    'H2-04': {
      label: 'No menu fixture',
      kind: 'html',
      status: 'executed_with_limitation',
      itemCount: 0,
      categoryCount: 0,
      menuCount: 0,
      priceStatus: {},
      evidence: { itemCount: 0, withSourceId: 0, withLocator: 0, withSupport: 0 },
      limitations: ['Geen menukaart gevonden op de gepinde pagina.'],
    },
  };
  const report = aggregateHoldoutReport(results);
  assert.equal(report.groups.html.sourceCount, 1);
  assert.equal(report.groups.pdf.sourceCount, 1);
  assert.equal(report.groups.blocked.sourceCount, 1);
  assert.equal(report.groups.no_menu.sourceCount, 1);
  assert.equal(report.groups.html.thresholds.sourceId.status, 'pass');
  assert.equal(report.groups.pdf.thresholds.locator.status, 'fail');
  assert.equal(report.groups.no_menu.thresholds.sourceId.status, 'no_items');
  assert.equal(report.groups.html.thresholds.inventedDishes.status, 'not_measurable_without_controlled_reference');
  assert.equal(report.groups.html.thresholds.missingReason.status, 'not_measurable_without_controlled_reference');
  assert.equal(report.thresholds.inventedDishes, THRESHOLDS.inventedDishes);
  const blocked = report.sources.find((source) => source.id === 'H2-03');
  assert.match(blocked.missingReasons.join('; '), /HTTP 404/);
  assert.equal(blocked.status, 'blocked');
  assert.equal(report.sources.find((source) => source.id === 'H2-01').missingReasons.length, 1);
});
