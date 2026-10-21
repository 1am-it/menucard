#!/usr/bin/env node
'use strict';

// Representative measurement of the 19 former holdout-2 sources (#59 Delivery
// Lead review 6316295818). After the single first evaluation these sources are
// `used_for_tuning`: representative, no longer unseen. This script measures
// the SAME sources again with the SAME code as the one-shot probe
// (ops/benchmark/holdoutEvaluation.js), and reports before/after per source.
//
// It is not a holdout evaluation and not an acceptance claim: there is no
// unseen set left, so invented items/prices remain "not measurable without a
// controlled reference". Thresholds are unchanged.
//
// Usage:
//   node ops/scripts/measure-menu-extraction-representative.js
//
// Output: ops/benchmark/holdout-2-representative-measurement.json (regenerable).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeSourceUrl } = require('../../src/lib/sourceAnalysisPipeline');
const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { loadMenuExtractionProtocol } = require('../../src/lib/menuExtractionProtocol');
const {
  assertApprovedHost,
  validateHoldoutManifest,
  holdoutSelectionDigest,
  repositoryTextSha256,
} = require('../benchmark/holdoutManifest');
const { evaluateSource } = require('../benchmark/holdoutEvaluation');
const { summarizeMenus: summarizeEvidence, aggregateHoldoutReport } = require('../benchmark/holdoutReport');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-2-sources.json');
const REFERENCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-2-references.json');
const EVALUATION_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-2-evaluation.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-2-representative-measurement.json');
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}


function beforeRow(result) {
  if (!result) return null;
  return {
    status: result.status || null,
    itemCount: Number.isInteger(result.itemCount) ? result.itemCount : null,
    sectionCount: Number.isInteger(result.categoryCount) ? result.categoryCount : null,
    menuCount: Number.isInteger(result.menuCount) ? result.menuCount : null,
    locatorPercent: percent(result.evidence && result.evidence.locatorPercent),
    supportPercent: percent(result.evidence && result.evidence.supportPercent),
    sourceIdPercent: percent(result.evidence && result.evidence.sourceIdPercent),
    sourceVersionMatches: result.sourceVersionMatches === undefined ? null : result.sourceVersionMatches,
    blockedReason: result.blockedReason || null,
    errors: result.errors || result.analysisError || null,
  };
}

function afterRow(result) {
  return {
    status: result.status || null,
    itemCount: Number.isInteger(result.itemCount) ? result.itemCount : null,
    sectionCount: Number.isInteger(result.categoryCount) ? result.categoryCount : null,
    menuCount: Number.isInteger(result.menuCount) ? result.menuCount : null,
    locatorPercent: percent(result.evidence && result.evidence.locatorPercent),
    supportPercent: percent(result.evidence && result.evidence.supportPercent),
    sourceIdPercent: percent(result.evidence && result.evidence.sourceIdPercent),
    sourceVersionMatches: result.sourceVersionMatches === undefined ? null : result.sourceVersionMatches,
    blockedReason: result.blockedReason || null,
    errors: result.errors || result.analysisError || null,
    limitations: (result.limitations || []).slice(0, 12),
  };
}

function delta(before, after) {
  if (!before || !after) return null;
  return {
    items: (after.itemCount || 0) - (before.itemCount || 0),
    sections: (after.sectionCount || 0) - (before.sectionCount || 0),
    locatorPercent: before.locatorPercent == null || after.locatorPercent == null ? null : after.locatorPercent - before.locatorPercent,
    supportPercent: before.supportPercent == null || after.supportPercent == null ? null : after.supportPercent - before.supportPercent,
  };
}

function percent(value) {
  return Number.isFinite(value) ? value : null;
}


async function main() {
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const validation = validateHoldoutManifest(manifest, { mode: 'representative' });
  if (!validation.ok) throw new Error(`representative measurement refused: ${validation.errors.join('; ')}`);
  const references = JSON.parse(fs.readFileSync(REFERENCES_PATH, 'utf8'));
  const previous = JSON.parse(fs.readFileSync(EVALUATION_PATH, 'utf8'));
  const protocol = loadMenuExtractionProtocol({ root: REPO_ROOT });

  const results = {};
  const sources = [];
  for (const source of manifest.sources) {
    const reference = references.sources[source.id];
    if (!reference) throw new Error(`representative measurement refused: no pinned reference for ${source.id}`);
    assertApprovedHost(reference.url, source.allowedHosts);
    const entry = { id: source.id, referenceId: source.id, label: source.label, url: source.url, allowedHosts: source.allowedHosts };
    const measured = await evaluateSource(entry, reference, {
      sha256,
      fetchWebsiteSafely,
      analyzeSourceUrl,
      maxBytes: MAX_BYTES,
      summarizeEvidence,
      resultNote: 'representative re-measurement, not a holdout observation',
    });
    results[source.id] = measured;
    const before = beforeRow(previous.results && previous.results[source.id]);
    const after = afterRow(measured);
    sources.push({
      id: source.id,
      restaurantId: source.restaurantId || null,
      label: source.label,
      url: source.url,
      before,
      after,
      delta: delta(before, after),
    });
    process.stdout.write(
      `${source.id} ${source.label}: items ${before ? before.itemCount : 'n/a'} -> ${after.itemCount}; sections ${before ? before.sectionCount : 'n/a'} -> ${after.sectionCount}; locator ${before && before.locatorPercent != null ? `${before.locatorPercent}%` : 'n/a'} -> ${after.locatorPercent == null ? 'n/a' : `${after.locatorPercent}%`}; ${after.status}${after.blockedReason ? ` (${after.blockedReason})` : ''}\n`,
    );
  }

  const output = {
    version: '1.0.0',
    issue: 59,
    purpose: 'representative_measurement',
    note: 'These 19 sources are used_for_tuning after their single first evaluation (GitHub #59 review 6316295818). This is a before/after representative measurement, not a holdout, not an accuracy claim and not an acceptance decision. Thresholds are unchanged; invented items/prices still need a controlled per-source reference.',
    measuredAt: new Date().toISOString(),
    manifest: {
      path: path.relative(REPO_ROOT, MANIFEST_PATH).split(path.sep).join('/'),
      sha256: repositoryTextSha256(manifestBytes),
      selectionDigest: holdoutSelectionDigest(manifest),
      lifecycle: manifest.lifecycle || null,
      representative: manifest.representative || null,
    },
    before: {
      path: path.relative(REPO_ROOT, EVALUATION_PATH).split(path.sep).join('/'),
      sha256: repositoryTextSha256(fs.readFileSync(EVALUATION_PATH)),
      aggregate: previous.aggregate || null,
    },
    protocol: { file: protocol.file, version: protocol.version, sha256: protocol.hash },
    authorization: { source: references.authorization || null, appProviderActivation: false },
    aggregate: aggregateHoldoutReport(results),
    sources,
    results,
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`\nwrote ${path.relative(REPO_ROOT, OUTPUT_PATH)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'representative measurement failed'}\n`);
  process.exitCode = 1;
});
