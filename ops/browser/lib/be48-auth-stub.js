'use strict';

// BE-48 (#112) — the settings and the injected script of the internal sign-in
// browser check.
//
// The browser code itself lives in be48-stub-page.js: one self-contained
// function that is serialised into the page through
// Function.prototype.toString(). This module only decides what that function
// sees and how it is injected.

const { installBe48AuthStub } = require('./be48-stub-page');

// The fake origin the app's Supabase client is configured with (runtime.js
// starts the server with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9). Every
// request to it is answered in the page; nothing can leave the browser.
const FIXTURE_AUTH_ORIGIN = 'http://127.0.0.1:9';

const DEFAULT_SETTINGS = {
  authOrigin: FIXTURE_AUTH_ORIGIN,
  email: 'medewerker@example.invalid',
  password: 'goed-wachtwoord',
  totpCode: '123456',
  // BE-48: the code the claim's e-mail contains. Deliberately different from
  // `totpCode`, so a claim code can never pass for an authenticator code.
  emailCode: '654321',
  factorId: 'factor-fixture',
  roles: [{ role: 'internal', restaurant_id: null }],
  theme: 'dark',
  factors: [],
  counts: { 'menu-concepts': 2, 'source-triage': 1, 'import-inbox': 0 },
  // BE-47 (#111): the fictional claims behind `GET /api/claims/mine`, and the
  // code the fictional e-mail for "Account verwijderen" contains (defaults to
  // `emailCode`). Both are plain data: the stub never reaches a real project.
  claims: [],
  deleteCode: null,
  // BE-57 (#139): fictional answers per app path, for example
  // `{ '/api/mijn-restaurant/1/cijfers': { status: 200, body: {...} } }`. A path
  // that is not in the map keeps its normal fixture behaviour.
  ownerStats: {},
};

/**
 * The settings the stub runs with, merged over the defaults:
 * - `email` / `password` — the one fictional account that can sign in;
 * - `totpCode` — the one fictional code the authenticator app shows;
 * - `emailCode` — the one fictional code an e-mail contains (claim, resend);
 * - `roles` — the fictional `staff_roles` rows (`[{ role: 'internal' }]`);
 * - `factors` — factors the account already has (empty = link an app first);
 * - `theme` — `'light'` or `'dark'`.
 */
function be48Settings(options = {}) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) settings[key] = options[key];
  }
  settings.authOrigin = settings.authOrigin || FIXTURE_AUTH_ORIGIN;
  settings.theme = settings.theme === 'light' ? 'light' : 'dark';
  if (!Array.isArray(settings.roles)) settings.roles = [];
  if (!Array.isArray(settings.factors)) settings.factors = [];
  if (!Array.isArray(settings.claims)) settings.claims = [];
  if (typeof settings.emailCode !== 'string' || !settings.emailCode) settings.emailCode = DEFAULT_SETTINGS.emailCode;
  return settings;
}

/** The script for `Page.addScriptToEvaluateOnNewDocument`. */
function authStubScript(options = {}) {
  return `(${installBe48AuthStub.toString()})(${JSON.stringify(be48Settings(options))})`;
}

module.exports = { FIXTURE_AUTH_ORIGIN, DEFAULT_SETTINGS, be48Settings, authStubScript };
