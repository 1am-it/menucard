'use strict';

// #62 — the route choice of the one entry "Restaurant of menu toevoegen"
// (contract criterion 4). Pure: no network, no writes, no new validation rules —
// it reuses the existing batch precheck so the entry can never accept what the
// batch page itself would refuse.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  ONBOARDING_HREF,
  BATCH_HREF,
  MANUAL_IMPORT_HREF,
  MESSAGES,
  MAX_BATCH_URLS,
  manualImportHref,
  decideAddEntry,
} = require('./internalAddEntry');
const { MAX_BATCH_URLS: BATCH_MAX } = require('./batchAnalysis');

const KNOWN = { id: '9001', name: 'Fictief Brasserie Noord' };
const URL_ONE = 'https://fictief-brasserie.invalid/menu';
const URL_TWO = 'https://fictief-brasserie.invalid/diner';

test('decideAddEntry: a known restaurant with one URL goes to the existing analysis', () => {
  const result = decideAddEntry({ restaurant: KNOWN, urls: URL_ONE });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'batch');
  assert.deepEqual(result.urls, [URL_ONE]);
  assert.match(result.href, /^\/internal\/bronnen\/batch\?urls=/);
});

test('decideAddEntry: a new restaurant (no choice) with one URL opens the existing onboarding with that URL filled in', () => {
  for (const restaurant of [null, undefined, { id: '', name: '' }]) {
    const result = decideAddEntry({ restaurant, urls: URL_ONE });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'onboarding');
    const parsed = new URL(result.href, 'http://localhost');
    assert.equal(parsed.pathname, ONBOARDING_HREF);
    assert.equal(parsed.searchParams.get('url'), URL_ONE);
  }
});

test('decideAddEntry: several URLs always take the existing batch route, known restaurant or not', () => {
  for (const restaurant of [KNOWN, null]) {
    const result = decideAddEntry({ restaurant, urls: `${URL_ONE}\n${URL_TWO}` });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'batch');
    assert.deepEqual(result.urls, [URL_ONE, URL_TWO]);
    const parsed = new URL(result.href, 'http://localhost');
    assert.equal(parsed.pathname, BATCH_HREF);
    assert.equal(parsed.searchParams.get('urls'), `${URL_ONE}\n${URL_TWO}`);
  }
});

test('decideAddEntry: an empty form is refused with the concrete empty message', () => {
  for (const urls of ['', '   ', '\n\n', null, undefined]) {
    const result = decideAddEntry({ restaurant: KNOWN, urls });
    assert.equal(result.ok, false);
    assert.equal(result.error, MESSAGES.empty);
  }
});

test('decideAddEntry: more URLs than the existing maximum is refused, never silently cut', () => {
  const urls = Array.from({ length: MAX_BATCH_URLS + 1 }, (_, index) => `https://fictief-${index}.invalid/menu`);
  const result = decideAddEntry({ restaurant: KNOWN, urls: urls.join('\n') });
  assert.equal(result.ok, false);
  assert.equal(result.error, MESSAGES.tooMany);
  assert.equal(MAX_BATCH_URLS, BATCH_MAX, 'the entry reuses the batch page\'s own maximum');
});

test('decideAddEntry: an invalid URL line is refused with the existing validation, never dropped in silence', () => {
  const result = decideAddEntry({ restaurant: KNOWN, urls: `${URL_ONE}\ngeen-url` });
  assert.equal(result.ok, false);
  assert.equal(result.error, MESSAGES.invalid);
});

test('decideAddEntry: a duplicate line counts once, so one unique URL stays the onboarding route for a new restaurant', () => {
  const result = decideAddEntry({ restaurant: null, urls: `${URL_ONE}\n${URL_ONE}` });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'onboarding');
  assert.deepEqual(result.urls, [URL_ONE]);
});

test('decideAddEntry: never starts anything itself and never fetches', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'internalAddEntry.js'), 'utf8');
  assert.doesNotMatch(source, /fetch\(|https?:\/\/[^\s']*\.(com|nl|be)/);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test('manualImportHref: "Liever zelf invoeren of plakken" points at the existing manual import, scoped when a restaurant is chosen', () => {
  assert.equal(manualImportHref(null), MANUAL_IMPORT_HREF);
  assert.equal(manualImportHref({ id: '' }), MANUAL_IMPORT_HREF);
  const parsed = new URL(manualImportHref(KNOWN), 'http://localhost');
  assert.equal(parsed.pathname, '/internal/menu-import');
  assert.equal(parsed.searchParams.get('restaurant'), KNOWN.id);
  assert.equal(parsed.searchParams.get('name'), KNOWN.name);
});
