'use strict';

// BE-31 (#74) — the number behind "Werkvoorraad → Bronnen beoordelen" must be the
// same number of tasks the page shows (criterion 2, last bullet). Both use the
// one pure definition in src/lib/sourceReview.js; this module only feeds it.
//
// It reuses the existing read handlers (BE-24 triage, BE-25 batch overview and
// detail) instead of new queries, so a count can never disagree with the list a
// click opens. Read only; no write, no external fetch, no AI.

const { selectTasks, countSourceReviewTasks, BRONNEN_HREF } = require('./sourceReview');

// The same bound the Bronnen page uses for its recent batches.
const BATCH_DETAIL_LIMIT = 10;

/**
 * deps:
 *   getTriage()            → the existing GET /api/internal/v1/source-triage body
 *   getBatchOverview(id)   → the existing GET /api/internal/v1/batch-analysis body
 * Both may reject or return an unusable body: then the count is `null`, never a
 * partial sum presented as the real number.
 */
function createSourceReviewCounter(deps) {
  const { getTriage, getBatchOverview } = deps || {};

  return async function countTasks() {
    if (typeof getTriage !== 'function' || typeof getBatchOverview !== 'function') return null;
    let triage;
    try {
      triage = await getTriage();
    } catch {
      return null;
    }
    if (!triage || !Array.isArray(triage.restaurants)) return null;
    let overview;
    try {
      overview = await getBatchOverview(null);
    } catch {
      return null;
    }
    const recent = overview && Array.isArray(overview.recent_batches) ? overview.recent_batches : [];
    const details = [];
    for (const batch of recent.slice(0, BATCH_DETAIL_LIMIT)) {
      if (!batch || !batch.id) continue;
      try {
        const body = await getBatchOverview(batch.id);
        if (body && body.detail) details.push(body.detail);
      } catch {
        // A single unreadable batch makes the total unknown, not smaller.
        return null;
      }
    }
    const tasks = selectTasks({ entries: triage.restaurants, batchDetails: details, returnTo: BRONNEN_HREF });
    return countSourceReviewTasks(tasks);
  };
}

module.exports = { createSourceReviewCounter, BATCH_DETAIL_LIMIT };
