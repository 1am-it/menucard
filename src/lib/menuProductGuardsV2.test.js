'use strict';

// The tiny client-safe guard: detects a versioned/v2-shaped value without
// pulling in the full schema validator. It never flattens and never guesses.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isUnsupportedConceptEnvelope, assertLegacyConceptContent, UnsupportedProductSchemaError } = require('./menuProductGuardsV2');

test('legacy v1 concept content is accepted; any versioned or v2-shaped value is not', () => {
  assert.equal(isUnsupportedConceptEnvelope({ title: 'Fictief', categories: [] }), false);
  assert.equal(isUnsupportedConceptEnvelope({ schemaVersion: 'menu-extraction-product/v2', menus: [] }), true);
  assert.equal(isUnsupportedConceptEnvelope({ menus: [{ categories: [] }] }), true);
  assert.equal(isUnsupportedConceptEnvelope(null), false);
  assert.equal(isUnsupportedConceptEnvelope([]), false);
});

test('the guard throws one typed error with a shallow reason', () => {
  assert.throws(() => assertLegacyConceptContent({ schemaVersion: 'menu-extraction-product/v2', menus: [] }), (error) => {
    assert.ok(error instanceof UnsupportedProductSchemaError);
    assert.equal(error.code, 'unsupported_product_schema');
    assert.equal(error.productInfo.kind, 'versioned');
    assert.equal(error.productInfo.schemaVersion, 'menu-extraction-product/v2');
    return true;
  });
  assert.doesNotThrow(() => assertLegacyConceptContent({ title: 'Fictief', categories: [] }));
});

test('the guard module stays client-safe: no require at all', () => {
  const source = fs.readFileSync(path.join(__dirname, 'menuProductGuardsV2.js'), 'utf8');
  assert.doesNotMatch(source, /require\(/);
});
