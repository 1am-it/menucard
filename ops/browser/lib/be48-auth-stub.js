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
  factorId: 'factor-fixture',
  roles: [{ role: 'internal', restaurant_id: null }],
  theme: 'dark',
  factors: [],
  counts: { 'menu-concepts': 2, 'source-triage': 1, 'import-inbox': 0 },
};

/**
 * The settings the stub runs with, merged over the defaults:
 * - `email` / `password` — the one fictional account that can sign in;
 * - `totpCode` — the one fictional code the authenticator app shows;
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
  return settings;
}

/** The script for `Page.addScriptToEvaluateOnNewDocument`. */
function authStubScript(options = {}) {
  return `(${installBe48AuthStub.toString()})(${JSON.stringify(be48Settings(options))})`;
}

module.exports = { FIXTURE_AUTH_ORIGIN, DEFAULT_SETTINGS, be48Settings, authStubScript };
