'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ALLOWED_ROLE,
  isInternalOnly,
  formatDurationSeconds,
  buildRunSummary,
  haversineDistanceMeters,
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
  computeNormalizedFields,
  shouldCollapseCandidateCardAfterAction,
} = require('./importInbox');

// ─── Authorization: internal-only, never editor/owner ────────────────────

test('isInternalOnly: true only when the internal role is present', () => {
  assert.equal(ALLOWED_ROLE, 'internal');
  assert.equal(isInternalOnly([{ role: 'internal', restaurant_id: null }]), true);
  assert.equal(isInternalOnly([{ role: 'editor', restaurant_id: null }, { role: 'internal', restaurant_id: null }]), true);
});

test('isInternalOnly: false for editor-only, owner-only, or no roles at all', () => {
  assert.equal(isInternalOnly([{ role: 'editor', restaurant_id: null }]), false);
  assert.equal(isInternalOnly([{ role: 'owner', restaurant_id: '6' }]), false);
  assert.equal(isInternalOnly([{ role: 'editor' }, { role: 'owner', restaurant_id: '6' }]), false);
  assert.equal(isInternalOnly([]), false);
});

test('isInternalOnly: never throws on malformed input', () => {
  assert.equal(isInternalOnly(null), false);
  assert.equal(isInternalOnly(undefined), false);
  assert.equal(isInternalOnly('not-an-array'), false);
});

// ─── formatDurationSeconds ─────────────────────────────────────────────

test('formatDurationSeconds: computes a normal duration', () => {
  assert.equal(formatDurationSeconds('2026-09-05T07:06:25.626Z', '2026-09-05T07:07:35.031Z'), 69);
});

test('formatDurationSeconds: null when the run has not completed yet', () => {
  assert.equal(formatDurationSeconds('2026-09-05T07:06:25.626Z', null), null);
  assert.equal(formatDurationSeconds(null, null), null);
});

test('formatDurationSeconds: null on malformed timestamps or a completed_at before started_at, never negative', () => {
  assert.equal(formatDurationSeconds('not-a-date', '2026-09-05T07:07:35.031Z'), null);
  assert.equal(formatDurationSeconds('2026-09-05T07:07:35.031Z', '2026-09-05T07:06:25.626Z'), null);
});

// ─── buildRunSummary — the exact shape the runs API returns ──────────────

test('buildRunSummary: resolves both source names and computes duration', () => {
  const run = {
    id: 'run-1',
    status: 'succeeded',
    started_at: '2026-09-05T07:06:25.626Z',
    completed_at: '2026-09-05T07:07:35.031Z',
    record_counts: { fetched: 665, stored: 500, skipped: 165, errored: 0 },
    error_log: [],
    source_locator: 'https://download.geofabrik.de/europe/netherlands-260904.osm.pbf',
    source_version: 'netherlands-260904.osm.pbf',
    data_origin_source_id: 'osm-id',
    access_provider_source_id: 'geofabrik-id',
  };
  const summary = buildRunSummary(run, { 'osm-id': 'OpenStreetMap', 'geofabrik-id': 'Geofabrik — Netherlands OSM extract' });
  assert.equal(summary.data_origin_source_name, 'OpenStreetMap');
  assert.equal(summary.access_provider_source_name, 'Geofabrik — Netherlands OSM extract');
  assert.equal(summary.duration_seconds, 69);
  assert.deepEqual(summary.record_counts, { fetched: 665, stored: 500, skipped: 165, errored: 0 });
});

test('buildRunSummary: access_provider_source_name is null when there is no access provider (e.g. Kadaster/PDOK-style runs)', () => {
  const run = {
    id: 'run-2',
    status: 'succeeded',
    started_at: null,
    completed_at: null,
    record_counts: {},
    error_log: [],
    source_locator: 'x',
    source_version: null,
    data_origin_source_id: 'osm-id',
    access_provider_source_id: null,
  };
  const summary = buildRunSummary(run, { 'osm-id': 'OpenStreetMap' });
  assert.equal(summary.access_provider_source_name, null);
});

test('buildRunSummary: an unresolvable source id yields null, never a crash', () => {
  const run = {
    id: 'run-3',
    status: 'succeeded',
    started_at: null,
    completed_at: null,
    record_counts: {},
    error_log: null,
    source_locator: 'x',
    source_version: null,
    data_origin_source_id: 'unknown-id',
    access_provider_source_id: null,
  };
  const summary = buildRunSummary(run, {});
  assert.equal(summary.data_origin_source_name, null);
  assert.deepEqual(summary.error_log, []);
});

// ─── computeQualityStatus ──────────────────────────────────────────────

test('computeQualityStatus: complete when name/address/phone/website are all present', () => {
  const result = computeQualityStatus({ name: 'X', address: 'Y', phone: 'Z', website: 'W', category: 'restaurant' });
  assert.deepEqual(result, { status: 'complete', missingFields: [] });
});

test('computeQualityStatus: incomplete names exactly which fields are missing', () => {
  const result = computeQualityStatus({ name: 'X', category: 'restaurant' });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.missingFields.sort(), ['address', 'phone', 'website']);
});

test('computeQualityStatus: an empty/undefined extracted_fields never throws', () => {
  assert.doesNotThrow(() => computeQualityStatus(undefined));
  assert.equal(computeQualityStatus({}).status, 'incomplete');
});

// ─── computePossibleDuplicateIds ───────────────────────────────────────

test('haversineDistanceMeters: roughly correct for a known short distance', () => {
  // Two points ~111m apart (0.001 degrees of latitude).
  const d = haversineDistanceMeters(51.5800, 4.7800, 51.5810, 4.7800);
  assert.ok(d > 100 && d < 120, `expected ~111m, got ${d}`);
});

test('computePossibleDuplicateIds: flags two same-name candidates within the distance threshold', () => {
  const candidates = [
    { id: '1', extracted_fields: { name: 'Cafe Central', location: { lat: 51.58, lon: 4.78 } } },
    { id: '2', extracted_fields: { name: 'cafe central', location: { lat: 51.5801, lon: 4.7801 } } }, // case/whitespace-insensitive, ~14m away
  ];
  const duplicates = computePossibleDuplicateIds(candidates);
  assert.equal(duplicates.has('1'), true);
  assert.equal(duplicates.has('2'), true);
});

test('computePossibleDuplicateIds: does not flag the same name far apart', () => {
  const candidates = [
    { id: '1', extracted_fields: { name: 'Cafe Central', location: { lat: 51.58, lon: 4.78 } } },
    { id: '2', extracted_fields: { name: 'Cafe Central', location: { lat: 52.3676, lon: 4.9041 } } }, // Amsterdam — far away
  ];
  const duplicates = computePossibleDuplicateIds(candidates);
  assert.equal(duplicates.size, 0);
});

test('computePossibleDuplicateIds: does not flag different names nearby', () => {
  const candidates = [
    { id: '1', extracted_fields: { name: 'Cafe Central', location: { lat: 51.58, lon: 4.78 } } },
    { id: '2', extracted_fields: { name: 'Restaurant Alfa', location: { lat: 51.5801, lon: 4.7801 } } },
  ];
  const duplicates = computePossibleDuplicateIds(candidates);
  assert.equal(duplicates.size, 0);
});

test('computePossibleDuplicateIds: candidates missing a name or location are never compared, never throw', () => {
  const candidates = [
    { id: '1', extracted_fields: { location: { lat: 51.58, lon: 4.78 } } }, // no name
    { id: '2', extracted_fields: { name: 'Cafe Central' } }, // no location
    { id: '3', extracted_fields: { name: 'Cafe Central', location: { lat: 51.58, lon: 4.78 } } },
  ];
  assert.doesNotThrow(() => computePossibleDuplicateIds(candidates));
  const duplicates = computePossibleDuplicateIds(candidates);
  assert.equal(duplicates.size, 0);
});

// ─── enrichAndFilterCandidates ─────────────────────────────────────────

function makeCandidate(id, runId, fields) {
  return { id, import_run_id: runId, record_locator: `loc-${id}`, retrieved_at: '2026-09-05T00:00:00Z', extracted_fields: fields };
}

test('enrichAndFilterCandidates: totalBeforeFilters always reflects the full, unfiltered set', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'A', category: 'restaurant', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-b', { name: 'B', category: 'cafe', location: { lat: 51.59, lon: 4.79 } }),
  ];
  const { totalBeforeFilters } = enrichAndFilterCandidates(records, { runId: 'run-a' });
  assert.equal(totalBeforeFilters, 2);
});

test('enrichAndFilterCandidates: filters by run', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'A', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-b', { name: 'B', location: { lat: 51.59, lon: 4.79 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, { runId: 'run-a' });
  assert.deepEqual(candidates.map((c) => c.id), ['1']);
});

test('enrichAndFilterCandidates: filters by category', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'A', category: 'restaurant', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-a', { name: 'B', category: 'cafe', location: { lat: 51.59, lon: 4.79 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, { category: 'cafe' });
  assert.deepEqual(candidates.map((c) => c.id), ['2']);
});

test('enrichAndFilterCandidates: filters by name substring, case-insensitively', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'Fixture Restaurant Inside', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-a', { name: 'Fixture Cafe', location: { lat: 51.59, lon: 4.79 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, { name: 'restaurant' });
  assert.deepEqual(candidates.map((c) => c.id), ['1']);
});

test('enrichAndFilterCandidates: filters by possible_duplicate true/false', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'Cafe Central', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-a', { name: 'Cafe Central', location: { lat: 51.5801, lon: 4.7801 } }),
    makeCandidate('3', 'run-a', { name: 'Unique Place', location: { lat: 51.6, lon: 4.8 } }),
  ];
  const dupOnly = enrichAndFilterCandidates(records, { possibleDuplicate: true }).candidates;
  assert.deepEqual(dupOnly.map((c) => c.id).sort(), ['1', '2']);

  const nonDupOnly = enrichAndFilterCandidates(records, { possibleDuplicate: false }).candidates;
  assert.deepEqual(nonDupOnly.map((c) => c.id), ['3']);
});

test('enrichAndFilterCandidates: filters by quality status', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'A', address: 'x', phone: 'y', website: 'z', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-a', { name: 'B', location: { lat: 51.59, lon: 4.79 } }),
  ];
  const complete = enrichAndFilterCandidates(records, { quality: 'complete' }).candidates;
  assert.deepEqual(complete.map((c) => c.id), ['1']);
  const incomplete = enrichAndFilterCandidates(records, { quality: 'incomplete' }).candidates;
  assert.deepEqual(incomplete.map((c) => c.id), ['2']);
});

test('enrichAndFilterCandidates: duplicate detection still spans across runs, even when filtering down to one run', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'Cafe Central', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-b', { name: 'Cafe Central', location: { lat: 51.5801, lon: 4.7801 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, { runId: 'run-a' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].possible_duplicate, true, 'must still be flagged even though its cross-run duplicate was filtered out of the result');
});

test('enrichAndFilterCandidates: combined filters narrow correctly', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'Fixture Restaurant', category: 'restaurant', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-a', { name: 'Fixture Cafe', category: 'cafe', location: { lat: 51.59, lon: 4.79 } }),
    makeCandidate('3', 'run-b', { name: 'Fixture Restaurant', category: 'restaurant', location: { lat: 51.6, lon: 4.8 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, { runId: 'run-a', category: 'restaurant' });
  assert.deepEqual(candidates.map((c) => c.id), ['1']);
});

// ─── classifyInboxState ─────────────────────────────────────────────────

test('classifyInboxState: no runs at all', () => {
  assert.deepEqual(classifyInboxState({ runsCount: 0, selectedRun: null, candidatesCount: 0, filtersActive: false }), {
    candidateState: 'no-runs',
    showErrorBanner: false,
  });
});

test('classifyInboxState: a run with real candidates and no filters', () => {
  const result = classifyInboxState({
    runsCount: 1,
    selectedRun: { status: 'succeeded' },
    candidatesCount: 500,
    filtersActive: false,
  });
  assert.deepEqual(result, { candidateState: 'has-candidates', showErrorBanner: false });
});

test('classifyInboxState: a run that produced zero stored candidates (no filters active)', () => {
  const result = classifyInboxState({
    runsCount: 1,
    selectedRun: { status: 'succeeded' },
    candidatesCount: 0,
    filtersActive: false,
  });
  assert.deepEqual(result, { candidateState: 'run-has-no-candidates', showErrorBanner: false });
});

test('classifyInboxState: zero results because of active filters, distinct from a genuinely empty run', () => {
  const result = classifyInboxState({
    runsCount: 1,
    selectedRun: { status: 'succeeded' },
    candidatesCount: 0,
    filtersActive: true,
  });
  assert.deepEqual(result, { candidateState: 'no-filter-matches', showErrorBanner: false });
});

test('classifyInboxState: a failed/partial run shows the error banner alongside whatever candidates it does have', () => {
  const withCandidates = classifyInboxState({
    runsCount: 1,
    selectedRun: { status: 'partial' },
    candidatesCount: 12,
    filtersActive: false,
  });
  assert.deepEqual(withCandidates, { candidateState: 'has-candidates', showErrorBanner: true });

  const withoutCandidates = classifyInboxState({
    runsCount: 1,
    selectedRun: { status: 'failed' },
    candidatesCount: 0,
    filtersActive: false,
  });
  assert.deepEqual(withoutCandidates, { candidateState: 'run-has-no-candidates', showErrorBanner: true });
});

// ─── MARKET-05A candidate reviews — validateReviewDecisionInput ──────────

test('validateReviewDecisionInput: constants match the migration exactly', () => {
  assert.deepEqual(ALLOWED_REVIEW_STATUSES, ['needs_enrichment', 'approved_internal', 'rejected', 'deferred']);
  assert.equal(DEFAULT_REVIEW_STATUS, 'new');
  assert.equal(ALLOWED_REVIEW_STATUSES.includes(DEFAULT_REVIEW_STATUS), false, "'new' must never be a storable status");
  assert.deepEqual(ALLOWED_REJECTION_REASONS, ['not_a_restaurant', 'duplicate', 'permanently_closed', 'insufficient_data', 'other']);
});

test('validateReviewDecisionInput: rejects "new" and any other unrecognized status', () => {
  assert.deepEqual(validateReviewDecisionInput({ status: 'new' }), { valid: false, reason: 'invalid-status' });
  assert.deepEqual(validateReviewDecisionInput({ status: 'approved' }), { valid: false, reason: 'invalid-status' });
  assert.deepEqual(validateReviewDecisionInput({ status: undefined }), { valid: false, reason: 'invalid-status' });
});

test('validateReviewDecisionInput: accepts a non-rejection status with no rejection reason', () => {
  for (const status of ['needs_enrichment', 'approved_internal', 'deferred']) {
    const result = validateReviewDecisionInput({ status });
    assert.deepEqual(result, { valid: true, status, rejectionReason: null, note: null });
  }
});

test('validateReviewDecisionInput: "rejected" requires one of the fixed rejection reasons', () => {
  assert.deepEqual(validateReviewDecisionInput({ status: 'rejected' }), { valid: false, reason: 'missing-rejection-reason' });
  assert.deepEqual(validateReviewDecisionInput({ status: 'rejected', rejectionReason: '' }), {
    valid: false,
    reason: 'missing-rejection-reason',
  });
  assert.deepEqual(validateReviewDecisionInput({ status: 'rejected', rejectionReason: 'not_on_the_list' }), {
    valid: false,
    reason: 'invalid-rejection-reason',
  });
  assert.deepEqual(validateReviewDecisionInput({ status: 'rejected', rejectionReason: 'duplicate' }), {
    valid: true,
    status: 'rejected',
    rejectionReason: 'duplicate',
    note: null,
  });
});

test('validateReviewDecisionInput: a rejection reason on a non-rejection status is refused', () => {
  assert.deepEqual(validateReviewDecisionInput({ status: 'deferred', rejectionReason: 'duplicate' }), {
    valid: false,
    reason: 'rejection-reason-not-allowed',
  });
});

test('validateReviewDecisionInput: note is optional, trimmed, and length-capped', () => {
  assert.deepEqual(validateReviewDecisionInput({ status: 'deferred', note: '  needs a second look  ' }), {
    valid: true,
    status: 'deferred',
    rejectionReason: null,
    note: 'needs a second look',
  });
  assert.deepEqual(validateReviewDecisionInput({ status: 'deferred', note: '   ' }), {
    valid: true,
    status: 'deferred',
    rejectionReason: null,
    note: null,
  });
  assert.deepEqual(validateReviewDecisionInput({ status: 'deferred', note: 123 }), { valid: false, reason: 'invalid-note' });
  assert.deepEqual(validateReviewDecisionInput({ status: 'deferred', note: 'x'.repeat(MAX_REVIEW_NOTE_LENGTH + 1) }), {
    valid: false,
    reason: 'note-too-long',
  });
  assert.deepEqual(validateReviewDecisionInput({ status: 'deferred', note: 'x'.repeat(MAX_REVIEW_NOTE_LENGTH) }).valid, true);
});

test('reviewValidationMessage: returns a distinct, non-empty message per reason, never echoing raw input', () => {
  const reasons = [
    'invalid-status',
    'missing-rejection-reason',
    'rejection-reason-not-allowed',
    'invalid-rejection-reason',
    'invalid-note',
    'note-too-long',
  ];
  const messages = reasons.map(reviewValidationMessage);
  assert.equal(new Set(messages).size, messages.length, 'every reason must map to a distinct message');
  for (const m of messages) assert.ok(m.length > 0);
  assert.equal(reviewValidationMessage('something-unrecognized'), 'Invalid request.');
});

// ─── computeEffectiveReviewStatus / buildReviewStatusByCandidateId ───────
// This is the "append-only, latest decision wins" guarantee at the pure-
// function level: recording a second decision must never overwrite the
// first row (the database grants make that structurally impossible —
// see 0007_market05a_candidate_reviews.sql), but the *displayed* status
// must still reflect only the newest one.

test('computeEffectiveReviewStatus: no rows at all means "new"', () => {
  assert.equal(computeEffectiveReviewStatus([]), 'new');
  assert.equal(computeEffectiveReviewStatus(undefined), 'new');
  assert.equal(computeEffectiveReviewStatus(null), 'new');
});

test('computeEffectiveReviewStatus: a single decision is the effective status', () => {
  assert.equal(
    computeEffectiveReviewStatus([{ id: 1, decided_at: '2026-09-05T10:00:00Z', status: 'needs_enrichment' }]),
    'needs_enrichment'
  );
});

test('computeEffectiveReviewStatus: the latest decided_at wins, regardless of array order — never the first or last row blindly', () => {
  const rows = [
    { id: 2, decided_at: '2026-09-05T12:00:00Z', status: 'approved_internal' },
    { id: 1, decided_at: '2026-09-05T10:00:00Z', status: 'needs_enrichment' },
    { id: 3, decided_at: '2026-09-05T11:00:00Z', status: 'deferred' },
  ];
  assert.equal(computeEffectiveReviewStatus(rows), 'approved_internal');
  // Reversed input order must produce the identical result.
  assert.equal(computeEffectiveReviewStatus([...rows].reverse()), 'approved_internal');
});

test('computeEffectiveReviewStatus: ties on decided_at break toward the higher id (the later-inserted row)', () => {
  const rows = [
    { id: 5, decided_at: '2026-09-05T10:00:00Z', status: 'needs_enrichment' },
    { id: 6, decided_at: '2026-09-05T10:00:00Z', status: 'rejected' },
  ];
  assert.equal(computeEffectiveReviewStatus(rows), 'rejected');
});

test('computeEffectiveReviewStatus: malformed rows (missing decided_at) are skipped, never crash', () => {
  const rows = [
    { id: 1, status: 'needs_enrichment' }, // no decided_at
    { id: 2, decided_at: '2026-09-05T10:00:00Z', status: 'deferred' },
  ];
  assert.doesNotThrow(() => computeEffectiveReviewStatus(rows));
  assert.equal(computeEffectiveReviewStatus(rows), 'deferred');
});

test('buildReviewStatusByCandidateId: groups by candidate_id and reduces each group independently', () => {
  const rows = [
    { id: 1, candidate_id: 'a', decided_at: '2026-09-05T10:00:00Z', status: 'needs_enrichment' },
    { id: 2, candidate_id: 'a', decided_at: '2026-09-05T11:00:00Z', status: 'approved_internal' },
    { id: 3, candidate_id: 'b', decided_at: '2026-09-05T09:00:00Z', status: 'rejected' },
  ];
  assert.deepEqual(buildReviewStatusByCandidateId(rows), { a: 'approved_internal', b: 'rejected' });
});

test('buildReviewStatusByCandidateId: a candidate with no rows at all simply never appears in the map — callers default it to "new"', () => {
  assert.deepEqual(buildReviewStatusByCandidateId([]), {});
  assert.deepEqual(buildReviewStatusByCandidateId(undefined), {});
});

// ─── enrichAndFilterCandidates: review_status attachment + filter ────────

test('enrichAndFilterCandidates: attaches "new" when no review rows exist for a candidate', () => {
  const records = [makeCandidate('1', 'run-a', { name: 'A', location: { lat: 51.58, lon: 4.78 } })];
  const { candidates } = enrichAndFilterCandidates(records, {});
  assert.equal(candidates[0].review_status, 'new');
});

test('enrichAndFilterCandidates: attaches the effective status from reviewStatusByCandidateId when present', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'A', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-a', { name: 'B', location: { lat: 51.59, lon: 4.79 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, {
    reviewStatusByCandidateId: { '1': 'approved_internal' },
  });
  assert.equal(candidates.find((c) => c.id === '1').review_status, 'approved_internal');
  assert.equal(candidates.find((c) => c.id === '2').review_status, 'new');
});

test('enrichAndFilterCandidates: filters by review_status', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'A', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-a', { name: 'B', location: { lat: 51.59, lon: 4.79 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, {
    reviewStatusByCandidateId: { '1': 'approved_internal' },
    reviewStatus: 'approved_internal',
  });
  assert.deepEqual(candidates.map((c) => c.id), ['1']);
});

// ─── Structural safety net: append-only behavior and "never a public/
// canonical write" are read directly from the actual source files, not
// asserted from memory — this fails the moment either guarantee is
// weakened by a future edit, in either the route or the migration. ─────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REVIEW_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/import-inbox/candidates/[id]/reviews/route.js');
const CANDIDATES_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/import-inbox/candidates/route.js');
const RUNS_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/import-inbox/runs/route.js');
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase/migrations/0007_market05a_candidate_reviews.sql');

// Consumer-facing canonical data does not live in a Supabase table in
// this project at all yet (see docs/api/import-inbox-api.md) — it is
// static JSON under data/. "Never a canonical/public write" therefore
// means: never touch any of these table/file identifiers from this
// feature's own files.
const FORBIDDEN_CANONICAL_IDENTIFIERS = ['restaurants', 'menus', 'dishes', 'data/restaurants.json', 'data/menus.json'];

test('structural safety net: the candidate-reviews route never calls .update()/.delete(), and never references a canonical/public identifier', () => {
  const source = fs.readFileSync(REVIEW_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /\.update\(/, 'no code path may ever attempt to update a review row — recording a decision is always a new row');
  assert.doesNotMatch(source, /\.delete\(/, 'no code path may ever attempt to delete a review row');
  for (const identifier of FORBIDDEN_CANONICAL_IDENTIFIERS) {
    assert.equal(source.includes(identifier), false, `must never reference "${identifier}"`);
  }
  assert.doesNotMatch(source, /writeFileSync|appendFileSync/, 'must never write to any file on disk');
});

test('structural safety net: the candidates list route never calls .update()/.delete()/.insert(), and never references a canonical/public identifier', () => {
  const source = fs.readFileSync(CANDIDATES_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /\.(update|delete|insert)\(/, 'this route is read-only — GET only, no write of any kind');
  for (const identifier of FORBIDDEN_CANONICAL_IDENTIFIERS) {
    assert.equal(source.includes(identifier), false, `must never reference "${identifier}"`);
  }
});

test('structural safety net: the runs list route never calls .update()/.delete()/.insert(), and never references a canonical/public identifier', () => {
  const source = fs.readFileSync(RUNS_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /\.(update|delete|insert)\(/, 'this route is read-only — GET only, no write of any kind');
  for (const identifier of FORBIDDEN_CANONICAL_IDENTIFIERS) {
    assert.equal(source.includes(identifier), false, `must never reference "${identifier}"`);
  }
});

test('structural safety net: the migration grants only select+insert on import_candidate_reviews — no update, no delete, for any role', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(sql, /grant select, insert on public\.import_candidate_reviews to service_role/);
  // The only "update"/"delete" occurring anywhere in this migration must
  // be inside prose comments, never a real `grant update`/`grant delete`
  // statement — a real grant would always be followed by "on public." in
  // this project's own migration style (see 0004/0006's own grants).
  assert.doesNotMatch(sql, /grant\s+(?:[\w,\s]*\b)?(update|delete)\b[\w,\s]*\bon\s+public\.import_candidate_reviews/i);
});

// ─── MARKET-05A candidate enrichments — validateEnrichmentFieldInput /
// validateEnrichmentRequestInput ──────────────────────────────────────

test('isValidHttpUrl: accepts only syntactically valid http(s) URLs', () => {
  assert.equal(isValidHttpUrl('https://example.com'), true);
  assert.equal(isValidHttpUrl('http://example.com/contact'), true);
  assert.equal(isValidHttpUrl('ftp://example.com'), false);
  assert.equal(isValidHttpUrl('mailto:x@example.com'), false);
  assert.equal(isValidHttpUrl('example.com'), false, 'no scheme at all');
  assert.equal(isValidHttpUrl(''), false);
  assert.equal(isValidHttpUrl('   '), false);
  assert.equal(isValidHttpUrl(null), false);
  assert.equal(isValidHttpUrl(undefined), false);
  assert.equal(isValidHttpUrl(123), false);
  assert.doesNotThrow(() => isValidHttpUrl('not a url at all'));
});

test('validateEnrichmentFieldInput: constants match the migration exactly', () => {
  assert.deepEqual(ENRICHABLE_FIELDS, ['address', 'phone', 'website']);
});

test('validateEnrichmentFieldInput: rejects a field name outside the fixed set (e.g. name/category/location)', () => {
  for (const fieldName of ['name', 'category', 'location', 'osm_node_id', '']) {
    assert.deepEqual(
      validateEnrichmentFieldInput({ fieldName, value: 'x', sourceUrl: 'https://example.com' }),
      { valid: false, reason: 'invalid-field-name' },
      `expected fieldName=${JSON.stringify(fieldName)} to be rejected`
    );
  }
});

test('validateEnrichmentFieldInput: rejects a missing/empty/too-long value', () => {
  assert.deepEqual(validateEnrichmentFieldInput({ fieldName: 'phone', value: '', sourceUrl: 'https://example.com' }), {
    valid: false,
    reason: 'missing-value',
  });
  assert.deepEqual(validateEnrichmentFieldInput({ fieldName: 'phone', value: '   ', sourceUrl: 'https://example.com' }), {
    valid: false,
    reason: 'missing-value',
  });
  assert.deepEqual(
    validateEnrichmentFieldInput({ fieldName: 'phone', value: 'x'.repeat(MAX_ENRICHMENT_VALUE_LENGTH + 1), sourceUrl: 'https://example.com' }),
    { valid: false, reason: 'value-too-long' }
  );
});

test('validateEnrichmentFieldInput: rejects a missing/invalid source URL', () => {
  assert.deepEqual(validateEnrichmentFieldInput({ fieldName: 'phone', value: '+31 76 0000000', sourceUrl: '' }), {
    valid: false,
    reason: 'invalid-source-url',
  });
  assert.deepEqual(validateEnrichmentFieldInput({ fieldName: 'phone', value: '+31 76 0000000', sourceUrl: 'not-a-url' }), {
    valid: false,
    reason: 'invalid-source-url',
  });
  assert.deepEqual(validateEnrichmentFieldInput({ fieldName: 'phone', value: '+31 76 0000000', sourceUrl: 'ftp://example.com' }), {
    valid: false,
    reason: 'invalid-source-url',
  });
});

test('validateEnrichmentFieldInput: accepts and trims a valid entry', () => {
  assert.deepEqual(
    validateEnrichmentFieldInput({ fieldName: 'website', value: '  https://restaurant.example  ', sourceUrl: '  https://source.example/page  ' }),
    { valid: true, fieldName: 'website', value: 'https://restaurant.example', sourceUrl: 'https://source.example/page' }
  );
});

test('validateEnrichmentRequestInput: requires at least one field', () => {
  assert.deepEqual(validateEnrichmentRequestInput([]), { valid: false, reason: 'missing-fields' });
  assert.deepEqual(validateEnrichmentRequestInput(undefined), { valid: false, reason: 'missing-fields' });
  assert.deepEqual(validateEnrichmentRequestInput(null), { valid: false, reason: 'missing-fields' });
  assert.deepEqual(validateEnrichmentRequestInput('not-an-array'), { valid: false, reason: 'missing-fields' });
});

test('validateEnrichmentRequestInput: validates every entry, returning the first failure', () => {
  const result = validateEnrichmentRequestInput([
    { field_name: 'phone', value: '+31 76 0000000', source_url: 'https://example.com' },
    { field_name: 'website', value: '', source_url: 'https://example.com' },
  ]);
  assert.deepEqual(result, { valid: false, reason: 'missing-value' });
});

test('validateEnrichmentRequestInput: rejects a duplicate field_name within one submission', () => {
  const result = validateEnrichmentRequestInput([
    { field_name: 'phone', value: '+31 76 0000000', source_url: 'https://example.com' },
    { field_name: 'phone', value: '+31 76 1111111', source_url: 'https://example.com/other' },
  ]);
  assert.deepEqual(result, { valid: false, reason: 'duplicate-field-name' });
});

test('validateEnrichmentRequestInput: accepts multiple distinct, valid fields in one submission', () => {
  const result = validateEnrichmentRequestInput([
    { field_name: 'phone', value: '+31 76 0000000', source_url: 'https://example.com/contact' },
    { field_name: 'website', value: 'https://restaurant.example', source_url: 'https://example.com/contact' },
    { field_name: 'address', value: 'Fixturestraat 1, Breda', source_url: 'https://example.com/contact' },
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.fields.length, 3);
  assert.deepEqual(result.fields.map((f) => f.fieldName).sort(), ['address', 'phone', 'website']);
});

test('enrichmentValidationMessage: returns a distinct, non-empty message per reason', () => {
  const reasons = ['missing-fields', 'invalid-field-name', 'missing-value', 'value-too-long', 'invalid-source-url', 'duplicate-field-name'];
  const messages = reasons.map(enrichmentValidationMessage);
  assert.equal(new Set(messages).size, messages.length, 'every reason must map to a distinct message');
  for (const m of messages) assert.ok(m.length > 0);
  assert.equal(enrichmentValidationMessage('something-unrecognized'), 'Invalid request.');
});

// ─── pickLatestEnrichmentRow / buildEnrichmentSourceByCandidateId ────────
// Same "append-only, latest wins" guarantee as the review workflow: a
// correction is a brand-new row (the database grants make overwriting
// the old one structurally impossible), but the *displayed* value must
// reflect only the newest one.

test('pickLatestEnrichmentRow: no rows returns null', () => {
  assert.equal(pickLatestEnrichmentRow([]), null);
  assert.equal(pickLatestEnrichmentRow(undefined), null);
});

test('pickLatestEnrichmentRow: the latest recorded_at wins, regardless of array order', () => {
  const rows = [
    { id: 1, recorded_at: '2026-09-05T10:00:00Z', value: 'old' },
    { id: 2, recorded_at: '2026-09-05T12:00:00Z', value: 'new' },
    { id: 3, recorded_at: '2026-09-05T11:00:00Z', value: 'middle' },
  ];
  assert.equal(pickLatestEnrichmentRow(rows).value, 'new');
  assert.equal(pickLatestEnrichmentRow([...rows].reverse()).value, 'new');
});

test('pickLatestEnrichmentRow: ties on recorded_at break toward the higher id', () => {
  const rows = [
    { id: 5, recorded_at: '2026-09-05T10:00:00Z', value: 'a' },
    { id: 6, recorded_at: '2026-09-05T10:00:00Z', value: 'b' },
  ];
  assert.equal(pickLatestEnrichmentRow(rows).value, 'b');
});

test('buildEnrichmentSourceByCandidateId: groups by candidate then field, reducing each independently', () => {
  const rows = [
    { id: 1, candidate_id: 'a', field_name: 'phone', recorded_at: '2026-09-05T10:00:00Z', value: '+31 76 0000000', source_url: 'https://s1.example', reviewer_id: 'r1' },
    { id: 2, candidate_id: 'a', field_name: 'phone', recorded_at: '2026-09-05T11:00:00Z', value: '+31 76 1111111', source_url: 'https://s2.example', reviewer_id: 'r2' },
    { id: 3, candidate_id: 'a', field_name: 'website', recorded_at: '2026-09-05T10:00:00Z', value: 'https://a.example', source_url: 'https://s3.example', reviewer_id: 'r1' },
    { id: 4, candidate_id: 'b', field_name: 'address', recorded_at: '2026-09-05T09:00:00Z', value: 'Somestraat 1', source_url: 'https://s4.example', reviewer_id: 'r3' },
  ];
  const result = buildEnrichmentSourceByCandidateId(rows);
  assert.deepEqual(Object.keys(result).sort(), ['a', 'b']);
  assert.deepEqual(Object.keys(result.a).sort(), ['phone', 'website']);
  assert.equal(result.a.phone.value, '+31 76 1111111', 'the later phone correction wins');
  assert.equal(result.a.phone.source_url, 'https://s2.example');
  assert.equal(result.a.website.value, 'https://a.example');
  assert.equal(result.b.address.value, 'Somestraat 1');
});

test('buildEnrichmentSourceByCandidateId: no rows at all yields an empty map', () => {
  assert.deepEqual(buildEnrichmentSourceByCandidateId([]), {});
  assert.deepEqual(buildEnrichmentSourceByCandidateId(undefined), {});
});

// ─── computeEnrichedFields ────────────────────────────────────────────

test('computeEnrichedFields: with no enrichment, the raw fields pass through unchanged', () => {
  const raw = { name: 'X', category: 'restaurant' };
  assert.deepEqual(computeEnrichedFields(raw, {}), raw);
  assert.deepEqual(computeEnrichedFields(raw, undefined), raw);
});

test('computeEnrichedFields: an enrichment overrides the raw value for that field only', () => {
  const raw = { name: 'X', address: 'Old address', category: 'restaurant' };
  const source = { address: { value: 'New verified address', source_url: 'https://example.com', recorded_at: 'now', reviewer_id: 'r1' } };
  const result = computeEnrichedFields(raw, source);
  assert.equal(result.address, 'New verified address');
  assert.equal(result.name, 'X', 'unenriched fields are untouched');
  assert.equal(result.category, 'restaurant');
});

test('computeEnrichedFields: an enrichment can fill in a field the raw record never had at all', () => {
  const raw = { name: 'X', category: 'restaurant' }; // no phone
  const source = { phone: { value: '+31 76 0000000', source_url: 'https://example.com', recorded_at: 'now', reviewer_id: 'r1' } };
  const result = computeEnrichedFields(raw, source);
  assert.equal(result.phone, '+31 76 0000000');
});

test('computeEnrichedFields: never mutates the raw extractedFields object', () => {
  const raw = { name: 'X', address: 'Old' };
  const source = { address: { value: 'New', source_url: 'https://example.com', recorded_at: 'now', reviewer_id: 'r1' } };
  computeEnrichedFields(raw, source);
  assert.equal(raw.address, 'Old', 'the raw object passed in must be unchanged');
});

// ─── computeNormalizedFields — the centralized display layer ──────────

test('computeNormalizedFields: normalizes address/phone/website, leaves other fields untouched', () => {
  const { fields, details } = computeNormalizedFields({
    name: 'X',
    category: 'restaurant',
    address: '4811aa   Breda',
    phone: '06-12345678',
    website: 'HTTP://Example.COM/x',
  });
  assert.equal(fields.name, 'X');
  assert.equal(fields.category, 'restaurant');
  assert.equal(fields.address, '4811 AA Breda');
  assert.equal(fields.phone, '06 12345678', 'the shown value is the readable Dutch display, never the bare +31 storage form');
  assert.equal(fields.website, 'http://example.com/x');
  assert.equal(details.phone.normalized, '+31612345678', 'the canonical storage/comparison form is still available in details');
});

test('computeNormalizedFields: an absent field is neither added nor normalized', () => {
  const { fields, details } = computeNormalizedFields({ name: 'X' });
  assert.equal('address' in fields, false);
  assert.equal('phone' in fields, false);
  assert.equal('website' in fields, false);
  assert.deepEqual(details, {});
});

test('computeNormalizedFields: an invalid/uncertain phone is shown completely unchanged, never guessed at', () => {
  const { fields, details } = computeNormalizedFields({ phone: 'call us for info' });
  assert.equal(fields.phone, 'call us for info');
  assert.equal(details.phone.valid, false);
});

test('computeNormalizedFields: never mutates the input object', () => {
  const input = { address: '4811aa Breda' };
  computeNormalizedFields(input);
  assert.equal(input.address, '4811aa Breda');
});

// ─── shouldCollapseCandidateCardAfterAction ────────────────────────────

test('shouldCollapseCandidateCardAfterAction: collapses only on a genuine success', () => {
  assert.equal(shouldCollapseCandidateCardAfterAction({ ok: true }), true);
});

test('shouldCollapseCandidateCardAfterAction: never collapses on failure, a missing outcome, or malformed input', () => {
  assert.equal(shouldCollapseCandidateCardAfterAction({ ok: false }), false);
  assert.equal(shouldCollapseCandidateCardAfterAction({ ok: false, message: 'Recording failed' }), false);
  assert.equal(shouldCollapseCandidateCardAfterAction(null), false);
  assert.equal(shouldCollapseCandidateCardAfterAction(undefined), false);
  assert.equal(shouldCollapseCandidateCardAfterAction({}), false);
  assert.equal(shouldCollapseCandidateCardAfterAction({ ok: 'true' }), false, 'must be the literal boolean true, never a truthy string');
});

// ─── enrichAndFilterCandidates + enrichment integration: complete/
// incomplete is recomputed from the combined view ───────────────────────

test('enrichAndFilterCandidates: an incomplete candidate becomes complete once every missing field is enriched, without touching extracted_fields', () => {
  const records = [makeCandidate('1', 'run-a', { name: 'A', location: { lat: 51.58, lon: 4.78 } })]; // missing address/phone/website
  const enrichmentSourceByCandidateId = {
    '1': {
      address: { value: 'Fixturestraat 1', source_url: 'https://s.example', recorded_at: '2026-09-05T10:00:00Z', reviewer_id: 'r1' },
      phone: { value: '+31 76 0000000', source_url: 'https://s.example', recorded_at: '2026-09-05T10:00:00Z', reviewer_id: 'r1' },
      website: { value: 'https://a.example', source_url: 'https://s.example', recorded_at: '2026-09-05T10:00:00Z', reviewer_id: 'r1' },
    },
  };
  const { candidates } = enrichAndFilterCandidates(records, { enrichmentSourceByCandidateId });
  const candidate = candidates[0];
  assert.equal(candidate.quality_status, 'complete');
  assert.deepEqual(candidate.missing_fields, []);
  assert.deepEqual(candidate.enriched_fields.address, 'Fixturestraat 1');
  assert.deepEqual(candidate.extracted_fields, { name: 'A', location: { lat: 51.58, lon: 4.78 } }, 'the raw record itself is never touched');
});

test('enrichAndFilterCandidates: a partial enrichment (only one of several missing fields) narrows missing_fields but stays incomplete', () => {
  const records = [makeCandidate('1', 'run-a', { name: 'A', location: { lat: 51.58, lon: 4.78 } })];
  const enrichmentSourceByCandidateId = {
    '1': { phone: { value: '+31 76 0000000', source_url: 'https://s.example', recorded_at: '2026-09-05T10:00:00Z', reviewer_id: 'r1' } },
  };
  const { candidates } = enrichAndFilterCandidates(records, { enrichmentSourceByCandidateId });
  assert.equal(candidates[0].quality_status, 'incomplete');
  assert.deepEqual(candidates[0].missing_fields.sort(), ['address', 'website']);
});

test('enrichAndFilterCandidates: the quality filter operates on the enriched (combined) status, not the raw one', () => {
  const records = [makeCandidate('1', 'run-a', { name: 'A', location: { lat: 51.58, lon: 4.78 } })]; // raw: incomplete
  const enrichmentSourceByCandidateId = {
    '1': {
      address: { value: 'X', source_url: 'https://s.example', recorded_at: 'now', reviewer_id: 'r1' },
      phone: { value: 'X', source_url: 'https://s.example', recorded_at: 'now', reviewer_id: 'r1' },
      website: { value: 'X', source_url: 'https://s.example', recorded_at: 'now', reviewer_id: 'r1' },
    },
  };
  const completeOnly = enrichAndFilterCandidates(records, { enrichmentSourceByCandidateId, quality: 'complete' }).candidates;
  assert.deepEqual(completeOnly.map((c) => c.id), ['1'], 'now complete after enrichment, so it must match the "complete" filter');

  const incompleteOnly = enrichAndFilterCandidates(records, { quality: 'incomplete' }).candidates;
  assert.deepEqual(incompleteOnly.map((c) => c.id), ['1'], 'without enrichment data supplied, the same candidate is still incomplete');
});

test('enrichAndFilterCandidates: without any enrichmentSourceByCandidateId, behavior is identical to before this feature existed', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'A', address: 'x', phone: 'y', website: 'z', location: { lat: 51.58, lon: 4.78 } }),
    makeCandidate('2', 'run-a', { name: 'B', location: { lat: 51.59, lon: 4.79 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, {});
  assert.equal(candidates.find((c) => c.id === '1').quality_status, 'complete');
  assert.equal(candidates.find((c) => c.id === '2').quality_status, 'incomplete');
});

test('enrichAndFilterCandidates: normalized_fields shows the readable Dutch display, and extracted_fields/enriched_fields stay exactly as-is', () => {
  const records = [makeCandidate('1', 'run-a', { name: 'A', phone: '06-12345678', location: { lat: 51.58, lon: 4.78 } })];
  const { candidates } = enrichAndFilterCandidates(records, {});
  const candidate = candidates[0];
  assert.equal(candidate.extracted_fields.phone, '06-12345678', 'raw import value untouched');
  assert.equal(candidate.enriched_fields.phone, '06-12345678', 'no enrichment happened, so this still matches raw');
  assert.equal(candidate.normalized_fields.phone, '06 12345678', 'only the displayed, normalized view differs');
  assert.equal(candidate.normalization.phone.normalized, '+31612345678');
});

test('enrichAndFilterCandidates: a cosmetic-only normalization (e.g. postcode casing) can move a candidate from incomplete to complete', () => {
  const records = [
    makeCandidate('1', 'run-a', { name: 'A', address: '4811aa breda', phone: '06 12345678', website: 'https://a.example', location: { lat: 51.58, lon: 4.78 } }),
  ];
  const { candidates } = enrichAndFilterCandidates(records, {});
  // Not actually incomplete->complete here (all fields were already
  // present) — this specifically proves normalization runs on the same
  // pipeline stage quality is computed from, using the address field's
  // own postcode-casing change as the observable proof.
  assert.equal(candidates[0].normalized_fields.address, '4811 AA breda');
  assert.equal(candidates[0].quality_status, 'complete');
});

// ─── Structural safety net: append-only, no canonical/public write, and
// — the specific new risk this feature introduces — no code path ever
// reads a review row or its free-text `note` to derive an enrichment. ───

const ENRICHMENTS_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/import-inbox/candidates/[id]/enrichments/route.js');
const ENRICHMENTS_MIGRATION_PATH = path.join(REPO_ROOT, 'supabase/migrations/0008_market05a_candidate_enrichments.sql');

test('structural safety net: the enrichments route never calls .update()/.delete(), never references a canonical/public identifier, and never reads import_candidate_reviews or its note field', () => {
  const source = fs.readFileSync(ENRICHMENTS_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /\.update\(/, 'a correction is always a new row, never an update of a previous one');
  assert.doesNotMatch(source, /\.delete\(/);
  for (const identifier of FORBIDDEN_CANONICAL_IDENTIFIERS) {
    assert.equal(source.includes(identifier), false, `must never reference "${identifier}"`);
  }
  assert.doesNotMatch(source, /writeFileSync|appendFileSync/);
  assert.equal(source.includes('import_candidate_reviews'), false, 'must never read the review table — enrichment is a fully independent action');
  assert.doesNotMatch(source, /\.note\b/, 'must never read a review\'s free-text note');
});

test('structural safety net: the pure enrichment logic in importInbox.js never references import_candidate_reviews or a review note', () => {
  const source = fs.readFileSync(path.join(__dirname, 'importInbox.js'), 'utf8');
  // Scoped to the enrichment section only, so this cannot spuriously fail
  // on the review-workflow code above it in the same file (which
  // legitimately does mention import_candidate_reviews for itself).
  const sectionStart = source.indexOf('MARKET-05A (candidate enrichment audit log)');
  assert.ok(sectionStart > -1, 'expected to find the enrichment section header');
  // Ends before module.exports — that block legitimately lists every
  // export from the whole file, review-workflow names included, and is
  // not itself a functional dependency of the enrichment code above it.
  const sectionEnd = source.indexOf('module.exports', sectionStart);
  assert.ok(sectionEnd > sectionStart, 'expected to find module.exports after the enrichment section');
  const enrichmentSection = source.slice(sectionStart, sectionEnd);
  assert.equal(enrichmentSection.includes('import_candidate_reviews'), false);
  assert.equal(enrichmentSection.includes('reviewValidationMessage'), false);
  assert.equal(enrichmentSection.includes('rejection_reason'), false);
});

test('structural safety net: the migration grants only select+insert on import_candidate_enrichments — no update, no delete, for any role', () => {
  const sql = fs.readFileSync(ENRICHMENTS_MIGRATION_PATH, 'utf8');
  assert.match(sql, /grant select, insert on public\.import_candidate_enrichments to service_role/);
  assert.doesNotMatch(sql, /grant\s+(?:[\w,\s]*\b)?(update|delete)\b[\w,\s]*\bon\s+public\.import_candidate_enrichments/i);
});

test('structural safety net: the candidates list route (extended for enrichment) still never calls .update()/.delete()/.insert()', () => {
  const source = fs.readFileSync(CANDIDATES_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /\.(update|delete|insert)\(/, 'this route is read-only — GET only, no write of any kind');
});

// ─── Structural safety net: "Suggest data from website" never writes to
// Supabase — the explicit, named requirement for this feature. Its own
// SSRF/robots.txt behavior is covered end-to-end in
// src/lib/safeOutboundFetch.test.js and src/lib/candidateSuggestions.test.js;
// this only proves the route itself has no database write of any kind. ──

const SUGGEST_ROUTE_PATH = path.join(
  REPO_ROOT,
  'app/api/internal/v1/import-inbox/candidates/[id]/suggest-from-website/route.js'
);

test('structural safety net: the suggest-from-website route never writes to Supabase (no insert/update/delete/rpc), and never references a canonical/public identifier', () => {
  const source = fs.readFileSync(SUGGEST_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /\.(insert|update|delete|rpc)\(/, 'this route may only ever read — a suggestion is confirmed exclusively through the existing enrichments POST route');
  for (const identifier of FORBIDDEN_CANONICAL_IDENTIFIERS) {
    assert.equal(source.includes(identifier), false, `must never reference "${identifier}"`);
  }
  assert.doesNotMatch(source, /writeFileSync|appendFileSync/);
});

test('structural safety net: the suggest-from-website route only ever fetches the candidate\'s own stored website — never a caller-supplied URL', () => {
  const source = fs.readFileSync(SUGGEST_ROUTE_PATH, 'utf8');
  // The only two fetchWebsiteSafely call sites must be built from
  // `websiteUrl`/robots.txt-relative-to-it — never from `request.body`,
  // `request.json()`, or a raw query parameter, which would turn this
  // into an open fetch proxy.
  assert.doesNotMatch(source, /request\.(json|body|url)[^\n]*fetchWebsiteSafely|fetchWebsiteSafely\([^)]*request\./s);
  assert.match(source, /fetchWebsiteSafely\(`\$\{websiteUrl\.origin\}\/robots\.txt`/);
  assert.match(source, /fetchWebsiteSafely\(websiteUrl\.href, \{ maxRedirects: 0 \}\)/);
});

test('structural safety net: the suggest-from-website route disables redirects on both fetchWebsiteSafely calls and never fetches the target page when the robots.txt gate says not to', () => {
  const source = fs.readFileSync(SUGGEST_ROUTE_PATH, 'utf8');
  // Both the robots.txt fetch and the page fetch must set maxRedirects: 0,
  // so a redirect can never land on a destination whose robots.txt/path
  // was never checked (the bug this test guards against).
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const maxRedirectsZeroCount = (codeOnly.match(/maxRedirects:\s*0/g) || []).length;
  assert.equal(maxRedirectsZeroCount, 2, 'expected maxRedirects: 0 on both the robots.txt fetch and the page fetch');
  // The page fetch must be reachable only through the robots.txt gate's
  // own shouldFetchPage decision — never unconditionally.
  assert.match(source, /if \(!robotsGate\.shouldFetchPage\)/);
  assert.match(source, /return NextResponse\.json\(\{[\s\S]*?robots_txt_status: robotsGate\.status,[\s\S]*?suggestions: null/);
});
