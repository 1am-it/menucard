'use strict';

// BE-62 (#153, review ronde 2) — de eerste laadgrootte van de vier routes uit
// de review blijft binnen +1 KB van origin/main. De getallen komen uit
// ops/browser/evidence/be62-build-size-evidence.json, gemeten met
// ops/browser/run-be62-build-size-check.js (git archive + junction, geen
// worktree). Deze test bewaakt de routes, de rekenkunde en de grens, zodat een
// nieuwe meting niet stilzwijgend ruimer wordt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence', 'be62-build-size-evidence.json'), 'utf8'));

test('BE-62: de meting noemt de vier routes uit de review, met basis en nu', () => {
  assert.equal(EVIDENCE.ticket, 'BE-62 (#153), review ronde 2');
  assert.equal(EVIDENCE.limitBytes, 1024);
  assert.equal(EVIDENCE.baseRef, 'origin/main');
  assert.deepEqual(EVIDENCE.routes.map((row) => row.route), ['/', '/menu/[id]', '/r/[id]', '/kies/[code]']);
  for (const row of EVIDENCE.routes) {
    assert.ok(row.baseGzipBytes > 0, `${row.route}: geen basisgetal`);
    assert.ok(row.headGzipBytes > 0, `${row.route}: geen nieuw getal`);
    assert.equal(row.deltaBytes, row.headGzipBytes - row.baseGzipBytes, `${row.route}: delta klopt niet`);
  }
});

test('BE-62: geen enkele route groeit meer dan 1 KB', () => {
  for (const row of EVIDENCE.routes) {
    assert.ok(
      row.deltaBytes <= EVIDENCE.limitBytes,
      `${row.route}: +${row.deltaBytes} bytes is meer dan ${EVIDENCE.limitBytes}`,
    );
    assert.equal(row.withinLimit, true, `${row.route}: withinLimit hoort true te zijn`);
  }
  assert.equal(EVIDENCE.passed, true);
});

test('BE-62: de basisstand is zonder worktree gemeten', () => {
  assert.match(EVIDENCE.method, /git archive/);
  assert.match(EVIDENCE.method, /junction/);
  assert.doesNotMatch(EVIDENCE.method, /worktree',|git worktree/);
});

test('BE-62: de drie routes van ronde 1 staan met dezelfde getallen in het perf-bewijs', () => {
  const perf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'perf', 'evidence', 'be62-first-load.json'), 'utf8'));
  assert.deepEqual(perf.routes.map((row) => row.label), ['/', '/menu/[id]', '/kies/[code]']);
  for (const row of perf.routes) {
    const gelijk = EVIDENCE.routes.find((entry) => entry.route === row.label);
    assert.ok(gelijk, `${row.label}: ontbreekt in het nieuwe bewijs`);
    assert.equal(row.headGzipBytes, gelijk.headGzipBytes, `${row.label}: nieuw getal wijkt af`);
    assert.equal(row.deltaBytes, gelijk.deltaBytes, `${row.label}: delta wijkt af`);
  }
});
