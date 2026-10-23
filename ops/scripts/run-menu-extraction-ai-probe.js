#!/usr/bin/env node
'use strict';

// K4 of the Delivery Lead order for #59 / BE-21 (review 6370840673): the bounded
// AI probe over the pinned captures of Zuyd, Andalous, Pellens, Chocolat, Smelt,
// Blossem, Bardot and Wolfslaar.
//
// Dry-run (default): reads only the pinned local captures, estimates prompt
// tokens and cost per source with the fixed price table and writes a report.
// No key, no network, no SDK client, no paid call.
//
// Live: requires the explicit --live flag, --budget-file=<gitignored path> and
// ANTHROPIC_API_KEY in the environment. The durable ledger enforces the caps
// before every call; the probe stops immediately on cost_unknown,
// budget_settle_failed or an exceeded cap, and after more than half of the
// calls failed on the schema. Two runs per source measure stability.
//
// Usage:
//   node ops/scripts/run-menu-extraction-ai-probe.js
//   node ops/scripts/run-menu-extraction-ai-probe.js --source=zuyd --runs=2
//   node ops/scripts/run-menu-extraction-ai-probe.js --live --budget-file=ops/benchmark/output/ai-probe-budget-ledger.json
//
// Exit codes: 0 report written, 1 runtime/integrity error, 2 a precondition
// refused the run (no key, no budget file, over budget, invalid output path).

const fs = require('node:fs');
const path = require('node:path');

const {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_MODEL,
  createAnthropicStructuredCall,
} = require('../../src/lib/menuExtractionAnthropicCall');
const { createStructuredExtractionAdapter, runStructuredExtraction } = require('../../src/lib/menuExtractionAdapter');
const { loadMenuExtractionProtocol, protocolMetadata } = require('../../src/lib/menuExtractionProtocol');
const { createFileBudgetLedger } = require('../../src/lib/menuExtractionBudgetLedger');
const { aggregateControlledReferences, compareControlledReference } = require('../benchmark/referenceComparison');
const { REPO_ROOT, attachCaptureTexts, defaultLedgerFile, loadProbeSet } = require('../benchmark/menuExtractionProbeSet');
const {
  PROBE_BUDGET,
  PROBE_LIMITS,
  PROBE_RUNS,
  PROBE_SOURCE_IDS,
  chunkCaptures,
  estimateProbe,
  evaluateStop,
  summarizeSource,
} = require('../benchmark/menuExtractionProbe');

const OUTPUT_DIRECTORY = path.join(REPO_ROOT, 'ops', 'benchmark', 'output');
const DEFAULT_OUT = path.join(OUTPUT_DIRECTORY, 'ai-probe-report.json');

function parseArgs(argv = []) {
  const options = {
    live: false,
    runs: PROBE_RUNS,
    source: 'all',
    out: DEFAULT_OUT,
    budgetFile: defaultLedgerFile(REPO_ROOT),
    budgetFileProvided: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--live') options.live = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--runs=')) {
      const runs = Number.parseInt(arg.slice('--runs='.length), 10);
      if (!Number.isInteger(runs) || runs < 1 || runs > 2) throw new Error('--runs must be 1 or 2');
      options.runs = runs;
    } else if (arg.startsWith('--source=')) {
      const source = arg.slice('--source='.length);
      if (source !== 'all' && !PROBE_SOURCE_IDS.includes(source)) throw new Error(`--source must be all or one of ${PROBE_SOURCE_IDS.join(', ')}`);
      options.source = source;
    } else if (arg.startsWith('--out=')) {
      options.out = path.resolve(REPO_ROOT, arg.slice('--out='.length));
    } else if (arg.startsWith('--budget-file=')) {
      options.budgetFile = path.resolve(REPO_ROOT, arg.slice('--budget-file='.length));
      options.budgetFileProvided = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/**
 * A report or ledger may never appear as a tracked file: inside the repository
 * only ops/benchmark/output/ is allowed; an absolute path outside is the
 * caller's own choice.
 */
function assertOutputPath(file, label = 'output') {
  const relativeToRepo = path.relative(REPO_ROOT, file);
  const insideRepository = relativeToRepo.length > 0 && !relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo);
  if (!insideRepository) return;
  const relativeToOutput = path.relative(OUTPUT_DIRECTORY, file);
  if (!relativeToOutput.length || relativeToOutput.startsWith('..') || path.isAbsolute(relativeToOutput)) {
    throw new Error(`${label} ${file} must stay inside the gitignored ops/benchmark/output folder`);
  }
}

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function selectSources(sources, requested) {
  return (Array.isArray(sources) ? sources : []).filter((source) => requested === 'all' || source.id === requested);
}

function formatPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : 'n.v.t.';
}

function printEstimate(report) {
  const rows = report.rows.map((row) => [
    row.id,
    row.captureStatus,
    String(row.captures),
    String(row.calls),
    String(row.maxPromptTokens),
    String(row.estimatedOutputTokensCeiling),
    String(row.estimatedCostEurCents),
    String(row.estimatedCostTypicalEurCents),
  ]);
  process.stdout.write('bron\tstatus\tcaptures\tcalls\tprompttok/call\toutputplafond\tkosten cent\ttypisch cent\n');
  for (const row of rows) process.stdout.write(`${row.join('\t')}\n`);
  process.stdout.write(
    `TOTAAL\t${report.totals.capturedSources}/${report.totals.sources}\t-\t${report.totals.plannedCalls}\t-\t-\t${report.totals.estimatedCostEurCents}\t${report.totals.estimatedCostTypicalEurCents}\n`,
  );
  process.stdout.write(`protocol ${report.protocol.instructionVersion} sha256 ${report.protocol.instructionHash}\n`);
  process.stdout.write(`model ${report.model}; budget ${report.budget.cumulativeLimitEurCents} cent totaal, ${report.budget.perCallLimitEurCents} cent per call, ${report.budget.maxCalls} calls\n`);
  for (const blocked of report.blocked) process.stdout.write(`geblokkeerd: ${blocked.id} - ${blocked.reason}\n`);
}

async function dryRun(options) {
  const set = loadProbeSet();
  const selected = selectSources(set.sources, options.source);
  await attachCaptureTexts(selected, { root: REPO_ROOT });
  const protocol = loadMenuExtractionProtocol({ root: REPO_ROOT });
  const estimate = estimateProbe(selected, { protocol: protocol.text, runs: options.runs, limits: PROBE_LIMITS });
  const report = {
    version: '1.0.0',
    issue: 59,
    mode: 'dry-run',
    network: false,
    providerCall: false,
    model: ANTHROPIC_MODEL,
    protocol: protocolMetadata(protocol),
    runs: options.runs,
    limits: estimate.limits,
    budget: estimate.budget,
    pricing: estimate.pricing,
    assumptions: estimate.assumptions,
    problems: set.problems,
    sources: selected.map((source) => ({
      id: source.id,
      label: source.label,
      captureStatus: source.captureStatus,
      blockedReason: source.blockedReason || null,
      referencePath: source.referencePath,
      referenceSha256: source.referenceSha256,
      referenceItems: source.referenceItems,
      captures: source.captures.map((capture) => ({
        id: capture.id,
        url: capture.url,
        kind: capture.kind,
        localPath: capture.localPath,
        bytesSha256: capture.bytesSha256,
        textChars: capture.textChars || null,
      })),
    })),
    rows: estimate.rows,
    totals: estimate.totals,
    blocked: estimate.blocked,
  };
  writeJsonAtomically(options.out, report);
  printEstimate(report);
  process.stdout.write(`${path.relative(REPO_ROOT, options.out).split(path.sep).join('/')}\n`);
  const fits = report.totals.callsWithinBudget && report.totals.costWithinBudget && report.totals.inputWithinLimit && report.totals.perCallWithinBudget;
  if (!fits) {
    process.stderr.write('de raming past niet binnen de vaste limieten; een live run wordt geweigerd\n');
    return 2;
  }
  return 0;
}

function blockedSourceRow(source) {
  return {
    sourceId: source.id,
    label: source.label,
    captureStatus: 'blocked',
    blockedReason: source.blockedReason || 'not captured',
    menus: [],
    referenceItems: source.referenceItems || 0,
    actualItems: 0,
    matched: 0,
    missing: 0,
    invented: 0,
    priceErrors: 0,
    categoryErrors: 0,
    titleOnlyCategoryErrors: 0,
    precision: null,
    recall: null,
    evidence: { items: 0, withQuote: 0, verified: 0, ratio: null },
    variants: null,
    stability: null,
  };
}

function safeLedgerSnapshot(ledger) {
  try {
    return ledger.snapshot();
  } catch (err) {
    return { error: err && err.code ? err.code : 'budget_ledger_unreadable' };
  }
}

function printLive(report) {
  process.stdout.write('bron\tstatus\treferentie\textractie\tmatch\tgemist\tverzonnen\tprijs\trubriek\tbewijs\tkosten cent\tstabiliteit\n');
  for (const source of report.sources) {
    const evidence = source.evidence && typeof source.evidence.ratio === 'number' ? `${source.evidence.ratio}%` : 'n.v.t.';
    const stability = source.stability ? `${source.stability.jaccardPercent}%${source.stability.identical ? ' (gelijk)' : ''}` : 'n.v.t.';
    const cost = report.calls
      .filter((call) => call.sourceId === source.sourceId)
      .reduce((total, call) => total + (Number.isInteger(call.costEurCents) ? call.costEurCents : 0), 0);
    process.stdout.write(
      `${source.sourceId}\t${source.captureStatus}\t${source.referenceItems}\t${source.actualItems}\t${source.matched}\t${source.missing}\t${source.invented}\t${source.priceErrors}\t${source.categoryErrors}\t${evidence}\t${cost}\t${stability}\n`,
    );
  }
  process.stdout.write(
    `TOTAAL\t${report.totals.capturedSources}/${report.totals.sources}\t${report.totals.referenceItems}\t${report.totals.actualItems}\t${report.totals.matched}\t${report.totals.missing}\t${report.totals.invented}\t${report.totals.priceErrors}\t${report.totals.categoryErrors}\t-\t${report.totals.actualCostEurCents}\t-\n`,
  );
  if (report.stop) process.stdout.write(`gestopt: ${report.stop.code} (${report.stop.sourceId || '-'})\n`);
  if (report.notRun.length > 0) process.stdout.write(`niet uitgevoerd: ${report.notRun.join(', ')}\n`);
}

async function runLive(options) {
  if (!process.env[ANTHROPIC_API_KEY_ENV]) {
    return { code: 2, message: `live mode needs ${ANTHROPIC_API_KEY_ENV}; the adapter stays provider_not_configured. No call was made.` };
  }
  if (!options.budgetFileProvided) {
    return { code: 2, message: 'live mode needs an explicit --budget-file=<path> so the spend is durable. No call was made.' };
  }
  try {
    assertOutputPath(options.budgetFile, 'budget file');
  } catch (err) {
    return { code: 2, message: `${err.message}. No call was made.` };
  }
  assertOutputPath(options.out, 'report');

  const protocol = loadMenuExtractionProtocol({ root: REPO_ROOT });
  const set = loadProbeSet();
  const selected = selectSources(set.sources, options.source);
  await attachCaptureTexts(selected, { root: REPO_ROOT });

  let ledger;
  try {
    ledger = createFileBudgetLedger({ file: options.budgetFile, limits: PROBE_BUDGET });
  } catch (err) {
    return { code: 2, message: `the budget ledger refused the run (${err && err.code ? err.code : 'unknown'}). No call was made.` };
  }
  const callModule = createAnthropicStructuredCall({ env: process.env, budget: ledger });
  if (!callModule.enabled) return { code: 2, message: 'the Anthropic call stays provider_not_configured. No call was made.' };
  const adapter = createStructuredExtractionAdapter({
    provider: callModule.provider,
    model: callModule.model,
    call: callModule.call,
    cancel: callModule.cancel,
  });

  const report = {
    version: '1.0.0',
    issue: 59,
    mode: 'live',
    provider: callModule.provider,
    model: callModule.model,
    sdkVersion: callModule.sdkVersion,
    protocol: protocolMetadata(protocol),
    runs: options.runs,
    limits: PROBE_LIMITS,
    budget: PROBE_BUDGET,
    pricing: callModule.pricing,
    sources: [],
    calls: [],
    stop: null,
    notRun: [],
  };

  let calls = 0;
  let schemaErrors = 0;
  let stopped = false;

  for (const source of selected) {
    if (stopped) {
      report.notRun.push(source.id);
      continue;
    }
    if (source.captureStatus !== 'captured') {
      report.sources.push(blockedSourceRow(source));
      continue;
    }
    const textById = new Map();
    const runs = [];
    for (let run = 1; run <= options.runs && !stopped; run += 1) {
      const menus = [];
      for (const chunk of chunkCaptures(source.captures, PROBE_LIMITS.maxDocuments)) {
        const inventory = chunk.map((capture) => {
          const entry = { id: capture.id, url: capture.url, kind: capture.kind, pageCount: capture.pageCount, status: 'read', text: capture.text };
          textById.set(capture.id, entry);
          return entry;
        });
        const result = await runStructuredExtraction({ adapter, protocol, sources: inventory, limits: PROBE_LIMITS, budget: ledger });
        calls += 1;
        const record = {
          sourceId: source.id,
          run,
          captureIds: chunk.map((capture) => capture.id),
          ok: result.ok === true,
          reason: result.reason || null,
          costEurCents: result.meta ? result.meta.actualCostEurCents : null,
          usage: callModule.lastCall ? callModule.lastCall.usage : null,
          stopReason: callModule.lastCall ? callModule.lastCall.stopReason : null,
        };
        if (!result.ok && Array.isArray(result.problems)) record.problems = result.problems.slice(0, 5);
        report.calls.push(record);
        if (!result.ok) {
          if (result.reason === 'schema_violation') schemaErrors += 1;
          const stop = evaluateStop({ reason: result.reason, calls, schemaErrors });
          if (stop.stop) {
            report.stop = { ...stop, sourceId: source.id, run, reason: result.reason };
            stopped = true;
          }
          break;
        }
        if (Array.isArray(result.output.menus)) menus.push(...result.output.menus);
      }
      runs.push(menus);
    }
    if (runs.length === 0) {
      report.sources.push(blockedSourceRow({ ...source, blockedReason: `stopped before the first call: ${report.stop ? report.stop.code : 'unknown'}` }));
      continue;
    }
    const primary = runs[0];
    const comparison = compareControlledReference(source.reference, primary, { label: source.label, sourceId: source.id, captureStatus: 'captured' });
    report.sources.push(
      summarizeSource({
        source,
        reference: source.reference,
        menus: primary,
        comparison,
        sourceById: textById,
        titles: primary.map((menu) => menu.title),
        runs,
      }),
    );
  }

  const actualCostEurCents = report.calls.reduce((total, call) => total + (Number.isInteger(call.costEurCents) ? call.costEurCents : 0), 0);
  report.totals = {
    ...aggregateControlledReferences(report.sources),
    calls,
    actualCostEurCents,
    schemaErrors,
    ledger: safeLedgerSnapshot(ledger),
  };
  writeJsonAtomically(options.out, report);
  printLive(report);
  process.stdout.write(`${path.relative(REPO_ROOT, options.out).split(path.sep).join('/')}\n`);
  return { code: 0 };
}

const USAGE = `Gebruik:
  node ops/scripts/run-menu-extraction-ai-probe.js [--source=all|<id>] [--runs=1|2]
  node ops/scripts/run-menu-extraction-ai-probe.js --live --budget-file=ops/benchmark/output/ai-probe-budget-ledger.json [--source=...] [--runs=1|2]

Zonder --live is dit een dry-run: alleen een raming uit de gepinde captures,
geen sleutel en geen netwerk. --live vereist ANTHROPIC_API_KEY in de omgeving en
een expliciet --budget-file in de gitignored ops/benchmark/output-map.
Bronnen: ${PROBE_SOURCE_IDS.join(', ')}.
`;

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
    assertOutputPath(options.out, 'report');
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : 'invalid output path'}\n`);
    return 2;
  }
  if (options.live) {
    try {
      const result = await runLive(options);
      if (result && result.message) process.stderr.write(`${result.message}\n`);
      return result ? result.code : 1;
    } catch (err) {
      process.stderr.write(`${err && err.message ? err.message : 'the live probe failed'}\n`);
      return 1;
    }
  }
  try {
    return await dryRun(options);
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : 'the dry run failed'}\n`);
    return 1;
  }
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${err && err.message ? err.message : 'the probe failed'}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_OUT,
  OUTPUT_DIRECTORY,
  assertOutputPath,
  dryRun,
  main,
  parseArgs,
  printLive,
  runLive,
  selectSources,
  writeJsonAtomically,
};
