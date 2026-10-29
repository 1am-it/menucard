'use strict';

// BE-43 (#101) — one scenario of a browser check instead of all of them.
//
// Every `ops/browser/run-*-browser-check.js` that drives several scenarios used
// to run all of them on every invocation: `run-menu-review-browser-check.js`
// alone is 28 scenarios and 729 checks. A developer working on one screen then
// waits for everything, and the round cost of BE-41 (61,7M tokens, `aborted`)
// was largely this output. This helper gives the checks one shared flag layer:
//
//   --lijst             show the scenario names and start nothing
//   --alleen=<naam>,... run only the named scenarios
//
// Without a flag every scenario runs exactly as before. A filtered run keeps
// its own evidence file (`<naam>.filtered.json`), so the full evidence record
// can never be overwritten by a partial run.
//
// This module is test/tooling code only: it starts no browser, no server and no
// network request, and it never touches app code or production data.

const path = require('node:path');

const ALLEEN = '--alleen';
const LIJST = '--lijst';

function namesOf(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => (typeof entry === 'string' ? entry : entry.name));
}

/**
 * Reads `--alleen=<naam>[,<naam>]` and `--lijst` from an argv list.
 *
 * Returns `{ list, filter, error }`:
 * - `list` is true when `--lijst` was given (show the names, start nothing);
 * - `filter` is null without `--alleen` (run everything) or the ordered,
 *   de-duplicated selection of known names;
 * - `error` is a readable message naming the valid scenarios when the flag is
 *   malformed or names an unknown scenario. Nothing may run in that case.
 *
 * Parsing this does not start anything; the caller decides what to do.
 */
function parseScenarioArgs(argv, names) {
  const args = Array.isArray(argv) ? argv.map((value) => String(value)) : [];
  const valid = namesOf(names);
  let list = false;
  let filter = null;

  const invalid = (message) => ({
    list,
    filter: null,
    error: `${message}\nGeldige scenario's (${valid.length}):\n${valid.map((name) => `  ${name}`).join('\n')}`,
  });

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === LIJST) {
      list = true;
      continue;
    }
    let value = null;
    if (arg.startsWith(`${ALLEEN}=`)) {
      value = arg.slice(ALLEEN.length + 1);
    } else if (arg === ALLEEN) {
      value = args[index + 1] === undefined ? '' : args[index + 1];
      index += 1;
    } else {
      continue;
    }
    const requested = String(value)
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    if (requested.length === 0) {
      return invalid('--alleen verwacht minstens één scenarionaam (--alleen=<naam>[,<naam>]).');
    }
    const unknown = requested.filter((name) => !valid.includes(name));
    if (unknown.length > 0) {
      return invalid(`onbekend scenario: ${unknown.join(', ')}.`);
    }
    filter = [...new Set([...(filter || []), ...requested])];
  }

  return { list, filter, error: null };
}

/** The scenario names as one readable block, without starting anything. */
function scenarioListing(scriptName, entries) {
  const names = namesOf(entries);
  return [`${scriptName}: ${names.length} scenario's`, ...names.map((name) => `  ${name}`)].join('\n');
}

/**
 * Prints the list or the error, and tells `main()` to stop before any server,
 * browser or evidence write. Exit code 2 marks a usage error; a listing is 0.
 */
function scenarioSelectionOutcome({ selection, entries, scriptName, log = console.log, logError = console.error }) {
  const result = selection || { list: false, filter: null, error: null };
  if (result.list) {
    log(scenarioListing(scriptName, entries));
    return { stop: true, exitCode: 0 };
  }
  if (result.error) {
    logError(`${scriptName}: ${result.error}`);
    logError('Er is niets gestart.');
    return { stop: true, exitCode: 2 };
  }
  return { stop: false, exitCode: 0 };
}

/**
 * Where a filtered run writes its evidence: `<stem>.filtered<ext>` next to the
 * full record. Without a filter the full path is returned unchanged, so a
 * normal run keeps writing the same file it always wrote.
 */
function filteredEvidencePath(basePath, filter) {
  if (!Array.isArray(filter) || filter.length === 0) return basePath;
  const ext = path.extname(basePath) || '.json';
  const stem = basePath.slice(0, basePath.length - ext.length);
  return `${stem}.filtered${ext}`;
}

/**
 * Runs the selected scenario entries in declaration order and prints exactly
 * one line per scenario with its passed/failed counts and duration. Details of
 * a failing check stay with the check itself (the scripts print only failures).
 *
 * A scenario that throws keeps the old fail-fast behaviour: the line is printed
 * and the error is re-thrown, so `main()` still writes an evidence record with
 * the error.
 */
async function runScenarioSelection({ entries, checks, cdp, filter = null, out = console.log }) {
  const all = Array.isArray(entries) ? entries : [];
  const selected = Array.isArray(filter) && filter.length > 0
    ? all.filter((entry) => filter.includes(entry.name))
    : all;
  const runs = [];
  for (const entry of selected) {
    const before = checks.length;
    const startedAt = Date.now();
    let error = null;
    try {
      await entry.run(cdp);
    } catch (caught) {
      error = caught;
    }
    const own = checks.slice(before);
    const passed = own.filter((check) => check.passed).length;
    const failed = own.length - passed;
    const durationMs = Date.now() - startedAt;
    runs.push({
      name: entry.name,
      checks: own.length,
      passed,
      failed,
      durationMs,
      error: error ? String((error && error.message) || error) : null,
    });
    const status = error || failed > 0 ? 'FAIL' : 'ok  ';
    const gezakt = failed > 0 ? `, ${failed} gezakt` : '';
    out(`${status} ${entry.name}: ${passed}/${own.length} controles geslaagd${gezakt} (${(durationMs / 1000).toFixed(1)}s)`);
    if (error) throw error;
  }
  return runs;
}

module.exports = {
  ALLEEN,
  LIJST,
  parseScenarioArgs,
  scenarioListing,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
};
