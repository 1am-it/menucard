'use strict';

// Tiny, dependency-free guards for the existing v1 concept readers. They are
// imported by client-safe modules (`menuConcept.js`,
// `menuSnapshotProposals.js`) so the browser bundle never pulls in the full v2
// schema validator just to detect that a stored value is versioned.
//
// The full reader in `menuProductIntegrationV2.js` adds validation, a bounded
// view and refusal details. These guards only answer: may the v1 reader treat
// this value as legacy concept content? No versioned value may.

const CONCEPT_SCHEMA_KEY = 'schemaVersion';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function isUnsupportedConceptEnvelope(value) {
  if (!isObject(value)) return false;
  if (hasOwn(value, CONCEPT_SCHEMA_KEY)) return true;
  return Array.isArray(value.menus) && !Array.isArray(value.categories);
}

class UnsupportedProductSchemaError extends Error {
  constructor(message, productInfo) {
    super(message);
    this.name = 'UnsupportedProductSchemaError';
    this.code = 'unsupported_product_schema';
    this.productInfo = productInfo || null;
  }
}

function assertLegacyConceptContent(value) {
  if (!isUnsupportedConceptEnvelope(value)) return value;
  throw new UnsupportedProductSchemaError(
    'Deze menukaart gebruikt een versiegebonden of onbekende schemaversie; de v1-lezer mag hem niet afvlakken.',
    {
      kind: hasOwn(value, CONCEPT_SCHEMA_KEY) ? 'versioned' : 'invalid',
      schemaVersion: hasOwn(value, CONCEPT_SCHEMA_KEY) ? value.schemaVersion : null,
    }
  );
}

module.exports = {
  CONCEPT_SCHEMA_KEY,
  isUnsupportedConceptEnvelope,
  assertLegacyConceptContent,
  UnsupportedProductSchemaError,
};
