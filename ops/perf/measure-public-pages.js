'use strict';

// BE-50 (#120) — herhaalbare meting van de publieke pagina's.
//
// Wat dit script doet:
// 1. bouwt lokaal een productiebuild (`next build`);
// 2. start die build lokaal (`next start`) op een poort uit 3170-3179;
// 3. meet daarna per publieke pagina in een headless Edge/Chrome de koud
//    overgedragen bytes per soort (JS, CSS, JSON/data, HTML), het aantal
//    verzoeken en de grootste scripts;
// 4. schrijft `ops/perf/evidence/public-pages.json` en de tabel in
//    `ops/perf/README.md`.
//
// Netwerk blijft lokaal: de browser start met `MAP * ~NOTFOUND, EXCLUDE
// localhost` uit ops/browser/lib/runtime.js, en het script zelf praat alleen
// met localhost. Geen productie-, Supabase- of andere externe aanroep; de
// Supabase-variabelen staan op een onbereikbaar lokaal adres.
//
// Gebruik:
//   node ops/perf/measure-public-pages.js              # bouwt en meet
//   node ops/perf/measure-public-pages.js --geen-build # hergebruik .next
//   PERF_PORT=3175 node ops/perf/measure-public-pages.js
//
// Het script is geen test: het levert het bewijs dat de budgettest
// (ops/perf/public-pages-budget.test.js) als grens gebruikt.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { CdpClient, waitForHttp } = require('../browser/lib/cdp');
const { REPO_ROOT, findBrowser, killTree, startBrowser, evalJs, navigate } = require('../browser/lib/runtime');
const { firstLoadJsFromBuild, hasProductionBuild } = require('./lib/first-load-js');

const PORT = Number(process.env.PERF_PORT || 3170);
const APP = `http://localhost:${PORT}`;
const HERE = __dirname;
const EVIDENCE_DIR = path.join(HERE, 'evidence');
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, 'public-pages.json');
const README_FILE = path.join(HERE, 'README.md');
const LOG_DIR = path.join(HERE, 'output');

// De zes pagina's uit het bouwcontract. Eén restaurant met vier kaarten
// (/restaurant/6, Brasserie Bardot) en één groot menu (/menu/23-borrel,
// T-Huis met 138 gerechten, het grootste menu in data/menus.json).
const PAGES = [
  {
    id: 'home',
    label: 'Home',
    path: '/',
    route: '/page',
    ready: 'document.querySelector(".home-hero") !== null',
  },
  {
    id: 'search',
    label: 'Zoeken (q=pasta)',
    path: '/search?q=pasta',
    route: '/search/page',
    ready: 'document.querySelector(".results-section") !== null',
  },
  {
    id: 'alle-restaurants',
    label: 'Alle restaurants',
    path: '/alle-restaurants',
    route: '/alle-restaurants/page',
    ready: 'document.querySelector(".ar-card") !== null',
  },
  {
    id: 'restaurant',
    label: 'Restaurant (Bardot, 4 kaarten)',
    path: '/restaurant/6',
    route: '/restaurant/[id]/page',
    ready: 'document.querySelector(".rpm-panel") !== null',
  },
  {
    id: 'menu',
    label: 'Menu (T-Huis borrel, 138 gerechten)',
    path: '/menu/23-borrel',
    route: '/menu/[id]/page',
    ready: 'document.querySelector("main.page-main") !== null',
  },
  {
    id: 'mijn-lijstje',
    label: 'Mijn lijstje',
    path: '/mijn-lijstje',
    route: '/mijn-lijstje/page',
    ready: 'document.querySelector(".lijst-main") !== null',
  },
];

const VIEWPORT = { width: 1280, height: 900 };

function localEnv() {
  return {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    // Onbereikbaar lokaal adres: er gaat niets naar buiten tijdens de meting.
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-perf-placeholder',
  };
}

function nextBin() {
  return path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
}

function runBuild() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, 'next-build.log');
  const out = fs.openSync(logFile, 'w');
  const result = spawnSync(process.execPath, [nextBin(), 'build'], {
    cwd: REPO_ROOT,
    env: localEnv(),
    stdio: ['ignore', out, out],
  });
  fs.closeSync(out);
  if (result.status !== 0) throw new Error(`next_build_failed: zie ${logFile}`);
}

function startServer() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(LOG_DIR, 'next-start.log'));
  const child = spawn(process.execPath, [nextBin(), 'start', '-p', String(PORT)], {
    cwd: REPO_ROOT,
    env: localEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32',
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

function isLocalUrl(url) {
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url);
}

// ── netwerk: elke afgeronde request met zijn echte overdracht ───────────────
// `Network.loadingFinished.encodedDataLength` is wat er werkelijk over de
// (lokale) lijn ging, inclusief de compressie van de server. `responseReceived`
// geeft het type en de mime-soort waarmee we JS, CSS en data scheiden.
function attachNetworkMeter(cdp) {
  const requests = new Map();
  const finished = [];
  let lastActivity = Date.now();
  let foreign = 0;

  cdp.on('Network.responseReceived', (event) => {
    const entry = requests.get(event.requestId);
    if (!entry) return;
    entry.mimeType = event.response.mimeType || '';
    entry.status = event.response.status;
    lastActivity = Date.now();
  });
  cdp.on('Network.loadingFinished', (event) => {
    const entry = requests.get(event.requestId);
    requests.delete(event.requestId);
    lastActivity = Date.now();
    if (!entry) return;
    finished.push({ ...entry, bytes: event.encodedDataLength || 0 });
  });
  cdp.on('Network.loadingFailed', (event) => {
    requests.delete(event.requestId);
    lastActivity = Date.now();
  });
  cdp.on('Network.requestWillBeSent', (event) => {
    lastActivity = Date.now();
    if (!isLocalUrl(event.request.url)) {
      if (!event.request.url.startsWith('data:')) foreign += 1;
      return;
    }
    requests.set(event.requestId, {
      url: event.request.url,
      type: event.type || 'Other',
      mimeType: '',
      status: null,
    });
  });

  return {
    reset() {
      requests.clear();
      finished.length = 0;
      foreign = 0;
      lastActivity = Date.now();
    },
    pending() {
      return requests.size;
    },
    idleMs() {
      return Date.now() - lastActivity;
    },
    foreignCount() {
      return foreign;
    },
    finished() {
      return finished.slice();
    },
  };
}

// De soort bepaalt de kolom in het bewijs: `Document` is de HTML zelf,
// `Script` is JS, `Stylesheet` is CSS, `XHR`/`Fetch` is data (JSON) en de rest
// telt als overig, zodat het totaal altijd de som van de kolommen is.
function kindOf(entry) {
  if (entry.type === 'Document') return 'html';
  if (entry.type === 'Script') return 'js';
  if (entry.type === 'Stylesheet') return 'css';
  if (entry.type === 'XHR' || entry.type === 'Fetch') return 'data';
  if (entry.type === 'Font') return 'font';
  if (entry.type === 'Image') return 'image';
  return 'other';
}

function shortUrl(url) {
  return url.startsWith(APP) ? url.slice(APP.length) : url;
}

function sumEntries(entries) {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

function summarizePage(page, entries) {
  const categories = { html: 0, js: 0, css: 0, data: 0, font: 0, image: 0, other: 0 };
  for (const entry of entries) categories[kindOf(entry)] += entry.bytes;

  const scripts = entries
    .filter((entry) => kindOf(entry) === 'js')
    .sort((a, b) => b.bytes - a.bytes);
  const dataEntries = entries
    .filter((entry) => kindOf(entry) === 'data')
    .sort((a, b) => b.bytes - a.bytes);

  const totalBytes = sumEntries(entries);
  const column = (bytes) => ({ bytes, kb: round1(bytes / 1024) });
  return {
    id: page.id,
    label: page.label,
    path: page.path,
    route: page.route,
    totalBytes,
    totalKb: round1(totalBytes / 1024),
    requests: entries.length,
    categories: {
      html: column(categories.html),
      js: column(categories.js),
      css: column(categories.css),
      data: column(categories.data),
      font: column(categories.font),
      image: column(categories.image),
      other: column(categories.other),
    },
    jsRequests: scripts.length,
    topScripts: scripts.slice(0, 5).map((entry) => ({
      url: shortUrl(entry.url),
      bytes: entry.bytes,
      kb: round1(entry.bytes / 1024),
    })),
    dataRequests: dataEntries.map((entry) => ({
      url: shortUrl(entry.url),
      bytes: entry.bytes,
      kb: round1(entry.bytes / 1024),
    })),
  };
}

// Wachttijd tot het netwerk stil is: geen openstaande request en enige tijd
// geen nieuwe activiteit. Zo telt de datafetch van een pagina (bijvoorbeeld
// /api/search op /search) mee en ook de prefetch die Next.js zelf na de
// eerste render start, zonder dat trage ISR-rendering de meting onbruikbaar
// maakt.
//
// BE-50 (#120) — het venster moet lang genoeg zijn om de prefetch die Next.js
// na de eerste render start normaal mee te nemen. Met 1,5 s viel die prefetch
// soms net binnen en soms net buiten het venster: twee metingen van dezelfde
// build gaven /alle-restaurants 159,6 KB bij 14 verzoeken en 164,1 KB bij 23
// verzoeken. Met 4 s stil is het beeld rustiger: de grootste posten (JS, CSS,
// HTML) en het totaal zijn per run gelijk op ±1 KB, en alleen de prefetch van
// zichtbare links kan nog een paar RSC-verzoeken toevoegen of weglaten
// (gemeten: /restaurant/6 173,1 KB bij 15 verzoeken en 175,1 KB bij 19
// verzoeken). Die prefetch is een bewuste versnelling van de volgende tik, geen
// deel van de eerste render; de harde grens voor regressies staat daarom in de
// budgettest op de bouwkant (criterium 5), die deterministisch is.
const SETTLE = { idleMs: 4000, timeoutMs: 40000 };

async function waitForIdle(meter, { idleMs = SETTLE.idleMs, timeoutMs = SETTLE.timeoutMs } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (meter.pending() === 0 && meter.idleMs() >= idleMs) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function measurePage(cdp, meter, page) {
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  meter.reset();
  await navigate(cdp, `${APP}${page.path}`, page.ready);
  await waitForIdle(meter);
  const result = summarizePage(page, meter.finished());
  result.foreignRequests = meter.foreignCount();
  return result;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}


// ── bewijs en rapport ──────────────────────────────────────────────────────
function gitValue(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function nextVersion() {
  try {
    return require(path.join(REPO_ROOT, 'node_modules', 'next', 'package.json')).version;
  } catch {
    return null;
  }
}

function readReadme() {
  if (!fs.existsSync(README_FILE)) {
    return [
      "# Meting publieke pagina's (BE-50, #120)",
      '',
      'Dit bestand wordt geschreven door `node ops/perf/measure-public-pages.js`:',
      'de meting start zelf een lokale productiebuild (`next build` +',
      '`next start`) op een poort uit 3170-3179 en meet daarna elke publieke',
      'pagina koud in een headless browser. Netwerk blijft lokaal.',
      '',
      'Per pagina: overgedragen bytes per soort (HTML, JS, CSS, JSON/data), het',
      'totaal, het aantal verzoeken en het grootste script. De volledige meting',
      'staat in `ops/perf/evidence/public-pages.json`; de budgettest',
      '`ops/perf/public-pages-budget.test.js` gebruikt die grenzen.',
      '',
      '<!-- meting:begin -->',
      '',
      '<!-- meting:eind -->',
      '',
    ].join('\n');
  }
  return fs.readFileSync(README_FILE, 'utf8');
}

function kb(bytes) {
  return `${round1(bytes / 1024)}`;
}

function readmeBlock(evidence) {
  const rows = evidence.pages.map((page) => {
    const biggest = page.topScripts[0];
    const c = page.categories;
    return `| ${page.label} (\`${page.path}\`) | ${kb(c.html.bytes)} | ${kb(c.js.bytes)} | ${kb(c.css.bytes)} | ${kb(
      c.data.bytes
    )} | **${page.totalKb}** | ${page.requests} | ${biggest ? `${kb(biggest.bytes)} KB` : '–'} |`;
  });
  return [
    `Gemeten: ${evidence.measuredAt} · commit \`${(evidence.gitHead || 'onbekend').slice(0, 12)}\` · poort ${evidence.port} · koude cache.`,
    '',
    '| Pagina | HTML | JS | CSS | JSON/data | Totaal | Verzoeken | Grootste script |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    'Alle bedragen in KB. Het eigen productdoel uit `CLAUDE.md` is minder dan 250 KB overgedragen bij de eerste keer laden.',
  ].join('\n');
}

function writeReadme(evidence) {
  const current = readReadme();
  const begin = '<!-- meting:begin -->';
  const end = '<!-- meting:eind -->';
  const start = current.indexOf(begin);
  const stop = current.indexOf(end);
  const next =
    start === -1 || stop === -1
      ? `${current}${current.endsWith('\n') ? '' : '\n'}${begin}\n${readmeBlock(evidence)}\n${end}\n`
      : `${current.slice(0, start + begin.length)}\n${readmeBlock(evidence)}\n${current.slice(stop)}`;
  fs.writeFileSync(README_FILE, next);
}

function writeEvidence(evidence) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
}

// ── hoofdlus ───────────────────────────────────────────────────────────────
async function main() {
  const skipBuild = process.argv.includes('--geen-build');
  if (!skipBuild) {
    process.stdout.write('next build ... ');
    runBuild();
    process.stdout.write('klaar\n');
  }
  if (!hasProductionBuild(REPO_ROOT)) {
    throw new Error('geen productiebuild gevonden (.next/app-build-manifest.json): bouw eerst of laat --geen-build weg');
  }

  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: zet BROWSER_PATH naar een geinstalleerde Edge/Chrome');

  let server = null;
  let browser = null;
  let cdp = null;
  try {
    server = startServer();
    await waitForHttp(`${APP}/`, 120000);
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const meter = attachNetworkMeter(cdp);
    const pageResults = [];
    for (const page of PAGES) {
      const result = await measurePage(cdp, meter, page);
      result.buildFirstLoadJs = firstLoadJsFromBuild({ root: REPO_ROOT, route: page.route });
      pageResults.push(result);
      process.stdout.write(
        `${page.path}: ${result.totalKb} KB totaal, ${result.categories.js.kb} KB JS, ${result.requests} verzoeken\n`
      );
    }

    const foreign = pageResults.reduce((sum, page) => sum + (page.foreignRequests || 0), 0);
    if (foreign > 0) {
      throw new Error(`niet-lokale verzoeken gemeten (${foreign}): de meting moet lokaal blijven`);
    }

    const evidence = {
      be: 'BE-50 (#120)',
      measuredAt: new Date().toISOString(),
      gitHead: gitValue(['rev-parse', 'HEAD']),
      branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
      node: process.version,
      next: nextVersion(),
      port: PORT,
      baseUrl: APP,
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
      build: skipBuild ? 'hergebruikt bestaande .next (--geen-build)' : 'next build in dit script',
      cache: 'cache uitgeschakeld en per pagina geleegd (koude eerste lading)',
      settle: `netwerk ${SETTLE.idleMs} ms stil na de eerste render; prefetch van zichtbare links valt daar soms binnen, bovengrens ${SETTLE.timeoutMs} ms`,
      network: 'alleen localhost; de browser kan geen externe host bereiken',
      nature: 'developer evidence, lokaal gemeten; geen productiemeting en geen acceptatie',
      pages: pageResults,
    };
    writeEvidence(evidence);
    writeReadme(evidence);
    process.stdout.write(`bewijs: ${path.relative(REPO_ROOT, EVIDENCE_FILE)}\n`);
  } finally {
    if (cdp) cdp.close();
    if (browser) {
      killTree(browser.child);
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // Een achtergebleven tijdelijke map is geen meetfout.
      }
    }
    if (server) killTree(server);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { PAGES, summarizePage, kindOf, attachNetworkMeter, measurePage };
