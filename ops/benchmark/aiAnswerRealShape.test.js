'use strict';

// BB1 (Delivery Lead review 6384867373, #59 / BE-21): the regression fixture is
// an answer in the exact shape the app saved from a real reading. This test
// proves the fixture itself is honest: it passes the unchanged validator, it
// carries the required `allergens` object on every item, and the review marks
// only the rows with a real allergen or availability statement as unsupported.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadMenuExtractionProtocol } = require('../../src/lib/menuExtractionProtocol');
const { validateStructuredOutput } = require('../../src/lib/menuExtractionSchema');
const { buildImportBundle, sourceHashForText } = require('../../src/lib/manualMenuImportBundle');
const { buildImportReport } = require('../../src/lib/manualMenuImportImport');
const { SOURCE_ID, SOURCE_TEXT, realShapeAnswer } = require('./aiAnswerRealShape');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL = loadMenuExtractionProtocol({ root: ROOT });

function bundle() {
  return buildImportBundle({
    bundleId: 'BB1-REAL-SHAPE',
    actorUserId: 'user-1',
    restaurantId: '23',
    restaurantName: 'Fictief Brasserie',
    fetchedAt: '2026-10-24T12:00:00.000Z',
    protocol: PROTOCOL,
    now: new Date('2026-10-24T12:00:00.000Z'),
    sources: [
      {
        id: SOURCE_ID,
        url: 'https://fictief-brasserie.invalid/menu',
        kind: 'html',
        status: 'read',
        text: SOURCE_TEXT,
        sha256: sourceHashForText(SOURCE_TEXT),
      },
    ],
  });
}

function report() {
  return buildImportReport({
    importId: 'bb1-real-shape',
    bundle: bundle(),
    output: realShapeAnswer(),
    aiName: 'Claude (Haiku 5.5)',
    now: new Date('2026-10-24T12:05:00.000Z'),
  });
}

test('BB1: het fixture-antwoord heeft de vorm van een echt opgeslagen antwoord', () => {
  const answer = realShapeAnswer();
  const items = answer.menus.flatMap((menu) => menu.categories.flatMap((category) => category.items));
  assert.equal(items.length, 6);
  for (const item of items) {
    assert.equal(typeof item.isFrom, 'boolean', `${item.name} draagt isFrom`);
    assert.ok(item.allergens && typeof item.allergens === 'object', `${item.name} draagt het verplichte allergens-object`);
    assert.ok(['explicit', 'unknown'].includes(item.allergens.status), `${item.name} heeft een geldige allergenstatus`);
    assert.ok(Array.isArray(item.allergens.values), `${item.name} heeft een waardenlijst`);
    assert.deepEqual(Object.keys(item.evidence).sort(), ['locator', 'quote', 'sourceId']);
  }
  // Het echte antwoord draagt "unknown" met een lege lijst; dat is geen opgave.
  const olives = items.find((item) => item.name === 'Fictieve olijven');
  assert.deepEqual(olives.allergens, { status: 'unknown', values: [] });
});

test('BB1: het fixture-antwoord passeert de ongewijzigde validator', () => {
  const problems = validateStructuredOutput(realShapeAnswer(), [
    { id: SOURCE_ID, url: 'https://fictief-brasserie.invalid/menu', kind: 'html', status: 'read', sha256: sourceHashForText(SOURCE_TEXT), text: SOURCE_TEXT },
  ]);
  assert.deepEqual(problems, []);
});

test('BB1: een onbekende allergenenlijst, een ontbrekende beschikbaarheid en isFrom false geven "in orde"', () => {
  const result = report();
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const byName = new Map(result.rows.map((row) => [row.name, row]));
  for (const name of ['Fictieve olijven', 'Fictief brood', 'Fictief bittergarnituur']) {
    const row = byName.get(name);
    assert.equal(row.state, 'valid', `${name}: ${row.code}`);
    assert.deepEqual(row.relations, [], `${name} heeft geen relatie`);
    assert.equal(row.askAi, false);
  }
  // Een bron die elke prijs zelf benoemt blijft ook in orde.
  const wine = byName.get('Fictieve huiswijn');
  assert.equal(wine.state, 'valid', `wijn: ${wine.code}`);
  assert.equal(wine.namedPriceVariants, true);
  assert.equal(result.summary.valid, 4);
  assert.equal(result.summary.unsupported, 2);
});

test('BB1: echte allergenen en echte beschikbaarheid houden de bestaande regel', () => {
  const result = report();
  const byName = new Map(result.rows.map((row) => [row.name, row]));
  const cake = byName.get('Fictieve appeltaart');
  assert.equal(cake.state, 'unsupported');
  assert.equal(cake.code, 'allergens');
  assert.deepEqual(cake.relations, ['allergens']);
  const oysters = byName.get('Fictieve oesters');
  assert.equal(oysters.state, 'unsupported');
  assert.equal(oysters.code, 'availability');
  assert.deepEqual(oysters.relations, ['availability']);
});

test('BB1: een lege of onbekende standaardwaarde is nooit een relatie', () => {
  const { hasStatedAllergens, hasStatedText } = require('../../src/lib/manualMenuImportImport');
  // De vorm uit het echte antwoord.
  assert.equal(hasStatedAllergens({ status: 'unknown', values: [] }), false);
  // Lege en witruimte-varianten van dezelfde standaardwaarde.
  assert.equal(hasStatedAllergens({ status: 'unknown', values: ['', '  '] }), false);
  assert.equal(hasStatedAllergens({ status: 'explicit', values: [] }), true);
  assert.equal(hasStatedAllergens({ values: ['gluten'] }), true);
  assert.equal(hasStatedAllergens(null), false);
  assert.equal(hasStatedAllergens(''), false);
  assert.equal(hasStatedAllergens('  '), false);
  assert.equal(hasStatedAllergens('gluten'), true);
  assert.equal(hasStatedText(undefined), false);
  assert.equal(hasStatedText(null), false);
  assert.equal(hasStatedText(''), false);
  assert.equal(hasStatedText('   '), false);
  assert.equal(hasStatedText('alleen in het weekend'), true);
});
