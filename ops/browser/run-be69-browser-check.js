'use strict';

// BE-69 (#172, acceptatie 3) — browsercheck voor /privacy en /colofon: licht en
// donker op 1280, 390 en 320 px, zonder overloop, met de koppen in volgorde en
// met werkende footerlinks.
//
// Fixture-bewijs: een echte browser via CDP op een verse productieopbouw
// (`next build` + `next start`, de BE-57-opzet) in een eigen bouwmap
// (NEXT_DIST_DIR=.next-be69). Geen Supabase-project, geen productiesleutel, geen
// productiedata, geen internet.
//
// Wat bewezen wordt:
//  - beide pagina's tonen de tekst uit src/lib/legalCopy.js, met de open
//    gegevens ([DATUM], [NAAM ORGANISATIE], ...) letterlijk in beeld;
//  - de koppen staan in de volgorde van het contract: de h1 eerst, daarna de h2
//    per sectie;
//  - geen horizontale overloop op 1280, 390 en 320 px, in licht en donker;
//  - de footerlinks Privacy en Colofon werken echt (een klik navigeert);
//  - het thema van elke opname is aangetoond: het gaat via de themakeuze in het
//    instellingenpaneel van de app zelf, het paneel is gesloten vóór de opname
//    en lib/theme-proof.js legt `data-theme`, de actieve knop en de helderheid
//    van `--bg` vast (licht > 200, donker < 80);
//  - screenshots van de volledige viewport bij het bewijs.
//
// Niet bewezen hier: de schermlezer en de 44-px-controles. Die draait de
// a11y-run apart: ops/browser/run-a11y-public-check.js --alleen=privacy,colofon.
// Dit is ontwikkelaarsbewijs, geen onafhankelijke review en geen productie-
// acceptatie.
//
// Gebruik: node ops/browser/run-be69-browser-check.js [--alleen=<scenario>] [--lijst]
// Poort: BE69_PORT of 3189 (binnen 3180-3189). Draai deze check alleen, één
// browsercheck tegelijk, met NEXT_DIST_DIR=.next-be69.

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
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const {
  THEME_LABELS,
  themeProofScript,
  clickThemeScript,
  themeProofValue,
  themeOk,
} = require('./lib/theme-proof');
const { PRIVACY, COLOFON } = require('../../src/lib/legalCopy');

const SCRIPT_NAME = 'run-be69-browser-check.js';
const PORT = Number(process.env.BE69_PORT || 3189);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const OUT_DIR = path.join(__dirname, 'output', 'be-69');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be69-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-69');

const SIZES = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
];

const SETTINGS_BUTTON = '.pha-settings';
const MENU_BUTTON = '.pha-menu';
const PANEL = '.pha-panel';

const checks = [];
const shots = [];
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // Een volledige viewport, geen uitsnede. De opname is altijd een PNG.
  const file = await screenshot(cdp, SHOT_DIR, `${name}.png`);
  shots.push({
    ...file,
    viewport: `${viewport.width}x${viewport.height}`,
    theme: meta.theme || null,
    page: meta.page || null,
    themeProof: meta.themeProof || null,
  });
  return file;
}

async function themeProof(cdp) {
  return themeProofValue(await evalJs(cdp, themeProofScript()));
}

// Het paneel openen zoals een bezoeker het opent: de instellingenknop op
// desktop, de menuknop op de telefoon. Beide knoppen bestaan al vóór de
// hydratatie, dus een klik die niets opent wordt herhaald.
async function openPanel(cdp, opener) {
  if (await evalJs(cdp, `Boolean(document.querySelector('${PANEL}'))`)) return true;
  const ready = await waitFor(cdp, `Boolean(document.querySelector('${opener}'))`, 15000);
  if (!ready) return false;
  for (let poging = 0; poging < 4; poging += 1) {
    await evalJs(cdp, `(() => { const b = document.querySelector('${opener}'); if (!b) return false; b.click(); return true; })()`);
    if (await waitFor(cdp, `Boolean(document.querySelector('${PANEL}'))`, 4000)) {
      await sleep(180);
      return true;
    }
    await sleep(400);
  }
  return false;
}

// Het paneel weer dicht: de opname toont de pagina, niet het paneel.
async function closePanel(cdp) {
  if (!(await evalJs(cdp, `Boolean(document.querySelector('${PANEL}'))`))) return true;
  await evalJs(cdp, `(() => { const b = document.querySelector('.pha-close'); if (!b) return false; b.click(); return true; })()`);
  return (await waitFor(cdp, `!document.querySelector('${PANEL}')`, 6000)) === true;
}

/**
 * Het thema zetten via de themakeuze in het paneel zelf (geen los attribuut en
 * geen schrijfactie in de opslag). Geeft het bewijs terug waarmee de opname
 * wordt gecontroleerd.
 */
async function applyTheme(cdp, theme, opener) {
  const label = THEME_LABELS[theme];
  if (!(await openPanel(cdp, opener))) throw new Error(`panel_missing: ${opener}`);
  const klaar = await waitFor(cdp, `document.querySelectorAll('.theme-btn').length >= 2`, 15000);
  if (!klaar) throw new Error(`theme_button_missing: ${label}`);
  for (let poging = 0; poging < 4; poging += 1) {
    const clicked = await evalJs(cdp, clickThemeScript(label));
    if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${label}`);
    await sleep(300);
    const proof = await themeProof(cdp);
    if (themeOk(proof, theme)) return proof;
  }
  throw new Error(`theme_not_applied: ${label}`);
}

// Eén meting per pagina: de koppen, de tekst, de kolombreedte, de footerlinks
// en de overloop. Alles wat de acceptatie vraagt, uit de echte DOM.
const PAGE_STATE = `(() => {
  const tekst = (el) => (el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '');
  const headings = [...document.querySelectorAll('h1, h2')].map((el) => ({
    level: Number(el.tagName.slice(1)),
    text: tekst(el),
    id: el.getAttribute('id'),
  }));
  const main = document.querySelector('.legal-main');
  const footerLinks = [...document.querySelectorAll('.public-footer a')].map((a) => ({
    text: tekst(a),
    href: a.getAttribute('href'),
  }));
  return {
    url: location.pathname,
    title: tekst(document.querySelector('.legal-title')),
    updated: tekst(document.querySelector('.legal-updated')),
    intro: tekst(document.querySelector('.legal-intro')),
    headings,
    paragraphs: [...document.querySelectorAll('.legal-paragraph')].map(tekst),
    items: [...document.querySelectorAll('.legal-list-item')].map(tekst),
    sectionTitles: [...document.querySelectorAll('.legal-section-title')].map(tekst),
    headingLevels: [...document.querySelectorAll('.legal-section-title')].map((el) => Number(el.tagName.slice(1))),
    mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
    fontFamily: main ? getComputedStyle(main).fontFamily : '',
    footerLinks,
    images: document.querySelectorAll('img').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

/** De footerlink naar de andere tekstpagina echt aanklikken. */
async function clickFooterLink(cdp, target) {
  const clicked = await evalJs(
    cdp,
    `(() => {
      const link = document.querySelector('.public-footer a[href="${target}"]');
      if (!link) return false;
      link.click();
      return true;
    })()`,
  );
  if (!clicked) return { ok: false, url: null, title: null };
  const arrived = await waitFor(cdp, `location.pathname === '${target}'`, 15000);
  const state = await evalJs(cdp, PAGE_STATE);
  return { ok: arrived, url: state.url, title: state.title };
}

async function paginaScenario(cdp, page) {
  for (const size of SIZES) {
    await setViewport(cdp, size.width, size.height);
    await navigate(cdp, `${APP}${page.path}`, page.ready);
    const opener = size.width >= 900 ? SETTINGS_BUTTON : MENU_BUTTON;
    const prefix = `${page.name} ${size.name}`;

    const licht = await applyTheme(cdp, 'light', opener);
    await closePanel(cdp);
    const state = await evalJs(cdp, PAGE_STATE);
    await shot(cdp, `be69-${page.name}-${size.name}-licht`, { theme: 'light', page: page.name, themeProof: licht });

    const donker = await applyTheme(cdp, 'dark', opener);
    await closePanel(cdp);
    await sleep(120);
    const stateDonker = await evalJs(cdp, PAGE_STATE);
    await shot(cdp, `be69-${page.name}-${size.name}-donker`, { theme: 'dark', page: page.name, themeProof: donker });

    check(`${prefix}: het thema licht is aangetoond (data-theme, actieve knop, --bg-helderheid)`,
      themeOk(licht, 'light'), JSON.stringify(licht));
    check(`${prefix}: het thema donker is aangetoond`, themeOk(donker, 'dark'), JSON.stringify(donker));
    check(`${prefix}: de h1 is "${page.copy.title}"`, state.title === page.copy.title, state.title);
    check(`${prefix}: de secties staan er als h2 in de volgorde van het contract`,
      JSON.stringify(state.sectionTitles) === JSON.stringify(page.copy.sections.map((section) => section.heading))
        && state.headingLevels.every((level) => level === 2),
      `${state.sectionTitles.join(' | ')} / ${state.headingLevels.join(',')}`);
    check(`${prefix}: de h1 staat vóór de eerste h2`,
      state.headings.length === page.copy.sections.length + 1 && state.headings[0].level === 1,
      JSON.stringify(state.headings.slice(0, 2)));
    check(`${prefix}: geen horizontale overloop`, state.overflow <= 0, state.overflow);
    check(`${prefix}: ook in donker geen overloop`, stateDonker.overflow <= 0, stateDonker.overflow);
    check(`${prefix}: de kolom is maximaal 680 px breed`, state.mainWidth !== null && state.mainWidth <= 680, state.mainWidth);
    check(`${prefix}: het systeemlettertype staat op de kolom`, /system-ui/.test(state.fontFamily), state.fontFamily);
    check(`${prefix}: geen afbeeldingen op de pagina`, state.images === 0, state.images);

    const alleTekst = [...state.paragraphs, ...state.items, state.updated];
    const ontbreekt = page.placeholders.filter((placeholder) => !alleTekst.some((text) => text.includes(placeholder)));
    check(`${prefix}: de open gegevens staan er letterlijk`, ontbreekt.length === 0, JSON.stringify(ontbreekt));

    check(`${prefix}: de footer toont "Voor restaurants", "Inloggen", "Privacy" en "Colofon"`,
      JSON.stringify(state.footerLinks.map((link) => link.text)) === JSON.stringify(['Voor restaurants', 'Inloggen', 'Privacy', 'Colofon'])
        && JSON.stringify(state.footerLinks.map((link) => link.href)) === JSON.stringify(['/voor-restaurants', '/inloggen', '/privacy', '/colofon']),
      JSON.stringify(state.footerLinks));

    if (page.name === 'privacy') {
      check(`${prefix}: de datumregel staat bovenaan`, state.updated === page.copy.updated, state.updated);
      check(`${prefix}: de intro uit het contract staat er`, state.intro === page.copy.intro, state.intro);
      check(`${prefix}: de eerste alinea uit het contract staat er`,
        state.paragraphs[0] === page.copy.sections[0].blocks[0].text, state.paragraphs[0]);
    }
  }

  // De footerlinks werken echt: vanaf deze pagina naar de andere tekstpagina.
  const other = page.name === 'privacy' ? COLOFON : PRIVACY;
  await setViewport(cdp, 1280, 900);
  await navigate(cdp, `${APP}${page.path}`, page.ready);
  const navigatie = await clickFooterLink(cdp, other.href);
  check(`${page.name}: de footerlink "${other.title}" navigeert echt naar ${other.href}`,
    navigatie.ok && navigatie.title === other.title, JSON.stringify(navigatie));

  // Elke opname draagt zijn eigen themabewijs; een opname zonder bewijs telt niet.
  const eigen = shots.filter((opname) => opname.page === page.name);
  const zonderBewijs = eigen.filter((opname) => !themeOk(opname.themeProof, opname.theme));
  check(`${page.name}: elke opname heeft een kloppend themabewijs`,
    zonderBewijs.length === 0 && eigen.length === 6,
    `${eigen.length - zonderBewijs.length}/${eigen.length} opnamen: ${zonderBewijs.map((opname) => opname.file).join(',')}`);
}

const PAGES = [
  {
    name: 'privacy',
    path: PRIVACY.href,
    copy: PRIVACY,
    ready: "Boolean(document.querySelector('.legal-title'))",
    // De open gegevens die op deze pagina letterlijk moeten staan.
    placeholders: ['[DATUM]', '[NAAM ORGANISATIE]', '[ADRES]', '[KVK-NUMMER]', '[E-MAILADRES]', '[REGIO VAN OPSLAG]'],
  },
  {
    name: 'colofon',
    path: COLOFON.href,
    copy: COLOFON,
    ready: "Boolean(document.querySelector('.legal-title'))",
    placeholders: ['[NAAM ORGANISATIE]', '[ADRES]', '[KVK-NUMMER]', '[E-MAILADRES]'],
  },
];


const SCENARIOS = PAGES.map((page) => ({
  name: page.name,
  run: (cdp) => paginaScenario(cdp, page),
}));

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

// Een gefilterde run schrijft naar een eigen bestand dat git negeert
// (ops/browser/evidence/*.filtered.json); alleen de volledige run vervangt het
// bewijs dat bij de levering hoort.
function evidencePath() {
  return filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);
}

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    ticket: 'BE-69 (#172)',
    kind: 'fixture_browser_evidence',
    category: `lokale browsercheck op een verse productieopbouw (next build + next start op poort ${PORT}); geen productie en geen echte acceptatie`,
    startedAt: new Date().toISOString(),
    port: PORT,
    pages: PAGES.map((page) => page.path),
    filter: SELECTION.filter,
    network: networkEvidence,
    checks,
    shots,
    failed: failed.length,
    passed: failed.length === 0 && checks.length > 0,
    ...extra,
  };
  fs.writeFileSync(evidencePath(), JSON.stringify(record, null, 2));
  return record;
}

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const watchdog = setTimeout(() => {
    writeEvidence({ error: 'timeout na 10 minuten' });
    process.exit(2);
  }, 10 * 60 * 1000);
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
    // De BE-57-opzet: een verse productieopbouw in een eigen bouwmap en
    // `next start`, zodat er geen HMR-herlaadbeurt midden in een meting valt.
    // Deze check draait daarom alleen (geen tweede browsercheck tegelijk).
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: PAGES[0].path, mode: 'start' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: `${APP}${PAGES[0].path}`,
      fixtureRoutes: [],
    });
    await enableFetchGuard(cdp, guard);

    await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

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
