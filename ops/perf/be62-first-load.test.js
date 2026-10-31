'use strict';

// BE-62 (#153, reviewstap 4) — de eerste lading van de drie publieke routes
// blijft binnen +1 KB van origin/main. De getallen komen uit
// ops/perf/evidence/be62-first-load.json, gemeten met dezelfde helper als de
// budgettest (ops/perf/lib/first-load-js.js). Deze test bewaakt de grens en de
// rekenkunde, zodat een nieuwe meting niet stilzwijgend ruimer wordt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence', 'be62-first-load.json'), 'utf8'));

test('BE-62: de meting noemt de drie routes uit de review, met basis en nu', () => {
  assert.equal(EVIDENCE.be, 'BE-62 (#153)');
  assert.equal(EVIDENCE.limitBytes, 1024);
  assert.deepEqual(EVIDENCE.routes.map((row) => row.label), ['/', '/menu/[id]', '/kies/[code]']);
  for (const row of EVIDENCE.routes) {
    assert.ok(row.baseGzipBytes > 0, `${row.label}: geen basisgetal`);
    assert.ok(row.headGzipBytes > 0, `${row.label}: geen nieuw getal`);
    assert.equal(row.deltaBytes, row.headGzipBytes - row.baseGzipBytes, `${row.label}: delta klopt niet`);
  }
});

test('BE-62: geen enkele route groeit meer dan 1 KB', () => {
  for (const row of EVIDENCE.routes) {
    assert.ok(
      row.deltaBytes <= EVIDENCE.limitBytes,
      `${row.label}: +${row.deltaBytes} bytes is meer dan ${EVIDENCE.limitBytes}`,
    );
    assert.equal(row.withinLimit, true, `${row.label}: withinLimit hoort true te zijn`);
  }
});
