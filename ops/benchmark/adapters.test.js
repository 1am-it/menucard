'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildFixture } = require('./fixtures')
const {
  ADAPTER_KINDS,
  createDeterministicAdapter,
  createUnavailableAdapter,
  assertNeverCarriesPrecomputedConfidence,
} = require('./adapters')

test('createUnavailableAdapter: ai_structured and ocr always resolve available: false, never a fabricated result', async () => {
  for (const kind of ['ai_structured', 'ocr']) {
    const adapter = createUnavailableAdapter(kind)
    assert.equal(adapter.available, false)
    const result = await adapter.run({})
    assert.equal(result.available, false)
    assert.equal(result.kind, kind)
    assert.deepEqual(result.fields, {})
    assert.equal(result.unknownMenuContextCount, 0)
  }
})

test('createUnavailableAdapter: refuses to be constructed for "deterministic" or an unknown kind', () => {
  assert.throws(() => createUnavailableAdapter('deterministic'))
  assert.throws(() => createUnavailableAdapter('made_up'))
})

test('deterministic adapter: never carries a precomputed confidence or reviewReady value on any field', async () => {
  const adapter = createDeterministicAdapter()
  const fixture = buildFixture('synthetic-html-full-consistent')
  const result = await adapter.run(fixture)
  assert.doesNotThrow(() => assertNeverCarriesPrecomputedConfidence(result))
  for (const evidence of Object.values(result.fields)) {
    assert.equal('confidence' in evidence, false)
    assert.equal('reviewReady' in evidence, false)
    // Only the raw inputs BE-20's own deriveFieldConfidence needs.
    assert.ok('value' in evidence)
    assert.ok('extractionMethod' in evidence)
    assert.ok('hasContentHash' in evidence)
    assert.ok('contextStatus' in evidence)
  }
})

test('assertNeverCarriesPrecomputedConfidence: throws if a result is tampered with to carry a confidence value', () => {
  const tampered = { fields: { name: { value: 'x', confidence: 'hoog' } } }
  assert.throws(() => assertNeverCarriesPrecomputedConfidence(tampered), /confidence/)
})

test('deterministic adapter: a digital-PDF-entry fixture produces exactly one unknown menu context and zero fields', async () => {
  const adapter = createDeterministicAdapter()
  const fixture = buildFixture('local-be20-digital-pdf-valid')
  const result = await adapter.run(fixture)
  assert.deepEqual(result.fields, {})
  assert.equal(result.unknownMenuContextCount, 1)
  assert.equal(result.errors.length, 0)
})

test('deterministic adapter: an encrypted-PDF-entry fixture reports the raw pdf_encrypted error, never a silent empty success', async () => {
  const adapter = createDeterministicAdapter()
  const fixture = buildFixture('local-be20-digital-pdf-encrypted')
  const result = await adapter.run(fixture)
  assert.deepEqual(result.errors, [{ code: 'pdf_encrypted' }])
  assert.equal(result.unknownMenuContextCount, 0)
})

test('deterministic adapter: a no-text-layer PDF fixture reports pdf_no_text_layer, never a trigger for OCR', async () => {
  const adapter = createDeterministicAdapter()
  const fixture = buildFixture('local-be20-scanned-pdf-no-text-layer')
  const result = await adapter.run(fixture)
  assert.deepEqual(result.errors, [{ code: 'pdf_no_text_layer' }])
})

test('deterministic adapter: a javascript-dependent fixture with no server-rendered content yields zero fields and zero menus — never fabricated', async () => {
  const adapter = createDeterministicAdapter()
  const fixture = buildFixture('synthetic-html-javascript-dependent-empty')
  const result = await adapter.run(fixture)
  assert.deepEqual(result.fields, {})
  assert.deepEqual(result.menuContextNames, [])
  assert.equal(result.unknownMenuContextCount, 0)
})

test('ADAPTER_KINDS is exactly ["deterministic", "ai_structured", "ocr"]', () => {
  assert.deepEqual(ADAPTER_KINDS, ['deterministic', 'ai_structured', 'ocr'])
})
