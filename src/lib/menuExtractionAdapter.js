'use strict';

// Provider-neutral structured-extraction boundary. The adapter receives the
// pinned instruction, already-fetched trusted sources and a hard budget; it
// returns only the declared schema. No SDK, provider name, key or network call
// lives here. A caller supplies `call`; absent that, the adapter is disabled.
//
// The validator is independent of model claims: it checks source references,
// bounds, price invariants and explicitly rejects `confidence`/`reviewReady`.
// It does not turn an invalid/partial result into a successful empty menu.

const { DEFAULT_EXTRACTION_LIMITS } = require('./menuExtractionProtocol');
const schema = require('./menuExtractionSchema');

const PRICE_STATUSES = schema.PRICE_STATUSES;
const FORBIDDEN_TRUST_KEYS = schema.FORBIDDEN_TRUST_KEYS;
const EXTRACTION_OUTPUT_SCHEMA = {
  ...schema.EXTRACTION_OUTPUT_SCHEMA,
  allowedTools: [],
};
const RECOVERABLE_ERRORS = new Set(['timeout', 'rate_limited', 'provider_unavailable']);

function createStructuredExtractionAdapter({ provider, model, call, cancel } = {}) {
  return {
    configured: typeof call === 'function',
    provider: typeof provider === 'string' ? provider : null,
    model: typeof model === 'string' ? model : null,
    version: typeof provider === 'string' && typeof model === 'string' ? `${provider}/${model}` : null,
    extract: typeof call === 'function' ? call : null,
    cancel: typeof cancel === 'function' ? cancel : null,
  };
}

/** Kept as the adapter's public validation entry point; the strict schema and
 * all nested/coverage checks live in src/lib/menuExtractionSchema.js. */
function validateStructuredOutput(output, sources) {
  return schema.validateStructuredOutput(output, sources);
}

function classifyAdapterError(err) {
  if (err && RECOVERABLE_ERRORS.has(err.code)) return { recoverable: true, reason: err.code };
  if (err && err.code === 'schema_violation') return { recoverable: false, reason: 'schema_violation' };
  return { recoverable: false, reason: 'model_unavailable' };
}

function timer(ms, onTimeout) {
  return setTimeout(onTimeout, ms);
}

const LIMIT_RULES = {
  callTimeoutMs: 1,
  jobDeadlineMs: 1,
  maxInputTokens: 1,
  maxOutputTokens: 1,
  maxDocuments: 1,
  maxPages: 1,
  maxRetries: 0,
  maxCostEurCents: 0,
  maxConcurrency: 1,
};

function validateLimits(raw) {
  const limits = { ...DEFAULT_EXTRACTION_LIMITS, ...(raw || {}) };
  const problems = [];
  for (const [key, minimum] of Object.entries(LIMIT_RULES)) {
    // null is the explicit "no budget configured" state, reported separately.
    if (key === 'maxCostEurCents' && limits[key] === null) continue;
    if (!Number.isInteger(limits[key])) problems.push(`${key} must be an integer`);
    else if (limits[key] < minimum) problems.push(`${key} must be at least ${minimum}`);
  }
  if (problems.length > 0) return { ok: false, reason: 'invalid_limits', problems, limits };
  if (!Number.isInteger(limits.maxCostEurCents)) return { ok: false, reason: 'budget_not_configured', limits };
  return { ok: true, limits };
}

function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil((text || '').length / 4);
}

function sourcePages(sources) {
  return (Array.isArray(sources) ? sources : []).reduce((sum, source) => sum + (source && Number.isInteger(source.pageCount) ? source.pageCount : 0), 0);
}

function reserveBudget(budget, maxCost) {
  if (!budget || typeof budget.reserve !== 'function' || typeof budget.settle !== 'function') {
    return { ok: false, reason: 'budget_guard_required' };
  }
  if (budget.costEurCents !== undefined && (!Number.isInteger(budget.costEurCents) || budget.costEurCents < 0)) {
    return { ok: false, reason: 'budget_exceeded' };
  }
  if (Number.isInteger(budget.costEurCents) && budget.costEurCents > maxCost) {
    return { ok: false, reason: 'budget_exceeded' };
  }
  let reservation;
  try {
    reservation = budget.reserve(maxCost);
  } catch {
    return { ok: false, reason: 'budget_exceeded' };
  }
  if (reservation === false || (reservation && reservation.ok === false)) return { ok: false, reason: 'budget_exceeded' };
  return { ok: true, maxCost, reservation };
}

/**
 * One bounded call. The adapter must already be configured by an approved
 * caller; this function still refuses absent adapters, invalid limits and
 * over-budget jobs. Timeout aborts the provider signal and invokes an optional
 * adapter.cancel() so a future provider cannot keep running invisibly.
 */
async function runStructuredExtraction({ adapter, protocol, sources, limits, budget } = {}) {
  if (!adapter || adapter.configured !== true || typeof adapter.extract !== 'function') {
    return { ok: false, reason: 'provider_not_configured' };
  }
  if (!protocol || !protocol.text || !protocol.hash) return { ok: false, reason: 'protocol_unavailable' };
  const checked = validateLimits(limits);
  if (!checked.ok) return { ok: false, reason: checked.reason, problems: checked.problems };
  const effective = checked.limits;
  const sourceList = Array.isArray(sources) ? sources : [];
  if (sourceList.length > effective.maxDocuments) return { ok: false, reason: 'document_limit' };
  if (sourcePages(sourceList) > effective.maxPages) return { ok: false, reason: 'page_limit' };
  if (estimateTokens(protocol.text) + estimateTokens(sourceList) > effective.maxInputTokens) return { ok: false, reason: 'input_limit' };

  const reservation = reserveBudget(budget, effective.maxCostEurCents);
  if (!reservation.ok) return { ok: false, reason: reservation.reason };

  const controller = new AbortController();
  let timeoutHandle;
  let timedOut = false;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = timer(effective.callTimeoutMs, () => {
      timedOut = true;
      controller.abort();
      if (typeof adapter.cancel === 'function') {
        try {
          adapter.cancel('timeout');
        } catch {
          // Cancellation is best-effort; the bounded timeout result still wins.
        }
      }
      reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
    });
  });
  try {
    const output = await Promise.race([
      adapter.extract({
        protocol: protocol.text,
        protocolHash: protocol.hash,
        schema: EXTRACTION_OUTPUT_SCHEMA,
        tools: [],
        sources: sourceList,
        limits: effective,
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (estimateTokens(output) > effective.maxOutputTokens) {
      if (typeof budget.settle === 'function') budget.settle(0);
      return { ok: false, reason: 'output_limit' };
    }
    if (output && output.coverage && Number.isInteger(output.coverage.pagesRead) && output.coverage.pagesRead > effective.maxPages) {
      if (typeof budget.settle === 'function') budget.settle(0);
      return { ok: false, reason: 'page_limit' };
    }
    const problems = validateStructuredOutput(output, sourceList);
    if (problems.length > 0) {
      if (typeof budget.settle === 'function') budget.settle(0);
      return { ok: false, reason: 'schema_violation', problems };
    }
    const actualCost = Number.isInteger(budget.costEurCents) ? budget.costEurCents : 0;
    if (actualCost > effective.maxCostEurCents) {
      if (typeof budget.settle === 'function') budget.settle(actualCost);
      return { ok: false, reason: 'budget_exceeded' };
    }
    if (typeof budget.settle === 'function') budget.settle(actualCost);
    return { ok: true, output, meta: { adapterVersion: adapter.version, provider: adapter.provider, model: adapter.model, instructionHash: protocol.hash, maxCostEurCents: effective.maxCostEurCents, actualCostEurCents: actualCost } };
  } catch (err) {
    if (typeof budget.settle === 'function') budget.settle(0);
    return { ok: false, ...(timedOut ? { recoverable: true, reason: 'timeout' } : classifyAdapterError(err)) };
  } finally {
    clearTimeout(timeoutHandle);
    if (!timedOut) controller.abort();
  }
}

/** Fields a validated AI result can carry that the current product concept cannot store. */
function unsupportedProductFields(output) {
  const unsupported = new Set();
  for (const menu of (output && Array.isArray(output.menus) && output.menus) || []) {
    for (const category of menu.categories || []) {
      for (const item of category.items || []) {
        if (Array.isArray(item.priceVariants) && item.priceVariants.length > 0) unsupported.add('priceVariants');
        if (item.isFrom === true) unsupported.add('isFrom');
        if (item.supplement) unsupported.add('supplement');
        // Unknown is not "allergen-free"; either state cannot be stored by the
        // current concept, so both are reported rather than silently dropped.
        if (item.allergens) unsupported.add('allergens');
        if (item.availability) unsupported.add('availability');
      }
    }
  }
  return [...unsupported];
}

module.exports = {
  PRICE_STATUSES,
  FORBIDDEN_TRUST_KEYS,
  RECOVERABLE_ERRORS,
  EXTRACTION_OUTPUT_SCHEMA,
  createStructuredExtractionAdapter,
  validateStructuredOutput,
  classifyAdapterError,
  runStructuredExtraction,
  unsupportedProductFields,
};
