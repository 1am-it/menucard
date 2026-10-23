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

const { DEFAULT_OUT, OUTPUT_DIRECTORY, assertOutputPath, parseArgs, runLive } = require('./run-menu-extraction-ai-probe');
const { ANTHROPIC_API_KEY_ENV } = require('../../src/lib/menuExtractionAnthropicCall');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, 'run-menu-extraction-ai-probe.js');

test('K4: the default invocation is a dry run with two runs per source', () => {
  const options = parseArgs([]);
  assert.equal(options.live, false);
  assert.equal(options.runs, 2);
  assert.equal(options.source, 'all');
  assert.equal(options.out, DEFAULT_OUT);
  assert.equal(options.budgetFileProvided, false);
  assert.equal(parseArgs(['--runs=1']).runs, 1);
  assert.equal(parseArgs(['--source=smelt']).source, 'smelt');
  assert.throws(() => parseArgs(['--runs=3']), /--runs must be 1 or 2/);
  assert.throws(() => parseArgs(['--source=senang-makan']), /--source must be all or one of/);
  assert.throws(() => parseArgs(['--live=yes']), /unknown argument/);
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
