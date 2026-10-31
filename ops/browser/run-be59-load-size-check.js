'use strict';

// BE-59 deel 3 (#146) — de groei van de eerste laadgrootte, gemeten op twee
// echte productiebuilds.
//
// Acceptatie 3 van #146: de eerste laadgrootte van /, /search,
// /restaurant/[id] en /menu/[id] groeit hooguit 1 KB ten opzichte van de basis
// (2b0e8b1, de commit vóór het accountmenu en de footer).
//
// De meting is een koude eerste overdracht in een echte browser via CDP, met
// dezelfde methode als run-be42-browser-check.js: cacheloze navigatie op 1280 px,
// de som van alle overdrachten (document, scripts, stijlen) plus het aantal
// verzoeken. Beide standen worden met dezelfde browser, hetzelfde venster en
// dezelfde wachttijd gemeten.
//
// De basisstand komt uit een losse worktree buiten deze werkkopie
// (`../be59-base-<sha>`), met een junction naar de bestaande node_modules; er
// wordt niets aan deze branch, aan `main` of aan productie veranderd. Lokaal
// alleen: `next build` en `next start` op poort 3193 (basis) en 3194 (kop).
//
// Bewijs: ops/browser/evidence/be59-load-size-evidence.json (in git).

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { startBrowser, waitFor, killTree, findBrowser } = require('./lib/runtime');
const { CdpClient, waitForHttp } = require('./lib/cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NEXT_BIN = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const NODE_MODULES = path.join(REPO_ROOT, 'node_modules');

const BASE_PORT = 3193;
const HEAD_PORT = 3194;
const BUDGET_KB = 1;

const ROUTES = [
  { name: '/', path: '/', ready: `document.querySelector('main') !== null` },
  { name: '/search', path: '/search?q=steak', ready: `document.querySelector('main') !== null` },
  { name: '/restaurant/[id]', path: '/restaurant/6', ready: `document.querySelector('main') !== null` },
  { name: '/menu/[id]', path: '/menu/6-diner', ready: `document.querySelector('main') !== null` },
];

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const found = args.filter((value) => value.startsWith(`${flag}=`)).pop();
  return found ? found.slice(flag.length + 1) : fallback;
}

const BASE_SHA = argValue('--basis', '2b0e8b1');
const BASE_DIR = path.resolve(REPO_ROOT, '..', `be59-base-${BASE_SHA}`);
const EVIDENCE_PATH = path.join(__dirname, 'evidence', 'be59-load-size-evidence.json');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0) {
    const staart = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-2500);
    throw new Error(`${command} ${commandArgs.join(' ')} faalde (${result.status})\n${staart}`);
  }
  return result.stdout || '';
}

function prepareBase() {
  if (!fs.existsSync(BASE_DIR)) {
    run('git', ['worktree', 'add', '--detach', BASE_DIR, BASE_SHA]);
  } else {
    const huidig = run('git', ['-C', BASE_DIR, 'rev-parse', 'HEAD']).trim();
    if (!huidig.startsWith(BASE_SHA)) run('git', ['-C', BASE_DIR, 'checkout', '--detach', BASE_SHA]);
  }
  const modules = path.join(BASE_DIR, 'node_modules');
  if (!fs.existsSync(modules)) fs.symlinkSync(NODE_MODULES, modules, 'junction');
  return BASE_DIR;
}

function build(cwd, label) {
  console.log(`bouwen: ${label} (${cwd})`);
  run(process.execPath, [NEXT_BIN, 'build'], { cwd });
}

function startProduction(cwd, port, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const log = fs.createWriteStream(path.join(outputDir, `next-start-${port}.log`));
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    detached: process.platform !== 'win32',
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

function attachMeter(cdp) {
  const requests = new Map();
  const finished = [];
  cdp.on('Network.requestWillBeSent', (event) => {
    requests.set(event.requestId, { url: event.request.url, type: event.type });
  });
  cdp.on('Network.loadingFinished', (event) => {
    const meta = requests.get(event.requestId) || { url: 'unknown', type: 'Other' };
    finished.push({ url: meta.url, type: meta.type, bytes: event.encodedDataLength || 0 });
  });
  return {
    reset() {
      requests.clear();
      finished.length = 0;
    },
    summary() {
      const totalBytes = finished.reduce((sum, entry) => sum + entry.bytes, 0);
      const scriptBytes = finished
        .filter((entry) => entry.type === 'Script')
        .reduce((sum, entry) => sum + entry.bytes, 0);
      return {
        totalKb: Math.round((totalBytes / 1024) * 10) / 10,
        scriptKb: Math.round((scriptBytes / 1024) * 10) / 10,
        resourceCount: finished.length,
      };
    },
  };
}

async function measureRoutes(cdp, meter, appUrl, label) {
  const measured = [];
  for (const route of ROUTES) {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.clearBrowserCache');
    meter.reset();
    await cdp.send('Page.navigate', { url: `${appUrl}${route.path}` });
    const klaar = await waitFor(cdp, `document.readyState === 'complete' && (${route.ready})`, 60000);
    if (!klaar) throw new Error(`pagina_niet_klaar: ${route.path} (${label})`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const summary = meter.summary();
    measured.push({ route: route.name, label, ...summary });
    console.log(`${label} ${route.name}: ${summary.totalKb} KB totaal, ${summary.scriptKb} KB script, ${summary.resourceCount} verzoeken`);
  }
  return measured;
}

function compare(baseRows, headRows) {
  const rows = [];
  for (const route of ROUTES) {
    const base = baseRows.find((row) => row.route === route.name);
    const head = headRows.find((row) => row.route === route.name);
    if (!base || !head) {
      rows.push({ route: route.name, error: 'meting ontbreekt' });
      continue;
    }
    const growthKb = Math.round((head.totalKb - base.totalKb) * 10) / 10;
    const growthScriptKb = Math.round((head.scriptKb - base.scriptKb) * 10) / 10;
    rows.push({
      route: route.name,
      baseKb: base.totalKb,
      headKb: head.totalKb,
      growthKb,
      baseScriptKb: base.scriptKb,
      headScriptKb: head.scriptKb,
      growthScriptKb,
      withinBudget: growthKb <= BUDGET_KB,
    });
  }
  return rows;
}

function writeEvidence(record) {
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`);
  return EVIDENCE_PATH;
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('no_local_browser');

  prepareBase();
  build(BASE_DIR, `basis ${BASE_SHA}`);
  build(REPO_ROOT, 'kop (HEAD)');

  const outputDir = path.join(__dirname, 'output', 'be-59');
  let baseServer = null;
  let headServer = null;
  let browser = null;
  let cdp = null;

  try {
    baseServer = startProduction(BASE_DIR, BASE_PORT, outputDir);
    await waitForHttp(`http://localhost:${BASE_PORT}/`, 120000);

    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const meter = attachMeter(cdp);

    const baseRows = await measureRoutes(cdp, meter, `http://localhost:${BASE_PORT}`, `basis ${BASE_SHA}`);

    killTree(baseServer);
    baseServer = null;
    await new Promise((resolve) => setTimeout(resolve, 1500));

    headServer = startProduction(REPO_ROOT, HEAD_PORT, outputDir);
    await waitForHttp(`http://localhost:${HEAD_PORT}/`, 120000);
    const headRows = await measureRoutes(cdp, meter, `http://localhost:${HEAD_PORT}`, 'kop HEAD');

    const rows = compare(baseRows, headRows);
    const withinBudget = rows.every((row) => row.withinBudget === true);
    const target = writeEvidence({
      ticket: 'BE-59 (#146)',
      criterion: `de eerste laadgrootte groeit hooguit ${BUDGET_KB} KB`,
      category: 'koude eerste overdracht in een echte browser op twee lokale productiebuilds (next build + next start); geen productie en geen echte acceptatie',
      ranAt: new Date().toISOString(),
      baseSha: BASE_SHA,
      headSha: run('git', ['rev-parse', 'HEAD']).trim(),
      method: 'CDP Network.loadingFinished, cache uit, 1280x900, document + scripts + stijlen',
      budgetKb: BUDGET_KB,
      rows,
      base: baseRows,
      head: headRows,
      passed: withinBudget,
    });
    console.log(JSON.stringify({ evidence: target, passed: withinBudget }));
    for (const row of rows) {
      const status = row.withinBudget ? 'ok  ' : 'FOUT';
      console.log(`${status} ${row.route}: ${row.baseKb} → ${row.headKb} KB (${row.growthKb >= 0 ? '+' : ''}${row.growthKb} KB)`);
    }
    if (!withinBudget) process.exitCode = 1;
  } finally {
    try {
      if (cdp) cdp.close();
      if (browser) killTree(browser.child);
      if (baseServer) killTree(baseServer);
      if (headServer) killTree(headServer);
    } catch {
      // afsluiten mag nooit de uitslag verbergen
    }
  }
}

main().catch((error) => {
  console.error(String((error && error.stack) || error));
  process.exitCode = 1;
});
