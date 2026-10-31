'use strict';

// BE-66 (#162) — de dynamische helft van de houder-inlog, echt uitgevoerd.
//
// Geen netwerk en geen Supabase-project: de client wordt met een fixture-URL
// aangemaakt (zoals de browserchecks dat ook doen) en de twee aanroepen stoppen
// bij de bestaande validatie van de flow, vóór er iets verstuurd wordt. Zo is
// bewezen dat de dynamische laag dezelfde, onveranderde BE-48-flow aanroept en
// niet een tweede kopie.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const FIXTURE_URL = 'http://127.0.0.1:9';
const FIXTURE_KEY = 'fixture-anon-key-not-a-secret';

process.env.NEXT_PUBLIC_SUPABASE_URL = FIXTURE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FIXTURE_KEY;

const { confirmOwnerSignInCode, loadFlow, sendOwnerSignInCode } = require('./ownerLoginClient');

// Deze test staat eerst: zodra de client één keer is aangemaakt, bewaart
// src/lib/supabaseBrowser.js hem (zoals in de browser). Zonder configuratie moet
// de laag dezelfde fout geven als voor BE-66, zodat het formulier zijn eerlijke
// "niet geconfigureerd"-melding kan tonen.
test('zonder configuratie geeft dezelfde laag de fout die het formulier vertaalt', async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    await assert.rejects(
      sendOwnerSignInCode({ channel: 'email', email: 'houder@example.invalid' }),
      /not configured/,
    );
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FIXTURE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FIXTURE_KEY;
  }
});

test('loadFlow laadt de bestaande flow en de bestaande client', async () => {
  const flow = await loadFlow();
  assert.equal(typeof flow.requestOwnerSignInCode, 'function');
  assert.equal(typeof flow.verifyOwnerSignInCode, 'function');
  assert.equal(typeof flow.getSupabaseBrowser, 'function');
  const supabase = flow.getSupabaseBrowser();
  assert.equal(typeof supabase.auth.signInWithOtp, 'function');
  assert.equal(typeof supabase.auth.verifyOtp, 'function');
});

test('de verzendstap weigert een leeg e-mailadres, zonder netwerk', async () => {
  const result = await sendOwnerSignInCode({ channel: 'email', email: '' });
  assert.equal(result.ok, false);
  assert.match(result.message, /e-mailadres/i);
});

test('de codestap weigert een onvolledige code, zonder netwerk', async () => {
  const result = await confirmOwnerSignInCode({ channel: 'email', email: 'houder@example.invalid', code: '12' });
  assert.equal(result.ok, false);
  assert.ok(typeof result.message === 'string' && result.message.length > 0);
});
