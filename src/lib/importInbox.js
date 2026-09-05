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
  const reviewStatusByCandidateId = opts.reviewStatusByCandidateId || {};
  const enrichmentSourceByCandidateId = opts.enrichmentSourceByCandidateId || {};

  const enriched = records.map((record) => {
    const enrichmentSource = enrichmentSourceByCandidateId[record.id] || {};
    const enrichedFields = computeEnrichedFields(record.extracted_fields, enrichmentSource);
    // Quality is recomputed from the combined (raw + enrichment) fields —
    // per market-05-normalization-deduplication.md's own requirement — so
    // a manually-sourced phone/address/website can move a candidate from
    // "incomplete" to "complete" without ever touching the raw record.
    const quality = computeQualityStatus(enrichedFields);
    return {
      ...record,
      enriched_fields: enrichedFields,
      enrichment_sources: enrichmentSource,
      possible_duplicate: duplicateIds.has(record.id),
      quality_status: quality.status,
      missing_fields: quality.missingFields,
      review_status: reviewStatusByCandidateId[record.id] || DEFAULT_REVIEW_STATUS,
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
    if (opts.reviewStatus && c.review_status !== opts.reviewStatus) return false;
    return true;
  });

  return { candidates: filtered, totalBeforeFilters: records.length };
}

// ─── MARKET-05A (candidate review audit log) — pure decision logic for
// /api/internal/v1/import-inbox/candidates/[id]/reviews and the
// /internal/import-inbox detail view. The actual read/write against
// import_candidate_reviews happens only in the route handlers (via the
// record_import_candidate_review RPC for writes — see
// supabase/migrations/0007_market05a_candidate_reviews.sql); everything
// here is pure and never touches Supabase. ──────────────────────────────

/** The only statuses a review decision may ever actually be stored as —
 * deliberately excludes `'new'` (see DEFAULT_REVIEW_STATUS below) and
 * matches supabase/migrations/0007_market05a_candidate_reviews.sql's own
 * `status` check constraint exactly. */
const ALLOWED_REVIEW_STATUSES = ['needs_enrichment', 'approved_internal', 'rejected', 'deferred'];

/** Never stored — see the migration's own header comment for why. Purely
 * the application-level meaning of "no review row exists yet for this
 * candidate," computed by computeEffectiveReviewStatus/
 * buildReviewStatusByCandidateId below whenever a candidate has zero
 * review rows. `approved_internal` means ready for internal enrichment
 * only — never public publication or a MenuCard; nothing in this module
 * or its callers ever proposes, computes, or writes such a thing. */
const DEFAULT_REVIEW_STATUS = 'new';

/** Fixed set, matching the migration's own `rejection_reason` check
 * constraint exactly — never free text. */
const ALLOWED_REJECTION_REASONS = ['not_a_restaurant', 'duplicate', 'permanently_closed', 'insufficient_data', 'other'];

/** Matches the migration's own `char_length(note) <= 2000` check —
 * enforced here too so a caller gets a clear, immediate `400` instead of
 * relying solely on the database constraint to reject an oversized note. */
const MAX_REVIEW_NOTE_LENGTH = 2000;

/**
 * Validates a review-decision request body before it ever reaches
 * `record_import_candidate_review` — a UX/clarity guard only, never the
 * authoritative check (the migration's check constraints are, enforced
 * regardless of what any caller sends). Never accepts `'new'` as a
 * status: recording "new" would be meaningless (equivalent to recording
 * nothing) and is never a real user action.
 *
 * `rejectionReason` is required exactly when `status === 'rejected'` and
 * forbidden otherwise — symmetric with the migration's own check
 * constraint, so a caller sees the same rule at the API layer as at the
 * database layer, never a confusing mismatch between the two.
 */
function validateReviewDecisionInput({ status, rejectionReason, note }) {
  if (!ALLOWED_REVIEW_STATUSES.includes(status)) {
    return { valid: false, reason: 'invalid-status' };
  }

  const needsReason = status === 'rejected';
  const hasReason = typeof rejectionReason === 'string' && rejectionReason.length > 0;
  if (needsReason && !hasReason) {
    return { valid: false, reason: 'missing-rejection-reason' };
  }
  if (!needsReason && hasReason) {
    return { valid: false, reason: 'rejection-reason-not-allowed' };
  }
  if (hasReason && !ALLOWED_REJECTION_REASONS.includes(rejectionReason)) {
    return { valid: false, reason: 'invalid-rejection-reason' };
  }

  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') {
      return { valid: false, reason: 'invalid-note' };
    }
    if (note.length > MAX_REVIEW_NOTE_LENGTH) {
      return { valid: false, reason: 'note-too-long' };
    }
  }

  return {
    valid: true,
    status,
    rejectionReason: needsReason ? rejectionReason : null,
    note: note ? note.trim() || null : null,
  };
}

/** One safe, human-readable message per validation failure reason —
 * never the raw request body or any other caller-controlled value. */
function reviewValidationMessage(reason) {
  if (reason === 'invalid-status') return `Status must be one of: ${ALLOWED_REVIEW_STATUSES.join(', ')}.`;
  if (reason === 'missing-rejection-reason') return 'A rejection reason is required when status is "rejected".';
  if (reason === 'rejection-reason-not-allowed') return 'A rejection reason is only allowed when status is "rejected".';
  if (reason === 'invalid-rejection-reason') return `Rejection reason must be one of: ${ALLOWED_REJECTION_REASONS.join(', ')}.`;
  if (reason === 'invalid-note') return 'Note must be a string.';
  if (reason === 'note-too-long') return `Note must be at most ${MAX_REVIEW_NOTE_LENGTH} characters.`;
  return 'Invalid request.';
}

/**
 * Picks the effective status for one candidate from its full review
 * history — the row with the latest `decided_at`, tying-broken by the
 * higher `id` (review rows are inserted with a monotonically increasing
 * `bigint identity` id, so this is a safe, deterministic tie-break for
 * two decisions recorded within the same timestamp resolution). Returns
 * `DEFAULT_REVIEW_STATUS` ('new') when given no rows — never throws,
 * never guesses at a status from partial/malformed input.
 */
function computeEffectiveReviewStatus(reviewRows) {
  if (!Array.isArray(reviewRows) || reviewRows.length === 0) {
    return DEFAULT_REVIEW_STATUS;
  }
  let latest = null;
  for (const row of reviewRows) {
    if (!row || !row.decided_at) continue;
    if (!latest) {
      latest = row;
      continue;
    }
    const latestTime = new Date(latest.decided_at).getTime();
    const rowTime = new Date(row.decided_at).getTime();
    if (rowTime > latestTime || (rowTime === latestTime && Number(row.id) > Number(latest.id))) {
      latest = row;
    }
  }
  return latest ? latest.status : DEFAULT_REVIEW_STATUS;
}

/**
 * Groups an unordered list of review rows (as returned by a single,
 * un-filtered `import_candidate_reviews` query covering many candidates)
 * by `candidate_id` and reduces each group to its effective status —
 * exactly the `{candidateId: status}` shape `enrichAndFilterCandidates`
 * expects as its `reviewStatusByCandidateId` option. Pure; never touches
 * Supabase — the route handler runs the one query, this function turns
 * its rows into a lookup.
 */
function buildReviewStatusByCandidateId(allReviewRows) {
  const byCandidateId = {};
  for (const row of allReviewRows || []) {
    if (!row || !row.candidate_id) continue;
    if (!byCandidateId[row.candidate_id]) byCandidateId[row.candidate_id] = [];
    byCandidateId[row.candidate_id].push(row);
  }
  const result = {};
  for (const candidateId of Object.keys(byCandidateId)) {
    result[candidateId] = computeEffectiveReviewStatus(byCandidateId[candidateId]);
  }
  return result;
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

// ─── MARKET-05A (candidate enrichment audit log) — pure decision logic
// for /api/internal/v1/import-inbox/candidates/[id]/enrichments and the
// /internal/import-inbox detail view's enrichment form. The actual
// read/write against import_candidate_enrichments happens only in the
// route handlers (via the record_candidate_enrichments RPC for writes —
// see supabase/migrations/0008_market05a_candidate_enrichments.sql);
// everything here is pure and never touches Supabase.
//
// Deliberately, structurally independent of the review-decision audit
// table and RPC defined above in this same file — nothing below this
// point reads a review row or its free-text note field, and nothing
// below this point calls or references that RPC. A reviewer who
// previously typed a phone number, address, or URL into such a note
// must deliberately re-enter it through this feature's own form; see
// market-05-normalization-deduplication.md's "Enrichment vs. review
// notes" section for the full reasoning. ────────────────────────────────

/** The only fields this feature is scoped to enrich — matches
 * supabase/migrations/0008_market05a_candidate_enrichments.sql's own
 * `field_name` check constraint exactly. Never `name`/`category`/
 * `location` — extending this list is a separate, later, deliberate
 * decision. */
const ENRICHABLE_FIELDS = ['address', 'phone', 'website'];

/** Defense-in-depth alongside the migration's own `char_length` habits
 * (mirrors MAX_REVIEW_NOTE_LENGTH's role for review notes) — generous
 * enough for a real address/phone/URL, not a place for arbitrary text. */
const MAX_ENRICHMENT_VALUE_LENGTH = 500;

/**
 * True only for a syntactically valid `http://`/`https://` URL — never
 * `ftp:`, `mailto:`, a bare domain with no scheme, or a non-string.
 * Mirrors the migration's own `source_url ~* '^https?://'` check
 * constraint; kept as a real `URL` parse here (stricter than a regex)
 * so a caller gets a clear `400` before ever reaching the database.
 */
function isValidHttpUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch (err) {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Validates one `{field_name, value, source_url}` entry — a UX/clarity
 * guard only, never the authoritative check (the migration's check
 * constraints are, enforced regardless of what any caller sends).
 */
function validateEnrichmentFieldInput({ fieldName, value, sourceUrl }) {
  if (!ENRICHABLE_FIELDS.includes(fieldName)) {
    return { valid: false, reason: 'invalid-field-name' };
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { valid: false, reason: 'missing-value' };
  }
  if (value.trim().length > MAX_ENRICHMENT_VALUE_LENGTH) {
    return { valid: false, reason: 'value-too-long' };
  }
  if (!isValidHttpUrl(sourceUrl)) {
    return { valid: false, reason: 'invalid-source-url' };
  }
  return { valid: true, fieldName, value: value.trim(), sourceUrl: sourceUrl.trim() };
}

/**
 * Validates a whole enrichment request body — one or more fields from a
 * single form submission. Requires at least one entry, rejects a
 * duplicate `field_name` within the same submission (ambiguous — which
 * one would win?), and validates every entry with
 * `validateEnrichmentFieldInput` before accepting any of them, so a
 * caller never gets a partially-accepted request. Returns the first
 * validation failure encountered, or `{valid: true, fields: [...]}` with
 * every entry normalized (trimmed).
 */
function validateEnrichmentRequestInput(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { valid: false, reason: 'missing-fields' };
  }
  const seenFieldNames = new Set();
  const validated = [];
  for (const entry of fields) {
    const result = validateEnrichmentFieldInput({
      fieldName: entry && entry.field_name,
      value: entry && entry.value,
      sourceUrl: entry && entry.source_url,
    });
    if (!result.valid) {
      return result;
    }
    if (seenFieldNames.has(result.fieldName)) {
      return { valid: false, reason: 'duplicate-field-name' };
    }
    seenFieldNames.add(result.fieldName);
    validated.push(result);
  }
  return { valid: true, fields: validated };
}

/** One safe, human-readable message per validation failure reason. */
function enrichmentValidationMessage(reason) {
  if (reason === 'missing-fields') return 'At least one field is required.';
  if (reason === 'invalid-field-name') return `Field must be one of: ${ENRICHABLE_FIELDS.join(', ')}.`;
  if (reason === 'missing-value') return 'Value is required.';
  if (reason === 'value-too-long') return `Value must be at most ${MAX_ENRICHMENT_VALUE_LENGTH} characters.`;
  if (reason === 'invalid-source-url') return 'Source URL must be a valid http:// or https:// URL.';
  if (reason === 'duplicate-field-name') return 'Each field may only be submitted once per request.';
  return 'Invalid request.';
}

/**
 * Picks the effective enrichment row for one (candidate, field) pair
 * from its full history — the row with the latest `recorded_at`,
 * tie-broken by the higher `id` — same deterministic pattern as
 * `computeEffectiveReviewStatus`. Returns `null` given no rows.
 */
function pickLatestEnrichmentRow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let latest = null;
  for (const row of rows) {
    if (!row || !row.recorded_at) continue;
    if (!latest) {
      latest = row;
      continue;
    }
    const latestTime = new Date(latest.recorded_at).getTime();
    const rowTime = new Date(row.recorded_at).getTime();
    if (rowTime > latestTime || (rowTime === latestTime && Number(row.id) > Number(latest.id))) {
      latest = row;
    }
  }
  return latest;
}

/**
 * Groups an unordered list of enrichment rows (as returned by a single,
 * un-filtered `import_candidate_enrichments` query covering many
 * candidates) by `candidate_id`, then by `field_name`, and reduces each
 * (candidate, field) group to its effective row —
 * `{ [candidateId]: { [fieldName]: { value, source_url, recorded_at,
 * reviewer_id } } }`. Pure; never touches Supabase.
 */
function buildEnrichmentSourceByCandidateId(allEnrichmentRows) {
  const byCandidate = {};
  for (const row of allEnrichmentRows || []) {
    if (!row || !row.candidate_id || !row.field_name) continue;
    if (!byCandidate[row.candidate_id]) byCandidate[row.candidate_id] = {};
    if (!byCandidate[row.candidate_id][row.field_name]) byCandidate[row.candidate_id][row.field_name] = [];
    byCandidate[row.candidate_id][row.field_name].push(row);
  }
  const result = {};
  for (const candidateId of Object.keys(byCandidate)) {
    result[candidateId] = {};
    for (const fieldName of Object.keys(byCandidate[candidateId])) {
      const latest = pickLatestEnrichmentRow(byCandidate[candidateId][fieldName]);
      if (latest) {
        result[candidateId][fieldName] = {
          value: latest.value,
          source_url: latest.source_url,
          recorded_at: latest.recorded_at,
          reviewer_id: latest.reviewer_id,
        };
      }
    }
  }
  return result;
}

/**
 * Computes the *displayed* field set for one candidate: the raw
 * `extractedFields` with any enriched field's value overridden by its
 * latest, effective enrichment — never the reverse (a raw value never
 * overrides a real enrichment). Fields with no enrichment at all keep
 * their raw value (present or absent) unchanged. Never mutates
 * `extractedFields`; the raw record itself is never touched by this or
 * any other function in this module.
 */
function computeEnrichedFields(extractedFields, enrichmentSourceForCandidate) {
  const fields = { ...(extractedFields || {}) };
  const source = enrichmentSourceForCandidate || {};
  for (const fieldName of ENRICHABLE_FIELDS) {
    if (source[fieldName]) {
      fields[fieldName] = source[fieldName].value;
    }
  }
  return fields;
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
  ALLOWED_REVIEW_STATUSES,
  DEFAULT_REVIEW_STATUS,
  ALLOWED_REJECTION_REASONS,
  MAX_REVIEW_NOTE_LENGTH,
  validateReviewDecisionInput,
  reviewValidationMessage,
  computeEffectiveReviewStatus,
  buildReviewStatusByCandidateId,
  ENRICHABLE_FIELDS,
  MAX_ENRICHMENT_VALUE_LENGTH,
  isValidHttpUrl,
  validateEnrichmentFieldInput,
  validateEnrichmentRequestInput,
  enrichmentValidationMessage,
  pickLatestEnrichmentRow,
  buildEnrichmentSourceByCandidateId,
  computeEnrichedFields,
};
