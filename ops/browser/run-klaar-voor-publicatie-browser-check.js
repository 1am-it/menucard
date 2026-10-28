'use strict';

// BE-39 (#93) — browserbewijs voor de tweede badge "Klaar voor publicatie" in
// de lijst met menuconcepten.
//
// Dit script start de echte app (`next dev`) op een lokale poort, bestuurt een
// lokaal geïnstalleerde Edge/Chrome via CDP en onderschept alleen de twee
// fictieve concept-leesroutes (lijst en detail) met `fixtures/menuReviewFixtures`
// (`?fixture=concepts-publication`). De publicatiestatus in die fixture komt uit
// dezelfde pure regel als op de server (src/lib/menuConceptPublication.js).
//
// Vastgelegd worden de lijst op 1280 en 390 px in licht en donker, plus het
// detail van de ready- en gemerged-kaart. Dit is fixture-evidence op een lokale
// machine: geen productie, geen echte Supabase-sessie, geen GitHub-aanroep en
// geen merge of publicatie. Geen onafhankelijke review.
//
// Gebruik:
//   node ops/browser/run-klaar-voor-publicatie-browser-check.js

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const fixtures = require('./fixtures/menuReviewFixtures');
const { fixtureBootstrap } = require('./lib/fixture-page');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const { REPO_ROOT, findBrowser, killTree, startServer, startBrowser, evalJs, navigate } = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'klaar-voor-publicatie-browser-evidence.json');
const OUT_DIR = path.join(__dirname, 'output', 'be-39');
const PORT = Number(process.env.BROWSER_FIXTURE_PORT || 3149);
const APP_ORIGINS = defaultAppOrigins(PORT);
const CONCEPTS_URL = `http://localhost:${PORT}/internal/menu-concepts`;
const CONCEPT_DETAIL = (id) => `${CONCEPTS_URL}/${encodeURIComponent(id)}`;
const FIXTURE = 'concepts-publication';
const THEMES = ['light', 'dark'];
const WIDTHS = [1280, 390];

const checks = [];
const screenshots = [];

function check(name, passed, detail) {
  const entry = { name, passed: Boolean(passed), detail: detail === undefined || detail === null ? null : String(detail) };
  checks.push(entry);
  console.log(`${entry.passed ? 'ok  ' : 'FAIL'} ${name}${entry.detail ? ` — ${entry.detail}` : ''}`);
  return entry.passed;
}

function conceptUrl({ theme, id }) {
  const base = id ? CONCEPT_DETAIL(id) : CONCEPTS_URL;
  const params = new URLSearchParams({ fixture: FIXTURE, theme });
  return `${base}?${params.toString()}`;
}

async function setViewport(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: width >= 1280 ? 900 : 844,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

/** The whole page at the current width, so every card is in one image. */
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
    file: `be-39/${name}`,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
  screenshots.push(entry);
  return entry;
}

const LIST_JS = `(() => {
  const items = [...document.querySelectorAll('.mcr-item')].map((item) => ({
    text: item.innerText,
    badges: [...item.querySelectorAll('.status-badge')].map((badge) => (badge.innerText || '').trim()),
  }));
  return {
    items,
    readyCount: (document.querySelector('.mcr-ready-count') || {}).innerText || null,
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

async function listScenario(cdp) {
  const names = fixtures.PUBLICATION_RESTAURANTS;
  const backgrounds = {};
  const records = [];
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      await setViewport(cdp, width);
      await navigate(cdp, conceptUrl({ theme }), `document.body.innerText.includes(${JSON.stringify(names.ready)})`);
      const state = await evalJs(cdp, LIST_JS);
      backgrounds[theme] = await evalJs(cdp, `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase()`);
      const file = await shot(cdp, `be39-publicatie-${width}-${theme}.png`);
      records.push({ theme, width, readyCount: state.readyCount, badges: state.items.map((item) => item.badges), screenshot: file.file });

      const card = (name) => state.items.find((item) => item.text.includes(name)) || { badges: [], text: '' };
      const ready = card(names.ready);
      const missing = card(names.missingSource);
      const merged = card(names.merged);
      const failed = card(names.failed);
      const waiting = card(names.waiting);
      const label = `${width}px/${theme}`;
      check(`BE-39 ${label}: een goedgekeurde kaart krijgt precies een tweede badge "Klaar voor publicatie"`,
        ready.badges.length === 2 && ready.badges[0] === 'Intern goedgekeurd' && ready.badges[1] === 'Klaar voor publicatie',
        JSON.stringify(ready.badges));
      check(`BE-39 ${label}: een ontbrekende bron geeft de eerste reden in gewone taal`,
        missing.badges.length === 2 && missing.badges[1] === 'Nog niet klaar: Bron nog niet bevestigd.',
        JSON.stringify(missing.badges));
      check(`BE-39 ${label}: een bestaande export toont de echte status, nooit "Klaar voor publicatie"`,
        merged.badges[1] === 'Review-PR gemerged' && failed.badges[1] === 'Vorige poging mislukt'
          && !merged.text.includes('Klaar voor publicatie') && !failed.text.includes('Klaar voor publicatie'),
        JSON.stringify([merged.badges, failed.badges]));
      check(`BE-39 ${label}: gemerged is niet live; de volgende deploy wel`,
        merged.text.includes('live na de volgende deploy'), merged.text.slice(0, 200));
      check(`BE-39 ${label}: een wachtende kaart houdt een badge`,
        waiting.badges.length === 1 && waiting.badges[0] === 'Wacht op beoordeling',
        JSON.stringify(waiting.badges));
      check(`BE-39 ${label}: de kop telt alleen de kaarten die nu klaar zijn`,
        state.readyCount === '1 klaar voor publicatie', state.readyCount);
      check(`BE-39 ${label}: gevraagd thema actief`, state.theme === theme, state.theme);
      check(`BE-39 ${label}: geen horizontale overloop`, state.overflow <= 1, `overflow=${state.overflow}`);
    }
  }
  check('BE-39 licht en donker gebruiken verschillende achtergrondtokens', backgrounds.light !== backgrounds.dark, `${backgrounds.light} / ${backgrounds.dark}`);
  return records;
}

async function detailScenario(cdp) {
  const ids = fixtures.PUBLICATION_IDS;
  await setViewport(cdp, 1280);
  await navigate(cdp, conceptUrl({ theme: 'light', id: ids.ready }), `document.body.innerText.includes('Beoordeel menuconcept')`);
  const ready = await evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Maak review-PR'));
    return {
      text: document.body.innerText,
      button: button ? { ariaDisabled: button.getAttribute('aria-disabled') } : null,
    };
  })()`);
  const readyShot = await shot(cdp, 'be39-detail-1280-light.png');
  check('BE-39 detail: de ready-kaart kan de review-PR starten op dezelfde regel',
    Boolean(ready.button) && ready.button.ariaDisabled !== 'true',
    JSON.stringify(ready.button));

  await navigate(cdp, conceptUrl({ theme: 'light', id: ids.merged }), `document.body.innerText.includes('Beoordeel menuconcept')`);
  const merged = await evalJs(cdp, 'document.body.innerText');
  check('BE-39 detail: een gemergede review-PR wordt niet als live gebracht',
    merged.includes('Review-PR gemerged') && merged.includes('live na de volgende deploy'),
    merged.slice(0, 240));
  return readyShot;
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
      .filter((line) => !line.includes('ops/browser/evidence/klaar-voor-publicatie-browser-evidence.json'));
    return { dirty: lines.length > 0, lines };
  } catch {
    return { dirty: true, lines: ['git status unavailable'] };
  }
}

function writeEvidence({ passed, error = null, network = null, list = [] }) {
  const status = worktreeDirty();
  const evidence = {
    issue: '#93',
    ticket: 'BE-39 — Klaar voor publicatie',
    fixtureOnly: true,
    passed,
    error,
    head: head(),
    worktreeDirty: status.dirty,
    worktreeChanges: status.lines,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      loopback: `http://localhost:${PORT} (own next dev) + own local browser over CDP`,
      browser: process.env.BROWSER_PATH || 'auto-detected Edge/Chrome',
      fixture: FIXTURE,
    },
    covered: [
      'list: one second badge per approved card (ready, plain-language reason, real export status)',
      'list: waiting cards keep their single status badge',
      'list: "N klaar voor publicatie" in the header, only counting cards that are ready now',
      'list: merged says "live na de volgende deploy"',
      'detail: ready card may start the review-PR, merged card names the deploy',
      '1280 px and 390 px, light and dark',
    ],
    checks,
    screenshots,
    list,
    network,
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ passed: false, error: 'browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome' });
    throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  }

  let server = null;
  let browser = null;
  let cdp = null;
  let list = [];
  let network = null;
  try {
    server = await startServer({ port: PORT, appUrl: `http://localhost:${PORT}`, outputDir: OUT_DIR });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({ appOrigins: APP_ORIGINS, baseUrl: CONCEPTS_URL });
    await enableFetchGuard(cdp, guard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureBootstrap({ [FIXTURE]: fixtures.scenarios[FIXTURE] }, { appOrigins: APP_ORIGINS, baseUrl: CONCEPTS_URL }),
    });

    list = await listScenario(cdp);
    await detailScenario(cdp);

    network = {
      guard: 'in-page fetch/XHR/WebSocket/EventSource/beacon + CDP Fetch + DNS lockdown',
      appViolations: guard.appViolations(),
      deliberateViolations: guard.negativeViolations(),
    };
    check('BE-39 netwerk: geen onverwacht verkeer vanuit de app', network.appViolations.length === 0, JSON.stringify(network.appViolations.slice(0, 3)));
    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('BE-39: geen onafgevangen browser-exception', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 3)));
    const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
    check('BE-39: de fixture is zonder fout gestart', !bootError, bootError || 'ok');
    check('BE-39: elke pagina gebruikte de fictieve fixture', (await evalJs(cdp, 'window.__FIXTURE_ACTIVE__ || null')) !== null);

    const passed = checks.every((entry) => entry.passed);
    const evidence = writeEvidence({ passed, network, list });
    console.log(`BE-39 browser checks: ${checks.filter((entry) => entry.passed).length}/${checks.length} passed`);
    console.log(`evidence: ${path.relative(REPO_ROOT, EVIDENCE_PATH)} (head ${evidence.head}${evidence.worktreeDirty ? ', dirty worktree' : ''})`);
    for (const failure of checks.filter((entry) => !entry.passed)) console.error(`FAIL: ${failure.name} — ${failure.detail}`);
    if (!passed) process.exitCode = 1;
  } catch (error) {
    writeEvidence({ passed: false, error: String((error && error.stack) || error), network, list });
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
