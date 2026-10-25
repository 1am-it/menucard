'use strict';

// BE-29 (#70) — /restaurants stuurt permanent (308) door naar
// /alle-restaurants, met behoud van een bestaande zoekterm. De oude pagina
// bestaat niet meer; gedeelde componenten blijven.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const PAGE_PATH = path.join(__dirname, 'page.js');
const source = fs.readFileSync(PAGE_PATH, 'utf8');

test('BE-29: /restaurants doet een permanente doorverwijzing naar /alle-restaurants', () => {
  assert.match(source, /import \{ permanentRedirect \} from 'next\/navigation'/);
  assert.match(source, /permanentRedirect\(query \? `\/alle-restaurants\?q=\$\{encodeURIComponent\(query\)\}` : '\/alle-restaurants'\)/);
});

test('BE-29: een bestaande zoekterm q gaat mee, zonder hem te verzinnen', () => {
  assert.match(source, /const params = await searchParams/);
  assert.match(source, /const raw = params \? params\.q : null/);
  assert.match(source, /const query = typeof value === 'string' \? value\.trim\(\) : ''/);
});

test('BE-29: de oude /restaurants-pagina en zijn eigen code zijn weg', () => {
  assert.doesNotMatch(source, /^'use client'/m);
  assert.doesNotMatch(source, /restaurantsData|menusData|CUISINE_KEYWORDS|EU14|SORT_OPTIONS/);
  assert.ok(source.split(/\r?\n/).length < 30, 'alleen de kleine doorverwijzing blijft over');
});
