// Pure decision logic for MARKET-05A's Data-inbox
// (/internal/import-inbox + /api/internal/v1/import-inbox/...) — a
// read-only window onto MARKET-04's ImportRun/ImportExtractionRecord
// tables, entirely before any normalization, matching, or canonical
// merge. See planning/specs/tickets/market-05-normalization-deduplication.md's
// "MARKET-05A — Data-inbox: interne kandidaat-review" section for the
// full design this implements.
//
// Deliberately CommonJS, same reasoning as setPasswordFlow.js/
// activationFlow.js — directly testable via this project's existing
// `node --test` tooling, no new dependency, interoperates fine with the
// ESM route handlers and 'use client' page that import it.
//
// This module never touches Supabase, the DOM, or React — it only takes
// already-fetched rows/values and returns a decision or a reshaped
// value. The route handlers and the page are the only places that
// actually call the Supabase client or render anything.

'use strict';

/** The one staff_roles value allowed to see raw import data — decided in
 * planning/specs/tickets/market-05-normalization-deduplication.md's
 * "Access control — decided 2026-09-05": not `editor` (restaurant-scoped
 * in this app's existing model; import candidates are platform-wide and
 * unreviewed), not `owner`, not a roleless session. */
const ALLOWED_ROLE = 'internal';

/**
 * True only when `roles` (from `authenticateInternalRequest`) contains
 * the `internal` staff_roles value — never `editor`, never `owner`,
 * regardless of how many roles a caller holds or in what order.
 */
function isInternalOnly(roles) {
  return Array.isArray(roles) && roles.some((r) => r && r.role === ALLOWED_ROLE);
}

/** `null` whenever either timestamp is missing or malformed, or the run
 * hasn't completed yet — never a negative or NaN duration. */
function formatDurationSeconds(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

/**
 * Shapes one raw `import_runs` row plus a `{sourceId: name}` lookup into
 * exactly the overview fields the Data-inbox UI needs — never more than
 * the run row itself and already-registered source names provide. No
 * raw-table column not listed here is ever exposed by this function.
 */
function buildRunSummary(run, sourceNamesById) {
  const names = sourceNamesById || {};
  return {
    id: run.id,
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at,
    duration_seconds: formatDurationSeconds(run.started_at, run.completed_at),
    record_counts: run.record_counts,
    error_log: run.error_log || [],
    source_locator: run.source_locator,
    source_version: run.source_version,
    data_origin_source_name: names[run.data_origin_source_id] || null,
    access_provider_source_name: run.access_provider_source_id ? names[run.access_provider_source_id] || null : null,
  };
}

function normalizeName(name) {
  return typeof name === 'string' && name.trim().length > 0 ? name.trim().toLowerCase() : null;
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Deliberately conservative (few false positives over few false
 * negatives) — two candidates with the exact same normalized name
 * within this radius are flagged as a possible duplicate. */
const DUPLICATE_DISTANCE_METERS = 100;

/**
 * A read-only, non-authoritative HINT for a human reviewer — **never**
 * `MARKET-05B`'s eventual real deduplication/matching logic, which will
 * canonicalize and merge. Flags two candidates as "possibly the same
 * place" only when their names match (case/whitespace-insensitive) AND
 * they sit within `DUPLICATE_DISTANCE_METERS` of each other. Candidates
 * missing a name or a location are never considered (can't be compared
 * meaningfully) — never guessed at.
 *
 * O(n^2) — a known, documented limitation, acceptable at the current,
 * real scale this tool has actually seen (a few hundred candidates per
 * run); revisit if that changes materially.
 */
function computePossibleDuplicateIds(candidates) {
  const duplicateIds = new Set();
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    const nameA = normalizeName(a.extracted_fields && a.extracted_fields.name);
    const locA = a.extracted_fields && a.extracted_fields.location;
    if (!nameA || !locA || typeof locA.lat !== 'number' || typeof locA.lon !== 'number') continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      const nameB = normalizeName(b.extracted_fields && b.extracted_fields.name);
      const locB = b.extracted_fields && b.extracted_fields.location;
      if (!nameB || !locB || typeof locB.lat !== 'number' || typeof locB.lon !== 'number') continue;
      if (nameA !== nameB) continue;
      if (haversineDistanceMeters(locA.lat, locA.lon, locB.lat, locB.lon) <= DUPLICATE_DISTANCE_METERS) {
        duplicateIds.add(a.id);
        duplicateIds.add(b.id);
      }
    }
  }
  return duplicateIds;
}

/**
 * Computed, read-only — **never stored** (`import_extraction_records`
 * stays append-only, exactly as `MARKET-04A` designed it; no update
 * grant exists for it, even for `service_role`, and this module does not
 * propose one). `'complete'` only when name, address, phone, and website
 * are all present; otherwise `'incomplete'`, naming exactly which are
 * missing. Mirrors `ops/scripts/import-breda-osm.js`'s own
 * `minimizeOsmNodeProperties`, which already omits an absent field
 * entirely rather than storing a null — so "missing" here means
 * "absent," never "explicitly empty."
 */
function computeQualityStatus(extractedFields) {
  const fields = extractedFields || {};
  const missingFields = ['name', 'address', 'phone', 'website'].filter((key) => !fields[key]);
  return missingFields.length === 0
    ? { status: 'complete', missingFields: [] }
    : { status: 'incomplete', missingFields };
}

/**
 * Enriches every candidate with its computed `possible_duplicate`/
 * `quality_status` — computed over the **full** given set, before any
 * filtering, so a cross-run duplicate is still detected even when
 * filtering down to a single run — then applies the requested filters.
 * Returns `{ candidates, totalBeforeFilters }`. Pure; never touches a
 * database, never mutates its input.
 */
function enrichAndFilterCandidates(records, filters) {
  const opts = filters || {};
  const duplicateIds = computePossibleDuplicateIds(records);

  const enriched = records.map((record) => {
    const quality = computeQualityStatus(record.extracted_fields);
    return {
      ...record,
      possible_duplicate: duplicateIds.has(record.id),
      quality_status: quality.status,
      missing_fields: quality.missingFields,
    };
  });

  const filtered = enriched.filter((c) => {
    if (opts.runId && c.import_run_id !== opts.runId) return false;
    if (opts.category) {
      const category = (c.extracted_fields && c.extracted_fields.category) || null;
      if (category !== opts.category) return false;
    }
    if (opts.name) {
      const haystack = ((c.extracted_fields && c.extracted_fields.name) || '').toLowerCase();
      if (!haystack.includes(String(opts.name).toLowerCase())) return false;
    }
    if (opts.possibleDuplicate === true && !c.possible_duplicate) return false;
    if (opts.possibleDuplicate === false && c.possible_duplicate) return false;
    if (opts.quality && c.quality_status !== opts.quality) return false;
    return true;
  });

  return { candidates: filtered, totalBeforeFilters: records.length };
}

/**
 * Classifies which empty/error/populated state the UI should show — a
 * pure decision, directly testable, independent of React or fetch
 * timing. Deliberately never conflates three materially different
 * facts for a reviewer: "no ImportRun has ever run" vs. "this run
 * produced zero stored candidates" vs. "the current filters match
 * nothing." `showErrorBanner` is independent of `candidateState` — a
 * `partial` run can still have real candidates to show alongside its
 * errors, never one hiding the other.
 */
function classifyInboxState({ runsCount, selectedRun, candidatesCount, filtersActive }) {
  if (!runsCount) {
    return { candidateState: 'no-runs', showErrorBanner: false };
  }
  const showErrorBanner = Boolean(selectedRun && (selectedRun.status === 'failed' || selectedRun.status === 'partial'));
  let candidateState = 'has-candidates';
  if (typeof candidatesCount === 'number' && candidatesCount === 0) {
    candidateState = filtersActive ? 'no-filter-matches' : 'run-has-no-candidates';
  }
  return { candidateState, showErrorBanner };
}

module.exports = {
  ALLOWED_ROLE,
  isInternalOnly,
  formatDurationSeconds,
  buildRunSummary,
  normalizeName,
  haversineDistanceMeters,
  DUPLICATE_DISTANCE_METERS,
  computePossibleDuplicateIds,
  computeQualityStatus,
  enrichAndFilterCandidates,
  classifyInboxState,
};
