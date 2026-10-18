'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FLAG_CODES,
  MIN_AI_REPLACEMENT_COVERAGE_RATIO,
  assessDeterministicMenuQuality,
  applyQualityReview,
  aiReplacementGate,
} = require('./menuExtractionQuality');

const item = (name, extra = {}) => ({ name, priceStatus: 'known', evidence: { sourceId: 'source-1', locator: 'line:1', quote: name }, ...extra });
const cleanMenu = {
  contextSlug: 'kaart',
  sourceId: 'source-1',
  sourceUrl: 'https://fixture.example/menu',
  categories: [{ name: 'Voor', items: [item('Soep'), item('Brood')] }],
};

test('a clean deterministic menu is sufficient and must not trigger a paid model call', () => {
  const assessment = assessDeterministicMenuQuality({ menus: [cleanMenu], sourceInventory: [{ id: 'source-1', status: 'read', url: cleanMenu.sourceUrl }] });
  assert.equal(assessment.sufficient, true);
  assert.equal(assessment.requiresAiExtraction, false);
  assert.equal(assessment.blockedByProductGap, false);
  assert.deepEqual(assessment.flags, []);
});

test('an unheaded section, a duplicate, a merged name and an unresolved price are flagged for review', () => {
  const menu = {
    contextSlug: 'kaart',
    sourceId: 'source-1',
    categories: [
      { name: null, items: [item('Soep'), item('Soep')] },
      { name: 'Hoofd', items: [item('A very long dish name that cannot realistically be one dish on a real menu card', { priceStatus: 'multiple_undecomposed' })] },
    ],
  };
  const assessment = assessDeterministicMenuQuality({ menus: [menu] });
  assert.equal(assessment.sufficient, false);
  assert.equal(assessment.requiresAiExtraction, true);
  assert.deepEqual(new Set(assessment.codes), new Set([
    FLAG_CODES.unheaded_items,
    FLAG_CODES.duplicate_item_within_category,
    FLAG_CODES.long_item_name,
    FLAG_CODES.unresolved_price,
  ]));
  assert.deepEqual(assessment.reviewTargets, [{ menuIndex: 0, categoryIndex: 0 }, { menuIndex: 0, categoryIndex: 1 }]);

  const marked = applyQualityReview([menu], assessment);
  assert.equal(marked, 2);
  assert.equal(menu.categories[0].uncertain, true);
  assert.equal(menu.categories[1].uncertain, true);
});

test('a supplement cannot be turned into an ordinary dish, so a model call is refused as product-gap', () => {
  const menu = { contextSlug: 'kaart', sourceId: 'source-1', categories: [{ name: 'Lunch', items: [item('Brood'), item('+ Bresaola')] }] };
  const assessment = assessDeterministicMenuQuality({ menus: [menu] });
  assert.equal(assessment.blockedByProductGap, true);
  assert.equal(assessment.requiresAiExtraction, false);
  assert.equal(assessment.sufficient, false);
  assert.ok(assessment.codes.includes(FLAG_CODES.supplement_as_item));

  const labelled = { contextSlug: 'kaart', sourceId: 'source-1', categories: [{ name: 'Lunch', items: [item('Brood'), item('Supplement serranoham')] }] };
  const labelledAssessment = assessDeterministicMenuQuality({ menus: [labelled] });
  assert.equal(labelledAssessment.blockedByProductGap, true);
  assert.ok(labelledAssessment.codes.includes(FLAG_CODES.supplement_as_item));
});

test('PDF layout signals are reported, and skipped supplements block a paid call', () => {
  const supplements = assessDeterministicMenuQuality({
    menus: [cleanMenu],
    unknownMenuContexts: [{ sourceId: 'source-1', sourceUrl: cleanMenu.sourceUrl, layout: { supplementLines: 3, ambiguousPriceLines: 0, unrecognizedHeadingLines: 0 } }],
  });
  assert.equal(supplements.blockedByProductGap, true);
  assert.equal(supplements.requiresAiExtraction, false);
  assert.ok(supplements.codes.includes(FLAG_CODES.pdf_supplements_skipped));

  const layoutOnly = assessDeterministicMenuQuality({
    menus: [cleanMenu],
    unknownMenuContexts: [{ sourceId: 'source-1', layout: { supplementLines: 0, ambiguousPriceLines: 1, unrecognizedHeadingLines: 2 } }],
  });
  assert.equal(layoutOnly.requiresAiExtraction, true);
  assert.ok(layoutOnly.codes.includes(FLAG_CODES.pdf_ambiguous_price_lines));
  assert.ok(layoutOnly.codes.includes(FLAG_CODES.pdf_unrecognised_headings));
});

test('PDF price content without a demonstrable local name/price relation is reported, never a sufficient menu', () => {
  const assessment = assessDeterministicMenuQuality({
    menus: [cleanMenu],
    unknownMenuContexts: [{ sourceId: 'source-1', sourceUrl: cleanMenu.sourceUrl, layout: { unlinkedPriceLines: 2 } }],
  });
  assert.equal(assessment.sufficient, false);
  assert.equal(assessment.blockedByProductGap, false);
  assert.equal(assessment.requiresAiExtraction, true);
  assert.ok(assessment.codes.includes(FLAG_CODES.pdf_unlinked_price_lines));
});

test('PDF arrangement lines are a product gap for that source, never silently paid for', () => {
  const assessment = assessDeterministicMenuQuality({
    menus: [cleanMenu],
    unknownMenuContexts: [{ sourceId: 'source-1', sourceUrl: cleanMenu.sourceUrl, layout: { supplementLines: 0, arrangementLines: 1 } }],
  });
  assert.equal(assessment.blockedByProductGap, true);
  assert.deepEqual(assessment.blockedSourceIds, ['source-1']);
  assert.equal(assessment.requiresAiExtraction, false);
  assert.ok(assessment.codes.includes(FLAG_CODES.pdf_arrangements_skipped));
});

test('an HTML source with excluded arrangement sections is a product gap, never sent for flattening', () => {
  const assessment = assessDeterministicMenuQuality({
    menus: [cleanMenu],
    sourceInventory: [{ id: 'source-1', url: cleanMenu.sourceUrl, status: 'read', kind: 'html', excludedSections: 2 }],
  });
  assert.equal(assessment.blockedByProductGap, true);
  assert.deepEqual(assessment.blockedSourceIds, ['source-1']);
  assert.ok(assessment.codes.includes(FLAG_CODES.html_arrangements_skipped));
});

test('a read source with zero recognized dishes is never "sufficient"', () => {
  const assessment = assessDeterministicMenuQuality({
    menus: [],
    sourceInventory: [{ id: 'source-1', url: 'https://fixture.example/menu', status: 'read', kind: 'pdf' }],
  });
  assert.equal(assessment.sufficient, false);
  assert.equal(assessment.requiresAiExtraction, true);
  assert.deepEqual(assessment.flaggedSourceIds, ['source-1']);
  assert.ok(assessment.codes.includes(FLAG_CODES.no_deterministic_items));
});

test('the same dish + price in two sections flags a possibly flattened menu variant for review', () => {
  const menu = {
    sourceId: 'source-1',
    categories: [
      { name: 'Voor', items: [item('Fictieve soep')] },
      { name: 'Koud', items: [item('Fictieve soep')] },
    ],
  };
  const assessment = assessDeterministicMenuQuality({ menus: [menu] });
  assert.ok(assessment.codes.includes(FLAG_CODES.duplicate_item_across_categories));
  assert.equal(assessment.requiresAiExtraction, true);
  assert.deepEqual(assessment.reviewTargets, [{ menuIndex: 0, categoryIndex: 0 }, { menuIndex: 0, categoryIndex: 1 }]);
  assert.equal(applyQualityReview([menu], assessment), 2);
});

test('a product gap in one source never disables repair of another source', () => {
  const s1 = {
    contextSlug: 'borrel',
    sourceId: 'source-1',
    sourceUrl: 'https://fixture.example/borrel.pdf',
    categories: [{ name: 'Borrel', items: [item('Brood', { evidence: { sourceId: 'source-1', locator: 'pdf:1', quote: 'Brood' } })] }],
  };
  const s2 = {
    contextSlug: 'lunch',
    sourceId: 'source-2',
    sourceUrl: 'https://fixture.example/lunch.pdf',
    categories: [{ name: 'Lunch', items: [item('Soep', { evidence: { sourceId: 'source-2', locator: 'pdf:1', quote: 'Soep' } }), item('Soep', { evidence: { sourceId: 'source-2', locator: 'pdf:2', quote: 'Soep' } })] }],
  };
  const assessment = assessDeterministicMenuQuality({
    menus: [s1, s2],
    unknownMenuContexts: [{ sourceId: 'source-1', sourceUrl: s1.sourceUrl, layout: { supplementLines: 2 } }],
    sourceInventory: [
      { id: 'source-1', url: s1.sourceUrl, status: 'read', kind: 'pdf' },
      { id: 'source-2', url: s2.sourceUrl, status: 'read', kind: 'pdf' },
    ],
  });
  assert.equal(assessment.blockedByProductGap, true);
  assert.deepEqual(assessment.blockedSourceIds, ['source-1']);
  assert.deepEqual(assessment.aiEligibleSourceIds, ['source-2']);
  assert.equal(assessment.requiresAiExtraction, true);
  // The blocked source keeps its own honest flag, never a silent pass.
  assert.ok(assessment.flags.some((flag) => flag.sourceId === 'source-1' && flag.code === FLAG_CODES.pdf_supplements_skipped));

  // Both the directly flagged s2 category and every s1 category are review work.
  assert.equal(applyQualityReview([s1, s2], assessment), 2);
  assert.equal(s1.categories[0].uncertain, true);
  assert.equal(s2.categories[0].uncertain, true);
});

test('replacement gate: same-source evidence and at least the coverage ratio are required', () => {
  const aiMenu = { sourceId: 'source-1', categories: [{ name: 'Voor', items: [item('Soep'), item('Brood')] }] };
  assert.equal(aiReplacementGate({ aiMenu, deterministicItemCount: 2, sourceId: 'source-1' }).ok, true);
  assert.equal(aiReplacementGate({ aiMenu, deterministicItemCount: 10, sourceId: 'source-1' }).reason, 'coverage_below_deterministic');
  assert.equal(MIN_AI_REPLACEMENT_COVERAGE_RATIO, 0.8);

  const missingQuote = { sourceId: 'source-1', categories: [{ name: 'Voor', items: [{ name: 'Soep', evidence: { sourceId: 'source-1', locator: 'line:1' } }] }] };
  assert.equal(aiReplacementGate({ aiMenu: missingQuote, deterministicItemCount: 1, sourceId: 'source-1' }).reason, 'missing_source_evidence');
  const wrongSource = { sourceId: 'source-1', categories: [{ name: 'Voor', items: [{ ...item('Soep'), evidence: { sourceId: 'source-2', locator: 'line:1', quote: 'Soep' } }] }] };
  assert.equal(aiReplacementGate({ aiMenu: wrongSource, deterministicItemCount: 1, sourceId: 'source-1' }).reason, 'missing_source_evidence');
  assert.equal(aiReplacementGate({ aiMenu: { sourceId: 'source-1', categories: [] }, deterministicItemCount: 0, sourceId: 'source-1' }).reason, 'no_items');
});
