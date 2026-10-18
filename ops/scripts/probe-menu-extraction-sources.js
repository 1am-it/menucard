#!/usr/bin/env node
'use strict';

// Read-only source probe for #59. It fetches at most the two explicitly named
// public sources, parses them through the real analysis pipeline (no AI
// adapter configured), and compares the result with the controlled reference
// in ops/benchmark/source-references.json. It never writes to the database,
// never confirms a source and never publishes anything.
//
// Usage:
//   node ops/scripts/probe-menu-extraction-sources.js --source=all
//   node ops/scripts/probe-menu-extraction-sources.js --source=smelt
//   node ops/scripts/probe-menu-extraction-sources.js --source=blossem
//
// Exit code 1 when a source hash changed or any item is missed, extra,
// mispriced, wrongly linked or duplicated. A count alone is never a pass.

const crypto = require('node:crypto');
const path = require('node:path');
const { analyzeSourceUrl } = require('../../src/lib/sourceAnalysisPipeline');
const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { compareMenuSource } = require('../../src/lib/menuSourceComparison');
const references = require('../benchmark/source-references.json');

const MAX_PROBE_BYTES = 15 * 1024 * 1024;

function argSource(argv) {
  const value = argv.find((arg) => arg.startsWith('--source='));
  const source = value ? value.slice('--source='.length) : 'all';
  if (!['all', 'smelt', 'blossem'].includes(source)) {
    throw new Error('--source must be all, smelt or blossem.');
  }
  return source;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sourceReport(label, reference, analysis, bytesSha256) {
  const comparison = compareMenuSource(reference, analysis.menuContexts);
  const source = (analysis.sourceInventory || [])[0] || {};
  return {
    label,
    url: reference.url,
    bytesSha256: bytesSha256 || null,
    bytesSha256Matches: bytesSha256 ? bytesSha256 === reference.bytesSha256 : null,
    contentHash: source.contentHash || null,
    contentHashMatches: source.contentHash ? source.contentHash === reference.contentHash : null,
    pageCount: source.pageCount || null,
    menus: analysis.menuContexts.length,
    ...comparison,
    limitations: (analysis.limitations || []).map((line) => String(line).slice(0, 300)),
  };
}

function hasDifference(report) {
  return (
    report.bytesSha256Matches === false ||
    report.contentHashMatches === false ||
    report.missing.length > 0 ||
    report.extra.length > 0 ||
    report.priceMismatches.length > 0 ||
    report.categoryMismatches.length > 0 ||
    report.duplicates.length > 0
  );
}

async function main() {
  const selected = argSource(process.argv.slice(2));
  const keys = Object.keys(references.sources).filter((key) => selected === 'all' || selected === key);
  const reports = [];
  for (const key of keys) {
    const reference = references.sources[key];
    const fetched = await fetchWebsiteSafely(reference.url, { encoding: 'buffer', maxBytes: MAX_PROBE_BYTES });
    const result = await analyzeSourceUrl(reference.url);
    if (!result.ok) {
      reports.push({ label: reference.label, url: reference.url, ok: false, errorReason: result.errorReason });
      continue;
    }
    reports.push({ ok: true, ...sourceReport(reference.label, reference, result.analysis, sha256(fetched.bytes)) });
  }

  process.stdout.write(JSON.stringify({ capturedAt: references.capturedAt, sources: reports }, null, 2) + '\n');
  for (const report of reports) {
    process.stderr.write(
      `${report.label}: ${report.ok === false
        ? `FAILED (${report.errorReason})`
        : `expected ${report.expectedItems}, actual ${report.actualItems}, matched ${report.matched}, missing ${report.missing.length}, extra ${report.extra.length}, price ${report.priceMismatches.length}, category ${report.categoryMismatches.length}, duplicates ${report.duplicates.length}`}\n`,
    );
  }
  if (reports.some((report) => report.ok === false || hasDifference(report))) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`source probe refused: ${err && err.message ? err.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
