'use strict';

// BE-51 (#121) — herhaalbare toegankelijkheidscheck voor de publieke pagina's.
//
// Start een eigen lokale ontwikkelserver (dezelfde runtime als de andere
// ops/browser-checks) en bestuurt een lokaal geïnstalleerde Edge/Chrome via
// CDP. Niets hiervan raakt productie, Supabase of een externe host.
//
// Per pagina, in licht én donker, meet deze check:
//   - contrast van tekst tegen de écht berekende achtergrond (≥ 4,5:1, grote
//     tekst ≥ 3:1);
//   - de toegankelijke naam van elk bedieningselement;
//   - tikdoelen ≥ 44 px, of ≥ 24 px met voldoende ruimte (WCAG 2.2 AA);
//   - koppen (één h1, geen sprongen), landmarks (main, nav), lang="nl" en
//     labels bij formuliervelden;
//   - het toetsenbordpad: Tab in DOM-volgorde, met per stop een zichtbare focus;
//   - een open deelvenster: focus erin, vastgehouden, en terug na Esc;
//   - 320 px breed met 200% tekst: geen horizontale scroll, geen afgekapte tekst;
//   - beweging onder prefers-reduced-motion: reduce.
//
// De meetkern staat in ops/browser/lib/a11y-audit.js: dezelfde functies rekenen
// in de browser en in `node --test`, dus er is geen tweede implementatie.
//
// Bewijs: ops/browser/evidence/a11y-public-evidence.json (per pagina en per
// thema het aantal controles en fouten, met de fase "voor" en "na") en de kleine
// opnamen van het focuspad in ops/browser/evidence/a11y-public/. Dit is
// developer-evidence op een lokale build: geen productie en geen onafhankelijke
// acceptatie.
//
//   node ops/browser/run-a11y-public-check.js [--alleen=<scenario>] [--lijst]
//                                             [--fase=voor|na] [--thema=licht|donker]
//                                             [--poort=3170]

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
  pressKey,
} = require('./lib/runtime');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const { CdpClient } = require('./lib/cdp');
const audit = require('./lib/a11y-audit');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.BE51_PORT || 3170);
// BE-51: de app-URL volgt de gekozen poort (zie PORT_ARG), anders start de check
// zijn server op de ene poort en wacht hij op de andere.
const OUT_DIR = path.join(REPO_ROOT, 'ops', 'browser', 'output', 'be-51');
// De kleine focusopnamen horen bij de levering en staan daarom in git.
const EVIDENCE_DIR = path.join(REPO_ROOT, 'ops', 'browser', 'evidence', 'a11y-public');
const BASE_EVIDENCE_PATH = path.join(REPO_ROOT, 'ops', 'browser', 'evidence', 'a11y-public-evidence.json');

const THEMES = ['licht', 'donker'];
const MAX_TABS = 60;
const FOCUS_SHOTS = 3;
const MIN_TARGET = 44;
const MID_TARGET = 24;
const SAVED_LIST_KEY = 'bredaeats_bewaard';
const SHARE_PREFERENCE_KEY = 'deelvoorkeur';

// Eén echt bewaard gerecht uit de borrelkaart van T-Huis (23-borrel), zodat
// "Mijn lijstje" gevuld is zonder verzonnen inhoud.
const SAVED_DISH = {
  id: '23-borrel-0-1',
  menuId: '23-borrel',
  catIdx: 0,
  itemIdx: 1,
  name: 'Pata Negra',
  category: 'Signature Snacks',
  price: '€14,75',
  restaurant: 'T-Huis',
};

const MAIN_READY = "!!document.querySelector('main') && document.body.innerText.trim().length > 80";

const OPEN_SHARE_SHEET = `(() => {
  const element = document.querySelector('button.dish-share-btn');
  if (!element) return null;
  element.focus();
  element.click();
  return element.tagName.toLowerCase() + '.' + element.className.trim().split(/\\s+/).slice(0, 3).join('.');
})()`;

const OPEN_SHARE_SETTINGS = `(() => {
  const element = document.querySelector('button.share-settings-btn');
  if (!element) return null;
  element.focus();
  element.click();
  return element.tagName.toLowerCase() + '.' + element.className.trim().split(/\\s+/).slice(0, 3).join('.');
})()`;

const SCENARIOS = [
  { name: 'home', url: '/', ready: "!!document.querySelector('h1')", label: 'home' },
  {
    name: 'zoeken-lege',
    url: '/search',
    ready: `${MAIN_READY} && !!document.querySelector('.empty-state-title')`,
    label: 'zoeken zonder resultaten',
  },
  {
    name: 'zoeken-resultaten',
    url: '/search?q=vis',
    ready: `${MAIN_READY} && !!document.querySelector('.results-count')`,
    label: 'zoeken met resultaten',
  },
  { name: 'alle-restaurants', url: '/alle-restaurants', ready: "!!document.querySelector('.ar-card')", label: 'alle restaurants' },
  { name: 'restaurant', url: '/restaurant/6', ready: "!!document.querySelector('.detail-name')", label: 'een restaurant' },
  { name: 'menu', url: '/menu/23-borrel', ready: "!!document.querySelector('.menu-card')", label: 'een groot menu' },
  {
    name: 'mijn-lijstje',
    url: '/mijn-lijstje',
    ready: `${MAIN_READY} && !!document.querySelector('.lijst-title')`,
    // Na de herlaadbeurt staat de bewaarde lijst er pas als React gehydrateerd
    // is; op de eerste keer laden is die er nog niet, vandaar twee varianten.
    readySeeded: "!!document.querySelector('.lijst-row')",
    seed: [SAVED_DISH],
    label: 'mijn lijstje',
  },
  {
    name: 'deelblad',
    url: '/menu/23-borrel',
    ready: "!!document.querySelector('button.dish-share-btn')",
    open: OPEN_SHARE_SHEET,
    openerSelector: 'button.dish-share-btn',
    dialog: true,
    label: 'het deelblad',
  },
  {
    name: 'instellingen',
    url: '/mijn-lijstje',
    ready: `${MAIN_READY} && !!document.querySelector('button.share-settings-btn')`,
    readySeeded: "!!document.querySelector('.lijst-row')",
    seed: [SAVED_DISH],
    open: OPEN_SHARE_SETTINGS,
    openerSelector: 'button.share-settings-btn',
    dialog: true,
    label: 'de instellingen (Delen via)',
  },
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);
const ARGS = process.argv.slice(2);

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const found = ARGS.find((arg) => arg.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

const PHASE = argValue('--fase', 'na');
const THEME_ARG = argValue('--thema', 'beide');
const PORT_ARG = Number(argValue('--poort', PORT));
// Dezelfde poort voor de server en voor de pagina's die de check opent.
const APP = `http://localhost:${PORT_ARG}`;

const WIDTHS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'telefoon', width: 390, height: 844 },
];

const checks = [];
const shots = [];
let viewport = { width: 1280, height: 900 };

function addChecks(result, errors) {
  for (const entry of result.checks || []) checks.push(entry);
  for (const entry of result.errors || []) errors.push(entry);
}

async function setViewport(cdp, width, height, mobile = width < 600) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
}

/**
 * Wacht tot de pagina rustig staat: het aantal elementen verandert niet meer.
 * Nodig omdat de client hierna pas hydrateert en zijn lijsten opbouwt; zonder
 * deze wacht meten we soms een half-getekende pagina.
 */
async function waitForStableDom(cdp, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let previous = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const count = await evalJs(cdp, 'document.querySelectorAll("body *").length');
    if (count === previous) {
      stable += 1;
      if (stable >= 3) return count;
    } else {
      stable = 0;
      previous = count;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return previous;
}

/**
 * Zet het thema en de fixture in de opslag van de eigen localhost-origin, en
 * herlaadt daarna: de thema-init in app/layout.js leest bij het laden de opslag,
 * dus alleen zo is de stand echt de stand van de pagina.
 */
async function openPage(cdp, scenario, theme) {
  await navigate(cdp, `${APP}${scenario.url}`, scenario.ready);
  const seed = scenario.seed ? JSON.stringify(JSON.stringify(scenario.seed)) : null;
  await evalJs(
    cdp,
    `(() => {
      try {
        localStorage.setItem('bredaeats_theme', ${JSON.stringify(theme)});
        ${seed ? `localStorage.setItem(${JSON.stringify(SAVED_LIST_KEY)}, ${seed});` : ''}
        localStorage.removeItem(${JSON.stringify(SHARE_PREFERENCE_KEY)});
      } catch (error) { /* opslag geweigerd: de pagina werkt dan nog steeds */ }
      document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
      return true;
    })()`
  );
  await cdp.send('Page.reload', { ignoreCache: false });
  const afterReload = scenario.readySeeded || scenario.ready;
  const ready = await waitFor(cdp, `document.readyState !== 'loading' && (${afterReload})`, 45000);
  if (!ready) throw new Error(`page_not_ready_after_reload: ${scenario.url}`);
  await waitForStableDom(cdp);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/** Eén kleine opname rond het element dat nu de focus heeft. */
async function focusShot(cdp, name, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const padding = 6;
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  const width = Math.max(1, Math.min(viewport.width - x, rect.width + padding * 2));
  const height = Math.max(1, Math.min(viewport.height - y, rect.height + padding * 2));
  const info = await screenshot(cdp, EVIDENCE_DIR, name, { clip: { x, y, width, height } });
  shots.push({ file: name, ...info });
  return info;
}

/**
 * Loopt het toetsenbordpad met echte Tab-drukken. Per stop wordt vergeleken met
 * de ruststand van precies dat element (zie `prepareFocusWalk`), zodat "de focus
 * is zichtbaar" een meting is en geen aanname.
 */
async function focusWalk(cdp, pageName, theme, widthName) {
  const prepared = await evalJs(cdp, audit.inPageSource('prepareFocusWalk', [{ scope: 'page' }]));
  const steps = [];
  let skipped = 0;
  for (let index = 0; index < MAX_TABS; index += 1) {
    await pressKey(cdp, 'Tab', 'Tab', 9);
    const step = await evalJs(cdp, audit.inPageSource('readFocusStep', []));
    if (!step || step.done) break;
    if (step.inPage === false) {
      // Iets buiten de pagina (bijvoorbeeld de ontwikkel-overlay) kreeg de
      // focus. Dat telt niet mee en eindigt de ronde niet.
      skipped += 1;
      if (skipped > 5) break;
      continue;
    }
    steps.push(step);
    if (steps.length <= FOCUS_SHOTS) {
      await focusShot(cdp, `a11y-${pageName}-${theme}-${widthName}-focus-${steps.length}.png`, step.rect);
    }
  }
  return { total: prepared.total, items: prepared.items, steps, skipped };
}

/**
 * Het deelvenster: open, focus erin, Tab blijft binnen, Esc sluit en de focus
 * gaat terug naar de knop die het opende.
 */
async function dialogScenario(cdp, scenario, theme, widthName) {
  const opener = await evalJs(cdp, scenario.open);
  let opened = await waitFor(cdp, "!!document.querySelector('[role=\"dialog\"]')", 4000);
  if (!opened) {
    // De eerste klik kan vallen voordat React klaar is met hydrateren; één
    // herhaling is genoeg en verandert niets aan wat er getest wordt.
    await evalJs(cdp, scenario.open);
    opened = await waitFor(cdp, "!!document.querySelector('[role=\"dialog\"]')", 4000);
  }
  const before = await evalJs(cdp, audit.inPageSource('dialogAudit', []));

  const trapSteps = [];
  for (let index = 0; index < 14; index += 1) {
    await pressKey(cdp, 'Tab', 'Tab', 9);
    const state = await evalJs(cdp, audit.inPageSource('dialogAudit', []));
    trapSteps.push({ inside: state.inside === true, active: state.active });
    if (!state.inside) break;
  }
  const trapped = trapSteps.every((step) => step.inside);

  await pressKey(cdp, 'Escape', 'Escape', 27);
  const closed = await waitFor(cdp, "!document.querySelector('[role=\"dialog\"]')", 5000);
  const after = await evalJs(cdp, audit.inPageSource('activeElementAudit', []));
  const restored = closed && after.selector === opener;

  return audit.checksFromDialog(scenario.name, `${theme}/${widthName}`, {
    open: opened,
    inside: before.inside,
    ariaModal: before.ariaModal,
    name: before.name,
    labelledBy: before.labelledBy,
    trapped,
    restored,
    active: before.active,
    afterClose: after.selector,
  });
}



/** Eén pagina, één thema, één breedte: alle criteria achter elkaar. */
async function runScenarioTheme(cdp, scenario, theme, width) {
  await setViewport(cdp, width.width, width.height);
  await openPage(cdp, scenario, theme);

  const own = [];
  const errors = [];
  const meta = {};
  const collect = (result) => {
    for (const entry of result.checks || []) own.push(entry);
    for (const entry of result.errors || []) errors.push(entry);
  };

  if (scenario.dialog) {
    collect(await dialogScenario(cdp, scenario, theme, width.name));
    // Opnieuw laden na het sluiten: de focusmeting van de pagina begint dan
    // gegarandeerd in de ruststand.
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(cdp, `document.readyState !== 'loading' && (${scenario.ready})`, 45000);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  const data = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: MIN_TARGET, midTarget: MID_TARGET }]));
  collect(audit.checksFromAudit(scenario.name, `${theme}/${width.name}`, data));
  meta.measuredTexts = data.contrast.measured;
  meta.minRatio = data.contrast.minRatio;
  meta.interactive = data.interactiveTotal;
  meta.headings = data.headings.length;
  meta.landmarks = data.landmarks;

  // Overgangen tijdelijk uit tijdens de focusmeting: we willen de eindstand van
  // de focusstijl zien, niet de eerste frame van een overgang van 0,15 s. De
  // bewegingseis zelf wordt daarna (opnieuw) gemeten, dus dit maskeert niets.
  await evalJs(
    cdp,
    `(() => {
      const style = document.createElement('style');
      style.id = 'a11y-meet-rust';
      style.textContent = '* { transition: none !important; animation: none !important; }';
      document.head.appendChild(style);
      return true;
    })()`
  );
  const walk = await focusWalk(cdp, scenario.name, theme, width.name);
  await evalJs(cdp, "(() => { const el = document.getElementById('a11y-meet-rust'); if (el) el.remove(); return true; })()");
  collect(audit.checksFromFocusWalk(scenario.name, `${theme}/${width.name}`, walk, { maxTabs: MAX_TABS }));
  meta.tabStops = walk.steps.length;
  meta.tabbables = walk.total;
  meta.skippedFocusSteps = walk.skipped;
  meta.focusPath = walk.steps.slice(0, 12).map((step) => ({
    selector: step.selector,
    indicator: step.indicator ? step.indicator.changes.join('+') || 'geen' : null,
  }));

  await cdp.send('Emulation.setEmulatedMedia', {
    media: '',
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const motion = await evalJs(cdp, audit.inPageSource('motionAudit', [{}]));
  collect(audit.checksFromMotion(scenario.name, `${theme}/${width.name}`, motion));
  meta.motion = {
    animations: motion.animationTotal,
    transitions: motion.transitionTotal,
    scrollBehaviour: motion.scrollBehaviour,
  };
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [] });

  // Reflow is breedte-onafhankelijk: de meting zet zelf 320 px en 1280 px, dus
  // één keer per pagina en thema is genoeg. Dat scheelt de helft van de tijd.
  if (width.name === 'desktop') {
    const reflow = {};
    // Zonder mobiele emulatie: 320 CSS-px is precies de maat die WCAG 1.4.10
    // bedoelt. De mobiele emulatie schaalt het beeldvenster mee en dan zegt
    // `scrollWidth` niets meer over de pagina zelf.
    await setViewport(cdp, 320, 800, false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    reflow.smal = await evalJs(cdp, audit.inPageSource('reflowAudit', [{}]));
    collect(audit.checksFromReflow(scenario.name, `${theme}/${width.name}/320px`, reflow.smal));

    await setViewport(cdp, 1280, 900, false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    meta.scaledElements = await evalJs(cdp, audit.inPageSource('scaleText', [2]));
    reflow.tekst200 = await evalJs(cdp, audit.inPageSource('reflowAudit', [{}]));
    collect(audit.checksFromReflow(scenario.name, `${theme}/${width.name}/200%-tekst`, reflow.tekst200));

    await setViewport(cdp, 320, 800, false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    reflow.smalTekst200 = await evalJs(cdp, audit.inPageSource('reflowAudit', [{}]));
    collect(audit.checksFromReflow(scenario.name, `${theme}/${width.name}/320px-200%-tekst`, reflow.smalTekst200));

    meta.reflow = {
      smal: { viewport: reflow.smal.viewportWidth, overflowX: reflow.smal.overflowX, clipped: reflow.smal.clippedTotal },
      tekst200: { viewport: reflow.tekst200.viewportWidth, overflowX: reflow.tekst200.overflowX, clipped: reflow.tekst200.clippedTotal },
      smalTekst200: {
        viewport: reflow.smalTekst200.viewportWidth,
        overflowX: reflow.smalTekst200.overflowX,
        clipped: reflow.smalTekst200.clippedTotal,
        ellipsis: reflow.smalTekst200.ellipsisTotal,
      },
    };
  }

  return { scenario: scenario.name, theme, width: width.name, checks: own, errors, meta };
}

/** De uitkomst van één fase ("voor" of "na") per pagina en per thema. */
function buildPhase(runs, extra) {
  const pages = [];
  for (const scenario of SCENARIOS) {
    const own = runs.filter((run) => run.scenario === scenario.name);
    if (own.length === 0) continue;
    const themes = {};
    for (const theme of THEMES) {
      const themeRuns = own.filter((run) => run.theme === theme);
      if (themeRuns.length === 0) continue;
      const widths = {};
      const errors = [];
      let count = 0;
      let failed = 0;
      for (const run of themeRuns) {
        widths[run.width] = {
          checks: run.checks.length,
          failedChecks: run.checks.filter((entry) => !entry.passed).length,
          errors: run.errors.length,
          measuredTexts: run.meta.measuredTexts,
          minRatio: run.meta.minRatio,
          interactive: run.meta.interactive,
          tabStops: run.meta.tabStops,
          tabbables: run.meta.tabbables,
          skippedFocusSteps: run.meta.skippedFocusSteps,
          focusPath: run.meta.focusPath,
          reflow: run.meta.reflow,
          motion: run.meta.motion,
        };
        count += run.checks.length;
        failed += run.checks.filter((entry) => !entry.passed).length;
        errors.push(...run.errors);
      }
      themes[theme] = {
        checks: count,
        failedChecks: failed,
        errors: errors.length,
        widths,
        groups: audit.groupFailures(errors, 40),
      };
    }
    pages.push({ name: scenario.name, label: scenario.label, url: scenario.url, themes });
  }

  const totals = { pages: pages.length, checks: 0, failedChecks: 0, errors: 0 };
  for (const page of pages) {
    for (const theme of Object.keys(page.themes)) {
      totals.checks += page.themes[theme].checks;
      totals.failedChecks += page.themes[theme].failedChecks;
      totals.errors += page.themes[theme].errors;
    }
  }
  return { ...extra, pages, totals };
}

/** Het bewijsbestand: de fase die nu liep wordt bijgewerkt, de andere blijft. */
function writeEvidence(phaseEntry, outPath) {
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch (error) {
    existing = {};
  }
  const phases = { ...(existing.phases || {}), [PHASE]: phaseEntry };
  const record = {
    generatedAt: new Date().toISOString(),
    ticket: '#121 BE-51 — toegankelijkheid van de publieke pagina\'s',
    category: 'developer evidence — local build, no production data or credentials',
    head: phaseEntry.head,
    app: APP,
    port: PORT_ARG,
    phase: PHASE,
    filter: SELECTION.filter,
    themes: THEMES,
    widths: WIDTHS.map((entry) => entry.name),
    thresholds: {
      contrast: 4.5,
      contrastLarge: 3,
      largeText: '≥ 24 px, of ≥ 18,66 px vet',
      target: MIN_TARGET,
      targetWithSpace: MID_TARGET,
      reflowWidth: 320,
      textZoom: '200%',
      maxTabs: MAX_TABS,
    },
    method: {
      server: 'next dev op localhost, geen Supabase of productie',
      theme: 'localStorage bredaeats_theme + data-theme, daarna herladen',
      contrast:
        'getComputedStyle-kleuren, halftransparante lagen samengesteld tot de echte achtergrond; gradient = ongunstigste stop',
      focus: 'echte Tab-drukken; per stop vergeleken met de ruststand van hetzelfde element',
      reflow: 'viewport 320 px, daarna elke tekstgrootte ×2 (tekst-zoomen), toen gemeten',
      motion: 'Emulation.setEmulatedMedia prefers-reduced-motion: reduce',
      toetsenbord: `eerste ${MAX_TABS} stops; boven die grens is het een steekproef en dat staat erbij`,
    },
    phases,
    screenshots: shots.length,
    result: phaseEntry.totals.failedChecks === 0 && phaseEntry.totals.errors === 0 ? 'passed' : 'failed',
    gaps: [
      'Dit is developer-evidence op een lokale build: geen productie, geen Supabase-credentials, geen onafhankelijke acceptatie.',
      `De toetsenbordronde is per pagina een steekproef van de eerste ${MAX_TABS} stops; bij een groot menu staan er meer bedieningselementen in de DOM dan dat.`,
      '200% tekst is nagebootst door elke berekende tekstgrootte te verdubbelen; de browserinstelling "tekst alleen vergroten" is niet als aparte profielinstelling gezet.',
      'Contrast wordt per tekstelement gemeten; tekst over een afbeelding of video komt niet voor op deze pagina\'s en zou als onmeetbaar gelden.',
      'Een schermlezer is niet gestart: namen en rollen komen uit de DOM (aria-label, aria-labelledby, label, tekst), niet uit een voorleesstem.',
      'De app-brede AI-activering valt buiten deze opdracht; er is hier niets aan AI of Supabase geactiveerd.',
    ],
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}


async function main() {
  const outcome = scenarioSelectionOutcome({
    selection: SELECTION,
    entries: SCENARIOS,
    scriptName: 'run-a11y-public-check.js',
  });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }
  if (!['voor', 'na'].includes(PHASE)) {
    console.error(`--fase verwacht "voor" of "na", kreeg "${PHASE}". Er is niets gestart.`);
    process.exitCode = 2;
    return;
  }
  if (!['licht', 'donker', 'beide'].includes(THEME_ARG)) {
    console.error(`--thema verwacht "licht", "donker" of "beide", kreeg "${THEME_ARG}". Er is niets gestart.`);
    process.exitCode = 2;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const themes = THEME_ARG === 'beide' ? THEMES : [THEME_ARG];
  const selected = SELECTION.filter
    ? SCENARIOS.filter((scenario) => SELECTION.filter.includes(scenario.name))
    : SCENARIOS;

  let server = null;
  let browser = null;
  let cdp = null;

  try {
    server = await startServer({ port: PORT_ARG, appUrl: APP, outputDir: OUT_DIR, readyPath: '/' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const runs = [];
    for (const scenario of selected) {
      for (const theme of themes) {
        for (const width of WIDTHS) {
          const startedAt = Date.now();
          const run = await runScenarioTheme(cdp, scenario, theme, width);
          for (const entry of run.checks) checks.push(entry);
          runs.push(run);
          const failed = run.checks.filter((entry) => !entry.passed);
          const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
          const status = failed.length > 0 || run.errors.length > 0 ? 'FAIL' : 'ok  ';
          console.log(
            `${status} ${scenario.name} (${theme}/${width.name}): ${run.checks.length - failed.length}/${run.checks.length} controles, ${run.errors.length} fouten (${seconds}s)`
          );
          for (const check of failed) console.log(`     FAIL ${check.name} — ${check.detail === null ? '' : check.detail}`);
        }
      }
    }

    let head = null;
    try {
      head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    } catch (error) {
      head = null;
    }

    const phaseEntry = buildPhase(runs, {
      head,
      generatedAt: new Date().toISOString(),
      themes,
      widths: WIDTHS.map((entry) => entry.name),
      screenshots: shots.length,
    });
    const outPath = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);
    const record = writeEvidence(phaseEntry, outPath);

    console.log(
      JSON.stringify(
        {
          phase: PHASE,
          result: record.result,
          pages: phaseEntry.totals.pages,
          checks: phaseEntry.totals.checks,
          failedChecks: phaseEntry.totals.failedChecks,
          errors: phaseEntry.totals.errors,
          screenshots: phaseEntry.screenshots,
          evidence: outPath,
        },
        null,
        2
      )
    );
    if (record.result !== 'passed') process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch (error) {
        // Een vergrendeld tijdelijk profiel is onschadelijk; het staat buiten de repo.
      }
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});

