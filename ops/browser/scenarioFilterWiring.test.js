'use strict';

// BE-43 (#101) — de bedrading van de scenariofilter in de echte checks.
//
// De helper zelf is unit-getest in lib/scenario-filter.test.js. Deze test bewaakt
// dat elke browsercheck met meerdere scenario's hem ook werkelijk gebruikt, dat
// de vlag vóór de browser en de server wordt gelezen (dus: niets start bij
// `--lijst` of een onbekende naam), dat een gefilterde run naar een eigen
// bewijsbestand schrijft en dat het bewijs zijn keuze noemt.
//
// Zelfde conventie als be42BrowserCheck.test.js: fs.readFileSync + regex, geen
// browser en geen netwerk.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// De checks met meer dan één scenariofunctie (`grep -l "Scenario(" ops/browser/run-*.js`).
const MULTI_SCENARIO_CHECKS = [
  { file: 'ops/browser/run-menu-review-browser-check.js', list: 'SCENARIOS' },
  { file: 'ops/browser/run-public-style-browser-check.js', list: 'SCENARIOS' },
  { file: 'ops/browser/run-internal-nav-browser-check.js', list: 'NAV_SCENARIOS' },
  { file: 'ops/browser/run-een-klik-browser-check.js', list: 'CHECK_SCENARIOS' },
  { file: 'ops/browser/run-bronnen-browser-check.js', list: 'CHECK_SCENARIOS' },
  { file: 'ops/browser/run-beeld-lezen-browser-check.js', list: 'CHECK_SCENARIOS' },
  { file: 'ops/browser/run-straks-browser-check.js', list: 'CHECK_SCENARIOS' },
  { file: 'ops/browser/run-klaar-voor-publicatie-browser-check.js', list: 'CHECK_SCENARIOS' },
];

test('BE-43: elke check met meerdere scenario\'s gebruikt de gedeelde helper', () => {
  for (const { file, list } of MULTI_SCENARIO_CHECKS) {
    const source = read(file);
    assert.match(source, /require\('\.\/lib\/scenario-filter'\)/, `${file} mist de helper`);
    assert.match(source, new RegExp(`const ${list} = \\[`), `${file} mist zijn scenariolijst`);
    assert.match(source, new RegExp(`parseScenarioArgs\\((?:process\\.argv\\.slice\\(2\\)|args), ${list}\\)`), `${file} leest --alleen/--lijst niet`);
    assert.match(source, /runScenarioSelection\(\{ entries: [A-Z_]+, checks, cdp, filter: SELECTION\.filter \}\)/, `${file} draait de selectie niet`);
    assert.match(source, /filteredEvidencePath\(BASE_EVIDENCE_PATH, SELECTION\.filter\)/, `${file} scheidt het gefilterde bewijs niet`);
    assert.match(source, /filter: SELECTION\.filter/, `${file} noemt de keuze niet in het bewijs`);
    assert.match(source, /scenarios: scenarioRuns/, `${file} bewaart de scenarioregels niet in het bewijs`);
  }
});

test('BE-43: --lijst en een onbekende naam starten geen browser of server', () => {
  for (const { file, list } of MULTI_SCENARIO_CHECKS) {
    const source = read(file);
    const guard = source.indexOf('scenarioSelectionOutcome({ selection: SELECTION');
    assert.ok(guard > 0, `${file} leest de vlag niet`);
    const firstStart = Math.min(
      ...['findBrowser()', 'startServer(', 'startBrowser(', 'startProductionServer(']
        .map((marker) => source.indexOf(marker, source.indexOf('async function main()')))
        .filter((index) => index > 0),
    );
    assert.ok(guard < firstStart, `${file} start iets vóór de vlag gelezen is`);
    assert.match(source.slice(guard, guard + 260), /outcome\.stop[\s\S]*?process\.exitCode = outcome\.exitCode[\s\S]*?return;/, `${file} stopt niet bij --lijst of een fout`);
    assert.ok(source.includes(list), `${file} mist de lijst`);
  }
});

test('BE-43: de uitvoer toont alleen details bij een fout', () => {
  for (const file of [
    'ops/browser/run-public-style-browser-check.js',
    'ops/browser/run-straks-browser-check.js',
    'ops/browser/run-klaar-voor-publicatie-browser-check.js',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /\$\{entry\.passed \? 'ok  ' : 'FAIL'\}/, `${file} logt nog elke controle`);
    assert.doesNotMatch(source, /\$\{passed \? 'ok  ' : 'FAIL'\}/, `${file} logt nog elke controle`);
    assert.match(source, /if \(!entry\.passed\) console\.log|if \(!passed\) console\.log/, `${file} toont een fout niet`);
  }
});

test('BE-43: een gefilterd bewijsbestand staat nooit in de repository', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /ops\/browser\/evidence\/\*\.filtered\.json/);
});

test('BE-43: de developerregel staat in .agent/project/developer.md', () => {
  const developer = read('.agent/project/developer.md');
  assert.match(developer, /tijdens het werk\s+`--alleen`, aan het eind één volledige run/);
});

test('BE-43: de README legt beide vlaggen uit', () => {
  const readme = read('ops/browser/README.md');
  assert.match(readme, /--lijst/);
  assert.match(readme, /--alleen=<naam>\[,<naam>\]/);
  assert.match(readme, /\.filtered\.json/);
});
