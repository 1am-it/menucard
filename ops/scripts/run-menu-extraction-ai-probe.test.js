'use strict';

// K4/K6 regressions for the probe command line (#59 / BE-21 review 6370840673):
// dry-run is the default, live refuses without a key and an explicit budget
// file, and no other provider or fallback exists in the script.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { DEFAULT_CALLS_FILE, DEFAULT_OUT, OUTPUT_DIRECTORY, assertOutputPath, parseArgs, runBoundedProbe, runLive } = require('./run-menu-extraction-ai-probe');
const { ANTHROPIC_API_KEY_ENV, costFromUsage } = require('../../src/lib/menuExtractionAnthropicCall');
const { PROBE_BUDGET, PROBE_LIMITS } = require('../benchmark/menuExtractionProbe');
const { readCallLog } = require('../benchmark/aiProbeCallLog');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, 'run-menu-extraction-ai-probe.js');
const protocol = { text: 'pinned instruction: extract the menu only as data', hash: 'b'.repeat(64) };

function sourceOf(id) {
  return {
    id,
    label: id,
    captureStatus: 'captured',
    blockedReason: null,
    captures: [{ id: `${id}-01`, url: `https://fictief.example/${id}`, kind: 'html', pageCount: null, text: 'Fictieve soep 6.50' }],
    reference: { menus: [] },
    referenceItems: 0,
  };
}

function outputFor(sourceId) {
  return {
    menus: [
      {
        title: 'Lunch',
        sourceId,
        categories: [
          {
            name: 'Voor',
            items: [
              {
                name: 'Fictieve soep',
                priceStatus: 'known',
                amountMinorUnits: 650,
                currency: 'EUR',
                evidence: { sourceId, locator: 'regel 1', quote: 'Fictieve soep 6.50' },
              },
            ],
          },
        ],
      },
    ],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  };
}

/**
 * The provider stand-in: it reports cost exactly like the real module (through
 * the ledger, from `usage` with the fixed price table) and leaves the same
 * `lastCall` record behind. Nothing here touches a key, an SDK or the network.
 */
function fakeCallModule({ ledger, behaviours, outputMode = undefined }) {
  const state = { callCount: 0, lastCall: null };
  return {
    provider: 'fixture',
    model: 'fixture-model',
    transport: 'messages.stream',
    ...(outputMode ? { outputMode } : {}),
    pricing: { note: 'fixture price table' },
    get callCount() {
      return state.callCount;
    },
    get lastCall() {
      return state.lastCall;
    },
    cancel: () => {},
    async call(input = {}) {
      const behaviour = behaviours[Math.min(state.callCount, behaviours.length - 1)];
      state.callCount += 1;
      const startedAt = Date.now();
      const durationMs = Math.max(0, Date.now() - startedAt);
      if (behaviour.kind === 'output') {
        const cost = costFromUsage(behaviour.usage);
        ledger.costEurCents = cost.costEurCents;
        state.lastCall = {
          attempt: true,
          streamed: true,
          ok: true,
          reason: null,
          httpStatus: null,
          stopReason: 'end_turn',
          usage: cost.tokens,
          costEurCents: cost.costEurCents,
          costUnknownReason: cost.reason,
          durationMs,
          requestId: behaviour.requestId || 'req_fixture',
          messageId: 'msg_fixture',
        };
        // The default answer cites the source of this very call, so a later
        // source cannot silently be answered with the first source's evidence.
        return behaviour.output || outputFor(input.sources[0].id);
      }
      // A failed attempt: `usage` is only known when the provider reported it.
      const cost = behaviour.usage ? costFromUsage(behaviour.usage) : { costEurCents: null, tokens: null };
      ledger.costEurCents = cost.costEurCents;
      state.lastCall = {
        attempt: true,
        streamed: true,
        ok: false,
        reason: behaviour.reason,
        httpStatus: behaviour.httpStatus || null,
        stopReason: behaviour.stopReason || null,
        usage: cost.tokens,
        costEurCents: cost.costEurCents,
        costUnknownReason: cost.costEurCents === null ? 'usage_missing' : null,
        durationMs,
        requestId: behaviour.requestId || `req_fail_${state.callCount}`,
        messageId: null,
        // M2 of review 6373786786: the fake reports the same identity fields the
        // provider call records, so the probe plumbing is tested offline.
        errorClass: behaviour.errorClass || null,
        errorType: behaviour.errorType || null,
        errorMessage: behaviour.errorMessage || null,
        errorCause: behaviour.errorCause || null,
        deadlineHit: behaviour.deadlineHit === true,
      };
      throw Object.assign(new Error(behaviour.reason), { code: behaviour.reason });
    },
  };
}

function fakeLedger() {
  const settlements = [];
  return {
    // The real ledger starts without a reported price for the next call.
    costEurCents: undefined,
    reserve: () => true,
    settle: (value) => {
      settlements.push(value);
      return true;
    },
    snapshot: () => ({ fixture: true, note: 'the test never writes a real ledger' }),
    settlements,
  };
}

async function probeWith({ sources, behaviours, runs = 1, runExtraction = undefined, outputMode = undefined } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-probe-live-'));
  const out = path.join(directory, 'report.json');
  const callsFile = path.join(directory, 'calls.jsonl');
  const ledger = fakeLedger();
  const callModule = fakeCallModule({ ledger, behaviours, outputMode });
  const options = {
    selected: sources,
    protocol,
    callModule,
    ledger,
    out,
    callsFile,
    runs,
    limits: PROBE_LIMITS,
    budget: PROBE_BUDGET,
    now: () => '2026-10-23T20:00:00.000Z',
  };
  if (runExtraction) options.runExtraction = runExtraction;
  const result = await runBoundedProbe(options);
  return { directory, out, callsFile, ledger, callModule, result, report: JSON.parse(fs.readFileSync(out, 'utf8')) };
}

test('K4: the default invocation is a dry run with two runs per source', () => {
  const options = parseArgs([]);
  assert.equal(options.live, false);
  assert.equal(options.runs, 2);
  assert.equal(options.source, 'all');
  assert.equal(options.out, DEFAULT_OUT);
  assert.equal(options.callsFile, DEFAULT_CALLS_FILE);
  assert.equal(options.budgetFileProvided, false);
  assert.equal(parseArgs(['--runs=1']).runs, 1);
  assert.equal(parseArgs(['--source=smelt']).source, 'smelt');
  assert.equal(parseArgs(['--calls-file=ops/benchmark/output/anders.jsonl']).callsFile, path.join(OUTPUT_DIRECTORY, 'anders.jsonl'));
  assert.throws(() => parseArgs(['--runs=3']), /--runs must be 1 or 2/);
  assert.throws(() => parseArgs(['--source=senang-makan']), /--source must be all or one of/);
  assert.throws(() => parseArgs(['--live=yes']), /unknown argument/);
  // M1 of review 6373786786: one explicit switch, schema by default.
  assert.equal(options.outputMode, 'schema');
  assert.equal(parseArgs(['--output-mode=prompt']).outputMode, 'prompt');
  assert.equal(parseArgs(['--output-mode=schema']).outputMode, 'schema');
  assert.throws(() => parseArgs(['--output-mode=auto']), /--output-mode must be schema or prompt/);
});

test('K4: a report or ledger may only be written inside the gitignored output folder', () => {
  assert.doesNotThrow(() => assertOutputPath(path.join(OUTPUT_DIRECTORY, 'report.json')));
  assert.throws(() => assertOutputPath(path.join(REPO_ROOT, 'src', 'lib', 'probe-report.json')), /gitignored ops\/benchmark\/output/);
  assert.throws(() => assertOutputPath(path.join(REPO_ROOT, 'report.json')), /gitignored ops\/benchmark\/output/);
  assert.doesNotThrow(() => assertOutputPath(path.join(os.tmpdir(), 'menucard-probe-report.json')));
});

test('K6: live mode without a key or without an explicit budget file refuses before any call', async () => {
  const previous = process.env[ANTHROPIC_API_KEY_ENV];
  delete process.env[ANTHROPIC_API_KEY_ENV];
  const noKey = await runLive({ live: true, budgetFileProvided: true, budgetFile: path.join(OUTPUT_DIRECTORY, 'x.json'), out: path.join(OUTPUT_DIRECTORY, 'y.json'), runs: 2, source: 'all' });
  assert.equal(noKey.code, 2);
  assert.match(noKey.message, /ANTHROPIC_API_KEY/);
  assert.match(noKey.message, /No call was made/);

  process.env[ANTHROPIC_API_KEY_ENV] = 'fixture-key-never-used';
  try {
    const noBudget = await runLive({ live: true, budgetFileProvided: false, budgetFile: path.join(OUTPUT_DIRECTORY, 'x.json'), out: path.join(OUTPUT_DIRECTORY, 'y.json'), runs: 2, source: 'all' });
    assert.equal(noBudget.code, 2);
    assert.match(noBudget.message, /--budget-file/);
    assert.match(noBudget.message, /No call was made/);
  } finally {
    if (previous === undefined) delete process.env[ANTHROPIC_API_KEY_ENV];
    else process.env[ANTHROPIC_API_KEY_ENV] = previous;
  }
});

test('L4/L3: a timeout stops the run and is written to the log and the report', async () => {
  const sources = [sourceOf('bron-een'), sourceOf('bron-twee')];
  const { report, callsFile, ledger } = await probeWith({
    sources,
    behaviours: [{ kind: 'error', reason: 'timeout' }],
  });
  assert.equal(report.calls.length, 1);
  assert.equal(report.stop.code, 'cost_unknown');
  assert.equal(report.stop.reason, 'timeout');
  assert.equal(report.stop.sourceId, 'bron-een');
  assert.equal(report.notRun.includes('bron-twee'), true);
  assert.equal(report.totals.unknownCostCalls, 1);
  // A timeout with no reported usage keeps the whole reservation charged.
  assert.deepEqual(ledger.settlements, [null]);

  const log = readCallLog(callsFile);
  assert.equal(log.records.length, 2);
  assert.equal(log.records[0].kind, undefined, 'a call line carries no stop kind');
  assert.equal(log.records[0].reason, 'timeout');
  assert.equal(log.records[0].costUnknown, true);
  assert.equal(log.records[0].costEurCents, null);
  assert.equal(log.records[1].kind, 'stop');
  assert.equal(log.records[1].code, 'cost_unknown');
});

test('L4/L3: a provider error without usage stops the run at once', async () => {
  const { report, callsFile, callModule } = await probeWith({
    sources: [sourceOf('bron-een'), sourceOf('bron-twee')],
    behaviours: [{ kind: 'error', reason: 'provider_unavailable', httpStatus: 503 }],
  });
  assert.equal(callModule.callCount, 1);
  assert.equal(report.stop.code, 'cost_unknown');
  assert.equal(report.stop.reason, 'provider_unavailable');
  const log = readCallLog(callsFile);
  assert.equal(log.records[0].httpStatus, 503);
  assert.equal(log.records[0].errorCode, 'provider_unavailable');
  assert.equal(log.records[0].requestId, 'req_fail_1');
});

test('L4/L3: two consecutive provider failures with a known cost stop the run', async () => {
  const truncated = { kind: 'error', reason: 'output_truncated', stopReason: 'max_tokens', usage: { input_tokens: 20_000, output_tokens: 16_000 } };
  const { report, callsFile } = await probeWith({
    sources: [sourceOf('bron-een'), sourceOf('bron-twee')],
    behaviours: [truncated],
  });
  // The first truncation costs 1 cent and does not stop on its own; the second
  // one hits the consecutive rule.
  assert.equal(report.calls.length, 2);
  assert.equal(report.totals.actualCostEurCents, 2);
  assert.equal(report.stop.code, 'consecutive_provider_failures');
  const log = readCallLog(callsFile);
  assert.equal(log.records.filter((record) => record.kind === undefined).length, 2);
  assert.equal(log.records.filter((record) => record.kind === 'stop').length, 1);
});

test('L4/L1: every call gets exactly one JSONL line with its own numbers', async () => {
  const sources = [sourceOf('bron-een'), sourceOf('bron-twee')];
  const { report, callsFile } = await probeWith({
    sources,
    behaviours: [{ kind: 'output', usage: { input_tokens: 20_000, output_tokens: 8_000 } }],
  });
  assert.equal(report.totals.calls, 2);
  assert.equal(report.stop, null);
  assert.equal(report.totals.actualCostEurCents, 2);
  assert.equal(report.transport, 'messages.stream');
  assert.match(report.logging.callsFile, /calls\.jsonl$/);

  const log = readCallLog(callsFile);
  assert.equal(log.records.length, 2);
  assert.equal(log.lines, 2);
  for (const [index, record] of log.records.entries()) {
    assert.equal(record.schemaVersion, 'menu-extraction-ai-probe-call/v1');
    assert.equal(record.call, index + 1);
    assert.equal(record.sourceId, sources[index].id);
    assert.equal(record.ok, true);
    assert.equal(record.costEurCents, 1);
    assert.equal(record.usage.inputTokens, 20_000);
    assert.equal(record.requestId, 'req_fixture');
    assert.equal(record.stopReason, 'end_turn');
    assert.equal(typeof record.durationMs, 'number');
    assert.equal(record.protocolHash, protocol.hash);
    assert.equal(record.at, '2026-10-23T20:00:00.000Z');
    assert.equal(Object.prototype.hasOwnProperty.call(record, 'key'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(record, 'headers'), false);
  }
});

test('L4/L2: a streamed answer with usage is priced by the fixed table', async () => {
  const { report, callsFile } = await probeWith({
    sources: [sourceOf('bron-een')],
    behaviours: [{ kind: 'output', usage: { input_tokens: 40_000, output_tokens: 16_000 } }],
  });
  // 40k prompt + 16k output = $0.012 -> 2 euro cent, never rounded down.
  assert.equal(report.calls[0].costEurCents, 2);
  assert.equal(report.totals.actualCostEurCents, 2);
  assert.equal(report.calls[0].costUnknown, false);
  const log = readCallLog(callsFile);
  assert.equal(log.records[0].costEurCents, 2);
  assert.equal(log.records[0].usage.outputTokens, 16_000);
});

test('L4: an interruption keeps the per-call report and log of the calls already made', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-probe-interrupt-'));
  const out = path.join(directory, 'report.json');
  const callsFile = path.join(directory, 'calls.jsonl');
  const ledger = fakeLedger();
  const callModule = fakeCallModule({
    ledger,
    behaviours: [{ kind: 'output', usage: { input_tokens: 20_000, output_tokens: 8_000 } }],
  });
  const { runStructuredExtraction } = require('../../src/lib/menuExtractionAdapter');
  let call = 0;
  const runExtraction = async (args) => {
    call += 1;
    if (call === 2) throw new Error('simulated interruption');
    return runStructuredExtraction(args);
  };
  await assert.rejects(
    runBoundedProbe({
      selected: [sourceOf('bron-een'), sourceOf('bron-twee')],
      protocol,
      callModule,
      ledger,
      out,
      callsFile,
      runs: 1,
      limits: PROBE_LIMITS,
      budget: PROBE_BUDGET,
      runExtraction,
      now: () => '2026-10-23T20:00:00.000Z',
    }),
    /simulated interruption/,
  );
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(report.calls.length, 1, 'the completed call is already on disk');
  assert.equal(report.stop.code, 'probe_interrupted');
  assert.equal(report.calls[0].ok, true);
  const log = readCallLog(callsFile);
  assert.equal(log.records.length, 2);
  assert.equal(log.records[1].kind, 'stop');
  assert.equal(log.records[1].code, 'probe_interrupted');
});

test('K4: the script has one provider, no fallback and no hidden paid credential', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  for (const other of ['openai', 'googleapis', 'mistral', 'gemini', 'cohere']) {
    assert.equal(source.toLowerCase().includes(other), false, `${other} is not a fallback of this probe`);
  }
  assert.equal(source.includes('api.anthropic.com'), false, 'the SDK owns the endpoint');
  assert.equal(source.includes('process.env.ANTHROPIC_API_KEY ='), false, 'the probe never sets a key');
  assert.match(source, /ANTHROPIC_API_KEY_ENV/);
  assert.match(source, /createFileBudgetLedger/);
  assert.match(source, /compareControlledReference/);
});

test('K4: the dry run writes a report from the pinned captures without a key or network', (t) => {
  const captures = path.join(REPO_ROOT, 'ops', 'benchmark', 'output', 'reference-captures', 'zuyd');
  if (!fs.existsSync(captures)) {
    t.skip('the pinned captures are not present in this checkout');
    return;
  }
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-probe-')), 'report.json');
  const result = spawnSync(process.execPath, [SCRIPT, `--out=${out}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, [ANTHROPIC_API_KEY_ENV]: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.network, false);
  assert.equal(report.providerCall, false);
  assert.equal(report.sources.length, 8);
  assert.equal(report.totals.plannedCalls, report.rows.reduce((total, row) => total + row.calls, 0));
  assert.ok(report.totals.plannedCalls <= 40);
  assert.ok(report.totals.estimatedCostEurCents <= 900);
  assert.equal(report.protocol.instructionHash.length, 64);
  assert.match(result.stdout, /TOTAAL/);
});

test('M1/M2: the output mode and the error identity reach the report and every JSONL line', async () => {
  const { report, callsFile } = await probeWith({
    sources: [sourceOf('bron-een')],
    outputMode: 'prompt',
    behaviours: [
      {
        kind: 'error',
        reason: 'schema_violation',
        httpStatus: 400,
        errorClass: 'APIError',
        errorType: 'invalid_request_error',
        errorMessage: 'Schema is too complex.',
        deadlineHit: false,
      },
    ],
  });
  // M1: the mode is part of the run and of every call, so a report always says
  // which of the two requests was sent.
  assert.equal(report.outputMode, 'prompt');
  assert.equal(report.calls[0].outputMode, 'prompt');
  // M2: a 400 is explainable from the report alone.
  assert.equal(report.calls[0].errorClass, 'APIError');
  assert.equal(report.calls[0].errorType, 'invalid_request_error');
  assert.equal(report.calls[0].errorMessage, 'Schema is too complex.');
  assert.equal(report.calls[0].deadlineHit, false);
  const log = readCallLog(callsFile);
  const call = log.records.find((record) => record.kind === undefined);
  assert.equal(call.outputMode, 'prompt');
  assert.equal(call.errorClass, 'APIError');
  assert.equal(call.errorType, 'invalid_request_error');
  assert.equal(call.errorMessage, 'Schema is too complex.');
  assert.equal(call.deadlineHit, false);
});

test('M1: prompt mode estimates the schema tokens and reports the mode (dry run, no key)', () => {
  const calls = path.join(REPO_ROOT, 'ops', 'benchmark', 'output', 'reference-captures', 'zuyd');
  if (!fs.existsSync(calls)) return; // the pinned captures are not in this checkout
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-probe-dry-')), 'report.json');
  const run = (mode) => {
    const result = spawnSync(process.execPath, [SCRIPT, `--source=zuyd`, `--out=${out}`, `--output-mode=${mode}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, [ANTHROPIC_API_KEY_ENV]: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  };
  const schemaRun = run('schema');
  const promptRun = run('prompt');
  assert.equal(schemaRun.outputMode, 'schema');
  assert.equal(promptRun.outputMode, 'prompt');
  // The prompt carries the schema as text, so its prompt estimate must be
  // larger; the output ceiling and the call plan stay identical.
  assert.ok(
    promptRun.rows[0].promptTokensPerCall[0] > schemaRun.rows[0].promptTokensPerCall[0],
    'prompt mode must estimate the schema tokens it actually sends',
  );
  assert.deepEqual(promptRun.rows[0].promptTokensPerCall.length, schemaRun.rows[0].promptTokensPerCall.length);
  assert.equal(promptRun.network, false);
});

test('M1: the default run reports the schema mode, so an unset flag is never ambiguous', async () => {
  const { report } = await probeWith({
    sources: [sourceOf('bron-een')],
    behaviours: [{ kind: 'output', usage: { input_tokens: 1000, output_tokens: 500 } }],
  });
  assert.equal(report.outputMode, 'schema');
  assert.equal(report.calls[0].outputMode, 'schema');
  // M2: a successful call carries no error identity.
  assert.equal(report.calls[0].errorClass, null);
  assert.equal(report.calls[0].deadlineHit, false);
});
