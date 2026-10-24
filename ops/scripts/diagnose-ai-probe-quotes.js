#!/usr/bin/env node
'use strict';

// Q2 of the Delivery Lead order for #59 / BE-21 (review 6375125413): an offline
// diagnosis of the citations in a rejected (or any saved) answer.
//
// It reads the live report, finds every call that has a saved answer (Q1),
// verifies that answer against its recorded SHA-256, and reports per failed
// citation: the quote, the item, the nearest source fragments and a
// classification (added separator, merged lines, changed characters, changed
// whitespace, invented text).
//
// Offline by construction: the pinned captures are read from the local
// gitignored output folder, no key is read, no network call is made and no app
// route is involved. A rejected answer is diagnosis, not acceptance: this script
// never changes a report, a reference, a counting rule or the validator.
//
// Usage:
//   node ops/scripts/diagnose-ai-probe-quotes.js
//   node ops/scripts/diagnose-ai-probe-quotes.js --source=zuyd
//   node ops/scripts/diagnose-ai-probe-quotes.js --raw-file=ops/benchmark/output/ai-probe-raw/<file> --source=zuyd
//
// Exit codes: 0 diagnosis written (or nothing to diagnose), 1 read/integrity
// error, 2 a refused argument or output path.

const fs = require('node:fs');
const path = require('node:path');

const { assertOutputPath } = require('./run-menu-extraction-ai-probe');
const { REPO_ROOT, attachCaptureTexts, loadProbeSet } = require('../benchmark/menuExtractionProbeSet');
const { diagnoseRawText } = require('../benchmark/quoteDiagnostics');
const { readRawAnswer } = require('../benchmark/aiProbeRawOutput');

const OUTPUT_DIRECTORY = path.join(REPO_ROOT, 'ops', 'benchmark', 'output');
const DEFAULT_REPORT = path.join(OUTPUT_DIRECTORY, 'ai-probe-report.json');
const DEFAULT_OUT = path.join(OUTPUT_DIRECTORY, 'ai-probe-quote-diagnosis.json');
const DIAGNOSIS_FILE_VERSION = '1.0.0';

function parseArgs(argv = []) {
  const options = { report: DEFAULT_REPORT, out: DEFAULT_OUT, source: null, rawFile: null, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--report=')) options.report = path.resolve(REPO_ROOT, arg.slice('--report='.length));
    else if (arg.startsWith('--out=')) options.out = path.resolve(REPO_ROOT, arg.slice('--out='.length));
    else if (arg.startsWith('--source=')) options.source = arg.slice('--source='.length);
    else if (arg.startsWith('--raw-file=')) options.rawFile = path.resolve(REPO_ROOT, arg.slice('--raw-file='.length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.rawFile && !options.source) throw new Error('--raw-file needs --source=<id> so the text can be compared');
  return options;
}

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

/** The exact inputs of one call: only the captures it actually received. */
function inventoryForCall(call, capturesBySource) {
  const captures = capturesBySource[call.sourceId] || [];
  const ids = Array.isArray(call.captureIds) ? call.captureIds : captures.map((capture) => capture.id);
  return captures
    .filter((capture) => ids.includes(capture.id))
    .map((capture) => ({ id: capture.id, url: capture.url, kind: capture.kind, pageCount: capture.pageCount, status: 'read', text: capture.text }));
}

/**
 * Diagnoses every recorded call that has a saved answer. A call without one is
 * reported as `answer_missing`, never skipped silently: that is exactly the gap
 * Q1 closes.
 */
function diagnoseCalls({ calls, capturesBySource, readAnswer = readRawAnswer, root = REPO_ROOT, diagnose = diagnoseRawText } = {}) {
  const results = [];
  for (const call of Array.isArray(calls) ? calls : []) {
    if (!call || typeof call !== 'object') continue;
    const base = { call: call.call, sourceId: call.sourceId, ok: call.ok === true, reason: call.reason || null };
    if (typeof call.rawOutputFile !== 'string' || call.rawOutputFile.length === 0) {
      results.push({ ...base, rawOutputFile: null, diagnosis: null, error: base.ok ? null : 'answer_missing' });
      continue;
    }
    try {
      const reading = readAnswer({ file: call.rawOutputFile, root, expectedHash: call.rawOutputSha256 });
      results.push({
        ...base,
        rawOutputFile: call.rawOutputFile,
        rawOutputSha256: reading.hash,
        diagnosis: diagnose({ text: reading.text, sources: inventoryForCall(call, capturesBySource) }),
      });
    } catch (err) {
      results.push({
        ...base,
        rawOutputFile: call.rawOutputFile,
        diagnosis: null,
        error: err && err.message ? err.message : 'answer_unreadable',
      });
    }
  }
  return results;
}

function totalsOf(results) {
  const totals = { calls: 0, answers: 0, answersMissing: 0, items: 0, itemsWithInvalidQuote: 0, quotes: 0, classes: {} };
  for (const result of results) {
    totals.calls += 1;
    if (result.diagnosis) {
      totals.answers += 1;
      totals.items += Number.isInteger(result.diagnosis.items) ? result.diagnosis.items : 0;
      totals.itemsWithInvalidQuote += Number.isInteger(result.diagnosis.itemsWithInvalidQuote) ? result.diagnosis.itemsWithInvalidQuote : 0;
      totals.quotes += Array.isArray(result.diagnosis.quotes) ? result.diagnosis.quotes.length : 0;
      for (const [code, count] of Object.entries(result.diagnosis.classes || {})) {
        totals.classes[code] = (totals.classes[code] || 0) + count;
      }
    } else if (result.error) {
      totals.answersMissing += 1;
    }
  }
  return totals;
}

function printResults(results) {
  for (const result of results) {
    if (!result.diagnosis) {
      if (result.error) process.stdout.write(`call ${result.call} ${result.sourceId}: ${result.error}\n`);
      continue;
    }
    const diagnosis = result.diagnosis;
    const items = Number.isInteger(diagnosis.items) ? diagnosis.items : 'n.v.t.';
    const invalid = Number.isInteger(diagnosis.itemsWithInvalidQuote) ? diagnosis.itemsWithInvalidQuote : 'n.v.t.';
    const state = result.ok ? 'geaccepteerd' : String(result.reason || 'afgekeurd');
    process.stdout.write(`call ${result.call} ${result.sourceId} (${state}): items ${items}, ongeldig citaat ${invalid}\n`);
    if (diagnosis.outputParsed === false) process.stdout.write(`  antwoord is geen JSON: ${diagnosis.parseError}\n`);
    for (const quote of diagnosis.quotes || []) {
      process.stdout.write(`  ${quote.at} "${quote.itemName || '?'}" citaat "${quote.quote}" -> ${quote.label || quote.classification}\n`);
      for (const nearest of quote.nearest || []) {
        process.stdout.write(`    dichtstbij ${nearest.captureId}:${nearest.line} (${nearest.score}) "${nearest.text}"\n`);
      }
    }
    if (diagnosis.quotesNotReported > 0) process.stdout.write(`  ${diagnosis.quotesNotReported} verdere citaten niet in dit overzicht\n`);
  }
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : 'invalid arguments'}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    assertOutputPath(options.out, 'diagnosis');
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : 'invalid output path'}\n`);
    return 2;
  }

  const set = loadProbeSet();
  const selected = options.source ? set.sources.filter((source) => source.id === options.source) : set.sources;
  if (options.source && selected.length === 0) {
    process.stderr.write(`onbekende bron: ${options.source}\n`);
    return 2;
  }
  await attachCaptureTexts(selected, { root: REPO_ROOT });
  const capturesBySource = Object.fromEntries(selected.map((source) => [source.id, source.captures]));

  let results;
  let reportMeta = null;
  let singleRaw = null;
  if (options.rawFile) {
    // A single saved answer: useful when only the answer file survived.
    const source = selected[0];
    const reading = readRawAnswer({ file: options.rawFile, root: REPO_ROOT });
    singleRaw = { file: path.relative(REPO_ROOT, options.rawFile).split(path.sep).join('/'), sha256: reading.hash };
    results = [
      {
        call: null,
        sourceId: source ? source.id : null,
        ok: false,
        reason: 'manual',
        rawOutputFile: singleRaw.file,
        rawOutputSha256: reading.hash,
        diagnosis: diagnoseRawText({ text: reading.text, sources: (source && source.captures) || [] }),
      },
    ];
  } else {
    if (!fs.existsSync(options.report)) {
      process.stderr.write(`geen rapport op ${options.report}; draai eerst de proef\n`);
      return 2;
    }
    const report = JSON.parse(fs.readFileSync(options.report, 'utf8'));
    reportMeta = {
      file: path.relative(REPO_ROOT, options.report).split(path.sep).join('/'),
      protocol: report.protocol || null,
      model: report.model || null,
      rawOutputDirectory: report.rawOutput ? report.rawOutput.directory : null,
    };
    const calls = (Array.isArray(report.calls) ? report.calls : []).filter((call) => !options.source || call.sourceId === options.source);
    results = diagnoseCalls({ calls, capturesBySource });
  }

  const document = {
    version: DIAGNOSIS_FILE_VERSION,
    issue: 59,
    mode: 'offline',
    network: false,
    providerCall: false,
    note: 'Diagnosis only. A rejected answer is not an extraction and never changes a report, a reference or the validator.',
    report: reportMeta,
    singleRaw,
    calls: results,
    totals: totalsOf(results),
  };
  writeJsonAtomically(options.out, document);
  printResults(results);
  process.stdout.write(`${path.relative(REPO_ROOT, options.out).split(path.sep).join('/')}\n`);
  if (results.length === 0) process.stderr.write('geen aanroepen om te diagnosticeren\n');
  return results.some((result) => result.error) ? 1 : 0;
}

const USAGE = `Gebruik:
  node ops/scripts/diagnose-ai-probe-quotes.js [--report=ops/benchmark/output/ai-probe-report.json] [--out=...] [--source=<id>]
  node ops/scripts/diagnose-ai-probe-quotes.js --raw-file=<bewaard antwoord> --source=<id>

Offline diagnose van citaten in bewaarde antwoorden (Q2). Geen sleutel, geen
netwerk, geen aanroep. Per afgekeurd citaat: het citaat, het item, de
dichtstbijzijnde bronfragmenten en een classificatie. Het resultaat gaat naar
ops/benchmark/output/ai-probe-quote-diagnosis.json.
`;

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${err && err.message ? err.message : 'the diagnosis failed'}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_OUT,
  DEFAULT_REPORT,
  DIAGNOSIS_FILE_VERSION,
  diagnoseCalls,
  inventoryForCall,
  main,
  parseArgs,
  printResults,
  totalsOf,
  writeJsonAtomically,
};
