'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createStructuredExtractionAdapter,
  runStructuredExtraction,
  validateStructuredOutput,
  unsupportedProductFields,
} = require('./menuExtractionAdapter');

const protocol = { text: 'pinned instruction', hash: 'a'.repeat(64) };
const sources = [{ id: 'source-1', url: 'https://fictief.example/menu', kind: 'html', status: 'read' }];
const valid = {
  menus: [
    {
      title: 'Lunch',
      sourceId: 'source-1',
      categories: [
        {
          name: 'Voor',
          items: [{ name: 'Fictieve soep', priceStatus: 'known', amountMinorUnits: 650, evidence: { sourceId: 'source-1', locator: 'list:1' } }],
        },
      ],
    },
  ],
  rejected: [],
};
const limits = { callTimeoutMs: 100, maxCostEurCents: 100 };

test('valid structured output passes independent source and price validation; only the pinned instruction/schema is passed', async () => {
  let received;
  const adapter = createStructuredExtractionAdapter({
    provider: 'fake',
    model: 'fixture',
    call: async (input) => {
      received = input;
      return valid;
    },
  });
  const result = await runStructuredExtraction({ adapter, protocol, sources, limits });
  assert.equal(result.ok, true);
  assert.equal(result.meta.provider, 'fake');
  assert.equal(received.protocolHash, protocol.hash);
  assert.deepEqual(received.tools, []);
  assert.equal(received.schema.version, 'menu-extraction-output/v1');
  assert.deepEqual(unsupportedProductFields(result.output), []);
});

test('missing provider is a concrete refusal, never a fake empty extraction', async () => {
  const adapter = createStructuredExtractionAdapter({});
  assert.equal(adapter.configured, false);
  const result = await runStructuredExtraction({ adapter, protocol, sources, limits });
  assert.deepEqual(result, { ok: false, reason: 'provider_not_configured' });
});

test('forbidden confidence/reviewReady and unreferenced sources are rejected', async () => {
  const output = { ...valid, confidence: 0.9 };
  assert.equal((await runStructuredExtraction({ adapter: createStructuredExtractionAdapter({ call: async () => output }), protocol, sources, limits })).reason, 'schema_violation');
  const badSource = { ...valid, menus: [{ ...valid.menus[0], sourceId: 'source-999' }] };
  assert.equal((await runStructuredExtraction({ adapter: createStructuredExtractionAdapter({ call: async () => badSource }), protocol, sources, limits })).reason, 'schema_violation');
  assert.ok(validateStructuredOutput({ ...valid, menus: [{ ...valid.menus[0], categories: [{ ...valid.menus[0].categories[0], items: [{ ...valid.menus[0].categories[0].items[0], confidence: 1 }] }] }] }, sources).some((p) => p.includes('forbidden')));
});

test('timeout and budget limits stop the call; unknown cost is not treated as zero', async () => {
  const slow = createStructuredExtractionAdapter({ call: () => new Promise(() => {}) });
  assert.equal((await runStructuredExtraction({ adapter: slow, protocol, sources, limits: { callTimeoutMs: 5, maxCostEurCents: 100 } })).reason, 'timeout');
  assert.equal((await runStructuredExtraction({ adapter: slow, protocol, sources, limits: { callTimeoutMs: 5, maxCostEurCents: null } })).reason, 'budget_not_configured');
  assert.equal((await runStructuredExtraction({ adapter: slow, protocol, sources, limits, budget: { costEurCents: 200 } })).reason, 'budget_exceeded');
});

test('advanced fields are reported as unsupported by the current concept, not silently flattened', () => {
  const advanced = {
    menus: [{ ...valid.menus[0], categories: [{ ...valid.menus[0].categories[0], items: [{ ...valid.menus[0].categories[0].items[0], priceVariants: [{ label: 'Glas', amountMinorUnits: 350 }], supplement: { ofItem: 'x' }, allergens: { status: 'explicit', values: ['melk'] } }] }] }],
  };
  assert.deepEqual(unsupportedProductFields(advanced), ['priceVariants', 'supplement', 'allergens']);
});
