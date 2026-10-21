#!/usr/bin/env node
'use strict';

// First, independent read-only evaluation of a pinned #59 holdout.
//
// The holdout references are pinned first by
// `capture-menu-extraction-holdout-references.js`. A manifest with its own
// evaluation state (holdout-2) is passed explicitly with `--manifest`; the
// default stays the original holdout-1 path whose state lives in the
// acceptance set, so its committed output remains byte-identical.
//
// This script refuses to run again once its output exists: a holdout may be
// evaluated at most once per pinned source version. It never writes to a
// database, confirms a source, saves a concept or publishes anything. It
// records what the real pipeline returned, including zero items and honest
// limits, plus a per-source evidence/price audit and a per-type aggregate.
//
// Usage:
//   node ops/scripts/probe-menu-extraction-holdout.js
//   node ops/scripts/probe-menu-extraction-holdout.js --manifest ops/benchmark/holdout-2-sources.json
//
// Output: <manifest-prefix>-evaluation.json (create-only).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeSourceUrl } = require('../../src/lib/sourceAnalysisPipeline');
const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { loadMenuExtractionProtocol } = require('../../src/lib/menuExtractionProtocol');
const { validateHoldoutEntry } = require('../benchmark/acceptanceSetGuard');
const {
  assertApprovedHost,
  validateHoldoutManifest,
  evaluationEntriesFromManifest,
  holdoutOutputPaths,
  resolveManifestArgument,
} = require('../benchmark/holdoutManifest');
const { summarizeMenus: summarizeEvidence, aggregateHoldoutReport } = require('../benchmark/holdoutReport');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ACCEPTANCE_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'menu-extraction-acceptance-set.json');
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function itemCount(menu) {
  return (menu.categories || []).reduce((total, category) => total + ((category.items || []).length), 0);
}

function summarizeMenuContexts(analysis) {
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
    label: entry.label || reference.label || null,
    class: entry.class || null,
    kind: reference.kind || null,
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
      itemCount: 0,
      categoryCount: 0,
      menuCount: 0,
      blockedReason: `The approved entry URL did not yield a readable public source (${reference.error}${reference.httpStatus ? ` ${reference.httpStatus}` : ''}). No alternative URL or other location was substituted.`,
      errors: reference.error || 'source_not_readable',
      result: `The approved entry URL did not yield a readable public source (${reference.error}${reference.httpStatus ? ` ${reference.httpStatus}` : ''}). No alternative URL or other location was substituted.`,
      elapsedMs: Date.now() - started,
      limitations: [reference.note],
    };
  }

  let fetched;
  try {
    fetched = await fetchWebsiteSafely(reference.url, { encoding: 'buffer', maxBytes: MAX_BYTES, timeoutMs: 15000 });
    assertApprovedHost(fetched.finalUrl, entry.allowedHosts || [new URL(reference.url).hostname]);
  } catch (error) {
    return {
      ...base,
      status: 'blocked',
      completed: true,
      itemCount: 0,
      categoryCount: 0,
      menuCount: 0,
      errors: (error && error.reason) || (error && error.message) || 'fetch_failed',
      blockedReason: `The pinned source could not be read during the first evaluation: ${(error && error.reason) || (error && error.message)}.`,
      result: `The pinned source could not be read during the first evaluation: ${(error && error.reason) || (error && error.message)}.`,
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
      itemCount: 0,
      categoryCount: 0,
      menuCount: 0,
      analysisError: analysisResult.errorReason,
      errors: analysisResult.errorReason,
      blockedReason: `The real analysis pipeline refused the source: ${analysisResult.errorReason}.`,
      result: `The real analysis pipeline refused the source: ${analysisResult.errorReason}.`,
      elapsedMs: Date.now() - started,
      limitations: ['A refusal is recorded as a limitation, never as an empty successful menu.'],
    };
  }

  const analysis = analysisResult.analysis;
  const menus = summarizeMenuContexts(analysis);
  const evidence = summarizeEvidence(analysis.menuContexts);
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
    priceStatus: evidence.priceStatus,
    evidence: {
      itemCount: evidence.itemCount,
      categoryCount: evidence.categoryCount,
      menuCount: evidence.menuCount,
      priceStatus: evidence.priceStatus,
      knownWithoutAmount: evidence.knownWithoutAmount,
      sourceIdPercent: evidence.evidence.sourceIdPercent,
      locatorPercent: evidence.evidence.locatorPercent,
      supportPercent: evidence.evidence.supportPercent,
      withSourceId: evidence.evidence.withSourceId,
      withLocator: evidence.evidence.withLocator,
      withSupport: evidence.evidence.withSupport,
      missingSourceId: evidence.evidence.missingSourceId,
      missingLocator: evidence.evidence.missingLocator,
      missingSupport: evidence.evidence.missingSupport,
    },
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
  const manifestPath = resolveManifestArgument(process.argv.slice(2), REPO_ROOT);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const validation = validateHoldoutManifest(manifest, { mode: 'evaluation' });
  if (!validation.ok) {
    throw new Error(`holdout evaluation refused: ${validation.errors.join('; ')}`);
  }
  const paths = holdoutOutputPaths(manifestPath);
  const legacyReferences = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-references.json');
  const referencesPath = paths.references === legacyReferences ? legacyReferences : paths.references;
  const outputPath = paths.evaluation === path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-evaluation.json')
    ? path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-evaluation.json')
    : paths.evaluation;
  if (fs.existsSync(outputPath)) {
    throw new Error(`holdout evaluation refused: ${path.relative(REPO_ROOT, outputPath)} already exists; a holdout is evaluated at most once`);
  }
  if (!fs.existsSync(referencesPath)) {
    throw new Error(`holdout evaluation refused: ${path.relative(REPO_ROOT, referencesPath)} does not exist; capture the pinned source version first`);
  }
  const references = JSON.parse(fs.readFileSync(referencesPath, 'utf8'));
  if (!references.authorization || references.authorization.appProviderActivation !== false) {
    throw new Error('holdout evaluation refused: the capture must record app provider activation as false');
  }
  const protocol = loadMenuExtractionProtocol({ root: REPO_ROOT });

  let candidates;
  const manifestEntries = evaluationEntriesFromManifest(manifest);
  if (manifestEntries) {
    // Holdout-2 shape: the pinned manifest itself is the plan, so no URL can
    // come from anywhere else. Every entry must have exactly one pinned,
    // byte-hashed capture before this single evaluation.
    candidates = manifestEntries;
    for (const entry of candidates) {
      const reference = references.sources[entry.referenceId];
      if (!reference) throw new Error(`holdout evaluation refused: no pinned reference for ${entry.referenceId}`);
      if (reference.url !== entry.url) {
        throw new Error(`holdout evaluation refused: ${entry.referenceId} reference url differs from the pinned manifest`);
      }
      assertApprovedHost(reference.url, entry.allowedHosts);
      if (reference.captureStatus === 'captured' && !reference.bytesSha256) {
        throw new Error(`holdout evaluation refused: ${entry.referenceId} has no pinned source hash`);
      }
    }
  } else {
    // Legacy holdout-1 shape: the acceptance set still owns its state.
    const acceptance = JSON.parse(fs.readFileSync(ACCEPTANCE_PATH, 'utf8'));
    const holdout = acceptance.holdout;
    if (!holdout || !Array.isArray(holdout.entries)) throw new Error('holdout evaluation refused: acceptance set has no holdout entries');
    for (const entry of holdout.entries) {
      const entryValidation = validateHoldoutEntry(entry);
      if (!entryValidation.ok) throw new Error(`holdout evaluation refused: ${entryValidation.errors.join('; ')}`);
    }
    candidates = holdout.entries.filter((entry) => entry.provenance === 'real_source' && entry.evaluationState === 'unused');
    if (candidates.length === 0) {
      throw new Error('holdout evaluation refused: no unused real holdout entries; a recorded holdout is not re-evaluated');
    }
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
    manifest: {
      path: path.relative(REPO_ROOT, manifestPath).split(path.sep).join('/'),
      bytesSha256: sha256(manifestBytes),
      sourceCount: manifest.sources.length,
    },
    protocol: { file: protocol.file, version: protocol.version, sha256: protocol.hash },
    authorization: references.authorization,
    noTuning: true,
    note: 'First recorded evaluation against the pinned holdout source versions. No parser or rule was changed from these outcomes; a later tuning use must move the source to representative and pin a new holdout.',
    aggregate: aggregateHoldoutReport(results),
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ path: path.relative(REPO_ROOT, outputPath), sources: Object.keys(results) }, null, 2)}\n`);
  for (const [id, result] of Object.entries(results)) {
    process.stderr.write(`${id}: ${result.status}; items ${result.itemCount == null ? 'n/a' : result.itemCount}; sections ${result.categoryCount == null ? 'n/a' : result.categoryCount}; evidence ${result.evidence ? `${result.evidence.sourceIdPercent}/${result.evidence.locatorPercent}/${result.evidence.supportPercent}` : 'n/a'}; versionMatch ${result.sourceVersionMatches == null ? 'n/a' : result.sourceVersionMatches}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'holdout evaluation failed'}\n`);
  process.exitCode = 1;
});
