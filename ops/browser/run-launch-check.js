'use strict';

// BE-70 (#173) — de lanceringscheck van de publieke pagina's.
//
// Eén herhaalbare browsercheck over alle publieke pagina's tegelijk, in licht en
// donker op 1280, 390 en 320 px, op een verse productieopbouw (`next build` +
// `next start`, `mode: 'start'`) en een echte browser via CDP. Waar een pagina
// een API nodig heeft, antwoordt een gestubde laag in de pagina: de daghap-stub
// van BE-67, de kies-stub van BE-62 en (voor een gevuld lijstje) de bestaande
// localStorage-sleutel `bredaeats_bewaard`. Geen Supabase-project, geen
// productiesleutel, geen productiedata, geen internet.
//
// Wat per pagina, breedte en thema wordt vastgelegd (contract #173, uitkomst 2):
//  - de laadgrootte: CDP `Network.loadingFinished` → `encodedDataLength`, met
//    `Network.setCacheDisabled`, tot het netwerk stil is. Budget 250 kB;
//  - de afbeeldingen van de eerste lading (alleen logo en iconen);
//  - geen horizontale overloop;
//  - tikdoelen ≥ 24 px en de hoofdknoppen ≥ 44 px;
//  - precies één h1 en geen overgeslagen kopniveau;
//  - de eerste Tab landt op een zichtbare focus;
//  - de a11y-audit van ops/browser/lib/a11y-audit.js met 0 fouten.
//
// Het thema gaat via de themakeuze in het instellingenpaneel (PublicHeaderPanel),
// het paneel gaat dicht vóór de opname en elke opname krijgt een `themeProof`.
// Het oordeel en het rapport staan in ops/browser/lib/launch-check-report.js;
// dit script meet alleen.
//
// Bewijs: ops/browser/evidence/launch-check.json (in git) en de korte
// samenvatting docs/launch-check.md. De opnamen (volledige viewport, één per
// pagina, breedte en thema) staan in de gitignored ops/browser/output/.
//
// Ontwikkelaarsbewijs, geen onafhankelijke review en geen productieacceptatie.
//
// Gebruik: node ops/browser/run-launch-check.js [--alleen=<pagina>[,<pagina>]] [--lijst]
// Poort: LAUNCH_CHECK_PORT of 3198. Draai deze check alleen.

const fs = require('node:fs');
const path = require('node:path');

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
const { CdpClient } = require('./lib/cdp');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const { THEME_LABELS, THEME_LUMINANCE, themeProofScript, clickThemeScript, themeProofValue, themeOk } = require('./lib/theme-proof');
const { be67StubScript } = require('./lib/be67-daghap-stub');
const { be62KiesStubScript, BE62_KIES_CODE } = require('./lib/be62-kies-stub');
const { LEGAL_PLACEHOLDERS } = require('../../src/lib/legalCopy');
const audit = require('./lib/a11y-audit');
const report = require('./lib/launch-check-report');

const SCRIPT_NAME = 'run-launch-check.js';
// 3198 valt binnen 3190-3199 en botst niet met de andere checks (3170, 3188,
// 3191, 3193/3194, 3195, 3196).
const PORT = Number(process.env.LAUNCH_CHECK_PORT || 3198);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const OUT_DIR = path.join(__dirname, 'output', 'launch-check');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'launch-check.json');
const DOC_PATH = path.join(__dirname, '..', '..', 'docs', 'launch-check.md');

const SAVED_LIST_KEY = 'bredaeats_bewaard';
const KIES_CODE = BE62_KIES_CODE;

// Drie echte gerechten uit de echte menukaarten, zodat "Mijn lijstje" gevuld is
// zonder verzonnen inhoud (BE-44 leest dezelfde vorm uit localStorage).
const DRIE_GERECHTEN = [
  { id: '6-diner-0-0', menuId: '6-diner', catIdx: 0, itemIdx: 0, name: 'Poussin', category: 'Specialiteiten van Bardot', price: '€20,95', restaurant: 'Brasserie Bardot' },
  { id: '6-diner-0-1', menuId: '6-diner', catIdx: 0, itemIdx: 1, name: 'Kreeft (pasta)', category: 'Specialiteiten van Bardot', price: null, restaurant: 'Brasserie Bardot' },
  { id: '23-borrel-0-1', menuId: '23-borrel', catIdx: 0, itemIdx: 1, name: 'Pata Negra', category: 'Signature Snacks', price: '€14,75', restaurant: 'T-Huis' },
];

const WIDTHS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
];
const THEMES = ['light', 'dark'];

// De pagina's uit uitkomst 1. `stub` zegt welke gestubde API een pagina nodig
// heeft, `lijst` welke stand localStorage voor "Mijn lijstje" hoort.
const PAGES = [
  { name: 'home', path: '/', ready: "!!document.querySelector('h1')" },
  { name: 'zoeken-resultaten', path: '/search?q=steak', ready: "!!document.querySelector('.results-count')" },
  { name: 'zoeken-zonder-resultaten', path: '/search?q=qzxvbb', ready: "!!document.querySelector('.empty-state-title')" },
  {
    name: 'restaurant-met-dagmenu',
    path: '/restaurant/6',
    ready: "!!document.querySelector('.detail-name') && !!document.querySelector('.daghap-vandaag-card')",
    stub: 'dagmenu',
  },
  { name: 'menu', path: '/menu/6-diner', ready: "!!document.querySelector('.menu-card')" },
  { name: 'restaurants', path: '/restaurants', ready: "!!document.querySelector('.ar-card')" },
  { name: 'alle-restaurants', path: '/alle-restaurants', ready: "!!document.querySelector('.ar-card')" },
  { name: 'mijn-lijstje-leeg', path: '/mijn-lijstje', ready: "!!document.querySelector('.lijst-title')", lijst: 'leeg' },
  {
    name: 'mijn-lijstje-drie',
    path: '/mijn-lijstje',
    ready: "!!document.querySelector('.lijst-title') && !!document.querySelector('.lijst-row')",
    lijst: 'drie',
  },
  { name: 'kies', path: `/kies/${KIES_CODE}`, ready: "!!document.querySelector('#kies-roepnaam')", stub: 'kies' },
  { name: 'deellink', path: '/r/6', ready: "!!document.querySelector('.detail-name')" },
  { name: 'voor-restaurants', path: '/voor-restaurants', ready: "!!document.querySelector('.vr-title')" },
  { name: 'inloggen', path: '/inloggen', ready: "!!document.querySelector('.inloggen-title')" },
  { name: 'privacy', path: '/privacy', ready: "!!document.querySelector('h1')" },
  { name: 'colofon', path: '/colofon', ready: "!!document.querySelector('h1')" },
];

const checks = [];
const rows = [];
const shots = [];
const themeLog = [];
let scenarioRuns = null;
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };
let meter = null;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined || detail === null ? null : String(detail) });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Venster, opname en themabewijs ─────────────────────────────────────────

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // Een volledige viewport, geen uitsnede.
  const file = await screenshot(cdp, SHOT_DIR, `${name}.png`);
  shots.push({
    ...file,
    url: `${meta.path || ''}`,
    viewport: `${viewport.width}x${viewport.height}`,
    theme: meta.theme || null,
    themeProof: meta.themeProof || null,
  });
  return file;
}

async function themeProof(cdp) {
  return themeProofValue(await evalJs(cdp, themeProofScript()));
}

const SETTINGS_BUTTON = '.pha-settings';
const SETTINGS_PANEL = '.pha-panel';

async function openSettings(cdp) {
  if (await evalJs(cdp, `Boolean(document.querySelector('${SETTINGS_PANEL}'))`)) return true;
  if (!(await waitFor(cdp, `Boolean(document.querySelector('${SETTINGS_BUTTON}'))`, 15000))) return false;
  for (let poging = 0; poging < 4; poging += 1) {
    await evalJs(cdp, `(() => { const button = document.querySelector('${SETTINGS_BUTTON}'); if (!button) return false; button.click(); return true; })()`);
    if (await waitFor(cdp, `Boolean(document.querySelector('${SETTINGS_PANEL}'))`, 4000)) {
      await sleep(180);
      return true;
    }
    await sleep(400);
  }
  return false;
}

/** Het instellingenpaneel dicht; een opname toont de pagina, geen paneel. */
async function closeSettings(cdp) {
  const dicht = `!document.querySelector('${SETTINGS_PANEL}')`;
  if (await evalJs(cdp, dicht)) return true;
  await evalJs(cdp, `(() => { const knop = document.querySelector('.pha-close'); if (knop) { knop.click(); return 'clicked'; } return 'missing'; })()`);
  if (await waitFor(cdp, dicht, 3000)) return true;
  await evalJs(cdp, `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
  if (await waitFor(cdp, dicht, 3000)) return true;
  await evalJs(cdp, `(() => { const laag = document.querySelector('.pha-layer'); if (laag) laag.click(); return true; })()`);
  return waitFor(cdp, dicht, 3000);
}

/**
 * Het bewijs ná het sluiten van het instellingenpaneel. De themaknoppen staan op
 * de publieke pagina's in dat paneel, dus na het sluiten is er geen actieve knop
 * meer om te lezen; het thema blijft dan bewezen door `data-theme` plus de
 * helderheid van `--bg`, met dezelfde grenzen als themeOk (BE-67).
 */
function themeStillApplied(proof, theme) {
  if (!proof || proof.attr !== theme || !Number.isFinite(proof.luminance)) return false;
  return theme === 'light'
    ? proof.luminance > THEME_LUMINANCE.light.above
    : proof.luminance < THEME_LUMINANCE.dark.below;
}

/**
 * Het thema via de themakeuze in het instellingenpaneel, daarna het paneel
 * dicht en pas dan het bewijs. Geen los attribuut en geen schrijfactie in de
 * opslag: alleen de app bepaalt het thema.
 */
async function applyTheme(cdp, theme, label) {
  const want = THEME_LABELS[theme];
  if (!(await openSettings(cdp))) throw new Error(`settings_button_missing: ${want}`);
  if (!(await waitFor(cdp, `document.querySelectorAll('.theme-btn').length >= 2`, 15000))) {
    throw new Error(`theme_button_missing: ${want}`);
  }
  let open = null;
  for (let poging = 0; poging < 4; poging += 1) {
    const clicked = await evalJs(cdp, clickThemeScript(want));
    if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${want}`);
    await sleep(300);
    open = await themeProof(cdp);
    if (themeOk(open, theme)) break;
    open = null;
  }
  if (!open) throw new Error(`theme_not_applied: ${want}`);
  const closed = await closeSettings(cdp);
  if (!closed) throw new Error(`settings_panel_still_open: ${want}`);
  await sleep(150);
  const proof = await themeProof(cdp);
  if (!themeStillApplied(proof, theme)) throw new Error(`theme_lost_after_close: ${want}`);
  themeLog.push({ page: label, theme, panelClosed: closed, proofOpen: open, proof });
  return { proof, panelClosed: closed };
}

// ─── De laadgrootte: echt overgedragen bytes, zonder cache ───────────────────

/**
 * De meter telt `encodedDataLength` van elke afgeronde aanvraag (`loadingFinished`)
 * vanaf de navigatie tot het netwerk stil is. `Network.setCacheDisabled` staat
 * aan, dus elke meting is een koude eerste lading en niet de tweede keer.
 */
function attachMeter(cdp) {
  const stand = {
    actief: false,
    bytes: 0,
    verzoeken: 0,
    open: 0,
    laatst: 0,
    afbeeldingen: [],
    perType: {},
    perTypeBytes: {},
    perRequest: [],
    aanvragen: {},
  };
  cdp.on('Network.requestWillBeSent', (params) => {
    if (!stand.actief) return;
    const type = params.type || 'Other';
    stand.verzoeken += 1;
    stand.open += 1;
    stand.laatst = Date.now();
    stand.perType[type] = (stand.perType[type] || 0) + 1;
    const url = params.request && params.request.url ? params.request.url : '';
    // Onthouden per aanvraag, zodat de afgeronde bytes aan een type en een pad
    // te koppelen zijn: dat is wat "waar de bytes zaten" in het rapport nodig heeft.
    stand.aanvragen[params.requestId] = { type, url };
    if (type === 'Image' && url) stand.afbeeldingen.push(url);
  });
  cdp.on('Network.loadingFinished', (params) => {
    if (!stand.actief) return;
    const bytes = Number(params.encodedDataLength) || 0;
    stand.bytes += bytes;
    const aanvraag = stand.aanvragen[params.requestId] || { type: 'Other', url: '' };
    stand.perTypeBytes[aanvraag.type] = (stand.perTypeBytes[aanvraag.type] || 0) + bytes;
    stand.perRequest.push({ type: aanvraag.type, url: aanvraag.url, bytes });
    delete stand.aanvragen[params.requestId];
    stand.open = Math.max(0, stand.open - 1);
    stand.laatst = Date.now();
  });
  cdp.on('Network.loadingFailed', () => {
    if (!stand.actief) return;
    stand.open = Math.max(0, stand.open - 1);
    stand.laatst = Date.now();
  });
  return stand;
}

async function measureLoad(cdp, stand, url, ready) {
  stand.actief = false;
  stand.bytes = 0;
  stand.verzoeken = 0;
  stand.open = 0;
  stand.afbeeldingen = [];
  stand.perType = {};
  stand.perTypeBytes = {};
  stand.perRequest = [];
  stand.aanvragen = {};
  stand.laatst = Date.now();
  stand.actief = true;
  await navigate(cdp, url, ready);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (stand.open === 0 && Date.now() - stand.laatst > 600) break;
    await sleep(120);
  }
  stand.actief = false;
  return {
    bytes: stand.bytes,
    requests: stand.verzoeken,
    images: stand.afbeeldingen.slice(),
    perType: { ...stand.perType },
    perTypeBytes: { ...stand.perTypeBytes },
    topResponses: report.topResponses(stand.perRequest),
  };
}

// ─── Stubs en de stand van localStorage ─────────────────────────────────────

let stubIds = [];

async function setStubs(cdp, page) {
  for (const identifier of stubIds) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  stubIds = [];
  if (page.stub === 'dagmenu') {
    const added = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be67StubScript() });
    stubIds.push(added.identifier);
  }
  if (page.stub === 'kies') {
    const added = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be62KiesStubScript() });
    stubIds.push(added.identifier);
  }
}

async function setSavedList(cdp, mode) {
  const script = mode === 'drie'
    ? `window.localStorage.setItem(${JSON.stringify(SAVED_LIST_KEY)}, ${JSON.stringify(JSON.stringify(DRIE_GERECHTEN))});`
    : `window.localStorage.removeItem(${JSON.stringify(SAVED_LIST_KEY)});`;
  await evalJs(cdp, `(() => { try { ${script} } catch (error) {} return true; })()`);
}

/** De eerste bezoekerstip wegklikken: die hoort niet in de opname. */
async function closeTip(cdp) {
  const tip = await evalJs(cdp, `(() => {
    const blok = document.querySelector('.beginscherm-tip');
    if (!blok) return 'none';
    const knop = blok.querySelector('.beginscherm-tip-close');
    if (!knop) return 'noknop';
    knop.click();
    return 'clicked';
  })()`);
  if (tip === 'clicked') await waitFor(cdp, `!document.querySelector('.beginscherm-tip')`, 3000);
  return tip;
}

// ─── De metingen in de pagina ───────────────────────────────────────────────

const OVERFLOW = `(() => {
  const root = document.documentElement;
  const scrollWidth = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0);
  return { innerWidth: window.innerWidth, scrollWidth: scrollWidth, overflow: scrollWidth - window.innerWidth };
})()`;

/** De hoofdknoppen: knoppen en links in <main> met een knop- of CTA-klasse. */
const MAIN_BUTTONS = `(() => {
  const main = document.querySelector('main');
  if (!main) return [];
  const patroon = /(^|[-_\\s])(btn|cta|knop)([-_\\s]|$)|btn-primary|hero-cta|vr-cta/i;
  const leesbaar = (el) => {
    const delen = [el.tagName.toLowerCase()];
    const klassen = String(el.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    return delen.concat(klassen.map((naam) => '.' + naam)).join('');
  };
  return [...main.querySelectorAll('a, button, [role="button"]')]
    .filter((el) => patroon.test(String(el.className || '')))
    .filter((el) => {
      const stijl = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return stijl.display !== 'none' && stijl.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        selector: leesbaar(el),
        text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
})()`;

/** De eerste Tab: vanaf de bovenkant van de pagina, met een zichtbaar focusdoel. */
async function firstTabStep(cdp) {
  await evalJs(cdp, audit.inPageSource('prepareFocusWalk', [{ scope: 'page' }]));
  await pressKey(cdp, 'Tab', 'Tab', 9);
  await sleep(150);
  return evalJs(cdp, audit.inPageSource('readFocusStep', []));
}

// ─── Eén pagina: alle breedtes en thema's ───────────────────────────────────

async function meetPagina(cdp, page) {
  await setStubs(cdp, page);
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const label = `${page.name} · ${width.name} · ${theme}`;
      await setViewport(cdp, width.width, width.height);
      await setSavedList(cdp, page.lijst || 'leeg');
      // De eerste lading van deze combinatie: koud, cache uit, en gemeten.
      const load = await measureLoad(cdp, meter, `${APP}${page.path}`, page.ready);
      const tip = await closeTip(cdp);
      const { proof, panelClosed } = await applyTheme(cdp, theme, label);
      const overflow = await evalJs(cdp, OVERFLOW);
      const buttons = await evalJs(cdp, MAIN_BUTTONS);
      const focusStep = await firstTabStep(cdp);
      const data = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44, midTarget: 24 }]));
      const review = audit.checksFromAudit(page.name, theme === 'light' ? 'licht' : 'donker', data, { minTarget: 44, midTarget: 24 });
      const row = report.comboRow({
        page: page.name,
        path: page.path,
        viewport: width.name,
        theme,
        bytes: load.bytes,
        requests: load.requests,
        imageUrls: load.images,
        overflow: overflow.overflow,
        targets: data.targets,
        mainButtons: buttons,
        headings: data.headings,
        focusStep,
        a11yErrors: review.errors,
      });
      const file = await shot(cdp, `launch-${page.name}-${width.name}-${theme}`, { path: page.path, theme, themeProof: proof });
      rows.push({
        ...row,
        scrollWidth: overflow.scrollWidth,
        innerWidth: overflow.innerWidth,
        perType: load.perType,
        perTypeBytes: load.perTypeBytes,
        topResponses: load.topResponses,
        themeProof: proof,
        panelClosed,
        tipClosed: tip,
        shot: { file: file.file, sha256: file.sha256, width: file.width, height: file.height },
      });
      for (const failure of review.errors) {
        check(`${label} · a11y-fout · ${failure.criterion}`, false, `${failure.reason} · ${failure.name}`);
      }
      for (const control of report.CONTROLS) {
        const verdict = row.controls[control.key];
        check(`${label} · ${control.label}`, verdict.passed, verdict.detail);
      }
      const status = row.passed ? 'ok  ' : 'ROOD';
      console.log(`${status} ${label} · ${report.roundKb(row.bytes)} kB${row.red.length > 0 ? ` · ${row.red.join(', ')}` : ''}`);
    }
  }
  return { pagina: page.name, pad: page.path, metingen: rows.filter((row) => row.page === page.name).length };
}

const SCENARIOS = PAGES.map((page) => ({ name: page.name, run: (cdp) => meetPagina(cdp, page) }));

// Ronde notities die niet als rood punt in de meting horen maar wel in het
// rapport moeten staan. Ze gaan ongewijzigd naar docs/launch-check.md.
const OPEN_PUNTEN = [
  '`/restaurants` stuurt permanent door naar `/alle-restaurants` (BE-29); de meting is de doorverwijzing plus de doelpagina, dus dezelfde bytes als `/alle-restaurants`.',
  '`/r/[id]` is een korte QR-doorverwijzing naar `/restaurant/[id]` (BE-56): de meting is de doorverwijzing plus de restaurantpagina.',
];

// De open gegevens van de eigenaar, geen rood punt in de meting (contract #173
// en de Lead-opdracht van ronde 2). De lijst komt uit de bron van de teksten
// zelf (src/lib/legalCopy.js), zodat een nieuwe placeholder hier vanzelf staat.
const OWNER_OPEN_PUNTEN = [
  `\`/privacy\` en \`/colofon\` staan in de check en meten groen; de tekst bevat nog ${LEGAL_PLACEHOLDERS.length} placeholders die de eigenaar vóór de lancering invult (bron: \`src/lib/legalCopy.js\`, \`LEGAL_PLACEHOLDERS\`): ${LEGAL_PLACEHOLDERS.map((placeholder) => `\`${placeholder}\``).join(', ')}.`,
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

function evidencePath() {
  return filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);
}

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    ticket: 'BE-70 (#173)',
    kind: 'fixture_browser_evidence',
    category: `lokale browsercheck op een verse productieopbouw (next build + next start op poort ${PORT}), koude eerste lading met cache uit; geen productie en geen echte acceptatie`,
    ranAt: new Date().toISOString(),
    port: PORT,
    mode: 'start',
    filter: SELECTION.filter || null,
    budgetKb: report.BUDGET_KB,
    method: 'CDP Network.loadingFinished → encodedDataLength per aanvraag, Network.setCacheDisabled, tot het netwerk stil is',
    pages: PAGES.map((page) => ({ name: page.name, path: page.path, stub: page.stub || null, lijst: page.lijst || null })),
    scenarios: scenarioRuns,
    summary: report.summaryOf(rows),
    rows,
    themes: themeLog,
    network: networkEvidence,
    openPoints: OPEN_PUNTEN,
    ownerOpenPoints: OWNER_OPEN_PUNTEN,
    checks,
    shots,
    failed: failed.length,
    passed: failed.length === 0 && checks.length > 0 && rows.length > 0,
    ...extra,
  };
  fs.writeFileSync(evidencePath(), `${JSON.stringify(record, null, 2)}\n`);
  // Het rapport hoort bij de volledige meting; een gefilterde run laat het staan.
  if (!SELECTION.filter) fs.writeFileSync(DOC_PATH, report.markdownReport(record));
  return record;
}

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const watchdog = setTimeout(() => {
    try {
      writeEvidence({ error: 'run_timeout (25 min)' });
    } catch (ignored) {
      // Bewijs schrijven is ook hier best effort.
    }
    process.exit(2);
  }, 25 * 60 * 1000);
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
    // De BE-57-opzet: een verse productieopbouw en `next start`, zodat er geen
    // HMR-herlaadbeurt midden in een meting valt. Deze check draait daarom
    // alleen (geen tweede browsercheck tegelijk, poort 3198).
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: '/', mode: 'start' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    // Koud meten: elke eerste lading is echt de eerste, niet de cache.
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: `${APP}/`,
      // De in-page stubs antwoorden zelf; de guard staat de routes alleen toe.
      // `/api/search` en `/api/restaurants` zijn echte, alleen-lezen app-routes
      // die de home en het zoeken zelf aanroepen.
      fixtureRoutes: [
        { id: 'search', match: 'exact', path: '/api/search', methods: ['GET'] },
        { id: 'restaurants', match: 'exact', path: '/api/restaurants', methods: ['GET'] },
        { id: 'kies', match: 'prefix', path: '/api/v1/kies', methods: ['GET', 'POST'] },
        { id: 'daghap', match: 'prefix', path: '/api/v1/daghap', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
        { id: 'tellers', match: 'exact', path: '/api/v1/tellers', methods: ['POST'] },
        { id: 'bekeken', match: 'exact', path: '/api/v1/bekeken', methods: ['POST'] },
      ],
    });
    await enableFetchGuard(cdp, guard);
    meter = attachMeter(cdp);

    // localStorage en sessionStorage bestaan alleen op een pagina van de app
    // zelf; één bezoek aan de home zet die context.
    await navigate(cdp, `${APP}/`, "!!document.querySelector('h1')");

    scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });


    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    const guardViolations = guard.appViolations();
    check('netwerk: geen geblokkeerde oproep in de pagina', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
    check('netwerk: geen geblokkeerde oproep op CDP-niveau', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
    networkEvidence = { appViolations: guardViolations, pageViolations };

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

    const record = writeEvidence({});
    console.log(JSON.stringify({
      passed: record.passed,
      pages: record.summary.length,
      checks: checks.length,
      failed: record.failed,
      screenshots: shots.length,
      evidence: evidencePath(),
      report: SELECTION.filter ? null : DOC_PATH,
    }, null, 2));
    if (!record.passed) process.exitCode = 1;
  } catch (error) {
    try {
      writeEvidence({ error: String((error && error.message) || error) });
    } catch (ignored) {
      // Bewijs schrijven is ook bij een fout best effort.
    }
    throw error;
  } finally {
    try {
      if (cdp) cdp.close();
      if (browser) killTree(browser.child);
      if (server) killTree(server);
    } catch {
      // Afsluiten mag nooit de uitslag verbergen.
    }
  }
}

main().catch((error) => {
  console.error(String((error && error.stack) || error));
  process.exitCode = 1;
});
