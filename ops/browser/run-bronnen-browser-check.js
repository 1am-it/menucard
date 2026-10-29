'use strict';

// BE-31 (#74) — fixture browser check for "Bronnen beoordelen" (screens 1-7 of
// the approved mockup "Bronnen beoordelen v2"), at 1280, 390 and 320 px in light
// and dark.
//
// It drives the real routes and the real components in a local `next dev` with a
// fictional in-page session and fictional API answers
// (fixtures/bronnenFixtures.js). FIXTURE EVIDENCE: not live integration, not
// production acceptance, and no production credential, identity or data is used.
//
// What it shows: the task list with real chip numbers, the detail only after a
// task is chosen, the empty state with only the link to Dekking, a telephone
// where a task opens as its own screen, Dekking's "Nog niet gecontroleerd" rows
// with their reasons, the same result rows under the add form, and one next step
// per row state. Screenshots go to ops/browser/output/be-31/.

const fs = require('node:fs');
const path = require('node:path');

const { fixtureBootstrap } = require('./lib/fixture-page');
const baseFixtures = require('./fixtures/menuReviewFixtures').scenarios;
const { SCENARIOS, BATCH_ID } = require('./fixtures/bronnenFixtures');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const {
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const OUT_DIR = path.join(__dirname, 'output', 'be-31');
// The screenshots are also kept next to the evidence JSON, so the reviewable
// proof travels with the branch instead of only living in a git-ignored folder.
const SHOTS_DIR = path.join(__dirname, 'evidence', 'be-31');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'bronnen-browser-evidence.json');
const SCRIPT_NAME = 'run-bronnen-browser-check.js';
const PORT = Number(process.env.BRONNEN_FIXTURE_PORT || 3139);
const APP = `http://localhost:${PORT}`;
const START_URL = `${APP}/internal/bronnen`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const FIXTURES = { ...baseFixtures, ...SCENARIOS };

const checks = [];
const shots = [];
let viewport = { width: 1280, height: 900 };
let scenarioRuns = null;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

function flatText(value) {
  return String(value === undefined || value === null ? '' : value).split(/\s+/).filter(Boolean).join(' ');
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

async function shot(cdp, name, meta = {}) {
  const file = await screenshot(cdp, OUT_DIR, name);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.copyFileSync(path.join(OUT_DIR, name), path.join(SHOTS_DIR, name));
  shots.push({ ...file, viewport: `${viewport.width}x${viewport.height}`, ...meta });
  return file;
}

async function open(cdp, url, readyExpression) {
  await navigate(cdp, url, readyExpression);
  const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
  check(`fixture bootstrap without error (${url})`, !bootError, bootError || 'ok');
}

async function readBronnen(cdp) {
  return evalJs(cdp, `(() => {
    const chips = [...document.querySelectorAll('.brn-chip')].map((b) => ({
      label: b.innerText.trim(),
      pressed: b.getAttribute('aria-pressed'),
    }));
    const tasks = [...document.querySelectorAll('.brn-task')].map((b) => ({
      name: (b.querySelector('.brn-task-name') || {}).textContent || '',
      kind: (b.querySelector('.brn-task-kind') || {}).textContent || '',
      what: (b.querySelector('.brn-task-what') || {}).textContent || '',
      status: (b.querySelector('.brn-task-status') || {}).textContent || '',
      current: b.getAttribute('aria-current'),
    }));
    const detail = document.getElementById('brn-detail');
    return {
      title: (document.querySelector('h1') || {}).textContent || '',
      subtitle: (document.querySelector('.brn-subtitle') || {}).textContent || '',
      chips,
      tasks,
      detailText: detail ? detail.innerText : '',
      detailEmpty: Boolean(document.querySelector('.brn-detail-empty')),
      listVisible: (() => { const l = document.querySelector('.brn-list'); return l ? l.offsetParent !== null : false; })(),
      backVisible: (() => { const b = document.querySelector('.brn-back'); return b ? b.offsetParent !== null : false; })(),
      emptyTitle: (document.querySelector('.brn-empty-title') || {}).textContent || null,
      emptyLinks: [...document.querySelectorAll('.brn-empty a')].map((a) => a.getAttribute('href')),
      rows: [...document.querySelectorAll('.srr-row')].map((row) => ({
        state: row.className,
        name: (row.querySelector('.srr-name') || {}).textContent || '',
        outcome: (row.querySelector('.srr-badge') || {}).textContent || '',
        action: ((row.querySelector('.srr-action') || row.querySelector('.srr-wait') || {}).textContent || '').trim(),
        href: (row.querySelector('a.srr-action') || {}).getAttribute
          ? (row.querySelector('a.srr-action') || {}).getAttribute('href')
          : null,
      })),
      barText: (document.querySelector('nav.internal-nav') || {}).innerText || '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      theme: document.documentElement.getAttribute('data-theme'),
    };
  })()`);
}

async function clickTask(cdp, index = 0) {
  return evalJs(cdp, `(() => {
    const tasks = [...document.querySelectorAll('.brn-task')];
    if (!tasks[${index}]) return false;
    tasks[${index}].click();
    return true;
  })()`);
}

function writeEvidence(extra) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const record = {
    generatedAt: new Date().toISOString(),
    kind: 'fixture-browser-check',
    task: 'BE-31 (#74) Bronnen beoordelen, Dekking en afhandelen in de rij',
    base: 'fix/bronnen-74-echt-werk',
    port: PORT,
    screenshotsDir: 'ops/browser/evidence/be-31',
    screenshots: shots,
    // BE-43 (#101): een gefilterde run noemt zijn keuze en is nooit het volledige bewijs.
    filter: SELECTION.filter,
    scenarios: scenarioRuns,
    checks,
    passed: checks.length > 0 && checks.every((entry) => entry.passed),
    ...extra,
  };
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(record, null, 2));
  return record;
}

const EXPECTED_CHIPS = ['Alles 3', '🧪 Batches 1', '💡 Voorstellen 1', '📡 Aandacht 1'];
const EXPECTED_STEPS = ['✅ Bevestig bron', '⚠️ Menukopjes controleren', '📖 Lees met AI', '✍️ Handmatig toevoegen', '⏳ Even wachten'];

async function bronnenScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 900 : 844);
  const query = `theme=${theme}&fixture=bronnen&navCounts=bronnen`;
  await open(cdp, `${START_URL}?${query}`, `document.body.innerText.includes('Bronnen beoordelen')`);
  const listReady = await waitFor(cdp, `document.querySelectorAll('.brn-task').length === 3`, 45000);
  check(`scherm 1 (${width}/${theme}): three real tasks render`, listReady);
  const list = await readBronnen(cdp);

  check(
    `scherm 1 (${width}/${theme}): the chips carry the real numbers`,
    JSON.stringify(list.chips.map((chip) => chip.label)) === JSON.stringify(EXPECTED_CHIPS),
    JSON.stringify(list.chips.map((chip) => chip.label)),
  );
  check(
    `scherm 1 (${width}/${theme}): the batch, the proposal and the attention source are the tasks`,
    JSON.stringify(list.tasks.map((task) => task.kind)) === JSON.stringify(['Batch', 'Voorstel', 'Bron vraagt aandacht']),
    JSON.stringify(list.tasks.map((task) => task.kind)),
  );
  check(
    `scherm 1 (${width}/${theme}): the detail waits for a choice`,
    list.detailEmpty && flatText(list.detailText).includes('Kies een taak links'),
    list.detailText,
  );
  check(
    `teller (${width}/${theme}): the Werkvoorraad number equals the number of tasks`,
    (flatText(list.barText).includes('Werkvoorraad (3)') || flatText(list.barText).includes('Werk (3)')) && list.tasks.length === 3,
    flatText(list.barText).slice(0, 120),
  );
  check(`theme (${width}/${theme}): the requested theme is active`, list.theme === theme, list.theme);
  check(`geen overloop (${width}/${theme}): no horizontal overflow`, list.overflow <= 0, `overflow=${list.overflow}`);
  // Lead review #6439131777: one task per restaurant, its age visible, and the
  // cleanup action with its own selection.
  check(
    `scherm 1 (${width}/${theme}): one task per restaurant, titled with the restaurant name`,
    list.tasks.length === 3 &&
      list.tasks.filter((task) => task.name === 'Fictief Restaurant Smelt').length === 1 &&
      list.tasks.every((task) => !/[0-9]+\s+restaurants/.test(task.name)),
    JSON.stringify(list.tasks.map((task) => task.name)),
  );
  const batchTask = list.tasks.find((task) => task.kind === 'Batch');
  check(
    `scherm 1 (${width}/${theme}): the age of the newest result is shown`,
    Boolean(batchTask) && /resultaat van \d+ dagen geleden/.test(batchTask.what),
    batchTask && batchTask.what,
  );
  check(
    `scherm 1 (${width}/${theme}): the cleanup action names what it will close ("Alle N opruimen")`,
    await evalJs(cdp, `(() => {
      const buttons = [...document.querySelectorAll('.brn-toolbar button')].map((b) => b.innerText.trim());
      const picks = document.querySelectorAll('.brn-tasks input[type="checkbox"]').length;
      return { buttons, picks };
    })()`).then((value) => value.buttons.some((label) => /Alle \d+ opruimen$/.test(label)) && value.picks === 1),
  );
  await shot(cdp, `be31-scherm1-${width}-${theme}.png`, { screen: 1, theme, fixture: 'bronnen' });

  // The one confirmation names the number of results it closes.
  const clickedCleanup = await evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('.brn-toolbar button')].find((b) => b.innerText.includes('opruimen'));
    if (button) button.click();
    return Boolean(button);
  })()`);
  await waitFor(cdp, `Boolean(document.querySelector('.brn-cleanup-confirm'))`, 5000);
  const cleanup = await evalJs(cdp, `(() => {
    const box = document.querySelector('.brn-cleanup-confirm');
    const hint = document.querySelector('.brn-toolbar .brn-hint');
    return box ? box.innerText.replace(/\\n/g, ' ') : ('geen bevestiging; klik=' + ${JSON.stringify(String(clickedCleanup))} + '; hint=' + (hint ? hint.innerText : ''));
  })()`);
  check(
    `scherm 1 (${width}/${theme}): the cleanup confirmation names the number and deletes nothing`,
    cleanup.includes('Alle 7 resultaten afhandelen?') && cleanup.toLowerCase().includes('niets gewist'),
    cleanup,
  );
  await evalJs(cdp, `(() => {
    const cancel = [...document.querySelectorAll('.brn-cleanup-actions button')].find((b) => b.innerText.trim() === 'Annuleren');
    if (cancel) cancel.click();
    return true;
  })()`);

  const clicked = await clickTask(cdp, 0);
  check(`scherm 2 (${width}/${theme}): the batch task can be chosen`, clicked);
  const rowsReady = await waitFor(cdp, `document.querySelectorAll('.srr-row').length === 5`, 20000);
  check(`scherm 2 (${width}/${theme}): the batch detail shows its rows`, rowsReady);
  const chosen = await readBronnen(cdp);
  const picked = chosen.tasks.find((task) => task.current === 'true');
  check(`scherm 2 (${width}/${theme}): the chosen task is programmatically current`, Boolean(picked), JSON.stringify(picked || null));
  check(
    `scherm 2 (${width}/${theme}): the task summary shows the age of its newest result`,
    chosen.detailText.includes('Resultaat van') && chosen.detailText.includes('dagen geleden'),
    chosen.detailText.slice(0, 200),
  );

  const steps = chosen.rows.map((row) => row.action).filter(Boolean);
  check(
    `scherm 2 (${width}/${theme}): exactly one next step per row state`,
    EXPECTED_STEPS.every((step, index) => steps[index] === step) && steps.length === 5,
    JSON.stringify(steps),
  );
  const menukopjes = chosen.rows.find((row) => row.action.includes('Menukopjes controleren'));
  check(
    `scherm 2 (${width}/${theme}): twijfel opens the BE-30 screen of the same batch item`,
    Boolean(menukopjes) && menukopjes.href.includes(`/internal/bronnen/batch?batch=${BATCH_ID}`) && menukopjes.href.includes('item=2'),
    menukopjes && menukopjes.href,
  );
  const aiRead = chosen.rows.find((row) => row.action.includes('Lees met AI'));
  check(
    `scherm 2 (${width}/${theme}): no menu reuses the existing AI reading link`,
    Boolean(aiRead) && aiRead.href.startsWith('/internal/menu-import?'),
    aiRead && aiRead.href,
  );
  const manual = chosen.rows.find((row) => row.action.includes('Handmatig toevoegen'));
  check(
    `scherm 2 (${width}/${theme}): a blocked result goes to the existing manual import`,
    Boolean(manual) && manual.href.startsWith('/internal/menu-import'),
    manual && manual.href,
  );
  if (width < 600) {
    check(`scherm 6 (${width}/${theme}): a chosen task is its own screen on a telephone`, !chosen.listVisible && chosen.backVisible, JSON.stringify({ list: chosen.listVisible, back: chosen.backVisible }));
    await shot(cdp, `be31-scherm6-${width}-${theme}.png`, { screen: 6, theme });
  } else {
    check(`scherm 2 (${width}/${theme}): the list stays next to the detail`, chosen.listVisible && !chosen.backVisible, JSON.stringify({ list: chosen.listVisible }));
    await shot(cdp, `be31-scherm2-${width}-${theme}.png`, { screen: 2, theme });
    if (theme === 'dark') await shot(cdp, `be31-scherm4-${width}-dark.png`, { screen: 4, theme });
    return;
  }
  await shot(cdp, `be31-scherm2-${width}-${theme}.png`, { screen: 2, theme });
  if (theme === 'dark') await shot(cdp, `be31-scherm4-${width}-dark.png`, { screen: 4, theme });
}

async function emptyScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 800 : 844);
  await open(
    cdp,
    `${START_URL}?theme=${theme}&fixture=bronnenLeeg&navCounts=leeg`,
    `document.body.innerText.includes('Bronnen beoordelen')`,
  );
  const ready = await waitFor(cdp, `Boolean(document.querySelector('.brn-empty-title'))`, 30000);
  check(`scherm 3 (${width}/${theme}): the empty state renders`, ready);
  const state = await readBronnen(cdp);
  check(
    `scherm 3 (${width}/${theme}): only "Geen open bronwerk" with the link to Dekking`,
    flatText(state.emptyTitle) === '✅ Geen open bronwerk' &&
      state.emptyLinks.includes('/internal/coverage') &&
      state.chips.length === 0 &&
      !state.detailText &&
      state.tasks.length === 0,
    JSON.stringify({ title: state.emptyTitle, links: state.emptyLinks, chips: state.chips.length }),
  );
  check(
    `teller-leeg (${width}/${theme}): the bar's number also drops to 0`,
    flatText(state.barText).includes('Werkvoorraad (0)') || flatText(state.barText).includes('Werk (0)'),
    flatText(state.barText).slice(0, 80),
  );
  await shot(cdp, `be31-scherm3-${width}-${theme}.png`, { screen: 3, theme });
}

async function coverageScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 1000 : 844);
  await open(
    cdp,
    `${APP}/internal/coverage?theme=${theme}&fixture=bronnen&navCounts=bronnen`,
    `document.body.innerText.includes('Nog niet gecontroleerd')`,
  );
  const ready = await waitFor(cdp, `document.querySelectorAll('.cov-check-table tbody tr').length === 4`, 45000);
  check(`scherm 5 (${width}/${theme}): "Nog niet gecontroleerd" lists the restaurants without a check`, ready);
  const section = await evalJs(cdp, `(() => {
    document.querySelector('.cov-check').scrollIntoView({ block: 'start' });
    const rows = [...document.querySelectorAll('.cov-check-table tbody tr')].map((tr) => ({
      text: tr.innerText.replace(/\\n/g, ' | '),
      checkable: !(tr.querySelector('input[type="checkbox"]') || {}).disabled,
      action: ((tr.querySelector('.cov-check-action') || {}).textContent || '').trim(),
      recheck: ((tr.querySelector('.cov-check-recheck') || {}).textContent || '').trim(),
    }));
    return {
      heading: (document.querySelector('.cov-check-title') || {}).textContent || '',
      button: (document.querySelector('#cov-check-title') && document.querySelector('#cov-check-title').parentElement.querySelector('.di-btn-primary') || {}).textContent || '',
      meta: (document.querySelector('.cov-check-meta') || {}).textContent || '',
      rows,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check(`scherm 5 (${width}/${theme}): the heading counts the real rows`, flatText(section.heading) === 'Nog niet gecontroleerd (4)', section.heading);
  check(
    `scherm 5 (${width}/${theme}): the existing reason texts are shown`,
    ['Nog nooit gecontroleerd', 'Geen website bekend', 'Laatste controle gaf geen bruikbaar resultaat', 'Controle loopt nog'].every(
      (reason) => section.rows.some((row) => row.text.includes(reason)),
    ),
    JSON.stringify(section.rows.map((row) => row.text)),
  );
  check(
    `scherm 5 (${width}/${theme}): every row with a website offers its fitting step`,
    section.rows.filter((row) => row.action === '🔎 Controleer bron').length === 2 &&
      section.rows.some((row) => row.text.includes('Geen automatische controle mogelijk')) &&
      section.rows.some((row) => row.action === '✍️ Handmatig toevoegen'),
    JSON.stringify(section.rows.map((row) => row.action)),
  );
  // Lead review #6439131777: a dead end is listed here, with its own outcome,
  // its age and the existing reason text — and with its own next step.
  const deadEnd = section.rows.find((row) => row.text.includes('Fictief Klein Java'));
  check(
    `scherm 5 (${width}/${theme}): the dead end shows its outcome, age and reason`,
    Boolean(deadEnd) &&
      deadEnd.text.includes('Laatste controle gaf geen bruikbaar resultaat') &&
      deadEnd.text.includes('Geen bruikbaar resultaat') &&
      /resultaat van [0-9]+ dagen geleden/.test(deadEnd.text) &&
      deadEnd.action === '✍️ Handmatig toevoegen' &&
      deadEnd.recheck === 'Opnieuw controleren',
    JSON.stringify(deadEnd || null),
  );
  check(
    `scherm 5 (${width}/${theme}): the existing limits and "loopt zolang de pagina open is" are stated`,
    flatText(section.meta).includes('Maximaal 10 per controle') && flatText(section.meta).includes('alleen zolang deze pagina open is'),
    section.meta,
  );
  check(`scherm 5 (${width}/${theme}): no horizontal overflow`, section.overflow <= 0, `overflow=${section.overflow}`);
  // Selection drives the one explicit button: "Controleer N geselecteerde".
  await evalJs(cdp, `(() => { const box = document.querySelector('.cov-check-table tbody tr input[type="checkbox"]:not([disabled])'); if (box) box.click(); return true; })()`);
  const selected = await evalJs(cdp, `(() => { const title = document.querySelector('#cov-check-title'); const head = title ? title.parentElement : null; const button = head ? head.querySelector('.di-btn-primary') : null; return button ? button.textContent : ''; })()`);
  check(`scherm 5 (${width}/${theme}): selecting a row updates the count`, flatText(selected) === '🔎 Controleer 1 geselecteerde', selected);
  await shot(cdp, `be31-scherm5-${width}-${theme}.png`, { screen: 5, theme });
}

async function addScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 900 : 844);
  await open(
    cdp,
    `${APP}/internal/toevoegen?theme=${theme}&fixture=bronnenToevoegen&navCounts=bronnen&batch=${BATCH_ID}`,
    `document.body.innerText.includes('Restaurant of menu toevoegen')`,
  );
  const ready = await waitFor(cdp, `document.querySelectorAll('.srr-row').length === 5`, 45000);
  check(`scherm 7 (${width}/${theme}): the result appears under the form as the same rows`, ready);
  const page = await readBronnen(cdp);
  const steps = page.rows.map((row) => row.action).filter(Boolean);
  check(
    `scherm 7 (${width}/${theme}): the same one next step per row`,
    JSON.stringify(steps) === JSON.stringify(EXPECTED_STEPS),
    JSON.stringify(steps),
  );
  check(
    `scherm 7 (${width}/${theme}): the form stays available above the result`,
    await evalJs(cdp, `Boolean(document.getElementById('add-urls')) && Boolean(document.getElementById('add-result-title'))`),
  );
  check(`scherm 7 (${width}/${theme}): no horizontal overflow`, page.overflow <= 0, `overflow=${page.overflow}`);
  await shot(cdp, `be31-scherm7-${width}-${theme}.png`, { screen: 7, theme });
}


async function warmUp(cdp) {
  await setViewport(cdp, 1280, 900);
  await open(cdp, `${START_URL}?theme=light&fixture=bronnen&navCounts=bronnen`, `document.body.innerText.includes('Bronnen beoordelen')`);
  const ready = await waitFor(cdp, `document.querySelectorAll('.brn-task').length === 3`, 120000);
  check('warm-up: the route compiles and the task list renders', ready);
}

// BE-43 (#101): elk scenario is één benoemde stap. Met `--alleen=<naam>` draait
// alleen die stap; met `--lijst` zie je de namen zonder dat er iets start.
// Zonder vlag draait alles, in dezelfde volgorde en met dezelfde controles.
const CHECK_SCENARIOS = [
  {
    name: 'scherm-1-4-6',
    run: async (cdp) => {
      for (const theme of ['light', 'dark']) {
        for (const width of [1280, 390, 320]) await bronnenScenario(cdp, width, theme);
      }
    },
  },
  {
    name: 'scherm-3',
    run: async (cdp) => {
      for (const theme of ['light', 'dark']) {
        for (const width of [1280, 390, 320]) await emptyScenario(cdp, width, theme);
      }
    },
  },
  {
    name: 'scherm-5',
    run: async (cdp) => {
      for (const theme of ['light', 'dark']) {
        for (const width of [1280, 390, 320]) await coverageScenario(cdp, width, theme);
      }
    },
  },
  {
    name: 'scherm-7',
    run: async (cdp) => {
      for (const theme of ['light', 'dark']) {
        for (const width of [1280, 390, 320]) await addScenario(cdp, width, theme);
      }
    },
  },
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

  const watchdog = setTimeout(() => {
    try {
      writeEvidence({ error: 'run_timeout (12 min)' });
    } catch (ignored) {
      // Best effort inside the watchdog.
    }
    process.exit(2);
  }, 12 * 60 * 1000);
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
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: '/internal/bronnen' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const networkGuard = createNetworkGuard({ appOrigins: APP_ORIGINS, baseUrl: START_URL });
    await enableFetchGuard(cdp, networkGuard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureBootstrap(FIXTURES, { appOrigins: APP_ORIGINS, baseUrl: START_URL }),
    });

    console.log('warm-up: compiling the route and the APIs');
    await warmUp(cdp);
    // BE-43 (#101): alleen de gekozen scenario's, elk met één regel uitvoer.
    scenarioRuns = await runScenarioSelection({ entries: CHECK_SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    check('network guard: the page recorded no blocked app traffic', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
    const guardViolations = networkGuard.appViolations();
    check('network guard: the CDP layer recorded no blocked app traffic', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('no uncaught browser exception', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));
    const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
    check('no fixture bootstrap error at the end', !bootError, bootError || 'ok');

    const record = writeEvidence({ network: { pageViolations, guardViolations } });
    console.log(
      JSON.stringify(
        {
          passed: record.passed,
          checks: checks.length,
          failed: checks.filter((entry) => !entry.passed).length,
          screenshots: shots.length,
          evidence: EVIDENCE_PATH,
        },
        null,
        2,
      ),
    );
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
        // A locked temporary profile stays outside the repo.
      }
    }
  }
}

main();
