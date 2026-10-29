'use strict';

// BE-45 (#114) — gefilterde browsercheck voor de tellertabel (/internal/tellers).
//
// Dit start de echte app (`next dev`, zonder Supabase-sleutel) en de echte
// pagina, met een fictieve sessie en fictieve API-antwoorden
// (ops/browser/lib/fixture-page.js). Het is FIXTURE EVIDENCE: geen echte
// database, geen productie, geen echte medewerker — en dus geen acceptatie.
//
// Wat deze check in de browser bewijst:
//   - de periodeknoppen (aria-pressed) van vandaag, 7 en 30 dagen;
//   - de drie totalen en de tabel met aria-sort, standaard "Gedeeld" aflopend;
//   - een klik op een kolomkop sorteert echt (aria-sort verschuift, de rijen
//     veranderen van volgorde);
//   - de gerechtnaam is een link naar de publieke gerechtpagina, en een
//     onbekende sleutel staat er met "onbekend gerecht" zonder link;
//   - op een telefoon (390 en 320 px) is de tabel vervangen door de lijst met
//     een sorteerkeuze die echt sorteert, met tikdoelen van minstens 44 px;
//   - licht en donker lossen verschillend op en gebruiken de tokens;
//   - de lege staat en de foutstaat ("Tellers zijn nu niet beschikbaar");
//   - geen enkele geblokkeerde netwerkopdracht en geen onafgevangen fout.
//
// De mockup zelf is een extern Claude-artifact dat deze check niet kan ophalen;
// de schermafdrukken in ops/browser/evidence/be-45/ zijn voor de visuele
// vergelijking door de Lead/eigenaar.
//
// Gebruik: `node ops/browser/run-be45-browser-check.js`,
// `--lijst` voor de namen, `--alleen=<naam>[,<naam>]` voor één scenario.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { fixtureBootstrap } = require('./lib/fixture-page');
const fixtures = require('./fixtures/menuReviewFixtures');
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

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'output');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
// De schermafdrukken horen bij de levering en staan daarom in de repository.
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-45');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be45-browser-evidence.json');
const SCRIPT_NAME = 'run-be45-browser-check.js';
const PORT = Number(process.env.BE45_FIXTURE_PORT || 3145);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const PAGE_URL = (query) => `${APP}/internal/tellers?${query}`;

const checks = [];
const shots = [];
const clickpaths = [];
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };
let scenarioRuns = null;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

function flatText(value) {
  return String(value === undefined || value === null ? '' : value).split(/\s+/).filter(Boolean).join(' ');
}

function recordClickpath(name, steps, passed, detail) {
  clickpaths.push({ name, steps, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await Promise.race([
    cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('setViewport_timeout')), 10000)),
  ]);
}

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({ ...file, viewport: `${viewport.width}x${viewport.height}`, theme: meta.theme || null, state: meta.state || null });
  return file;
}

async function open(cdp, url, readyExpression) {
  await navigate(cdp, url, readyExpression);
  const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
  check(`fixture bootstrap zonder fout (${url.replace(APP, '')})`, !bootError, bootError || 'ok');
}


const PERIOD_LABELS = ['Vandaag', '7 dagen', '30 dagen'];
const COLUMN_LABELS = ['Gerecht', 'Restaurant', 'Gedeeld', 'Bewaard', 'Reserveer'];
// De fictieve rijen uit ops/browser/lib/fixture-page.js, in de volgorde van de
// standaardsortering (Gedeeld, aflopend).
const EXPECTED_ORDER = ['Stoofvlees met friet', 'Tosti ham-kaas', 'Vegetarische lasagne', '8-lunch-9-9'];
const EXPECTED_TOTALS = { gedeeld: '25', bewaard: '17', reserveren: '5' };

async function readPage(cdp) {
  return evalJs(cdp, `(() => {
    const text = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
    // Kolomkoppen staan in kapitalen (CSS) met de sorteerpijl op een eigen regel;
    // de eerste regel is de kolomnaam, ongeacht de opmaak.
    const firstLine = (value) => String(value === undefined || value === null ? '' : value)
      .split(String.fromCharCode(10)).map((part) => part.trim()).filter(Boolean)[0] || '';
    const visible = (el) => Boolean(el) && el.offsetParent !== null;
    const table = document.querySelector('.tellers-table');
    const rows = [...document.querySelectorAll('.tellers-table tbody tr')].map((tr) => {
      const cells = [...tr.querySelectorAll('td')];
      const link = tr.querySelector('a.tellers-dish-link');
      return {
        name: firstLine(text(cells[0])),
        key: text(tr.querySelector('.tellers-dish-key')),
        unknown: text(tr.querySelector('.tellers-dish-unknown-label')),
        href: link ? link.getAttribute('href') : null,
        restaurant: text(cells[1]),
        gedeeld: text(cells[2]),
        bewaard: text(cells[3]),
        reserveren: text(cells[4]),
      };
    });
    const headers = [...document.querySelectorAll('.tellers-table thead th')].map((th) => ({
      label: firstLine(text(th.querySelector('button') || th)),
      sort: th.getAttribute('aria-sort'),
    }));
    const cards = [...document.querySelectorAll('.tellers-card')].map((card) => ({
      name: firstLine(text(card.querySelector('.tellers-card-name'))),
      href: card.querySelector('a.tellers-dish-link') ? card.querySelector('a.tellers-dish-link').getAttribute('href') : null,
      numbers: [...card.querySelectorAll('.tellers-card-numbers dd')].map((dd) => text(dd)),
    }));
    const select = document.getElementById('tellers-sort');
    const periodButtons = [...document.querySelectorAll('.tellers-period')].map((button) => ({
      label: text(button),
      pressed: button.getAttribute('aria-pressed'),
      height: Math.round(button.getBoundingClientRect().height),
    }));
    const totals = [...document.querySelectorAll('.tellers-total')].map((item) => ({
      label: text(item.querySelector('dt')),
      value: text(item.querySelector('dd')),
    }));
    const root = getComputedStyle(document.documentElement);
    return {
      title: text(document.querySelector('h1')),
      theme: document.documentElement.getAttribute('data-theme'),
      bg: root.getPropertyValue('--bg').trim(),
      accent: root.getPropertyValue('--accent').trim(),
      periodButtons: periodButtons,
      totals: totals,
      headers: headers,
      rows: rows,
      cards: cards,
      select: select ? {
        value: select.value,
        options: [...select.options].map((option) => option.value),
        label: select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : null,
        height: Math.round(select.getBoundingClientRect().height),
      } : null,
      tableVisible: visible(table),
      listVisible: visible(document.querySelector('.tellers-list')),
      emptyText: text(document.querySelector('.tellers-empty')),
      errorText: text(document.querySelector('[role="alert"]')),
      statusText: text(document.querySelector('.tellers-status')),
      noteText: text(document.querySelector('.tellers-note')),
      bodyText: document.body.innerText,
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  })()`);
}

async function clickPeriod(cdp, label) {
  return evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('.tellers-period')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function clickSortHeader(cdp, label) {
  return evalJs(cdp, `(() => {
    const firstLine = (value) => String(value === undefined || value === null ? '' : value)
      .split(String.fromCharCode(10)).map((part) => part.trim()).filter(Boolean)[0] || '';
    const wanted = ${JSON.stringify(label)}.toLowerCase();
    const button = [...document.querySelectorAll('.tellers-table thead button')].find((el) => firstLine(el.innerText).toLowerCase() === wanted);
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function chooseSort(cdp, value) {
  return evalJs(cdp, `(() => {
    const select = document.getElementById('tellers-sort');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function desktopScenario(cdp) {
  await setViewport(cdp, 1280, 900);
  const light = await openLoaded(cdp, 'theme=light&tellers=gevuld', 'desktop/licht');

  check('desktop: de titel is Tellers', light.title === 'Tellers', light.title);
  check(
    'desktop: de drie periodeknoppen staan er met aria-pressed, standaard 7 dagen',
    light.periodButtons.length === 3 &&
      JSON.stringify(light.periodButtons.map((button) => button.label)) === JSON.stringify(PERIOD_LABELS) &&
      light.periodButtons.map((button) => button.pressed).join(',') === 'false,true,false',
    JSON.stringify(light.periodButtons),
  );
  check(
    'desktop: elke periodeknop is een tikdoel van minstens 44 px',
    light.periodButtons.every((button) => button.height >= 44),
    JSON.stringify(light.periodButtons.map((button) => button.height)),
  );
  check(
    'desktop: de drie totalen staan er met de opgetelde waarden',
    light.totals.length === 3 &&
      light.totals[0].value === EXPECTED_TOTALS.gedeeld &&
      light.totals[1].value === EXPECTED_TOTALS.bewaard &&
      light.totals[2].value === EXPECTED_TOTALS.reserveren &&
      JSON.stringify(light.totals.map((total) => total.label)) === JSON.stringify(['Gedeeld', 'Bewaard', 'Reserveer']),
    JSON.stringify(light.totals),
  );
  check(
    'desktop: de tabel heeft vijf kolomkoppen op een echte knop',
    light.headers.length === 5 &&
      COLUMN_LABELS.every((label, index) => light.headers[index].label.toLowerCase() === label.toLowerCase()),
    JSON.stringify(light.headers.map((header) => header.label)),
  );
  check(
    'desktop: de standaardsortering is Gedeeld, aflopend',
    ariaSortOf(light, 'Gedeeld') === 'descending' &&
      light.headers.filter((header) => header.sort !== 'none').length === 1,
    JSON.stringify(light.headers.map((header) => [header.label, header.sort])),
  );
  check(
    'desktop: de rijen staan in die volgorde (Gedeeld, aflopend)',
    JSON.stringify(namesOf(light.rows)) === JSON.stringify(EXPECTED_ORDER),
    JSON.stringify(namesOf(light.rows)),
  );
  check(
    'desktop: de gerechtnaam linkt naar de publieke gerechtpagina',
    light.rows[0].href && light.rows[0].href.startsWith('/menu/7-diner?') && light.rows[0].href.includes('dish=7-diner-0-0'),
    light.rows[0].href,
  );
  check(
    'desktop: een onbekende sleutel staat er met "onbekend gerecht" en zonder link',
    light.rows[3].name.includes('8-lunch-9-9') &&
      light.rows[3].unknown === 'onbekend gerecht' &&
      light.rows[3].href === null,
    JSON.stringify(light.rows[3]),
  );
  check(
    'desktop: alleen de tabel is zichtbaar, de telefoonlijst niet',
    light.tableVisible === true && light.listVisible === false,
    JSON.stringify({ table: light.tableVisible, list: light.listVisible }),
  );
  await shot(cdp, 'be45-desktop-1280-light.png', { theme: 'light', state: 'gevuld' });

  const clicked = await clickSortHeader(cdp, 'Bewaard');
  check('desktop: een kolomkop is een echte knop die de sortering verandert', clicked);
  const sorted = await waitFor(cdp, `(() => {
    const th = [...document.querySelectorAll('.tellers-table thead th')].find((el) => (el.innerText || '').toLowerCase().includes('bewaard'));
    return Boolean(th) && th.getAttribute('aria-sort') === 'descending';
  })()`, 5000);
  const afterSort = await readPage(cdp);
  check('desktop: na de klik is Bewaard de aflopende sorteerkolom', sorted && ariaSortOf(afterSort, 'Gedeeld') === 'none', JSON.stringify(afterSort.headers.map((header) => [header.label, header.sort])));
  check(
    'desktop: de rijen sorteren echt op Bewaard (9, 5, 2, 1)',
    JSON.stringify(namesOf(afterSort.rows)) === JSON.stringify(['Vegetarische lasagne', 'Stoofvlees met friet', 'Tosti ham-kaas', '8-lunch-9-9']),
    JSON.stringify(namesOf(afterSort.rows)),
  );
  recordClickpath('kolomkop Bewaard sorteren', ['klik op Bewaard'], sorted === true);

  const periodClicked = await clickPeriod(cdp, '30 dagen');
  const pressed = await waitFor(cdp, `(() => {
    const button = [...document.querySelectorAll('.tellers-period')].find((el) => (el.innerText || '').trim() === '30 dagen');
    return Boolean(button) && button.getAttribute('aria-pressed') === 'true';
  })()`, 10000);
  const afterPeriod = await readPage(cdp);
  check('desktop: een periodeknop is echt en zet aria-pressed', periodClicked && pressed, JSON.stringify(afterPeriod.periodButtons));
  check(
    'desktop: de nieuwe periode laadt opnieuw en houdt de rij(en)',
    afterPeriod.rows.length === EXPECTED_ORDER.length,
    JSON.stringify(namesOf(afterPeriod.rows)),
  );
  await shot(cdp, 'be45-desktop-1280-light-30-dagen.png', { theme: 'light', state: 'periode-30' });

  const dark = await openLoaded(cdp, 'theme=dark&tellers=gevuld', 'desktop/donker');
  check('desktop: het gevraagde donkere thema is actief', dark.theme === 'dark', dark.theme);
  check(
    'desktop: licht en donker lossen verschillend op (token --bg)',
    light.bg !== dark.bg && Boolean(light.bg) && Boolean(dark.bg),
    `${light.bg} / ${dark.bg}`,
  );
  check(
    'desktop: de tabel staat er ook in donker, met dezelfde rijen',
    dark.tableVisible === true && JSON.stringify(namesOf(dark.rows)) === JSON.stringify(EXPECTED_ORDER),
    JSON.stringify(namesOf(dark.rows)),
  );
  await shot(cdp, 'be45-desktop-1280-dark.png', { theme: 'dark', state: 'gevuld' });
}

function ariaSortOf(page, label) {
  // De knoptekst staat in kapitalen (CSS) en bevat ook de sorteerpijl; de
  // kolomnaam staat vooraan, dus vergelijk zonder hoofdletters.
  const wanted = String(label).toLowerCase();
  const header = page.headers.find((entry) => String(entry.label).toLowerCase() === wanted);
  return header ? header.sort : null;
}

function namesOf(rows) {
  return rows.map((row) => row.name);
}

/** Eén geopende pagina met de gedeelde controle dat er iets te zien is. */
async function openLoaded(cdp, query, theme) {
  await open(cdp, PAGE_URL(query), `Boolean(document.querySelector('h1')) && document.querySelector('h1').innerText.trim() === 'Tellers'`);
  const ready = await waitFor(cdp, `Boolean(document.querySelector('.tellers-table tbody tr')) || Boolean(document.querySelector('.tellers-empty')) || Boolean(document.querySelector('[role="alert"]'))`, 90000);
  check(`${theme}: de pagina laadt met een tabel, een lege staat of een foutstaat`, ready);
  return readPage(cdp);
}

async function mobileScenario(cdp, width, theme) {
  await setViewport(cdp, width, 800);
  const page = await openLoaded(cdp, `theme=${theme}&tellers=gevuld`, `${width}px/${theme}`);

  check(
    `${width}px/${theme}: de tabel is vervangen door de lijst`,
    page.tableVisible === false && page.listVisible === true,
    JSON.stringify({ table: page.tableVisible, list: page.listVisible }),
  );
  check(
    `${width}px/${theme}: de lijst toont dezelfde vier gerechten`,
    page.cards.length === EXPECTED_ORDER.length && page.cards[0].name.includes('Stoofvlees met friet'),
    JSON.stringify(page.cards.map((card) => card.name)),
  );
  check(
    `${width}px/${theme}: de eerste kaart linkt naar de publieke gerechtpagina`,
    Boolean(page.cards[0].href) && page.cards[0].href.startsWith('/menu/7-diner?'),
    page.cards[0].href,
  );
  check(
    `${width}px/${theme}: de sorteerkeuze staat er met kolom én richting`,
    Boolean(page.select) &&
      page.select.value === 'gedeeld:aflopend' &&
      page.select.options.includes('bewaard:oplopend') &&
      page.select.options.length === 8,
    JSON.stringify(page.select),
  );
  check(
    `${width}px/${theme}: de sorteerkeuze en de periodeknoppen zijn tikdoelen van minstens 44 px`,
    Boolean(page.select) &&
      page.select.height >= 44 &&
      page.periodButtons.every((button) => button.height >= 44),
    JSON.stringify({ select: page.select && page.select.height, periods: page.periodButtons.map((button) => button.height) }),
  );
  check(
    `${width}px/${theme}: de drie totalen staan er ook op de telefoon`,
    page.totals.length === 3 && page.totals[0].value === EXPECTED_TOTALS.gedeeld,
    JSON.stringify(page.totals),
  );
  check(`${width}px/${theme}: geen horizontale overloop`, page.overflow <= 0, `overflow=${page.overflow}`);
  await shot(cdp, `be45-${width}-${theme}.png`, { theme, state: 'gevuld' });

  const changed = await chooseSort(cdp, 'bewaard:aflopend');
  const reordered = await waitFor(cdp, `(() => {
    const first = document.querySelector('.tellers-card .tellers-card-name');
    return Boolean(first) && first.innerText.includes('Vegetarische lasagne');
  })()`, 5000);
  const afterSort = await readPage(cdp);
  check(
    `${width}px/${theme}: de sorteerkeuze sorteert de lijst echt (Bewaard, hoog → laag)`,
    changed && reordered && afterSort.cards[0].name.includes('Vegetarische lasagne'),
    JSON.stringify(afterSort.cards.map((card) => card.name)),
  );
  check(
    `${width}px/${theme}: de keuze blijft in de lijst staan`,
    afterSort.select && afterSort.select.value === 'bewaard:aflopend',
    JSON.stringify(afterSort.select && afterSort.select.value),
  );
  recordClickpath(`telefoon ${width}px/${theme}: sorteerkeuze Bewaard`, ['kies Bewaard (hoog → laag)'], changed === true && reordered === true);
}

async function emptyScenario(cdp) {
  await setViewport(cdp, 1280, 900);
  const page = await openLoaded(cdp, 'theme=light&tellers=leeg', 'leeg');
  check('leeg: de eerlijke lege staat staat er', page.emptyText === 'Nog geen tellingen in deze periode.', page.emptyText);
  check(
    'leeg: de drie totalen staan op 0 en er is geen tabelrij of kaart',
    page.totals.length === 3 &&
      page.totals.every((total) => total.value === '0') &&
      page.rows.length === 0 &&
      page.cards.length === 0,
    JSON.stringify({ totals: page.totals, rows: page.rows.length }),
  );
  check('leeg: er is geen foutstaat en geen crash', !page.errorText, page.errorText);
  await shot(cdp, 'be45-leeg-1280-light.png', { theme: 'light', state: 'leeg' });

  const dark = await openLoaded(cdp, 'theme=dark&tellers=leeg', 'leeg/donker');
  check('leeg: de lege staat werkt ook in donker', dark.emptyText === 'Nog geen tellingen in deze periode.', dark.emptyText);
  await shot(cdp, 'be45-leeg-1280-dark.png', { theme: 'dark', state: 'leeg' });
}

async function errorScenario(cdp) {
  await setViewport(cdp, 1280, 900);
  const page = await openLoaded(cdp, 'theme=light&tellers=fout', 'fout');
  check(
    'fout: de nette foutstaat staat er',
    page.errorText.includes('Tellers zijn nu niet beschikbaar.'),
    page.errorText,
  );
  check(
    'fout: er is geen tabel en geen verzonnen 0 als totaal',
    page.tableVisible === false && page.totals.length === 0,
    JSON.stringify({ table: page.tableVisible, totals: page.totals.length }),
  );
  check('fout: de pagina blijft werken (titel en periodeknoppen)', page.title === 'Tellers' && page.periodButtons.length === 3, JSON.stringify({ title: page.title, periods: page.periodButtons.length }));
  await shot(cdp, 'be45-fout-1280-light.png', { theme: 'light', state: 'fout' });

  const dark = await openLoaded(cdp, 'theme=dark&tellers=fout', 'fout/donker');
  check('fout: dezelfde foutstaat in donker', dark.errorText.includes('Tellers zijn nu niet beschikbaar.'), dark.errorText);
  await shot(cdp, 'be45-fout-1280-dark.png', { theme: 'dark', state: 'fout' });
}


// ─── Bewijs ──────────────────────────────────────────────────────────────────

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (error) {
    return null;
  }
}

function writeEvidence(extra = {}) {
  const record = {
    category: 'fixture evidence (fictional session and fictional teller rows; not real acceptance)',
    issue: '#114',
    script: SCRIPT_NAME,
    generatedAt: new Date().toISOString(),
    port: PORT,
    head: headSha(),
    fixtureRows: EXPECTED_ORDER,
    mockupComparison:
      'not machine-verifiable here: the approved mockup is an external Claude artifact; the screenshots in evidence/be-45/ are saved for the Lead/human visual comparison',
    // BE-43 (#101): een gefilterde run noemt zijn keuze en is nooit het volledige bewijs.
    filter: SELECTION.filter,
    scenarios: scenarioRuns,
    checks,
    clickpaths,
    screenshots: shots,
    network: networkEvidence,
    passed: checks.length > 0 && checks.every((entry) => entry.passed),
    ...extra,
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(record, null, 2));
  return record;
}

async function warmUp(cdp) {
  await setViewport(cdp, 1280, 900);
  await navigate(
    cdp,
    PAGE_URL('theme=light&tellers=gevuld'),
    `Boolean(document.querySelector('h1')) && document.querySelector('h1').innerText.trim() === 'Tellers'`,
  );
  const ready = await waitFor(cdp, `Boolean(document.querySelector('.tellers-table tbody tr'))`, 120000);
  check('warm-up: de pagina en de fictieve tellerroute antwoorden', ready);
}

// Elk scenario is één benoemde stap; `--alleen=<naam>` draait alleen die stap.
const TELLER_SCENARIOS = [
  { name: 'desktop', run: (cdp) => desktopScenario(cdp) },
  {
    name: 'mobiel',
    run: async (cdp) => {
      await mobileScenario(cdp, 390, 'light');
      await mobileScenario(cdp, 390, 'dark');
      await mobileScenario(cdp, 320, 'light');
    },
  },
  { name: 'leeg', run: (cdp) => emptyScenario(cdp) },
  { name: 'fout', run: (cdp) => errorScenario(cdp) },
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), TELLER_SCENARIOS);
// Een gefilterde run schrijft nooit naar het volledige bewijsbestand.
const EVIDENCE_PATH = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: TELLER_SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const watchdog = setTimeout(() => {
    try {
      writeEvidence({ error: 'run_timeout (8 min)' });
    } catch (ignored) {
      // Het schrijven van het bewijs is ook hier best effort.
    }
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
    const networkGuard = createNetworkGuard({ appOrigins: APP_ORIGINS, baseUrl: PAGE_URL('theme=light') });
    await enableFetchGuard(cdp, networkGuard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureBootstrap(fixtures.scenarios, { appOrigins: APP_ORIGINS, baseUrl: PAGE_URL('theme=light') }),
    });

    console.log('warm-up: de pagina en de tellerroute compileren');
    await warmUp(cdp);
    scenarioRuns = await runScenarioSelection({ entries: TELLER_SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    check('netwerk: de pagina heeft geen geblokkeerde oproep geregistreerd', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
    const guardViolations = networkGuard.appViolations();
    check('netwerk: de CDP-laag heeft geen geblokkeerde oproep geregistreerd', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
    networkEvidence = { appViolations: guardViolations, pageViolations };

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));
    const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
    check('geen fout in de fixture-bootstrap aan het eind', !bootError, bootError || 'ok');

    const record = writeEvidence({});
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
        // Een vergrendeld tijdelijk profiel is onschadelijk; het staat buiten de repo.
      }
    }
  }
}

main();

