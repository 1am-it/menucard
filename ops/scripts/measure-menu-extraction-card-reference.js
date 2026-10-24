#!/usr/bin/env node
'use strict';

// Criterion-5 measurement of the existing cards (#59 Delivery Lead order
// 6347355753 K2, extended to four cards by review 6349832755 K3). Bardot,
// Zuyd, Wolfslaar and T-Huis are measured in one report, on pinned bytes only:
//
//   - Bardot: the 2025-11 dinerkaart PDF whose SHA-256 equals the hash in
//     ops/benchmark/existing-card-references.json (verified once by
//     ops/scripts/verify-menu-extraction-card-reference-bytes.js).
//   - Zuyd: the two HTML menu pages already pinned in
//     ops/benchmark/reference-captures.json.
//   - Wolfslaar: the entry page, both menu pages and the menu-1 overview page
//     pinned once by ops/scripts/capture-menu-extraction-card-source-bytes.js.
//   - T-Huis: the entry page and the menu page pinned by the same script. The
//     pinned menu page carries its five cards as SVG images only, so it is
//     reported as blocked with that reason and never as an empty success.
//
// The comparison, the four deviation classes and precision/recall come from
// ops/benchmark/referenceComparison.js unchanged; the counting rules are the
// pinned ones. The reference integrity checks are the shared
// referenceIntegrity.js plus the card-specific price proofs in
// cardReferenceIntegrity.js. Nothing is refetched, no provider is called, no
// database is written.
//
// Usage:
//   node ops/scripts/measure-menu-extraction-card-reference.js
//
// Output: ops/benchmark/card-reference-measurement.json and .md. The report
// contains no wall-clock generation time: the same pinned bytes and the same
// code produce the same report.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { runRestaurantSourceAnalysis } = require('../../src/lib/restaurantSourceAnalysis');
const { buildDirectPdfAnalysis } = require('../../src/lib/sourceAnalysisPipeline');
const { extractDigitalPdfLines, extractDigitalPdfText } = require('../../src/lib/pdfTextExtraction');
const { createOfflineCandidateFetcher } = require('../benchmark/referenceCaptureSources');
const { aggregateControlledReferences, compareControlledReference } = require('../benchmark/referenceComparison');
const { repositoryTextSha256 } = require('../benchmark/holdoutManifest');
const { htmlVisibleText, validateReferenceShape, verifyReferenceQuotes } = require('../benchmark/referenceIntegrity');
const { validateCardReferenceCapturePin } = require('../benchmark/cardReferenceCaptures');
const { validateCardSourceCapturePin } = require('../benchmark/cardSourceCaptures');
const { verifyCardPriceProofs } = require('../benchmark/cardReferenceIntegrity');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CARD_PIN_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'card-reference-captures.json');
const CARD_CAPTURE_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-references.json');
const CARD_SOURCE_MANIFEST_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-sources.json');
const BARDOT_REFERENCE_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-references', 'bardot.json');
const WOLFSLAAR_PIN_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'card-reference-captures.wolfslaar.json');
const THUIS_PIN_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'card-reference-captures.thuis.json');
const WOLFSLAAR_REFERENCE_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-references', 'wolfslaar.json');
const THUIS_REFERENCE_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-references', 'thuis.json');
const REFERENCE_METADATA_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-captures.json');
const REFERENCE_INDEX_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-references', 'index.json');
const OUT_JSON = path.join(REPO_ROOT, 'ops', 'benchmark', 'card-reference-measurement.json');
const OUT_MD = path.join(REPO_ROOT, 'ops', 'benchmark', 'card-reference-measurement.md');
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Repository text files are hashed with the project's own EOL-stable helper, so
// the pinned hashes stay identical on a checkout that stores CRLF. Pinned
// capture bytes keep the raw SHA-256: those bytes must not change at all.
function textSha256(input) {
  return repositoryTextSha256(input);
}

function repositoryPath(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function readVerifiedBytes(localPath, expectedSha256, label) {
  const file = path.join(REPO_ROOT, localPath);
  if (!fs.existsSync(file)) throw new Error(`${label}: the pinned bytes ${localPath} are not present in this checkout`);
  const bytes = fs.readFileSync(file);
  const digest = sha256(bytes);
  if (digest !== expectedSha256) throw new Error(`${label}: ${localPath} has SHA-256 ${digest}, expected ${expectedSha256}`);
  return bytes;
}


/** Captured text of one pinned capture, for the reference quote check. */
async function capturedText(capture) {
  const bytes = readVerifiedBytes(capture.localPath, capture.bytesSha256, `${capture.requestedUrl}`);
  if (capture.kind === 'pdf') return (await extractDigitalPdfText(bytes, { maxBytes: MAX_BYTES })).text;
  return htmlVisibleText(bytes.toString('utf8'));
}

/** Bardot: one verified PDF capture measured directly, no discovery. */
async function measureBardot(pin, cardSource, reference) {
  const capture = (pin.captures || []).find((candidate) => candidate.status === 'verified' && candidate.kind === 'pdf');
  if (!capture) throw new Error('bardot: the pin carries no verified PDF capture');
  const bytes = readVerifiedBytes(capture.localPath, capture.bytesSha256, 'bardot');
  const text = (await extractDigitalPdfText(bytes, { maxBytes: MAX_BYTES })).text;
  const lines = await extractDigitalPdfLines(bytes, { maxBytes: MAX_BYTES });
  const quotes = verifyReferenceQuotes(reference, { [reference.captureKey]: text });
  if (!quotes.ok) throw new Error(`bardot: reference quote integrity failed: ${quotes.errors.join('; ')}`);
  const proofs = verifyCardPriceProofs(reference, lines.pages);
  if (!proofs.ok) throw new Error(`bardot: price proof integrity failed: ${proofs.errors.join('; ')}`);

  const analysis = await buildDirectPdfAnalysis({ pdfBytes: bytes, sourceUrl: capture.requestedUrl });
  const comparison = compareControlledReference(reference, analysis.menuContexts, { sourceId: 'bardot', label: pin.label });
  return {
    ...comparison,
    captureStatus: 'captured',
    blockedReason: null,
    sourceVersion: {
      entryUrl: cardSource.entryUrl,
      captureStatus: pin.captureStatus,
      captures: (pin.captures || []).map((candidate) => ({
        requestedUrl: candidate.requestedUrl,
        status: candidate.status,
        kind: candidate.kind,
        bytes: candidate.bytes || 0,
        bytesSha256: candidate.bytesSha256 || null,
        observedBytesSha256: candidate.observedBytesSha256 || null,
        verifiedAt: candidate.verifiedAt,
        error: candidate.error || null,
      })),
    },
    limitations: [...(reference.limitations || []), ...(analysis.limitations || []).map((line) => String(line).slice(0, 500))],
    priceProofs: proofs.proofs,
    priceProofCount: proofs.proofs.length,
  };
}

/** Zuyd: the existing pinned HTML captures replayed through the real pipeline. */
async function measureZuyd(metadata, reference) {
  const source = metadata.sources.zuyd;
  if (!source || source.captureStatus !== 'captured') throw new Error('zuyd: the pinned source is not captured');
  const captures = source.captures
    .filter((capture) => capture.captureStatus === 'captured')
    .map((capture) => ({ ...capture, bytesBuffer: readVerifiedBytes(capture.localPath, capture.bytesSha256, 'zuyd') }));
  const entry = captures.find((capture) => capture.order === 1);
  if (!entry) throw new Error('zuyd: no captured entry page');
  const { fetchCandidate, missing } = createOfflineCandidateFetcher(captures);
  const analysis = await runRestaurantSourceAnalysis({
    homepageHtml: entry.bytesBuffer.toString('utf8'),
    homepageUrl: entry.finalUrl,
    fetchCandidate,
  });
  if (missing.length > 0) throw new Error(`zuyd: the pinned capture set is incomplete; the pipeline requested ${missing.join(', ')}`);

  const texts = new Map();
  const captureKeys = new Set();
  for (const menu of reference.menus) captureKeys.add(menu.captureKey);
  for (const row of [...(reference.arrangements || []), ...(reference.supplements || [])]) captureKeys.add(row.captureKey);
  for (const key of captureKeys) {
    const capture = captures.find((candidate) => candidate.localPath === key);
    if (!capture) throw new Error(`zuyd: reference capture ${key} is not pinned`);
    texts.set(key, await capturedText(capture));
  }
  const quotes = verifyReferenceQuotes(reference, texts);
  if (!quotes.ok) throw new Error(`zuyd: reference quote integrity failed: ${quotes.errors.join('; ')}`);

  const comparison = compareControlledReference(reference, analysis.menuContexts, { sourceId: 'zuyd', label: reference.label });
  return {
    ...comparison,
    captureStatus: 'captured',
    blockedReason: null,
    sourceVersion: {
      entryUrl: source.entryUrl,
      captureStatus: source.captureStatus,
      captures: source.captures.map((capture) => ({
        requestedUrl: capture.requestedUrl,
        finalUrl: capture.finalUrl,
        contentType: capture.contentType,
        kind: capture.kind,
        bytes: capture.bytes,
        bytesSha256: capture.bytesSha256,
        captureStatus: capture.captureStatus,
        error: capture.error || null,
      })),
    },
    limitations: [...(reference.limitations || []), ...(analysis.limitations || []).map((line) => String(line).slice(0, 500))],
  };
}


/** A card whose pinned bytes carry no readable text menu: reported, never scored. */
function blockedCardResult({ label, sourceId, blockedReason, pin, limitations }) {
  return {
    label,
    sourceId,
    captureStatus: 'blocked',
    blockedReason,
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
    accounting: {
      reference: { total: 0, matched: 0, missing: 0, priceErrors: 0, categoryErrors: 0, accounted: 0, balanced: true },
      actual: { total: 0, matched: 0, invented: 0, priceErrors: 0, categoryErrors: 0, accounted: 0, balanced: true },
    },
    sourceVersion: {
      entryUrl: pin.entryUrl,
      captureStatus: pin.captureStatus,
      captures: pin.captures.map((capture) => ({
        requestedUrl: capture.requestedUrl,
        finalUrl: capture.finalUrl,
        contentType: capture.contentType,
        kind: capture.kind,
        role: capture.role,
        bytes: capture.bytes,
        bytesSha256: capture.bytesSha256,
        captureStatus: capture.status,
        error: capture.error || null,
      })),
    },
    limitations,
    priceProofs: [],
    priceProofCount: 0,
  };
}

/**
 * Wolfslaar: the pinned card captures replayed through the real pipeline. The
 * entry page is the one pinned entry capture; every other captured page is
 * served from its own bytes, so no request can change what was measured.
 */
async function measurePinnedCard({ pin, reference, sourceId }) {
  const captures = pin.captures
    .filter((capture) => capture.status === 'captured')
    .map((capture) => ({
      ...capture,
      url: capture.requestedUrl,
      captureStatus: 'captured',
      bytesBuffer: readVerifiedBytes(capture.localPath, capture.bytesSha256, sourceId),
    }));
  const entry = captures.find((capture) => capture.role === 'entry');
  if (!entry) throw new Error(`${sourceId}: no captured entry page`);
  const { fetchCandidate, missing } = createOfflineCandidateFetcher(captures);
  const analysis = await runRestaurantSourceAnalysis({
    homepageHtml: entry.bytesBuffer.toString('utf8'),
    homepageUrl: entry.finalUrl,
    fetchCandidate,
  });
  if (missing.length > 0) throw new Error(`${sourceId}: the pinned capture set is incomplete; the pipeline requested ${missing.join(', ')}`);

  const texts = new Map();
  const captureKeys = new Set();
  for (const menu of reference.menus) captureKeys.add(menu.captureKey);
  for (const row of [...(reference.arrangements || []), ...(reference.supplements || [])]) captureKeys.add(row.captureKey);
  for (const key of captureKeys) {
    const capture = captures.find((candidate) => candidate.localPath === key);
    if (!capture) throw new Error(`${sourceId}: reference capture ${key} is not pinned`);
    texts.set(key, await capturedText(capture));
  }
  const quotes = verifyReferenceQuotes(reference, texts);
  if (!quotes.ok) throw new Error(`${sourceId}: reference quote integrity failed: ${quotes.errors.join('; ')}`);

  const comparison = compareControlledReference(reference, analysis.menuContexts, { sourceId, label: reference.label });
  return {
    ...comparison,
    captureStatus: 'captured',
    blockedReason: null,
    sourceVersion: {
      entryUrl: pin.entryUrl,
      captureStatus: pin.captureStatus,
      captures: pin.captures.map((capture) => ({
        requestedUrl: capture.requestedUrl,
        finalUrl: capture.finalUrl,
        contentType: capture.contentType,
        kind: capture.kind,
        role: capture.role,
        bytes: capture.bytes,
        bytesSha256: capture.bytesSha256,
        captureStatus: capture.status,
        error: capture.error || null,
      })),
    },
    limitations: [...(reference.limitations || []), ...(analysis.limitations || []).map((line) => String(line).slice(0, 500))],
    priceProofs: [],
    priceProofCount: 0,
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
  lines.push('# Menu-extractie: bestaande kaarten, Bardot, Zuyd, Wolfslaar en T-Huis (#59 criterium 5)');
  lines.push('');
  lines.push('Ontwikkelaarsbewijs op de vastgezette bytes. Bardot is gemeten op de dinerkaart-PDF waarvan de SHA-256 gelijk is aan de hash in de kaartcapture; Zuyd op de al gepinde HTML-menupagina\'s; Wolfslaar op de entrypagina, beide menupagina\'s en de menu-1-overzichtspagina die review 6349832755 K1 eenmalig vastlegde. T-Huis is vastgelegd maar niet meetbaar: de menupagina levert de vijf kaarten alleen als SVG-afbeelding. Geen netwerk, geen provider, geen database en geen publicatie.');
  lines.push('');
  lines.push('Het eigenaarsbesluit voor deze vier kaarten is GitHub #59 issuecomment-6315226470 (optie 1, vier bestaande kaarten plus een ongeziene set).');
  lines.push('');
  lines.push('## Totalen (alleen gemeten kaarten)');
  lines.push('');
  lines.push('| Maat | Waarde |');
  lines.push('| --- | --- |');
  lines.push(`| Kaarten gemeten / geblokkeerd | ${report.totals.capturedSources} / ${report.totals.blockedSources} |`);
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
  lines.push('De totalen zijn per kaart afzonderlijk te lezen en worden nooit tot één succescijfer samengevoegd.');
  lines.push('');
  lines.push('## Per kaart');
  lines.push('');
  lines.push('| Kaart | Status | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const source of report.sources) {
    lines.push(`| ${source.label} | ${source.captureStatus === 'captured' ? 'gemeten' : 'geblokkeerd'} | ${source.referenceItems} | ${source.actualItems} | ${source.matched} | ${source.missing} | ${source.invented} | ${source.priceErrors} | ${source.categoryErrors} | ${fmtPercent(source.precision)} | ${fmtPercent(source.recall)} |`);
  }
  lines.push('');
  lines.push('## Afwijkingen per kaart');
  for (const source of report.sources) {
    lines.push('');
    lines.push(`### ${source.label}`);
    lines.push('');
    if (source.captureStatus !== 'captured') {
      lines.push(`- **Geblokkeerd:** ${clean(source.blockedReason, 500) || 'bron niet leesbaar'}`);
      continue;
    }
    lines.push(`**Gemist (${source.missingDishes.length})**`);
    if (source.missingDishes.length === 0) lines.push('- geen');
    for (const row of source.missingDishes.slice(0, 40)) {
      lines.push(`- \`${clean(row.name, 120)}\` — ${clean(row.path.join(' › '), 200)} — prijs ${row.prices.join(' / ') || 'n.v.t.'} — citaat: “${clean(row.quote, 300)}” (${clean(row.locator, 200)})`);
    }
    if (source.missingDishes.length > 40) lines.push(`- … en ${source.missingDishes.length - 40} meer in het JSON-rapport`);
    lines.push('');
    lines.push(`**Verzonnen (${source.inventedDishes.length})**`);
    if (source.inventedDishes.length === 0) lines.push('- geen');
    for (const row of source.inventedDishes.slice(0, 40)) {
      const evidence = clean(row.quote, 300);
      const support = evidence ? `broncitaat: “${evidence}”` : `geen bronpassage${row.locator ? ` (extractor-locator: ${clean(row.locator, 200)})` : ''}`;
      lines.push(`- \`${clean(row.name, 120)}\` — ${clean(row.path.join(' › '), 200)} — prijs ${row.prices.join(' / ') || 'n.v.t.'} — ${support}`);
    }
    if (source.inventedDishes.length > 40) lines.push(`- … en ${source.inventedDishes.length - 40} meer in het JSON-rapport`);
    lines.push('');
    lines.push(`**Prijsfouten (${source.priceErrorRows.length})**`);
    if (source.priceErrorRows.length === 0) lines.push('- geen');
    for (const row of source.priceErrorRows.slice(0, 40)) {
      lines.push(`- \`${clean(row.name, 120)}\` — verwacht ${(row.expectedPrices || []).join(' / ') || 'n.v.t.'} — gelezen ${(row.actualPrices || []).join(' / ') || 'n.v.t.'}`);
    }
    lines.push('');
    lines.push(`**Rubriekfouten (${source.categoryErrorRows.length})**`);
    if (source.categoryErrorRows.length === 0) lines.push('- geen');
    for (const row of source.categoryErrorRows.slice(0, 40)) {
      lines.push(`- \`${clean(row.name, 120)}\` — verwacht ${clean((row.expectedPath || []).join(' › '), 200)} — gelezen ${clean((row.actualPath || []).join(' › '), 200)}`);
    }
    lines.push('');
    lines.push('**Beperkingen**');
    for (const limitation of source.limitations || []) lines.push(`- ${clean(limitation, 500)}`);
    lines.push('');
    lines.push(`**Vastgezette bronversie:** ${source.sourceVersion.captures.length} capture(s); ${source.sourceVersion.captures.map((capture) => `${capture.kind} ${(capture.bytesSha256 || capture.observedBytesSha256 || 'geen-hash').slice(0, 12)}`).join(', ')}`);
  }
  lines.push('');
  lines.push('## Integriteit en herhaalbaarheid');
  lines.push('');
  lines.push(`- Telregels: \`${report.countingRules.path}\`, SHA-256 \`${report.countingRules.sha256}\` (ongewijzigd).`);
  lines.push(`- Kaartcapture: \`${report.cardCapture.path}\`, SHA-256 \`${report.cardCapture.bytesSha256}\`.`);
  lines.push(`- Bardot-pin: \`${report.cardPin.path}\`, SHA-256 \`${report.cardPin.bytesSha256}\`.`);
  lines.push(`- Wolfslaar-pin: \`${report.cardPins[0].path}\`, SHA-256 \`${report.cardPins[0].bytesSha256}\`.`);
  lines.push(`- T-Huis-pin: \`${report.cardPins[1].path}\`, SHA-256 \`${report.cardPins[1].bytesSha256}\`.`);
  lines.push(`- Bardot-referentie: \`${report.bardotReference.path}\`, SHA-256 \`${report.bardotReference.bytesSha256}\`, ${report.bardotReference.items} items in ${report.bardotReference.categories} rubriekpaden en ${report.bardotReference.supplements} supplementen.`);
  lines.push(`- Zuyd-referentie: \`${report.zuydReference.path}\`, SHA-256 \`${report.zuydReference.bytesSha256}\` (ongewijzigd).`);
  lines.push(`- Wolfslaar-referentie: \`${report.wolfslaarReference.path}\`, SHA-256 \`${report.wolfslaarReference.bytesSha256}\`, ${report.wolfslaarReference.items} items in ${report.wolfslaarReference.categories} rubriekpaden, ${report.wolfslaarReference.arrangements} arrangementen en ${report.wolfslaarReference.supplements} supplementen.`);
  lines.push(`- T-Huis-referentie: \`${report.thuisReference.path}\`, SHA-256 \`${report.thuisReference.bytesSha256}\`; status \`${report.thuisReference.status}\`, geen item.`);
  lines.push(`- Iedere Bardot-referentiequote is tegen de vastgezette PDF-tekst gecontroleerd; ${report.bardotReference.priceProofs} prijsbewijzen zijn opnieuw aan de vastgezette paginarij gekoppeld.`);
  lines.push('- Iedere Wolfslaar-referentiequote is tegen de vastgezette HTML-tekst gecontroleerd; een quote die niet in de vastgezette bytes staat, stopt de meting.');
  lines.push('- De analyse is op de vastgezette bytes herhaald zonder netwerkoproep; hetzelfde script op dezelfde bytes levert hetzelfde rapport.');
  lines.push('- Deze vier kaarten zijn geen ongeziene holdout en dit is geen productieacceptatie.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const pin = readJson(CARD_PIN_PATH);
  const cardBytes = fs.readFileSync(CARD_CAPTURE_PATH);
  const cardReferences = JSON.parse(cardBytes.toString('utf8'));
  const cardSource = cardReferences.sources[pin.sourceId];
  if (!cardSource) throw new Error(`card pin: ${pin.sourceId} is not a pinned card source`);
  const pinCheck = validateCardReferenceCapturePin(pin, { ...cardSource, captureSourceId: pin.sourceId }, textSha256(cardBytes));
  if (!pinCheck.ok) throw new Error(`card pin is invalid: ${pinCheck.errors.join('; ')}`);

  const referenceIndex = readJson(REFERENCE_INDEX_PATH);
  const countingRulesFile = path.join(REPO_ROOT, referenceIndex.countingRules.path);
  const countingRulesSha = textSha256(fs.readFileSync(countingRulesFile));
  if (countingRulesSha !== referenceIndex.countingRules.sha256) {
    throw new Error(`counting rules changed: ${countingRulesSha} != ${referenceIndex.countingRules.sha256}`);
  }

  const bardotReferenceBytes = fs.readFileSync(BARDOT_REFERENCE_PATH);
  const bardotReference = JSON.parse(bardotReferenceBytes.toString('utf8'));
  const zuydEntry = referenceIndex.sources.find((entry) => entry.id === 'zuyd');
  if (!zuydEntry) throw new Error('zuyd: the reference index has no zuyd entry');
  const zuydReferencePath = path.join(REPO_ROOT, zuydEntry.file);
  const zuydReferenceBytes = fs.readFileSync(zuydReferencePath);
  const zuydReference = JSON.parse(zuydReferenceBytes.toString('utf8'));

  for (const [id, reference] of [['bardot', bardotReference], ['zuyd', zuydReference]]) {
    const shape = validateReferenceShape(reference);
    if (!shape.ok) throw new Error(`${id}: reference is not comparable: ${shape.errors.join('; ')}`);
  }
  const metadata = readJson(REFERENCE_METADATA_PATH);

  // The two pins of review 6349832755 K1, validated against the same pinned card
  // capture and the same closed seed rules the capture script used.
  const cardSources = readJson(CARD_SOURCE_MANIFEST_PATH).sources;
  const wolfslaarBytes = fs.readFileSync(WOLFSLAAR_PIN_PATH);
  const thuisBytes = fs.readFileSync(THUIS_PIN_PATH);
  const wolfslaarPin = JSON.parse(wolfslaarBytes.toString('utf8'));
  const thuisPin = JSON.parse(thuisBytes.toString('utf8'));
  for (const [id, pin, sourceId] of [['wolfslaar', wolfslaarPin, 'wolfslaar'], ['thuis', thuisPin, 'thuis']]) {
    const cardSource = cardSources.find((candidate) => candidate.id === sourceId);
    if (!cardSource) throw new Error(`${id}: the card source manifest has no ${sourceId} entry`);
    const historical = ((cardReferences.sources[sourceId] || {}).historical || []).map((row) => row.sourceUrl).filter(Boolean);
    const check = validateCardSourceCapturePin(pin, cardSource, { historicalUrls: historical, cardCaptureSha256: textSha256(cardBytes) });
    if (!check.ok) throw new Error(`${id} pin is invalid: ${check.errors.join('; ')}`);
  }
  const wolfslaarReferenceBytes = fs.readFileSync(WOLFSLAAR_REFERENCE_PATH);
  const thuisReferenceBytes = fs.readFileSync(THUIS_REFERENCE_PATH);
  const wolfslaarReference = JSON.parse(wolfslaarReferenceBytes.toString('utf8'));
  const thuisReference = JSON.parse(thuisReferenceBytes.toString('utf8'));
  for (const [id, reference] of [['wolfslaar', wolfslaarReference], ['thuis', thuisReference]]) {
    const shape = validateReferenceShape(reference);
    if (!shape.ok) throw new Error(`${id}: reference is not comparable: ${shape.errors.join('; ')}`);
  }

  const sources = [
    await measureBardot(pin, cardSource, bardotReference),
    await measureZuyd(metadata, zuydReference),
    await measurePinnedCard({ pin: wolfslaarPin, reference: wolfslaarReference, sourceId: 'wolfslaar' }),
    blockedCardResult({
      label: thuisReference.label,
      sourceId: 'thuis',
      blockedReason: thuisReference.blockedReason,
      pin: thuisPin,
      limitations: thuisReference.limitations || [],
    }),
  ];
  const totals = aggregateControlledReferences(sources);
  const bardotItems = bardotReference.menus.reduce((sum, menu) => sum + menu.categories.reduce((inner, category) => inner + category.items.length, 0), 0);
  const bardotCategories = bardotReference.menus.reduce((sum, menu) => sum + menu.categories.length, 0);
  const wolfslaarItems = wolfslaarReference.menus.reduce((sum, menu) => sum + menu.categories.reduce((inner, category) => inner + category.items.length, 0), 0);

  const report = {
    version: '1.0.0',
    issue: 59,
    criterion: 'criterion 5 - existing cards against controlled sources (Bardot, Zuyd, Wolfslaar, T-Huis)',
    countingRules: referenceIndex.countingRules,
    cardCapture: { path: repositoryPath(CARD_CAPTURE_PATH), bytesSha256: textSha256(cardBytes) },
    cardPin: { path: repositoryPath(CARD_PIN_PATH), bytesSha256: textSha256(fs.readFileSync(CARD_PIN_PATH)) },
    cardPins: [
      { path: repositoryPath(WOLFSLAAR_PIN_PATH), bytesSha256: textSha256(wolfslaarBytes) },
      { path: repositoryPath(THUIS_PIN_PATH), bytesSha256: textSha256(thuisBytes) },
    ],
    bardotReference: {
      path: repositoryPath(BARDOT_REFERENCE_PATH),
      bytesSha256: textSha256(bardotReferenceBytes),
      items: bardotItems,
      categories: bardotCategories,
      supplements: bardotReference.supplements.length,
      ambiguous: bardotReference.ambiguous.length,
      priceProofs: sources[0].priceProofCount || 0,
    },
    zuydReference: { path: repositoryPath(zuydReferencePath), bytesSha256: textSha256(zuydReferenceBytes) },
    wolfslaarReference: {
      path: repositoryPath(WOLFSLAAR_REFERENCE_PATH),
      bytesSha256: textSha256(wolfslaarReferenceBytes),
      items: wolfslaarItems,
      categories: wolfslaarReference.menus.reduce((sum, menu) => sum + menu.categories.length, 0),
      arrangements: wolfslaarReference.arrangements.length,
      supplements: wolfslaarReference.supplements.length,
      ambiguous: wolfslaarReference.ambiguous.length,
    },
    thuisReference: {
      path: repositoryPath(THUIS_REFERENCE_PATH),
      bytesSha256: textSha256(thuisReferenceBytes),
      status: thuisReference.captureStatus,
      items: 0,
      blockedReason: thuisReference.blockedReason,
    },
    method: 'Offline replay of the current pipeline on the pinned bytes only. Bardot: the hash-verified 2025-11 dinerkaart PDF, measured directly. Zuyd: the already pinned HTML menu pages replayed through the real analysis. Wolfslaar: the entry page, both menu pages and the menu-1 overview page pinned once by review 6349832755 K1. T-Huis: the pinned entry and menu pages are reported, but the menu page carries its five cards as SVG images only, so it stays blocked instead of counting as an empty success. Comparison, deviation classes and precision/recall come from ops/benchmark/referenceComparison.js unchanged; the counting rules are the pinned ones. No network, provider, OCR or database write.',
    totals,
    sources,
  };

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(OUT_MD, renderMarkdown(report));

  process.stdout.write('kaart\tstatus\treferentie\textractie\tmatch\tgemist\tverzonnen\tprijs\trubriek\tprecisie\trecall\n');
  for (const source of sources) {
    process.stdout.write(`${source.label}\t${source.captureStatus}\t${source.referenceItems}\t${source.actualItems}\t${source.matched}\t${source.missing}\t${source.invented}\t${source.priceErrors}\t${source.categoryErrors}\t${fmtPercent(source.precision)}\t${fmtPercent(source.recall)}\n`);
  }
  process.stdout.write(`TOTAAL\t${totals.capturedSources}/${totals.sources}\t${totals.referenceItems}\t${totals.actualItems}\t${totals.matched}\t${totals.missing}\t${totals.invented}\t${totals.priceErrors}\t${totals.categoryErrors}\t${fmtPercent(totals.precision)}\t${fmtPercent(totals.recall)}\n`);
  process.stdout.write(`${repositoryPath(OUT_JSON)}\n${repositoryPath(OUT_MD)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'card reference measurement failed'}\n`);
  process.exitCode = 1;
});

