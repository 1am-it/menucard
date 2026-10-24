'use strict';

// BB1/BB4 of the Delivery Lead review 6384867373 (#59 / BE-21): a fixture in the
// exact shape the app itself saved from a live reading. The live answers live in
// the gitignored `ops/benchmark/output/ai-probe-raw/`; this file is a copy with
// fictional names, prices and quotes, so a regression can never again be written
// against a hand-made minimal object:
//
//   "Gemarineerde olijven": {
//     "name": "...", "description": "", "priceStatus": "known",
//     "amountMinorUnits": 450, "currency": "EUR", "priceText": "4.5",
//     "isFrom": false,
//     "allergens": { "status": "unknown", "values": [] },
//     "evidence": { "sourceId": "blossem-01.BRON", "locator": "...", "quote": "..." }
//   }
//
// The required `allergens` object (M1) was exactly what made every real reading
// fail the review: an unknown list with zero values is not a statement about
// allergens, so it must not turn a dish into "niet op te slaan".
//
// Every quote below is a literal passage of `SOURCE_TEXT`, so the fixture passes
// the unchanged validator; `aiAnswerRealShape.test.js` proves that.

const SOURCE_ID = 'fictief-01.BRON';

const SOURCE_TEXT = [
  'FICTIEF BRASSERIE',
  'BITES   Fictieve olijven  4.5   Fictief brood  3.0   Fictief bittergarnituur  9.0   Fictieve soep  6.5',
  'WIJN   Fictieve huiswijn (glas)  4.0   Fictieve huiswijn (fles)  24.0',
  'ALLERGENEN   Fictieve appeltaart  5.5   (bevat gluten, ei)',
  'SEIZOEN   Fictieve oesters  3.5   alleen in de maanden met een R',
].join('\n');

function evidence(locator, quote) {
  return { sourceId: SOURCE_ID, locator, quote };
}

/** One item in the exact stored shape, with every optional field of a real answer. */
function answer() {
  return {
    menus: [
      {
        title: 'Fictieve kaart',
        sourceId: SOURCE_ID,
        categories: [
          {
            name: 'BITES',
            items: [
              {
                name: 'Fictieve olijven',
                description: '',
                priceStatus: 'known',
                amountMinorUnits: 450,
                currency: 'EUR',
                priceText: '4.5',
                isFrom: false,
                allergens: { status: 'unknown', values: [] },
                evidence: evidence('BITES sectie', 'Fictieve olijven  4.5'),
              },
              {
                name: 'Fictief brood',
                description: '',
                priceStatus: 'known',
                amountMinorUnits: 300,
                currency: 'EUR',
                priceText: '3.0',
                isFrom: false,
                allergens: { status: 'unknown', values: [] },
                evidence: evidence('BITES sectie', 'Fictief brood  3.0'),
              },
              {
                name: 'Fictief bittergarnituur',
                description: '',
                priceStatus: 'known',
                amountMinorUnits: 900,
                currency: 'EUR',
                priceText: '9.0',
                isFrom: false,
                allergens: { status: 'unknown', values: [] },
                evidence: evidence('BITES sectie', 'Fictief bittergarnituur  9.0'),
              },
              {
                // A source that DOES print the allergens: the existing
                // "niet op te slaan" rule keeps applying to this row.
                name: 'Fictieve appeltaart',
                description: '',
                priceStatus: 'known',
                amountMinorUnits: 550,
                currency: 'EUR',
                priceText: '5.5',
                isFrom: false,
                allergens: { status: 'explicit', values: ['gluten', 'ei'] },
                evidence: evidence('ALLERGENEN', 'Fictieve appeltaart  5.5   (bevat gluten, ei)'),
              },
              {
                // A stated availability is a real relation too.
                name: 'Fictieve oesters',
                description: '',
                priceStatus: 'known',
                amountMinorUnits: 350,
                currency: 'EUR',
                priceText: '3.5',
                isFrom: false,
                allergens: { status: 'unknown', values: [] },
                availability: 'alleen in de maanden met een R',
                evidence: evidence('SEIZOEN', 'Fictieve oesters  3.5'),
              },
            ],
          },
          {
            name: 'WIJN',
            items: [
              {
                // Named price list: the source names every price itself.
                name: 'Fictieve huiswijn',
                description: '',
                priceStatus: 'multiple_undecomposed',
                priceVariants: [
                  { label: 'glas', amountMinorUnits: 400, currency: 'EUR' },
                  { label: 'fles', amountMinorUnits: 2400, currency: 'EUR' },
                ],
                isFrom: false,
                allergens: { status: 'unknown', values: [] },
                evidence: evidence('WIJN sectie', 'Fictieve huiswijn (glas)  4.0'),
              },
            ],
          },
        ],
      },
    ],
    rejected: [],
    coverage: {
      status: 'complete',
      sourcesRead: 1,
      pagesRead: 1,
      itemsExtracted: 6,
      unreadSources: [],
      limitations: [],
    },
  };
}

/** A deep copy, so a test can never mutate the fixture another test reads. */
function realShapeAnswer() {
  return JSON.parse(JSON.stringify(answer()));
}

module.exports = {
  SOURCE_ID,
  SOURCE_TEXT,
  realShapeAnswer,
};
