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
// before every call. Two runs per source measure stability.
//
// L1-L3 of the Delivery Lead order for #59 / BE-21 (review 6373183699), after a
// live run spent 13 calls of which 12 reported no usage:
//   - L1: every call appends one line to a gitignored JSONL file
//     (ops/benchmark/output/ai-probe-live-calls.jsonl) with source, run, reason,
//     HTTP status, stop_reason, usage, cost, duration and the provider request
//     id, and the report is rewritten atomically after every call;
//   - L2: the provider call streams (src/lib/menuExtractionAnthropicCall.js), so
//     a long generation is not cut off before it can report its usage; the call
//     timeout is 180 s;
//   - L3: the run stops immediately after any call whose cost is unknown,
//     whatever the technical reason was, and after two consecutive provider
//     failures or timeouts. The stop reason is stored in the report and in the
//     JSONL log. A schema error rate above half still stops it as before.
//
// M1-M3 of the Delivery Lead order for #59 / BE-21 (review 6373786786), after a
// live call failed with `400 invalid_request_error "Schema is too complex."` and
// an earlier one with `APIConnectionError` after 60 s without a stream event:
//   - M1: `--output-mode=schema` (default) sends the simplified schema via
//     `output_config`; `--output-mode=prompt` sends no `output_config` and puts
//     the same schema in the instruction block. The validator decides in both.
//     The mode is stored in the report and in every JSONL line.
//   - M2: a failed call stores the SDK error class, the API error type, a
//     sanitised message (max 300 chars) and the provider request id, plus the
//     transport cause code, in the JSONL line and in the report.
//   - M3: the configured call limit is a hard deadline on the provider call
//     itself (`deadlineHit`), so 180 s can no longer be undercut by an SDK or
//     transport default.
//
// Usage:
//   node ops/scripts/run-menu-extraction-ai-probe.js
//   node ops/scripts/run-menu-extraction-ai-probe.js --source=zuyd --runs=2
//   node ops/scripts/run-menu-extraction-ai-probe.js --live --budget-file=ops/benchmark/output/ai-probe-budget-ledger.json
//   node ops/scripts/run-menu-extraction-ai-probe.js --live --output-mode=prompt --budget-file=...
//   node ops/scripts/diagnose-ai-probe-quotes.js   (offline, after a live run)
//
// Q1-Q4 of the Delivery Lead order for #59 / BE-21 (review 6375125413), after
// both live Zuyd answers were rejected with `schema_violation` and the raw
// answers were gone:
//   - Q1: the literal JSON answer of every call is written to a gitignored file
//     under ops/benchmark/output/ai-probe-raw/ (text block only, no reasoning,
//     no key) and referenced from the report and the JSONL line;
//   - Q2: ops/benchmark/quoteDiagnostics.js + ops/scripts/diagnose-ai-probe-quotes.js
//     show per rejected citation the quote, the item, the nearest source
//     fragments and a classification;
//   - Q3: MENU-EXTRACTION.md v0.3 states the citation rule literally (validator
//     unchanged);
//   - Q4: a rejected answer reports its item and invalid-citation counts, and
//     still counts as zero extraction.
//
// Exit codes: 0 report written, 1 runtime/integrity error, 2 a precondition
// refused the run (no key, no budget file, over budget, invalid output path).

const fs = require('node:fs');
const path = require('node:path');

const {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_MODEL,
  DEFAULT_OUTPUT_MODE,
  OUTPUT_MODES,
  createAnthropicStructuredCall,
} = require('../../src/lib/menuExtractionAnthropicCall');
const { createStructuredExtractionAdapter, runStructuredExtraction } = require('../../src/lib/menuExtractionAdapter');
const { loadMenuExtractionProtocol, protocolMetadata } = require('../../src/lib/menuExtractionProtocol');
const { createFileBudgetLedger } = require('../../src/lib/menuExtractionBudgetLedger');
const { aggregateControlledReferences, compareControlledReference } = require('../benchmark/referenceComparison');
const { REPO_ROOT, attachCaptureTexts, defaultLedgerFile, loadProbeSet } = require('../benchmark/menuExtractionProbeSet');
const { createCallLog } = require('../benchmark/aiProbeCallLog');
// Q1-Q4 of the Delivery Lead order for #59 / BE-21 (review 6375125413): the
// literal answer of every live call is kept in a gitignored file, and a rejected
// answer is measured and diagnosed offline instead of being discarded.
const { writeRawAnswer } = require('../benchmark/aiProbeRawOutput');
const { diagnoseRawText } = require('../benchmark/quoteDiagnostics');
const {
  PROBE_BUDGET,
  PROBE_LIMITS,
  PROBE_RUNS,
  PROBE_SOURCE_IDS,
  chunkCaptures,
  estimateProbe,
  evaluateStop,
  isProviderFailureReason,
  summarizeSource,
} = require('../benchmark/menuExtractionProbe');

const OUTPUT_DIRECTORY = path.join(REPO_ROOT, 'ops', 'benchmark', 'output');
const DEFAULT_OUT = path.join(OUTPUT_DIRECTORY, 'ai-probe-report.json');
// L1 of review 6373183699: one line per provider call, gitignored, durable.
const DEFAULT_CALLS_FILE = path.join(OUTPUT_DIRECTORY, 'ai-probe-live-calls.jsonl');
// Q1 of review 6375125413: the literal JSON answer of every live call, one
// gitignored file per call, referenced from the report and the JSONL line.
const DEFAULT_RAW_OUTPUT_DIRECTORY = path.join(OUTPUT_DIRECTORY, 'ai-probe-raw');

function parseArgs(argv = []) {
  const options = {
    live: false,
    runs: PROBE_RUNS,
    source: 'all',
    out: DEFAULT_OUT,
    callsFile: DEFAULT_CALLS_FILE,
    rawOutputDirectory: DEFAULT_RAW_OUTPUT_DIRECTORY,
    budgetFile: defaultLedgerFile(REPO_ROOT),
    budgetFileProvided: false,
    outputMode: DEFAULT_OUTPUT_MODE,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--live') options.live = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--output-mode=')) {
      // M1 of review 6373786786: the schema is the default; `prompt` is the
      // documented fallback when the API refuses the schema itself.
      const mode = arg.slice('--output-mode='.length);
      if (!OUTPUT_MODES.includes(mode)) throw new Error(`--output-mode must be ${OUTPUT_MODES.join(' or ')}`);
      options.outputMode = mode;
    } else if (arg.startsWith('--runs=')) {
      const runs = Number.parseInt(arg.slice('--runs='.length), 10);
      if (!Number.isInteger(runs) || runs < 1 || runs > 2) throw new Error('--runs must be 1 or 2');
      options.runs = runs;
    } else if (arg.startsWith('--source=')) {
      const source = arg.slice('--source='.length);
      if (source !== 'all' && !PROBE_SOURCE_IDS.includes(source)) throw new Error(`--source must be all or one of ${PROBE_SOURCE_IDS.join(', ')}`);
      options.source = source;
    } else if (arg.startsWith('--out=')) {
      options.out = path.resolve(REPO_ROOT, arg.slice('--out='.length));
    } else if (arg.startsWith('--calls-file=')) {
      options.callsFile = path.resolve(REPO_ROOT, arg.slice('--calls-file='.length));
    } else if (arg.startsWith('--raw-output-dir=')) {
      // Q1: the saved answers stay in the gitignored output tree by default; the
      // flag exists so a test or a replay can choose its own folder.
      options.rawOutputDirectory = path.resolve(REPO_ROOT, arg.slice('--raw-output-dir='.length));
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
  const estimate = estimateProbe(selected, { protocol: protocol.text, runs: options.runs, limits: PROBE_LIMITS, outputMode: options.outputMode });
  const report = {
    version: '1.0.0',
    issue: 59,
    mode: 'dry-run',
    network: false,
    providerCall: false,
    model: ANTHROPIC_MODEL,
    outputMode: options.outputMode,
    thinking: estimate.thinking,
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
  // Q4: a rejected answer is shown with its item and citation counts, labelled
  // as diagnosis so it is never read as an extraction.
  for (const call of report.calls.filter((entry) => entry.rejected)) {
    const rejected = call.rejected;
    const items = Number.isInteger(rejected.items) ? rejected.items : 'n.v.t.';
    const invalid = Number.isInteger(rejected.itemsWithInvalidQuote) ? rejected.itemsWithInvalidQuote : 'n.v.t.';
    const classes = rejected.classes
      ? Object.entries(rejected.classes)
          .filter(([, count]) => count > 0)
          .map(([code, count]) => `${code} ${count}`)
          .join(', ')
      : '';
    process.stdout.write(
      `afgekeurd, diagnose (telt niet als extractie): call ${call.call} ${call.sourceId} - items ${items}, ongeldig citaat ${invalid}${classes ? ` (${classes})` : ''}${call.rawOutputFile ? `, antwoord ${call.rawOutputFile}` : ''}\n`,
    );
  }
  // M2: the failure identity is printed as well, so the operator sees the real
  // cause instead of only a stop code.
  const failed = report.calls.filter((call) => call.ok !== true && call.errorClass);
  if (failed.length > 0) {
    const last = failed[failed.length - 1];
    const parts = [last.errorClass, last.errorType, last.errorCause].filter(Boolean).join(' / ');
    process.stdout.write(`laatste fout: ${parts || 'onbekend'}${last.errorMessage ? ` — ${last.errorMessage}` : ''}\n`);
  }
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
  const callsFile = options.callsFile || DEFAULT_CALLS_FILE;
  assertOutputPath(callsFile, 'call log');
  const rawOutputDirectory = options.rawOutputDirectory || DEFAULT_RAW_OUTPUT_DIRECTORY;
  assertOutputPath(rawOutputDirectory, 'raw output directory');

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
  const callModule = createAnthropicStructuredCall({ env: process.env, budget: ledger, outputMode: options.outputMode });
  if (!callModule.enabled) return { code: 2, message: 'the Anthropic call stays provider_not_configured. No call was made.' };

  return runBoundedProbe({
    selected,
    protocol,
    callModule,
    ledger,
    out: options.out,
    callsFile,
    rawOutputDirectory,
    runs: options.runs,
    limits: PROBE_LIMITS,
    budget: PROBE_BUDGET,
  });
}

/**
 * The bounded live loop, with its dependencies injected so every rule can be
 * tested offline (L4 of review 6373183699): no key, no SDK, no network.
 *
 * Per call, in this order: run the extraction, append one JSONL line, rewrite
 * the report atomically, then decide whether to stop. An interruption therefore
 * leaves a report and a log that cover every completed call.
 */
async function runBoundedProbe({
  selected,
  protocol,
  callModule,
  ledger,
  out,
  callsFile,
  rawOutputDirectory = DEFAULT_RAW_OUTPUT_DIRECTORY,
  runs = PROBE_RUNS,
  limits = PROBE_LIMITS,
  budget = PROBE_BUDGET,
  runExtraction = runStructuredExtraction,
  writeReport = writeJsonAtomically,
  // Q1: injectable so every rule is testable without a provider or a temp path
  // in the repository.
  saveAnswer = writeRawAnswer,
  diagnoseAnswerText = diagnoseRawText,
  now = () => new Date().toISOString(),
} = {}) {
  const adapter = createStructuredExtractionAdapter({
    provider: callModule.provider,
    model: callModule.model,
    call: callModule.call,
    cancel: callModule.cancel,
  });
  const log = createCallLog({ file: callsFile });

  const report = {
    version: '1.2.0',
    issue: 59,
    mode: 'live',
    provider: callModule.provider,
    model: callModule.model,
    sdkVersion: callModule.sdkVersion,
    transport: callModule.transport || null,
    outputMode: callModule.outputMode || DEFAULT_OUTPUT_MODE,
    // N1 of review 6374528099: the thinking setting the calls were made with.
    thinking: callModule.thinking || null,
    thinkingSource: callModule.thinkingSource || null,
    protocol: protocolMetadata(protocol),
    runs,
    limits,
    budget,
    pricing: callModule.pricing,
    logging: {
      callsFile: path.relative(REPO_ROOT, callsFile).split(path.sep).join('/'),
      schemaVersion: 'menu-extraction-ai-probe-call/v1',
      note: 'one line per provider call, appended and flushed right after that call',
    },
    // Q1 of review 6375125413: where the literal answers of this run live. Only
    // the `text` block of an answer is stored (public menu content), never a key,
    // a header, a prompt or a reasoning block; the folder is gitignored.
    rawOutput: {
      directory: path.relative(REPO_ROOT, rawOutputDirectory).split(path.sep).join('/'),
      schemaVersion: 'menu-extraction-ai-probe-raw/v1',
      note: 'one file per provider call with an answer; referenced by rawOutputFile in the call',
    },
    sources: [],
    calls: [],
    stop: null,
    notRun: [],
  };

  let calls = 0;
  let schemaErrors = 0;
  let consecutiveFailures = 0;
  let stopped = false;

  const checkpoint = () => writeReport(out, report);

  const stopRun = (stop) => {
    stopped = true;
    report.stop = stop;
    log.append({ kind: 'stop', ...stop, call: calls, at: now() });
    checkpoint();
  };

  // The report is written once before the first call, so a run that dies early
  // still leaves the pinned protocol and limits behind instead of nothing.
  checkpoint();

  try {
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
      const runResults = [];
      for (let run = 1; run <= runs && !stopped; run += 1) {
        const menus = [];
        const chunks = chunkCaptures(source.captures, limits.maxDocuments);
        for (let chunkIndex = 0; chunkIndex < chunks.length && !stopped; chunkIndex += 1) {
          const chunk = chunks[chunkIndex];
          const inventory = chunk.map((capture) => {
            const entry = { id: capture.id, url: capture.url, kind: capture.kind, pageCount: capture.pageCount, status: 'read', text: capture.text };
            textById.set(capture.id, entry);
            return entry;
          });
          const attemptsBefore = Number.isInteger(callModule.callCount) ? callModule.callCount : 0;
          const startedAt = Date.now();
          const result = await runExtraction({ adapter, protocol, sources: inventory, limits, budget: ledger });
          const durationMs = Math.max(0, Date.now() - startedAt);
          calls += 1;

          // The provider's own record is authoritative for cost: a failure that
          // never reported `usage` leaves the price unknown, which stops the
          // run whatever the technical reason was.
          const attempt = Number.isInteger(callModule.callCount) && callModule.callCount > attemptsBefore ? callModule.lastCall : null;
          const providerAttempted = Boolean(attempt && attempt.attempt === true);
          const costUnknown = providerAttempted ? attempt.costEurCents === null : result.costUnknown === true;

          // Q1 of review 6375125413: keep the literal answer of this call before
          // judging it, so a rejected answer stays inspectable. A transport
          // failure has no answer and writes no file. A failed write is recorded
          // as a limitation, never as a different extraction outcome: the call
          // already happened and is already charged.
          const answerText = attempt && typeof attempt.answerText === 'string' ? attempt.answerText : null;
          let savedAnswer = null;
          let rawOutputError = null;
          if (answerText) {
            try {
              savedAnswer = saveAnswer({
                directory: rawOutputDirectory,
                root: REPO_ROOT,
                sourceId: source.id,
                run,
                chunkIndex,
                call: calls,
                text: answerText,
              });
            } catch (err) {
              rawOutputError = err && err.message ? err.message : 'the raw answer could not be saved';
            }
          }

          const record = {
            sourceId: source.id,
            run,
            chunkIndex,
            call: calls,
            captureIds: chunk.map((capture) => capture.id),
            ok: result.ok === true,
            reason: result.reason || null,
            errorCode: attempt ? attempt.reason || null : null,
            httpStatus: attempt && Number.isInteger(attempt.httpStatus) ? attempt.httpStatus : null,
            stopReason: attempt ? attempt.stopReason || null : null,
            usage: attempt ? attempt.usage || null : null,
            costEurCents: attempt && Number.isInteger(attempt.costEurCents) ? attempt.costEurCents : null,
            costUnknown,
            durationMs: attempt && Number.isInteger(attempt.durationMs) ? attempt.durationMs : durationMs,
            requestId: attempt ? attempt.requestId || null : null,
            messageId: attempt ? attempt.messageId || null : null,
            // M2 of review 6373786786: the error identity travels with the call,
            // so a report explains a 400 or a closed connection without a re-run.
            errorClass: attempt ? attempt.errorClass || null : null,
            errorType: attempt ? attempt.errorType || null : null,
            errorMessage: attempt ? attempt.errorMessage || null : null,
            errorCause: attempt ? attempt.errorCause || null : null,
            deadlineHit: attempt ? attempt.deadlineHit === true : false,
            // N3 of review 6374528099: the reasoning total and the block types
            // travel with the call, in the report and in the JSONL line. The
            // reasoning text itself is never read and never stored.
            thinkingTokens: attempt && Number.isInteger(attempt.thinkingTokens) ? attempt.thinkingTokens : null,
            contentBlockTypes: attempt && Array.isArray(attempt.contentBlockTypes) ? attempt.contentBlockTypes : null,
            outputMode: callModule.outputMode || DEFAULT_OUTPUT_MODE,
            provider: callModule.provider || null,
            model: callModule.model || null,
            transport: callModule.transport || null,
            protocolHash: protocol.hash,
            // Q1: the saved answer is referenced by path and hash, not inlined.
            rawOutputFile: savedAnswer ? savedAnswer.file : null,
            rawOutputSha256: savedAnswer ? savedAnswer.sha256 : null,
            rawOutputChars: savedAnswer ? savedAnswer.chars : null,
            rawOutputError,
            at: now(),
          };
          if (result.ok !== true && Array.isArray(result.problems)) record.problems = result.problems.slice(0, 5);
          // Q4 of review 6375125413: a rejected answer is measured, not counted.
          // The numbers are diagnosis only; the source row stays at 0 extraction
          // because a rejected answer never reaches `menus`.
          if (result.ok !== true && answerText) {
            try {
              record.rejected = diagnoseAnswerText({ text: answerText, sources: inventory });
            } catch (err) {
              record.rejected = { outputParsed: false, parseError: err && err.message ? err.message : 'diagnosis_failed', items: null };
            }
          }
          report.calls.push(record);
          log.append(record);

          if (result.ok === true) {
            consecutiveFailures = 0;
          } else {
            if (result.reason === 'schema_violation') schemaErrors += 1;
            consecutiveFailures = isProviderFailureReason(result.reason) ? consecutiveFailures + 1 : 0;
          }

          // Interim report: after every call, so an interruption never loses
          // the calls that already happened.
          checkpoint();

          if (result.ok !== true) {
            const decision = evaluateStop({ reason: result.reason, calls, schemaErrors, costUnknown, consecutiveFailures });
            if (decision.stop) {
              stopRun({ code: decision.code, sourceId: source.id, run, chunkIndex, reason: result.reason, costUnknown, at: now() });
            }
            break;
          }
          if (Array.isArray(result.output.menus)) menus.push(...result.output.menus);
        }
        runResults.push(menus);
      }
      if (runResults.length === 0) {
        report.sources.push(blockedSourceRow({ ...source, blockedReason: `stopped before the first call: ${report.stop ? report.stop.code : 'unknown'}` }));
        continue;
      }
      const primary = runResults[0];
      const comparison = compareControlledReference(source.reference, primary, { label: source.label, sourceId: source.id, captureStatus: 'captured' });
      report.sources.push(
        summarizeSource({
          source,
          reference: source.reference,
          menus: primary,
          comparison,
          sourceById: textById,
          titles: primary.map((menu) => menu.title),
          runs: runResults,
        }),
      );
      checkpoint();
    }
  } catch (err) {
    // An internal failure is not a provider result. Record it, keep every call
    // that was already measured, and fail loudly instead of pretending success.
    stopRun({ code: 'probe_interrupted', detail: err && err.message ? err.message : String(err), at: now() });
    throw err;
  }

  const actualCostEurCents = report.calls.reduce((total, call) => total + (Number.isInteger(call.costEurCents) ? call.costEurCents : 0), 0);
  report.totals = {
    ...aggregateControlledReferences(report.sources),
    calls,
    actualCostEurCents,
    unknownCostCalls: report.calls.filter((call) => call.costUnknown === true).length,
    // N3: what the provider reported as reasoning across the run. A call that
    // did not report it contributes nothing and stays visible as `null` above.
    thinkingTokens: report.calls.reduce((total, call) => total + (Number.isInteger(call.thinkingTokens) ? call.thinkingTokens : 0), 0),
    callsWithThinking: report.calls.filter((call) => Number.isInteger(call.thinkingTokens) && call.thinkingTokens > 0).length,
    schemaErrors,
    // Q4 of review 6375125413: what the rejected answers contained, so a
    // rejection rate can be read together with the item and citation numbers.
    // These counts are diagnosis; they never count as extracted or matched items.
    rejectedOutputs: report.calls.filter((call) => call.rejected).length,
    itemsInRejectedOutputs: report.calls.reduce((total, call) => total + (call.rejected && Number.isInteger(call.rejected.items) ? call.rejected.items : 0), 0),
    itemsWithInvalidQuote: report.calls.reduce(
      (total, call) => total + (call.rejected && Number.isInteger(call.rejected.itemsWithInvalidQuote) ? call.rejected.itemsWithInvalidQuote : 0),
      0,
    ),
    answersSaved: report.calls.filter((call) => typeof call.rawOutputFile === 'string' && call.rawOutputFile.length > 0).length,
    answersNotSaved: report.calls.filter((call) => call.rawOutputError).length,
    ledger: safeLedgerSnapshot(ledger),
  };
  checkpoint();
  printLive(report);
  process.stdout.write(`${path.relative(REPO_ROOT, out).split(path.sep).join('/')}\n`);
  if (report.stop) process.stderr.write(`gestopt na call ${calls}: ${report.stop.code}\n`);
  return { code: 0, report };
}

const USAGE = `Gebruik:
  node ops/scripts/run-menu-extraction-ai-probe.js [--source=all|<id>] [--runs=1|2] [--output-mode=schema|prompt]
  node ops/scripts/run-menu-extraction-ai-probe.js --live --budget-file=ops/benchmark/output/ai-probe-budget-ledger.json [--source=...] [--runs=1|2] [--output-mode=...]

Zonder --live is dit een dry-run: alleen een raming uit de gepinde captures,
geen sleutel en geen netwerk. --live vereist ANTHROPIC_API_KEY in de omgeving en
een expliciet --budget-file in de gitignored ops/benchmark/output-map. Elke
aanroep krijgt direct een regel in ops/benchmark/output/ai-probe-live-calls.jsonl
(override met --calls-file=<pad>); het rapport wordt na elke aanroep bijgewerkt.
Het letterlijke antwoord van elke aanroep wordt bewaard in
ops/benchmark/output/ai-probe-raw/ (override met --raw-output-dir=<pad>); het
rapport en de JSONL-regel verwijzen ernaar met pad en SHA-256.
--output-mode=schema (standaard) vraagt de uitvoer via output_config; prompt
stuurt geen output_config mee en zet hetzelfde schema in de instructie.
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
  DEFAULT_CALLS_FILE,
  DEFAULT_OUT,
  DEFAULT_RAW_OUTPUT_DIRECTORY,
  OUTPUT_DIRECTORY,
  assertOutputPath,
  dryRun,
  main,
  parseArgs,
  printLive,
  runBoundedProbe,
  runLive,
  selectSources,
  writeJsonAtomically,
};
