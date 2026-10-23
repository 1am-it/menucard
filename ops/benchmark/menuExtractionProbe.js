'use strict';

// K4 of the Delivery Lead order for #59 / BE-21 (review 6370840673): the pure
// planning, measuring and stop rules of the bounded AI probe over the pinned
// captures.
//
// No file, network, provider or database access here. The ops script loads the
// pinned bytes (ops/benchmark/menuExtractionProbeSet.js), this module says how
// many calls that costs, what the comparison found and when the probe must
// stop, and `ops/benchmark/referenceComparison.js` stays the one place that
// counts missed/invented/price/rubric deviations.

const { ANTHROPIC_MODEL, ANTHROPIC_PRICING, buildOutputJsonSchema, estimateCostFromTokens } = require('../../src/lib/menuExtractionAnthropicCall');
const { actualRows, normalizePath, percent } = require('./referenceComparison');

const PROBE_SOURCE_IDS = Object.freeze(['zuyd', 'andalous', 'pellens', 'chocolat', 'smelt', 'blossem', 'bardot', 'wolfslaar']);

// The probe keeps the documented default limits and only raises the output
// ceiling and the call timeout, as agreed for the trial (thinking tokens count
// as output tokens).
//
// The timeout is 180 s (L2 of review 6373183699, "bijvoorbeeld 180 s"): a
// 16K-token generation (measured: 12 of 13 live calls produced no usage at the
// old 60 s ceiling) streams token by token, and the timer in
// src/lib/menuExtractionAdapter.js bounds the whole generation, while the SDK's
// own request timeout only bounds the wait for the response headers. 180 s is
// three times the old ceiling and still well inside the 10-minute SDK default;
// it is a ceiling for one call, not a target.
const PROBE_CALL_TIMEOUT_MS = 180_000;

const PROBE_LIMITS = Object.freeze({
  callTimeoutMs: PROBE_CALL_TIMEOUT_MS,
  maxInputTokens: 50_000,
  maxOutputTokens: 16_000,
  maxDocuments: 5,
  maxPages: 30,
  maxCostEurCents: 30,
});

const PROBE_BUDGET = Object.freeze({
  cumulativeLimitEurCents: 900,
  perCallLimitEurCents: 30,
  maxCalls: 40,
  maxConcurrency: 1,
});

const PROBE_RUNS = 2;

// Stops that must end the run immediately: a spent-but-unknown budget or a
// ledger that cannot answer makes every further call unaccountable.
const IMMEDIATE_STOP_REASONS = Object.freeze([
  'cost_unknown',
  'budget_settle_failed',
  'budget_exceeded',
  'budget_not_configured',
  'async_budget_guard_unsupported',
  'budget_ledger_locked',
  'budget_ledger_corrupt',
  'budget_ledger_limits_changed',
]);

// Reasons that mean the provider answered nothing usable. Two of these in a row
// end the run (L3): continuing would spend more money on a failing route.
// `schema_violation` is deliberately absent — it has its own rate rule — and so
// is `source_missing`, which is our own input problem, not the provider's.
const PROVIDER_FAILURE_REASONS = Object.freeze([
  'timeout',
  'rate_limited',
  'provider_unavailable',
  'model_unavailable',
  'provider_refusal',
  'output_truncated',
  'input_limit',
]);

const MAX_CONSECUTIVE_PROVIDER_FAILURES = 2;

function estimateTokens(text) {
  return Math.ceil((typeof text === 'string' ? text : '').length / 4);
}

/** Captures per call, in pinned order. 5 is the documented document limit. */
function chunkCaptures(captures, maxDocuments = PROBE_LIMITS.maxDocuments) {
  const list = Array.isArray(captures) ? captures : [];
  const size = Number.isInteger(maxDocuments) && maxDocuments > 0 ? maxDocuments : PROBE_LIMITS.maxDocuments;
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

/** Two runs per source so the report can measure stability between them. */
function planSourceCalls(source, options = {}) {
  const runs = Number.isInteger(options.runs) && options.runs > 0 ? options.runs : PROBE_RUNS;
  const maxDocuments = options.maxDocuments || PROBE_LIMITS.maxDocuments;
  if (!source || source.captureStatus !== 'captured') return [];
  const chunks = chunkCaptures(source.captures, maxDocuments);
  const calls = [];
  for (let run = 1; run <= runs; run += 1) {
    chunks.forEach((chunk, chunkIndex) => {
      calls.push({
        sourceId: source.id,
        run,
        chunkIndex,
        captureIds: chunk.map((capture) => capture.id),
      });
    });
  }
  return calls;
}

function promptEstimate(protocol, chunk, options = {}) {
  // Protocol (system) + one inventory line and one header per source + the
  // text + the structured-output schema and message framing.
  let chars = String(protocol || '').length + 400;
  for (const capture of chunk) {
    chars += 120;
    chars += typeof capture.text === 'string' ? capture.text.length : 0;
  }
  // M1 of review 6373786786: `prompt` mode carries the schema JSON in the
  // instruction instead of `output_config`, so the estimate must count it.
  if (options.outputMode === 'prompt') chars += JSON.stringify(buildOutputJsonSchema()).length;
  return Math.ceil(chars / 4);
}

/**
 * A planning estimate per source: prompt tokens of each call, the documented
 * output ceiling (a worst case) and a typical output guess. The ceiling is what
 * the budget check uses; a live run replaces it with the reported usage.
 */
function estimateSource(source, options = {}) {
  const protocol = typeof options.protocol === 'string' ? options.protocol : '';
  const limits = { ...PROBE_LIMITS, ...(options.limits || {}) };
  const calls = planSourceCalls(source, options);
  const chunks = chunkCaptures(source.captures, limits.maxDocuments);
  const promptTokensPerCall = chunks.map((chunk) => promptEstimate(protocol, chunk, options));
  const maxPromptTokens = promptTokensPerCall.length > 0 ? Math.max(...promptTokensPerCall) : 0;
  const perCallCeilingCosts = promptTokensPerCall.map((tokens) => estimateCostFromTokens({ inputTokens: tokens, outputTokens: limits.maxOutputTokens }));
  const maxCallCostEurCents = perCallCeilingCosts.reduce((max, entry) => Math.max(max, entry ? entry.costEurCents : 0), 0);
  const referenceItems = Number.isInteger(options.referenceItems)
    ? options.referenceItems
    : Number.isInteger(source.referenceItems)
      ? source.referenceItems
      : null;
  const runs = Number.isInteger(options.runs) && options.runs > 0 ? options.runs : PROBE_RUNS;
  const callsPerRun = Math.max(1, chunks.length);
  const typicalOutputTokens = Math.min(limits.maxOutputTokens, 400 + 60 * Math.ceil((referenceItems || 0) / callsPerRun));
  const costOf = (outputTokens) =>
    promptTokensPerCall.flatMap((tokens) =>
      Array.from({ length: runs }, () => estimateCostFromTokens({ inputTokens: tokens, outputTokens })),
    );
  const sum = (entries) => entries.reduce((total, entry) => total + (entry ? entry.costEurCents : 0), 0);
  return {
    id: source.id,
    label: source.label,
    captureStatus: source.captureStatus,
    blockedReason: source.blockedReason || null,
    captures: Array.isArray(source.captures) ? source.captures.length : 0,
    calls: calls.length,
    referenceItems,
    promptTokensPerCall,
    maxPromptTokens,
    withinInputLimit: calls.length > 0 && maxPromptTokens <= limits.maxInputTokens,
    maxCallCostEurCents,
    withinPerCallBudget: maxCallCostEurCents <= PROBE_BUDGET.perCallLimitEurCents,
    estimatedOutputTokensCeiling: limits.maxOutputTokens,
    estimatedOutputTokensTypical: typicalOutputTokens,
    estimatedCostEurCents: sum(costOf(limits.maxOutputTokens)),
    estimatedCostTypicalEurCents: sum(costOf(typicalOutputTokens)),
  };
}

function estimateProbe(sources, options = {}) {
  const limits = { ...PROBE_LIMITS, ...(options.limits || {}) };
  const rows = (Array.isArray(sources) ? sources : []).map((source) =>
    estimateSource(source, { ...options, limits, referenceItems: source.referenceItems }),
  );
  const plannedCalls = rows.reduce((total, row) => total + row.calls, 0);
  const estimatedCostEurCents = rows.reduce((total, row) => total + row.estimatedCostEurCents, 0);
  const blocked = rows.filter((row) => row.captureStatus !== 'captured');
  return {
    model: ANTHROPIC_MODEL,
    pricing: {
      source: ANTHROPIC_PRICING.source,
      retrievedAt: ANTHROPIC_PRICING.retrievedAt,
      currency: ANTHROPIC_PRICING.currency,
      conversion: ANTHROPIC_PRICING.conversion,
      tiers: ANTHROPIC_PRICING.tiers,
    },
    limits,
    budget: { ...PROBE_BUDGET },
    runs: options.runs || PROBE_RUNS,
    rows,
    totals: {
      sources: rows.length,
      capturedSources: rows.length - blocked.length,
      blockedSources: blocked.length,
      plannedCalls,
      estimatedCostEurCents,
      estimatedCostTypicalEurCents: rows.reduce((total, row) => total + row.estimatedCostTypicalEurCents, 0),
      maxSourceCostEurCents: Math.max(0, ...rows.map((row) => row.estimatedCostEurCents)),
      callsWithinBudget: plannedCalls <= PROBE_BUDGET.maxCalls,
      costWithinBudget: estimatedCostEurCents <= PROBE_BUDGET.cumulativeLimitEurCents,
      perCallWithinBudget: rows.every((row) => row.captureStatus !== 'captured' || row.withinPerCallBudget),
      inputWithinLimit: rows.every((row) => row.captureStatus !== 'captured' || row.withinInputLimit),
    },
    assumptions: [
      'Prompt tokens are estimated from the pinned source text (characters / 4) plus the pinned instruction and schema framing.',
      'The reported cost uses the documented output ceiling (16,000 tokens) per call; a live run replaces it with the reported usage.',
      'A source with more captures than the document limit is sent in several calls within the same run; its results are compared together.',
      'No network, key or paid call is involved in this estimate.',
    ],
    blocked: blocked.map((row) => ({ id: row.id, label: row.label, reason: row.blockedReason || 'not captured' })),
  };
}

function normalizeForMatch(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Evidence coverage the way the validator defines it: every item quote must be
 * a literal passage of the source it cites. A live result has already passed
 * that validation, so this is a second, independent count for the report.
 */
function evidenceCoverage(menus, sourceById) {
  let items = 0;
  let withQuote = 0;
  let verified = 0;
  for (const menu of Array.isArray(menus) ? menus : []) {
    for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
      for (const item of Array.isArray(category.items) ? category.items : []) {
        items += 1;
        const evidence = item && item.evidence ? item.evidence : {};
        const quote = normalizeForMatch(evidence.quote);
        if (!quote) continue;
        withQuote += 1;
        const source = sourceById instanceof Map ? sourceById.get(evidence.sourceId) : null;
        const text = source && typeof source.text === 'string' ? normalizeForMatch(source.text) : '';
        if (text && text.includes(quote)) verified += 1;
      }
    }
  }
  return { items, withQuote, verified, ratio: percent(verified, items) };
}

function variantCounts(reference, menus) {
  const countVariants = (list) => {
    let withVariants = 0;
    let variants = 0;
    for (const menu of list) {
      for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
        for (const item of Array.isArray(category.items) ? category.items : []) {
          const entries = Array.isArray(item && item.priceVariants) ? item.priceVariants : [];
          if (entries.length > 0) withVariants += 1;
          variants += entries.length;
        }
      }
    }
    return { itemsWithVariants: withVariants, priceVariants: variants };
  };
  return {
    reference: countVariants(Array.isArray(reference && reference.menus) ? reference.menus : []),
    actual: countVariants(Array.isArray(menus) ? menus : []),
  };
}

/**
 * Informational only: a rubric error whose only difference is the leading menu
 * title. The official count stays the one from compareControlledReference.
 */
function titleOnlyCategoryErrors(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const expected = normalizePath(row.expectedPath).join('\u0000');
    const actual = normalizePath(Array.isArray(row.actualPath) ? row.actualPath.slice(1) : []).join('\u0000');
    return expected.length > 0 && expected === actual;
  }).length;
}

function rowKey(row) {
  return `${row.pathKey}\u0000${row.key}\u0000${row.prices.join(',')}`;
}

/** How stable the two runs of one source are, on the compared row set. */
function compareRuns(firstMenus, secondMenus) {
  const first = new Set(actualRows(firstMenus).map(rowKey));
  const second = new Set(actualRows(secondMenus).map(rowKey));
  let both = 0;
  for (const key of first) if (second.has(key)) both += 1;
  const union = new Set([...first, ...second]).size;
  return {
    identical: both === first.size && both === second.size,
    jaccardPercent: percent(both, union),
    rowsFirstRun: first.size,
    rowsSecondRun: second.size,
  };
}

/** The report row for one source after a live (or replayed) comparison. */
function summarizeSource({ source, reference, menus, comparison, sourceById, titles, runs }) {
  return {
    sourceId: source.id,
    label: source.label,
    captureStatus: source.captureStatus || 'captured',
    blockedReason: source.blockedReason || null,
    menus: titles,
    referenceItems: comparison.referenceItems,
    actualItems: comparison.actualItems,
    matched: comparison.matched,
    missing: comparison.missing,
    invented: comparison.invented,
    priceErrors: comparison.priceErrors,
    categoryErrors: comparison.categoryErrors,
    titleOnlyCategoryErrors: titleOnlyCategoryErrors(comparison.categoryErrorRows),
    precision: comparison.precision,
    recall: comparison.recall,
    evidence: evidenceCoverage(menus, sourceById),
    variants: variantCounts(reference, menus),
    stability: runs && runs.length > 1 ? compareRuns(runs[0], runs[1]) : null,
  };
}

/**
 * The documented stop rules. `calls` counts the calls already made (including
 * the failed one) and `schemaErrors` the schema failures among them.
 */
/**
 * The documented stop rules (review 6373183699, L3).
 * `calls` counts the calls already made (including the failed one) and
 * `schemaErrors` the schema failures among them.
 *
 * 1. an immediate-stop reason ends the run at once;
 * 2. a call whose actual cost is unknown ends the run at once, whatever the
 *    technical reason was — a paid failure must not silently continue;
 * 3. two consecutive provider failures/timeouts end the run as well.
 */
function evaluateStop({ reason = null, calls = 0, schemaErrors = 0, costUnknown = false, consecutiveFailures = 0 } = {}) {
  if (reason && IMMEDIATE_STOP_REASONS.includes(reason)) return { stop: true, code: reason };
  if (costUnknown === true) return { stop: true, code: 'cost_unknown' };
  if (Number.isInteger(consecutiveFailures) && consecutiveFailures >= MAX_CONSECUTIVE_PROVIDER_FAILURES) {
    return { stop: true, code: 'consecutive_provider_failures' };
  }
  if (calls >= 2 && schemaErrors > calls / 2) return { stop: true, code: 'schema_error_rate_above_half' };
  return { stop: false, code: null };
}

/** Whether a reason counts as a provider failure for the consecutive rule. */
function isProviderFailureReason(reason) {
  return typeof reason === 'string' && PROVIDER_FAILURE_REASONS.includes(reason);
}

module.exports = {
  IMMEDIATE_STOP_REASONS,
  MAX_CONSECUTIVE_PROVIDER_FAILURES,
  PROBE_BUDGET,
  PROBE_CALL_TIMEOUT_MS,
  PROBE_LIMITS,
  PROBE_RUNS,
  PROBE_SOURCE_IDS,
  PROVIDER_FAILURE_REASONS,
  chunkCaptures,
  compareRuns,
  estimateProbe,
  estimateSource,
  estimateTokens,
  evaluateStop,
  evidenceCoverage,
  isProviderFailureReason,
  planSourceCalls,
  promptEstimate,
  summarizeSource,
  titleOnlyCategoryErrors,
  variantCounts,
};
