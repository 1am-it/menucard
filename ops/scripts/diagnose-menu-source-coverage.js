#!/usr/bin/env node
'use strict';

// X5 of the Delivery Lead order 6382189724 (variant 1): offline diagnosis of
// the comparison engine on the pinned captures and the literal AI answers of
// live run 2.
//
//   node ops/scripts/diagnose-menu-source-coverage.js
//   node ops/scripts/diagnose-menu-source-coverage.js --source=pellens --run=2
//
// It reads only local files: the pinned captures (hash-verified) and the raw
// answers the earlier live probe saved under ops/benchmark/output/ai-probe-raw/
// (gitignored). No key, no provider, no network, no database. It writes one
// gitignored report under ops/benchmark/output/ and changes no reference,
// counting rule or measurement code.
//
// Exit codes: 0 report written, 1 a read/integrity error, 2 a precondition
// refused the run.

const fs = require('node:fs');
const path = require('node:path');

const { loadProbeSet, attachCaptureTexts } = require('../benchmark/menuExtractionProbeSet');
const { DIAGNOSIS_VERSION, rawAnswerFiles, parseAnswers, diagnoseSource } = require('../benchmark/menuSourceCoverageDiagnosis');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RAW_DIR = path.join(REPO_ROOT, 'ops', 'benchmark', 'output', 'ai-probe-raw');
const OUTPUT_FILE = path.join(REPO_ROOT, 'ops', 'benchmark', 'output', 'ai-probe-coverage-diagnosis.json');

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

function writeAtomically(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, 'utf8');
  fs.renameSync(temp, file);
}

async function main() {
  const run = Number(argument('run', '2'));
  if (!Number.isInteger(run) || run < 1) {
    process.stderr.write('diagnose-menu-source-coverage: --run must be a positive integer\n');
    return 2;
  }
  const only = argument('source', '');
  if (!fs.existsSync(RAW_DIR)) {
    process.stderr.write(`diagnose-menu-source-coverage: ${path.relative(REPO_ROOT, RAW_DIR)} does not exist; run the live probe first\n`);
    return 2;
  }

  const probe = loadProbeSet({ root: REPO_ROOT });
  const sources = await attachCaptureTexts(probe.sources, { root: REPO_ROOT });
  const grouped = rawAnswerFiles(fs.readdirSync(RAW_DIR), { run });

  const rows = [];
  for (const source of sources) {
    if (only && source.id !== only) continue;
    const entries = (grouped.get(source.id) || []).map((entry) => ({
      ...entry,
      text: fs.readFileSync(path.join(RAW_DIR, entry.file), 'utf8'),
    }));
    const parsed = parseAnswers(entries);
    rows.push(
      diagnoseSource({
        sourceId: source.id,
        label: source.label,
        captureStatus: source.captureStatus,
        blockedReason: source.blockedReason,
        captures: source.captures,
        answers: parsed.answers,
        problems: parsed.problems,
      }),
    );
  }

  const document = {
    version: DIAGNOSIS_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'offline diagnosis: pinned captures plus saved run answers; no key, no call, no reference change',
    run,
    rawDirectory: 'ops/benchmark/output/ai-probe-raw',
    sources: rows,
  };
  writeAtomically(OUTPUT_FILE, `${JSON.stringify(document, null, 2)}\n`);

  process.stdout.write(`run ${run}: ${rows.length} sources\n`);
  for (const row of rows) {
    const comparison = row.comparison;
    const outcome =
      comparison.available === false
        ? `not comparable (${comparison.reason || 'unknown'})`
        : `${comparison.uncoveredLines} uncovered of ${row.pricedLines} priced lines`;
    process.stdout.write(
      `- ${row.sourceId}: ${outcome}; ${row.acceptedItems} accepted items, ${row.answerFiles.length} answers` +
        `${row.unreadableAnswers.length > 0 ? `, ${row.unreadableAnswers.length} unreadable` : ''}` +
        `${row.note ? `; ${row.note}` : ''}` +
        `${row.blockedReason ? `; blocked: ${row.blockedReason}` : ''}\n`,
    );
    for (const example of (comparison.examples || []).slice(0, 3)) {
      process.stdout.write(`    · ${example.text}${example.section ? ` (onder ${example.section})` : ''}\n`);
    }
  }
  process.stdout.write(`report: ${path.relative(REPO_ROOT, OUTPUT_FILE).split(path.sep).join('/')}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`diagnose-menu-source-coverage: ${(error && error.message) || error}\n`);
    process.exitCode = 1;
  });
