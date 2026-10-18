'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStructuredExtractionAdapter } = require('./menuExtractionAdapter');
const { createMenuExtractionRuntime } = require('./menuExtractionRuntime');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { buildCandidateSummary } = require('./urlIntakes');
const { buildMenuConcept } = require('./menuConcept');

const page = '<html><body><h1>Fictief Restaurant</h1><p>Fictieve soep 6.50</p></body></html>';
const output = {
  menus: [
    {
      title: 'Lunch',
      sourceId: 'source-1',
      categories: [
        {
          name: 'Voor',
          items: [
            {
              name: 'Fictieve soep',
              priceStatus: 'known',
              amountMinorUnits: 650,
              currency: 'EUR',
              evidence: { sourceId: 'source-1', locator: 'body:1', quote: 'Fictieve soep 6.50' },
            },
          ],
        },
      ],
    },
  ],
  rejected: [],
  coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
};

function budget() {
  return { costEurCents: 10, reserve: () => true, settle: () => {} };
}

test('INTEGRATION: protocol, source content, strict schema and validated result cross the real analysis chain', async () => {
  let received;
  const adapter = createStructuredExtractionAdapter({
    provider: 'fake',
    model: 'fixture',
    call: async (input) => {
      received = input;
      return output;
    },
  });
  const runtime = createMenuExtractionRuntime({
    adapter,
    limits: { callTimeoutMs: 100, maxCostEurCents: 100 },
    budget: budget(),
  });
  const analysis = await runRestaurantSourceAnalysis({
    homepageHtml: page,
    homepageUrl: 'https://fictief.example/',
    fetchCandidate: async () => ({ status: 'blocked' }),
    structuredExtraction: runtime,
  });

  assert.equal(analysis.aiExtraction.enabled, true);
  assert.equal(analysis.aiExtraction.ok, true);
  assert.equal(analysis.aiExtraction.meta.provider, 'fake');
  assert.equal(received.protocolHash.length, 64);
  assert.equal(received.schema.version, 'menu-extraction-output/v1');
  assert.match(received.sources[0].text, /Fictieve soep 6.50/);

  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts });
  assert.equal(summary.menus[0].title, 'Lunch');
  assert.equal(summary.menus[0].sourceId, 'source-1');
  const concept = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} });
  assert.equal(concept.canSave, true);
  assert.equal(concept.content.categories[0].items[0].name, 'Fictieve soep');
  assert.equal(concept.content.categories[0].items[0].price, '6.50');
  assert.equal(concept.content.categories[0].items[0].evidence.quote, 'Fictieve soep 6.50');
  assert.equal(concept.content.categories[0].items[0].evidence.sourceId, 'source-1');
});

test('a disabled runtime is connected but makes no model call and leaves deterministic output unchanged', async () => {
  let called = 0;
  const adapter = createStructuredExtractionAdapter({ call: async () => { called += 1; return output; } });
  const runtime = createMenuExtractionRuntime({ adapter: null });
  const analysis = await runRestaurantSourceAnalysis({
    homepageHtml: page,
    homepageUrl: 'https://fictief.example/',
    fetchCandidate: async () => ({ status: 'blocked' }),
    structuredExtraction: runtime,
  });
  assert.equal(called, 0);
  assert.equal(analysis.aiExtraction.enabled, false);
  assert.equal(analysis.menuContexts.length, 0);
  assert.equal(adapter.configured, true);
});
