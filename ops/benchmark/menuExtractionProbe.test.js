'use strict';

// K4/K6 regressions for the AI probe planning and measurement (#59 / BE-21
// review 6370840673). Pure functions only: no file, key, network or provider.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CONSECUTIVE_PROVIDER_FAILURES,
  PROBE_BUDGET,
  PROBE_CALL_TIMEOUT_MS,
  PROBE_LIMITS,
  PROBE_SOURCE_IDS,
  chunkCaptures,
  compareRuns,
  estimateProbe,
  estimateSource,
  evaluateStop,
  evidenceCoverage,
  isProviderFailureReason,
  planSourceCalls,
  summarizeSource,
  titleOnlyCategoryErrors,
  variantCounts,
} = require('./menuExtractionProbe');

function captures(count, textChars = 400) {
  return Array.from({ length: count }, (_, index) => ({
    id: `source-${String(index + 1).padStart(2, '0')}`,
    url: `https://fictief.example/pagina-${index + 1}`,
    kind: 'html',
    text: 'x'.repeat(textChars),
  }));
}

function source(overrides = {}) {
  return { id: 'zuyd', label: 'Zuyd', captureStatus: 'captured', blockedReason: null, captures: captures(6), referenceItems: 36, ...overrides };
}

test('K4: the probe set is closed, the documented limits and caps are the ones from the order', () => {
  assert.deepEqual(PROBE_SOURCE_IDS, ['zuyd', 'andalous', 'pellens', 'chocolat', 'smelt', 'blossem', 'bardot', 'wolfslaar']);
  assert.equal(PROBE_LIMITS.maxDocuments, 5);
  assert.equal(PROBE_LIMITS.maxOutputTokens, 16_000);
  assert.equal(PROBE_LIMITS.maxInputTokens, 50_000);
  assert.equal(PROBE_LIMITS.maxCostEurCents, 30);
  assert.deepEqual(PROBE_BUDGET, {
    cumulativeLimitEurCents: 900,
    perCallLimitEurCents: 30,
    maxCalls: 40,
    maxConcurrency: 1,
  });
});

test('K4: captures are chunked at the document limit and every source gets two runs', () => {
  const chunks = chunkCaptures(captures(8), 5);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [5, 3]);
  assert.equal(chunks[0][0].id, 'source-01');
  assert.equal(chunks[1][2].id, 'source-08');

  const calls = planSourceCalls(source(), { runs: 2 });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => [call.run, call.chunkIndex, call.captureIds.length]), [
    [1, 0, 5],
    [1, 1, 1],
    [2, 0, 5],
    [2, 1, 1],
  ]);
  assert.deepEqual(planSourceCalls(source({ captureStatus: 'blocked' })), []);
});

test('K4: the estimate is per source, conservative and checks the caps', () => {
  const estimate = estimateSource(source(), { protocol: 'instructie', runs: 2 });
  assert.equal(estimate.calls, 4);
  assert.equal(estimate.referenceItems, 36);
  assert.equal(estimate.withinInputLimit, true);
  assert.equal(estimate.estimatedOutputTokensCeiling, 16_000);
  assert.ok(estimate.estimatedCostEurCents > 0);
  // One call with a 200k-character prompt is above the 50k-token input limit.
  const huge = estimateSource(source({ captures: captures(1, 200_000) }), { protocol: 'x', runs: 1 });
  assert.equal(huge.withinInputLimit, false);

  const probe = estimateProbe([source(), source({ id: 'smelt', label: 'Smelt', captures: captures(1) })], { protocol: 'instructie', runs: 2 });
  assert.equal(probe.rows.length, 2);
  assert.equal(probe.totals.plannedCalls, 6);
  assert.equal(probe.totals.callsWithinBudget, true);
  assert.equal(probe.totals.costWithinBudget, true);
  assert.equal(probe.totals.capturedSources, 2);
  assert.equal(probe.rows[0].id, 'zuyd');
});

test('K4: evidence coverage, variants and run stability are measured, not asserted', () => {
  const menus = [
    {
      title: 'Lunch',
      categories: [
        {
          name: 'Voor',
          path: ['Lunch', 'Voor'],
          items: [
            { name: 'Soep', evidence: { sourceId: 'source-01', locator: 'regel 1', quote: 'Fictieve soep 6.50' } },
            { name: 'Brood', evidence: { sourceId: 'source-01', locator: 'regel 2', quote: 'niet in de bron' } },
          ],
        },
      ],
    },
  ];
  const sourceById = new Map([['source-01', { id: 'source-01', text: 'Fictieve soep 6.50 en wat brood' }]]);
  assert.deepEqual(evidenceCoverage(menus, sourceById), { items: 2, withQuote: 2, verified: 1, ratio: 50 });
  assert.deepEqual(evidenceCoverage([], sourceById), { items: 0, withQuote: 0, verified: 0, ratio: null });

  const reference = {
    menus: [{ categories: [{ path: ['Voor'], items: [{ name: 'Soep', priceVariants: [{ label: 'glas', price: '3.50' }, { label: 'fles', price: '18.00' }] }] }] }],
  };
  const actual = [{ categories: [{ name: 'Voor', path: ['Voor'], items: [{ name: 'Soep', priceVariants: [{ label: 'glas', amountMinorUnits: 350, currency: 'EUR' }] }] }] }];
  assert.deepEqual(variantCounts(reference, actual), {
    reference: { itemsWithVariants: 1, priceVariants: 2 },
    actual: { itemsWithVariants: 1, priceVariants: 1 },
  });

  const identical = compareRuns(menus, menus);
  assert.equal(identical.identical, true);
  assert.equal(identical.jaccardPercent, 100);
  const different = compareRuns(menus, [{ title: 'Diner', categories: [] }]);
  assert.equal(different.identical, false);
  assert.equal(different.rowsSecondRun, 0);
});

test('K4: only the documented stop reasons end the probe immediately', () => {
  assert.deepEqual(evaluateStop({ reason: 'cost_unknown', calls: 1 }), { stop: true, code: 'cost_unknown' });
  assert.deepEqual(evaluateStop({ reason: 'budget_settle_failed', calls: 3 }), { stop: true, code: 'budget_settle_failed' });
  assert.deepEqual(evaluateStop({ reason: 'timeout', calls: 1 }), { stop: false, code: null });
  assert.deepEqual(evaluateStop({ reason: 'schema_violation', calls: 1, schemaErrors: 1 }), { stop: false, code: null });
  assert.deepEqual(evaluateStop({ reason: 'schema_violation', calls: 3, schemaErrors: 2 }), {
    stop: true,
    code: 'schema_error_rate_above_half',
  });
  assert.deepEqual(evaluateStop({ calls: 2, schemaErrors: 1 }), { stop: false, code: null });
});

test('L3: an unknown cost stops the run, whatever the technical reason was', () => {
  // The first live run stopped at 13 calls while 12 of them had no usage: a
  // timeout (or any provider failure) that reported no cost must end the run.
  for (const reason of ['timeout', 'provider_unavailable', 'rate_limited', 'provider_refusal']) {
    assert.deepEqual(evaluateStop({ reason, calls: 1, costUnknown: true }), { stop: true, code: 'cost_unknown' });
  }
  // A known cost on a failed call is not by itself a stop reason.
  assert.deepEqual(evaluateStop({ reason: 'schema_violation', calls: 1, schemaErrors: 1, costUnknown: false }), { stop: false, code: null });
});

test('L3: two consecutive provider failures or timeouts end the run', () => {
  assert.equal(MAX_CONSECUTIVE_PROVIDER_FAILURES, 2);
  assert.deepEqual(evaluateStop({ reason: 'timeout', calls: 2, consecutiveFailures: 2 }), { stop: true, code: 'consecutive_provider_failures' });
  assert.deepEqual(evaluateStop({ reason: 'provider_unavailable', calls: 2, consecutiveFailures: 2, costUnknown: true }), {
    stop: true,
    code: 'cost_unknown',
  });
  assert.deepEqual(evaluateStop({ reason: 'timeout', calls: 1, consecutiveFailures: 1 }), { stop: false, code: null });
  // A schema violation has its own rate rule and does not count as a provider failure.
  assert.equal(isProviderFailureReason('schema_violation'), false);
  assert.equal(isProviderFailureReason('source_missing'), false);
  for (const reason of ['timeout', 'provider_unavailable', 'rate_limited', 'provider_refusal', 'output_truncated', 'input_limit']) {
    assert.equal(isProviderFailureReason(reason), true, `${reason} counts as a provider failure`);
  }
});

test('L2: the probe timeout is 180 s and the documented limits stay fixed', () => {
  assert.equal(PROBE_CALL_TIMEOUT_MS, 180_000);
  assert.equal(PROBE_LIMITS.callTimeoutMs, 180_000);
  assert.equal(Object.isFrozen(PROBE_LIMITS), true);
});

test('K4: a source summary keeps the official counts and the title-only diagnostic separate', () => {
  const comparison = {
    referenceItems: 2,
    actualItems: 1,
    matched: 0,
    missing: 1,
    invented: 0,
    priceErrors: 0,
    categoryErrors: 1,
    categoryErrorRows: [
      { expectedPath: ['Diner', 'Voor'], actualPath: ['Dinerkaart', 'Diner', 'Voor'] },
      { expectedPath: ['Diner', 'Na'], actualPath: ['Dinerkaart', 'Lunch'] },
    ],
    precision: 0,
    recall: 0,
  };
  const summary = summarizeSource({
    source: { id: 'zuyd', label: 'Zuyd', captureStatus: 'captured' },
    reference: {
      menus: [{ categories: [{ path: ['Diner', 'Voor'], items: [{ name: 'Soep', price: '6.50' }, { name: 'Brood', price: '3.00' }] }] }],
    },
    menus: [{ title: 'Dinerkaart', categories: [{ name: 'Voor', path: ['Diner', 'Voor'], items: [{ name: 'Soep', evidence: { sourceId: 's', quote: 'Soep 6.50' } }] }] }],
    comparison,
    sourceById: new Map([['s', { id: 's', text: 'Soep 6.50' }]]),
    titles: ['Dinerkaart'],
    runs: [[], []],
  });
  assert.equal(summary.categoryErrors, 1);
  assert.equal(summary.titleOnlyCategoryErrors, 1);
  assert.equal(summary.evidence.ratio, 100);
  assert.equal(titleOnlyCategoryErrors(comparison.categoryErrorRows), 1);
});
