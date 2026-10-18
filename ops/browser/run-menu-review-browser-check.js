'use strict';

// Isolated browser evidence for #59's EXISTING batch import/review UI.
//
// This drives the real app route and the real BatchAnalysisView/MenuReview
// components in a local `next dev` process with a fictional in-page session and
// fictional API responses. It is FIXTURE evidence, not live integration,
// staging or production acceptance. No production credential, identity, data
// or write is involved.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const fixtures = require('./fixtures/menuReviewFixtures');
const { fixtureBootstrap } = require('./lib/fixture-page');
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
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'menu-review-browser-evidence.json');
const PORT = Number(process.env.BROWSER_FIXTURE_PORT || 3137);
const APP_ORIGINS = defaultAppOrigins(PORT);
const BATCH_URL = `http://localhost:${PORT}/internal/source-triage/batch`;
const BATCH_QUERY = `batch=${encodeURIComponent(fixtures.BATCH_ID)}`;

const checks = [];
const screenshotFiles = [];
let networkGuard = null;
let networkEvidence = null;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

function reviewUrl({ theme, item }) {
  const params = new URLSearchParams({ fixture: 'review', batch: fixtures.BATCH_ID, theme });
  if (item) params.set('item', '1');
  return `${BATCH_URL}?${params.toString()}`;
}

async function openRoute(cdp, url, readyExpression) {
  await navigate(cdp, url, readyExpression);
  const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
  check(`fixture bootstrap without error (${url})`, !bootError, bootError || 'ok');
  const violations = await evalJs(cdp, `(window.__FIXTURE_NETWORK_VIOLATIONS__ || []).filter((entry) => entry.phase === 'app')`);
  check(`fixture network: no blocked app traffic (${url})`, violations.length === 0, JSON.stringify(violations.slice(0, 3)));
}

async function bodyText(cdp) {
  return evalJs(cdp, 'document.body ? document.body.innerText : ""');
}

async function clickButton(cdp, text) {
  return evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((el) => el.innerText.trim().includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function reviewScenario(cdp) {
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, reviewUrl({ theme: 'light' }), `document.body.innerText.includes('Fictief Brasserie Noord')`);

  const before = await bodyText(cdp);
  check('review: result card and exact source URL are visible', before.includes('https://fictief-restaurant.invalid/') && before.includes('https://fictief-bron.invalid/menu'));
  check('review: control is collapsed before the click path', !before.includes('8 gerechten in 4 rubrieken'));

  const clicked = await clickButton(cdp, 'Menukaart controleren');
  check('review: "Menukaart controleren" is a real button', clicked);
  const expanded = await waitFor(cdp, `document.body.innerText.includes('8 gerechten in 4 rubrieken')`, 15000);
  check('review: click opens the recognised menu', expanded);

  // Open every section through its own summary, so the assertions below see
  // what a reviewer actually sees after the real click path (a closed
  // <details> is not visible text).
  await evalJs(cdp, `(() => {
    for (const summary of document.querySelectorAll('details.bta-category > summary')) {
      if (!summary.parentElement.open) summary.click();
    }
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const snapshot = await evalJs(cdp, `(() => {
    const text = document.body.innerText;
    const links = [...document.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: (a.innerText || '').trim(),
    }));
    const buttons = [...document.querySelectorAll('button')].map((b) => ({
      text: (b.innerText || '').trim(), expanded: b.getAttribute('aria-expanded'), ariaDisabled: b.getAttribute('aria-disabled'),
    }));
    return {
      text, links, buttons,
      save: buttons.find((b) => b.text.includes('Concept opslaan')) || null,
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
      url: location.href,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      groupButtons: buttons.filter((b) => b.text === 'Rubriek klopt zo').length,
    };
  })()`);

  const text = snapshot.text;
  check('review: item and section counts come from the fixture', text.includes('8 gerechten in 4 rubrieken'));
  check('review: original section paths are shown', text.includes('Fictief Lunch › Koud') && text.includes('Fictief Diner › Hoofd'));
  check('review: prices are shown per dish', ['€ 12,50', '€ 8,00', '€ 14,50', '€ 24,00'].every((price) => text.includes(price)));
  check('review: multiple undecomposed prices stay explicit', text.includes('9.50 / 18.00 · meerdere prijzen'));
  check('review: a missing price is not zero', text.includes('geen prijs') && !text.includes('€ 0,00'));
  check('review: duplicate, price and missing-price attention are visible', ['Komt meer dan eens voor', 'Meerdere prijzen', 'Prijs ontbreekt'].every((reason) => text.includes(reason)));
  check('review: shared uncertainty is grouped per section', text.includes('Fictief Lunch › Warm') && text.includes('Fictief Diner › Voor') && text.includes('2 gedeelde onzekerheden'));
  check('review: concept is internal and blocked, not savable', text.includes('Menuconcept · intern') && text.includes('6 blokkades') && text.includes('Kan pas zonder blokkades.'));
  check('review: save is disabled while blockers remain', snapshot.save && snapshot.save.ariaDisabled === 'true', snapshot.save && snapshot.save.ariaDisabled);
  check('review: group action is per section and not accept-all', snapshot.groupButtons === 2 && !/alles accepteren|accepteer alles|alles goedkeuren/i.test(text), `groupButtons=${snapshot.groupButtons}`);
  check('review: coverage and limitations are visible', text.includes('8 gerechten uit 1 bron gelezen; controle nodig.') && text.includes('arrangementen en supplementen worden niet als gerecht opgeslagen'));

  const breadcrumb = snapshot.links.find((link) => link.href === '/internal/source-triage');
  const original = snapshot.links.find((link) => link.href === fixtures.FOUND_URL);
  const review = snapshot.links.find((link) => link.href === `/internal/source-triage/batch?${BATCH_QUERY}&item=1`);
  check('review: breadcrumb link is exact', Boolean(breadcrumb), breadcrumb && breadcrumb.text);
  check('review: original menu link is exact and safe', original && original.target === '_blank' && original.rel.includes('noopener') && original.rel.includes('noreferrer'));
  check('review: "handmatig beoordelen" opens the same batch item', Boolean(review), review && review.href);
  check('review: light theme is active', snapshot.theme === 'light' && snapshot.bg === '#fcfaf4', `${snapshot.theme}/${snapshot.bg}`);
  check('review: address bar keeps the batch context', snapshot.url.includes(`batch=${fixtures.BATCH_ID}`), snapshot.url);
  check('review: no horizontal overflow at 1024 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);

  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-desktop-light.png'));

  const closed = await clickButton(cdp, 'Controle sluiten');
  const collapsed = closed && (await waitFor(cdp, `!document.body.innerText.includes('8 gerechten in 4 rubrieken')`, 10000));
  check('review: "Controle sluiten" closes the same panel', collapsed);
}


async function readOnlyScenario(cdp) {
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=readonly&${BATCH_QUERY}&item=1&theme=dark`, `document.body.innerText.includes('8 gerechten in 4 rubrieken')`);
  const snapshot = await evalJs(cdp, `(() => {
    const text = document.body.innerText;
    const buttons = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim());
    return { text, buttons, overflow: document.documentElement.scrollWidth - window.innerWidth };
  })()`);
  check('readonly: colleague view is explicitly read-only', snapshot.text.includes('alleen lezen') && !snapshot.text.includes('Gestart door jou'));
  check('readonly: no save or group-accept control is offered', !snapshot.buttons.some((text) => text.includes('Concept opslaan') || text === 'Rubriek klopt zo'));
  check('readonly: no source confirmation is offered', !snapshot.buttons.some((text) => text.includes('Bevestig')));
  check('readonly: the same concept and blockers are readable', snapshot.text.includes('Menuconcept · intern') && snapshot.text.includes('6 blokkades'));
  check('readonly: no horizontal overflow at 1024 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-readonly-1024-dark.png'));
}

async function emptyScenario(cdp) {
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=empty&theme=dark`, `document.body.innerText.includes("URL's invoeren")`);
  const snapshot = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    textarea: Boolean(document.querySelector('textarea#bta-urls')),
    label: (document.querySelector('label[for="bta-urls"]') || {}).innerText || '',
    theme: document.documentElement.getAttribute('data-theme'),
  }))()`);
  check('empty: the real URL input is present and labelled', snapshot.textarea && snapshot.label.includes("Restaurant-URL's"), snapshot.label);
  check('empty: the empty recent-batches state is honest', snapshot.text.includes('Nog geen batches') && snapshot.text.includes("0 van 25 URL's gebruikt"));
  check('empty: no fabricated result is shown', !snapshot.text.includes('Fictief Brasserie Noord'));
  check('empty: dark theme is active', snapshot.theme === 'dark');
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-empty-dark.png'));
}

async function partialScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=partial&${BATCH_QUERY}&item=1&theme=dark`, `document.body.innerText.includes('Geen herkende gerechten')`);
  const snapshot = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('partial: a found source with zero items is not a success', snapshot.text.includes('Bron gevonden, maar er zijn geen gerechten met een betrouwbare prijs herkend. Dit is geen geslaagde extractie.'));
  check('partial: the limitation is visible', snapshot.text.includes('arrangementen en supplementen worden niet als gerecht opgeslagen'));
  check('partial: no concept is offered for an empty result', !snapshot.text.includes('Menuconcept · intern'));
  check('partial: no horizontal overflow at 390 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-partial-390-dark.png'));
}

async function errorScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=error&theme=light`, `document.body.innerText.includes('De batchanalyse kon niet worden geladen.')`);
  const snapshot = await evalJs(cdp, `(() => {
    const alert = document.querySelector('[role="alert"]');
    return {
      text: document.body.innerText,
      alertText: alert ? alert.innerText : '',
      theme: document.documentElement.getAttribute('data-theme'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('error: the load error is shown in the alert region', snapshot.alertText.includes('De batchanalyse kon niet worden geladen.'), snapshot.alertText);
  check('error: no stale result is shown', !snapshot.text.includes('Fictief Brasserie Noord'));
  check('error: light theme is active', snapshot.theme === 'light');
  check('error: no horizontal overflow at 390 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-error-390-light.png'));
}


const themeBackgrounds = {};

async function responsiveScenario(cdp, width, theme) {
  await setViewport(cdp, width, 900);
  await openRoute(cdp, reviewUrl({ theme, item: true }), `document.body.innerText.includes('8 gerechten in 4 rubrieken')`);
  const snapshot = await evalJs(cdp, `(() => {
    const breadcrumb = document.querySelector('a[href="/internal/source-triage"]');
    const save = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Concept opslaan'));
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      innerWidth: window.innerWidth,
      breadcrumbVisible: Boolean(breadcrumb && breadcrumb.getBoundingClientRect().width > 0),
      saveVisible: Boolean(save && save.getBoundingClientRect().width > 0),
      text: document.body.innerText,
    };
  })()`);
  themeBackgrounds[theme] = snapshot.bg;
  check(`responsive ${width}px/${theme}: requested theme is active`, snapshot.theme === theme, snapshot.theme);
  check(`responsive ${width}px/${theme}: no horizontal overflow`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  check(`responsive ${width}px/${theme}: navigation and save control stay visible`, snapshot.breadcrumbVisible && snapshot.saveVisible);
  check(`responsive ${width}px/${theme}: the menu content is unchanged`, snapshot.text.includes('Fictief Lunch › Koud') && snapshot.text.includes('8 gerechten in 4 rubrieken'));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `menu-review-${width}-${theme}.png`));
}

async function keyboardScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, reviewUrl({ theme: 'light' }), `document.body.innerText.includes('Fictief Brasserie Noord') && document.body.innerText.includes('Menukaart controleren')`);
  const reach = await tabUntil(cdp, 'Menukaart controleren', 60);
  check('keyboard: the review control is reachable with Tab', Boolean(reach.info), JSON.stringify(reach.seen.slice(-5)));
  check('keyboard: Tab moves focus through the page', reach.tabs > 1, `tabs=${reach.tabs}`);
  if (reach.info) {
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    const opened = await waitFor(cdp, `document.body.innerText.includes('8 gerechten in 4 rubrieken')`, 15000);
    const expanded = await evalJs(cdp, `(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Controle sluiten'));
      return Boolean(button && button.getAttribute('aria-expanded') === 'true');
    })()`);
    check('keyboard: Enter opens the review panel', opened && expanded, `opened=${opened} expanded=${expanded}`);

    const summaryOpened = await evalJs(cdp, `(() => {
      const summary = document.querySelector('details.bta-category summary');
      if (!summary) return false;
      summary.focus();
      return document.activeElement === summary;
    })()`);
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const detailsOpen = await evalJs(cdp, `Boolean(document.querySelector('details.bta-category') && document.querySelector('details.bta-category').open)`);
    check('keyboard: a section summary opens with Enter', summaryOpened && detailsOpen, `focused=${summaryOpened} open=${detailsOpen}`);
  }
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-keyboard-390-light.png'));
}


function environment(browser) {
  return {
    node: process.version,
    platform: process.platform,
    browser: browser && browser.version ? browser.version.Browser : 'unknown',
    viewportHeights: [900],
    fixtureOnly: true,
    networkGuard: 'in-page fetch/XHR/WebSocket/EventSource/beacon + CDP Fetch + DNS lockdown',
  };
}

// Deliberate negative probes. Every attempt must fail closed without reaching
// the destination: the in-page guard covers fetch/XHR/WebSocket, and the CDP
// layer covers an image subresource and frame navigation that bypass it. The
// violations are expected in this phase only; any app-phase violation fails the
// run through `networkGuard.appViolations()`.
async function networkGuardScenario(cdp, guard) {
  await setViewport(cdp, 1024, 900);
  guard.setPhase('negative-probe');
  await evalJs(cdp, `window.__FIXTURE_NETWORK_PHASE__ = 'negative-probe'`);
  const result = await evalJs(cdp, `(async () => {
    const out = {};
    out.externalFetch = await fetch('https://unapproved.invalid/api/anything').then(() => 'unexpected', (error) => error.message);
    out.protocolRelative = await fetch('//unapproved.invalid/api/anything').then(() => 'unexpected', (error) => error.message);
    out.unknownWrite = await fetch('/api/internal/v1/menu-concepts', { method: 'POST' }).then(() => 'unexpected', (error) => error.message);
    out.knownFixture = await fetch('/api/internal/v1/me').then((response) => response.status, (error) => 'error:' + error.message);
    out.xhr = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.onerror = () => resolve('xhr-error');
      xhr.open('POST', '/api/internal/v1/menu-concepts');
      xhr.send('{}');
      setTimeout(() => resolve('xhr-timeout'), 1000);
    });
    out.websocket = await new Promise((resolve) => {
      try { new WebSocket('ws://unapproved.invalid/socket'); resolve('unexpected'); }
      catch (error) { resolve(error.message); }
    });
    const image = document.createElement('img');
    image.src = 'https://unapproved.invalid/pixel.png';
    document.body.appendChild(image);
    const frame = document.createElement('iframe');
    frame.src = 'https://unapproved.invalid/frame';
    document.body.appendChild(frame);
    await new Promise((resolve) => setTimeout(resolve, 700));
    out.pageViolations = (window.__FIXTURE_NETWORK_VIOLATIONS__ || []).length;
    return out;
  })()`);
  check('network guard: external fetch is blocked before native fetch', /fixture_network_blocked: external_origin/.test(result.externalFetch), result.externalFetch);
  check('network guard: protocol-relative external URL is blocked', /fixture_network_blocked: external_origin/.test(result.protocolRelative), result.protocolRelative);
  check('network guard: unknown local API write is blocked', /fixture_network_blocked: unknown_api_route/.test(result.unknownWrite), result.unknownWrite);
  check('network guard: explicit fixture API still answers', result.knownFixture === 200, result.knownFixture);
  check('network guard: XHR to an unknown API write is blocked', result.xhr === 'xhr-error', result.xhr);
  check('network guard: external WebSocket is blocked', /fixture_network_blocked: external_origin/.test(result.websocket), result.websocket);
  check('network guard: page-level violations are recorded', result.pageViolations >= 5, `violations=${result.pageViolations}`);

  const cdpBlocked = guard.violations.filter((entry) => entry.phase === 'negative-probe' && entry.kind === 'cdp_fetch');
  check('network guard: CDP blocks external subresource and frame navigation', cdpBlocked.length >= 2, JSON.stringify(cdpBlocked.slice(0, 5)));

  await evalJs(cdp, `window.__FIXTURE_NETWORK_PHASE__ = 'app'`);
  guard.setPhase('app');
  const appViolations = guard.appViolations();
  check('network guard: no unexpected CDP traffic during app scenarios', appViolations.length === 0, JSON.stringify(appViolations.slice(0, 5)));
}


function writeEvidence({ passed, head, dirty, error, browser }) {
  const evidence = {
    fixtureOnly: true,
    passed,
    head: head || 'pending-commit',
    worktreeDirty: Boolean(dirty),
    generatedAt: new Date().toISOString(),
    command: 'npm run test:browser:menu-review',
    environment: environment(browser),
    fixtures: Object.keys(fixtures.scenarios),
    checks,
    screenshots: screenshotFiles,
    network: networkEvidence,
    error: error || null,
    limitations: [
      'Fixture evidence against the real UI components; it is not live integration, staging or production acceptance.',
      'The session and API responses are fictional and same-origin; no production Supabase project, credential or data is used.',
      'Unknown external URLs, protocol-relative external URLs and unknown API/write routes are fail-closed. The negative probe deliberately attempts them and proves they never reach the destination.',
      'No source confirmation, concept save, export, provider call or workflow activation is performed.',
    ],
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ passed: false, head: 'pending-commit', dirty: true, error: 'browser_unavailable' });
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
    networkGuard = createNetworkGuard({ appOrigins: APP_ORIGINS, baseUrl: BATCH_URL });
    await enableFetchGuard(cdp, networkGuard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureBootstrap(fixtures.scenarios, { appOrigins: APP_ORIGINS, baseUrl: BATCH_URL }),
    });

    await reviewScenario(cdp);
    await readOnlyScenario(cdp);
    await emptyScenario(cdp);
    await partialScenario(cdp);
    await errorScenario(cdp);
    for (const width of [320, 390]) {
      for (const theme of ['light', 'dark']) await responsiveScenario(cdp, width, theme);
    }
    await responsiveScenario(cdp, 1024, 'dark');
    check('light and dark resolve to different background tokens', themeBackgrounds.light !== themeBackgrounds.dark, `${themeBackgrounds.light} / ${themeBackgrounds.dark}`);
    await keyboardScenario(cdp);
    await networkGuardScenario(cdp, networkGuard);

    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    check('network guard: page recorded only deliberate blocked attempts', pageViolations.every((entry) => entry.phase === 'negative-probe'), JSON.stringify(pageViolations.filter((entry) => entry.phase !== 'negative-probe').slice(0, 5)));
    networkEvidence = {
      guard: 'in-page fetch/XHR/WebSocket/EventSource/beacon + CDP Fetch + DNS lockdown',
      appViolations: networkGuard.appViolations(),
      deliberateViolations: networkGuard.negativeViolations(),
      pageViolations,
    };

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('no uncaught browser exception', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 3)));
    const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
    check('no fixture bootstrap error at the end', !bootError, bootError || 'ok');
    check('every page used the fictional fixture', (await evalJs(cdp, 'window.__FIXTURE_ACTIVE__ || null')) !== null);

    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
    // The evidence file is this run's own output and is written after this
    // check. Exclude it so a clean code tree is not reported dirty merely
    // because a previous evidence run is being replaced.
    const statusLines = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT })
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.includes('ops/browser/evidence/menu-review-browser-evidence.json'));
    const dirty = statusLines.length > 0;
    const passed = checks.every((entry) => entry.passed);
    const evidence = writeEvidence({ passed, head, dirty, browser });

    console.log(`browser fixture checks: ${checks.filter((c) => c.passed).length}/${checks.length} passed`);
    console.log(`evidence: ${path.relative(REPO_ROOT, EVIDENCE_PATH)} (head ${evidence.head}${evidence.worktreeDirty ? ', dirty worktree' : ''})`);
    for (const failure of checks.filter((entry) => !entry.passed)) console.error(`FAIL: ${failure.name} — ${failure.detail}`);
    if (!passed) process.exitCode = 1;
  } catch (error) {
    const head = (() => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
      } catch {
        return 'pending-commit';
      }
    })();
    writeEvidence({ passed: false, head, dirty: true, error: String((error && error.stack) || error), browser });
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
