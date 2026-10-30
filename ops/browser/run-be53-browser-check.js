'use strict';

// BE-53 (#130) — browserbewijs voor "menukopje wijzigen" in
// /internal/menu-concepts/[id], tab Wijzigingen, sectie Structuur.
//
// Dit script start de echte app (`next dev`) op een lokale poort, bestuurt een
// lokaal geïnstalleerde Edge/Chrome via CDP en onderschept alleen de fictieve
// concept-leesroutes plus één fictieve schrijfroute: POST
// /api/internal/v1/menu-concepts/<id>/versions, exact voor het fictieve id van
// deze check. Die route antwoordt met de nieuwe versie uit de fixture; de
// verstuurde edits worden in localStorage bewaard zodat dit script kan bewijzen
// wat de browser werkelijk postte. De rest van de schrijf- en exportroutes
// blijft geweigerd (ops/browser/lib/network-policy.js).
//
// Bewezen wordt, in licht en donker op 1280 en 390 px: Wijzig opent een gelabeld
// tekstveld met de huidige naam, een lege of ongewijzigde naam geeft een
// melding, "Opslaan in deze correctie" hernoemt het menukopje (met de oude naam
// doorgestreept), "Ongedaan maken" draait dat terug, opnieuw wijzigen werkt en
// "Correcties opslaan als versie 2" maakt de nieuwe versie, die in het
// Publicatievoorbeeld de nieuwe kopjesnaam toont. Bediening gaat met het
// toetsenbord (Enter, Tab, Escape) en zichtbare focus wordt gemeten.
//
// Dit is fixture-evidence op een lokale machine: geen productie, geen echte
// Supabase-sessie, geen merge en geen publicatie. Geen onafhankelijke review.
//
// Gebruik:
//   node ops/browser/run-be53-browser-check.js [--lijst | --alleen=<naam>]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const fixtures = require('./fixtures/menuReviewFixtures');
const { fixtureBootstrap } = require('./lib/fixture-page');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins, FIXTURE_API_ROUTES } = require('./lib/network-policy');
const { REPO_ROOT, findBrowser, killTree, startServer, startBrowser, evalJs, navigate, pressKey } = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const SCRIPT_NAME = 'run-be53-browser-check.js';
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be53-browser-evidence.json');
const OUT_DIR = path.join(__dirname, 'output', 'be-53');
// Een poort uit 3190-3199 (ontwikkelaarsopdracht BE-53).
const PORT = Number(process.env.BROWSER_FIXTURE_PORT || 3193);
const APP_ORIGINS = defaultAppOrigins(PORT);
const CONCEPTS_URL = `http://localhost:${PORT}/internal/menu-concepts`;
const FIXTURE = 'concepts-section-rename';
const THEMES = ['light', 'dark'];
const WIDTHS = [1280, 390];
const SECTION = fixtures.RENAME_SECTION;
const NEW_NAME = fixtures.RENAME_NEW;
const OLD_ID = fixtures.RENAME_IDS.v1;
const NEW_ID = fixtures.RENAME_IDS.v2;
const STORAGE_KEY = 'be53-version-posts';
const EMPTY_NAME_MESSAGE = 'Vul een naam voor dit menukopje in.';
const UNCHANGED_NAME_MESSAGE = 'Dit is al de naam van dit menukopje.';

// De bestaande regels plus precies één fictieve schrijfroute, alleen voor dit
// fictieve concept-id. De gedeelde standaardlijst blijft ongewijzigd.
const FIXTURE_ROUTES = [
  ...FIXTURE_API_ROUTES,
  {
    id: 'menu-concepts-versions',
    match: 'exact',
    path: `/api/internal/v1/menu-concepts/${OLD_ID}/versions`,
    methods: ['POST'],
  },
];

const checks = [];
const screenshots = [];
const savedVersions = [];
let scenarioRuns = null;
let network = null;

function check(name, passed, detail) {
  const entry = { name, passed: Boolean(passed), detail: detail === undefined || detail === null ? null : String(detail) };
  checks.push(entry);
  if (!entry.passed) console.log(`FAIL ${name}${entry.detail ? ` — ${entry.detail}` : ''}`);
  return entry.passed;
}

function conceptUrl({ id, theme }) {
  const params = new URLSearchParams({ fixture: FIXTURE, theme });
  return `${CONCEPTS_URL}/${encodeURIComponent(id)}?${params.toString()}`;
}

async function setViewport(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: width >= 1280 ? 900 : 844,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

/** The whole page at the current width, so the whole structure card is visible. */
async function shot(cdp, name) {
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize || metrics.contentSize;
  const width = Math.max(1, Math.min(4000, Math.ceil(content.width)));
  const height = Math.max(1, Math.min(4000, Math.ceil(content.height)));
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const buffer = Buffer.from(result.data, 'base64');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), buffer);
  const entry = {
    file: `be-53/${name}`,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
  screenshots.push(entry);
  return entry;
}

const escapeJs = (value) => JSON.stringify(String(value));

/** The state of the rename control and the section list, read from the real DOM. */
const STATE_JS = `(() => {
  const form = document.querySelector('.mcr-rename');
  const input = form ? form.querySelector('input') : null;
  const active = document.activeElement;
  const outline = active ? getComputedStyle(active).outline : null;
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    rows: [...document.querySelectorAll('.bta-structure li')].map((li) => (li.innerText || '').trim()),
    renameButtons: document.querySelectorAll('.mcr-rename-open').length,
    undoButtons: [...document.querySelectorAll('.bta-structure button')].filter((b) => (b.innerText || '').includes('Ongedaan maken')).length,
    fieldOpen: Boolean(form),
    label: input && input.labels && input.labels.length > 0 ? input.labels[0].innerText.trim() : null,
    value: input ? input.value : null,
    invalid: input ? input.getAttribute('aria-invalid') : null,
    hint: (document.getElementById(input ? input.getAttribute('aria-describedby') : '') || {}).innerText || null,
    saveVersionButton: (() => {
      const button = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Correcties opslaan als versie'));
      return button ? { text: button.innerText.trim(), ariaDisabled: button.getAttribute('aria-disabled') } : null;
    })(),
    active: active ? { tag: active.tagName, text: (active.innerText || '').trim().slice(0, 90), value: active.value || null, outlineWidth: outline ? outline.width : null, outlineStyle: outline ? outline.style : null } : null,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    version: (document.body.innerText.match(/conceptversie (\\d+)/) || [])[1] || null,
  };
})()`;

const state = (cdp) => evalJs(cdp, STATE_JS);

/** Open the closed "Structuur" card through its own summary (a real click). */
async function openStructure(cdp) {
  return evalJs(
    cdp,
    `(() => {
      const details = [...document.querySelectorAll('details.bta-category')].find((el) => {
        const summary = el.querySelector('summary');
        return summary && (summary.innerText || '').trim().startsWith('Structuur');
      });
      if (!details) return false;
      if (!details.open) details.querySelector('summary').click();
      return details.open && Boolean(details.querySelector('.bta-structure'));
    })()`
  );
}

/** Focus the first control whose visible text contains `text`. */
const focusByText = (cdp, selector, text) =>
  evalJs(
    cdp,
    `(() => {
      const el = [...document.querySelectorAll(${escapeJs(selector)})].find((e) => (e.innerText || '').trim().includes(${escapeJs(text)}));
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    })()`
  );

/** Real keyboard input: one keyDown/keyUp per character with its text. */
async function typeText(cdp, text) {
  for (const character of text) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: character, text: character });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: character });
  }
}

async function selectAll(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function navigateToNewVersion(cdp) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const url = await evalJs(cdp, 'location.pathname');
    const version = await evalJs(cdp, '(document.body.innerText.match(/conceptversie (\\d+)/) || [])[1] || null');
    if (url && url.includes(NEW_ID) && version === '2') {
      await sleep(250);
      return true;
    }
    await sleep(200);
  }
  return false;
}

/** One full correction round on one theme/width: rename, undo, rename, save. */
async function correctionRound(cdp, { theme, width }) {
  const label = `${width}px/${theme}`;
  await setViewport(cdp, width);
  await navigate(cdp, conceptUrl({ id: OLD_ID, theme }), 'document.body.innerText.includes("Beoordeel menuconcept") && Boolean(document.querySelector(".mcr-page"))');
  const opened = await openStructure(cdp);
  const before = await state(cdp);
  check(`BE-53 ${label}: de Structuur-lijst met de bestaande menukopjes staat open`, opened && before.rows.length === 2, String(opened));
  check(`BE-53 ${label}: elk menukopje krijgt een knop Wijzig`, before.renameButtons === 2, String(before.renameButtons));
  check(`BE-53 ${label}: het lange kopje uit het voorbeeld staat in de lijst`, before.rows.some((row) => row.includes(SECTION)), JSON.stringify(before.rows));
  check(`BE-53 ${label}: geen horizontale overloop met de Wijzig-knoppen`, before.overflow <= 0, String(before.overflow));

  // Keyboard: focus "Wijzig" and press Enter — the field must open with the
  // current name, a real label and visible focus on the input.
  const focused = await focusByText(cdp, '.mcr-rename-open', 'Wijzig');
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  await sleep(200);
  const open = await state(cdp);
  check(`BE-53 ${label}: Wijzig is met het toetsenbord te openen`, focused && open.fieldOpen, JSON.stringify(open.active));
  check(`BE-53 ${label}: het tekstveld heeft een label en de huidige naam`, open.label === 'Nieuwe naam voor dit menukopje' && open.value === SECTION, JSON.stringify([open.label, open.value]));
  check(`BE-53 ${label}: het tekstveld heeft zichtbare focus`, Boolean(open.active && open.active.tag === 'INPUT' && open.active.outlineStyle !== 'none' && open.active.outlineWidth !== '0px'), JSON.stringify(open.active));

  // Tab moves from the field to the save button; an unchanged name is refused
  // with a message instead of an empty correction.
  await pressKey(cdp, 'Tab', 'Tab', 9);
  await sleep(120);
  const onSave = await state(cdp);
  check(`BE-53 ${label}: Tab gaat van het veld naar "Opslaan in deze correctie"`, Boolean(onSave.active && onSave.active.text === 'Opslaan in deze correctie'), JSON.stringify(onSave.active));
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  await sleep(200);
  const refused = await state(cdp);
  check(`BE-53 ${label}: een ongewijzigde naam wordt met een melding geweigerd`, refused.fieldOpen && refused.hint === UNCHANGED_NAME_MESSAGE && refused.invalid === 'true', JSON.stringify([refused.fieldOpen, refused.hint, refused.invalid]));

  // An empty name is refused too.
  await evalJs(cdp, 'document.querySelector(".mcr-rename input").focus()');
  await selectAll(cdp);
  await pressKey(cdp, 'Backspace', 'Backspace', 8);
  await sleep(120);
  await pressKey(cdp, 'Tab', 'Tab', 9);
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  await sleep(200);
  const empty = await state(cdp);
  check(`BE-53 ${label}: een lege naam wordt met een melding geweigerd`, empty.fieldOpen && empty.hint === EMPTY_NAME_MESSAGE && empty.invalid === 'true', JSON.stringify([empty.fieldOpen, empty.hint, empty.invalid]));


  // Type the new name with the keyboard and save it in this correction.
  await evalJs(cdp, 'document.querySelector(".mcr-rename input").focus()');
  await typeText(cdp, NEW_NAME);
  await sleep(120);
  const typed = await state(cdp);
  check(`BE-53 ${label}: de nieuwe naam is met het toetsenbord ingevuld`, typed.value === NEW_NAME, JSON.stringify(typed.value));
  await pressKey(cdp, 'Tab', 'Tab', 9);
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  await sleep(250);
  const renamed = await state(cdp);
  check(`BE-53 ${label}: het menukopje toont de nieuwe naam`, renamed.rows.some((row) => row.includes(NEW_NAME)), JSON.stringify(renamed.rows));
  check(`BE-53 ${label}: de oude naam staat doorgestreept onder de nieuwe`, renamed.rows.some((row) => row.includes(`Was: ${SECTION}`)), JSON.stringify(renamed.rows));
  check(`BE-53 ${label}: er is een Ongedaan maken per kopje`, renamed.undoButtons === 1, String(renamed.undoButtons));
  check(`BE-53 ${label}: de correctie telt mee voor "Correcties opslaan als versie 2"`, Boolean(renamed.saveVersionButton && renamed.saveVersionButton.text === 'Correcties opslaan als versie 2'), JSON.stringify(renamed.saveVersionButton));
  const shotRenamed = await shot(cdp, `be53-rename-${width}-${theme}.png`);

  // Undo with the keyboard: the old name returns and nothing stays dirty.
  await focusByText(cdp, '.bta-structure button', 'Ongedaan maken');
  await sleep(100);
  const undoFocus = await state(cdp);
  check(`BE-53 ${label}: Ongedaan maken is met het toetsenbord bereikbaar met zichtbare focus`, Boolean(undoFocus.active && undoFocus.active.text.startsWith('Ongedaan maken') && undoFocus.active.outlineWidth !== '0px'), JSON.stringify(undoFocus.active));
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  await sleep(250);
  const undone = await state(cdp);
  check(`BE-53 ${label}: Ongedaan maken zet de oude naam terug`, undone.rows.some((row) => row.includes(SECTION)) && !undone.rows.some((row) => row.includes(NEW_NAME)), JSON.stringify(undone.rows));
  check(`BE-53 ${label}: na Ongedaan maken is er geen Ongedaan maken en geen open correctie meer`, undone.undoButtons === 0 && undone.saveVersionButton === null, JSON.stringify([undone.undoButtons, undone.saveVersionButton]));


  // Change it again (mouse) and save the correction as version 2.
  await evalJs(cdp, '[...document.querySelectorAll(".mcr-rename-open")][0].click()');
  await sleep(200);
  await evalJs(cdp, 'document.querySelector(".mcr-rename input").focus()');
  await selectAll(cdp);
  await typeText(cdp, NEW_NAME);
  await sleep(120);
  await evalJs(
    cdp,
    `[...document.querySelectorAll('.mcr-rename button')].find((b) => (b.innerText || '').includes('Opslaan in deze correctie')).click()`
  );
  await sleep(250);
  const again = await state(cdp);
  check(`BE-53 ${label}: opnieuw wijzigen werkt`, again.rows.some((row) => row.includes(NEW_NAME)), JSON.stringify(again.rows));

  await evalJs(
    cdp,
    `[...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Correcties opslaan als versie 2')).click()`
  );
  const navigated = await navigateToNewVersion(cdp);
  const saved = await state(cdp);
  check(`BE-53 ${label}: "Correcties opslaan als versie 2" opent de nieuwe versie 2`, navigated && saved.version === '2', JSON.stringify([navigated, saved.version]));
  return { shotRenamed, rows: saved.rows, version: saved.version, theme, width };
}

/** Version 2 shows the new heading in the Publicatievoorbeeld and in Structuur. */
async function newVersionScenario(cdp) {
  await setViewport(cdp, 1280);
  await openStructure(cdp);
  const structure = await state(cdp);
  check('BE-53 versie 2: de Structuur-lijst toont het nieuwe kopje', structure.rows.some((row) => row.includes(NEW_NAME)), JSON.stringify(structure.rows));
  check('BE-53 versie 2: de oude naam is geen kopje meer in deze versie', !structure.rows.some((row) => row.includes(SECTION)), JSON.stringify(structure.rows));

  await evalJs(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll('[role=tab]')].find((tab) => (tab.innerText || '').includes('Publicatievoorbeeld'));
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  await sleep(300);
  const preview = await evalJs(
    cdp,
    `(() => {
      const panel = document.getElementById('mcr-${NEW_ID}-panel-preview');
      return { shown: Boolean(panel && !panel.hidden), text: panel ? panel.innerText : '' };
    })()`
  );
  // The preview renders the heading through the public renderer, which sets it
  // in capitals; the name itself is compared case-insensitively and the old
  // name must be gone.
  const previewText = String(preview.text || '');
  const previewUpper = previewText.toUpperCase();
  check('BE-53 versie 2: het Publicatievoorbeeld toont de nieuwe kopjesnaam', preview.shown && previewUpper.includes(NEW_NAME.toUpperCase()), previewText.slice(0, 240));
  check('BE-53 versie 2: het Publicatievoorbeeld toont de oude kopjesnaam niet meer', !previewUpper.includes(SECTION.toUpperCase()), previewText.slice(0, 240));
  const previewShot = await shot(cdp, 'be53-versie-2-1280-light.png');
  return { shot: previewShot };
}


/** What the browser really posted to the existing versions route. */
async function postedEdits(cdp) {
  const raw = await evalJs(cdp, `window.localStorage.getItem(${escapeJs(STORAGE_KEY)}) || '[]'`);
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function renameScenario(cdp) {
  const shots = [];
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const round = await correctionRound(cdp, { theme, width });
      shots.push(round.shotRenamed);
      savedVersions.push(round);
    }
  }

  const posts = await postedEdits(cdp);
  check('BE-53 opslaan: elke ronde postte precies één nieuwe versie', posts.length === THEMES.length * WIDTHS.length, JSON.stringify(posts.map((post) => post.expectedVersion)));
  check('BE-53 opslaan: elke post verwachtte versie 1', posts.every((post) => post.expectedVersion === 1), JSON.stringify(posts.map((post) => post.expectedVersion)));
  const postedPaths = posts.map((post) => {
    const lines = (post.edits && post.edits.lines) || {};
    return Object.entries(lines)
      .filter(([, edit]) => edit && Array.isArray(edit.path))
      .map(([id, edit]) => [id, edit.path.join(' › ')]);
  });
  check(
    'BE-53 opslaan: de post bevat voor elk gerecht onder het kopje het bestaande path-veld',
    postedPaths.length === posts.length && postedPaths.every((entries) => entries.length === 2 && entries.every(([, pathValue]) => pathValue === NEW_NAME)),
    JSON.stringify(postedPaths)
  );
  check(
    'BE-53 opslaan: alleen de twee gerechten van dat kopje zijn geraakt',
    postedPaths.every((entries) => entries.map(([id]) => id).sort().join(',') === '0.0.0,0.0.1'),
    JSON.stringify(postedPaths.map((entries) => entries.map(([id]) => id)))
  );

  const version2 = await newVersionScenario(cdp);
  shots.push(version2.shot);
  const finalState = await state(cdp);
  check('BE-53 versie 2: geen horizontale overloop op 1280 px', finalState.overflow <= 0, String(finalState.overflow));
  return { shots, posts: posts.length };
}

function head() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return 'pending-commit';
  }
}

function worktreeDirty() {
  try {
    const lines = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT })
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      // This run's own evidence file is written after the run.
      .filter((line) => !line.includes('ops/browser/evidence/be53-browser-evidence.json'));
    return { dirty: lines.length > 0, lines };
  } catch {
    return { dirty: true, lines: ['git status unavailable'] };
  }
}

function writeEvidence({ passed, error = null }) {
  const status = worktreeDirty();
  const evidence = {
    issue: '#130',
    ticket: 'BE-53 — menukopje wijzigen',
    fixtureOnly: true,
    passed,
    error,
    filter: SELECTION.filter,
    scenarios: scenarioRuns,
    head: head(),
    worktreeDirty: status.dirty,
    worktreeChanges: status.lines,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      loopback: `http://localhost:${PORT} (own next dev) + own local browser over CDP`,
      browser: process.env.BROWSER_PATH || 'auto-detected Edge/Chrome',
      fixture: FIXTURE,
      fixtureWriteRoutes: FIXTURE_ROUTES.filter((route) => route.id === 'menu-concepts-versions').map((route) => `${route.methods.join('/')} ${route.path}`),
    },
    covered: [
      'Structuur: every menukopje offers Wijzig; the field has a label and the current name',
      'keyboard: Enter opens, Tab reaches "Opslaan in deze correctie"; visible focus on field and buttons',
      'refused with a clear message: an unchanged name and an empty name',
      'rename shows the new name with the old one struck through, plus Ongedaan maken',
      'Ongedaan maken restores the previous name and removes the unsaved correction',
      'rename again, then "Correcties opslaan als versie 2" posts only path edits via the existing route',
      'version 2 shows the new heading in Structuur and in the Publicatievoorbeeld',
      '1280 px and 390 px, light and dark',
    ],
    checks,
    screenshots,
    versions: savedVersions,
    network,
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const CHECK_SCENARIOS = [{ name: 'wijzigen', run: (cdp) => renameScenario(cdp) }];
const SELECTION = parseScenarioArgs(process.argv.slice(2), CHECK_SCENARIOS);
// Een gefilterde run schrijft nooit naar het volledige bewijsbestand.
const EVIDENCE_PATH = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: CHECK_SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ passed: false, error: 'browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome' });
    throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  }

  let server = null;
  let browser = null;
  let cdp = null;
  try {
    server = await startServer({ port: PORT, appUrl: `http://localhost:${PORT}`, outputDir: OUT_DIR });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({ appOrigins: APP_ORIGINS, fixtureRoutes: FIXTURE_ROUTES, baseUrl: CONCEPTS_URL });
    await enableFetchGuard(cdp, guard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureBootstrap(
        { [FIXTURE]: fixtures.scenarios[FIXTURE] },
        { appOrigins: APP_ORIGINS, baseUrl: CONCEPTS_URL, fixtureRoutes: FIXTURE_ROUTES }
      ),
    });

    scenarioRuns = await runScenarioSelection({ entries: CHECK_SCENARIOS, checks, cdp, filter: SELECTION.filter });

    network = {
      guard: 'in-page fetch/XHR/WebSocket/EventSource/beacon + CDP Fetch + DNS lockdown',
      appViolations: guard.appViolations(),
      deliberateViolations: guard.negativeViolations(),
    };
    check('BE-53 netwerk: geen onverwacht verkeer vanuit de app', network.appViolations.length === 0, JSON.stringify(network.appViolations.slice(0, 3)));
    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('BE-53: geen onafgevangen browser-exception', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 3)));
    const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
    check('BE-53: de fixture is zonder fout gestart', !bootError, bootError || 'ok');

    const passed = checks.every((entry) => entry.passed);
    const evidence = writeEvidence({ passed });
    console.log(`BE-53 browser checks: ${checks.filter((entry) => entry.passed).length}/${checks.length} passed`);
    console.log(`evidence: ${path.relative(REPO_ROOT, EVIDENCE_PATH)} (head ${evidence.head}${evidence.worktreeDirty ? ', dirty worktree' : ''})`);
    for (const failure of checks.filter((entry) => !entry.passed)) console.error(`FAIL: ${failure.name} — ${failure.detail}`);
    if (!passed) process.exitCode = 1;
  } catch (error) {
    writeEvidence({ passed: false, error: String((error && error.stack) || error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // A locked temporary profile is harmless; it stays outside the repo.
      }
    }
  }
}

main();

