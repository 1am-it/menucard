'use strict';

// BE-34 (#81) — fixture browser check for "Lees met AI met één klik" and
// "Zoek een nieuw restaurant op naam".
//
// It drives the real routes and components in a local `next dev` with a
// fictional in-page session and fictional API answers
// (fixtures/eenKlikFixtures.js). What it shows, at 1280 and 390 px in light and
// dark:
//   1. the row before the click: one primary "📷 Lees met AI (afbeelding)" button
//      with the estimate, and the manual import only as the small link
//      "Liever zelf plakken";
//   2. the row while the existing server-side reading runs
//      ("⏳ AI leest de kaart… ± 1 minuut");
//   3. the row afterwards ("✅ N gerechten gelezen · M controle nodig",
//      "Bekijk en controleer", the measured cost);
//   4. the existing review screen (Lijst | Kaart) opened from that button with
//      the reading already loaded — including "Alles nagelopen (N)";
//   5. the row after a failed reading: an honest reason with "Handmatig
//      toevoegen";
//   6. "✨ Zoek op internet: Bobby's Bar, Breda" with the proposal (name,
//      address, website, menu link, provenance, cost) and
//      "Toevoegen als nieuw restaurant".
//
// FIXTURE EVIDENCE: no provider, database, production identity or real
// restaurant is involved, and nothing is created or published. Screenshots go to
// ops/browser/evidence/be-34/.

const fs = require('node:fs');
const path = require('node:path');

const { fixtureBootstrap } = require('./lib/fixture-page');
const baseFixtures = require('./fixtures/menuReviewFixtures').scenarios;
const { SCENARIOS } = require('./fixtures/eenKlikFixtures');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const { findBrowser, killTree, startServer, startBrowser, evalJs, waitFor, navigate, screenshot } = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const SCRIPT_NAME = 'run-een-klik-browser-check.js';
const OUT_DIR = path.join(__dirname, 'output', 'be-34');
const SHOTS_DIR = path.join(__dirname, 'evidence', 'be-34');
const BASE_EVIDENCE_PATH = path.join(__dirname, 'evidence', 'een-klik-browser-evidence.json');
const PORT = Number(process.env.EEN_KLIK_FIXTURE_PORT || 3142);
const APP = `http://localhost:${PORT}`;
const START_URL = `${APP}/internal/coverage`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const FIXTURES = { ...baseFixtures, ...SCENARIOS };
const WATCHDOG_MIN = Number(process.env.EEN_KLIK_WATCHDOG_MIN || 35);

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

// BE-42 restpunt (#105): een knop die zijn emoji in een eigen span tekent
// (BE-37's EmojiText) leest de browser als twee blokken — "📷\nLees met AI
// (afbeelding)". Het label is één regel; daarom vergelijken de controles hier
// de platte tekst van dat ene label. Alleen de verwachting, geen appwijziging.
const PAGE_FLAT_TEXT = "const flat = (value) => String(value || '').replace(/\\s+/g, ' ').trim();";

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
  check(`fixture bootstrap without error (${url.replace(APP, '')})`, !bootError, bootError || 'ok');
}

function writeEvidence(extra) {
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  const record = {
    generatedAt: new Date().toISOString(),
    kind: 'fixture-browser-check',
    task: 'BE-34 (#81) Lees met AI met één klik en een nieuw restaurant zoeken op naam',
    port: PORT,
    screenshotsDir: 'ops/browser/evidence/be-34',
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

async function focusOn(cdp, selector) {
  await evalJs(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'instant' });
      return true;
    })()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function clickByText(cdp, text, selector = 'button, a') {
  return evalJs(
    cdp,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) => (candidate.innerText || '').includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
}

async function setFieldValue(cdp, selector, value) {
  return evalJs(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
}

/** The one AI row of the fixture, wherever it is rendered. */
async function readAiRow(cdp) {
  return evalJs(
    cdp,
    `(() => {
      ${PAGE_FLAT_TEXT}
      const box = document.querySelector('.srr-ai');
      const button = box ? box.querySelector('.srr-action') : null;
      const paste = box ? box.querySelector('.srr-paste-link') : null;
      const next = box ? box.querySelector('a.stg-btn-secondary') : null;
      return {
        present: Boolean(box),
        line: box && box.querySelector('.srr-ai-line') ? flat(box.querySelector('.srr-ai-line').innerText) : '',
        hint: box && box.querySelector('.srr-ai-hint') ? flat(box.querySelector('.srr-ai-hint').innerText) : '',
        action: button ? flat(button.innerText) : '',
        actionTag: button ? button.tagName.toLowerCase() : '',
        paste: paste ? flat(paste.innerText) : '',
        pasteHref: paste ? paste.getAttribute('href') : null,
        next: next ? flat(next.innerText) : '',
        nextHref: next ? next.getAttribute('href') : null,
        rowText: box && box.closest('tr, li') ? box.closest('tr, li').innerText : '',
        theme: document.documentElement.getAttribute('data-theme'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`,
  );
}

// ── 1-4. The row: before, during, after the reading, then the review screen ──

async function rowScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 950 : 844);
  const query = `theme=${theme}&fixture=eenKlik&navCounts=bronnen&aiState=slow`;
  await open(
    cdp,
    `${APP}/internal/coverage?${query}`,
    `document.body.innerText.includes('Nog niet gecontroleerd')`,
  );
  const ready = await waitFor(cdp, `Boolean(document.querySelector('.srr-ai'))`, 60000);
  check(`rij (${width}/${theme}): de rij met de AI-stap staat er`, ready);
  if (!ready) return;
  const before = await readAiRow(cdp);
  check(`rij (${width}/${theme}): de knop is "📷 Lees met AI (afbeelding)"`, before.action === '📷 Lees met AI (afbeelding)', before.action);
  check(`rij (${width}/${theme}): de knop is een knop, geen link`, before.actionTag === 'button', before.actionTag);
  check(`rij (${width}/${theme}): de kostenschatting staat erbij`, /± 1 minuut · ± 1 cent/.test(before.hint), before.hint);
  check(
    `rij (${width}/${theme}): de handmatige import is alleen de kleine link "Liever zelf plakken"`,
    before.paste === 'Liever zelf plakken' && String(before.pasteHref).startsWith('/internal/menu-import?restaurant='),
    JSON.stringify({ paste: before.paste, href: before.pasteHref }),
  );
  check(`rij (${width}/${theme}): de gevraagde theme is actief`, before.theme === theme, before.theme);
  check(`rij (${width}/${theme}): geen horizontale overloop`, before.overflow <= 0, `overflow=${before.overflow}`);
  await focusOn(cdp, '.cov-check-table tbody tr');
  await shot(cdp, `be34-rij-voor-${width}-${theme}.png`, { scenario: 'rij', state: 'voor', theme });

  // The click starts the existing server-side reading; the fixture holds the
  // answer for 2.5 s so the real progress state is visible.
  const clicked = await clickByText(cdp, 'Lees met AI', '.srr-ai button');
  check(`rij (${width}/${theme}): de knop start de lezing met één klik`, clicked);
  const reading = await waitFor(cdp, `((document.querySelector('.srr-ai-line') || {}).innerText || '').includes('AI leest de kaart')`, 20000);
  check(`rij (${width}/${theme}): tijdens de lezing staat "⏳ AI leest de kaart… ± 1 minuut"`, reading);
  await focusOn(cdp, '.cov-check-table tbody tr');
  await shot(cdp, `be34-rij-tijdens-${width}-${theme}.png`, { scenario: 'rij', state: 'tijdens', theme });

  const done = await waitFor(cdp, `/gerechten gelezen/.test((document.querySelector('.srr-ai-line') || {}).innerText || '')`, 40000);
  check(`rij (${width}/${theme}): daarna staat de uitkomst in de rij`, done);
  const after = await readAiRow(cdp);
  check(
    `rij (${width}/${theme}): de uitkomst noemt de aantallen en "controle nodig"`,
    /^✅ \d+ gerechten gelezen · \d+ controle nodig$/.test(after.line),
    after.line,
  );
  check(`rij (${width}/${theme}): "Bekijk en controleer" opent het controlescherm`, after.action === 'Bekijk en controleer', after.action);
  check(`rij (${width}/${theme}): de gemeten kosten staan erbij`, /Kosten AI: 1 cent/.test(after.hint), after.hint);
  await focusOn(cdp, '.cov-check-table tbody tr');
  await shot(cdp, `be34-rij-na-${width}-${theme}.png`, { scenario: 'rij', state: 'na', theme });
}

// ── 4. The existing review screen, opened from "Bekijk en controleer" ─────────

let rewriteScriptId = null;

/**
 * The review screen is opened by the app itself (window.location.assign), so its
 * URL carries only the one-time handoff key. This script runs before the fixture
 * bootstrap and adds the fixture and the theme to exactly that URL. The theme
 * travels in `window.name`, because a new document starts with a fresh fixture
 * storage. It changes no app code and no app data.
 */
function handoffDefaultsScript() {
  return `(() => {
    try {
      const url = new URL(window.location.href);
      if (url.pathname.startsWith('/internal/menu-import') && url.searchParams.has('ai') && !url.searchParams.has('fixture')) {
        const theme = String(window.name || '').indexOf('be34-theme=light') === 0 ? 'light' : 'dark';
        url.searchParams.set('fixture', 'eenKlik');
        url.searchParams.set('theme', theme);
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    } catch (ignored) {}
  })()`;
}

async function rememberTheme(cdp, theme) {
  await evalJs(cdp, `(() => { window.name = ${JSON.stringify(`be34-theme=${theme}`)}; return window.name; })()`);
}

async function readReview(cdp) {
  return evalJs(
    cdp,
    `(() => {
      ${PAGE_FLAT_TEXT}
      const summaries = [...document.querySelectorAll('.mai-summary')].map((el) => flat(el.innerText));
      const bulk = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Alles nagelopen'));
      const toggle = [...document.querySelectorAll('.mai-view-btn')].map((b) => flat(b.innerText));
      return {
        ready: summaries.length > 0,
        summaries,
        bulk: bulk ? flat(bulk.innerText) : '',
        toggle,
        aiCard: (document.querySelector('.mai-ai') || {}).innerText || '',
        manualVisible: Boolean(document.querySelector('.mai-prompt')) || document.body.innerText.includes('Prompt maken'),
        theme: document.documentElement.getAttribute('data-theme'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        url: window.location.pathname + window.location.search,
      };
    })()`,
  );
}

async function reviewScenario(cdp, width, theme) {
  await rememberTheme(cdp, theme);
  const clicked = await clickByText(cdp, 'Bekijk en controleer', '.srr-ai button');
  check(`review (${width}/${theme}): "Bekijk en controleer" is geklikt`, clicked);
  if (!clicked) return;
  const ready = await waitFor(
    cdp,
    `document.body.innerText.includes('Nalopen en opslaan') && Boolean(document.querySelector('.mai-summary'))`,
    90000,
  );
  check(`review (${width}/${theme}): het bestaande controlescherm opent met het resultaat geladen`, ready);
  if (!ready) return;
  // De pagina bouwt de AI-kaart en de ingeklapte handmatige import in stappen
  // op. Lees de toestand pas als de handmatige import echt dicht is; anders
  // meet de controle een tussenstand in plaats van het eindbeeld.
  await waitFor(cdp, `!document.body.innerText.includes('Prompt maken')`, 3000);
  const page = await readReview(cdp);
  check(`review (${width}/${theme}): de tussenstap is de bestaande pagina`, page.url.startsWith('/internal/menu-import?ai='), page.url);
  check(
    `review (${width}/${theme}): de samenvatting van de lezing staat er al`,
    Array.isArray(page.summaries) &&
      page.summaries.some((entry) => /2 gerechten · 0 in orde · 2 nalopen/.test(flatText(entry))),
    JSON.stringify(page.summaries),
  );
  check(
    `review (${width}/${theme}): "🖐 Alles nagelopen (2)" staat klaar`,
    page.bulk === '🖐 Alles nagelopen (2)',
    page.bulk,
  );
  check(
    `review (${width}/${theme}): de schakelaar Lijst | Kaart staat er`,
    page.toggle.includes('Lijst') && page.toggle.includes('Kaart'),
    JSON.stringify(page.toggle),
  );
  check(`review (${width}/${theme}): de handmatige import blijft ingeklapt`, page.manualVisible === false);
  check(`review (${width}/${theme}): de gevraagde theme is actief`, page.theme === theme, page.theme);
  check(`review (${width}/${theme}): geen horizontale overloop`, page.overflow <= 0, `overflow=${page.overflow}`);
  await focusOn(cdp, '.mai-summary');
  await shot(cdp, `be34-review-${width}-${theme}.png`, { scenario: 'review', theme });
}

// ── 5. A failed reading: an honest reason and "✍️ Handmatig toevoegen" ──────────

async function failureScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 950 : 844);
  await open(
    cdp,
    `${APP}/internal/coverage?theme=${theme}&fixture=eenKlikFout&navCounts=bronnen`,
    `document.body.innerText.includes('Nog niet gecontroleerd')`,
  );
  const ready = await waitFor(cdp, `Boolean(document.querySelector('.srr-ai'))`, 60000);
  check(`fout (${width}/${theme}): de rij staat er`, ready);
  if (!ready) return;
  await clickByText(cdp, 'Lees met AI', '.srr-ai button');
  const failed = await waitFor(cdp, `/niet bereikbaar/.test((document.querySelector('.srr-ai-line') || {}).innerText || '')`, 30000);
  check(`fout (${width}/${theme}): de mislukte lezing zegt het eerlijk`, failed);
  const row = await readAiRow(cdp);
  check(
    `fout (${width}/${theme}): de reden staat in gewone taal`,
    row.line === 'De AI is nu niet bereikbaar (server bezet).',
    row.line,
  );
  check(
    `fout (${width}/${theme}): de volgende stap is "✍️ Handmatig toevoegen"`,
    row.next === '✍️ Handmatig toevoegen' && String(row.nextHref).startsWith('/internal/menu-import'),
    JSON.stringify({ next: row.next, href: row.nextHref }),
  );
  check(`fout (${width}/${theme}): geen horizontale overloop`, row.overflow <= 0, `overflow=${row.overflow}`);
  await focusOn(cdp, '.cov-check-table tbody tr');
  await shot(cdp, `be34-rij-fout-${width}-${theme}.png`, { scenario: 'rij', state: 'fout', theme });
}

// ── 6. "✨ Zoek op internet: Bobby's Bar, Breda" ──────────────────────────────

async function readNameProposal(cdp) {
  return evalJs(
    cdp,
    `(() => {
      ${PAGE_FLAT_TEXT}
      const section = document.getElementById('add-name-proposal');
      const card = section ? section.closest('section') : null;
      const link = card ? [...card.querySelectorAll('a')].find((a) => (a.innerText || '').includes('Toevoegen als nieuw restaurant')) : null;
      const offered = [...document.querySelectorAll('.mai-discovery button')].find((b) => (b.innerText || '').includes('Zoek op internet'));
      return {
        offered: offered ? flat(offered.innerText) : '',
        card: card ? card.innerText.replace(/\\n/g, ' | ') : '',
        href: link ? link.getAttribute('href') : null,
        theme: document.documentElement.getAttribute('data-theme'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`,
  );
}

async function nameScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 950 : 844);
  await open(
    cdp,
    `${APP}/internal/toevoegen?theme=${theme}&fixture=eenKlik`,
    `document.body.innerText.includes('Restaurant of menu toevoegen')`,
  );
  const typed = await setFieldValue(cdp, '#add-restaurant', "Bobby's Bar");
  check(`naam (${width}/${theme}): de naam is getypt`, typed);
  const offered = await waitFor(
    cdp,
    `[...document.querySelectorAll('.mai-discovery button')].some((b) => (b.innerText || '').includes('Zoek op internet'))`,
    30000,
  );
  check(`naam (${width}/${theme}): een onbekende naam biedt het zoeken op internet aan`, offered);
  if (!offered) return;
  const before = await readNameProposal(cdp);
  check(
    `naam (${width}/${theme}): de knop heet "✨ Zoek op internet: Bobby's Bar, Breda"`,
    before.offered === "✨ Zoek op internet: Bobby's Bar, Breda",
    before.offered,
  );
  check(`naam (${width}/${theme}): geen horizontale overloop`, before.overflow <= 0, `overflow=${before.overflow}`);
  await focusOn(cdp, '.mai-discovery');
  await shot(cdp, `be34-naam-zoeken-${width}-${theme}.png`, { scenario: 'naam', state: 'voor', theme });

  const clicked = await clickByText(cdp, 'Zoek op internet', '.mai-discovery button');
  check(`naam (${width}/${theme}): de zoekactie start met één klik`, clicked);
  const found = await waitFor(cdp, `Boolean(document.getElementById('add-name-proposal'))`, 30000);
  check(`naam (${width}/${theme}): het voorstel verschijnt`, found);
  if (!found) return;
  const page = await readNameProposal(cdp);
  const text = flatText(page.card);
  check(`naam (${width}/${theme}): het voorstel toont de naam`, text.includes("Bobby's Bar"), text.slice(0, 160));
  check(`naam (${width}/${theme}): het voorstel toont het adres`, text.includes('Haven 1, 4811 AB Breda'));
  check(`naam (${width}/${theme}): het voorstel toont de website`, text.includes('https://bobbys-bar.invalid'));
  check(`naam (${width}/${theme}): het voorstel toont de menulink`, text.includes('https://bobbys-bar.invalid/menukaart'));
  check(`naam (${width}/${theme}): het voorstel toont de herkomst`, /Herkomst: .*AI-zoeken/.test(text), text.slice(0, 200));
  check(`naam (${width}/${theme}): de kosten zijn zichtbaar`, /Kosten AI: 3 cent/.test(text), text.slice(-160));
  check(
    `naam (${width}/${theme}): "Toevoegen als nieuw restaurant" opent de bestaande onboarding met de gegevens`,
    typeof page.href === 'string' &&
      page.href.startsWith('/internal/onboarding-restaurant?') &&
      page.href.includes('naam=Bobby') &&
      page.href.includes('adres=Haven') &&
      page.href.includes('website=https%3A%2F%2Fbobbys-bar.invalid'),
    page.href,
  );
  check(`naam (${width}/${theme}): niets wordt automatisch aangemaakt`, text.includes('niets automatisch aangemaakt'));
  check(`naam (${width}/${theme}): de gevraagde theme is actief`, page.theme === theme, page.theme);
  check(`naam (${width}/${theme}): geen horizontale overloop`, page.overflow <= 0, `overflow=${page.overflow}`);
  await focusOn(cdp, '#add-name-proposal');
  await shot(cdp, `be34-naam-voorstel-${width}-${theme}.png`, { scenario: 'naam', state: 'gevonden', theme });
}

async function warmUp(cdp) {
  await setViewport(cdp, 1280, 900);
  await navigate(cdp, `${START_URL}?theme=light&fixture=eenKlik&navCounts=bronnen`, `document.body.innerText.includes('Dekking')`).catch(() => {});
  await navigate(cdp, `${APP}/internal/toevoegen?theme=light&fixture=eenKlik`, `document.body.innerText.includes('Restaurant of menu toevoegen')`).catch(() => {});
  await navigate(cdp, `${APP}/internal/menu-import?theme=light&fixture=eenKlik`, `document.body.innerText.includes('controle')`).catch(() => {});
  check('warm-up: the three routes compile', true);
}

// BE-43 (#101): elk scenario is één benoemde stap. Met `--alleen=<naam>` draait
// alleen die stap; met `--lijst` zie je de namen zonder dat er iets start.
// Zonder vlag draait alles over de volledige matrix.
// For a quick smoke run: EEN_KLIK_MATRIX="1280:light" limits the matrix. The
// default is the full contract matrix (two widths, light and dark).
const MATRIX = (() => {
  const requested = String(process.env.EEN_KLIK_MATRIX || '').trim();
  return requested
    ? requested
        .split(',')
        .map((entry) => entry.split(':'))
        .filter((parts) => parts.length === 2)
        .map(([width, theme]) => ({ width: Number(width), theme }))
        .filter((entry) => Number.isInteger(entry.width) && entry.width > 0 && (entry.theme === 'light' || entry.theme === 'dark'))
    : [
        { width: 1280, theme: 'light' },
        { width: 1280, theme: 'dark' },
        { width: 390, theme: 'light' },
        { width: 390, theme: 'dark' },
      ];
})();
const CHECK_SCENARIOS = [
  {
    name: 'rij',
    run: async (cdp) => {
      for (const { width, theme } of MATRIX) await rowScenario(cdp, width, theme);
    },
  },
  {
    name: 'controlescherm',
    run: async (cdp) => {
      for (const { width, theme } of MATRIX) {
        // BE-43 split the original row → review loop into separate scenarios.
        // The review step opens the row's own done state ("Bekijk en
        // controleer" only exists there), so it brings that state with it for
        // the same viewport and theme. No app change; only the check's own
        // starting point.
        await rowScenario(cdp, width, theme);
        await reviewScenario(cdp, width, theme);
      }
    },
  },
  {
    name: 'mislukte-lezing',
    run: async (cdp) => {
      for (const { width, theme } of MATRIX) await failureScenario(cdp, width, theme);
    },
  },
  {
    name: 'zoeken-op-naam',
    run: async (cdp) => {
      for (const { width, theme } of MATRIX) await nameScenario(cdp, width, theme);
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
      writeEvidence({ error: `run_timeout (${WATCHDOG_MIN} min)` });
    } catch (ignored) {
      // Best effort inside the watchdog.
    }
    process.exit(2);
  }, WATCHDOG_MIN * 60 * 1000);
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
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: '/internal/coverage' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const networkGuard = createNetworkGuard({ appOrigins: APP_ORIGINS, baseUrl: START_URL });
    await enableFetchGuard(cdp, networkGuard);
    // The handoff rewrite runs first, so the fixture bootstrap reads the final
    // URL (fixture and theme included) of the review screen.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: handoffDefaultsScript() });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureBootstrap(FIXTURES, { appOrigins: APP_ORIGINS, baseUrl: START_URL }),
    });

    console.log('warm-up: compiling the routes and the APIs');
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

