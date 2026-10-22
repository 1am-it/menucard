'use strict';

// #59 fase 2 — de meting van een handmatige proef (K9). Fictieve bron, geen
// netwerk en geen referentiebestand van #59: de tellingen worden op een eigen
// referentie bewezen, zodat de meetcode zelf niet stil kan afwijken.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadMenuExtractionProtocol } = require('../../src/lib/menuExtractionProtocol');
const { buildImportBundle, sourceHashForText } = require('../../src/lib/manualMenuImportBundle');
const { buildImportReport } = require('../../src/lib/manualMenuImportImport');
const { measureImport, markdown, LABEL } = require('./measure-manual-ai-import');

const PROTOCOL = loadMenuExtractionProtocol({ root: path.resolve(__dirname, '..', '..') });
const TEXT = ['Bites', 'Broodplank 8,50', 'Espresso 2,50'].join('\n');

function fixture() {
  const bundle = buildImportBundle({
    bundleId: 'proef',
    actorUserId: 'proef',
    restaurantId: '23',
    restaurantName: 'Voorbeeld',
    fetchedAt: '2026-10-22T12:00:00.000Z',
    protocol: PROTOCOL,
    sources: [{ id: 'source-1', url: 'https://voorbeeld.example/menu', kind: 'html', text: TEXT, sha256: sourceHashForText(TEXT) }],
  });
  const output = {
    menus: [
      {
        title: 'Lunch',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Bites',
            items: [
              { name: 'Broodplank', priceStatus: 'known', amountMinorUnits: 850, currency: 'EUR', evidence: { sourceId: 'source-1', locator: 'Bites · 1', quote: 'Broodplank 8,50' } },
              { name: 'Espresso', priceStatus: 'known', amountMinorUnits: 250, currency: 'EUR', evidence: { sourceId: 'source-1', locator: 'Bites · 2', quote: 'Espresso 2,50' } },
              { name: 'Verzonnen gerecht', priceStatus: 'known', amountMinorUnits: 900, currency: 'EUR', evidence: { sourceId: 'source-1', locator: 'Bites · 3', quote: 'Verzonnen gerecht 9,00' } },
              {
                name: 'Glas wijn',
                priceStatus: 'multiple_undecomposed',
                priceVariants: [{ label: 'Glas', amountMinorUnits: 400, currency: 'EUR' }],
                evidence: { sourceId: 'source-1', locator: 'Bites · 4', quote: 'Broodplank' },
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'partial', sourcesRead: 1, pagesRead: 1, itemsExtracted: 4, unreadSources: [], limitations: ['Onvolledig'] },
  };
  const report = buildImportReport({ importId: 'proef', bundle, output, aiName: 'Claude', now: new Date('2026-10-22T12:05:00.000Z') });
  assert.equal(report.ok, true);
  return { bundle, report };
}

test('K9: de meting telt gemist, verzonnen, varianten, rubrieken en bewijsdekking', () => {
  const { bundle, report } = fixture();
  const reference = {
    label: 'fictieve referentie',
    categories: [
      {
        path: ['Lunch', 'Bites'],
        items: [
          { name: 'Broodplank', price: '8.50' },
          { name: 'Espresso', price: '2.50' },
          { name: 'Soep van de dag', price: '5.50' },
        ],
      },
    ],
  };
  const measurement = measureImport({ report, reference, aiName: 'Claude', protocol: PROTOCOL, bundle, generatedAt: new Date('2026-10-22T12:10:00.000Z') });
  assert.equal(measurement.label, LABEL);
  assert.equal(measurement.ai, 'Claude');
  assert.equal(measurement.counts.items, 4);
  assert.equal(measurement.counts.variants, 1);
  assert.equal(measurement.counts.sections, 1);
  assert.equal(measurement.counts.unsupported, 1);
  assert.equal(measurement.comparison.expectedItems, 3);
  assert.equal(measurement.comparison.actualItems, 4);
  assert.equal(measurement.comparison.matched, 2);
  assert.deepEqual(measurement.comparison.missing.map((row) => row.name), ['Soep van de dag']);
  assert.deepEqual(measurement.comparison.extra.map((row) => row.name), ['Verzonnen gerecht', 'Glas wijn']);
  assert.equal(measurement.comparison.accounting.expected.balanced, true);
  assert.equal(measurement.comparison.accounting.actual.balanced, true);
  assert.equal(measurement.evidence.rows, 4);
  assert.equal(measurement.evidence.verifiedInSource, 3);
  assert.equal(measurement.evidence.coverage, 0.75);
  assert.equal(measurement.protocol.hash, PROTOCOL.hash);
  const md = markdown(measurement);
  assert.match(md, /handmatige proef, geen schaalacceptatie/);
  assert.match(md, /Gemist: 1/);
  assert.match(md, /verzonnen: 2/);
});

test('K9: zonder referentie meet het script alleen aantallen en bewijs', () => {
  const { report } = fixture();
  const measurement = measureImport({ report, reference: null, aiName: 'Claude', protocol: PROTOCOL });
  assert.equal(measurement.comparison, null);
  assert.match(markdown(measurement), /Geen referentie opgegeven/);
});
