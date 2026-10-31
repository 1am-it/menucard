'use strict';

// BE-59 deel 3 (#146) — de stub van de browsercheck, zonder browser getest.
//
// De stub gaat als broncode de pagina in; een typefout daarin zou pas bij een
// echte run opvallen. Deze test controleert de vorm: de standaard is een gast
// zonder sessie, de sleutel is de standaardsleutel van de Supabase-client, de
// instellingen komen ongewijzigd door en de broncode is geldige JavaScript. Er
// start niets: geen browser, geen server en geen netwerk.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AUTH_ORIGIN,
  STORAGE_KEY,
  BEHEERDER_ROLES,
  HOLDER_ROLES,
  HOLDER_RESTAURANT_NAME,
  OPEN_WORK_COUNTS,
  be59Settings,
  be59StubScript,
} = require('./be59-stub-page');

test('BE-59: de standaardstand is een gast zonder sessie en zonder rollen', () => {
  const settings = be59Settings();
  assert.equal(settings.session, false, 'zonder opgave géén sessiesleutel');
  assert.deepEqual(settings.roles, []);
  assert.deepEqual(settings.counts, {});
  assert.equal(settings.storageKey, STORAGE_KEY);
  assert.equal(settings.authOrigin, AUTH_ORIGIN);
});

test('BE-59: de sleutel is de standaardsleutel van de Supabase-client', () => {
  // NEXT_PUBLIC_SUPABASE_URL is in de check http://127.0.0.1:9; de client leidt
  // de opslagsleutel af van de hostnaam.
  assert.equal(STORAGE_KEY, 'sb-127-auth-token');
});

test('BE-59: een beheerder en een houder houden hun eigen rollen en tellingen', () => {
  const beheerder = be59Settings({
    session: true,
    roles: BEHEERDER_ROLES,
    counts: OPEN_WORK_COUNTS,
  });
  assert.equal(beheerder.session, true);
  assert.deepEqual(beheerder.roles, [{ role: 'internal' }, { role: 'editor' }]);
  assert.equal(
    Object.values(beheerder.counts).reduce((sum, value) => sum + value, 0),
    7,
    'zeven openstaande taken',
  );

  const houder = be59Settings({ session: true, roles: HOLDER_ROLES, counts: null });
  assert.deepEqual(houder.counts, {}, 'een ongeldige telling wordt geen nep-getal');
  assert.equal(houder.roles[0].restaurant_name, HOLDER_RESTAURANT_NAME);
  assert.equal(houder.roles[0].role, 'owner');
});

test('BE-59: het thema is altijd licht of donker', () => {
  assert.equal(be59Settings({ theme: 'dark' }).theme, 'dark');
  assert.equal(be59Settings({ theme: 'licht' }).theme, 'light');
});

test('BE-59: de stub is geldige, zelfstandige JavaScript-broncode', () => {
  const script = be59StubScript({ session: true, roles: BEHEERDER_ROLES, counts: OPEN_WORK_COUNTS });
  // Alleen compileren: de functie zelf draait niet (geen window, geen Response).
  assert.doesNotThrow(() => new Function('window', 'Response', script));
  assert.match(script, /sb-127-auth-token/);
  assert.match(script, /window\.__BE59__/);
  assert.match(script, /"session":true/);
});

test('BE-59: een gast krijgt de sessiesleutel juist niet', () => {
  const script = be59StubScript();
  assert.doesNotThrow(() => new Function('window', 'Response', script));
  assert.match(script, /"session":false/);
  assert.match(script, /removeItem/);
});
