'use strict';

// Verdict for the read-only source probe of #59 (Delivery Lead review
// 6247746317). Kept in its own module so the pass/fail rule is unit tested:
// a report may only pass when both sides of the comparison are fully
// accounted for and no difference list has an entry. A source hash mismatch or
// a failed analysis never passes either. There is no quality score and no
// tolerance: an unexplained surplus row is a difference, not a rounding detail.

const DIFFERENCE_LISTS = ['missing', 'extra', 'priceMismatches', 'categoryMismatches', 'duplicates'];

/** Every expected and actual row must be explained exactly once. */
function rowsFullyAccounted(accounting) {
  if (!accounting || typeof accounting !== 'object') return false;
  return ['expected', 'actual'].every((side) => {
    const value = accounting[side];
    if (!value || typeof value !== 'object') return false;
    return (
      Number.isInteger(value.total) &&
      Number.isInteger(value.accounted) &&
      value.total === value.accounted &&
      value.balanced === true
    );
  });
}

function hasUnaccountedRows(report) {
  return !rowsFullyAccounted(report && report.accounting);
}

function sourceHasDifference(report) {
  if (!report || typeof report !== 'object') return true;
  if (report.ok === false) return true;
  if (report.bytesSha256Matches === false || report.contentHashMatches === false) return true;
  if (hasUnaccountedRows(report)) return true;
  return DIFFERENCE_LISTS.some((key) => !Array.isArray(report[key]) || report[key].length > 0);
}

module.exports = {
  DIFFERENCE_LISTS,
  rowsFullyAccounted,
  hasUnaccountedRows,
  sourceHasDifference,
};
