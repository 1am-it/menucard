'use strict';

// BE-33 (#79) — fixture browser check for a menu that only exists as an image
// or a scan. It drives the real routes and the real components in a local
// `next dev`, with a fictional in-page session and fictional API answers.
// FIXTURE EVIDENCE: not live integration, not production acceptance, and no
// production credential, identity or data is used. No model is called.
//
// What it shows, at 1280 and 390 px in light and dark:
//   1. the result row of an image-only menu: "📷 Lees met AI (afbeelding)" when
//      the AI is on and the budget allows it, "✍️ Handmatig toevoegen" when not;
//   2. the Kaart view of the same menu: the image beside the dishes, each dish
//      with "Controle nodig" and "gelezen van afbeelding N", and "Nalopen in de
//      lijst" back to that row.
//
// Screenshots go to ops/browser/evidence/be-33/ (also git-ignored output/).

const fs = require('node:fs');
const path = require('node:path');

const { fixtureBootstrap } = require('./lib/fixture-page');
const menuReviewFixtures = require('./fixtures/menuReviewFixtures');
const { SCENARIOS } = require('./fixtures/bronnenFixtures');
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

const OUT_DIR = path.join(__dirname, 'output', 'be-33');
const SHOTS_DIR = path.join(__dirname, 'evidence', 'be-33');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'beeld-lezen-browser-evidence.json');
const PORT = Number(process.env.BEELD_FIXTURE_PORT || 3140);
const APP = `http://localhost:${PORT}`;
const START_URL = `${APP}/internal/bronnen`;
const MANUAL_URL = `${APP}/internal/menu-import`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const FIXTURES = { ...menuReviewFixtures.scenarios, ...SCENARIOS };
// A cold `next dev` compiles a route per scenario; the full matrix (two widths,
// light and dark) takes about 20 minutes on this machine. The watchdog only
// exists so a hung browser can never block the round; it is not a deadline.
const WATCHDOG_MIN = Number(process.env.BEELD_WATCHDOG_MIN || 40);

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

/**
 * Brings one element into view before a screenshot. A screenshot captures the
 * viewport, so without this the image and the dish list could be below the fold
 * and two different pages would look identical.
 */
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
  await new Promise((resolve) => setTimeout(resolve, 350));
}

async function open(cdp, url, readyExpression) {
  await navigate(cdp, url, readyExpression);
  const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
  check(`fixture bootstrap without error (${url.replace(APP, '')})`, !bootError, bootError || 'ok');
}

function writeEvidence(extra) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const record = {
    generatedAt: new Date().toISOString(),
    kind: 'fixture-browser-check',
    task: 'BE-33 (#79) Menukaarten die alleen als afbeelding of scan bestaan',
    port: PORT,
    screenshotsDir: 'ops/browser/evidence/be-33',
    screenshots: shots,
    checks,
    passed: checks.length > 0 && checks.every((entry) => entry.passed),
    ...extra,
  };
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(record, null, 2));
  return record;
}

async function clickButton(cdp, label) {
  return evalJs(
    cdp,
    `(() => {
      const el = [...document.querySelectorAll('button, a')].find((candidate) => (candidate.innerText || '').trim() === ${JSON.stringify(label)});
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

// ── 1. De rijstap: eerlijk bij een menu dat alleen als afbeelding bestaat ────

async function readRow(cdp) {
  return evalJs(
    cdp,
    `(() => {
      const rows = [...document.querySelectorAll('.cov-check-table tbody tr')];
      const row = rows.find((candidate) => (candidate.innerText || '').includes('Fictief Al Dente')) || rows[0] || null;
      // BE-34 (#81): the AI step is a button in the row now; a manual step is
      // still the existing link. Both are read here.
      const actionEl = row ? row.querySelector('a.cov-check-action, button.cov-check-action, .srr-action') : null;
      const paste = row ? row.querySelector('.srr-paste-link') : null;
      const hint = row ? row.querySelector('.srr-ai-hint') : null;
      return {
        present: Boolean(row),
        text: document.body.innerText,
        rowText: row ? row.innerText : '',
        outcome: row && row.querySelector('.cov-check-outcome') ? row.querySelector('.cov-check-outcome').innerText.trim() : '',
        action: actionEl ? actionEl.innerText.trim() : '',
        actionTag: actionEl ? actionEl.tagName.toLowerCase() : '',
        href: actionEl ? actionEl.getAttribute('href') : null,
        paste: paste ? paste.innerText.trim() : '',
        pasteHref: paste ? paste.getAttribute('href') : null,
        hint: hint ? hint.innerText.trim() : '',
        aiLabels: [...document.querySelectorAll('a.cov-check-action, button.cov-check-action, .srr-action')].map((el) => (el.innerText || '').trim()),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        theme: document.documentElement.getAttribute('data-theme'),
      };
    })()`,
  );
}

async function rowScenario(cdp, width, theme, aiState) {
  await setViewport(cdp, width, width === 1280 ? 900 : 844);
  // A menu that only exists as an image is a dead end, not a ready decision:
  // exactly the owner decision of 2026-10-27 puts such a restaurant in Dekking
  // ("Nog niet gecontroleerd") with its own fitting next step in the row.
  const query = `theme=${theme}&fixture=beeldLezen&navCounts=bronnen${aiState === 'off' ? '&aiState=off' : ''}`;
  await open(cdp, `${APP}/internal/coverage?${query}`, `document.body.innerText.includes('Nog niet gecontroleerd')`);
  const ready = await waitFor(cdp, `document.querySelectorAll('.cov-check-table tbody tr').length >= 1`, 45000);
  check(`rij (${width}/${theme}/${aiState}): de rij van het beeld-restaurant staat er`, ready);
  const row = await readRow(cdp);
  check(`rij (${width}/${theme}/${aiState}): de gevraagde theme is actief`, row.theme === theme, row.theme);
  check(`rij (${width}/${theme}/${aiState}): geen horizontale overloop`, row.overflow <= 0, `overflow=${row.overflow}`);
  // Criterion 1: the old "leest geen beeld" sentence may never come back.
  check(
    `rij (${width}/${theme}/${aiState}): de oude tekst "leest geen beeld" staat er niet meer`,
    !flatText(row.text).includes('leest geen beeld'),
  );
  check(
    `rij (${width}/${theme}/${aiState}): de reden en de eerlijke uitleg staan in de rij`,
    flatText(row.rowText).includes('Laatste controle gaf geen bruikbaar resultaat') &&
      flatText(row.rowText).includes('Automatisch is er niets als gerecht opgeslagen'),
    flatText(row.rowText).slice(0, 240),
  );
  if (aiState === 'off') {
    check(
      `rij (${width}/${theme}/${aiState}): zonder AI is de stap "Handmatig toevoegen"`,
      row.action === '✍️ Handmatig toevoegen',
      JSON.stringify({ action: row.action, labels: row.aiLabels }),
    );
    check(
      `rij (${width}/${theme}/${aiState}): die stap opent de bestaande handmatige import`,
      typeof row.href === 'string' && row.href.startsWith('/internal/menu-import?restaurant=9010') && !row.href.includes('image=1'),
      row.href,
    );
    check(
      `rij (${width}/${theme}/${aiState}): er is geen "Lees met AI" die niets kan`,
      !row.aiLabels.some((label) => label.includes('Lees met AI')),
      JSON.stringify(row.aiLabels),
    );
  } else {
    check(
      `rij (${width}/${theme}/${aiState}): met AI en budget is de stap "📷 Lees met AI (afbeelding)"`,
      row.action === '📷 Lees met AI (afbeelding)',
      JSON.stringify({ action: row.action, labels: row.aiLabels }),
    );
    // BE-34 (#81, criterion 1): that step starts the existing reading in the row
    // itself; the manual import is only the small link "Liever zelf plakken".
    check(
      `rij (${width}/${theme}/${aiState}): de stap is een knop die de bestaande lezing start`,
      row.actionTag === 'button',
      row.actionTag,
    );
    check(
      `rij (${width}/${theme}/${aiState}): de handmatige import staat er alleen als kleine link "Liever zelf plakken"`,
      row.paste === 'Liever zelf plakken' &&
        typeof row.pasteHref === 'string' &&
        row.pasteHref.startsWith('/internal/menu-import?restaurant=9010') &&
        !row.pasteHref.includes('image=1'),
      JSON.stringify({ paste: row.paste, href: row.pasteHref }),
    );
    check(
      `rij (${width}/${theme}/${aiState}): de kostenschatting staat vooraf in de rij`,
      /± 1 minuut · ± 1 cent/.test(row.hint),
      row.hint,
    );
  }
  await focusOn(cdp, '.cov-check-table');
  await shot(cdp, `be33-rij-${width}-${theme}-${aiState}.png`, { scenario: 'row', aiState });
}


// ── 2. De kaartweergave: de afbeelding naast de lijst ───────────────────────

function imageReviewUrl(theme) {
  const params = new URLSearchParams({
    fixture: 'manual-image',
    restaurant: menuReviewFixtures.RESTAURANT.id,
    name: menuReviewFixtures.RESTAURANT.name,
    url: 'https://fictief-brasserie.invalid/menukaart',
    aiState: 'off',
    theme,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

async function openImageReview(cdp, theme) {
  await open(cdp, imageReviewUrl(theme), `document.body.innerText.includes('Prompt maken')`);
  await clickButton(cdp, 'Prompt maken');
  await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
  await setFieldValue(cdp, '#mai-answer', 'Korte samenvatting.\n```json\n{"menus":[],"coverage":{}}\n```');
  await waitFor(cdp, `document.body.innerText.includes('Antwoord geplakt')`, 15000);
  await clickButton(cdp, 'Controleren');
  return waitFor(cdp, `Boolean(document.querySelector('.mai-view-toggle'))`, 20000);
}

async function readImageCard(cdp) {
  return evalJs(
    cdp,
    `(() => {
      const root = document.querySelector('.mai-map');
      const image = root ? root.querySelector('.mai-map-image') : null;
      const figure = root ? root.querySelector('.mai-map-figure') : null;
      const dishes = root ? [...root.querySelectorAll('.mai-map-dish')] : [];
      return {
        present: Boolean(root),
        src: image ? image.getAttribute('src') : null,
        alt: image ? image.getAttribute('alt') : null,
        loaded: Boolean(image && image.complete && image.naturalWidth > 0),
        figureText: figure ? figure.innerText.trim() : '',
        notice: root && root.querySelector('.mai-map-notice') ? root.querySelector('.mai-map-notice').innerText.trim() : '',
        error: root && root.querySelector('.mai-uncovered-unavailable') ? root.querySelector('.mai-uncovered-unavailable').innerText.trim() : null,
        waiting: root && root.querySelector('.bta-muted') ? root.querySelector('.bta-muted').innerText.trim() : null,
        dishes: dishes.map((dish) => ({
          name: (dish.querySelector('.mai-map-dish-name') || {}).innerText || '',
          badge: (dish.querySelector('.status-badge') || {}).innerText || '',
          provenance: (dish.querySelector('.mai-provenance') || {}).innerText || '',
          action: [...dish.querySelectorAll('button')].map((b) => b.innerText.trim()),
        })),
        toggles: [...document.querySelectorAll('.mai-view-btn')].map((el) => ({ text: el.innerText.trim(), pressed: el.getAttribute('aria-pressed') })),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        theme: document.documentElement.getAttribute('data-theme'),
      };
    })()`,
  );
}


async function imageMapScenario(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 900 : 844);
  const opened = await openImageReview(cdp, theme);
  check(`kaart (${width}/${theme}): de review opent met de schakelaar Lijst | Kaart`, opened);
  const toggles = await evalJs(cdp, `[...document.querySelectorAll('.mai-view-btn')].map((el) => ({ text: el.innerText.trim(), pressed: el.getAttribute('aria-pressed') }))`);
  check(
    `kaart (${width}/${theme}): de lijst staat aan en de kaart nog niet`,
    toggles.length === 2 && toggles[0].pressed === 'true' && toggles[1].pressed === 'false',
    JSON.stringify(toggles),
  );
  // Criterion 3: the same row in the list carries the origin and the label.
  const listRow = await evalJs(
    cdp,
    `(() => {
      const row = document.querySelector('.mai-review-row');
      return {
        badge: row && row.querySelector('.status-badge') ? row.querySelector('.status-badge').innerText.trim() : '',
        provenance: row && row.querySelector('.mai-provenance') ? row.querySelector('.mai-provenance').innerText.trim() : '',
      };
    })()`,
  );
  check(
    `lijst (${width}/${theme}): elk gerecht uit een afbeelding is "Controle nodig" met zijn herkomst`,
    listRow.badge === 'Controle nodig' && listRow.provenance === 'gelezen van afbeelding 1',
    JSON.stringify(listRow),
  );

  await clickButton(cdp, 'Kaart');
  const shown = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-imagegrid'))`, 20000);
  check(`kaart (${width}/${theme}): de kaart toont de afbeelding naast de lijst`, shown);
  // The image is lazy: bring it into view and wait until it is really decoded,
  // so the check and the screenshot see the same thing a human sees.
  await focusOn(cdp, '.mai-map-imagegrid');
  const imageLoaded = await waitFor(
    cdp,
    `(() => { const img = document.querySelector('.mai-map-image'); return Boolean(img && img.complete && img.naturalWidth > 0); })()`,
    15000,
  );
  const first = await readImageCard(cdp);
  if (!shown) console.log('kaart-debug:', JSON.stringify({ error: first.error, waiting: first.waiting, present: first.present }).slice(0, 500));
  check(
    `kaart (${width}/${theme}): de afbeelding van afbeelding 1 is geladen`,
    imageLoaded && first.loaded && Boolean(first.src && first.src.startsWith('data:image/png')),
    JSON.stringify({ imageLoaded, loaded: first.loaded, alt: first.alt }),
  );
  check(
    `kaart (${width}/${theme}): de afbeelding heeft een eerlijk alt en bijschrift`,
    flatText(first.alt).includes('Menukaart-afbeelding 1 van 2') && flatText(first.figureText).includes('Afbeelding 1 van 2'),
    JSON.stringify({ alt: first.alt, caption: first.figureText }),
  );
  check(
    `kaart (${width}/${theme}): de gelezen gerechten staan ernaast met "Controle nodig" en hun herkomst`,
    first.dishes.length === 1 &&
      flatText(first.dishes[0].name).includes('Fictieve steak') &&
      first.dishes[0].badge === 'Controle nodig' &&
      first.dishes[0].provenance === 'gelezen van afbeelding 1',
    JSON.stringify(first.dishes),
  );
  check(
    `kaart (${width}/${theme}): de kaart legt uit dat een afbeeldingscitaat niet te controleren is`,
    flatText(first.notice).includes('Controle nodig') && flatText(first.notice).includes('niet automatisch te vergelijken'),
    first.notice,
  );
  check(`kaart (${width}/${theme}): geen horizontale overloop`, first.overflow <= 0, `overflow=${first.overflow}`);
  check(`kaart (${width}/${theme}): de gevraagde theme is actief`, first.theme === theme, first.theme);
  await focusOn(cdp, '.mai-map-imagegrid');
  await shot(cdp, `be33-kaart-${width}-${theme}.png`, { scenario: 'image-card', page: 1 });

  await clickButton(cdp, 'Volgende');
  const secondReady = await waitFor(cdp, `(() => { const d = document.querySelector('.mai-map-dish'); return Boolean(d && d.innerText.includes('Fictieve soep')); })()`, 15000);
  await focusOn(cdp, '.mai-map-imagegrid');
  await waitFor(cdp, `(() => { const img = document.querySelector('.mai-map-image'); return Boolean(img && img.complete && img.naturalWidth > 0); })()`, 15000);
  const second = await readImageCard(cdp);
  check(
    `kaart (${width}/${theme}): afbeelding 2 toont zijn eigen gerecht met de juiste herkomst`,
    secondReady && second.dishes.length === 1 && second.dishes[0].provenance === 'gelezen van afbeelding 2',
    JSON.stringify(second.dishes),
  );
  await focusOn(cdp, '.mai-map-imagegrid');
  await shot(cdp, `be33-kaart-${width}-${theme}-afbeelding-2.png`, { scenario: 'image-card', page: 2 });

  const back = await clickButton(cdp, 'Nalopen in de lijst');
  const focus = await waitFor(cdp, `Boolean(document.getElementById('mai-row-0.0.1'))`, 15000);
  const backState = await evalJs(
    cdp,
    `(() => {
      const row = document.getElementById('mai-row-0.0.1');
      const list = [...document.querySelectorAll('.mai-view-btn')].map((el) => el.getAttribute('aria-pressed'));
      return { list, text: row ? row.innerText : '' };
    })()`,
  );
  check(
    `kaart (${width}/${theme}): "Nalopen in de lijst" gaat terug naar die regel in de lijst`,
    back && focus && backState.list[0] === 'true' && flatText(backState.text).includes('Fictieve soep'),
    JSON.stringify(backState).slice(0, 200),
  );
}


async function warmUp(cdp) {
  // One page of each route so the dev server compiles them before the timed
  // checks; a cold compile is not a product failure.
  await navigate(cdp, `${START_URL}?theme=light&fixture=beeldLezen&navCounts=bronnen`, `document.body.innerText.includes('Bronnen beoordelen')`).catch(() => {});
  await waitFor(cdp, `Boolean(document.querySelector('.brn-task'))`, 60000).catch(() => {});
  await navigate(cdp, `${MANUAL_URL}?theme=light&fixture=manual-image`, `document.body.innerText.includes('Prompt maken')`).catch(() => {});
}

async function main() {
  const watchdog = setTimeout(() => {
    try {
      writeEvidence({ error: 'run_timeout (' + WATCHDOG_MIN + ' min)' });
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

    console.log('warm-up: compiling the routes');
    await warmUp(cdp);
    // The whole matrix by default; the environment switches only exist to debug
    // one screen of this check during a round.
    const only = process.env.BEELD_ONLY || 'all';
    const themes = (process.env.BEELD_THEMES || 'light,dark').split(',').map((entry) => entry.trim()).filter(Boolean);
    const widths = (process.env.BEELD_WIDTHS || '1280,390').split(',').map((entry) => Number(entry.trim())).filter((entry) => entry > 0);
    for (const theme of themes) {
      for (const width of widths) {
        if (only === 'all' || only === 'rows') {
          console.log(`scenario: rij ${width} ${theme} (AI aan)`);
          await rowScenario(cdp, width, theme, 'on');
          console.log(`scenario: rij ${width} ${theme} (AI uit)`);
          await rowScenario(cdp, width, theme, 'off');
        }
        if (only === 'all' || only === 'map') {
          console.log(`scenario: kaart ${width} ${theme}`);
          await imageMapScenario(cdp, width, theme);
        }
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

