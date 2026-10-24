'use strict';

// W6 of the Delivery Lead order for #59 / BE-21 (review 6380804419).
//
// The price model of the existing concept is used without flattening:
//   - a price the source itself names per unit ("glas 5,00 / karaf 18,50") is a
//     complete price and is stored as `priceVariants`, not as an open choice;
//   - an unnamed multiple price still asks for one choice;
//   - a missing price is an explicit "Prijs onbekend": the dish stays, with
//     `priceStatus` unknown and never 0.
//
// Fictional sources and answers only: no network, no database, no provider.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadMenuExtractionProtocol } = require('./menuExtractionProtocol');
const { buildImportBundle, sourceHashForText } = require('./manualMenuImportBundle');
const { buildImportReport } = require('./manualMenuImportImport');
const { decideRow, reviewView, buildConceptDraft } = require('./manualMenuImportReview');
const { mapStructuredOutputToMenuContexts } = require('./menuExtractionMapping');
const { buildMenuConcept, storedConceptInput, publicMenu } = require('./menuConcept');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL = loadMenuExtractionProtocol({ root: ROOT });

const SOURCE_TEXT = [
  'Wijnkaart',
  'Huiswijn glas 5,00 / karaf 18,50',
  'Bier 4,00 6,00',
  'Kraanwater',
  'Dagschotel op aanvraag',
].join('\n');

function bundle() {
  return buildImportBundle({
    bundleId: 'AI-2026-10-24-PRICE',
    actorUserId: 'user-1',
    restaurantId: '23',
    restaurantName: 'Restaurant Voorbeeld',
    fetchedAt: '2026-10-24T12:00:00.000Z',
    protocol: PROTOCOL,
    now: new Date('2026-10-24T12:00:00.000Z'),
    sources: [
      {
        id: 'source-1',
        url: 'https://voorbeeld.example/wijnkaart',
        kind: 'html',
        status: 'read',
        text: SOURCE_TEXT,
        sha256: sourceHashForText(SOURCE_TEXT),
      },
    ],
  });
}

const EVIDENCE = { sourceId: 'source-1', locator: 'Wijnkaart regel 1', quote: 'Huiswijn glas 5,00 / karaf 18,50' };

function answer() {
  return {
    menus: [
      {
        title: 'Wijnkaart',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Dranken',
            items: [
              {
                name: 'Huiswijn',
                priceStatus: 'multiple_undecomposed',
                priceVariants: [
                  { label: 'glas', amountMinorUnits: 500, currency: 'EUR' },
                  { label: 'karaf', amountMinorUnits: 1850, currency: 'EUR' },
                ],
                evidence: EVIDENCE,
              },
              {
                name: 'Bier',
                priceStatus: 'multiple_undecomposed',
                priceVariants: [
                  { label: null, amountMinorUnits: 400, currency: 'EUR' },
                  { label: null, amountMinorUnits: 600, currency: 'EUR' },
                ],
                evidence: { sourceId: 'source-1', locator: 'Wijnkaart regel 2', quote: 'Bier 4,00 6,00' },
              },
              {
                name: 'Kraanwater',
                priceStatus: 'unknown',
                evidence: { sourceId: 'source-1', locator: 'Wijnkaart regel 3', quote: 'Kraanwater' },
              },
              {
                name: 'Dagschotel',
                priceStatus: 'on_request',
                evidence: { sourceId: 'source-1', locator: 'Wijnkaart regel 4', quote: 'Dagschotel op aanvraag' },
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 4, unreadSources: [], limitations: [] },
  };
}

function report(overrides = {}) {
  return buildImportReport({
    importId: 'import-price',
    bundle: bundle(),
    output: answer(),
    aiName: 'Claude',
    now: new Date('2026-10-24T12:05:00.000Z'),
    ...overrides,
  });
}

function rowOf(built, name) {
  return built.rows.find((row) => row.name === name);
}

function decide(built, decisions, row, decision) {
  const result = decideRow({ report: built, decisions, decision: { rowId: row.id, ...decision } });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.decisions;
}

function storedItems(draft) {
  return draft.content.categories.flatMap((category) => category.items);
}

function resolveAll(built, decisions, options = {}) {
  let next = decisions;
  for (const row of built.rows) {
    if (row.state === 'valid' || row.namedPriceVariants || next.has(row.id)) continue;
    if (row.code === 'price_variant') next = decide(built, next, row, { action: 'choose_price', variantIndex: options.variantIndex || 0 });
    else next = decide(built, next, row, { action: 'price_unknown' });
  }
  return next;
}

test('W6: een benoemde prijslijst staat meteen in orde en vraagt geen prijskeuze', () => {
  const built = report();
  assert.equal(built.ok, true, JSON.stringify(built.problems || built.message));
  const wine = rowOf(built, 'Huiswijn');
  assert.equal(wine.state, 'valid');
  assert.equal(wine.code, null);
  assert.equal(wine.namedPriceVariants, true);
  assert.equal(wine.priceText, 'glas 5,00 / karaf 18,50');
  assert.equal(wine.priceStatus, 'multiple_undecomposed');
  const view = reviewView({ report: built, decisions: new Map() });
  assert.equal(view.rows.find((row) => row.id === wine.id).resolved, true);
});

test('W6: een benoemde prijslijst wordt als priceVariants in het concept bewaard', () => {
  const built = report();
  const decisions = resolveAll(built, new Map());
  const draft = buildConceptDraft({ report: built, decisions, restaurantId: '23' });
  assert.equal(draft.ok, true, JSON.stringify(draft.blockers || draft.message));
  const wine = storedItems(draft).find((entry) => entry.name === 'Huiswijn');
  assert.deepEqual(wine.priceVariants, [
    { label: 'glas', price: '5.00' },
    { label: 'karaf', price: '18.50' },
  ]);
  assert.equal(wine.priceStatus, 'multiple_undecomposed');
  assert.equal(wine.price, null);
  const publicWine = publicMenu(draft.content).categories[0].items.find((entry) => entry.name === 'Huiswijn');
  assert.deepEqual(publicWine, { name: 'Huiswijn', desc: null, price: null });
});

test('W6: een onbenoemde meervoudige prijs vraagt nog steeds een keuze', () => {
  const built = report();
  const beer = rowOf(built, 'Bier');
  assert.equal(beer.code, 'price_variant');
  assert.equal(beer.state, 'unsupported');
  assert.equal(beer.namedPriceVariants, false);
  assert.equal(beer.priceText, 'meerdere prijzen');
  const confirmed = decideRow({ report: built, decisions: new Map(), decision: { rowId: beer.id, action: 'confirm' } });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, 'price_choice_required');
});
test('W6: een ontbrekende prijs heet "Prijs onbekend" en wordt nooit nul euro', () => {
  const built = report();
  const water = rowOf(built, 'Kraanwater');
  assert.equal(water.state, 'review');
  assert.equal(water.label, 'prijs onbekend');
  assert.equal(water.priceText, 'prijs onbekend');
  const confirmed = decideRow({ report: built, decisions: new Map(), decision: { rowId: water.id, action: 'confirm' } });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, 'price_choice_required');
  const decisions = resolveAll(built, decide(built, new Map(), water, { action: 'price_unknown' }));
  const draft = buildConceptDraft({ report: built, decisions, restaurantId: '23' });
  assert.equal(draft.ok, true, JSON.stringify(draft.blockers || draft.message));
  const stored = storedItems(draft).find((entry) => entry.name === 'Kraanwater');
  assert.equal(stored.price, null);
  assert.equal(stored.priceStatus, 'unknown');
  assert.equal(stored.priceUnknownAccepted, true);
  assert.equal(JSON.stringify(stored).includes('0.00'), false);
});

test('W6: "Prijs onbekend" bestaat alleen voor een regel zonder prijs', () => {
  const built = report();
  const wine = rowOf(built, 'Huiswijn');
  const result = decideRow({ report: built, decisions: new Map(), decision: { rowId: wine.id, action: 'price_unknown' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'row_not_open');
  const beer = rowOf(built, 'Bier');
  const onBeer = decideRow({ report: built, decisions: new Map(), decision: { rowId: beer.id, action: 'price_unknown' } });
  assert.equal(onBeer.ok, false);
  // A row with two unnamed prices first asks which of the two it is.
  assert.equal(onBeer.code, 'price_choice_required');
});

test('W6: "op aanvraag" blijft op aanvraag en vraagt dezelfde expliciete keuze', () => {
  const built = report();
  const daily = rowOf(built, 'Dagschotel');
  assert.equal(daily.code, 'price_on_request');
  assert.equal(daily.state, 'review');
  assert.equal(daily.label, 'prijs op aanvraag');
  const decisions = resolveAll(built, new Map());
  const draft = buildConceptDraft({ report: built, decisions, restaurantId: '23' });
  assert.equal(draft.ok, true, JSON.stringify(draft.blockers || draft.message));
  const stored = storedItems(draft).find((entry) => entry.name === 'Dagschotel');
  assert.equal(stored.price, null);
  assert.equal(stored.priceStatus, 'on_request');
});

test('W6: een opgeslagen versie houdt zijn prijsmodel bij heraanbieding', () => {
  const captured = {
    title: 'Wijnkaart',
    categories: [
      {
        name: 'Dranken',
        items: [
          {
            name: 'Huiswijn',
            desc: null,
            price: null,
            priceStatus: 'multiple_undecomposed',
            priceVariants: [
              { label: 'glas', price: '5.00' },
              { label: 'karaf', price: '18.50' },
            ],
          },
          { name: 'Kraanwater', desc: null, price: null, priceStatus: 'unknown', priceUnknownAccepted: true },
        ],
      },
    ],
  };
  const input = storedConceptInput(captured);
  const rebuilt = buildMenuConcept({ menus: input.menus, liveLines: [], edits: input.edits });
  assert.deepEqual(rebuilt.blockers, []);
  assert.equal(rebuilt.canSave, true);
  const wine = rebuilt.content.categories[0].items.find((entry) => entry.name === 'Huiswijn');
  assert.deepEqual(wine.priceVariants, [
    { label: 'glas', price: '5.00' },
    { label: 'karaf', price: '18.50' },
  ]);
  const water = rebuilt.content.categories[0].items.find((entry) => entry.name === 'Kraanwater');
  assert.equal(water.price, null);
  assert.equal(water.priceStatus, 'unknown');
  assert.equal(water.priceUnknownAccepted, true);
});

test('W6: de mapping laat benoemde varianten niet verdwijnen', () => {
  const contexts = mapStructuredOutputToMenuContexts(answer(), [{ id: 'source-1', url: 'https://voorbeeld.example/wijnkaart' }]);
  const wine = contexts[0].categories[0].items[0];
  assert.equal(wine.price, null);
  assert.equal(wine.priceStatus, 'multiple_undecomposed');
  assert.deepEqual(wine.priceVariants, [
    { label: 'glas', price: '5.00' },
    { label: 'karaf', price: '18.50' },
  ]);
});

