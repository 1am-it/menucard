'use strict';

// BE-32 (#75) — fixture browser check for the new "Vind bronnen" work:
// the Dutch Dekking top (mockup screen 5), "✨ Vind bronnen" with its summary and
// cost, "🆕 Nieuw gevonden" (screen 8) and "✨ Zoek de bron voor mij" in
// "Restaurant of menu toevoegen" (screen 7), at 1280, 390 and 320 px in light
// and dark.
//
// It drives the real routes and components in a local `next dev` with a
// fictional in-page session and fictional API answers (fixtures/bronnenFixtures.js).
// FIXTURE EVIDENCE: the engine itself never runs here — no Overpass request, no
// AI call — and no production credential, identity or data is used. Screenshots
// go to ops/browser/evidence/be-32/.

const fs = require('node:fs');
const path = require('node:path');

const { fixtureBootstrap } = require('./lib/fixture-page');
const baseFixtures = require('./fixtures/menuReviewFixtures').scenarios;
const { SCENARIOS } = require('./fixtures/bronnenFixtures');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const { findBrowser, killTree, startServer, startBrowser, evalJs, waitFor, navigate, screenshot } = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');

const OUT_DIR = path.join(__dirname, 'output', 'be-32');
const SHOTS_DIR = path.join(__dirname, 'evidence', 'be-32');
const EVIDENCE_PATH = path.join(__dirname, 'evidence', 'vind-bronnen-browser-evidence.json');
const PORT = Number(process.env.BRONNEN_FIXTURE_PORT || 3141);
const APP = `http://localhost:${PORT}`;
const START_URL = `${APP}/internal/coverage`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const FIXTURES = { ...baseFixtures, ...SCENARIOS };

const checks = [];
const shots = [];
let viewport = { width: 1280, height: 900 };

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

function writeEvidence(extra) {
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  const record = {
    generatedAt: new Date().toISOString(),
    kind: 'fixture-browser-check',
    task: 'BE-32 (#75) Vind bronnen met OpenStreetMap en AI, Nieuw gevonden en de Dekking-kop',
    port: PORT,
    screenshotsDir: 'ops/browser/evidence/be-32',
    screenshots: shots,
    checks,
    passed: checks.length > 0 && checks.every((entry) => entry.passed),
    ...extra,
  };
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(record, null, 2));
  return record;
}

/** The visible top of Dekking plus the section headers and the row actions. */
async function readCoverage(cdp) {
  return evalJs(cdp, `(() => {
    const rows = [...document.querySelectorAll('.cov-check-table tbody tr')].map((tr) => ({
      text: tr.innerText.replace(/\\n/g, ' | '),
      action: ((tr.querySelector('.cov-check-action') || {}).textContent || '').trim(),
    }));
    const newRows = [...document.querySelectorAll('.cov-new tbody tr')].map((tr) => tr.innerText.replace(/\\n/g, ' | '));
    return {
      title: (document.querySelector('.cov-title') || {}).textContent || '',
      tiles: [...document.querySelectorAll('.cov-tile')].map((tile) => tile.innerText.replace(/\\n/g, ' ')),
      head: (document.querySelector('.cov-check-title') || {}).textContent || '',
      buttons: [...document.querySelectorAll('.cov-check-head button')].map((b) => b.innerText.trim()),
      discovery: (document.querySelector('.cov-discovery') || {}).innerText || '',
      newHeading: (document.querySelector('#cov-new-title') || {}).textContent || '',
      newRows,
      newActions: [...document.querySelectorAll('.cov-new-actions')].map((box) => box.innerText.replace(/\\n/g, ' | ')),
      rows,
      bodyText: (document.querySelector('main') || {}).innerText || '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      theme: document.documentElement.getAttribute('data-theme'),
    };
  })()`);
}

async function coverageTopScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 1000 : 844);
  await open(
    cdp,
    `${APP}/internal/coverage?theme=${theme}&fixture=vindBronnen&navCounts=bronnen`,
    `document.body.innerText.includes('Dekking')`,
  );
  await waitFor(cdp, `document.querySelectorAll('.cov-check-table tbody tr').length > 0`, 60000);
  await waitFor(cdp, `document.querySelectorAll('.cov-new tbody tr').length === 2`, 60000);
  const page = await readCoverage(cdp);
  check(`dekking-kop (${width}/${theme}): the Dutch title is shown`, flatText(page.title) === 'Dekking 📊', page.title);
  check(
    `dekking-kop (${width}/${theme}): exactly three tiles — restaurants, met menukaart, nog niet gecontroleerd`,
    page.tiles.length === 3 &&
      page.tiles[0].includes('restaurants') &&
      page.tiles[1].includes('met menukaart') &&
      page.tiles[2].includes('nog niet gecontroleerd'),
    JSON.stringify(page.tiles),
  );
  check(
    `dekking-kop (${width}/${theme}): "✨ Vind bronnen (N)" and the existing check button are both offered`,
    page.buttons.some((label) => /^✨ Vind bronnen \(\d+\)/.test(label)) && page.buttons.some((label) => label.includes('Controleer')),
    JSON.stringify(page.buttons),
  );
  check(
    `dekking-kop (${width}/${theme}): the found proposal is a row with "Bevestig voorstel" and its provenance`,
    page.rows.some((row) => row.action === '✅ Bevestig voorstel' && /OpenStreetMap/.test(row.text)),
    JSON.stringify(page.rows.map((row) => row.action)),
  );
  check(`theme (${width}/${theme}): the requested theme is active`, page.theme === theme, page.theme);
  check(`dekking-kop (${width}/${theme}): no horizontal overflow`, page.overflow <= 0, `overflow=${page.overflow}`);
  await shot(cdp, `be32-dekking-kop-${width}-${theme}.png`, { screen: 5, part: 'kop', theme });

  // "✨ Vind bronnen": the run itself, its summary, its cost and the honest
  // notices. The fixture answers exactly like the engine does.
  await evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('.cov-check-head button')].find((b) => b.innerText.includes('Vind bronnen'));
    if (button) button.click();
    return true;
  })()`);
  const ran = await waitFor(cdp, `Boolean(document.querySelector('.cov-discovery'))`, 30000);
  check(`vind-bronnen (${width}/${theme}): the summary appears after the run`, ran);
  const after = await readCoverage(cdp);
  check(
    `vind-bronnen (${width}/${theme}): the summary names the layers and the proposal`,
    /websites? voorgesteld/.test(after.discovery) && /OpenStreetMap/.test(after.discovery) && /niet gevonden/.test(after.discovery),
    after.discovery,
  );
  check(
    `vind-bronnen (${width}/${theme}): the AI cost and the attribution are visible`,
    /Kosten AI: 2 cent/.test(after.discovery) && /OpenStreetMap-bijdragers/.test(after.discovery),
    after.discovery,
  );
  check(`vind-bronnen (${width}/${theme}): no horizontal overflow`, after.overflow <= 0, `overflow=${after.overflow}`);
  await evalJs(cdp, `document.querySelector('.cov-check').scrollIntoView({ block: 'start' })`);
  await shot(cdp, `be32-vind-bronnen-${width}-${theme}.png`, { screen: 5, part: 'vind-bronnen', theme });

  // "🆕 Nieuw gevonden": name, address, kind, the two actions and the attribution.
  const found = await readCoverage(cdp);
  check(
    `nieuw-gevonden (${width}/${theme}): the section counts and explains itself`,
    /Nieuw gevonden \(2\)/.test(found.newHeading) && found.newRows.length === 2,
    `${found.newHeading} / ${found.newRows.length}`,
  );
  check(
    `nieuw-gevonden (${width}/${theme}): every row offers "＋ Toevoegen" and "Negeren"`,
    found.newActions.length === 2 && found.newActions.every((text) => text.includes('＋ Toevoegen') && text.includes('Negeren')),
    JSON.stringify(found.newActions),
  );
  check(
    `nieuw-gevonden (${width}/${theme}): "Dekking voegt nooit zelf iets toe" and the attribution are stated`,
    /Dekking voegt nooit zelf iets toe/.test(found.bodyText) && flatText(found.bodyText).includes('© OpenStreetMap-bijdragers'),
  );
  await evalJs(cdp, `document.querySelector('.cov-new').scrollIntoView({ block: 'start' })`);
  await shot(cdp, `be32-nieuw-gevonden-${width}-${theme}.png`, { screen: 8, theme });

  // The add link carries the filled-in values.
  const addHref = await evalJs(cdp, `(() => { const a = document.querySelector('.cov-new-actions a'); return a ? a.getAttribute('href') : null; })()`);
  check(
    `nieuw-gevonden (${width}/${theme}): "＋ Toevoegen" opens the form with name, address and website`,
    typeof addHref === 'string' && /naam=/.test(addHref) && /adres=/.test(addHref) && /website=/.test(addHref),
    addHref,
  );
}

async function addScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 900 : 844);
  const prefill =
    'naam=Trattoria+Fictief&adres=Havermarkt+1%2C+4811+WJ+Breda&website=https%3A%2F%2Ftrattoria-fictief.invalid&osm=node%2Ffictief-1';
  await open(
    cdp,
    `${APP}/internal/toevoegen?theme=${theme}&fixture=vindBronnen&navCounts=bronnen&${prefill}`,
    `document.body.innerText.includes('Restaurant of menu toevoegen')`,
  );
  const prefilled = await evalJs(cdp, `(() => ({
    name: (document.getElementById('add-restaurant') || {}).value || '',
    urls: (document.getElementById('add-urls') || {}).value || '',
    text: document.querySelector('form') ? document.querySelector('form').innerText : '',
    buttons: [...document.querySelectorAll('.mai-discovery button')].map((b) => b.innerText.trim()),
  }))()`);
  check(
    `scherm 7 (${width}/${theme}): name, website and the OSM line are filled in`,
    prefilled.name === 'Trattoria Fictief' &&
      prefilled.urls === 'https://trattoria-fictief.invalid' &&
      /Ingevuld uit OpenStreetMap/.test(prefilled.text),
    JSON.stringify({ name: prefilled.name, urls: prefilled.urls }),
  );
  check(
    `scherm 7 (${width}/${theme}): "✨ Zoek de bron voor mij" is offered`,
    prefilled.buttons.some((label) => label.includes('✨ Zoek de bron voor mij')),
    JSON.stringify(prefilled.buttons),
  );

  // Choose the fixture restaurant through the real search, then run the engine.
  await evalJs(cdp, `(() => {
    const input = document.getElementById('add-restaurant');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Fictief');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const choice = await waitFor(cdp, `Boolean(document.querySelector('.mai-choice'))`, 20000);
  check(`scherm 7 (${width}/${theme}): the restaurant search answers with a choice`, choice);
  if (!choice) return;
  await evalJs(cdp, `(() => { const b = document.querySelector('.mai-choice'); if (b) b.click(); return true; })()`);
  await waitFor(cdp, `!document.querySelector('.mai-discovery button').disabled`, 10000);
  await evalJs(cdp, `(() => { const b = document.querySelector('.mai-discovery button'); if (b) b.click(); return true; })()`);
  const rows = await waitFor(cdp, `Boolean(document.getElementById('add-discovery-title'))`, 30000);
  check(`scherm 7 (${width}/${theme}): the result appears as the same rows as Dekking`, rows);
  const result = await evalJs(cdp, `(() => {
    const section = document.getElementById('add-discovery-title');
    const card = section ? section.closest('section') : null;
    const rows = [...document.querySelectorAll('.srr-row')].map((row) => ({
      text: row.innerText.replace(/\\n/g, ' | '),
      action: ((row.querySelector('.srr-action') || row.querySelector('.srr-wait') || {}).textContent || '').trim(),
    }));
    return { section: card ? card.innerText.replace(/\\n/g, ' | ') : '', rows };
  })()`);
  check(
    `scherm 7 (${width}/${theme}): the found proposal offers "Bevestig voorstel" with its origin`,
    result.rows.some((row) => row.action === '✅ Bevestig voorstel' && /OpenStreetMap/.test(row.text)),
    JSON.stringify(result.rows.map((row) => row.action)),
  );
  check(
    `scherm 7 (${width}/${theme}): the not-found row says why, and nothing is published`,
    /Alleen bezorgplatforms gevonden \(genegeerd\)/.test(result.section) && /Niets wordt automatisch gepubliceerd/.test(result.section),
    result.section.slice(0, 240),
  );
  const overflow = await evalJs(cdp, 'document.documentElement.scrollWidth - window.innerWidth');
  check(`scherm 7 (${width}/${theme}): no horizontal overflow`, overflow <= 0, `overflow=${overflow}`);
  await evalJs(cdp, `document.getElementById('add-discovery-title').scrollIntoView({ block: 'start' })`);
  await shot(cdp, `be32-toevoegen-${width}-${theme}.png`, { screen: 7, theme });
}

async function warmUp(cdp) {
  await setViewport(cdp, 1280, 900);
  await open(cdp, `${APP}/internal/coverage?theme=light&fixture=vindBronnen&navCounts=bronnen`, `document.body.innerText.includes('Dekking')`);
  const ready = await waitFor(cdp, `Boolean(document.querySelector('.cov-tile'))`, 120000);
  check('warm-up: the route compiles and the Dekking top renders', ready);
}

async function main() {
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
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: '/internal/coverage' });
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
    for (const theme of ['light', 'dark']) {
      for (const width of [1280, 390, 320]) {
        console.log(`scenario: Dekking-kop, Vind bronnen, Nieuw gevonden ${width} ${theme}`);
        await coverageTopScenario(cdp, width, theme);
        console.log(`scenario: Zoek de bron voor mij ${width} ${theme}`);
        await addScenario(cdp, width, theme);
      }
    }

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
