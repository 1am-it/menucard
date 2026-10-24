'use strict';

// K5 regressions (#59 / BE-21 review 6370840673): route B is worth a paid call
// for four documented reasons only, and this module is not wired to any route.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MIN_ROUTE_B_COVERAGE_RATIO, ROUTE_B_REASONS, decideRouteB } = require('./menuExtractionRouteBDecision');
const { FLAG_CODES } = require('./menuExtractionQuality');

test('K5: no deterministic items always needs route B', () => {
  const decision = decideRouteB({ deterministicItemCount: 0, expectedItemCount: 20 });
  assert.equal(decision.useRouteB, true);
  assert.deepEqual(decision.reasons, [ROUTE_B_REASONS.no_items, ROUTE_B_REASONS.low_coverage]);
  assert.equal(decision.coverageRatio, 0);
});

test('K5: low coverage against a known reference is a reason, 80% exactly is not', () => {
  assert.equal(MIN_ROUTE_B_COVERAGE_RATIO, 0.8);
  const low = decideRouteB({ deterministicItemCount: 7, expectedItemCount: 10 });
  assert.deepEqual(low.reasons, [ROUTE_B_REASONS.low_coverage]);
  assert.equal(low.coverageRatio, 0.7);
  const exact = decideRouteB({ deterministicItemCount: 8, expectedItemCount: 10 });
  assert.equal(exact.useRouteB, false);
  assert.deepEqual(exact.reasons, []);
  const clean = decideRouteB({ deterministicItemCount: 42, expectedItemCount: 42 });
  assert.equal(clean.useRouteB, false);
});

test('K5: a skipped HTML arrangement section or a PDF layout problem triggers route B', () => {
  const arrangements = decideRouteB({ deterministicItemCount: 20, expectedItemCount: 20, flags: [FLAG_CODES.html_arrangements_skipped] });
  assert.deepEqual(arrangements.reasons, [ROUTE_B_REASONS.html_arrangements_skipped]);
  const pdf = decideRouteB({
    deterministicItemCount: 20,
    expectedItemCount: 20,
    flags: [{ code: FLAG_CODES.pdf_unlinked_price_lines }, { code: FLAG_CODES.pdf_ambiguous_price_lines }],
  });
  assert.deepEqual(pdf.reasons, [ROUTE_B_REASONS.pdf_layout_problem]);
  assert.deepEqual(pdf.pdfLayoutFlags, ['pdf_ambiguous_price_lines', 'pdf_unlinked_price_lines']);
});

test('K5: ordinary review flags never buy a model call on their own', () => {
  const decision = decideRouteB({
    deterministicItemCount: 30,
    expectedItemCount: 30,
    flags: [FLAG_CODES.long_item_name, FLAG_CODES.duplicate_item_within_category, FLAG_CODES.unresolved_price],
  });
  assert.equal(decision.useRouteB, false);
  assert.deepEqual(decision.reasons, []);
  // Without a reference count, a healthy item count is not a reason either.
  assert.equal(decideRouteB({ deterministicItemCount: 12 }).useRouteB, false);
});

test('K5: the decision module stays out of the app runtime', () => {
  const source = fs.readFileSync(path.join(__dirname, 'menuExtractionRouteBDecision.js'), 'utf8');
  assert.equal(source.includes('menuExtractionRuntime'), false);
  assert.equal(source.includes('runStructuredExtraction'), false);
  assert.equal(source.includes('app/'), false);
  assert.equal(source.includes('require('), false, 'it is pure: no imports at all');
});
