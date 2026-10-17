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

const PRICE_STATUSES = ['known', 'multiple_undecomposed', 'on_request', 'unknown'];
const FORBIDDEN_TRUST_KEYS = ['confidence', 'reviewReady', 'approved', 'publicationReady'];
const MAX_ITEMS = 1000;
const MAX_SECTIONS = 100;
const MAX_TEXT = 500;

const RECOVERABLE_ERRORS = new Set(['timeout', 'rate_limited', 'provider_unavailable']);
const EXTRACTION_OUTPUT_SCHEMA = Object.freeze({
  version: 'menu-extraction-output/v1',
  topLevel: ['menus', 'rejected', 'coverage'],
  forbiddenTrustKeys: FORBIDDEN_TRUST_KEYS,
  allowedTools: [],
});

function createStructuredExtractionAdapter({ provider, model, call } = {}) {
  return {
    configured: typeof call === 'function',
    provider: typeof provider === 'string' ? provider : null,
    model: typeof model === 'string' ? model : null,
    version: typeof provider === 'string' && typeof model === 'string' ? `${provider}/${model}` : null,
    extract: typeof call === 'function' ? call : null,
  };
}

function findForbiddenKey(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenKey(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_TRUST_KEYS.includes(key)) return key;
    const found = findForbiddenKey(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

function text(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Validates the model's declared shape. `sources` is the source inventory the
 * backend already fetched; every source reference must point into it.
 */
function validateStructuredOutput(output, sources) {
  const problems = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) return ['output must be an object'];
  const forbidden = findForbiddenKey(output);
  if (forbidden) problems.push(`forbidden trust key: ${forbidden}`);
  const allowedTop = new Set(['menus', 'rejected', 'coverage']);
  for (const key of Object.keys(output)) if (!allowedTop.has(key)) problems.push(`unknown top-level field: ${key}`);
  const sourceIds = new Set((Array.isArray(sources) ? sources : []).map((s) => s && s.id).filter(Boolean));
  if (!Array.isArray(output.menus)) return ['menus must be an array'];
  if (output.menus.length > MAX_SECTIONS) problems.push(`more than ${MAX_SECTIONS} menus`);
  let itemCount = 0;
  output.menus.forEach((menu, m) => {
    if (!menu || typeof menu !== 'object') return problems.push(`menus[${m}] must be an object`);
    if (!text(menu.title)) problems.push(`menus[${m}].title is required`);
    if (!text(menu.sourceId) || !sourceIds.has(menu.sourceId)) problems.push(`menus[${m}].sourceId must reference the source inventory`);
    if (!Array.isArray(menu.categories)) return problems.push(`menus[${m}].categories must be an array`);
    menu.categories.forEach((category, c) => {
      if (!category || typeof category !== 'object') return problems.push(`menus[${m}].categories[${c}] must be an object`);
      if (!text(category.name)) problems.push(`menus[${m}].categories[${c}].name is required`);
      if (!Array.isArray(category.items)) return problems.push(`menus[${m}].categories[${c}].items must be an array`);
      category.items.forEach((item, i) => {
        itemCount += 1;
        const where = `menus[${m}].categories[${c}].items[${i}]`;
        if (!item || typeof item !== 'object') return problems.push(`${where} must be an object`);
        if (!text(item.name)) problems.push(`${where}.name is required`);
        if (!PRICE_STATUSES.includes(item.priceStatus)) problems.push(`${where}.priceStatus is invalid`);
        if (item.priceStatus === 'known' && !(Number.isInteger(item.amountMinorUnits) && item.amountMinorUnits >= 0)) {
          problems.push(`${where}.amountMinorUnits must be a non-negative integer for a known price`);
        }
        if (item.priceStatus !== 'known' && item.amountMinorUnits !== undefined && item.amountMinorUnits !== null) {
          problems.push(`${where}.amountMinorUnits must be absent/null unless known`);
        }
        if (item.evidence && (!text(item.evidence.sourceId) || !sourceIds.has(item.evidence.sourceId) || !text(item.evidence.locator))) {
          problems.push(`${where}.evidence must reference a source and locator`);
        }
        if (!item.evidence) problems.push(`${where}.evidence is required`);
      });
    });
  });
  if (itemCount > MAX_ITEMS) problems.push(`more than ${MAX_ITEMS} items`);
  if (output.rejected !== undefined && !Array.isArray(output.rejected)) problems.push('rejected must be an array');
  return problems;
}

function classifyAdapterError(err) {
  if (err && RECOVERABLE_ERRORS.has(err.code)) return { recoverable: true, reason: err.code };
  if (err && err.code === 'schema_violation') return { recoverable: false, reason: 'schema_violation' };
  return { recoverable: false, reason: 'model_unavailable' };
}

function timer(ms, onTimeout) {
  return setTimeout(onTimeout, ms);
}

/**
 * One bounded call. The adapter must already be configured by an approved
 * caller; this function still refuses absent adapters and over-budget jobs.
 */
async function runStructuredExtraction({ adapter, protocol, sources, limits, budget } = {}) {
  if (!adapter || adapter.configured !== true || typeof adapter.extract !== 'function') {
    return { ok: false, reason: 'provider_not_configured' };
  }
  if (!protocol || !protocol.text || !protocol.hash) return { ok: false, reason: 'protocol_unavailable' };
  const effective = { ...DEFAULT_EXTRACTION_LIMITS, ...(limits || {}) };
  const sourceList = Array.isArray(sources) ? sources : [];
  if (sourceList.length > effective.maxDocuments) return { ok: false, reason: 'document_limit' };
  if (budget && Number.isInteger(budget.costEurCents) && effective.maxCostEurCents !== null && budget.costEurCents > effective.maxCostEurCents) {
    return { ok: false, reason: 'budget_exceeded' };
  }
  if (!Number.isInteger(effective.maxCostEurCents)) return { ok: false, reason: 'budget_not_configured' };

  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = timer(effective.callTimeoutMs, () => reject(Object.assign(new Error('timeout'), { code: 'timeout' })));
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
      }),
      timeout,
    ]);
    const problems = validateStructuredOutput(output, sourceList);
    if (problems.length > 0) return { ok: false, reason: 'schema_violation', problems };
    return { ok: true, output, meta: { adapterVersion: adapter.version, provider: adapter.provider, model: adapter.model, instructionHash: protocol.hash } };
  } catch (err) {
    return { ok: false, ...classifyAdapterError(err) };
  } finally {
    clearTimeout(timeoutHandle);
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
