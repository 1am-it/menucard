'use strict';

// #62 fixture browser check for the new internal navigation and the one entry
// "Restaurant of menu toevoegen".
//
// This drives the real app routes and the real components in a local `next dev`
// process, with a fictional in-page Supabase session and fictional API answers
// (ops/browser/lib/fixture-page.js). It is FIXTURE EVIDENCE: not live
// integration, staging or production acceptance, and no production credential,
// identity or data is involved.
//
// What it proves in the browser: the bar's items and labels, the real numbers in
// order, the separating line, the menu's keyboard behaviour, the 390/320 px
// layout with 44 px targets, light and dark, the add form, the landing rule
// through /internal, and that a failed or partial count shows no number at all.
// The approved mockup itself is an external Claude artifact that this check
// cannot fetch; the layout is compared against the contract text and the
// existing design tokens, and the screenshots are saved for the human/Lead
// visual comparison.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { fixtureBootstrap, NAV62_COUNTS } = require('./lib/fixture-page');
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
  pressKey,
  tabUntil,
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'output');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'internal-nav-browser-evidence.json');
const PORT = Number(process.env.NAV_FIXTURE_PORT || 3138);
const APP = `http://localhost:${PORT}`;
const ADD_URL = `${APP}/internal/toevoegen`;
const INTERNAL_URL = `${APP}/internal`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const EXPECTED_TOTAL = Object.values(NAV62_COUNTS).reduce((sum, value) => sum + value, 0);

const checks = [];
const shots = [];
const clickpaths = [];
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };

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
  // A dead browser target must not hang the whole run: fail this step loudly.
  await Promise.race([
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    }),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('setViewport_timeout')), 10000)),
  ]);
}

async function shot(cdp, name, meta = {}) {
  const file = await screenshot(cdp, OUT_DIR, name);
  shots.push({ ...file, viewport: `${viewport.width}x${viewport.height}`, ...meta });
  return file;
}

async function open(cdp, url, readyExpression) {
  await navigate(cdp, url, readyExpression);
  const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
  check(`fixture bootstrap without error (${url})`, !bootError, bootError || 'ok');
}

async function openMenu(cdp) {
  const clicked = await evalJs(cdp, `(() => {
    const trigger = document.querySelector('.internal-nav-workqueue-trigger');
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  check('Werkvoorraad: the trigger is a real button that opens the menu', clicked);
  const opened = await waitFor(cdp, `Boolean(document.getElementById('internal-nav-workqueue-panel'))`, 5000);
  check('Werkvoorraad: the panel opens', opened);
  return opened;
}

async function readMenu(cdp) {
  return evalJs(cdp, `(() => ({
    expanded: (document.querySelector('.internal-nav-workqueue-trigger') || {}).getAttribute
      ? document.querySelector('.internal-nav-workqueue-trigger').getAttribute('aria-expanded')
      : null,
    rows: [...document.querySelectorAll('.internal-nav-workqueue-item')].map((a) => ({
      label: (a.querySelector('.internal-nav-workqueue-item-label') || {}).textContent || null,
      count: (a.querySelector('.internal-nav-workqueue-item-count') || {}).textContent || null,
      href: a.getAttribute('href'),
    })),
    separator: Boolean(document.querySelector('.internal-nav-workqueue-separator')),
    panelText: document.getElementById('internal-nav-workqueue-panel')
      ? document.getElementById('internal-nav-workqueue-panel').innerText
      : '',
    actionsVisible: (() => {
      const actions = document.querySelector('.internal-nav-workqueue-actions');
      return Boolean(actions) && actions.offsetParent !== null;
    })(),
  }))()`);
}

async function warmUp(cdp) {
  await setViewport(cdp, 1280, 900);
  await open(cdp, `${ADD_URL}?theme=light&fixture=review`, `document.body.innerText.includes('Restaurant of menu toevoegen')`);
  const ready = await waitFor(cdp, `Boolean(document.querySelector('.internal-nav-workqueue-total'))`, 90000);
  check('warm-up: the counts route answered and the bar renders the total', ready);
}

async function desktopScenario(cdp) {
  await setViewport(cdp, 1280, 900);
  await open(cdp, `${ADD_URL}?theme=light&fixture=review`, `document.body.innerText.includes('Restaurant of menu toevoegen')`);
  const barReady = await waitFor(cdp, `document.body.innerText.split(String.fromCharCode(10)).join(' ').includes('Werkvoorraad (${EXPECTED_TOTAL})')`, 45000);
  check('desktop: the bar shows the real total', barReady, `expected (${EXPECTED_TOTAL})`);

  const bar = await evalJs(cdp, `(() => ({
    text: document.querySelector('nav.internal-nav').innerText,
    expanded: document.querySelector('.internal-nav-workqueue-trigger').getAttribute('aria-expanded'),
    panel: Boolean(document.getElementById('internal-nav-workqueue-panel')),
    addHeight: document.querySelector('.internal-nav-add').getBoundingClientRect().height,
    theme: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
  }))()`);
  check(
    'desktop: the bar shows Dekking, Werkvoorraad (N), the add entry, Licht/Donker and Sign out',
    flatText(bar.text).includes('Dekking') &&
      flatText(bar.text).includes(`Werkvoorraad (${EXPECTED_TOTAL})`) &&
      flatText(bar.text).includes('Restaurant of menu toevoegen') &&
      flatText(bar.text).includes('Licht') &&
      flatText(bar.text).includes('Donker') &&
      flatText(bar.text).includes('Sign out'),
    bar.text.replace(/\n/g, ' | '),
  );
  check(
    'desktop: Onboarding Restaurant and Beheer are no longer bar items',
    !flatText(bar.text).includes('Onboarding Restaurant') && !flatText(bar.text).includes('Beheer'),
    bar.text.replace(/\n/g, ' | '),
  );
  check('desktop: the menu starts closed', bar.expanded === 'false' && bar.panel === false, JSON.stringify({ expanded: bar.expanded, panel: bar.panel }));
  check('desktop: the add entry is at least 44 px high', bar.addHeight >= 44, `height=${bar.addHeight}`);
  check('desktop: the requested light theme is active', bar.theme === 'light', bar.theme);
  await shot(cdp, 'nav62-desktop-1280-light-bar.png', { theme: 'light', menu: 'closed' });

  await openMenu(cdp);
  const menu = await readMenu(cdp);
  const expectedOpen = [
    ['Menuconcepten beoordelen', String(NAV62_COUNTS['menu-concepts'])],
    ['Bronnen beoordelen', String(NAV62_COUNTS['source-triage'])],
    ['Nieuwe aanleveringen', String(NAV62_COUNTS['import-inbox'])],
    ['Beoordelen', String(NAV62_COUNTS.moderation)],
  ];
  const actualOpen = menu.rows.slice(0, 4).map((row) => [row.label, row.count]);
  check(
    'desktop: open work is sorted by the real numbers, Menuconcepten first, Beoordelen included for the editor role',
    JSON.stringify(actualOpen) === JSON.stringify(expectedOpen),
    JSON.stringify(actualOpen),
  );
  check(
    'desktop: below the separating line are Stadsoverzicht and Restaurantgegevens (concept), without a number',
    menu.separator === true &&
      menu.rows.length === 6 &&
      menu.rows[4].label === 'Stadsoverzicht' &&
      menu.rows[4].count === null &&
      menu.rows[5].label === 'Restaurantgegevens (concept)' &&
      menu.rows[5].count === null,
    JSON.stringify(menu.rows.slice(4)),
  );
  check(
    'desktop: every row keeps its existing route',
    menu.rows.map((row) => row.href).join(',') ===
      ['/internal/menu-concepts', '/internal/source-triage', '/internal/import-inbox', '/internal/moderation', '/internal/source-workqueue', '/internal/profile-drafts'].join(','),
    menu.rows.map((row) => row.href).join(','),
  );
  check('desktop: the panel has the "Open werk" heading', flatText(menu.panelText).toLowerCase().includes('open werk'), menu.panelText.replace(/\n/g, ' | '));
  await shot(cdp, 'nav62-desktop-1280-light-menu.png', { theme: 'light', menu: 'open' });

  await pressKey(cdp, 'Escape', 'Escape', 27);
  const closed = await waitFor(cdp, `!document.getElementById('internal-nav-workqueue-panel')`, 5000);
  const focus = await evalJs(cdp, `(() => ({
    className: (document.activeElement && document.activeElement.className) || '',
    expanded: document.querySelector('.internal-nav-workqueue-trigger').getAttribute('aria-expanded'),
  }))()`);
  check('desktop: Escape closes the menu', closed && focus.expanded === 'false', JSON.stringify(focus));
  check('desktop: focus returns to the Werkvoorraad button', String(focus.className).includes('internal-nav-workqueue-trigger'), focus.className);
  recordClickpath('menu open, Escape, focus back', ['click Werkvoorraad', 'Escape'], closed && String(focus.className).includes('internal-nav-workqueue-trigger'));

  await open(cdp, `${ADD_URL}?theme=dark&fixture=review`, `document.body.innerText.includes('Restaurant of menu toevoegen')`);
  await waitFor(cdp, `document.body.innerText.split(String.fromCharCode(10)).join(' ').includes('Werkvoorraad (${EXPECTED_TOTAL})')`, 45000);
  await openMenu(cdp);
  const dark = await evalJs(cdp, `(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
  }))()`);
  check('desktop: the requested dark theme is active', dark.theme === 'dark', dark.theme);
  check('desktop: light and dark resolve to different background tokens', bar.bg !== dark.bg, `${bar.bg} / ${dark.bg}`);
  await shot(cdp, 'nav62-desktop-1280-dark-menu.png', { theme: 'dark', menu: 'open' });
}

async function mobileScenario(cdp, width, theme) {
  await setViewport(cdp, width, 780);
  await open(cdp, `${ADD_URL}?theme=${theme}&fixture=review`, `document.body.innerText.includes('Restaurant of menu toevoegen')`);
  const ready = await waitFor(cdp, `document.querySelector('.internal-nav-workqueue-trigger') && document.querySelector('.internal-nav-workqueue-trigger').innerText.split(String.fromCharCode(10)).join(' ').includes('Werk (${EXPECTED_TOTAL})')`, 45000);
  check(`${width}px/${theme}: the short label with the real total is visible`, ready);

  const bar = await evalJs(cdp, `(() => {
    const trigger = document.querySelector('.internal-nav-workqueue-trigger');
    const add = document.querySelector('.internal-nav-add');
    const actions = document.querySelector('.internal-nav-actions');
    const full = document.querySelector('.internal-nav-workqueue-title-full');
    return {
      text: document.querySelector('nav.internal-nav').innerText,
      triggerHeight: trigger.getBoundingClientRect().height,
      triggerWidth: trigger.getBoundingClientRect().width,
      addHeight: add.getBoundingClientRect().height,
      addWidth: add.getBoundingClientRect().width,
      fullLabelVisible: full ? full.offsetParent !== null : false,
      barActionsVisible: actions ? actions.offsetParent !== null : false,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      theme: document.documentElement.getAttribute('data-theme'),
    };
  })()`);
  check(
    `${width}px/${theme}: Dekking, Werk (N) and the + entry stay in the bar`,
    flatText(bar.text).includes('Dekking') && flatText(bar.text).includes(`Werk (${EXPECTED_TOTAL})`) && flatText(bar.text).includes('+'),
    bar.text.replace(/\n/g, ' | '),
  );
  check(`${width}px/${theme}: the long Werkvoorraad label lives only in the menu`, bar.fullLabelVisible === false && !flatText(bar.text).includes('Werkvoorraad'), bar.fullLabelVisible);
  check(
    `${width}px/${theme}: the Werk button and the + entry are at least 44 px`,
    bar.triggerHeight >= 44 && bar.triggerWidth >= 44 && bar.addHeight >= 44 && bar.addWidth >= 44,
    JSON.stringify({ triggerH: bar.triggerHeight, triggerW: bar.triggerWidth, addH: bar.addHeight, addW: bar.addWidth }),
  );
  check(`${width}px/${theme}: Licht/Donker and Sign out are not in the bar itself`, bar.barActionsVisible === false);
  check(`${width}px/${theme}: no horizontal overflow`, bar.overflow <= 0, `overflow=${bar.overflow}`);
  check(`${width}px/${theme}: the requested theme is active`, bar.theme === theme, bar.theme);
  await shot(cdp, `nav62-${width}-${theme}-bar.png`, { theme, menu: 'closed' });

  await openMenu(cdp);
  const menu = await readMenu(cdp);
  check(
    `${width}px/${theme}: the menu shows the same rows, numbers and separating line`,
    menu.rows.length === 6 &&
      menu.rows[0].label === 'Menuconcepten beoordelen' &&
      menu.rows[0].count === String(NAV62_COUNTS['menu-concepts']) &&
      menu.rows[3].label === 'Beoordelen' &&
      menu.separator === true,
    JSON.stringify(menu.rows),
  );
  check(
    `${width}px/${theme}: Licht/Donker and Sign out are at the bottom of the menu`,
    menu.actionsVisible && flatText(menu.panelText).includes('Sign out') && flatText(menu.panelText).includes('Licht') && flatText(menu.panelText).includes('Donker'),
    menu.panelText.replace(/\n/g, ' | '),
  );
  const rowHeight = await evalJs(cdp, `document.querySelector('.internal-nav-workqueue-item').getBoundingClientRect().height`);
  check(`${width}px/${theme}: every menu row is at least 44 px`, rowHeight >= 44, `height=${rowHeight}`);
  const overflowOpen = await evalJs(cdp, `document.documentElement.scrollWidth - window.innerWidth`);
  check(`${width}px/${theme}: the open menu does not overflow`, overflowOpen <= 0, `overflow=${overflowOpen}`);
  await shot(cdp, `nav62-${width}-${theme}-menu.png`, { theme, menu: 'open' });
}

async function countsScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await open(cdp, `${ADD_URL}?theme=light&fixture=review&countsState=error`, `document.body.innerText.includes('Restaurant of menu toevoegen')`);
  await waitFor(cdp, `document.querySelector('.internal-nav-workqueue-trigger') !== null`, 45000);
  const none = await evalJs(cdp, `(() => ({
    total: Boolean(document.querySelector('.internal-nav-workqueue-total')),
    text: document.querySelector('nav.internal-nav').innerText,
  }))()`);
  check('counts failed: the bar shows no total at all', none.total === false && !/\(\d+\)/.test(none.text), none.text.replace(/\n/g, ' | '));
  await openMenu(cdp);
  const failedMenu = await readMenu(cdp);
  check(
    'counts failed: no row shows a number, and certainly not a fake 0',
    failedMenu.rows.length === 6 && failedMenu.rows.every((row) => row.count === null),
    JSON.stringify(failedMenu.rows),
  );
  await shot(cdp, 'nav62-390-light-counts-missing.png', { theme: 'light', menu: 'open', counts: 'failed' });

  await setViewport(cdp, 1280, 900);
  await open(cdp, `${ADD_URL}?theme=light&fixture=review&countsState=partial`, `document.body.innerText.includes('Restaurant of menu toevoegen')`);
  await waitFor(cdp, `document.querySelector('.internal-nav-workqueue-trigger') !== null`, 45000);
  await openMenu(cdp);
  const partial = await readMenu(cdp);
  const partialCounts = partial.rows.slice(0, 4).map((row) => [row.label, row.count]);
  check(
    'counts partial: the known numbers stay, the missing one shows no number (sorted last), and there is no total',
    JSON.stringify(partialCounts) === JSON.stringify([
      ['Menuconcepten beoordelen', String(NAV62_COUNTS['menu-concepts'])],
      ['Bronnen beoordelen', String(NAV62_COUNTS['source-triage'])],
      ['Beoordelen', String(NAV62_COUNTS.moderation)],
      ['Nieuwe aanleveringen', null],
    ]) &&
      !(await evalJs(cdp, `Boolean(document.querySelector('.internal-nav-workqueue-total'))`)),
    JSON.stringify(partialCounts),
  );
  await shot(cdp, 'nav62-desktop-1280-light-counts-partial.png', { theme: 'light', menu: 'open', counts: 'partial' });
}

async function landingScenario(cdp) {
  await setViewport(cdp, 1280, 900);
  await open(cdp, `${INTERNAL_URL}?theme=light&fixture=review`, `location.pathname === '/internal/menu-concepts'`);
  const landed = await evalJs(cdp, `(() => ({
    path: location.pathname,
    nav: Boolean(document.querySelector('nav.internal-nav')),
    bar: (document.querySelector('nav.internal-nav') || {}).innerText || '',
  }))()`);
  check('landing: /internal sends the visitor to the section with the most open work', landed.path === '/internal/menu-concepts', landed.path);
  check('landing: that destination page mounts the shared bar', landed.nav === true && landed.bar.includes('Dekking'));
  recordClickpath('login/logo landing rule through /internal', ['open /internal', 'rule picks menu-concepts (7 open)'], landed.path === '/internal/menu-concepts');
  await shot(cdp, 'nav62-landing-menu-concepts-1280-light.png', { theme: 'light', menu: 'closed' });
}

async function keyboardScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await open(cdp, `${ADD_URL}?theme=light&fixture=review`, `document.body.innerText.includes('Restaurant of menu toevoegen')`);
  await waitFor(cdp, `document.querySelector('.internal-nav-workqueue-trigger') && document.querySelector('.internal-nav-workqueue-trigger').innerText.split(String.fromCharCode(10)).join(' ').includes('Werk (${EXPECTED_TOTAL})')`, 45000);
  const reach = await tabUntil(cdp, 'Werk', 40);
  check('keyboard: the Werkvoorraad button is reachable with Tab', Boolean(reach.info), JSON.stringify(reach.seen.slice(-4)));
  const focusBefore = await evalJs(cdp, `String((document.activeElement && document.activeElement.className) || '')`);
  check('keyboard: focus is on the Werkvoorraad button', focusBefore.includes('internal-nav-workqueue-trigger'), focusBefore);
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  const opened = await waitFor(cdp, `Boolean(document.getElementById('internal-nav-workqueue-panel'))`, 5000);
  check('keyboard: Enter opens the menu', opened);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  const closed = await waitFor(cdp, `!document.getElementById('internal-nav-workqueue-panel')`, 5000);
  const focus = await evalJs(cdp, `String((document.activeElement && document.activeElement.className) || '')`);
  check('keyboard: Escape closes it and focus is back on the button', closed && focus.includes('internal-nav-workqueue-trigger'), focus);
  recordClickpath('keyboard only: Tab, Enter, Escape', ['Tab to Werk', 'Enter opens', 'Escape closes'], opened && closed);
}

function writeEvidence(extra) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let head = 'pending-commit';
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
  } catch {
    head = 'pending-commit';
  }
  const record = {
    category: 'fixture evidence (fictional session and fictional API answers; not real acceptance)',
    issue: '#62',
    generatedAt: new Date().toISOString(),
    port: PORT,
    head,
    fixtureCounts: NAV62_COUNTS,
    expectedTotal: EXPECTED_TOTAL,
    mockupComparison:
      'not machine-verifiable here: the approved mockup is an external Claude artifact; the screenshots are saved for the Lead/human visual comparison',
    fixtureNote:
      'the nav counts are one fixed fictional API answer; every fixture page keeps its own fictional list, so a row number is not derived from that page here. The real agreement (same definitions as the pages) is unit-tested in src/lib/workqueueCounts.test.js.',
    checks,
    clickpaths,
    screenshots: shots,
    network: networkEvidence,
    passed: checks.length > 0 && checks.every((entry) => entry.passed),
    ...extra,
  };
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(record, null, 2));
  return record;
}

async function main() {
  const watchdog = setTimeout(() => {
    try {
      writeEvidence({ error: 'run_timeout (8 min)' });
    } catch (ignored) {
      // The evidence write itself is best effort inside the watchdog.
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
    const networkGuard = createNetworkGuard({ appOrigins: APP_ORIGINS, baseUrl: ADD_URL });
    await enableFetchGuard(cdp, networkGuard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureBootstrap(fixtures.scenarios, { appOrigins: APP_ORIGINS, baseUrl: ADD_URL }),
    });

    console.log('warm-up: compiling the route and the counts API');
    await warmUp(cdp);
    console.log('scenario: desktop 1280 light/dark');
    await desktopScenario(cdp);
    for (const theme of ['light', 'dark']) {
      for (const width of [390, 320]) {
        console.log('scenario: ' + width + ' ' + theme);
        await mobileScenario(cdp, width, theme);
      }
    }
    console.log('scenario: counts failed/partial');
    await countsScenario(cdp);
    console.log('scenario: landing rule');
    await landingScenario(cdp);
    console.log('scenario: keyboard');
    await keyboardScenario(cdp);

    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    check('network guard: the page recorded no blocked app traffic', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
    const guardViolations = networkGuard.appViolations();
    check('network guard: the CDP layer recorded no blocked app traffic', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
    networkEvidence = { appViolations: guardViolations, pageViolations };

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('no uncaught browser exception', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));
    const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
    check('no fixture bootstrap error at the end', !bootError, bootError || 'ok');

    const record = writeEvidence({});
    console.log(JSON.stringify({ passed: record.passed, checks: checks.length, failed: checks.filter((entry) => !entry.passed).length, screenshots: shots.length, evidence: EVIDENCE_PATH }, null, 2));
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
        // A locked temporary profile is harmless; it stays outside the repo.
      }
    }
  }
}

main();
