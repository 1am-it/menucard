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
