'use strict';

// BE-38 (#90) — browserbewijs voor "Straks op de kaart" en "Morgen op de
// kaart".
//
// Dit script start de echte productiebuild (`next start`) op een lokale poort
// en bestuurt een lokaal geïnstalleerde Edge/Chrome via CDP, net als de
// BE-28/BE-29/BE-37-checks. Met een vaste browserklok (2026-10-23, een
// vrijdag, Europe/Amsterdam, zomertijd UTC+2) legt het drie momenten vast:
//
//   - 16:30 — de echte data heeft dan twee borrelgerechten, dus de sectie
//     valt terug op "Straks op de kaart · vanaf HH:MM" met de gerechten van
//     het eerstvolgende moment en per gerecht "🕒 Opent om HH:MM";
//   - 20:00 — genoeg voor dit moment: de normale titel "Vanavond op de kaart",
//     en "Nu open" alleen voor wat op dat moment echt open is;
//   - 23:30 — na sluitingstijd: "Morgen op de kaart" met de lunch van morgen.
//
// Van elk moment komen screenshots op 1280 en 390 px in licht en donker in
// `ops/browser/evidence/be-38/`; de meting zelf staat in
// `ops/browser/evidence/straks-browser-evidence.json`.
//
// De vaste klok is een meetinstrument (`Date`-override vóór navigatie); de
// productcode rekent altijd met de browserklok en Europe/Amsterdam. Dit is
// developer-evidence op een lokale build: geen productie, geen echte
// Supabase-credentials en geen merge of publicatie.
//
// Gebruik:
//   node node_modules/next/dist/bin/next build
//   node ops/browser/run-straks-browser-check.js

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { REPO_ROOT, findBrowser, killTree, startBrowser, evalJs, navigate } = require('./lib/runtime');
const { CdpClient, waitForHttp } = require('./lib/cdp');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const SCRIPT_NAME = 'run-straks-browser-check.js';
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const SHOTS_DIR = path.join(EVIDENCE_DIR, 'be-38');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'straks-browser-evidence.json');
const OUT_DIR = path.join(__dirname, 'output', 'be-38');
const PORT = Number(process.env.BE38_PORT || 3148);
const APP = `http://localhost:${PORT}`;
// Zonder productiebuild stopt `next start` met een onduidelijke fout; liever
// meteen zeggen wat er ontbreekt.
const PRODUCTION_BUILD = path.join(REPO_ROOT, '.next', 'BUILD_ID');

// Vaste momenten van 2026-10-23 (vrijdag). `mode` is wat de pure selectie
// (src/lib/publicTonight.js) op dat moment moet kiezen. De titel draagt in de
// opmaak een decoratief 🔥 (aria-hidden); de tekst moet verder letterlijk
// kloppen.
const MOMENTS = [
  {
    id: '16-30-terugval',
    iso: '2026-10-23T14:30:00Z', // 16:30 lokaal
    clock: '16:30',
    mode: 'later',
    meal: 'diner',
    title: /^Straks op de kaart · vanaf \d{2}:\d{2}(?: 🔥)?$/,
    expectOpenLabel: false,
    expectOpensLabel: true,
  },
  {
    id: '20-00-nu',
    iso: '2026-10-23T18:00:00Z', // 20:00 lokaal
    clock: '20:00',
    mode: 'now',
    meal: 'diner',
    title: /^Vanavond op de kaart(?: 🔥)?$/,
    expectOpenLabel: true,
    expectOpensLabel: false,
  },
  {
    id: '23-30-morgen',
    iso: '2026-10-23T21:30:00Z', // 23:30 lokaal
    clock: '23:30',
    mode: 'tomorrow',
    meal: 'lunch',
    title: /^Morgen op de kaart(?: 🔥)?$/,
    expectOpenLabel: false,
    expectOpensLabel: true,
  },
];

const WIDTHS = [1280, 390];
const THEMES = ['light', 'dark'];

const checks = [];
const shots = [];
const moments = [];
let viewport = { width: 1280, height: 900 };
let scenarioRuns = null;
let serverHtmlEvidence = null;

function check(name, passed, detail) {
  const entry = { name, passed: Boolean(passed), detail: detail === undefined || detail === null ? null : String(detail) };
  checks.push(entry);
  // BE-43 (#101): de uitvoer is één regel per scenario, met de details alleen
  // bij een fout; het volledige bewijs staat in het JSON-bestand.
  if (!entry.passed) console.log(`FAIL ${name}${entry.detail ? ` — ${entry.detail}` : ''}`);
  return entry.passed;
}


// ── server, viewport, thema, vaste klok en screenshots ─────────────────────
function startProductionServer() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(OUT_DIR, 'next-start.log'));
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-check-placeholder',
  };
  // Zelfde afweging als `lib/runtime.startServer`: op deze runner staat geen
  // npm, dus dezelfde `next start` loopt via node. Alleen de manier van
  // starten verschilt; commando, env en log niet.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmAvailable =
    spawnSync(npm, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
  const nextBin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = npmAvailable
    ? spawn(npm, ['run', 'start', '--', '-p', String(PORT)], {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        detached: process.platform !== 'win32',
      })
    : spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: process.platform !== 'win32',
      });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return waitForHttp(`${APP}/`, 120000).then(() => child);
}

async function setViewport(cdp, width) {
  viewport = { width, height: width >= 1280 ? 900 : 844 };
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

async function shot(cdp, name, { focus = null } = {}) {
  let width = viewport.width;
  let height = viewport.height;
  let result;
  if (focus) {
    // Telefoon: de sectie zelf in beeld. Een beyond-viewport-opname zou de
    // vaste tabbar op zijn viewportpositie schilderen en de sectie alsnog
    // buiten beeld laten; daarom scrollen we naar de sectie en leggen we
    // precies vast wat het toestel ziet.
    await evalJs(
      cdp,
      `(() => { const el = document.querySelector(${JSON.stringify(focus)}); if (el) el.scrollIntoView({ block: 'center' }); return Boolean(el); })()`
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  } else {
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const content = metrics.cssContentSize || metrics.contentSize;
    // Desktop: de hele pagina, zodat de hele home in één beeld staat.
    width = Math.max(1, Math.min(viewport.width, Math.ceil(content.width)));
    height = Math.min(5000, Math.ceil(content.height));
    result = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
  }
  const buffer = Buffer.from(result.data, 'base64');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, name);
  fs.writeFileSync(file, buffer);
  const entry = {
    file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
    bytes: buffer.length,
    width,
    height,
    focus: focus || 'page',
    viewport: `${viewport.width}x${viewport.height}`,
  };
  shots.push(entry);
  return entry;
}

async function applyTheme(cdp, theme) {
  await navigate(cdp, `${APP}/`, `document.readyState === 'complete'`);
  await evalJs(cdp, `localStorage.setItem('bredaeats_theme', '${theme}')`);
}

// BE-38 (#90) — de vaste browserklok. Alleen dit meetinstrument vervangt
// `Date`; de productcode leest gewoon de browserklok en Europe/Amsterdam.
let clockScriptId = null;
async function setFixedClock(cdp, iso) {
  if (clockScriptId) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScriptId });
    clockScriptId = null;
  }
  if (!iso) return;
  const fixed = new Date(iso).getTime();
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const RealDate = Date;
      const fixed = ${fixed};
      class FixedDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
        static now() { return fixed; }
      }
      FixedDate.parse = RealDate.parse;
      FixedDate.UTC = RealDate.UTC;
      window.Date = FixedDate;
    })();`,
  });
  clockScriptId = result.identifier;
}

// ── de meting per moment ───────────────────────────────────────────────────
const SECTION_JS = `(() => {
  const section = document.querySelector('.tonight-section');
  const text = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : null);
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    present: section !== null,
    mode: section ? section.getAttribute('data-mode') : null,
    meal: section ? section.getAttribute('data-meal') : null,
    title: section ? text(section.querySelector('.home-section-title')) : null,
    allLink: section && section.querySelector('.home-all-link') ? section.querySelector('.home-all-link').getAttribute('href') : null,
    cards: section
      ? [...section.querySelectorAll('.tonight-card')].map((link) => ({
          name: text(link.querySelector('.tonight-name')),
          restaurant: text(link.querySelector('.tonight-meta')),
          price: text(link.querySelector('.tonight-price')),
          href: link.getAttribute('href'),
          labels: [...link.querySelectorAll('.tonight-tag, .open-label')].map(text),
        }))
      : [],
    openLabels: section ? [...section.querySelectorAll('.open-label')].map(text) : [],
    laterLabels: section ? [...section.querySelectorAll('.open-label--later')].map(text) : [],
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    tabbar: (() => {
      const bar = document.querySelector('.mobile-tabbar');
      return bar ? getComputedStyle(bar).display !== 'none' : null;
    })(),
  };
})()`;

async function momentScenario(cdp, moment) {
  await setFixedClock(cdp, moment.iso);
  const record = { id: moment.id, clock: `${moment.clock} Europe/Amsterdam`, iso: moment.iso, mode: moment.mode, screens: [], state: null };

  for (const theme of THEMES) {
    await applyTheme(cdp, theme);
    for (const width of WIDTHS) {
      await setViewport(cdp, width);
      await navigate(
        cdp,
        `${APP}/`,
        `document.readyState === 'complete' && document.querySelector('.home-hero') !== null && document.querySelector('.tonight-section') !== null`
      );
      // De selectie draait in de browser ná de eerste meting; even wachten tot
      // de lijst er echt staat.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const state = await evalJs(cdp, SECTION_JS);
      await shot(cdp, `be38-${moment.id}-${width}-${theme}.png`, { focus: width < 720 ? '.tonight-section' : null });
      record.screens.push({ theme, width });
      if (!record.state) record.state = state;

      check(`BE-38 ${moment.id} ${theme} ${width}px: thema toegepast`, state.theme === theme, state.theme);
      check(`BE-38 ${moment.id} ${theme} ${width}px: geen horizontale overloop`, state.overflow <= 1, `overflow=${state.overflow}`);
      check(
        `BE-38 ${moment.id} ${theme} ${width}px: tabbar ${width <= 720 ? 'zichtbaar' : 'verborgen'}`,
        state.tabbar === null || state.tabbar === (width <= 720),
        String(state.tabbar)
      );
    }
  }

  const state = record.state;
  check(`BE-38 ${moment.id}: de sectie staat er`, state.present, JSON.stringify({ mode: state.mode, title: state.title }));
  check(`BE-38 ${moment.id}: modus "${moment.mode}"`, state.mode === moment.mode, state.mode);
  check(`BE-38 ${moment.id}: menutype "${moment.meal}"`, state.meal === moment.meal, state.meal);
  check(`BE-38 ${moment.id}: titel ${moment.title}`, moment.title.test(state.title || ''), state.title);
  check(
    `BE-38 ${moment.id}: de "Alles"-link volgt het getoonde menutype`,
    state.allLink === `/search?meal=${moment.meal}`,
    state.allLink
  );
  check(
    `BE-38 ${moment.id}: precies drie gerechten met een echte prijs`,
    state.cards.length === 3 && state.cards.every((card) => card.price && !/op aanvraag/i.test(card.price)),
    JSON.stringify(state.cards.map((card) => card.price))
  );
  check(
    `BE-38 ${moment.id}: één gerecht per restaurant`,
    new Set(state.cards.map((card) => card.restaurant)).size === state.cards.length,
    JSON.stringify(state.cards.map((card) => card.restaurant))
  );
  check(
    `BE-38 ${moment.id}: de klik opent de menukaart op het gerecht`,
    state.cards.every((card) => /\/menu\/[^?]+\?dish=.*#gerecht-/.test(card.href || '')),
    JSON.stringify(state.cards.map((card) => card.href))
  );

  if (moment.expectOpensLabel) {
    check(
      `BE-38 ${moment.id}: elk gerecht noemt "Opent om HH:MM"`,
      state.cards.every((card) => card.labels.some((label) => /Opent om \d{2}:\d{2}/.test(label || ''))),
      JSON.stringify(state.cards.map((card) => card.labels))
    );
    check(
      `BE-38 ${moment.id}: geen "Nu open" bij de terugval`,
      state.openLabels.filter((label) => /Nu open/.test(label || '')).length === 0,
      JSON.stringify(state.openLabels)
    );
    check(
      `BE-38 ${moment.id}: elk gerecht draagt het labelpaar van de terugval`,
      state.laterLabels.length === 3,
      JSON.stringify(state.laterLabels)
    );
  }

  if (moment.expectOpenLabel) {
    check(
      `BE-38 ${moment.id}: "Nu open" alleen bij wat nu echt open is`,
      state.openLabels.length >= 1 && state.openLabels.every((label) => /Nu open/.test(label || '')),
      JSON.stringify(state.openLabels)
    );
    check(
      `BE-38 ${moment.id}: geen enkel gerecht noemt een openingstijd`,
      state.laterLabels.length === 0,
      JSON.stringify(state.laterLabels)
    );
  }

  if (moment.mode === 'later') {
    const times = state.cards
      .flatMap((card) => card.labels.map((label) => (/Opent om (\d{2}:\d{2})/.exec(label || '') || [])[1]))
      .filter(Boolean)
      .sort();
    const titleTime = (/vanaf (\d{2}:\d{2})/.exec(state.title || '') || [])[1];
    check(
      `BE-38 ${moment.id}: "vanaf" in de titel is het vroegste moment van de getoonde gerechten`,
      Boolean(titleTime) && titleTime === times[0],
      `titel ${titleTime} vs gerechten ${JSON.stringify(times)}`
    );
  }

  moments.push(record);
  return record;
}

// ── de server-HTML mag niets van de klok bevatten ──────────────────────────
async function serverHtmlScenario() {
  const html = await (await fetch(`${APP}/`)).text();
  for (const [label, forbidden] of [
    ['"Nu open"', 'Nu open'],
    ['een daghap', 'Daghap'],
    ['de moment-sectie', 'tonight-section'],
    ['de terugvaltitel "Straks op de kaart"', 'Straks op de kaart'],
    ['de terugvaltitel "Morgen op de kaart"', 'Morgen op de kaart'],
  ]) {
    check(`BE-38 server-HTML: geen ${label}`, !html.includes(forbidden), `${html.length} bytes`);
  }
  return { bytes: html.length };
}

// BE-43 (#101): elk scenario is één benoemde stap. Met `--alleen=<naam>` draait
// alleen die stap; met `--lijst` zie je de namen zonder dat er iets start.
// Zonder vlag draait alles in deze volgorde, precies zoals voorheen.
const CHECK_SCENARIOS = [
  {
    name: 'server-html',
    run: async () => {
      serverHtmlEvidence = await serverHtmlScenario();
    },
  },
  ...MOMENTS.map((moment) => ({ name: `moment-${moment.id}`, run: (cdp) => momentScenario(cdp, moment) })),
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), CHECK_SCENARIOS);
// Een gefilterde run schrijft nooit naar het volledige bewijsbestand.
const EVIDENCE_PATH = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);

async function main() {
  // BE-43 (#101): `--lijst` toont alleen de namen en `--alleen=<naam>` draait
  // de keuze. Een onbekende naam is een gebruiks fout: er start niets.
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: CHECK_SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  if (!fs.existsSync(PRODUCTION_BUILD)) {
    throw new Error(`production_build_missing: run the build first (${path.relative(REPO_ROOT, PRODUCTION_BUILD)})`);
  }

  let server = null;
  let browser = null;
  let cdp = null;
  let serverHtml = null;
  try {
    console.log(`starting the production build on ${APP}`);
    server = await startProductionServer();
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);

    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // BE-43 (#101): alleen de gekozen scenario's, elk met één regel uitvoer.
    scenarioRuns = await runScenarioSelection({ entries: CHECK_SCENARIOS, checks, cdp, filter: SELECTION.filter });
    serverHtml = serverHtmlEvidence;

    await setFixedClock(cdp, null);

    const failed = checks.filter((entry) => entry.passed === false);
    const record = {
      generatedAt: new Date().toISOString(),
      kind: 'developer evidence — local production build, fixed browser clock, no production data or credentials',
      contract: '#90 BE-38 (Straks op de kaart / Morgen op de kaart)',
      app: APP,
      // BE-43 (#101): een gefilterde run noemt zijn keuze en is nooit het volledige bewijs.
      filter: SELECTION.filter,
      scenarios: scenarioRuns,
      fixedDay: '2026-10-23 (vrijdag, Europe/Amsterdam, UTC+2)',
      serverHtml,
      moments,
      checks: { total: checks.length, failed: failed.length, entries: checks },
      screenshots: shots,
      result: failed.length === 0 ? 'passed' : 'failed',
    };
    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          result: record.result,
          checks: checks.length,
          failed: failed.length,
          screenshots: shots.length,
          out: path.relative(REPO_ROOT, EVIDENCE_PATH),
        },
        null,
        2
      )
    );
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // Een vergrendeld tijdelijk profiel is onschadelijk; het staat buiten de repo.
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
