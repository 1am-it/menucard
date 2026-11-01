'use strict';

// BE-79 golf 1 (#195) — de postcode -> buurt-tabel.
//
// De OSM-kandidatenlijst bevat geen addr:suburb, dus de buurt van een nieuw
// restaurant komt uit de postcode. Die tabel staat in ops/data/breda-buurten.json
// met een bron erbij. Deze test bewaakt de vorm van de tabel en controleert hem
// tegen de bestaande data: een postcodegebied dat al in de vaste kopie van de
// restaurants voorkomt, moet dezelfde buurt opleveren.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buurtVoorAdres, loadTable, postcodeArea } = require('../scripts/breda-buurten');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FROZEN_RESTAURANTS = path.join(REPO_ROOT, 'src', 'test-fixtures', 'frozen-data', 'restaurants.json');

const PLACEHOLDER = /onbekend|unknown|n\/a|tbd/i;

test('de buurtentabel heeft een bron, een controledatum en geldige waarden', () => {
  const table = loadTable();
  assert.ok(String(table.source || '').trim(), 'de tabel heeft geen bron');
  assert.match(String(table.checked), /^\d{4}-\d{2}-\d{2}$/, 'de tabel heeft geen controledatum');

  const areas = Object.keys(table.buurten || {});
  assert.ok(areas.length, 'de tabel heeft geen postcodegebieden');
  for (const area of areas) {
    assert.match(area, /^\d{4}$/, `postcodegebied "${area}" is geen vier cijfers`);
    assertBuurt(table.buurten[area], `postcodegebied ${area}`);
  }

  for (const [street, buurt] of Object.entries(table.straten || {})) {
    assert.ok(street.trim(), 'de tabel heeft een lege straatnaam');
    assertBuurt(buurt, `straat ${street}`);
  }
});

function assertBuurt(buurt, where) {
  assert.equal(typeof buurt, 'string', `${where} heeft geen buurtnaam`);
  assert.ok(buurt.trim(), `${where} heeft een lege buurtnaam`);
  assert.doesNotMatch(buurt, PLACEHOLDER, `${where} heeft een plaatsvervangende buurt ("${buurt}")`);
}

test('elk bestaand restaurant in een bekend postcodegebied krijgt zijn eigen buurt terug', () => {
  const table = loadTable();
  const restaurants = JSON.parse(fs.readFileSync(FROZEN_RESTAURANTS, 'utf8'));
  let checked = 0;

  for (const restaurant of Object.values(restaurants)) {
    const area = postcodeArea(restaurant.address);
    if (!area || !table.buurten[area]) continue;
    checked += 1;
    assert.equal(
      buurtVoorAdres(restaurant.address, table),
      restaurant.buurt,
      `adres "${restaurant.address}" (${restaurant.name}) hoort volgens de tabel bij een andere buurt dan "${restaurant.buurt}"`
    );
  }

  assert.ok(checked >= 10, `maar ${checked} restaurants uit de vaste kopie vallen in een postcodegebied van de tabel`);
});

test('een straat gaat voor het postcodegebied', () => {
  const table = loadTable();
  assert.equal(buurtVoorAdres('Grote Markt 26-28, 4811 XR Breda', table), 'Binnenstad');
  assert.equal(buurtVoorAdres('John F. Kennedylaan 15, 4811 ET Breda', table), 'Valkenberg');
  assert.equal(buurtVoorAdres('Willemstraat 29, 4811 AJ Breda', table), 'Station');
  assert.equal(buurtVoorAdres('Onbekende Straat 1, 9999 ZZ Ergens', table), null);
});
