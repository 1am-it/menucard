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

const { normalizeAddressNL, normalizePhoneNL, normalizeWebsite } = require('./candidateNormalization');

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
  const deferredReasonByCandidateId = opts.deferredReasonByCandidateId || {};

  const enriched = records.map((record) => {
    const enrichmentSource = enrichmentSourceByCandidateId[record.id] || {};
    const enrichedFields = computeEnrichedFields(record.extracted_fields, enrichmentSource);
    // The centrally-normalized *display* view (src/lib/candidateNormalization.js)
    // — never a replacement for extracted_fields/enrichmentSource, which
    // both stay exactly as recorded for audit. Quality is recomputed
    // from this normalized view — per market-05-normalization-deduplication.md's
    // own requirement — so a manually-sourced phone/address/website (or
    // even a purely cosmetic normalization, e.g. postcode casing) can
    // move a candidate from "incomplete" to "complete" without ever
    // touching the raw record or the enrichment audit row.
    const { fields: normalizedFields, details: normalization } = computeNormalizedFields(enrichedFields);
    const quality = computeQualityStatus(normalizedFields);
    return {
      ...record,
      enriched_fields: enrichedFields,
      normalized_fields: normalizedFields,
      normalization,
      enrichment_sources: enrichmentSource,
      possible_duplicate: duplicateIds.has(record.id),
      quality_status: quality.status,
      missing_fields: quality.missingFields,
      review_status: reviewStatusByCandidateId[record.id] || DEFAULT_REVIEW_STATUS,
      // Added 2026-09-06 for the triage overview: the *current* deferred
      // reason, i.e. only set when this candidate's effective status is
      // actually 'deferred' right now — never a stale reason left over
      // from an earlier decision that was since superseded (see
      // buildLatestDeferredReasonByCandidateId's own comment).
      deferred_reason: deferredReasonByCandidateId[record.id] || null,
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

/** Fixed set, matching
 * supabase/migrations/0009_market05a_candidate_reviews_deferred_reason.sql's
 * own `deferred_reason` check constraint exactly — never free text.
 * Added 2026-09-06: `deferred` previously had no structured reason at
 * all, only the free-text `note`, making deferred candidates hard to
 * triage in bulk. */
const ALLOWED_DEFERRED_REASONS = [
  'service_model_unclear',
  'chain_or_franchise_review',
  'ownership_or_permission_needed',
  'source_conflict',
  'verify_later',
];

/** Human-readable label per `ALLOWED_DEFERRED_REASONS` value — display
 * only, never written anywhere. The single source of truth for both the
 * "Deferred reason" dropdown and the review-history line in
 * app/internal/import-inbox/page.js, so the two can never drift apart —
 * always go through `formatDeferredReasonLabel` below rather than
 * indexing this object directly, since a raw stored/typed value may use
 * hyphens instead of underscores (see that function's own comment). */
const DEFERRED_REASON_LABELS = {
  service_model_unclear: 'Service model unclear',
  chain_or_franchise_review: 'Chain or franchise review',
  ownership_or_permission_needed: 'Ownership or permission needed',
  source_conflict: 'Source conflict',
  verify_later: 'Verify later',
};

/**
 * Human-readable label for a `deferred_reason` value — display only,
 * never touches the database, the audit history, or any API payload
 * (the raw value is always what gets stored/sent; this only decides
 * what a reviewer *sees*). Defensively normalizes hyphens to
 * underscores before lookup, so a legacy or manually-recorded value
 * like `chain-or-franchise-review` resolves to the exact same label as
 * the canonical `chain_or_franchise_review` — this project has never
 * written a hyphenated value itself (the migration's check constraint
 * only allows the underscore form), but a human-edited or
 * externally-sourced row is not assumed to have followed that
 * convention. A value that still isn't recognized after normalization
 * (or isn't a non-empty string at all) is returned completely
 * unchanged — never hidden, never guessed at, never altered — so an
 * unexpected value is always visible to the reviewer, just unformatted.
 */
function formatDeferredReasonLabel(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  const normalized = value.replace(/-/g, '_');
  return DEFERRED_REASON_LABELS[normalized] || value;
}

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
 * `deferredReason` (added 2026-09-06) follows the exact same symmetric
 * pattern for `status === 'deferred'`. This only governs *new* decisions
 * being validated right now — it says nothing about, and never
 * retroactively judges, an already-recorded `deferred` row that predates
 * this field and so has no `deferred_reason` at all (see
 * 0009_market05a_candidate_reviews_deferred_reason.sql's own `NOT VALID`
 * constraint and this file's own `buildReviewStatusByCandidateId`/
 * `computeEffectiveReviewStatus`, neither of which reads or requires
 * `deferred_reason` to treat an existing row as valid history).
 */
function validateReviewDecisionInput({ status, rejectionReason, note, deferredReason }) {
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

  const needsDeferredReason = status === 'deferred';
  const hasDeferredReason = typeof deferredReason === 'string' && deferredReason.length > 0;
  if (needsDeferredReason && !hasDeferredReason) {
    return { valid: false, reason: 'missing-deferred-reason' };
  }
  if (!needsDeferredReason && hasDeferredReason) {
    return { valid: false, reason: 'deferred-reason-not-allowed' };
  }
  if (hasDeferredReason && !ALLOWED_DEFERRED_REASONS.includes(deferredReason)) {
    return { valid: false, reason: 'invalid-deferred-reason' };
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
    deferredReason: needsDeferredReason ? deferredReason : null,
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
  if (reason === 'missing-deferred-reason') return 'A deferred reason is required when status is "deferred".';
  if (reason === 'deferred-reason-not-allowed') return 'A deferred reason is only allowed when status is "deferred".';
  if (reason === 'invalid-deferred-reason') return `Deferred reason must be one of: ${ALLOWED_DEFERRED_REASONS.join(', ')}.`;
  if (reason === 'invalid-note') return 'Note must be a string.';
  if (reason === 'note-too-long') return `Note must be at most ${MAX_REVIEW_NOTE_LENGTH} characters.`;
  return 'Invalid request.';
}

/**
 * Picks the single latest row from one candidate's full review
 * history — the row with the latest `decided_at`, tying-broken by the
 * higher `id` (review rows are inserted with a monotonically increasing
 * `bigint identity` id, so this is a safe, deterministic tie-break for
 * two decisions recorded within the same timestamp resolution). Returns
 * `null` given no rows — never throws, never guesses from partial/
 * malformed input. The one shared "latest review wins" rule this whole
 * feature depends on — computeEffectiveReviewStatus and
 * buildLatestDeferredReasonByCandidateId below both build on this
 * instead of each re-implementing the same tie-break.
 */
function pickLatestReviewRow(reviewRows) {
  if (!Array.isArray(reviewRows) || reviewRows.length === 0) {
    return null;
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
  return latest;
}

/**
 * Picks the effective status for one candidate from its full review
 * history — see pickLatestReviewRow for the tie-break rule. Returns
 * `DEFAULT_REVIEW_STATUS` ('new') when given no rows.
 */
function computeEffectiveReviewStatus(reviewRows) {
  const latest = pickLatestReviewRow(reviewRows);
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
 * Groups review rows by `candidate_id` and reduces each group to its
 * *current* deferred reason — added 2026-09-06 for the triage overview.
 * `null` unless that candidate's single latest review row (same
 * pickLatestReviewRow tie-break as buildReviewStatusByCandidateId) is
 * itself `status === 'deferred'`: a candidate that was deferred once and
 * later re-reviewed (e.g. now `approved_internal`) must never still show
 * its old deferred reason as if it were current. A legacy `deferred` row
 * recorded before `deferred_reason` existed (see
 * supabase/migrations/0009_market05a_candidate_reviews_deferred_reason.sql)
 * simply yields `null` here — exactly like having no reason at all,
 * never an error.
 */
function buildLatestDeferredReasonByCandidateId(allReviewRows) {
  const byCandidateId = {};
  for (const row of allReviewRows || []) {
    if (!row || !row.candidate_id) continue;
    if (!byCandidateId[row.candidate_id]) byCandidateId[row.candidate_id] = [];
    byCandidateId[row.candidate_id].push(row);
  }
  const result = {};
  for (const candidateId of Object.keys(byCandidateId)) {
    const latest = pickLatestReviewRow(byCandidateId[candidateId]);
    result[candidateId] = latest && latest.status === 'deferred' ? latest.deferred_reason || null : null;
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

// ─── Centralized normalization (src/lib/candidateNormalization.js) —
// applied only to the already-combined (raw + enrichment) view, purely
// for display/quality purposes. Never changes what `enriched_fields`
// itself contains, never touches the raw record or any enrichment audit
// row — see this file's own module.exports and
// candidateNormalization.js's own header comment for the full
// "never guess, always idempotent" contract each field normalizer
// follows. ────────────────────────────────────────────────────────────

const CANDIDATE_NORMALIZERS = {
  address: normalizeAddressNL,
  phone: normalizePhoneNL,
  website: normalizeWebsite,
};

/**
 * Runs each of `address`/`phone`/`website` present on `fields` through
 * its dedicated normalizer, returning `{ fields, details }`: `fields` is
 * a shallow copy of the input with those three keys replaced by their
 * `.display` form — the human-readable Dutch representation Data-inbox
 * actually shows (for `address`/`website` this is identical to
 * `.normalized`; for `phone` it is the "06 12345678"-style readable
 * form, never the bare `+31...` storage/comparison form) — every other
 * key (e.g. `name`/`category`/`location`) is passed through completely
 * untouched. `details` carries the *full* per-field normalizer result
 * (`value`/`normalized`/`display`/`changed`/`valid`) for whichever of
 * the three fields were actually present, so the UI can show, e.g., an
 * "unrecognized phone format" hint, and so callers needing the
 * canonical storage/comparison form (`.normalized`) — e.g.
 * candidateSuggestions.js's own field-conflict comparison — still have
 * it available. A field that was invalid/uncertain is not "fixed" —
 * `fields[name]` still ends up equal to the original value, per each
 * normalizer's own "never guess" contract.
 */
function computeNormalizedFields(fields) {
  const source = fields || {};
  const result = { ...source };
  const details = {};
  for (const fieldName of Object.keys(CANDIDATE_NORMALIZERS)) {
    if (source[fieldName] === undefined || source[fieldName] === null) continue;
    const normalizer = CANDIDATE_NORMALIZERS[fieldName];
    const outcome = normalizer(source[fieldName]);
    result[fieldName] = outcome.display;
    details[fieldName] = outcome;
  }
  return { fields: result, details };
}

// ─── Candidate-card UI decision: collapse only after a real success ────

/**
 * Whether a candidate's detail card should automatically collapse after
 * a review-decision or enrichment submission — `true` only when the
 * action actually succeeded (`outcome.ok === true`). A validation
 * failure or an API error must never collapse the card: the reviewer's
 * already-entered values need to stay visible and editable, per
 * market-05-normalization-deduplication.md's own "Data-inbox UX" note.
 * Pure and directly testable without a browser/DOM harness — the actual
 * `setExpandedCandidateId(null)` call happens only in
 * app/internal/import-inbox/page.js, which just calls this function.
 */
function shouldCollapseCandidateCardAfterAction(outcome) {
  return Boolean(outcome && outcome.ok === true);
}

// ─── Enrichment form UX fix (decided 2026-09-05): "use this source URL
// as the website" ────────────────────────────────────────────────────
//
// A reviewer who types one shared source URL to enrich several fields
// naturally experiences that URL as "the website" the suggest-from-
// website button should work against — but the button correctly stays
// disabled until a website value is actually saved as an enrichment
// (see hasVerifiedWebsiteForSuggestions below). This is a client-side
// form-fill convenience closing that friction — it never fetches
// anything and never writes anything by itself; the reviewer still has
// to click "Save enrichment" for the value to actually be recorded, and
// the suggest-from-website route's own security boundary is completely
// unchanged: it still only ever re-derives and fetches the candidate's
// own already-*saved* website (src/lib/importInbox.js's own
// computeEnrichedFields), never a URL read directly off this form.

/**
 * Whether the enrichment form should offer a "Use this source URL as
 * the website" shortcut — only when the reviewer has opted into one
 * shared source URL for every filled-in field, that URL is a
 * syntactically valid `http(s)` URL, and the Website field's own value
 * is still empty. Never offered once the reviewer has typed anything
 * into the Website value field themselves — this must never silently
 * overwrite it.
 */
function shouldOfferSharedSourceUrlAsWebsite({ useSharedSourceUrl, sharedSourceUrl, websiteValue }) {
  if (!useSharedSourceUrl) return false;
  if (!isValidHttpUrl(sharedSourceUrl)) return false;
  if (typeof websiteValue === 'string' && websiteValue.trim().length > 0) return false;
  return true;
}

/**
 * Pure enrichment-draft transform for that same shortcut: returns a new
 * draft with only the Website field's *value* set to `sharedSourceUrl`
 * — every other field, and the Website field's own separate source-URL
 * input, is passed through completely untouched (when the shared-
 * source-URL checkbox is on, every filled-in field's source URL is
 * already derived from `sharedSourceUrl` at submit time — see
 * app/internal/import-inbox/page.js's own `effectiveSourceUrl` — so
 * `Save enrichment` ends up recording the website with that same shared
 * URL as both its value and its source, per the ticket's own
 * requirement). Never mutates `draft`; no fetch, no write — this only
 * ever changes in-memory form state.
 */
function applySharedSourceUrlAsWebsite(draft, sharedSourceUrl) {
  const current = draft || {};
  const currentWebsite = current.website || {};
  return { ...current, website: { ...currentWebsite, value: sharedSourceUrl } };
}

// ─── Review-decision form UX fix (decided 2026-09-05): never submit
// without an explicit status ────────────────────────────────────────

/**
 * Whether the "Save decision" button should be enabled — `false` until
 * the reviewer has explicitly chosen one of `ALLOWED_REVIEW_STATUSES`.
 * A UX convenience only: `validateReviewDecisionInput` (and the
 * migration's own check constraint) remain the authoritative guard
 * either way, so leaving a candidate's detail view without ever
 * choosing a status can never record a decision, disabled button or
 * not — closing the card is always a plain, local state change with no
 * API call at all (see toggleExpand in
 * app/internal/import-inbox/page.js).
 */
function isReviewDecisionSubmittable(draft) {
  return Boolean(draft && ALLOWED_REVIEW_STATUSES.includes(draft.status));
}

// ─── Suggest-from-website button: only active once a website is already
// an on-record, saved fact ──────────────────────────────────────────

/**
 * Whether the "Suggest data from website" button should be enabled for
 * one candidate list row — `true` only when `normalized_fields.website`
 * is already present, i.e. a website value is already on record (raw
 * import data or a previously saved enrichment) as of the candidate
 * list's last load. This mirrors exactly what the suggest-from-website
 * route itself re-derives server-side before ever fetching anything
 * (computeEnrichedFields above, normalized for display by
 * computeNormalizedFields below) — the button can never disagree with
 * what the route would actually do, because both read the same
 * already-saved fact rather than anything typed into the form.
 */
function hasVerifiedWebsiteForSuggestions(candidate) {
  return Boolean(candidate && candidate.normalized_fields && candidate.normalized_fields.website);
}

// ─── Triage overview (added 2026-09-06) — read-only summary, filter, and
// search logic for the Data-inbox's "Review Overview" section (renamed
// 2026-09-06, later still, for terminology consistency — see
// planning/specs/tickets/market-05-normalization-deduplication.md's own
// glossary note; was "Triage overview")
// (app/internal/import-inbox/page.js). Everything below is pure
// and operates only on already-loaded candidate objects (each one
// already carrying `review_status`/`deferred_reason` from
// enrichAndFilterCandidates above) — no new query, no write, no
// automatic classification of any kind. Deliberately does NOT attempt
// chain/franchise name-matching or service-model classification — both
// are named, separate, later features; this only reflects the
// *human-recorded* review_status/deferred_reason exactly as decided. ───

/** Fixed display order for the triage summary counts — the five
 * possible effective statuses, `'new'` (never itself stored — see
 * DEFAULT_REVIEW_STATUS) first, then the four real, storable statuses in
 * the same order ALLOWED_REVIEW_STATUSES already uses everywhere else in
 * this file. */
const TRIAGE_SUMMARY_STATUSES = ['new', ...ALLOWED_REVIEW_STATUSES];

/**
 * Counts candidates per effective review status — the numbers shown at
 * the top of the triage overview. Always returns all five
 * `TRIAGE_SUMMARY_STATUSES` keys (defaulting to `0`), so the UI never
 * has to guess whether a bucket is "zero" or "missing." A candidate
 * whose `review_status` somehow isn't one of the five (should be
 * impossible, given `enrichAndFilterCandidates` always defaults to
 * `DEFAULT_REVIEW_STATUS`) is silently not counted anywhere, never
 * thrown on and never force-fit into the wrong bucket.
 */
function computeReviewStatusCounts(candidates) {
  const counts = {};
  for (const status of TRIAGE_SUMMARY_STATUSES) counts[status] = 0;
  for (const candidate of candidates || []) {
    const status = candidate && candidate.review_status;
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  }
  return counts;
}

/**
 * Which of the three triage buckets named in this feature's own
 * requirements a candidate currently falls into — `'needs_enrichment'`
 * (still needs enrichment), `'deferred'` (deliberately postponed, with
 * a structured reason where one was recorded), or
 * `'approved_pending_canonical'` (internally approved; ready only for
 * the *future*, not-yet-built **Restaurant Profile Drafts** step —
 * MARKET-05B, still just a placeholder — never a claim that such a step
 * is scheduled, running, or automatic; the identifier string itself
 * stays `'approved_pending_canonical'`, unchanged, since it is a
 * JS-internal key, never an API/database value). `'new'`
 * (not yet reviewed at all) and `'rejected'` (out of the pipeline) are
 * both real statuses but deliberately fall outside these three named
 * buckets — returned as `null`, never force-fit into one of the three.
 */
function computeCandidateTriageBucket(candidate) {
  const status = candidate && candidate.review_status;
  if (status === 'needs_enrichment') return 'needs_enrichment';
  if (status === 'deferred') return 'deferred';
  if (status === 'approved_internal') return 'approved_pending_canonical';
  return null;
}

/**
 * Case-insensitive substring search across a candidate's name and its
 * *currently displayed* (normalized) address/website — never the raw,
 * un-normalized fields, so a search matches exactly what the reviewer
 * sees on screen. An empty/whitespace-only `searchTerm` matches every
 * candidate (i.e. "no search active"), never zero candidates.
 */
function matchesTriageSearch(candidate, searchTerm) {
  if (typeof searchTerm !== 'string' || searchTerm.trim().length === 0) return true;
  if (!candidate) return false;
  const needle = searchTerm.trim().toLowerCase();
  const name = (candidate.extracted_fields && candidate.extracted_fields.name) || '';
  const address = (candidate.normalized_fields && candidate.normalized_fields.address) || '';
  const website = (candidate.normalized_fields && candidate.normalized_fields.website) || '';
  return (
    name.toLowerCase().includes(needle) || address.toLowerCase().includes(needle) || website.toLowerCase().includes(needle)
  );
}

/**
 * The triage overview's one combined filter: status, then — only
 * meaningful for `'deferred'` — the structured deferred reason, then the
 * name/address/website search above. Purely client-side, over an
 * already-loaded candidate array; never issues a request, never mutates
 * `candidates`. Filters compose with AND, exactly like the existing
 * browsing filters in `enrichAndFilterCandidates`.
 */
function filterCandidatesForTriage(candidates, { statusFilter, deferredReasonFilter, searchTerm } = {}) {
  return (candidates || []).filter((candidate) => {
    if (statusFilter && candidate.review_status !== statusFilter) return false;
    if (deferredReasonFilter && candidate.deferred_reason !== deferredReasonFilter) return false;
    if (!matchesTriageSearch(candidate, searchTerm)) return false;
    return true;
  });
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
  ALLOWED_DEFERRED_REASONS,
  DEFERRED_REASON_LABELS,
  formatDeferredReasonLabel,
  MAX_REVIEW_NOTE_LENGTH,
  validateReviewDecisionInput,
  reviewValidationMessage,
  pickLatestReviewRow,
  computeEffectiveReviewStatus,
  buildReviewStatusByCandidateId,
  buildLatestDeferredReasonByCandidateId,
  ENRICHABLE_FIELDS,
  MAX_ENRICHMENT_VALUE_LENGTH,
  isValidHttpUrl,
  validateEnrichmentFieldInput,
  validateEnrichmentRequestInput,
  enrichmentValidationMessage,
  pickLatestEnrichmentRow,
  buildEnrichmentSourceByCandidateId,
  computeEnrichedFields,
  CANDIDATE_NORMALIZERS,
  computeNormalizedFields,
  shouldCollapseCandidateCardAfterAction,
  shouldOfferSharedSourceUrlAsWebsite,
  applySharedSourceUrlAsWebsite,
  isReviewDecisionSubmittable,
  hasVerifiedWebsiteForSuggestions,
  TRIAGE_SUMMARY_STATUSES,
  computeReviewStatusCounts,
  computeCandidateTriageBucket,
  matchesTriageSearch,
  filterCandidatesForTriage,
};
