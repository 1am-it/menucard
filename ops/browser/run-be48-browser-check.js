'use strict';

// BE-48 (#112) — fixture browser check for the internal sign-in with a second
// step.
//
// Drives the real /internal/login and /internal/wachtwoord-vergeten pages in a
// local Next.js app with a fictional Supabase (ops/browser/lib/be48-auth-stub.js)
// and fictional app answers. FIXTURE EVIDENCE: no real Supabase project, no
// production credential, no production data, no internet.
//
// What it proves in a real browser:
//  - the password screen: real <label>s, autocomplete, the "Toon" button with
//    aria-pressed, the "Wachtwoord vergeten?" link, >= 44 px controls, no English
//    Supabase text, and the contract sentence for a wrong password;
//  - a first sign-in: "Beveilig je account met een app" with a QR image and the
//    manual key, then a code from the app;
//  - a wrong code gives the contract sentence, the right code continues to the
//    same landing place as before (/internal/menu-concepts for this fictional
//    workqueue);
//  - an account that already linked an app goes straight to "Code uit je app";
//  - "Wachtwoord vergeten": the neutral answer, then the code screen, a wrong
//    code in Dutch, and the right code continuing to /internal/set-password;
//  - BE-48 part 2 — the public claim on /claim/6: the address, then the code
//    screen, the right code signing in and the claim being submitted; a wrong
//    code in Dutch, "Nieuwe code sturen" asking again and "Ander e-mailadres"
//    returning to the address step;
//  - light and dark screenshots of the password, code and link-an-app screens,
//    plus the same screens (login, code, linking, forgot password, claim code)
//    at 390 px in both themes in ops/browser/evidence/be48-screenshots/.
//
// Not proven here: a real Supabase project, a real authenticator app, a real
// e-mail, or any production behaviour. This is developer evidence, not
// independent review or acceptance.

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
const OUT_DIR = path.join(__dirname, 'output', 'be-48');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be48-browser-evidence.json');
const SCRIPT_NAME = 'run-be48-browser-check.js';
const PORT = Number(process.env.BE48_FIXTURE_PORT || 3141);
const APP = `http://localhost:${PORT}`;
const LOGIN_URL = `${APP}/internal/login`;
const FORGOT_URL = `${APP}/internal/wachtwoord-vergeten`;
// Restaurant 6 exists in data/restaurants.json ("Brasserie Bardot"); the claim
// page reads its name from the real dataset.
const CLAIM_RESTAURANT_ID = '6';
const CLAIM_URL = `${APP}/claim/${CLAIM_RESTAURANT_ID}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const LANDING = '/internal/menu-concepts';

const EMAIL = 'medewerker@example.invalid';
const PASSWORD = 'goed-wachtwoord';
const CODE = '123456';
// The fictional claim visitor and the fictional code in their e-mail (a
// different code than the authenticator app's).
const CLAIM_EMAIL = 'eigenaar@example.invalid';
const CLAIM_CODE = '654321';
const WRONG_PASSWORD_TEXT = 'E-mailadres of wachtwoord klopt niet. Controleer ze en probeer het opnieuw.';
const WRONG_CODE_TEXT = 'Die code klopt niet of is verlopen. Probeer de nieuwste code uit je app.';
// A rejected claim code uses the e-mail wording from src/lib/authErrors.js.
const WRONG_EMAIL_CODE_TEXT = 'Deze code is ongeldig of verlopen. Vraag een nieuwe code aan.';
const NEUTRAL_TEXT = 'Als dit e-mailadres bij ons bekend is, ontvang je een e-mail met een code.';
// Criterion 7 asks for light and dark screenshots on a 390 px wide screen; they
// are kept with the evidence, not in the gitignored run output.
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;
const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, 'be48-screenshots');

const checks = [];
const shots = [];
let scenarioRuns = null;
let networkEvidence = null;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}


async function shot(cdp, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = await screenshot(cdp, OUT_DIR, name);
  shots.push({ name, ...file });
  return file;
}

// BE-48 criterion 7 — the light and dark screenshots that belong with the
// delivery: 390 px wide (a phone), written into the evidence directory instead of
// the gitignored run output, and recorded in the evidence JSON with their theme
// and viewport.
async function mobileShot(cdp, name, theme) {
  const applied = await applyTheme(cdp, theme);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE_WIDTH,
    height: MOBILE_HEIGHT,
    deviceScaleFactor: 1,
    mobile: true,
  });
  // Let the layout settle at the new width before capturing.
  const sized = await waitFor(cdp, `window.innerWidth === ${MOBILE_WIDTH}`, 8000);
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SCREENSHOT_DIR, name);
  shots.push({
    name,
    theme,
    viewport: `${MOBILE_WIDTH}x${MOBILE_HEIGHT}`,
    path: `ops/browser/evidence/be48-screenshots/${name}`,
    themeApplied: applied,
    widthMatched: sized,
    ...file,
  });
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
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value === ${JSON.stringify(value)};
    })()`,
  );
  if (!filled) throw new Error(`could_not_fill: ${selector}`);
}

async function submitForm(cdp, selector) {
  await evalJs(
    cdp,
    `(() => {
      const form = document.querySelector(${JSON.stringify(selector || 'form')});
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()`,
  );
}

// The claim's secondary actions are buttons, not form submits.
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

// Which addresses the fictional Supabase was asked to mail a code to.
async function otpRequests(cdp) {
  return evalJs(cdp, '(window.__BE48__ ? window.__BE48__.otpRequests : [])');
}

async function waitForText(cdp, text, timeoutMs = 25000) {
  return waitFor(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(text)})`, timeoutMs);
}

// Hydration marker: React stores its props (including the event handlers) on the
// DOM node itself. Until that key exists, a submit would be a plain browser GET.
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

async function pageState(cdp) {
  // A document can be mid-navigation; there is no documentElement for a moment.
  await waitFor(cdp, 'document.documentElement !== null && document.body !== null', 10000);
  return evalJs(
    cdp,
    `(() => {
      const field = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const labels = el.labels ? Array.from(el.labels).map((entry) => entry.innerText.trim()) : [];
        return {
          id: el.id || null,
          labels: labels,
          autocomplete: el.getAttribute('autocomplete'),
          inputmode: el.getAttribute('inputmode'),
          height: Math.round(el.getBoundingClientRect().height),
          placeholder: el.getAttribute('placeholder'),
          value: typeof el.value === 'string' ? el.value : null,
          type: el.getAttribute('type'),
        };
      };
      const alert = document.querySelector('[role="alert"]');
      const status = document.querySelector('[role="status"]');
      const qr = document.querySelector('.auth-qr');
      const secret = document.querySelector('.auth-secret');
      return {
        heading: document.querySelector('h1') ? document.querySelector('h1').innerText.trim() : null,
        email: field('#auth-email'),
        password: field('#auth-password'),
        code: field('#auth-code'),
        // BE-48 claim screen (a public page, so its own ids).
        claimEmail: field('#claim-email'),
        claimCode: field('#claim-code'),
        alert: alert ? alert.innerText.trim() : null,
        notice: status ? status.innerText.trim() : null,
        buttons: Array.from(document.querySelectorAll('button')).map((el) => ({
          text: (el.innerText || '').trim(),
          pressed: el.getAttribute('aria-pressed'),
          height: Math.round(el.getBoundingClientRect().height),
        })),
        qr: qr ? { src: qr.getAttribute('src'), alt: qr.getAttribute('alt') } : null,
        secret: secret ? secret.innerText.trim() : null,
        body: document.body ? document.body.innerText : '',
        theme: document.documentElement ? document.documentElement.getAttribute('data-theme') : null,
        path: location.pathname,
      };
    })()`,
  );
}

// A session from a previous scenario must never leak into the next one. The claim
// page reads the stored session on mount, so each scenario starts signed out.
// This runs between scenarios only — never inside one: the forgot-password flow
// reloads the document on its way to /internal/set-password, and that reload must
// keep the recovery session, so the stub itself leaves storage alone.
async function resetAuthStorage(cdp) {
  await navigate(cdp, LOGIN_URL, `document.readyState === 'complete'`);
  const removed = await evalJs(
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
  return removed;
}

async function startLogin(cdp, options) {
  await resetAuthStorage(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: authStubScript(options) });
  await navigate(cdp, LOGIN_URL, `document.querySelector('h1') !== null`);
  // The server HTML is on screen before React has taken over the form; a native
  // submit would put the password in the URL. Wait for the real handlers.
  const hydrated = await waitForHydration(cdp, 'form');
  check('login: the form is interactive (React hydration) before typing', hydrated);
  return evalJs(cdp, 'window.__BE48__ ? window.__BE48__.settings : null');
}

// The claim page is public: it reads the stored session on mount, so this starts
// from a signed-out state (`resetAuthStorage`).
async function startClaim(cdp, options) {
  await resetAuthStorage(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: authStubScript(options) });
  await navigate(cdp, CLAIM_URL, `document.querySelector('#claim-email') !== null`);
  const hydrated = await waitForHydration(cdp, 'form');
  check('claim: the form is interactive (React hydration) before typing', hydrated);
  return evalJs(cdp, 'window.__BE48__ ? window.__BE48__.settings : null');
}

// In dev mode Next compiles a route on its first request, and that first compile
// can force a full page reload — which would reset the in-page stub in the middle
// of a scenario. Every route this check visits is therefore compiled first.
async function warmUp(cdp) {
  console.log('warm-up: compiling the routes this check visits');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: authStubScript({}) });
  const routes = [
    LOGIN_URL,
    FORGOT_URL,
    `${APP}/internal`,
    `${APP}/internal/menu-concepts`,
    `${APP}/internal/set-password`,
    CLAIM_URL,
  ];
  for (const url of routes) {
    await navigate(cdp, url, `document.readyState === 'complete'`);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  await navigate(cdp, LOGIN_URL, `document.readyState === 'complete'`);
}

// ─── scenario 1: password → link the app → code → landing ─────────────────

async function passwordToEnroll(cdp) {
  const settings = await startLogin(cdp, { theme: 'light', factors: [] });
  check('login: the fictional Supabase stub is installed', Boolean(settings), JSON.stringify(settings && settings.roles));
  const initial = await pageState(cdp);
  check('login: heading is "Inloggen (intern)"', initial.heading === 'Inloggen (intern)', initial.heading);
  check(
    'login: e-mail has a real label and autocomplete="username"',
    (initial.email.labels || []).join(' ') === 'E-mailadres' && initial.email.autocomplete === 'username',
    JSON.stringify(initial.email),
  );
  check(
    'login: password has a real label and autocomplete="current-password"',
    (initial.password.labels || []).join(' ') === 'Wachtwoord' && initial.password.autocomplete === 'current-password',
    JSON.stringify(initial.password),
  );
  const toggle = initial.buttons.find((button) => button.text === 'Toon');
  check(
    'login: "Toon" has aria-pressed="false" and is at least 44 px',
    Boolean(toggle) && toggle.pressed === 'false' && toggle.height >= 44,
    JSON.stringify(toggle),
  );
  await evalJs(cdp, `document.querySelector('.auth-toggle').click()`);
  const toggled = await evalJs(
    cdp,
    `(() => ({
      type: document.querySelector('#auth-password').type,
      pressed: document.querySelector('.auth-toggle').getAttribute('aria-pressed'),
      text: document.querySelector('.auth-toggle').innerText.trim(),
    }))()`,
  );
  check(
    'login: "Toon" shows the password and flips aria-pressed',
    toggled.type === 'text' && toggled.pressed === 'true' && toggled.text === 'Verberg',
    JSON.stringify(toggled),
  );
  await evalJs(cdp, `document.querySelector('.auth-toggle').click()`);
  check(
    'login: the "Wachtwoord vergeten?" link is present',
    await evalJs(cdp, `Boolean(document.querySelector('a[href="/internal/wachtwoord-vergeten"]'))`),
  );
  check(
    'login: the password field is a real password field again',
    (await evalJs(cdp, `document.querySelector('#auth-password').type`)) === 'password',
  );
  // No unsafe device memory and no placeholder-only field.
  check('login: "Dit apparaat 30 dagen onthouden" is absent', !initial.body.includes('30 dagen'), initial.body.slice(0, 120));
  check(
    'login: e-mail and password are labelled, never placeholder-only',
    !(await evalJs(cdp, `Boolean(document.querySelector('#auth-email[placeholder], #auth-password[placeholder]'))`)),
  );
  const targets = [initial.email.height, initial.password.height, ...initial.buttons.map((button) => button.height)];
  check('login: every control is at least 44 px high', targets.every((height) => height >= 44), JSON.stringify(targets));

  await applyTheme(cdp, 'light');
  await shot(cdp, 'be48-login-licht-1280.png');
  await applyTheme(cdp, 'dark');
  await shot(cdp, 'be48-login-donker-1280.png');
  // Criterion 7: the same screen on a 390 px phone, in both themes.
  await mobileShot(cdp, 'be48-login-licht-390.png', 'light');
  await mobileShot(cdp, 'be48-login-donker-390.png', 'dark');

  await fillField(cdp, '#auth-email', EMAIL);
  await fillField(cdp, '#auth-password', PASSWORD);
  await submitForm(cdp, 'form');
  const shown = await waitForText(cdp, 'Beveilig je account met een app');
  check('enroll: a first sign-in opens "Beveilig je account met een app"', shown);
  const enroll = await pageState(cdp);
  check(
    'enroll: the QR code is an image with an alternative text',
    Boolean(enroll.qr) && enroll.qr.src.startsWith('data:image/svg+xml') && Boolean(enroll.qr.alt),
    JSON.stringify(enroll.qr && { alt: enroll.qr.alt, src: enroll.qr.src.slice(0, 28) }),
  );
  check('enroll: the manual key is shown as text', enroll.secret === 'JBSWY3DPEHPK3PXP', enroll.secret);
  const qrState = await evalJs(
    cdp,
    `(() => {
      const img = document.querySelector('.auth-qr');
      return img ? { complete: img.complete, naturalWidth: img.naturalWidth } : null;
    })()`,
  );
  check('enroll: the QR image really renders (not a broken image)', Boolean(qrState && qrState.naturalWidth > 0), JSON.stringify(qrState));
  check(
    'enroll: the code field is labelled, numeric and one-time-code',
    (enroll.code.labels || []).join(' ') === 'Code uit je app' &&
      enroll.code.inputmode === 'numeric' &&
      enroll.code.autocomplete === 'one-time-code',
    JSON.stringify(enroll.code),
  );
  check('enroll: the screen suggests linking a second device', enroll.body.includes('tweede apparaat'));
  await applyTheme(cdp, 'light');
  await shot(cdp, 'be48-koppelen-licht-1280.png');
  await applyTheme(cdp, 'dark');
  await shot(cdp, 'be48-koppelen-donker-1280.png');
  // Criterion 7: linking an app (QR + manual key) on a 390 px phone.
  await mobileShot(cdp, 'be48-koppelen-licht-390.png', 'light');
  await mobileShot(cdp, 'be48-koppelen-donker-390.png', 'dark');
  return enroll;
}


async function wrongAndRightCode(cdp) {
  await fillField(cdp, '#auth-code', '000000');
  await submitForm(cdp, 'form');
  const shown = await waitForText(cdp, WRONG_CODE_TEXT);
  const afterWrong = await pageState(cdp);
  check(
    'code: a wrong code shows the contract sentence in role="alert"',
    shown && afterWrong.alert === WRONG_CODE_TEXT,
    afterWrong.alert,
  );
  check('code: the raw Supabase text never appears', !/Invalid TOTP/i.test(afterWrong.body));
  await applyTheme(cdp, 'dark');
  await shot(cdp, 'be48-code-donker-1280.png');

  await fillField(cdp, '#auth-code', CODE);
  await submitForm(cdp, 'form');
  const landed = await waitForPath(cdp, LANDING);
  if (!landed) {
    // Keep the diagnosis with the failing check instead of guessing later.
    const debug = await evalJs(
      cdp,
      `(() => ({
        path: location.pathname,
        assurance: window.__BE48__ ? window.__BE48__.assurance() : null,
        alert: document.querySelector('[role="alert"]') ? document.querySelector('[role="alert"]').innerText.trim() : null,
        calls: window.__BE48__ ? window.__BE48__.calls.map((call) => call.method + ' ' + call.path) : [],
      }))()`,
    );
    console.log('landing-debug', JSON.stringify(debug));
  }
  check('code: the right code continues to the existing landing place', landed, await evalJs(cdp, 'location.pathname'));
}

const SCENARIO_LINK_APP = {
  name: 'inloggen-en-koppelen',
  run: async (cdp) => {
    await passwordToEnroll(cdp);
    await wrongAndRightCode(cdp);
  },
};

const SCENARIO_WRONG_PASSWORD = {
  name: 'fout-wachtwoord',
  run: async (cdp) => {
    await startLogin(cdp, { theme: 'light', factors: [] });
    await fillField(cdp, '#auth-email', EMAIL);
    await fillField(cdp, '#auth-password', 'fout-wachtwoord');
    await submitForm(cdp, 'form');
    const shown = await waitForText(cdp, WRONG_PASSWORD_TEXT);
    const state = await pageState(cdp);
    check(
      'wrong password: the contract sentence appears in role="alert"',
      shown && state.alert === WRONG_PASSWORD_TEXT,
      state.alert,
    );
    check('wrong password: no English Supabase text on screen', !/Invalid login credentials/i.test(state.body));
    check(
      'wrong password: the visitor stays on the login screen',
      state.path === '/internal/login' && state.heading === 'Inloggen (intern)',
      JSON.stringify({ path: state.path, heading: state.heading }),
    );
    await applyTheme(cdp, 'light');
    await shot(cdp, 'be48-login-fout-licht-1280.png');
  },
};

const SCENARIO_FORGOT = {
  name: 'wachtwoord-vergeten',
  run: async (cdp) => {
    await startLogin(cdp, { theme: 'light', factors: [] });
    await navigate(cdp, FORGOT_URL, `document.querySelector('h1') !== null`);
    const forgotHydrated = await waitForHydration(cdp, 'form');
    check('forgot: the form is interactive (React hydration) before typing', forgotHydrated);
    const initial = await pageState(cdp);
    check('forgot: heading is "Wachtwoord vergeten"', initial.heading === 'Wachtwoord vergeten', initial.heading);
    check(
      'forgot: e-mail has a real label and autocomplete="username"',
      (initial.email.labels || []).join(' ') === 'E-mailadres' && initial.email.autocomplete === 'username',
      JSON.stringify(initial.email),
    );
    check('forgot: the neutral promise is not shown before sending', !initial.body.includes(NEUTRAL_TEXT));

    await fillField(cdp, '#auth-email', 'onbekend@example.invalid');
    await submitForm(cdp, 'form');
    const neutral = await waitForText(cdp, NEUTRAL_TEXT);
    const codeStep = await pageState(cdp);
    check(
      'forgot: an unknown address gets the same neutral answer',
      neutral && !codeStep.alert,
      JSON.stringify({ neutral, alert: codeStep.alert }),
    );
    check(
      'forgot: the code field is numeric with autocomplete="one-time-code"',
      Boolean(codeStep.code) &&
        codeStep.code.inputmode === 'numeric' &&
        codeStep.code.autocomplete === 'one-time-code',
      JSON.stringify(codeStep.code),
    );
    const stepButtons = codeStep.buttons.map((button) => button.text);
    check(
      'forgot: "Nieuwe code sturen" and "Ander e-mailadres" are offered',
      stepButtons.includes('Nieuwe code sturen') && stepButtons.includes('Ander e-mailadres'),
      JSON.stringify(stepButtons),
    );
    check(
      'forgot: every control is at least 44 px high',
      codeStep.buttons.every((button) => button.height >= 44),
      JSON.stringify(codeStep.buttons.map((button) => button.height)),
    );
    await applyTheme(cdp, 'light');
    await shot(cdp, 'be48-wachtwoord-vergeten-licht-1280.png');
    await applyTheme(cdp, 'dark');
    await shot(cdp, 'be48-wachtwoord-vergeten-donker-1280.png');
    // Criterion 7: the forgot-password code screen on a 390 px phone.
    await mobileShot(cdp, 'be48-wachtwoord-vergeten-licht-390.png', 'light');
    await mobileShot(cdp, 'be48-wachtwoord-vergeten-donker-390.png', 'dark');

    await fillField(cdp, '#auth-code', '000000');
    await submitForm(cdp, 'form');
    const wrongText = 'Deze code is ongeldig of verlopen. Vraag een nieuwe code aan.';
    const wrong = await waitForText(cdp, wrongText);
    const afterWrong = await pageState(cdp);
    check('forgot: a wrong code is Dutch and in role="alert"', wrong && afterWrong.alert === wrongText, afterWrong.alert);

    await fillField(cdp, '#auth-code', CODE);
    await submitForm(cdp, 'form');
    const moved = await waitForPath(cdp, '/internal/set-password');
    check('forgot: the right code continues to the existing set-password page', moved, await evalJs(cdp, 'location.pathname'));
    const setPassword = await waitForText(cdp, 'Nieuw wachtwoord');
    if (!setPassword) {
      const debug = await evalJs(
        cdp,
        `(() => ({
          path: location.pathname,
          body: document.body ? document.body.innerText.slice(0, 400) : '',
          alert: document.querySelector('[role="alert"]') ? document.querySelector('[role="alert"]').innerText.trim() : null,
          calls: window.__BE48__ ? window.__BE48__.calls.map((call) => call.method + ' ' + call.path) : [],
          storage: Object.keys(localStorage),
        }))()`,
      );
      console.log('set-password-debug', JSON.stringify(debug));
    }
    check('forgot: the set-password page shows the new-password fields', setPassword);
  },
};

const SCENARIO_EXISTING_APP = {
  name: 'bestaande-app',
  run: async (cdp) => {
    await startLogin(cdp, {
      theme: 'dark',
      factors: [{ id: 'factor-fixture', factor_type: 'totp', status: 'verified' }],
    });
    await fillField(cdp, '#auth-email', EMAIL);
    await fillField(cdp, '#auth-password', PASSWORD);
    await submitForm(cdp, 'form');
    const shown = await waitForText(cdp, 'Code uit je app');
    const state = await pageState(cdp);
    check(
      'existing app: the code screen appears straight after the password',
      shown && state.heading === 'Code uit je app',
      JSON.stringify({ shown, heading: state.heading }),
    );
    check('existing app: no QR code and no link-an-app text', state.qr === null && !state.body.includes('Beveilig je account'), JSON.stringify({ qr: state.qr }));
    await applyTheme(cdp, 'light');
    await shot(cdp, 'be48-code-licht-1280.png');
    await applyTheme(cdp, 'dark');
    await shot(cdp, 'be48-code-donker-1280.png');
    // Criterion 7: the code step ("Code uit je app") on a 390 px phone.
    await mobileShot(cdp, 'be48-code-licht-390.png', 'light');
    await mobileShot(cdp, 'be48-code-donker-390.png', 'dark');

    await fillField(cdp, '#auth-code', CODE);
    await submitForm(cdp, 'form');
    check(
      'existing app: the right code continues to the landing place',
      await waitForPath(cdp, LANDING),
      await evalJs(cdp, 'location.pathname'),
    );
  },
};

const SCENARIO_OWNER_ONLY = {
  name: 'eigenaar-zonder-app',
  run: async (cdp) => {
    await startLogin(cdp, { theme: 'light', factors: [], roles: [{ role: 'owner', restaurant_id: '6' }] });
    await fillField(cdp, '#auth-email', EMAIL);
    await fillField(cdp, '#auth-password', PASSWORD);
    await submitForm(cdp, 'form');
    // No internal/editor role: the existing status page is the landing place and
    // no authenticator app is asked for (BE-47 owns the restaurant route).
    const landed = await waitForPath(cdp, '/internal');
    const state = await pageState(cdp);
    if (!landed) {
      const debug = await evalJs(
        cdp,
        `(() => ({
          path: location.pathname,
          alert: document.querySelector('[role="alert"]') ? document.querySelector('[role="alert"]').innerText.trim() : null,
          assurance: window.__BE48__ ? window.__BE48__.assurance() : null,
          calls: window.__BE48__ ? window.__BE48__.calls.map((call) => call.method + ' ' + call.path) : [],
          storage: Object.keys(localStorage),
        }))()`,
      );
      console.log('owner-debug', JSON.stringify(debug));
    }
    check(
      'owner-only: a restaurant owner does not have to link an app',
      landed && !state.body.includes('Beveilig je account') && !state.body.includes('Code uit je app'),
      JSON.stringify({ landed, path: state.path }),
    );
  },
};

// ─── scenario 6: claim met een code uit de e-mail ──────────────────────────

const SCENARIO_CLAIM_CODE = {
  name: 'claim-met-code',
  run: async (cdp) => {
    const settings = await startClaim(cdp, {
      theme: 'light',
      roles: [{ role: 'owner', restaurant_id: CLAIM_RESTAURANT_ID }],
    });
    check('claim: the fictional Supabase stub is installed', Boolean(settings), JSON.stringify(settings && settings.roles));

    const initial = await pageState(cdp);
    check(
      'claim: heading is "Claim dit restaurant"',
      typeof initial.heading === 'string' && initial.heading.startsWith('Claim dit restaurant'),
      initial.heading,
    );
    check('claim: the restaurant from the dataset is named', initial.body.includes('Brasserie Bardot'), initial.body.slice(0, 160));
    check(
      'claim: e-mail has a real label and autocomplete="email"',
      (initial.claimEmail.labels || []).join(' ') === 'E-mailadres' && initial.claimEmail.autocomplete === 'email',
      JSON.stringify(initial.claimEmail),
    );
    check('claim: the e-mail field is never placeholder-only', initial.claimEmail.placeholder === null, initial.claimEmail.placeholder);
    check(
      'claim: every control is at least 44 px high',
      [initial.claimEmail.height, ...initial.buttons.map((button) => button.height)].every((height) => height >= 44),
      JSON.stringify([initial.claimEmail.height, ...initial.buttons.map((button) => button.height)]),
    );

    await fillField(cdp, '#claim-email', CLAIM_EMAIL);
    await submitForm(cdp, 'form');
    const codeScreen = await waitFor(cdp, `document.querySelector('#claim-code') !== null`, 15000);
    const codeState = await pageState(cdp);
    check('claim: sending the address opens the code screen', codeScreen && Boolean(codeState.claimCode), JSON.stringify({ codeScreen }));
    check(
      'claim: the code field is labelled, numeric and one-time-code',
      (codeState.claimCode.labels || []).join(' ') === 'Code uit de e-mail' &&
        codeState.claimCode.inputmode === 'numeric' &&
        codeState.claimCode.autocomplete === 'one-time-code',
      JSON.stringify(codeState.claimCode),
    );
    check('claim: the screen names the address the code went to', codeState.body.includes(CLAIM_EMAIL), codeState.body.slice(0, 200));
    const codeButtons = codeState.buttons.map((button) => button.text);
    check(
      'claim: "Nieuwe code sturen" and "Ander e-mailadres" are offered',
      codeButtons.includes('Nieuwe code sturen') && codeButtons.includes('Ander e-mailadres'),
      JSON.stringify(codeButtons),
    );
    check(
      'claim: the code screen controls are at least 44 px high',
      [codeState.claimCode.height, ...codeState.buttons.map((button) => button.height)].every((height) => height >= 44),
      JSON.stringify([codeState.claimCode.height, ...codeState.buttons.map((button) => button.height)]),
    );
    // Only the phrases Supabase itself would show; a generic word search would
    // flag this page's own Dutch copy.
    const english = codeState.body.match(
      /invalid login|invalid token|token has expired|rate limit|user already registered|database error/i,
    );
    check(
      'claim: no English Supabase text on the code screen',
      english === null,
      english ? english[0] : 'geen Engelse melding',
    );

    // Criterion 7: the claim's code screen on a 390 px phone, both themes.
    await mobileShot(cdp, 'be48-claim-licht-390.png', 'light');
    await mobileShot(cdp, 'be48-claim-donker-390.png', 'dark');

    await fillField(cdp, '#claim-code', CLAIM_CODE);
    await submitForm(cdp, 'form');
    const signedIn = await waitForText(cdp, 'Dien claim in');
    const claimStep = await pageState(cdp);
    check(
      'claim: the right code signs the visitor in with the typed address',
      signedIn && claimStep.body.includes(`Ingelogd als ${CLAIM_EMAIL}`),
      claimStep.body.slice(0, 200),
    );

    await clickButton(cdp, 'Dien claim in');
    const submitted = await waitForText(cdp, 'In afwachting van beoordeling');
    const done = await pageState(cdp);
    check('claim: the claim is submitted and shows its pending status', submitted, done.body.slice(0, 200));
    check('claim: no error is shown after submitting', done.alert === null, done.alert);
    const requests = await otpRequests(cdp);
    check('claim: exactly one code was requested', requests.length === 1 && requests[0] === CLAIM_EMAIL, JSON.stringify(requests));
  },
};


// ─── scenario 7: een foute code, opnieuw sturen en een ander adres ─────────

const SCENARIO_CLAIM_WRONG_CODE = {
  name: 'claim-foute-code',
  run: async (cdp) => {
    await startClaim(cdp, { theme: 'dark' });
    await fillField(cdp, '#claim-email', CLAIM_EMAIL);
    await submitForm(cdp, 'form');
    await waitFor(cdp, `document.querySelector('#claim-code') !== null`, 15000);
    const sent = await otpRequests(cdp);
    check('claim: the first code was requested for the typed address', sent.length === 1 && sent[0] === CLAIM_EMAIL, JSON.stringify(sent));

    await fillField(cdp, '#claim-code', '000000');
    await submitForm(cdp, 'form');
    const shown = await waitForText(cdp, WRONG_EMAIL_CODE_TEXT);
    const wrong = await pageState(cdp);
    check(
      'claim: a wrong or expired code gets the Dutch sentence in role="alert"',
      shown && wrong.alert === WRONG_EMAIL_CODE_TEXT,
      JSON.stringify({ shown, alert: wrong.alert }),
    );
    check('claim: the raw Supabase token text never appears', !/token has expired|invalid token/i.test(wrong.body));
    check(
      'claim: "Nieuwe code sturen" is offered after a wrong code',
      wrong.buttons.some((button) => button.text === 'Nieuwe code sturen'),
      JSON.stringify(wrong.buttons.map((button) => button.text)),
    );

    await clickButton(cdp, 'Nieuwe code sturen');
    const noticeShown = await waitForText(cdp, 'We hebben een nieuwe code gestuurd naar');
    const resent = await pageState(cdp);
    check(
      'claim: "Nieuwe code sturen" asks Supabase again and says so',
      noticeShown && typeof resent.notice === 'string' && resent.notice.includes(CLAIM_EMAIL),
      JSON.stringify({ noticeShown, notice: resent.notice }),
    );
    const resentRequests = await otpRequests(cdp);
    check(
      'claim: the resend is a second request for the same address',
      resentRequests.length === 2 && resentRequests[1] === CLAIM_EMAIL,
      JSON.stringify(resentRequests),
    );

    await clickButton(cdp, 'Ander e-mailadres');
    const back = await waitFor(cdp, `document.querySelector('#claim-email') !== null`, 10000);
    const backState = await pageState(cdp);
    check('claim: "Ander e-mailadres" returns to the address step', back && !backState.claimCode, JSON.stringify({ back }));
    check(
      'claim: the typed address is kept for correction',
      Boolean(backState.claimEmail) && backState.claimEmail.value === CLAIM_EMAIL,
      JSON.stringify(backState.claimEmail),
    );
    check('claim: the old code error is cleared', backState.alert === null, backState.alert);

    // After resending and switching addresses the right code still works.
    await submitForm(cdp, 'form');
    await waitFor(cdp, `document.querySelector('#claim-code') !== null`, 15000);
    await fillField(cdp, '#claim-code', CLAIM_CODE);
    await submitForm(cdp, 'form');
    check(
      'claim: the right code still signs the visitor in afterwards',
      await waitForText(cdp, 'Dien claim in'),
      await evalJs(cdp, 'document.body ? document.body.innerText.slice(0, 200) : ""'),
    );
  },
};


// BE-43 (#101): elk scenario is één benoemde stap. Met `--alleen=<naam>` draait
// alleen die stap; met `--lijst` zie je de namen zonder dat er iets start.
const SCENARIOS = [
  SCENARIO_LINK_APP,
  SCENARIO_WRONG_PASSWORD,
  SCENARIO_FORGOT,
  SCENARIO_EXISTING_APP,
  SCENARIO_OWNER_ONLY,
  SCENARIO_CLAIM_CODE,
  SCENARIO_CLAIM_WRONG_CODE,
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

// One failing scenario must never hide the evidence of the others: an unexpected
// exception becomes a failed check with its message.
const SAFE_SCENARIOS = SCENARIOS.map((scenario) => ({
  name: scenario.name,
  run: async (cdp) => {
    try {
      await scenario.run(cdp);
    } catch (error) {
      console.log('scenario-error', String((error && error.stack) || error));
      check(`${scenario.name}: the scenario ran without an exception`, false, String((error && error.stack) || error).split('\n')[0]);
    }
  },
}));
// Een gefilterde run schrijft nooit naar het volledige bewijsbestand.
const EVIDENCE_PATH = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);

async function main() {
  // BE-43 (#101): `--lijst` shows the names and `--alleen=<naam>` runs the
  // selection. An unknown name is a usage error: nothing starts.
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
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: '/internal/login' });
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

    // BE-43 (#101): only the chosen scenarios, one output line each.
    scenarioRuns = await runScenarioSelection({ entries: SAFE_SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const pageViolations = await evalJs(cdp, '(window.__BE48__ ? window.__BE48__.violations : [])');
    check('network guard: the page recorded no unknown route or external request', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
    const guardViolations = networkGuard.appViolations();
    check('network guard: the CDP layer blocked no app traffic', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
    networkEvidence = { appViolations: guardViolations, pageViolations };

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('no uncaught browser exception', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));
    const bootError = await evalJs(cdp, 'window.__BE48_BOOT_ERROR__ || null');
    check('no stub bootstrap error', !bootError, bootError || 'ok');

    const failed = checks.filter((entry) => entry.passed === false);
    const record = {
      generatedAt: new Date().toISOString(),
      kind: 'developer evidence — local app with a fictional Supabase, no production data or credentials',
      contract: '#112 BE-48 (inloggen met tweede stap, wachtwoord vergeten)',
      app: APP,
      // BE-43 (#101): a filtered run names its choice and is never the full evidence.
      filter: SELECTION.filter,
      scenarios: scenarioRuns,
      network: networkEvidence,
      checks: { total: checks.length, failed: failed.length, entries: checks },
      screenshots: shots,
      // BE-48 criterion 7: the mobile light/dark screenshots live in the repo and
      // are named here, so the delivery names its own evidence.
      screenshotsDir: path.relative(REPO_ROOT, SCREENSHOT_DIR).split(path.sep).join('/'),
      screenshotsMobile: shots
        .filter((entry) => entry.viewport)
        .map((entry) => `${entry.name} (${entry.theme}, ${entry.viewport})`),
      limits:
        'Fixture evidence: a real browser against a fictional Supabase. Not a real Supabase project, authenticator app, e-mail, or production acceptance.',
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
  // A run that could not finish still leaves a record of what it did prove.
  try {
    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(
      EVIDENCE_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          kind: 'developer evidence — local app with a fictional Supabase, run aborted',
          contract: '#112 BE-48 (inloggen met tweede stap, wachtwoord vergeten)',
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

