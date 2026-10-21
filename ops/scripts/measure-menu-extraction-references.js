#!/usr/bin/env node
'use strict';

// Deterministic measurement of the current extraction against the five
// controlled #59 references (Delivery Lead review 6318225879).
//
// Every source is replayed from its pinned bytes through the real analysis
// pipeline. The tool never refetches a source, never calls a provider and
// never writes a database. It compares the extraction with the reference and
// reports missed dishes, invented dishes, price errors and rubric errors
// separately, plus precision and recall. A blocked source stays visible and
// is never counted as an empty success.
//
// Usage:
//   node ops/scripts/measure-menu-extraction-references.js
//
// Output:
//   ops/benchmark/reference-measurement.json
//   ops/benchmark/reference-measurement.md
//
// The output contains no wall-clock timestamp: the same pinned bytes and the
// same code must produce the same report.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { runRestaurantSourceAnalysis } = require('../../src/lib/restaurantSourceAnalysis');
const { buildDirectPdfAnalysis } = require('../../src/lib/sourceAnalysisPipeline');
const { extractDigitalPdfText } = require('../../src/lib/pdfTextExtraction');
const {
  createOfflineCandidateFetcher,
  validateCaptureMetadata,
} = require('../benchmark/referenceCaptureSources');
const {
  aggregateControlledReferences,
  compareControlledReference,
} = require('../benchmark/referenceComparison');
const {
  htmlVisibleText,
  validateReferenceShape,
  verifyReferenceQuotes,
} = require('../benchmark/referenceIntegrity');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-references', 'index.json');
const METADATA_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-captures.json');
const MANIFEST_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-capture-sources.json');
const OUT_JSON = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-measurement.json');
const OUT_MD = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-measurement.md');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function captureByLocalPath(metadata, sourceId) {
  const source = metadata.sources[sourceId];
  const map = new Map();
  for (const capture of (source && Array.isArray(source.captures) ? source.captures : [])) {
    if (capture.captureStatus === 'captured') map.set(capture.localPath, capture);
  }
  return map;
}

function verifyCapturedBytes(metadata, sourceId) {
  const source = metadata.sources[sourceId];
  const errors = [];
  for (const capture of (source && Array.isArray(source.captures) ? source.captures : [])) {
    if (capture.captureStatus !== 'captured') continue;
    const file = path.join(REPO_ROOT, capture.localPath);
    if (!fs.existsSync(file)) {
      errors.push(`${sourceId}: missing local capture ${capture.localPath}`);
      continue;
    }
    const bytes = fs.readFileSync(file);
    const digest = sha256(bytes);
    if (digest !== capture.bytesSha256) {
      errors.push(`${sourceId}: ${capture.localPath} has SHA-256 ${digest}, expected ${capture.bytesSha256}`);
    }
    if (bytes.length !== capture.bytes) {
      errors.push(`${sourceId}: ${capture.localPath} is ${bytes.length} bytes, expected ${capture.bytes}`);
    }
  }
  return errors;
}

async function capturedText(metadata, sourceId, captureKey) {
  const capture = captureByLocalPath(metadata, sourceId).get(captureKey);
  if (!capture) throw new Error(`${sourceId}: capture ${captureKey} is not in the pinned metadata`);
  const file = path.join(REPO_ROOT, captureKey);
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== capture.bytesSha256) {
    throw new Error(`${sourceId}: ${captureKey} does not match its pinned SHA-256`);
  }
  if (capture.kind === 'pdf') {
    const extracted = await extractDigitalPdfText(bytes, { maxBytes: 15 * 1024 * 1024 });
    return extracted.text;
  }
  return htmlVisibleText(bytes.toString('utf8'));
}


/**
 * Replays the real pipeline on the pinned bytes. The offline fetcher can only
 * return captured pages; a page the pipeline asks for but that is not pinned
 * is an integrity error, never a silent undercount.
 */
async function replaySource(metadata, sourceId) {
  const source = metadata.sources[sourceId];
  const captures = source.captures
    .filter((capture) => capture.captureStatus === 'captured')
    .map((capture) => ({ ...capture, bytesBuffer: fs.readFileSync(path.join(REPO_ROOT, capture.localPath)) }));
  const entry = captures.find((capture) => capture.order === 1) || null;
  if (!entry) throw new Error(`${sourceId}: no captured entry page`);
  const { fetchCandidate, missing } = createOfflineCandidateFetcher(captures);

  let analysis;
  if (entry.kind === 'html') {
    analysis = await runRestaurantSourceAnalysis({
      homepageHtml: entry.bytesBuffer.toString('utf8'),
      homepageUrl: entry.finalUrl,
      fetchCandidate,
    });
  } else if (entry.kind === 'pdf') {
    analysis = await buildDirectPdfAnalysis({ pdfBytes: entry.bytesBuffer, sourceUrl: entry.finalUrl });
  } else {
    throw new Error(`${sourceId}: unsupported entry kind ${entry.kind}`);
  }

  if (missing.length > 0) {
    throw new Error(`${sourceId}: the pinned capture set is incomplete; the pipeline requested ${missing.join(', ')}`);
  }
  return { analysis, captures };
}

function sourceVersion(metadata, sourceId) {
  const source = metadata.sources[sourceId];
  return {
    entryUrl: source.entryUrl,
    captureStatus: source.captureStatus,
    captures: (source.captures || []).map((capture) => ({
      order: capture.order,
      requestedUrl: capture.requestedUrl,
      finalUrl: capture.finalUrl,
      contentType: capture.contentType,
      kind: capture.kind,
      bytes: capture.bytes,
      bytesSha256: capture.bytesSha256,
      captureStatus: capture.captureStatus,
      error: capture.error || null,
    })),
  };
}

function blockedSourceResult(sourceId, reference, metadata) {
  const source = metadata.sources[sourceId];
  const entry = (source.captures || [])[0] || {};
  return {
    sourceId,
    label: reference.label || source.label,
    captureStatus: 'blocked',
    blockedReason: entry.error || reference.blockedReason || 'source not readable',
    referenceItems: 0,
    actualItems: 0,
    matched: 0,
    missing: 0,
    invented: 0,
    priceErrors: 0,
    categoryErrors: 0,
    precision: null,
    recall: null,
    missingDishes: [],
    inventedDishes: [],
    priceErrorRows: [],
    categoryErrorRows: [],
    duplicates: [],
    limitations: [...(reference.limitations || [])],
    sourceVersion: sourceVersion(metadata, sourceId),
    accounting: {
      reference: { total: 0, matched: 0, missing: 0, priceErrors: 0, categoryErrors: 0, accounted: 0, balanced: true },
      actual: { total: 0, matched: 0, invented: 0, priceErrors: 0, categoryErrors: 0, accounted: 0, balanced: true },
    },
  };
}

async function measureOne(sourceId, referenceFile, metadata) {
  const reference = readJson(path.join(REPO_ROOT, referenceFile));
  if (reference.sourceId !== sourceId) {
    throw new Error(`${sourceId}: reference file is for ${reference.sourceId}`);
  }
  const shape = validateReferenceShape(reference);
  if (!shape.ok) throw new Error(`${sourceId}: reference is not comparable: ${shape.errors.join('; ')}`);

  const source = metadata.sources[sourceId];
  if (!source || source.captureStatus !== 'captured' || reference.captureStatus !== 'captured') {
    return blockedSourceResult(sourceId, reference, metadata);
  }

  const keys = new Set();
  for (const menu of reference.menus) keys.add(menu.captureKey);
  for (const row of [...reference.arrangements, ...reference.supplements]) keys.add(row.captureKey);
  const texts = new Map();
  for (const key of keys) texts.set(key, await capturedText(metadata, sourceId, key));
  const quotes = verifyReferenceQuotes(reference, texts);
  if (!quotes.ok) throw new Error(`${sourceId}: reference quote integrity failed: ${quotes.errors.join('; ')}`);

  const { analysis } = await replaySource(metadata, sourceId);
  const comparison = compareControlledReference(reference, analysis.menuContexts, { sourceId, label: reference.label });
  const limitations = [
    ...(reference.limitations || []),
    ...(analysis.limitations || []).map((line) => String(line).slice(0, 500)),
  ];
  return {
    ...comparison,
    captureStatus: 'captured',
    blockedReason: null,
    limitations,
    sourceVersion: sourceVersion(metadata, sourceId),
  };
}

function fmtPercent(value) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : 'n.v.t.';
}

function clean(value, max = 400) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Menu-extractie: gecontroleerde referentiemeting (#59)');
  lines.push('');
  lines.push(`Gemeten op ${report.sources.filter((s) => s.captureStatus === 'captured').length} van ${report.sources.length} vastgezette bronversies met de huidige code op de vastgezette bytes. Senang Makan is geblokkeerd en telt niet als lege of geslaagde extractie.`);
  lines.push('');
  lines.push('De referenties zijn vooraf uit de brontekst opgesteld; deze meting is geen ongeziene holdout en geen productieacceptatie. Er is geen OCR, provider of publicatie gebruikt.');
  lines.push('');
  lines.push('## Totalen (alleen gemeten bronnen)');
  lines.push('');
  lines.push('| Maat | Waarde |');
  lines.push('| --- | --- |');
  lines.push(`| Bronnen gemeten / geblokkeerd | ${report.totals.capturedSources} / ${report.totals.blockedSources} |`);
  lines.push(`| Referentiegerechten | ${report.totals.referenceItems} |`);
  lines.push(`| Geëxtraheerde gerechten | ${report.totals.actualItems} |`);
  lines.push(`| Exact gematcht | ${report.totals.matched} |`);
  lines.push(`| Gemiste gerechten | ${report.totals.missing} |`);
  lines.push(`| Verzonnen gerechten | ${report.totals.invented} |`);
  lines.push(`| Prijsfouten | ${report.totals.priceErrors} |`);
  lines.push(`| Rubriekfouten | ${report.totals.categoryErrors} |`);
  lines.push(`| Precisie | ${fmtPercent(report.totals.precision)} |`);
  lines.push(`| Recall | ${fmtPercent(report.totals.recall)} |`);
  lines.push('');
  lines.push('## Per bron');
  lines.push('');
  lines.push('| Bron | Status | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const source of report.sources) {
    const status = source.captureStatus === 'captured' ? 'gemeten' : 'geblokkeerd';
    lines.push(`| ${source.label} | ${status} | ${source.referenceItems} | ${source.actualItems} | ${source.matched} | ${source.missing} | ${source.invented} | ${source.priceErrors} | ${source.categoryErrors} | ${fmtPercent(source.precision)} | ${fmtPercent(source.recall)} |`);
  }
  lines.push('');
  lines.push('## Afwijkingen per bron');
  for (const source of report.sources) {
    lines.push('');
    lines.push(`### ${source.label}`);
    lines.push('');
    if (source.captureStatus !== 'captured') {
      lines.push(`- **Geblokkeerd:** ${clean(source.blockedReason, 500) || 'bron niet leesbaar'}`);
      for (const limitation of source.limitations) lines.push(`- ${clean(limitation, 500)}`);
      continue;
    }
    const quote = (row) => clean(row && (row.quote || row.actualLocator || ''), 300);

    lines.push(`**Gemist (${source.missingDishes.length})**`);
    if (source.missingDishes.length === 0) lines.push('- geen');
    for (const row of source.missingDishes) {
      lines.push(`- \`${clean(row.name, 120)}\` — ${clean(row.path.join(' › '), 200)} — prijs ${row.prices.join(' / ') || 'n.v.t.'} — citaat: “${quote(row)}” (${clean(row.locator, 200)})`);
    }
    lines.push('');
    lines.push(`**Verzonnen (${source.inventedDishes.length})**`);
    if (source.inventedDishes.length === 0) lines.push('- geen');
    for (const row of source.inventedDishes) {
      lines.push(`- \`${clean(row.name, 120)}\` — ${clean(row.path.join(' › '), 200)} — prijs ${row.prices.join(' / ') || 'n.v.t.'} — broncitaat: “${quote(row)}”`);
    }
    lines.push('');
    lines.push(`**Prijsfouten (${source.priceErrorRows.length})**`);
    if (source.priceErrorRows.length === 0) lines.push('- geen');
    for (const row of source.priceErrorRows) {
      lines.push(`- \`${clean(row.name, 120)}\` — ${clean(row.path.join(' › '), 200)} — verwacht ${row.expectedPrices.join(' / ')}; geëxtraheerd ${row.actualPrices.join(' / ') || 'geen prijs'} — citaat: “${quote(row)}” (${clean(row.locator, 200)})`);
    }
    lines.push('');
    lines.push(`**Rubriekfouten (${source.categoryErrorRows.length})**`);
    if (source.categoryErrorRows.length === 0) lines.push('- geen');
    for (const row of source.categoryErrorRows) {
      lines.push(`- \`${clean(row.name, 120)}\` — verwacht ${clean(row.expectedPath.join(' › '), 200)}; geëxtraheerd ${clean(row.actualPath.join(' › '), 200)} — citaat: “${quote(row)}”`);
    }
    if (source.duplicates.length > 0) {
      lines.push('');
      lines.push('**Duplicaten in de extractie**');
      for (const row of source.duplicates) {
        lines.push(`- \`${clean(row.name, 120)}\` — ${clean(row.path.join(' › '), 200)} — ${row.count} keer (referentiefrequentie ${row.expectedCount})`);
      }
    }
    lines.push('');
    lines.push('**Beperkingen**');
    for (const limitation of source.limitations) lines.push(`- ${clean(limitation, 500)}`);
    lines.push('');
    lines.push(`**Vastgezette bronversie:** ${source.sourceVersion.captures.length} capture(s); ${source.sourceVersion.captures.map((c) => `${c.kind} ${c.bytesSha256 ? c.bytesSha256.slice(0, 12) : c.captureStatus}`).join(', ')}`);
  }
  lines.push('');
  lines.push('## Integriteit en herhaalbaarheid');
  lines.push('');
  lines.push(`- Telregels: \`${report.countingRules.path}\`, SHA-256 \`${report.countingRules.sha256}\`.`);
  lines.push(`- Capturemetadata: \`${report.captureMetadata.path}\`, SHA-256 \`${report.captureMetadata.bytesSha256}\`.`);
  lines.push('- Iedere referentiequote is tegen de vastgezette bytes gecontroleerd; iedere capture is opnieuw op SHA-256 en bytegrootte gecontroleerd.');
  lines.push('- De analyse is op de vastgezette bytes herhaald zonder netwerkoproep; hetzelfde script op dezelfde bytes levert hetzelfde rapport.');
  lines.push('- Deze vijf bronnen zijn geen ongeziene holdout: de referenties zijn opgesteld om op bij te sturen.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}


async function main() {
  const index = readJson(INDEX_PATH);
  const metadata = readJson(METADATA_PATH);
  const manifest = readJson(MANIFEST_PATH);
  const metadataValidation = validateCaptureMetadata(metadata, manifest);
  if (!metadataValidation.ok) throw new Error(`capture metadata is invalid: ${metadataValidation.errors.join('; ')}`);

  const countingRulesFile = path.join(REPO_ROOT, index.countingRules.path);
  const countingRulesSha = sha256(fs.readFileSync(countingRulesFile));
  if (countingRulesSha !== index.countingRules.sha256) {
    throw new Error(`counting rules changed: ${countingRulesSha} != ${index.countingRules.sha256}`);
  }

  const ids = index.sources.map((entry) => entry.id);
  for (const id of ids) {
    if (!metadata.sources[id]) throw new Error(`source ${id} is missing from the capture metadata`);
    const errors = verifyCapturedBytes(metadata, id);
    if (errors.length > 0) throw new Error(errors.join('; '));
  }

  const sources = [];
  for (const entry of index.sources) {
    sources.push(await measureOne(entry.id, entry.file, metadata));
  }
  const totals = aggregateControlledReferences(sources);
  const report = {
    version: '1.0.0',
    pinnedAt: metadata.pinnedAt,
    issue: 59,
    countingRules: index.countingRules,
    captureMetadata: {
      path: relative(METADATA_PATH),
      bytesSha256: sha256(fs.readFileSync(METADATA_PATH)),
    },
    referenceIndex: relative(INDEX_PATH),
    method: 'Current extraction replayed on the pinned bytes through the offline capture fetcher. No network, provider, OCR or database write. The four deviation classes and precision/recall are computed by ops/benchmark/referenceComparison.js.',
    totals,
    sources,
  };

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(OUT_MD, renderMarkdown(report));

  process.stdout.write('bron\tstatus\treferentie\textractie\tmatch\tgemist\tverzonnen\tprijs\trubriek\tprecisie\trecall\n');
  for (const source of sources) {
    process.stdout.write(`${source.label}\t${source.captureStatus}\t${source.referenceItems}\t${source.actualItems}\t${source.matched}\t${source.missing}\t${source.invented}\t${source.priceErrors}\t${source.categoryErrors}\t${fmtPercent(source.precision)}\t${fmtPercent(source.recall)}\n`);
  }
  process.stdout.write(`TOTAAL\t${totals.capturedSources}/${totals.sources}\t${totals.referenceItems}\t${totals.actualItems}\t${totals.matched}\t${totals.missing}\t${totals.invented}\t${totals.priceErrors}\t${totals.categoryErrors}\t${fmtPercent(totals.precision)}\t${fmtPercent(totals.recall)}\n`);
  process.stdout.write(`${relative(OUT_JSON)}\n${relative(OUT_MD)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'reference measurement failed'}\n`);
  process.exitCode = 1;
});

