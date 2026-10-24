'use strict';

// Injectable, default-disabled runtime hook for the real import chain. A caller
// provides a provider-neutral adapter only after provider, budget and data
// terms are approved. Without an adapter the hook returns enabled:false and
// never reads a key, fetches a source or calls a provider.

const { runStructuredExtraction, unsupportedProductFields } = require('./menuExtractionAdapter');
const { loadMenuExtractionProtocol } = require('./menuExtractionProtocol');
const { mapStructuredOutputToMenuContexts } = require('./menuExtractionMapping');

function createMenuExtractionRuntime({ adapter, protocol, limits, budget } = {}) {
  let pinned = protocol || null;
  return async function structuredExtraction({ sources, restaurantFields } = {}) {
    if (!adapter || adapter.configured !== true) {
      return { enabled: false, reason: 'provider_not_configured' };
    }
    try {
      pinned = pinned || loadMenuExtractionProtocol();
    } catch {
      return { enabled: true, ok: false, reason: 'protocol_unavailable' };
    }
    const sourceList = Array.isArray(sources) ? sources : [];
    const result = await runStructuredExtraction({
      adapter,
      protocol: pinned,
      sources: sourceList,
      limits,
      budget,
    });
    if (!result.ok) return { enabled: true, ...result };
    const unsupported = unsupportedProductFields(result.output);
    if (unsupported.length > 0) {
      return { enabled: true, ok: false, reason: 'unsupported_product_fields', unsupported, meta: result.meta };
    }
    return {
      enabled: true,
      ok: true,
      menus: mapStructuredOutputToMenuContexts(result.output, sourceList),
      meta: result.meta,
      restaurantFields: restaurantFields || null,
    };
  };
}

/** Explicit disabled runtime for the current build: no adapter is configured. */
function disabledMenuExtractionRuntime() {
  return async function disabledStructuredExtraction() {
    return { enabled: false, reason: 'provider_not_configured' };
  };
}

module.exports = { createMenuExtractionRuntime, disabledMenuExtractionRuntime };
