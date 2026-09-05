'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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
