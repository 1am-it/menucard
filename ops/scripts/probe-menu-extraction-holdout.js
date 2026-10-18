#!/usr/bin/env node
'use strict';

// First, independent read-only evaluation of the four approved #59 holdouts.
//
// The holdout references are pinned first by
// `capture-menu-extraction-holdout-references.js`. This script refuses to run
// again once the acceptance set records `evaluated_once`: a holdout may be
// evaluated at most once per pinned source version. It never writes to a
// database, confirms a source, saves a concept or publishes anything. It records
// what the real pipeline returned, including zero items and honest limits.
//
// Usage:
//   node ops/scripts/probe-menu-extraction-holdout.js
//
// Output: ops/benchmark/output/holdout-evaluation.json (create-only).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeSourceUrl } = require('../../src/lib/sourceAnalysisPipeline');
const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { loadMenuExtractionProtocol } = require('../../src/lib/menuExtractionProtocol');
const { validateHoldoutEntry } = require('../benchmark/acceptanceSetGuard');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REFERENCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-references.json');
const ACCEPTANCE_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'menu-extraction-acceptance-set.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-evaluation.json');
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function itemCount(menu) {
  return (menu.categories || []).reduce((total, category) => total + ((category.items || []).length), 0);
}

function summarizeMenus(analysis) {
  return (analysis.menuContexts || []).map((menu) => ({
    title: menu.title || null,
    sourceId: menu.sourceId || null,
    categoryCount: (menu.categories || []).length,
    itemCount: itemCount(menu),
    categories: (menu.categories || []).map((category) => ({
      name: category.name || null,
      path: category.path || [],
      sourcePath: category.sourcePath || null,
      uncertain: Boolean(category.uncertain),
      itemCount: (category.items || []).length,
    })),
  }));
}

function summarizeInventory(analysis) {
  return (analysis.sourceInventory || []).map((source) => ({
    url: source.url || null,
    kind: source.kind || null,
    status: source.status || null,
    pageCount: source.pageCount || null,
    wordCount: source.wordCount || null,
    itemCount: source.itemCount || null,
    contentHash: source.contentHash || null,
  }));
}

async function evaluateSource(entry, reference) {
  const started = Date.now();
  const base = {
    id: entry.id,
    referenceId: entry.referenceId,
    class: entry.class,
    url: reference.url,
    pinnedBytesSha256: reference.bytesSha256,
    captureStatus: reference.captureStatus,
    evaluatedAt: new Date().toISOString(),
  };
  if (reference.captureStatus !== 'captured') {
    return {
      ...base,
      status: 'blocked',
      completed: true,
      result: `The approved entry URL did not yield a readable public source (${reference.error}${reference.httpStatus ? ` ${reference.httpStatus}` : ''}). No alternative URL or other location was substituted.`,
      elapsedMs: Date.now() - started,
      limitations: [reference.note],
    };
  }

  let fetched;
  try {
    fetched = await fetchWebsiteSafely(reference.url, { encoding: 'buffer', maxBytes: MAX_BYTES, timeoutMs: 15000 });
  } catch (error) {
    return {
      ...base,
      status: 'blocked',
      completed: true,
      result: `The pinned source could not be read during the first evaluation: ${error.reason || error.message}.`,
      elapsedMs: Date.now() - started,
      limitations: ['No parser result is claimed for an unreadable source version.'],
    };
  }
  const bytesSha256 = sha256(fetched.bytes);
  const sourceVersionMatches = bytesSha256 === reference.bytesSha256;

  const analysisResult = await analyzeSourceUrl(reference.url);
  if (!analysisResult.ok) {
    return {
      ...base,
      status: 'blocked',
      completed: true,
      bytesSha256,
      sourceVersionMatches,
      analysisError: analysisResult.errorReason,
      result: `The real analysis pipeline refused the source: ${analysisResult.errorReason}.`,
      elapsedMs: Date.now() - started,
      limitations: ['A refusal is recorded as a limitation, never as an empty successful menu.'],
    };
  }

  const analysis = analysisResult.analysis;
  const menus = summarizeMenus(analysis);
  const itemTotal = menus.reduce((total, menu) => total + menu.itemCount, 0);
  const categoryTotal = menus.reduce((total, menu) => total + menu.categoryCount, 0);
  const limitations = (analysis.limitations || []).map((line) => String(line).slice(0, 500));
  return {
    ...base,
    status: 'executed_with_limitation',
    completed: true,
    bytesSha256,
    sourceVersionMatches,
    finalUrl: fetched.finalUrl,
    itemCount: itemTotal,
    categoryCount: categoryTotal,
    menuCount: menus.length,
    menus,
    sourceInventory: summarizeInventory(analysis),
    coverage: analysis.extractionResult ? analysis.extractionResult.coverage : null,
    attentionGroupCount: analysis.extractionResult ? (analysis.extractionResult.attentionGroups || []).length : 0,
    limitations,
    notes: (analysis.notes || []).map((line) => String(line).slice(0, 300)),
    result: itemTotal > 0
      ? `${itemTotal} items in ${categoryTotal} sections across ${menus.length} menu context(s). This is a first holdout observation, not a complete-menu or accuracy claim.`
      : 'No items were extracted. The source is recorded as an honest limitation, not as a successful menu.',
    elapsedMs: Date.now() - started,
  };
}

async function main() {
  if (fs.existsSync(OUTPUT_PATH)) {
    throw new Error(`holdout evaluation refused: ${path.relative(REPO_ROOT, OUTPUT_PATH)} already exists; a holdout is evaluated at most once`);
  }
  const references = JSON.parse(fs.readFileSync(REFERENCES_PATH, 'utf8'));
  const acceptance = JSON.parse(fs.readFileSync(ACCEPTANCE_PATH, 'utf8'));
  const protocol = loadMenuExtractionProtocol({ root: REPO_ROOT });
  const holdout = acceptance.holdout;
  if (!holdout || !Array.isArray(holdout.entries)) throw new Error('holdout evaluation refused: acceptance set has no holdout entries');
  for (const entry of holdout.entries) {
    const validation = validateHoldoutEntry(entry);
    if (!validation.ok) throw new Error(`holdout evaluation refused: ${validation.errors.join('; ')}`);
  }
  const candidates = holdout.entries.filter((entry) => entry.provenance === 'real_source' && entry.evaluationState === 'unused');
  if (candidates.length === 0) {
    throw new Error('holdout evaluation refused: no unused real holdout entries; a recorded holdout is not re-evaluated');
  }

  const results = {};
  for (const entry of candidates) {
    const reference = references.sources[entry.referenceId];
    if (!reference) throw new Error(`holdout evaluation refused: no pinned reference for ${entry.referenceId}`);
    results[entry.id] = await evaluateSource(entry, reference);
  }

  const output = {
    version: '1.0.0',
    issue: 59,
    evaluatedAt: new Date().toISOString(),
    protocol: { file: protocol.file, version: protocol.version, sha256: protocol.hash },
    authorization: references.authorization,
    noTuning: true,
    note: 'First recorded evaluation against the pinned holdout source versions. No parser or rule was changed from these outcomes; a later tuning use must move the source to representative and pin a new holdout.',
    results,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ path: path.relative(REPO_ROOT, OUTPUT_PATH), sources: Object.keys(results) }, null, 2)}\n`);
  for (const [id, result] of Object.entries(results)) {
    process.stderr.write(`${id}: ${result.status}; items ${result.itemCount == null ? 'n/a' : result.itemCount}; sections ${result.categoryCount == null ? 'n/a' : result.categoryCount}; versionMatch ${result.sourceVersionMatches == null ? 'n/a' : result.sourceVersionMatches}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'holdout evaluation failed'}\n`);
  process.exitCode = 1;
});

