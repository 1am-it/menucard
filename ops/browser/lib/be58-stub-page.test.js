'use strict';

// BE-58 deel 4 (#143) — regressie op de gestubde sessie en API van de
// browsercheck. Geen browser en geen netwerk: dit bewaakt dat de fixture de
// schermen blijft voeden zoals de check verwacht (twee wijzigingen in controle,
// één grote wijziging, de standaardsleutel van de Supabase-sessie) en dat de
// stub-bron in de pagina te injecteren blijft.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  AUTH_ORIGIN,
  STORAGE_KEY,
  RESTAURANT_ID,
  MENU_ID,
  GERECHTEN,
  WIJZIGINGEN,
  be58Settings,
  be58StubScript,
} = require('./be58-stub-page');

test('BE-58: de stub gebruikt de standaard sleutel van de Supabase-client', () => {
  // De server start met NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9, dus de
  // client leest `sb-127-auth-token`; een andere sleutel betekent een lege sessie.
  assert.equal(AUTH_ORIGIN, 'http://127.0.0.1:9');
  assert.equal(STORAGE_KEY, 'sb-127-auth-token');
});

test('BE-58: de fictieve kaart heeft drie gerechten en twee wijzigingen in controle', () => {
  assert.equal(RESTAURANT_ID, '1');
  assert.equal(MENU_ID, '1-lunch');
  assert.equal(GERECHTEN.length, 3);
  assert.ok(GERECHTEN.every((rij) => rij.prijsCent >= 50 && rij.prijsCent <= 15000));
  assert.equal(WIJZIGINGEN.length, 2);
  assert.ok(WIJZIGINGEN.every((rij) => rij.status === 'in_controle' && rij.restaurantId === RESTAURANT_ID));
});

test('BE-58: precies één fictieve wijziging is een grote wijziging', () => {
  const groot = WIJZIGINGEN.filter((rij) => rij.groteWijziging);
  assert.equal(groot.length, 1);
  const rij = groot[0];
  const verschil = Math.abs(rij.prijsCent - rij.oudePrijsCent) / rij.oudePrijsCent;
  assert.ok(verschil > 0.5, `verwacht meer dan 50% verschil, kreeg ${verschil}`);
});

test('BE-58: de instellingen zijn per scenario te wisselen', () => {
  assert.deepEqual(be58Settings().roles, [{ role: 'owner', restaurant_id: RESTAURANT_ID }]);
  assert.deepEqual(be58Settings({ roles: [{ role: 'internal', restaurant_id: null }] }).roles, [
    { role: 'internal', restaurant_id: null },
  ]);
  assert.equal(be58Settings({ theme: 'light' }).theme, 'light');
  assert.equal(be58Settings({ theme: 'iets-anders' }).theme, 'dark');
  assert.deepEqual(be58Settings({ roles: 'geen-lijst' }).roles, []);
});

test('BE-58: de stub-bron is één zelfstandige functie met alle routes', () => {
  const script = be58StubScript({ roles: [{ role: 'internal', restaurant_id: null }] });
  assert.match(script, /^\(function installBe58Stub\(settings\) \{/);
  assert.match(script, /"role":"internal"/);
  // De bron moet in de pagina te evalueren zijn: geen require, geen import.
  assert.doesNotMatch(script, /\brequire\(/);
  assert.doesNotThrow(() => new Function(`return (${script.slice(1, -1)})`));
  for (const pad of [
    "'/api/internal/v1/me'",
    "'/api/internal/v1/workqueue-counts'",
    "'/api/v1/menukaart/gerechten'",
    "'/api/v1/menukaart/wijzigingen'",
    "'/api/v1/menukaart/bevestigen'",
    "'/api/internal/v1/menukaart-wijzigingen'",
  ]) {
    assert.ok(script.includes(pad), `de stub mist ${pad}`);
  }
  assert.match(script, /goedkeuren\|afwijzen/);
  assert.match(script, /fixture_network_blocked/);
});

test('BE-58: de check zelf gebruikt de stub, de scenariofilter en de a11y-audit', () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'run-be58-browser-check.js'), 'utf8');
  assert.match(bron, /be58StubScript/);
  assert.match(bron, /\.theme-switch button/);
  assert.match(bron, /audit\.checksFromAudit/);
  assert.match(bron, /const WIDTHS = \[/);
  for (const breedte of ["name: '1280'", "name: '390'", "name: '320'"]) {
    assert.ok(bron.includes(breedte), `de check meet niet op ${breedte}`);
  }
});
