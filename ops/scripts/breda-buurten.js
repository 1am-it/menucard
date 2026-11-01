'use strict';

// BE-79 golf 1 (#195) — buurt bepalen uit een adres.
//
// De OSM-kandidatenlijst bevat geen addr:suburb, dus een nieuw restaurant krijgt
// zijn buurt uit postcode en straat (ops/data/breda-buurten.json). De straat gaat
// voor de postcode: een postcodegebied als 4811 valt voor een paar straten in een
// andere buurt (Valkenberg, Station), zoals de bestaande data laat zien.

const fs = require('node:fs');
const path = require('node:path');

const TABLE_PATH = path.join(__dirname, '..', 'data', 'breda-buurten.json');

function loadTable() {
  return JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));
}

function postcodeArea(address) {
  const match = /(\d{4})\s?[A-Z]{2}/.exec(String(address || ''));
  return match ? match[1] : null;
}

function streetOf(address) {
  const match = /^(.*?)\s+\d/.exec(String(address || '').trim());
  return match ? match[1].trim() : null;
}

function buurtVoorAdres(address, table = loadTable()) {
  const area = postcodeArea(address);
  const street = streetOf(address);
  if (street && table.straten && table.straten[street]) return table.straten[street];
  if (area && table.buurten && table.buurten[area]) return table.buurten[area];
  return null;
}

module.exports = { buurtVoorAdres, loadTable, postcodeArea, streetOf };
