'use strict';

// BE-54 (#133) — browsercheck voor /mijn-restaurant/claimen.
//
// Eén scenario, dus geen scenariofilter: de check meet in een echte lokale
// browser (Edge/Chrome via CDP, geen dependency) wat het contract vraagt:
// zoeken tijdens het typen, de juiste /claim/[id] per regel, de lege stand zonder
// verzonnen mailadres, licht en donker op 1280, 390 en 320 px, zichtbare focus en
// tikdoelen van minimaal 44 px, plus de bestaande a11y-audit (contrast, namen,
// koppen, landmarks, taal) voor deze pagina.
//
// Lokaal alleen: next dev op poort 3186 (uit 3180-3189), geen productie, geen
// externe hosts (de browser kan ze niet bereiken). Bewijs:
// ops/browser/evidence/be54-browser-evidence.json en evidence/be-54/*.png.

const fs = require('node:fs');
const path = require('node:path');

const {
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
  pressKey,
  killTree,
  findBrowser,
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const audit = require('./lib/a11y-audit');

const PORT = Number(process.env.BE54_PORT || 3186);
const APP = `http://localhost:${PORT}`;
const ROUTE = '/mijn-restaurant/claimen';
const LOGIN_ROUTE = '/mijn-restaurant/inloggen';

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-54');
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be54-browser-evidence.json');

const checks = [];
const errors = [];
const shots = [];
let cdp = null;
let server = null;
let browser = null;

function add(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
  if (!passed) errors.push({ name, detail: detail === undefined ? null : String(detail) });
  return Boolean(passed);
}

function writeEvidence(extra = {}) {
  const record = {
    ticket: 'BE-54 (#133)',
    route: ROUTE,
    category: `lokale browsercheck (next dev op poort ${PORT}); geen productie en geen echte acceptatie`,
    ranAt: new Date().toISOString(),
    passed: errors.length === 0 && !extra.error,
    checks,
    errors,
    shots,
    ...extra,
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function setViewport(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

async function applyTheme(theme) {
  const applied = await evalJs(
    cdp,
    `(() => {
      try { localStorage.setItem('bredaeats_theme', ${JSON.stringify(theme)}); } catch (error) {}
      document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
      return document.documentElement.getAttribute('data-theme');
    })()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  return applied === theme;
}

async function typeQuery(text) {
  await evalJs(
    cdp,
    `(() => {
      const input = document.getElementById('claimen-q');
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
}

async function openClaimPage(width, height, theme) {
  await setViewport(width, height);
  await navigate(cdp, `${APP}${ROUTE}`, `Boolean(document.getElementById('claimen-q'))`);
  const applied = await applyTheme(theme);
  await waitFor(cdp, `!document.querySelector('.claimen-status').innerText.includes('laden')`, 20000);
  return applied;
}

async function readState() {
  return evalJs(
    cdp,
    `(() => {
      const textOf = (row, selector) => (row.querySelector(selector) || {}).innerText || '';
      const rows = Array.from(document.querySelectorAll('.claimen-result')).map((row) => {
        const button = row.querySelector('.claimen-result-button');
        return {
          name: textOf(row, '.claimen-result-name').trim(),
          detail: textOf(row, '.claimen-result-detail').trim(),
          button: button ? button.innerText.trim() : '',
          href: button ? button.getAttribute('href') : null,
          buttonHeight: button ? Math.round(button.getBoundingClientRect().height) : null,
        };
      });
      const empty = document.querySelector('.claimen-empty');
      return {
        status: document.querySelector('.claimen-status').innerText.trim(),
        rows,
        empty: empty ? empty.innerText.trim() : null,
        mailtoLinks: document.querySelectorAll('a[href^="mailto:"]').length,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        theme: document.documentElement.getAttribute('data-theme'),
      };
    })()`,
  );
}

async function run() {
  server = await startServer({ port: PORT, appUrl: APP, outputDir: SHOT_DIR, readyPath: ROUTE });
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable');
  browser = await startBrowser(browserPath);
  cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  // 1. De "Claim je restaurant"-link op de inlogpagina wijst naar de nieuwe pagina.
  await setViewport(1280, 900);
  await navigate(cdp, `${APP}${LOGIN_ROUTE}`, `document.body.innerText.includes('Claim je restaurant')`);
  const loginLinks = await evalJs(
    cdp,
    `Array.from(document.querySelectorAll('a')).map((a) => ({ href: a.getAttribute('href'), text: a.innerText.trim() }))`,
  );
  const claimLinks = loginLinks.filter((link) => link.text === 'Claim je restaurant');
  add(
    'inloggen: "Claim je restaurant" gaat naar /mijn-restaurant/claimen',
    claimLinks.length === 1 && claimLinks[0].href === ROUTE,
    JSON.stringify(claimLinks),
  );

  // 2. Zoeken tijdens het typen, per thema en per breedte.
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [[1280, 900], [390, 844], [320, 800]]) {
      const applied = await openClaimPage(width, height, theme);
      add(`${theme} ${width}px: thema toegepast`, applied, `data-theme=${theme}`);

      await typeQuery('Wolfslaar');
      const shown = await waitFor(cdp, `document.querySelectorAll('.claimen-result').length === 1`, 20000);
      const state = await readState();
      const row = state.rows[0];
      add(`${theme} ${width}px: zoeken op naam geeft één regel`, shown && state.rows.length === 1, JSON.stringify(state.rows));
      add(
        `${theme} ${width}px: de regel toont naam, adres en buurt`,
        Boolean(row) && row.name === 'Restaurant Wolfslaar' && row.detail === 'Wolfslaardreef 100, 4834 SP Breda · Wolfslaar',
        row ? row.detail : 'geen regel',
      );
      add(
        `${theme} ${width}px: de knop heet "Dit is mijn restaurant" en linkt naar /claim/1`,
        Boolean(row) && row.button === 'Dit is mijn restaurant' && row.href === '/claim/1',
        row ? `${row.button} → ${row.href}` : 'geen regel',
      );
      add(`${theme} ${width}px: het aantal staat in role="status"`, state.status === '1 restaurant gevonden.', state.status);
      add(
        `${theme} ${width}px: tikdoel van de knop is minimaal 44 px`,
        Boolean(row) && row.buttonHeight >= 44,
        row ? `${row.buttonHeight}px` : 'geen regel',
      );
      add(`${theme} ${width}px: geen horizontale overloop`, state.overflowX <= 0, `scrollWidth-innerWidth=${state.overflowX}`);

      const file = await screenshot(cdp, SHOT_DIR, `be54-resultaten-${width}-${theme}.png`);
      shots.push({ name: `be54-resultaten-${width}-${theme}`, theme, viewport: `${width}x${height}`, ...file });

      // 3. "Dit is mijn restaurant" opent de bestaande claimpagina.
      await evalJs(cdp, `document.querySelector('.claimen-result-button').click()`);
      const landed = await waitFor(cdp, `location.pathname === '/claim/1'`, 20000);
      add(`${theme} ${width}px: de knop opent /claim/1`, landed, await evalJs(cdp, 'location.pathname'));
    }
  }

  // 4. Niets gevonden: tip, en zonder NEXT_PUBLIC_CONTACT_EMAIL geen mailto.
  await openClaimPage(390, 844, 'light');
  await typeQuery('zzzzzz');
  const emptyShown = await waitFor(cdp, `Boolean(document.querySelector('.claimen-empty'))`, 15000);
  const emptyState = await readState();
  const emptyText = emptyState.empty ? emptyState.empty.replace(/\n+/g, ' | ') : null;
  add('niets gevonden: de lege stand verschijnt', emptyShown, emptyText);
  add(
    'niets gevonden: de tip noemt een deel van de naam of de straat',
    Boolean(emptyState.empty) && /deel van de naam|op straat/i.test(emptyState.empty),
    emptyText,
  );
  add(
    'niets gevonden: zonder NEXT_PUBLIC_CONTACT_EMAIL geen mailto-link, wel de tekst',
    emptyState.mailtoLinks === 0 && Boolean(emptyState.empty) && /Laat het ons weten/.test(emptyState.empty),
    `mailto-links=${emptyState.mailtoLinks}`,
  );
  add(
    'niets gevonden: de status zegt het eerlijk',
    emptyState.status === 'Geen restaurant gevonden met deze zoekterm.',
    emptyState.status,
  );
  const emptyShot = await screenshot(cdp, SHOT_DIR, 'be54-niets-gevonden-390-licht.png');
  shots.push({ name: 'be54-niets-gevonden-390-licht', theme: 'light', viewport: '390x844', ...emptyShot });

  // 5. Toetsenbord: elke stap houdt een zichtbare focusring.
  await openClaimPage(390, 844, 'light');
  await typeQuery('Wolfslaar');
  await waitFor(cdp, `document.querySelectorAll('.claimen-result').length === 1`, 20000);
  // Start de tabwandeling bovenaan: body focusbaar maken zet het sequentiële
  // startpunt terug naar het begin van het document.
  await evalJs(cdp, `(() => { const body = document.body; body.setAttribute('tabindex', '-1'); body.focus(); return document.activeElement === body; })()`);
  await evalJs(cdp, audit.inPageSource('prepareFocusWalk', [{ scope: 'page' }]));
  const walk = [];
  for (let step = 0; step < 12; step += 1) {
    await pressKey(cdp, 'Tab', 'Tab', 9);
    const info = await evalJs(cdp, audit.inPageSource('readFocusStep', []));
    if (!info || info.done) break;
    walk.push({ selector: info.selector, name: info.name, visible: Boolean(info.indicator && info.indicator.visible) });
  }
  add(
    'toetsenbord: minstens vijf stappen, elk met een zichtbare focusring',
    walk.length >= 5 && walk.every((entry) => entry.visible),
    JSON.stringify(walk),
  );
  add(
    'toetsenbord: het zoekveld en de resultaatknop komen langs',
    walk.some((entry) => entry.name && entry.name.toLowerCase().includes('naam, straat of buurt')) &&
      walk.some((entry) => entry.name && entry.name.includes('Dit is mijn restaurant')),
    JSON.stringify(walk.map((entry) => entry.name)),
  );

  // 6. De bestaande a11y-audit voor deze pagina, in licht en donker.
  for (const theme of ['light', 'dark']) {
    await openClaimPage(1280, 900, theme);
    await typeQuery('Wolfslaar');
    await waitFor(cdp, `document.querySelectorAll('.claimen-result').length === 1`, 20000);
    const measured = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44 }]));
    const review = audit.checksFromAudit('claimen', theme === 'light' ? 'licht' : 'donker', measured, { minTarget: 44 });
    for (const check of review.checks) add(check.name, check.passed, check.detail);
    for (const failure of review.errors) {
      add(
        `claimen (${theme}) · a11y-fout · ${failure.criterion}`,
        false,
        `${failure.reason} · ${failure.name} · ${failure.detail || ''}`,
      );
    }
  }

  return writeEvidence({});
}

const timeout = setTimeout(() => {
  writeEvidence({ error: 'run_timeout (8 min)' });
  try {
    if (browser) killTree(browser.child);
    if (server) killTree(server);
  } catch {
    /* niets */
  }
  process.exit(1);
}, 8 * 60 * 1000);

(async () => {
  try {
    const record = await run();
    clearTimeout(timeout);
    console.log(
      JSON.stringify({
        evidence: EVIDENCE_PATH,
        passed: record.passed,
        checks: checks.length,
        errors: errors.length,
        shots: shots.length,
      }),
    );
    for (const error of errors.slice(0, 10)) console.log(`FOUT: ${error.name} — ${error.detail}`);
  } catch (error) {
    clearTimeout(timeout);
    writeEvidence({ error: String((error && error.stack) || error) });
    console.error(String((error && error.stack) || error));
    process.exitCode = 1;
  } finally {
    try {
      if (cdp) cdp.close();
      if (browser) killTree(browser.child);
      if (server) killTree(server);
    } catch {
      /* afsluiten mag nooit de uitslag verbergen */
    }
  }
  if (errors.length > 0) process.exitCode = 1;
})();



