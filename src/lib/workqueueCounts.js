'use strict';

// #62 — the real, computed numbers behind "Werkvoorraad (N)" and its
// "Open werk" rows. Pure reducers over already-fetched rows: no Supabase, no
// network, no clock, so they are directly testable with `node --test` and are
// the exact same definitions the existing pages use.
//
// The definitions deliberately mirror the pages they count, so the navigation
// can never disagree with the screen it links to:
//  - Menuconcepten beoordelen: the latest version of every lineage (one row per
//    `restaurant_id/menu_context`, like app/internal/menu-concepts' own list)
//    whose effective review decision is not yet closed, i.e. anything other
//    than `approved_internal`/`rejected`. That covers `needs_review`,
//    `deferred` and never-reviewed proposals, exactly what that page shows as
//    "waiting" first.
//  - Nieuwe aanleveringen: import-inbox candidates whose effective review
//    status is still `new` — the page's own default for a candidate without a
//    review row (src/lib/importInbox.js).
//  - Bronnen beoordelen: stored source proposals still in status `proposed`
//    (the pending decision of BE-24).
//  - Beoordelen (editor): the two queues of /internal/moderation together —
//    pending field changes plus pending owner claims — because that page shows
//    both as one workspace.
//
// Nothing here invents a number: a failed query returns `null` upstream and the
// navigation then shows no number at all.

const { buildReviewStatusByCandidateId, DEFAULT_REVIEW_STATUS } = require('./importInbox');
const { deriveEffectiveSnapshotStatus, groupReviewsBySnapshotId } = require('./menuSnapshotProposals');

const CLOSED_SNAPSHOT_STATUSES = ['approved_internal', 'rejected'];

/** One row per concept lineage: the highest `version` for each
 * `restaurant_id/menu_context` pair. Same key and comparison as
 * src/lib/menuConceptReviewHandlers.js's own list. */
function latestSnapshotPerLineage(rows) {
  const latest = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.restaurant_id === undefined || row.menu_context === undefined) continue;
    const key = `${row.restaurant_id}/${row.menu_context}`;
    const seen = latest.get(key);
    const version = Number(row.version);
    if (!seen || version > Number(seen.version)) latest.set(key, row);
  }
  return [...latest.values()];
}

function countSnapshotConceptsAwaitingReview(snapshotRows, reviewRows) {
  const bySnapshot = groupReviewsBySnapshotId(reviewRows);
  return latestSnapshotPerLineage(snapshotRows).filter((row) => {
    const status = deriveEffectiveSnapshotStatus(bySnapshot[String(row.id)] || []);
    return !CLOSED_SNAPSHOT_STATUSES.includes(status);
  }).length;
}

function countNewInboxCandidates(recordRows, reviewRows) {
  const statusByCandidate = buildReviewStatusByCandidateId(reviewRows);
  let count = 0;
  for (const record of Array.isArray(recordRows) ? recordRows : []) {
    if (!record || !record.id) continue;
    const status = statusByCandidate[record.id] || DEFAULT_REVIEW_STATUS;
    if (status === DEFAULT_REVIEW_STATUS) count += 1;
  }
  return count;
}

/** Adds counts for one combined workspace (the moderation page), `null` as
 * soon as one part is unavailable — a partial sum would understate the work. */
function sumAvailableCounts(values) {
  const list = Array.isArray(values) ? values : [];
  if (list.length === 0) return null;
  let total = 0;
  for (const value of list) {
    if (!Number.isInteger(value) || value < 0) return null;
    total += value;
  }
  return total;
}

module.exports = {
  CLOSED_SNAPSHOT_STATUSES,
  latestSnapshotPerLineage,
  countSnapshotConceptsAwaitingReview,
  countNewInboxCandidates,
  sumAvailableCounts,
};
