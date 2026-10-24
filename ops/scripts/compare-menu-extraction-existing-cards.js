#!/usr/bin/env node
'use strict';

// Read-only live comparison of the four existing #59 cards against their
// pinned capture and their dated data/menus.json export (#59 Delivery Lead
// review 6315269210). It fetches only the pinned entry URL plus the menu
// routes/PDFs named by that same historical export, through the existing safe
// fetch and source pipeline. It never writes to a database, confirms a source,
// saves a concept or publishes anything.
//
// The comparison is developer evidence, not acceptance: it reports missing,
// extra, mispriced and structurally different rows, and the live source facts,
// instead of treating the historical counts as truth.
//
// Usage:
//   node ops/scripts/compare-menu-extraction-existing-cards.js
//
// Output: ops/benchmark/existing-card-comparison.json (regenerable; the source
// pin in existing-card-references.json remains create-only).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeSourceUrl } = require('../../src/lib/sourceAnalysisPipeline');
const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { compareMenuSource } = require('../../src/lib/menuSourceComparison');
const { assertApprovedHost } = require('../benchmark/holdoutManifest');
const {
  validateExistingCardManifest,
  historicalEntries,
  liveMenusForHistoricalSource,
  namePriceComparison,
  summarizeLiveMenus,
} = require('../benchmark/existingCardSources');
const { summarizeMenus: summarizeEvidence } = require('../benchmark/holdoutReport');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-sources.json');
const REFERENCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-references.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-comparison.json');
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function menuKey(menu) {
  // Dedupe on the actual source route and content shape, not on a context slug:
  // the same route read through a second probe must not double every item.
  const shape = (menu.categories || []).map((category) => ({
    path: Array.isArray(category.path) ? category.path : [],
    items: (category.items || []).map((item) => item.name),
  }));
  return `${menu.sourceUrl || ''}|${sha256(JSON.stringify(shape))}`;
}

async function probe(probeUrl, source, pinned) {
  const record = {
    url: probeUrl,
    pinnedBytesSha256: pinned && pinned.bytesSha256 ? pinned.bytesSha256 : null,
    pinnedCaptureStatus: pinned ? pinned.captureStatus : null,
    ok: false,
  };
  try {
    assertApprovedHost(probeUrl, source.allowedHosts);
    const fetched = await fetchWebsiteSafely(probeUrl, { encoding: 'buffer', maxBytes: MAX_BYTES, timeoutMs: 20000 });
    assertApprovedHost(fetched.finalUrl, source.allowedHosts);
    record.finalUrl = fetched.finalUrl;
    record.contentType = fetched.contentType || null;
    record.bytes = fetched.bytes.length;
    record.bytesSha256 = sha256(fetched.bytes);
    record.sourceVersionMatches = record.pinnedBytesSha256 ? record.bytesSha256 === record.pinnedBytesSha256 : null;
  } catch (error) {
    record.error = (error && error.reason) || (error && error.message) || 'fetch_failed';
    record.httpStatus = error && Number.isInteger(error.statusCode) ? error.statusCode : null;
    return record;
  }
  const analysisResult = await analyzeSourceUrl(probeUrl);
  if (!analysisResult.ok) {
    record.error = analysisResult.errorReason;
    return record;
  }
  record.ok = true;
  record.finalUrl = analysisResult.finalUrl || record.finalUrl;
  record.menus = analysisResult.analysis.menuContexts || [];
  record.limitations = (analysisResult.analysis.limitations || []).map((line) => String(line).slice(0, 500));
  record.notes = (analysisResult.analysis.notes || []).map((line) => String(line).slice(0, 300));
  record.sourceInventory = (analysisResult.analysis.sourceInventory || []).map((entry) => ({
    url: entry.url || null,
    kind: entry.kind || null,
    status: entry.status || null,
    itemCount: entry.itemCount == null ? null : entry.itemCount,
    pageCount: entry.pageCount == null ? null : entry.pageCount,
    wordCount: entry.wordCount == null ? null : entry.wordCount,
    contentHash: entry.contentHash || null,
    excludedSections: entry.excludedSections == null ? null : entry.excludedSections,
  }));
  return record;
}

async function compareSource(source, references, menus) {
  const pinned = references.sources[source.id];
  if (!pinned) throw new Error(`compare refused: no pinned capture for ${source.id}`);
  const pinnedByUrl = new Map(pinned.captures.map((capture) => [capture.url, capture]));
  const urls = [...new Set([source.entryUrl, ...source.probeUrls])];
  const probes = [];
  const liveMenus = [];
  const seen = new Set();
  for (const url of urls) {
    const record = await probe(url, source, pinnedByUrl.get(url));
    if (record.ok) {
      for (const menu of record.menus) {
        const key = menuKey(menu);
        if (seen.has(key)) continue;
        seen.add(key);
        liveMenus.push(menu);
      }
    }
    delete record.menus;
    probes.push(record);
  }

  const evidence = summarizeEvidence(liveMenus);
  const historical = historicalEntries(menus, source);
  const cards = historical.map((entry) => {
    const { menus: matchedMenus, liveMatch } = liveMenusForHistoricalSource(liveMenus, entry.sourceUrl);
    const strict = compareMenuSource(
      { label: `${entry.key}${entry.subtitle ? ` ${entry.subtitle}` : ''}`, categories: entry.categories },
      matchedMenus,
    );
    const namePrice = namePriceComparison(entry.categories, matchedMenus);
    return {
      key: entry.key,
      name: entry.name,
      subtitle: entry.subtitle,
      scraped: entry.scraped,
      historicalSourceUrl: entry.sourceUrl,
      historicalItemCount: entry.itemCount,
      liveMatch,
      liveMenuCount: matchedMenus.length,
      strictComparison: strict,
      namePriceComparison: namePrice,
    };
  });

  const totals = cards.reduce((sum, card) => ({
    historicalItems: sum.historicalItems + card.historicalItemCount,
    strictMissing: sum.strictMissing + card.strictComparison.missing.length,
    strictExtra: sum.strictExtra + card.strictComparison.extra.length,
    strictPriceMismatches: sum.strictPriceMismatches + card.strictComparison.priceMismatches.length,
    strictCategoryMismatches: sum.strictCategoryMismatches + card.strictComparison.categoryMismatches.length,
    namePriceMissing: sum.namePriceMissing + card.namePriceComparison.missing.length,
    namePriceExtra: sum.namePriceExtra + card.namePriceComparison.extra.length,
    namePriceMismatches: sum.namePriceMismatches + card.namePriceComparison.priceMismatches.length,
  }), {
    historicalItems: 0,
    strictMissing: 0,
    strictExtra: 0,
    strictPriceMismatches: 0,
    strictCategoryMismatches: 0,
    namePriceMissing: 0,
    namePriceExtra: 0,
    namePriceMismatches: 0,
  });

  const limitations = [...new Set(probes.flatMap((record) => record.limitations || []))].slice(0, 40);
  const errors = probes.filter((record) => record.error).map((record) => ({ url: record.url, error: record.error }));
  return {
    id: source.id,
    label: source.label,
    restaurantId: source.restaurantId,
    entryUrl: source.entryUrl,
    captureStatus: pinned.captureStatus,
    sourceVersionMatches: probes.some((record) => record.sourceVersionMatches === false)
      ? false
      : probes.some((record) => record.sourceVersionMatches === true) ? true : null,
    probes,
    live: {
      menuCount: liveMenus.length,
      itemCount: evidence.itemCount,
      categoryCount: evidence.categoryCount,
      priceStatus: evidence.priceStatus,
      knownWithoutAmount: evidence.knownWithoutAmount,
      evidence: evidence.evidence,
      menus: summarizeLiveMenus(liveMenus),
    },
    historical: {
      keys: historical.map((entry) => entry.key),
      itemCount: totals.historicalItems,
      note: 'data/menus.json is a dated observation (see each scoped date), not live truth and not ground truth for this source version.',
      cards,
      totals,
    },
    limitations,
    errors,
    result: evidence.itemCount > 0
      ? `${evidence.itemCount} live items in ${evidence.categoryCount} sections across ${liveMenus.length} menu context(s); ${errors.length} probe(s) failed. This is a read-only comparison, not an acceptance claim.`
      : `No live menu items were extracted; ${errors.length} probe(s) failed. The source is recorded as a limitation, not as a successful menu.`,
  };
}

async function main() {
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const references = JSON.parse(fs.readFileSync(REFERENCES_PATH, 'utf8'));
  const menus = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'menus.json'), 'utf8'));
  const validation = validateExistingCardManifest(manifest, menus);
  if (!validation.ok) throw new Error(`compare refused: ${validation.errors.join('; ')}`);
  if (!references.manifest || references.manifest.bytesSha256 !== sha256(manifestBytes)) {
    throw new Error('compare refused: the pinned references do not belong to this manifest version');
  }

  const sources = {};
  for (const source of manifest.sources) {
    sources[source.id] = await compareSource(source, references, menus);
  }
  const output = {
    version: '1.0.0',
    issue: 59,
    generatedAt: new Date().toISOString(),
    note: 'Read-only live comparison of the four existing #59 cards. Developer evidence, not independent review or browser acceptance. Historical data/menus.json rows are dated observations; missing/extra/price differences are reported per historical menu key and never hidden by an equal count.',
    dataExport: { file: 'data/menus.json', role: 'dated historical observation' },
    manifest: {
      path: path.relative(REPO_ROOT, MANIFEST_PATH).split(path.sep).join('/'),
      bytesSha256: sha256(manifestBytes),
    },
    references: {
      path: path.relative(REPO_ROOT, REFERENCES_PATH).split(path.sep).join('/'),
      capturedAt: references.capturedAt,
    },
    authorization: references.authorization,
    summary: Object.values(sources).map((source) => ({
      id: source.id,
      label: source.label,
      captureStatus: source.captureStatus,
      sourceVersionMatches: source.sourceVersionMatches,
      liveItemCount: source.live.itemCount,
      liveCategoryCount: source.live.categoryCount,
      historicalItemCount: source.historical.itemCount,
      historicalKeys: source.historical.keys,
      totals: source.historical.totals,
      probeErrors: source.errors,
      limitations: source.limitations.length,
    })),
    sources,
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ path: path.relative(REPO_ROOT, OUTPUT_PATH), sources: Object.keys(sources) }, null, 2)}\n`);
  for (const source of Object.values(sources)) {
    process.stderr.write(
      `${source.id}: ${source.captureStatus}; live ${source.live.itemCount} items/${source.live.categoryCount} sections; `
      + `historical ${source.historical.itemCount}; strict missing ${source.historical.totals.strictMissing}, extra ${source.historical.totals.strictExtra}, `
      + `price ${source.historical.totals.strictPriceMismatches}; name+price missing ${source.historical.totals.namePriceMissing}, `
      + `extra ${source.historical.totals.namePriceExtra}, price ${source.historical.totals.namePriceMismatches}; probes failed ${source.errors.length}\n`,
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : 'existing-card comparison failed'}\n`);
    process.exitCode = 1;
  });
}

module.exports = { menuKey, compareSource, probe };
