'use strict';

// BE-47 (#111) — fixture browser check for the restaurant owner's own screen.
//
// Drives the real /mijn-restaurant/inloggen and /mijn-restaurant pages (and
// /internal for the redirect) in a local Next.js app with a fictional Supabase
// (ops/browser/lib/be48-auth-stub.js plus the BE-47 additions: fictional claims
// and a fictional account-deletion route). FIXTURE EVIDENCE: no real Supabase
// project, no production credential, no production data, no internet, no e-mail
// and no sms.
//
// What it proves in a real browser:
//  - the owner sign-in: real <label>s, autocomplete email, a neutral notice, a
//    wrong code in Dutch, the right code continuing to /mijn-restaurant, the
//    "Nieuwe code sturen" and "Ander e-mailadres" buttons, and no phone field at
//    all while NEXT_PUBLIC_OWNER_SMS_LOGIN is off;
//  - an internal/editor account that uses the owner sign-in ends on
//    /internal/login and its token is still aal1 (the second step cannot be
//    skipped);
//  - the three claim statuses: approved (with name and both public links),
//    pending and rejected;
//  - "Account verwijderen": a new code, a wrong code refused in Dutch, the right
//    code deleting only the session's own account and signing out;
//  - an owner-only account on /internal is sent on to /mijn-restaurant instead of
//    "Nog niets te openen";
//  - light and dark screenshots at 390 px and at desktop width, saved with the
//    evidence in ops/browser/evidence/be-47/.
//
// Not proven here: a real Supabase project, a real mailbox or phone, or any
// production behaviour. This is developer evidence, not independent review.

const fs = require('node:fs');
const path = require('node:path');

const { authStubScript } = require('./lib/be48-auth-stub');
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
const OUT_DIR = path.join(__dirname, 'output', 'be-47');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const EVIDENCE_PATH_BASE = path.join(EVIDENCE_DIR, 'be47-browser-evidence.json');
const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, 'be-47');
const SCRIPT_NAME = 'run-be47-browser-check.js';
const PORT = Number(process.env.BE47_FIXTURE_PORT || 3147);
const APP = `http://localhost:${PORT}`;
const LOGIN_URL = `${APP}/mijn-restaurant/inloggen`;
const DASHBOARD_URL = `${APP}/mijn-restaurant`;
const INTERNAL_URL = `${APP}/internal`;
const INTERNAL_LOGIN_PATH = '/internal/login';
const APP_ORIGINS = defaultAppOrigins(PORT);

const OWNER_EMAIL = 'houder@example.invalid';
const EMAIL_CODE = '654321';
const WRONG_CODE = '000000';
const WRONG_EMAIL_CODE_TEXT = 'Deze code is ongeldig of verlopen. Vraag een nieuwe code aan.';
const NEUTRAL_NOTICE = 'Als dit e-mailadres bij ons bekend is, ontvang je nu een code van zes cijfers.';
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;

const checks = [];
const shots = [];
let scenarioRuns = null;
let networkEvidence = null;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function shot(cdp, name, theme) {
  const applied = theme ? await applyTheme(cdp, theme) : null;
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SCREENSHOT_DIR, name);
  shots.push({
    name,
    theme: theme || null,
    applied,
    viewport: `${MOBILE_WIDTH}x${MOBILE_HEIGHT}`,
    path: `ops/browser/evidence/be-47/${name}`,
    ...file,
  });
  return file;
}

async function desktopShot(cdp, name, theme) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(cdp, 'window.innerWidth === 1280', 8000);
  const applied = theme ? await applyTheme(cdp, theme) : null;
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SCREENSHOT_DIR, name);
  shots.push({ name, theme: theme || null, applied, viewport: '1280x900', path: `ops/browser/evidence/be-47/${name}`, ...file });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  return file;
}

async function mobileShot(cdp, name, theme) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE_WIDTH,
    height: MOBILE_HEIGHT,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await waitFor(cdp, `window.innerWidth === ${MOBILE_WIDTH}`, 8000);
  const file = await shot(cdp, name, theme);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  return file;
}

async function applyTheme(cdp, theme) {
  const applied = await evalJs(
    cdp,
    `(() => {
      try { localStorage.setItem('bredaeats_theme', ${JSON.stringify(theme)}); } catch (error) {}
      document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
      return document.documentElement.getAttribute('data-theme');
    })()`,
  );
  return applied === theme;
}

async function fillField(cdp, selector, value) {
  const filled = await evalJs(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value === ${JSON.stringify(value)};
    })()`,
  );
  if (!filled) throw new Error(`could_not_fill: ${selector}`);
}

async function submitForm(cdp, selector = 'form') {
  const submitted = await evalJs(
    cdp,
    `(() => {
      const form = document.querySelector(${JSON.stringify(selector)});
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()`,
  );
  if (!submitted) throw new Error(`could_not_submit: ${selector}`);
}

async function clickButton(cdp, text) {
  const clicked = await evalJs(
    cdp,
    `(() => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (entry) => (entry.innerText || '').trim() === ${JSON.stringify(text)},
      );
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  if (!clicked) throw new Error(`could_not_click: ${text}`);
}

async function waitForText(cdp, text, timeoutMs = 25000) {
  return waitFor(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(text)})`, timeoutMs);
}

async function waitForHydration(cdp, selector = 'form', timeoutMs = 30000) {
  return waitFor(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      return Object.keys(el).some((key) => key.indexOf('__reactProps') === 0);
    })()`,
    timeoutMs,
  );
}

async function waitForPath(cdp, pathname, timeoutMs = 25000) {
  return waitFor(cdp, `location.pathname === ${JSON.stringify(pathname)}`, timeoutMs);
}

// A session from a previous scenario must never leak into the next one: every
// scenario starts signed out, in its own theme.
async function resetAuthStorage(cdp, theme) {
  await navigate(cdp, LOGIN_URL, `document.readyState === 'complete'`);
  await evalJs(
    cdp,
    `(() => {
      const stale = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.indexOf('sb-') === 0) stale.push(key);
      }
      stale.forEach((key) => localStorage.removeItem(key));
      return stale.length;
    })()`,
  );
  if (theme) await applyTheme(cdp, theme);
}

async function startOwnerLogin(cdp, options) {
  await resetAuthStorage(cdp, options.theme || 'light');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: authStubScript(options) });
  await navigate(cdp, LOGIN_URL, `document.querySelector('#owner-email') !== null`);
  const hydrated = await waitForHydration(cdp, 'form');
  check(`${options.name || 'login'}: the form is interactive (React hydration) before typing`, hydrated);
  return evalJs(cdp, 'window.__BE48__ ? window.__BE48__.settings : null');
}

async function pageState(cdp) {
  await waitFor(cdp, 'document.documentElement !== null && document.body !== null', 10000);
  return evalJs(
    cdp,
    `(() => {
      const text = (el) => (el && el.innerText ? el.innerText.trim() : '');
      const field = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        return {
          id: el.id || null,
          type: el.getAttribute('type'),
          labels: el.labels ? Array.from(el.labels).map((label) => label.innerText.trim()) : [],
          autocomplete: el.getAttribute('autocomplete'),
          inputmode: el.getAttribute('inputmode'),
          pattern: el.getAttribute('pattern'),
          height: Math.round(el.getBoundingClientRect().height),
        };
      };
      const visible = (el) => Boolean(el) && el.offsetParent !== null;
      return {
        path: location.pathname,
        theme: document.documentElement.getAttribute('data-theme'),
        heading: text(document.querySelector('h1')),
        body: document.body ? document.body.innerText : '',
        email: field('#owner-email'),
        code: field('#owner-code'),
        deleteCode: field('#owner-delete-code'),
        hasPhoneField: Boolean(document.querySelector('input[type="tel"]')),
        phoneVisible: visible(document.querySelector('#owner-phone')),
        buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
          text: (button.innerText || '').trim(),
          height: Math.round(button.getBoundingClientRect().height),
        })),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((el) => text(el)),
        notices: Array.from(document.querySelectorAll('.auth-notice')).map((el) => text(el)),
        links: Array.from(document.querySelectorAll('a')).map((a) => ({ text: text(a), href: a.getAttribute('href') })),
        statusChips: Array.from(document.querySelectorAll('.owner-status')).map((el) => ({
          text: text(el),
          className: el.className,
        })),
        restaurantNames: Array.from(document.querySelectorAll('.owner-restaurant-name')).map((el) => text(el)),
        overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      };
    })()`,
  );
}

// ─── scenario 1: e-mail → code → /mijn-restaurant, in licht en donker ───────

async function loginScenario(cdp) {
  const options = {
    name: 'inloggen',
    theme: 'light',
    email: OWNER_EMAIL,
    roles: [{ role: 'owner', restaurant_id: '1' }],
    claims: [{ id: 'claim-1', restaurant_id: '1', status: 'approved', created_at: '2026-10-01T09:00:00.000Z' }],
  };
  await startOwnerLogin(cdp, options);

  const start = await pageState(cdp);
  check('inloggen: de titel is de houder-login', start.heading === 'Inloggen voor restauranthouders', start.heading);
  check(
    'inloggen: het e-mailveld heeft een echt label, autocomplete="email" en 44 px',
    Boolean(start.email && start.email.labels.length > 0 && start.email.autocomplete === 'email' && start.email.height >= 44),
    JSON.stringify(start.email),
  );
  check(
    'inloggen: zonder NEXT_PUBLIC_OWNER_SMS_LOGIN is er geen telefoonveld',
    start.hasPhoneField === false,
    String(start.hasPhoneField),
  );
  check(
    'inloggen: "Stuur code" is een knop van minimaal 44 px',
    start.buttons.some((button) => button.text === 'Stuur code' && button.height >= 44),
    JSON.stringify(start.buttons),
  );
  check(
    'inloggen: de route naar "Claim je restaurant" staat erbij',
    start.links.some((link) => link.text === 'Claim je restaurant'),
    JSON.stringify(start.links),
  );
  check(
    'inloggen: een interne beheerder wordt naar /internal/login verwezen',
    start.links.some((link) => link.href === '/internal/login'),
    JSON.stringify(start.links),
  );
  check('inloggen: geen horizontale overflow op 390 px', start.overflow === 0, String(start.overflow));

  await mobileShot(cdp, 'be47-inloggen-390-licht.png', 'light');
  await mobileShot(cdp, 'be47-inloggen-390-donker.png', 'dark');
  await desktopShot(cdp, 'be47-inloggen-1280-licht.png', 'light');
  await desktopShot(cdp, 'be47-inloggen-1280-donker.png', 'dark');
  await applyTheme(cdp, 'light');

  await fillField(cdp, '#owner-email', OWNER_EMAIL);
  await submitForm(cdp);
  const codeScreen = await waitFor(cdp, `document.querySelector('#owner-code') !== null`, 25000);
  check('inloggen: het codescherm verschijnt na het e-mailadres', codeScreen);

  const codeState = await pageState(cdp);
  check(
    'inloggen: de melding is neutraal en verraadt niet of het adres bestaat',
    codeState.notices.includes(NEUTRAL_NOTICE),
    JSON.stringify(codeState.notices),
  );
  check(
    'inloggen: het codeveld is numeriek met autocomplete="one-time-code" en 44 px',
    Boolean(
      codeState.code &&
        codeState.code.autocomplete === 'one-time-code' &&
        codeState.code.inputmode === 'numeric' &&
        codeState.code.height >= 44,
    ),
    JSON.stringify(codeState.code),
  );
  check(
    'inloggen: "Nieuwe code sturen" en "Ander e-mailadres" staan er',
    codeState.buttons.some((button) => button.text === 'Nieuwe code sturen') &&
      codeState.buttons.some((button) => button.text === 'Ander e-mailadres'),
    JSON.stringify(codeState.buttons),
  );
  await mobileShot(cdp, 'be47-code-390-licht.png', 'light');

  await fillField(cdp, '#owner-code', WRONG_CODE);
  await submitForm(cdp);
  const alertShown = await waitFor(cdp, `document.querySelector('[role="alert"]') !== null`, 20000);
  const wrongState = await pageState(cdp);
  check(
    'inloggen: een foute code geeft Nederlandse tekst in role="alert"',
    alertShown && wrongState.alerts.includes(WRONG_EMAIL_CODE_TEXT),
    JSON.stringify(wrongState.alerts),
  );

  await fillField(cdp, '#owner-code', EMAIL_CODE);
  await submitForm(cdp);
  const landed = await waitForPath(cdp, '/mijn-restaurant');
  check('inloggen: de juiste code landt op /mijn-restaurant', landed);
  const dashboardReady = await waitForText(cdp, 'Restaurant Wolfslaar', 25000);
  check('inloggen: het eigen restaurant staat er met zijn naam', dashboardReady);

  const dashboard = await pageState(cdp);
  check('inloggen: de kop is "Mijn restaurant"', dashboard.heading === 'Mijn restaurant', dashboard.heading);
  check(
    'inloggen: de link naar de publieke pagina en naar de menukaart staan er',
    dashboard.links.some((link) => link.href === '/restaurant/1') &&
      dashboard.links.some((link) => link.href === '/menu/1-lunch'),
    JSON.stringify(dashboard.links),
  );
  check(
    'inloggen: de goedgekeurde claim toont de status "Goedgekeurd"',
    dashboard.statusChips.some(
      (chip) => chip.text === 'Goedgekeurd' && chip.className.indexOf('owner-status--approved') >= 0,
    ),
    JSON.stringify(dashboard.statusChips),
  );
  check(
    'inloggen: uitloggen en account verwijderen staan er',
    dashboard.buttons.some((button) => button.text === 'Uitloggen') &&
      dashboard.buttons.some((button) => button.text === 'Account verwijderen'),
    JSON.stringify(dashboard.buttons),
  );
  check('inloggen: geen horizontale overflow op /mijn-restaurant', dashboard.overflow === 0, String(dashboard.overflow));

  await desktopShot(cdp, 'be47-mijn-restaurant-1280-licht.png', 'light');
  await desktopShot(cdp, 'be47-mijn-restaurant-1280-donker.png', 'dark');
  await mobileShot(cdp, 'be47-mijn-restaurant-390-licht.png', 'light');
  await mobileShot(cdp, 'be47-mijn-restaurant-390-donker.png', 'dark');
  await applyTheme(cdp, 'light');
}

// Request a code and enter it, the way a restaurateur does. Returns once the
// browser has left the code screen.
async function signInWithCode(cdp, code, options = {}) {
  await fillField(cdp, '#owner-email', options.email || OWNER_EMAIL);
  await submitForm(cdp);
  const codeScreen = await waitFor(cdp, `document.querySelector('#owner-code') !== null`, 25000);
  check(`${options.label || 'login'}: the code screen appears after the address`, codeScreen);
  await fillField(cdp, '#owner-code', code);
  await submitForm(cdp);
  const left = await waitFor(cdp, `document.querySelector('#owner-code') === null`, 25000);
  check(`${options.label || 'login'}: the code screen closes after a verified code`, left);
}


// ─── scenario 2: de drie claimstatussen naast elkaar ────────────────────────

async function statusesScenario(cdp) {
  const options = {
    name: 'statussen',
    theme: 'light',
    email: OWNER_EMAIL,
    roles: [{ role: 'owner', restaurant_id: '1' }],
    claims: [
      { id: 'claim-approved', restaurant_id: '1', status: 'approved', created_at: '2026-10-01T09:00:00.000Z' },
      { id: 'claim-pending', restaurant_id: '2', status: 'pending', created_at: '2026-10-28T10:00:00.000Z' },
      { id: 'claim-rejected', restaurant_id: '3', status: 'rejected', decided_at: '2026-10-29T12:00:00.000Z' },
    ],
  };
  await startOwnerLogin(cdp, options);
  await signInWithCode(cdp, EMAIL_CODE, { label: 'statussen' });
  const ready = await waitForText(cdp, 'Restaurant Wolfslaar', 25000);
  check('statussen: het overzicht staat er', ready);

  const state = await pageState(cdp);
  for (const [status, text] of [
    ['approved', 'Goedgekeurd'],
    ['pending', 'In behandeling'],
    ['rejected', 'Afgewezen'],
  ]) {
    check(
      `statussen: "${text}" staat er met de eigen chip`,
      state.statusChips.some((chip) => chip.text === text && chip.className.indexOf(`owner-status--${status}`) >= 0),
      JSON.stringify(state.statusChips),
    );
  }
  check(
    'statussen: de wachtende claim noemt het restaurant en vraagt niets',
    state.body.indexOf('Je claim') >= 0 || state.body.indexOf('beoordeelt je aanvraag') >= 0,
    state.body.slice(0, 200),
  );
  check(
    'statussen: de afgewezen claim biedt de route om opnieuw te claimen',
    state.links.some((link) => link.text === 'Opnieuw claimen' && link.href === '/claim/3'),
    JSON.stringify(state.links),
  );
  check(
    'statussen: een wachtende claim heeft geen beheerknop',
    !state.links.some((link) => link.href === '/claim/2'),
    JSON.stringify(state.links),
  );
  await desktopShot(cdp, 'be47-statussen-1280-licht.png', 'light');
  await mobileShot(cdp, 'be47-statussen-390-licht.png', 'light');
  await applyTheme(cdp, 'light');
}

// ─── scenario 3: account verwijderen met een verse code ─────────────────────

async function deleteScenario(cdp) {
  const options = {
    name: 'verwijderen',
    theme: 'light',
    email: OWNER_EMAIL,
    roles: [{ role: 'owner', restaurant_id: '1' }],
    claims: [{ id: 'claim-1', restaurant_id: '1', status: 'approved' }],
  };
  await startOwnerLogin(cdp, options);
  await signInWithCode(cdp, EMAIL_CODE, { label: 'verwijderen' });
  const ready = await waitForText(cdp, 'Restaurant Wolfslaar', 25000);
  check('verwijderen: het overzicht staat er', ready);

  await clickButton(cdp, 'Account verwijderen');
  const confirmShown = await waitForText(cdp, 'Weet je het zeker?', 15000);
  check('verwijderen: eerst een bevestiging, geen directe verwijdering', confirmShown);
  check(
    'verwijderen: er is nog niets verwijderd voordat de code is ingevuld',
    (await evalJs(cdp, 'window.__BE48__ ? window.__BE48__.deletedAccount() : true')) === false,
  );

  await clickButton(cdp, 'Stuur code');
  const codeShown = await waitFor(cdp, `document.querySelector('#owner-delete-code') !== null`, 20000);
  check('verwijderen: de verse code wordt gevraagd', codeShown);
  const codeState = await pageState(cdp);
  check(
    'verwijderen: het codeveld is numeriek met autocomplete="one-time-code"',
    Boolean(
      codeState.deleteCode &&
        codeState.deleteCode.autocomplete === 'one-time-code' &&
        codeState.deleteCode.inputmode === 'numeric',
    ),
    JSON.stringify(codeState.deleteCode),
  );
  await mobileShot(cdp, 'be47-verwijderen-390-licht.png', 'light');
  await applyTheme(cdp, 'light');

  await fillField(cdp, '#owner-delete-code', WRONG_CODE);
  await submitForm(cdp);
  const wrongAlert = await waitFor(cdp, `document.querySelector('[role="alert"]') !== null`, 20000);
  const wrongState = await pageState(cdp);
  check(
    'verwijderen: een foute code wordt in het Nederlands geweigerd',
    wrongAlert && wrongState.alerts.includes(WRONG_EMAIL_CODE_TEXT),
    JSON.stringify(wrongState.alerts),
  );
  check(
    'verwijderen: na een foute code bestaat het account nog',
    (await evalJs(cdp, 'window.__BE48__ ? window.__BE48__.deletedAccount() : true')) === false,
  );

  await fillField(cdp, '#owner-delete-code', EMAIL_CODE);
  await submitForm(cdp);
  const signedOut = await waitForPath(cdp, '/mijn-restaurant/inloggen', 25000);
  check('verwijderen: na de juiste code gaat de bezoeker terug naar het inloggen', signedOut);

  const deleted = await evalJs(cdp, 'window.__BE48__ ? window.__BE48__.deletedAccount() : false');
  check('verwijderen: de serverroute heeft het eigen account verwijderd', deleted === true);

  const requests = await evalJs(cdp, 'window.__BE48__ ? window.__BE48__.deleteRequests : []');
  check('verwijderen: er zijn precies twee pogingen gedaan', Array.isArray(requests) && requests.length === 2, JSON.stringify(requests && requests.length));
  check(
    'verwijderen: het verzoek bevat alleen de code, nooit een gebruikers-id of adres',
    Array.isArray(requests) &&
      requests.every((entry) => {
        if (!entry || typeof entry.body !== 'string') return false;
        const parsed = JSON.parse(entry.body);
        const keys = Object.keys(parsed);
        return keys.length === 1 && keys[0] === 'code';
      }),
    JSON.stringify(requests),
  );

  // The session is gone: the login screen is shown again, with the same neutral
  // address step as before.
  const afterState = await pageState(cdp);
  check('verwijderen: het inlogscherm staat er weer', afterState.heading === 'Inloggen voor restauranthouders', afterState.heading);
}


// ─── scenario 4: /internal stuurt een houder door, een beheerder niet ───────

async function redirectScenario(cdp) {
  // 1. Owner-only: /internal no longer shows "Nog niets te openen" but sends the
  //    account on to its own screen.
  const ownerOptions = {
    name: 'doorsturen (houder)',
    theme: 'light',
    email: OWNER_EMAIL,
    roles: [{ role: 'owner', restaurant_id: '1' }],
    claims: [{ id: 'claim-1', restaurant_id: '1', status: 'approved' }],
  };
  await startOwnerLogin(cdp, ownerOptions);
  await signInWithCode(cdp, EMAIL_CODE, { label: 'doorsturen (houder)' });
  const dashboardReady = await waitForPath(cdp, '/mijn-restaurant');
  check('doorsturen: de houder landt eerst op /mijn-restaurant', dashboardReady);

  await navigate(cdp, INTERNAL_URL, `document.readyState === 'complete'`);
  const redirected = await waitForPath(cdp, '/mijn-restaurant', 20000);
  check('doorsturen: /internal stuurt een owner-only account naar /mijn-restaurant', redirected);
  const ownerState = await pageState(cdp);
  check(
    'doorsturen: "Nog niets te openen" bestaat niet meer voor de houder',
    ownerState.body.indexOf('Nog niets te openen') === -1,
    ownerState.body.slice(0, 160),
  );

  // 2. An internal account that uses the owner sign-in ends on /internal/login and
  //    its token is still aal1: the second step of BE-48 cannot be skipped.
  const internalOptions = {
    name: 'doorsturen (beheerder)',
    theme: 'light',
    email: 'medewerker@example.invalid',
    roles: [{ role: 'internal', restaurant_id: null }],
    claims: [],
  };
  await startOwnerLogin(cdp, internalOptions);
  await signInWithCode(cdp, EMAIL_CODE, { label: 'doorsturen (beheerder)' });
  const sentToInternalLogin = await waitForPath(cdp, INTERNAL_LOGIN_PATH, 25000);
  check('doorsturen: een internal-account gaat naar /internal/login', sentToInternalLogin);
  check(
    'doorsturen: de tweede stap is niet omzeild (token blijft aal1)',
    (await evalJs(cdp, 'window.__BE48__ ? window.__BE48__.assurance() : "aal2"')) === 'aal1',
  );
}

// ─── bewijs ────────────────────────────────────────────────────────────────

function headSha() {
  try {
    return require('node:child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .trim();
  } catch (error) {
    return null;
  }
}

const SCENARIOS = [
  { name: 'inloggen', run: (cdp) => loginScenario(cdp) },
  { name: 'statussen', run: (cdp) => statusesScenario(cdp) },
  { name: 'verwijderen', run: (cdp) => deleteScenario(cdp) },
  { name: 'doorsturen', run: (cdp) => redirectScenario(cdp) },
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

const SAFE_SCENARIOS = SCENARIOS.map((scenario) => ({
  name: scenario.name,
  run: async (cdp) => {
    try {
      await scenario.run(cdp);
    } catch (error) {
      console.log('scenario-error', String((error && error.stack) || error));
      check(
        `${scenario.name}: the scenario ran without an exception`,
        false,
        String((error && error.stack) || error).split('\n')[0],
      );
    }
  },
}));

const EVIDENCE_PATH = filteredEvidencePath(EVIDENCE_PATH_BASE, SELECTION.filter);

// In dev mode Next compiles a route on its first request, and that compile can
// force a reload that would reset the in-page stub mid-scenario.
async function warmUp(cdp) {
  console.log('warm-up: compiling the routes this check visits');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: authStubScript({}) });
  for (const url of [LOGIN_URL, DASHBOARD_URL, INTERNAL_URL, `${APP}/internal/login`]) {
    await navigate(cdp, url, `document.readyState === 'complete'`);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  await navigate(cdp, LOGIN_URL, `document.readyState === 'complete'`);
}


async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SAFE_SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  let server = null;
  let browser = null;
  let cdp = null;
  try {
    console.log(`starting the local app on ${APP}`);
    server = await startServer({
      port: PORT,
      appUrl: APP,
      outputDir: OUT_DIR,
      readyPath: '/mijn-restaurant/inloggen',
    });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // The CDP layer refuses every request that is not the local app, as a second
    // lock behind the in-page stub.
    const networkGuard = createNetworkGuard({ appOrigins: APP_ORIGINS, baseUrl: LOGIN_URL });
    await enableFetchGuard(cdp, networkGuard);

    await warmUp(cdp);
    scenarioRuns = await runScenarioSelection({ entries: SAFE_SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const pageViolations = await evalJs(cdp, '(window.__BE48__ ? window.__BE48__.violations : [])');
    check(
      'netwerk: geen onbekende route of extern verzoek geregistreerd',
      pageViolations.length === 0,
      JSON.stringify(pageViolations.slice(0, 3)),
    );
    const guardViolations = networkGuard.appViolations();
    check(
      'netwerk: de CDP-laag blokkeerde geen appverkeer',
      guardViolations.length === 0,
      JSON.stringify(guardViolations.slice(0, 3)),
    );
    networkEvidence = { appViolations: guardViolations, pageViolations };

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

    const failed = checks.filter((entry) => entry.passed === false);
    const record = {
      generatedAt: new Date().toISOString(),
      kind: 'developer evidence — local app with a fictional Supabase, no production data or credentials',
      contract: 'issue #111 BE-47 (inloggen met e-mailcode voor restauranthouders)',
      head: headSha(),
      app: APP,
      // A filtered run names its choice and is never the full evidence.
      filter: SELECTION.filter,
      scenarios: scenarioRuns,
      network: networkEvidence,
      checks: { total: checks.length, failed: failed.length, entries: checks },
      screenshotsDir: 'ops/browser/evidence/be-47',
      screenshots: shots,
      limits:
        'Fixture evidence: a real browser against a fictional Supabase. No real Supabase project, mailbox, sms, credential or production acceptance.',
      result: failed.length === 0 ? 'passed' : 'failed',
    };
    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          result: record.result,
          checks: checks.length,
          failed: failed.length,
          screenshots: shots.length,
          out: path.relative(REPO_ROOT, EVIDENCE_PATH),
        },
        null,
        2,
      ),
    );
    if (failed.length > 0) {
      for (const entry of failed) console.log(`FAIL ${entry.name} :: ${entry.detail}`);
      process.exitCode = 1;
    }
  } finally {
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch (error) {
        // A locked temporary profile is harmless; it stays outside the repo.
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  try {
    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(
      EVIDENCE_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          kind: 'developer evidence — local app with a fictional Supabase, run aborted',
          contract: 'issue #111 BE-47',
          app: APP,
          filter: SELECTION.filter,
          scenarios: scenarioRuns,
          checks: { total: checks.length, failed: checks.filter((entry) => !entry.passed).length, entries: checks },
          screenshots: shots,
          error: String((error && error.stack) || error),
          result: 'failed',
        },
        null,
        2,
      )}\n`,
    );
  } catch (writeError) {
    console.error(writeError);
  }
  process.exitCode = 1;
});

