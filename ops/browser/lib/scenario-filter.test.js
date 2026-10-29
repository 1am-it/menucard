'use strict';

// BE-43 (#101) — the flag layer of the scenario filter.
//
// These tests cover reading `--alleen` and `--lijst`, the unknown-name error,
// the "no flag means everything" default, the separate evidence file of a
// filtered run and the one-line-per-scenario output. No browser, server or
// network is involved.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseScenarioArgs,
  scenarioListing,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./scenario-filter');

const NAMES = ['review', 'empty', 'concept-list', 'netwerk'];
const SCRIPT = 'run-voorbeeld-browser-check.js';

function quiet() {
  const lines = [];
  const errors = [];
  const log = (line) => lines.push(String(line));
  const logError = (line) => errors.push(String(line));
  return { lines, errors, log, logError };
}

test('BE-43: zonder vlag draait alles (filter null)', () => {
  const selection = parseScenarioArgs([], NAMES);
  assert.deepEqual(selection, { list: false, filter: null, error: null });
});

test('BE-43: --alleen=<naam> leest één scenarionaam', () => {
  const selection = parseScenarioArgs(['--alleen=review'], NAMES);
  assert.deepEqual(selection.filter, ['review']);
  assert.equal(selection.error, null);
  assert.equal(selection.list, false);
});

test('BE-43: --alleen=<naam>,<naam> leest een lijst en houdt de volgorde', () => {
  assert.deepEqual(parseScenarioArgs(['--alleen=concept-list,empty'], NAMES).filter, ['concept-list', 'empty']);
  assert.deepEqual(parseScenarioArgs(['--alleen', 'empty,review'], NAMES).filter, ['empty', 'review']);
  assert.deepEqual(parseScenarioArgs(['--alleen=empty,empty'], NAMES).filter, ['empty']);
  assert.deepEqual(parseScenarioArgs(['--alleen=empty', '--alleen=review'], NAMES).filter, ['empty', 'review']);
});

test('BE-43: een onbekende naam geeft een duidelijke fout met alle geldige namen', () => {
  const selection = parseScenarioArgs(['--alleen=review,bestaatniet'], NAMES);
  assert.equal(selection.filter, null);
  assert.match(selection.error, /onbekend scenario: bestaatniet/);
  for (const name of NAMES) assert.match(selection.error, new RegExp(name));
  assert.match(selection.error, /Geldige scenario's \(4\)/);
});

test("BE-43: --alleen zonder naam is een fout, niet 'alles'", () => {
  for (const argv of [['--alleen='], ['--alleen'], ['--alleen= , ']]) {
    const selection = parseScenarioArgs(argv, NAMES);
    assert.equal(selection.filter, null, JSON.stringify(argv));
    assert.match(selection.error, /minstens één scenarionaam/);
  }
});

test('BE-43: --lijst toont de namen en stopt met code 0', () => {
  const selection = parseScenarioArgs(['--lijst'], NAMES);
  assert.equal(selection.list, true);
  const { lines, errors, log, logError } = quiet();
  const outcome = scenarioSelectionOutcome({ selection, entries: NAMES, scriptName: SCRIPT, log, logError });
  assert.deepEqual(outcome, { stop: true, exitCode: 0 });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /run-voorbeeld-browser-check\.js: 4 scenario's/);
  for (const name of NAMES) assert.match(lines[0], new RegExp(`\\n  ${name}`));
  assert.equal(errors.length, 0);
});

test('BE-43: een onbekende naam start niets en eindigt met code 2', () => {
  const selection = parseScenarioArgs(['--alleen=bestaatniet'], NAMES);
  const { lines, errors, log, logError } = quiet();
  const outcome = scenarioSelectionOutcome({ selection, entries: NAMES, scriptName: SCRIPT, log, logError });
  assert.deepEqual(outcome, { stop: true, exitCode: 2 });
  assert.equal(lines.length, 0);
  assert.match(errors.join('\n'), /onbekend scenario: bestaatniet/);
  assert.match(errors.join('\n'), /Er is niets gestart/);
});

test('BE-43: zonder vlag of fout gaat de check gewoon door', () => {
  const selection = parseScenarioArgs([], NAMES);
  const outcome = scenarioSelectionOutcome({ selection, entries: NAMES, scriptName: SCRIPT, ...quiet() });
  assert.deepEqual(outcome, { stop: false, exitCode: 0 });
});

test('BE-43: de namenlijst is ook los te lezen', () => {
  const text = scenarioListing(SCRIPT, NAMES);
  assert.match(text, /run-voorbeeld-browser-check\.js: 4 scenario's/);
  assert.equal(text.split('\n').length, 5);
});

test('BE-43: een gefilterde run schrijft naar een eigen bewijsbestand', () => {
  const base = 'ops/browser/evidence/menu-review-browser-evidence.json';
  assert.equal(filteredEvidencePath(base, null), base);
  assert.equal(filteredEvidencePath(base, []), base);
  assert.equal(filteredEvidencePath(base, ['review']), 'ops/browser/evidence/menu-review-browser-evidence.filtered.json');
  assert.ok(!filteredEvidencePath(base, ['review']).endsWith('menu-review-browser-evidence.json'));
});

function checksFixture() {
  const checks = [];
  const add = (name, passed) => checks.push({ name, passed: Boolean(passed), detail: null });
  return { checks, add };
}

test('BE-43: een gefilterde run draait alleen het gekozen scenario', async () => {
  const { checks, add } = checksFixture();
  const ran = [];
  const entries = [
    { name: 'review', run: async () => { ran.push('review'); add('review 1', true); add('review 2', false); } },
    { name: 'empty', run: async () => { ran.push('empty'); add('empty 1', true); } },
  ];
  const out = [];
  const runs = await runScenarioSelection({ entries, checks, cdp: null, filter: ['empty'], out: (line) => out.push(line) });
  assert.deepEqual(ran, ['empty']);
  assert.equal(checks.length, 1);
  assert.equal(runs.length, 1);
  assert.deepEqual(
    { name: runs[0].name, checks: runs[0].checks, passed: runs[0].passed, failed: runs[0].failed },
    { name: 'empty', checks: 1, passed: 1, failed: 0 },
  );
  assert.match(out[0], /^ok {3}empty: 1\/1 controles geslaagd/);
});

test('BE-43: zonder filter draait elk scenario, met één regel per scenario', async () => {
  const { checks, add } = checksFixture();
  const ran = [];
  const entries = [
    { name: 'review', run: async () => { ran.push('review'); add('review 1', true); add('review 2', false); } },
    { name: 'empty', run: async () => { ran.push('empty'); add('empty 1', true); } },
  ];
  const out = [];
  const runs = await runScenarioSelection({ entries, checks, cdp: null, out: (line) => out.push(line) });
  assert.deepEqual(ran, ['review', 'empty']);
  assert.equal(out.length, 2);
  assert.match(out[0], /^FAIL review: 1\/2 controles geslaagd, 1 gezakt/);
  assert.match(out[1], /^ok {3}empty: 1\/1 controles geslaagd/);
  assert.equal(runs.reduce((total, run) => total + run.checks, 0), checks.length);
});

test('BE-43: een scenario dat werpt drukt zijn regel en stopt de run', async () => {
  const { checks } = checksFixture();
  const out = [];
  const entries = [
    { name: 'stuk', run: async () => { throw new Error('kapot'); } },
    { name: 'nooit', run: async () => { throw new Error('mag niet draaien'); } },
  ];
  await assert.rejects(runScenarioSelection({ entries, checks, cdp: null, out: (line) => out.push(line) }), /kapot/);
  assert.equal(out.length, 1);
  assert.match(out[0], /^FAIL stuk: 0\/0 controles geslaagd/);
});

