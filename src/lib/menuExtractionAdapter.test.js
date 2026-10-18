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
const sources = [{ id: 'source-1', url: 'https://fictief.example/menu', kind: 'html', status: 'read', text: 'Fictieve soep 6.50' }];
const valid = {
  menus: [
    {
      title: 'Lunch',
      sourceId: 'source-1',
      categories: [
        {
          name: 'Voor',
          items: [{ name: 'Fictieve soep', priceStatus: 'known', amountMinorUnits: 650, currency: 'EUR', evidence: { sourceId: 'source-1', locator: 'list:1', quote: 'Fictieve soep 6.50' } }],
        },
      ],
    },
  ],
  rejected: [],
  coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
};
const limits = { callTimeoutMs: 100, maxCostEurCents: 100 };
function budget(costEurCents = 25) {
  const calls = [];
  return {
    costEurCents,
    reserve: (value) => {
      calls.push(['reserve', value]);
      return true;
    },
    settle: (value) => calls.push(['settle', value]),
    calls,
  };
}

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
  const result = await runStructuredExtraction({ adapter, protocol, sources, limits, budget: budget() });
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
  assert.equal((await runStructuredExtraction({ adapter: createStructuredExtractionAdapter({ call: async () => output }), protocol, sources, limits, budget: budget() })).reason, 'schema_violation');
  const badSource = { ...valid, menus: [{ ...valid.menus[0], sourceId: 'source-999' }] };
  assert.equal((await runStructuredExtraction({ adapter: createStructuredExtractionAdapter({ call: async () => badSource }), protocol, sources, limits, budget: budget() })).reason, 'schema_violation');
  assert.ok(validateStructuredOutput({ ...valid, menus: [{ ...valid.menus[0], categories: [{ ...valid.menus[0].categories[0], items: [{ ...valid.menus[0].categories[0].items[0], confidence: 1 }] }] }] }, sources).some((p) => p.includes('forbidden')));
});

test('timeout and budget limits stop the call; unknown cost is not treated as zero', async () => {
  const slow = createStructuredExtractionAdapter({ call: () => new Promise(() => {}) });
  assert.equal((await runStructuredExtraction({ adapter: slow, protocol, sources, limits: { callTimeoutMs: 5, maxCostEurCents: 100 }, budget: budget() })).reason, 'timeout');
  assert.equal((await runStructuredExtraction({ adapter: slow, protocol, sources, limits: { callTimeoutMs: 5, maxCostEurCents: null }, budget: budget() })).reason, 'budget_not_configured');
  assert.equal((await runStructuredExtraction({ adapter: slow, protocol, sources, limits, budget: { ...budget(200), costEurCents: 200 } })).reason, 'budget_exceeded');
});

test('REGRESSION: strict schema rejects invalid coverage, unknown nested fields, missing evidence quote and overlong values', async () => {
  const calls = [];
  const adapter = (output) => createStructuredExtractionAdapter({ call: async () => output });
  const baseItem = valid.menus[0].categories[0].items[0];
  const cases = [
    { ...valid, coverage: { ...valid.coverage, status: 'invalid' } },
    { ...valid, coverage: { ...valid.coverage, unexpected: true } },
    { ...valid, menus: [{ ...valid.menus[0], unexpected: true }] },
    { ...valid, menus: [{ ...valid.menus[0], categories: [{ ...valid.menus[0].categories[0], items: [{ ...baseItem, unexpected: true }] }] }] },
    { ...valid, menus: [{ ...valid.menus[0], categories: [{ ...valid.menus[0].categories[0], items: [{ ...baseItem, evidence: { sourceId: 'source-1', locator: 'list:1' } }] }] }] },
    { ...valid, menus: [{ ...valid.menus[0], categories: [{ ...valid.menus[0].categories[0], items: [{ ...baseItem, name: 'x'.repeat(201) }] }] }] },
  ];
  for (const output of cases) {
    const result = await runStructuredExtraction({ adapter: adapter(output), protocol, sources, limits, budget: budget() });
    assert.equal(result.reason, 'schema_violation');
    calls.push(result.problems.length);
  }
  assert.equal(calls.every((n) => n > 0), true);
});

test('REGRESSION: limits reject negative/zero configuration before calling the provider', async () => {
  let called = 0;
  const adapter = createStructuredExtractionAdapter({ call: async () => { called += 1; return valid; } });
  const negative = await runStructuredExtraction({ adapter, protocol, sources, limits: { ...limits, maxCostEurCents: -1 }, budget: budget() });
  assert.equal(negative.reason, 'invalid_limits');
  const zero = await runStructuredExtraction({ adapter, protocol, sources, limits: { ...limits, maxInputTokens: 0 }, budget: budget() });
  assert.equal(zero.reason, 'invalid_limits');
  assert.equal(called, 0);
});

test('REGRESSION: input, page and output limits are enforced, not merely passed through', async () => {
  const adapter = createStructuredExtractionAdapter({ call: async () => valid });
  const input = await runStructuredExtraction({ adapter, protocol: { text: 'x'.repeat(100), hash: 'h' }, sources, limits: { ...limits, maxInputTokens: 1 }, budget: budget() });
  assert.equal(input.reason, 'input_limit');
  const pages = await runStructuredExtraction({ adapter, protocol, sources: [{ ...sources[0], pageCount: 2 }], limits: { ...limits, maxPages: 1 }, budget: budget() });
  assert.equal(pages.reason, 'page_limit');
  const output = await runStructuredExtraction({ adapter, protocol, sources, limits: { ...limits, maxOutputTokens: 1 }, budget: budget() });
  assert.equal(output.reason, 'output_limit');
});

test('REGRESSION: timeout aborts the provider signal and calls the cancellation hook', async () => {
  let aborted = false;
  let cancelled = false;
  const adapter = createStructuredExtractionAdapter({
    call: ({ signal }) => new Promise(() => {
      signal.addEventListener('abort', () => { aborted = true; });
    }),
    cancel: () => { cancelled = true; },
  });
  const result = await runStructuredExtraction({ adapter, protocol, sources, limits: { ...limits, callTimeoutMs: 5 }, budget: budget() });
  assert.equal(result.reason, 'timeout');
  assert.equal(aborted, true);
  assert.equal(cancelled, true);
});

test('a future paid call cannot run without a budget reservation guard', async () => {
  const adapter = createStructuredExtractionAdapter({ call: async () => valid });
  assert.equal((await runStructuredExtraction({ adapter, protocol, sources, limits })).reason, 'budget_guard_required');
});

test('advanced fields are reported as unsupported by the current concept, not silently flattened', () => {
  const advanced = {
    menus: [{ ...valid.menus[0], categories: [{ ...valid.menus[0].categories[0], items: [{ ...valid.menus[0].categories[0].items[0], priceVariants: [{ label: 'Glas', amountMinorUnits: 350 }], supplement: { ofItem: 'x' }, allergens: { status: 'explicit', values: ['melk'] } }] }] }],
  };
  assert.deepEqual(unsupportedProductFields(advanced), ['priceVariants', 'supplement', 'allergens']);
});
