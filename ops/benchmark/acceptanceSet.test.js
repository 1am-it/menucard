'use strict';

// Guards the pre-declared #59 acceptance set. It does not re-run the product
// tests (the real gates do that); it prevents the evidence from silently
// weakening: a missing coverage class, a real source outside the two allowed
// ones, an unseen claim for an already-tuned source, an unfetched candidate
// presented as executed, a lowered release threshold, or a browser entry
// without real output.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const manifest = require('./menu-extraction-acceptance-set.json');
const references = require('./source-references.json');
const holdoutReferences = require('./holdout-references.json');
const { loadMenuExtractionProtocol } = require('../../src/lib/menuExtractionProtocol');
const { validateHoldout, validateRepresentative } = require('./acceptanceSetGuard');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATUSES = new Set(['executed', 'executed_with_limitation', 'blocked', 'unsupported', 'not_available']);
const PROVENANCE = new Set(['real_source', 'synthetic_fixture', 'historical_dataset', 'candidate_unfetched']);
const REPRESENTATIVE_REAL_SOURCES = new Set(['smelt', 'blossem', 'debotanist', 'mrmoos', 'colonie']);
const HOLDOUT_REAL_SOURCES = new Set(['gauchosgrill']);
const MOVED_HOLDOUT_SOURCES = new Set(['debotanist', 'mrmoos', 'colonie']);
const BROWSER_EVIDENCE = path.join(REPO_ROOT, 'ops', 'browser', 'evidence', 'menu-review-browser-evidence.json');
const SHA256 = /^[0-9a-f]{64}$/;

function canonicalHash(file) {
  const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function allEntries() {
  return [...manifest.representative, ...manifest.holdout.entries];
}

test('the acceptance set is versioned and pins the exact protocol and schema versions', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.pinnedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(manifest.issue, 59);
  assert.equal(manifest.protocol.file, 'MENU-EXTRACTION.md');
  assert.equal(manifest.protocol.version, '0.4');
  assert.match(manifest.protocol.sha256, SHA256);
  const protocol = loadMenuExtractionProtocol({ root: REPO_ROOT });
  assert.equal(protocol.hash, manifest.protocol.sha256, 'runtime hash must match the pinned protocol hash');
  assert.equal(protocol.version, manifest.protocol.version);
  assert.equal(manifest.schemaVersions.extractionOutput, 'menu-extraction-output/v1');
  assert.equal(manifest.schemaVersions.extractionResult, 1);
});

test('every required coverage class has an executed representative and an explicit holdout slot', () => {
  const classes = Object.keys(manifest.requiredClasses);
  assert.equal(classes.length >= 8, true);
  for (const name of ['html', 'accordion_tabs', 'tables', 'text_pdf', 'scan_unreadable', 'language_branch', 'arrangement', 'price_variant']) {
    assert.ok(classes.includes(name), `required class ${name}`);
  }
  for (const name of classes) {
    const entries = manifest.representative.filter((entry) => entry.class === name);
    assert.ok(entries.length > 0, `representative coverage for ${name}`);
    assert.ok(
      entries.some((entry) => entry.status === 'executed' || entry.status === 'executed_with_limitation'),
      `at least one executed representative for ${name}`,
    );
    assert.ok(manifest.holdout.classCoverage[name], `holdout slot for ${name}`);
  }
  assert.deepEqual(Object.keys(manifest.holdout.classCoverage).sort(), [...classes].sort());
});

test('every entry is complete and uses the closed status/provenance vocabulary', () => {
  const ids = new Set();
  for (const entry of allEntries()) {
    assert.match(entry.id, /^(REP|HOLD)-[A-Z0-9-]+$/, entry.id);
    assert.equal(ids.has(entry.id), false, `duplicate id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(manifest.requiredClasses[entry.class], `${entry.id} has unknown class ${entry.class}`);
    assert.ok(PROVENANCE.has(entry.provenance), `${entry.id} has unknown provenance`);
    assert.ok(STATUSES.has(entry.status), `${entry.id} has unknown status`);
    assert.ok(typeof entry.sourceRef === 'string' && entry.sourceRef.length > 0, `${entry.id} sourceRef`);
    if (entry.status === 'blocked') assert.ok(typeof entry.reason === 'string' && entry.reason.length > 0, `${entry.id} blocked needs a reason`);
    if (entry.status === 'not_available') assert.ok(typeof entry.reason === 'string' && entry.reason.length > 0, `${entry.id} not_available needs a reason`);
  }
  for (const entry of manifest.representative) {
    assert.ok(Array.isArray(entry.expected) && entry.expected.length > 0, `${entry.id} expected`);
    assert.ok(Array.isArray(entry.tests) && entry.tests.length > 0, `${entry.id} tests`);
    if (entry.status === 'executed' || entry.status === 'executed_with_limitation') {
      assert.ok(typeof entry.result === 'string' && entry.result.length > 0, `${entry.id} executed needs a result`);
    }
    // No numeric item count may act as the pass rule.
    assert.equal(Object.prototype.hasOwnProperty.call(entry, 'expectedItemCount'), false, `${entry.id} must not hardcode an item count`);
    assert.equal(Object.prototype.hasOwnProperty.call(entry, 'expectedCounts'), false, `${entry.id} must not hardcode counts`);
  }
  for (const entry of manifest.holdout.entries) {
    assert.ok(['unused', 'evaluated_once', 'used_for_tuning'].includes(entry.evaluationState), `${entry.id} evaluationState`);
    assert.equal(typeof entry.usedForTuning, 'boolean', `${entry.id} usedForTuning`);
    assert.equal(Number.isInteger(entry.evaluationCount), true, `${entry.id} evaluationCount`);
    if (entry.status === 'executed' || entry.status === 'executed_with_limitation') {
      assert.ok(typeof entry.result === 'string' && entry.result.length > 0, `${entry.id} executed needs a result`);
      assert.match(entry.firstEvaluatedAt, /^\d{4}-\d{2}-\d{2}$/, `${entry.id} executed needs a date`);
    }
  }
});


test('representative real sources are the tuned public sources with pinned hashes', () => {
  const real = manifest.representative.filter((entry) => entry.provenance === 'real_source');
  assert.ok(real.length > 0);
  for (const entry of real) {
    assert.ok(REPRESENTATIVE_REAL_SOURCES.has(entry.referenceId), `${entry.id} uses unapproved representative source ${entry.referenceId}`);
    const reference = references.sources[entry.referenceId] || holdoutReferences.sources[entry.referenceId];
    assert.ok(reference, `${entry.id} reference exists`);
    assert.match(reference.bytesSha256, SHA256);
    const contentHash = reference.contentHash
      || (Array.isArray(reference.menuSources) ? reference.menuSources.map((source) => source.contentHash).find((hash) => hash) : null);
    if (contentHash) assert.match(contentHash, SHA256, `${entry.id} content hash`);
    const hashes = [reference.bytesSha256, ...(reference.menuSources || []).map((source) => source.bytesSha256)].filter(Boolean);
    assert.ok(hashes.some((hash) => entry.sourceVersion.includes(hash.slice(0, 8))), `${entry.id} pins a bytes hash prefix`);
  }
  for (const id of Object.keys(references.sources)) assert.ok(REPRESENTATIVE_REAL_SOURCES.has(id), `reference ${id}`);
});

test('holdout real sources are the remaining approved public source with capture-only pins', () => {
  const real = manifest.holdout.entries.filter((entry) => entry.provenance === 'real_source');
  assert.deepEqual(real.map((entry) => entry.referenceId).sort(), [...HOLDOUT_REAL_SOURCES].sort());
  for (const entry of real) {
    const reference = holdoutReferences.sources[entry.referenceId];
    assert.ok(reference, `${entry.id} has a pinned holdout reference`);
    assert.equal(reference.referenceMode, 'capture_only');
    assert.equal(reference.groundTruth, null);
    assert.equal(entry.usedForTuning, false, `${entry.id} is not a tuning source`);
    assert.notEqual(entry.evaluationState, 'used_for_tuning', `${entry.id} must move to representative if tuned`);
    if (reference.captureStatus === 'captured') assert.match(reference.bytesSha256, SHA256);
    else assert.equal(entry.status, 'blocked', `${entry.id} cannot claim a successful read`);
  }
  for (const id of Object.keys(holdoutReferences.sources)) {
    assert.ok(HOLDOUT_REAL_SOURCES.has(id) || MOVED_HOLDOUT_SOURCES.has(id), `holdout reference ${id}`);
  }
  for (const id of MOVED_HOLDOUT_SOURCES) assert.ok(REPRESENTATIVE_REAL_SOURCES.has(id), `moved source ${id} is representative`);
});

test('synthetic fixtures use fictional .invalid hosts; candidates stay unfetched and blocked', () => {
  for (const entry of manifest.representative.filter((e) => e.provenance === 'synthetic_fixture')) {
    const text = JSON.stringify(entry);
    const urls = text.match(/https?:\/\/[^\s"'\\]+/g) || [];
    for (const url of urls) {
      const host = new URL(url).hostname;
      assert.ok(host.endsWith('.invalid') || host === 'schema.org', `${entry.id} uses real-looking host ${host}`);
    }
  }
  for (const entry of manifest.holdout.entries.filter((e) => e.provenance === 'candidate_unfetched')) {
    assert.equal(entry.fetched, false, `${entry.id} must stay unfetched`);
    assert.equal(entry.status, 'blocked', `${entry.id} must not claim execution`);
    assert.match(entry.url, /^https?:\/\//, `${entry.id} names the candidate without fetching it`);
  }
});

test('historical cards are a pinned shape snapshot and never current truth', () => {
  const entry = manifest.representative.find((e) => e.class === 'historical_cards');
  assert.ok(entry);
  assert.equal(entry.provenance, 'historical_dataset');
  assert.equal(entry.sourceRef, 'data/menus.json');
  assert.equal(entry.truthClaim, false);
  const match = /sha256 ([0-9a-f]{64})/.exec(entry.sourceVersion);
  assert.ok(match, 'snapshot hash is pinned');
  assert.equal(canonicalHash('data/menus.json'), match[1], 'the pinned snapshot is the file in this commit');
});

test('representative and holdout are disjoint; a holdout is evaluated at most once and never tuned', () => {
  const repIds = new Set(manifest.representative.map((e) => e.id));
  const repSources = new Set(manifest.representative.filter((e) => e.provenance === 'real_source').map((e) => e.referenceId));
  for (const entry of manifest.holdout.entries) {
    assert.equal(repIds.has(entry.id), false, `${entry.id} appears in both sets`);
    assert.equal(entry.usedForTuning, false, `${entry.id} is not a tuning source`);
    assert.notEqual(entry.evaluationState, 'used_for_tuning', `${entry.id} must move to representative with a new holdout if tuned`);
    if (entry.referenceId) assert.equal(repSources.has(entry.referenceId), false, `${entry.id} reuses a tuned source`);
  }
  const holdoutValidation = validateHoldout(manifest.holdout);
  assert.equal(holdoutValidation.ok, true, holdoutValidation.errors.join('; '));
  const representativeValidation = validateRepresentative(manifest.representative);
  assert.equal(representativeValidation.ok, true, representativeValidation.errors.join('; '));
  for (const entry of manifest.representative.filter((e) => e.provenance === 'real_source')) {
    assert.equal(entry.usedForTuning, true, `${entry.id} must be marked as used for tuning`);
  }
});

test('release thresholds are fixed; unknown time and cost stay unknown', () => {
  const thresholds = manifest.releaseThresholds;
  assert.equal(thresholds.inventedDishes, 0);
  assert.equal(thresholds.inventedPrices, 0);
  assert.equal(thresholds.evidenceCoveragePercent, 100);
  assert.equal(thresholds.unexplainedCoverageItems, 0);
  assert.equal(thresholds.structureLossAccepted, 0);
  assert.equal(thresholds.priceErrorsAccepted, 0);
  assert.match(thresholds.manualCorrectionTime, /^unknown\b/);
  assert.match(thresholds.costPerSourceEurCents, /^unknown\b/);
});

test('an executed browser fixture entry must reference real, passing evidence', () => {
  const entry = manifest.representative.find((e) => e.id === 'REP-BROWSER-001');
  assert.ok(entry);
  if (entry.status !== 'executed' && entry.status !== 'executed_with_limitation') return;
  assert.equal(fs.existsSync(BROWSER_EVIDENCE), true, 'browser evidence file exists');
  const evidence = JSON.parse(fs.readFileSync(BROWSER_EVIDENCE, 'utf8'));
  assert.equal(evidence.fixtureOnly, true);
  assert.equal(evidence.passed, true);
  assert.ok(Array.isArray(evidence.checks) && evidence.checks.length >= 10);
  assert.ok(evidence.checks.every((check) => check.passed === true));
  for (const required of ['readonly:', 'empty:', 'partial:', 'error:', 'keyboard:', '320px/light:', '390px/dark:', 'no uncaught browser exception']) {
    assert.ok(evidence.checks.some((check) => check.name.includes(required)), `browser evidence covers ${required}`);
  }
  assert.ok(Array.isArray(evidence.screenshots) && evidence.screenshots.length >= 10);
  assert.ok(evidence.screenshots.some((shot) => shot.width === 320));
  assert.ok(evidence.screenshots.some((shot) => shot.width === 390));
  assert.ok(evidence.screenshots.every((shot) => /^[0-9a-f]{64}$/.test(shot.sha256) && shot.width > 0 && shot.height > 0));
  assert.match(evidence.head, /^[0-9a-f]{40}$|^pending-commit$/);
});
