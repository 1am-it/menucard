'use strict';

// K5 of the Delivery Lead order for #59 / BE-21 (review 6370840673): a small,
// pure decision that says when route B (the AI call) is worth a paid call.
//
// It is deliberately NOT wired into an app route: the app runtime stays
// `disabledMenuExtractionRuntime` in this round. The caller supplies the
// deterministic item count, the number of items a controlled reference expects
// (optional) and the flag codes the existing quality gate already produced.
//
// Route B is worthwhile for exactly four reasons:
//   - no deterministic items at all;
//   - low coverage against a known reference (below 80%);
//   - HTML arrangement/choice sections the deterministic parser had to skip;
//   - a PDF whose layout produced ambiguous, unlinked or unrecognised lines.
// Anything else (a long item name, one duplicate, an unresolved single price)
// stays a human review item, not a paid extraction.

const ROUTE_B_REASONS = Object.freeze({
  no_items: 'no_items',
  low_coverage: 'low_coverage',
  html_arrangements_skipped: 'html_arrangements_skipped',
  pdf_layout_problem: 'pdf_layout_problem',
});

const MIN_ROUTE_B_COVERAGE_RATIO = 0.8;

/** The PDF layout flags that mean the text layer was not read reliably. */
const PDF_LAYOUT_FLAGS = Object.freeze([
  'pdf_ambiguous_price_lines',
  'pdf_unlinked_price_lines',
  'pdf_unrecognised_headings',
  'pdf_inherited_sections',
]);

/** The single HTML flag that means an arrangement/choice section was skipped. */
const HTML_ARRANGEMENT_FLAGS = Object.freeze(['html_arrangements_skipped']);

function flagCodesOf(flags) {
  const codes = new Set();
  for (const flag of Array.isArray(flags) ? flags : []) {
    if (typeof flag === 'string' && flag.trim()) codes.add(flag.trim());
    else if (flag && typeof flag === 'object' && typeof flag.code === 'string' && flag.code.trim()) codes.add(flag.code.trim());
  }
  return codes;
}

function ratio(numerator, denominator) {
  if (!Number.isInteger(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/**
 * @param {{deterministicItemCount?: number, expectedItemCount?: number|null, flags?: Array<string|{code: string}>}} input
 * @returns {{useRouteB: boolean, reasons: string[], coverageRatio: number|null, pdfLayoutFlags: string[]}}
 */
function decideRouteB({ deterministicItemCount = 0, expectedItemCount = null, flags = [] } = {}) {
  const items = Number.isInteger(deterministicItemCount) && deterministicItemCount > 0 ? deterministicItemCount : 0;
  const expected = Number.isInteger(expectedItemCount) && expectedItemCount > 0 ? expectedItemCount : null;
  const codes = flagCodesOf(flags);
  const reasons = [];

  if (items === 0) reasons.push(ROUTE_B_REASONS.no_items);
  const coverageRatio = ratio(items, expected);
  if (coverageRatio !== null && coverageRatio < MIN_ROUTE_B_COVERAGE_RATIO) reasons.push(ROUTE_B_REASONS.low_coverage);
  if (HTML_ARRANGEMENT_FLAGS.some((code) => codes.has(code))) reasons.push(ROUTE_B_REASONS.html_arrangements_skipped);
  const pdfLayoutFlags = PDF_LAYOUT_FLAGS.filter((code) => codes.has(code));
  if (pdfLayoutFlags.length > 0) reasons.push(ROUTE_B_REASONS.pdf_layout_problem);

  return {
    useRouteB: reasons.length > 0,
    reasons,
    coverageRatio,
    pdfLayoutFlags,
  };
}

module.exports = {
  HTML_ARRANGEMENT_FLAGS,
  MIN_ROUTE_B_COVERAGE_RATIO,
  PDF_LAYOUT_FLAGS,
  ROUTE_B_REASONS,
  decideRouteB,
  flagCodesOf,
};
