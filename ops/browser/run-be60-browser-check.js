'use strict';

// BE-60 (#150) — browsercheck met een gestubde zoek-API: een goedgekeurde
// houderwijziging in de zoekresultaten (nieuwe prijs en het label "Tijdelijk
// niet beschikbaar"), in licht en donker op 1280, 390 en 320 px.
//
// Fixture-bewijs: een echte browser via CDP, de echte zoekpagina, en één in de
// pagina gestubde /api/search (lib/be60-zoek-stub.js). Geen Supabase-project,
// geen productiesleutel, geen productiedata, geen internet.
//
// Wat bewezen wordt:
//  - de zoekresultaten tonen de nieuwe prijs (€ 18,50) van een goedgekeurde
//    wijziging;
//  - een gerecht dat tijdelijk niet beschikbaar is, blijft staan en krijgt het
//    label "Tijdelijk niet beschikbaar";
//  - label en prijs staan bij de opname in beeld, zonder horizontale overflow,
//    op 1280, 390 en 320 px en in licht en donker;
//  - screenshots bij het bewijs.
//
// Niet bewezen hier: de serverregels (overlay, filter, volgorde) — die staan in
// src/lib/zoekOverlay.test.js en src/services/dishSearch.test.js. Dit is
// ontwikkelaarsbewijs, geen onafhankelijke review en geen productieacceptatie.
//
// Gebruik: node ops/browser/run-be60-browser-check.js [--alleen=<scenario>] [--lijst]
// Poort: BE60_PORT of 3186 (binnen 3180-3189).

const fs = require('node:fs');
const path = require('node:path');

const {
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  navigate,
  screenshot,
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const { be60StubScript, NIEUWE_PRIJS, LABEL } = require('./lib/be60-zoek-stub');

const SCRIPT_NAME = 'run-be60-browser-check.js';
const PORT = Number(process.env.BE60_PORT || 3186);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const OUT_DIR = path.join(__dirname, 'output', 'be-60');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be60-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-60');

const checks = [];
const shots = [];
let scenarioRuns = null;
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({ ...file, viewport: `${viewport.width}x${viewport.height}`, theme: meta.theme || null, state: meta.state || null });
  return file;
}

async function kiesThema(cdp, theme) {

// Leest de kaarten van de zoekresultaten en meet of prijs en label in beeld
// staan. Eerst naar het label scrollen (met ruimte boven de plakkende kop),
// daarna de rechthoeken tegen de viewport leggen.
const ZOEK_STAAT = `(() => {
  const rijen = Array.from(document.querySelectorAll('.dish-result-card-row'));
  const label = document.querySelector('.dish-result-unavailable');
  if (label) label.scrollIntoView({ block: 'center', behavior: 'instant' });
  const inBeeld = (element) => {
    if (!element) return false;
    const r = element.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth && r.width > 0 && r.height > 0;
  };
  const metLabel = label ? label.closest('.dish-result-card-row') : null;
  const prijs = metLabel ? metLabel.querySelector('.price-label') : null;
  return {
    thema: document.documentElement.getAttribute('data-theme'),
    rijen: rijen.length,
    labelTekst: label ? label.textContent.trim() : '',
    labelInBeeld: inBeeld(label),
    prijzen: rijen.map((rij) => ((rij.querySelector('.price-label') || {}).textContent || '').trim()),
    namen: rijen.map((rij) => ((rij.querySelector('.dish-group-example-link') || {}).textContent || '').trim()),
    prijsBijLabel: prijs ? prijs.textContent.trim() : '',
    labelKleur: label ? getComputedStyle(label).color : '',
    labelAchtergrond: label ? getComputedStyle(label).backgroundColor : '',
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

async function zoekenScenario(cdp) {
  for (const theme of ['light', 'dark']) {
    await kiesThema(cdp, theme);
    for (const width of [1280, 390, 320]) {
      await setViewport(cdp, width, 900);
      await navigate(cdp, `${APP}/search?q=steak`, `Boolean(document.querySelector('.dish-result-unavailable'))`, 120000);
      const staat = await evalJs(cdp, ZOEK_STAAT);
      const waar = `${theme}/${width}`;
      check(`zoeken ${waar}: precies één label "Tijdelijk niet beschikbaar"`, staat.labelTekst === LABEL, staat.labelTekst);
      check(`zoeken ${waar}: de nieuwe prijs van de goedgekeurde wijziging staat er`, staat.prijzen.includes(NIEUWE_PRIJS), staat.prijzen.join('|'));
      check(`zoeken ${waar}: het gerecht met het label blijft staan, met zijn prijs`,
        staat.prijsBijLabel.length > 0, staat.prijsBijLabel);
      check(`zoeken ${waar}: de volgorde blijft gelijk (twee gerechten)`, staat.rijen === 2, staat.rijen);
      check(`zoeken ${waar}: label en prijs staan in beeld bij de opname`, staat.labelInBeeld, JSON.stringify({ label: staat.labelInBeeld, overflow: staat.overflow }));
      check(`zoeken ${waar}: geen horizontale overflow`, staat.overflow <= 0, staat.overflow);
      check(`zoeken ${waar}: het label is zichtbaar opgemaakt (tekst en achtergrond)`,
        staat.labelKleur !== 'rgba(0, 0, 0, 0)' && staat.labelAchtergrond !== 'rgba(0, 0, 0, 0)',
        `${staat.labelKleur} / ${staat.labelAchtergrond}`);
      await shot(cdp, `be60-zoeken-${width}-${theme}.png`, { theme, state: 'overlay' });
    }
  }
}

const SCENARIOS = [
  { name: 'zoeken', run: (cdp) => zoekenScenario(cdp) },
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

function evidencePath() {
  return SELECTION.filter ? path.join(EVIDENCE_DIR, 'be60-browser-evidence-gefilterd.json') : BASE_EVIDENCE_PATH;
}

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    kind: 'fixture_browser_evidence',
    category: `lokale browsercheck met gestubde zoek-API (next dev op poort ${PORT}); geen productie en geen echte acceptatie`,
    startedAt: new Date().toISOString(),
    port: PORT,
    filter: SELECTION.filter,
    scenarioRuns,
    network: networkEvidence,
    checks,
    shots,
    failed: failed.length,
    passed: failed.length === 0 && checks.length > 0,
    ...extra,
  };
  fs.writeFileSync(evidencePath(), JSON.stringify(record, null, 2));
  return record;

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const watchdog = setTimeout(() => {
    writeEvidence({ error: 'timeout na 8 minuten' });
    process.exit(2);
  }, 8 * 60 * 1000);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ error: 'browser_unavailable' });
    throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  }

  let server = null;
  let browser = null;
  let cdp = null;
  try {
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: `${APP}/search?q=steak`,
      fixtureRoutes: [
        { id: 'zoeken', match: 'prefix', path: '/api/search', methods: ['GET'] },
        { id: 'restaurants', match: 'prefix', path: '/api/restaurants', methods: ['GET'] },
        { id: 'bekeken', match: 'exact', path: '/api/v1/bekeken', methods: ['POST'] },
      ],
    });
    await enableFetchGuard(cdp, guard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be60StubScript() });

    scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    const guardViolations = guard.appViolations();
    check('netwerk: geen geblokkeerde oproep in de pagina', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
    check('netwerk: geen geblokkeerde oproep op CDP-niveau', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
    networkEvidence = { appViolations: guardViolations, pageViolations };

    const zoekUrls = await evalJs(cdp, 'window.__BE60_ZOEK__ || []');
    check('zoeken: de pagina vroeg de gestubde zoek-API om de resultaten',
      Array.isArray(zoekUrls) && zoekUrls.length > 0, JSON.stringify((zoekUrls || []).slice(0, 2)));

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

    const record = writeEvidence({});
    console.log(JSON.stringify({
      passed: record.passed,
      checks: checks.length,
      failed: record.failed,
      screenshots: shots.length,
      evidence: evidencePath(),
    }, null, 2));
    if (!record.passed) process.exitCode = 1;
  } catch (error) {
    writeEvidence({ error: String((error && error.stack) || error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // Een vergrendeld tijdelijk profiel staat buiten de repo en is onschadelijk.
      }
    }
  }
}

main();

}

  await evalJs(cdp, `(() => { try { localStorage.setItem('bredaeats_theme', '${theme}'); } catch (error) { return false; } return true; })()`);
}
