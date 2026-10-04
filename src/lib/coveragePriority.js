// PLATFORM-12 (Phase 1) — pure presentation logic behind the Coverage
// Dashboard's "Priority gaps by neighbourhood" view. Deliberately
// CommonJS, same reasoning as internalNav.js/importInbox.js: directly
// testable via this project's existing `node --test` tooling, no new
// dependency, interoperates fine with the ESM 'use client' page that
// imports it.
//
// Presentation layer only. It re-orders and classifies the `byBuurt` rows
// and metric figures that `computeCoverageMetrics()` already returns
// (via the unchanged, internal-only `/api/internal/v1/coverage` route);
// it never computes a new coverage figure, never changes how any metric
// is computed, and never mutates the data it is given. Moving any of this
// into `computeCoverageMetrics()` itself is explicitly a separate, later
// decision (see PLATFORM-12's own "Open questions").

'use strict';

/** How many neighbourhoods the priority table shows before "show all". */
const PRIORITY_DEFAULT_VISIBLE = 3;

/**
 * Restaurants in a group still missing menu data: `total - withMenuData`.
 * Derived from the raw counts, never from the nullable `pct`, so a group
 * below the sample threshold (no percentage shown) still sorts correctly
 * by its absolute gap.
 */
function menuDataGap(row) {
  const total = Number(row && row.total) || 0;
  const withMenuData = Number(row && row.withMenuData) || 0;
  return Math.max(0, total - withMenuData);
}

/**
 * Returns a NEW array of NEW row objects (`{ ...row, missingMenuData }`),
 * sorted for prioritization:
 *   1. most restaurants still missing menu data first (`total - withMenuData`);
 *   2. tie: the larger neighbourhood first (`total`);
 *   3. tie: neighbourhood name, alphabetically (Dutch collation, case- and
 *      accent-insensitive), so the order is fully deterministic.
 * The input array and its row objects are never mutated.
 */
function sortByMenuDataGap(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({ ...row, missingMenuData: menuDataGap(row) }))
    .sort(
      (a, b) =>
        b.missingMenuData - a.missingMenuData ||
        (Number(b.total) || 0) - (Number(a.total) || 0) ||
        String(a.label).localeCompare(String(b.label), 'nl', { sensitivity: 'base' })
    );
}

/**
 * Which of the (already sorted) rows to render: the first `limit` by
 * default, all of them once expanded. `hiddenCount` is how many rows the
 * collapsed view leaves out (0 when there is nothing more to show).
 */
function visiblePriorityRows(sortedRows, expanded, limit = PRIORITY_DEFAULT_VISIBLE) {
  const rows = Array.isArray(sortedRows) ? sortedRows : [];
  const hiddenCount = Math.max(0, rows.length - limit);
  return {
    rows: expanded || hiddenCount === 0 ? rows : rows.slice(0, limit),
    hiddenCount,
  };
}

/**
 * A metric card's visual state from its existing `count`/`total`:
 * 'complete' (every item has it), 'partial' (some do), 'empty' (none do,
 * or there is nothing to count). Presence only — never verified accuracy.
 */
function metricState(count, total) {
  const c = Number(count) || 0;
  const t = Number(total) || 0;
  if (t <= 0 || c <= 0) return 'empty';
  if (c >= t) return 'complete';
  return 'partial';
}

module.exports = {
  PRIORITY_DEFAULT_VISIBLE,
  menuDataGap,
  sortByMenuDataGap,
  visiblePriorityRows,
  metricState,
};
