'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { extractCityFromComposedAddress, composeEvidenceBasedDescription } = require('./restaurantConceptDescription')

test('extractCityFromComposedAddress: extracts the locality after a Dutch postcode', () => {
  assert.equal(extractCityFromComposedAddress('Tolbrugstraat 19, 4811 WN Breda'), 'Breda')
})

test('extractCityFromComposedAddress: null when no Dutch postcode shape is present', () => {
  assert.equal(extractCityFromComposedAddress('Somewhere without a postcode'), null)
  assert.equal(extractCityFromComposedAddress(''), null)
  assert.equal(extractCityFromComposedAddress(null), null)
  assert.equal(extractCityFromComposedAddress(undefined), null)
})

test('composeEvidenceBasedDescription: a factual sentence when name, category, and a city are all present', () => {
  const result = composeEvidenceBasedDescription({
    name: 'De Botanist Breda',
    category: 'Restaurant',
    address: 'Tolbrugstraat 19, 4811 WN Breda',
  })
  assert.equal(result, 'De Botanist Breda is een restaurant in Breda.')
})

test('composeEvidenceBasedDescription: drops the city clause when the address has no extractable locality', () => {
  const result = composeEvidenceBasedDescription({ name: "Bobbi's Bar", category: 'Bar', address: null })
  assert.equal(result, "Bobbi's Bar is een bar.")
})

test('composeEvidenceBasedDescription: an unrecognized @type still produces a sentence, using the generic, honest horecazaak label', () => {
  const result = composeEvidenceBasedDescription({ name: 'De Markt', category: 'SomeUnknownType' })
  assert.equal(result, 'De Markt is een horecazaak.')
})

test('composeEvidenceBasedDescription: empty string, never a placeholder, when name is missing', () => {
  assert.equal(composeEvidenceBasedDescription({ name: '', category: 'Restaurant' }), '')
  assert.equal(composeEvidenceBasedDescription({ category: 'Restaurant' }), '')
})

test('composeEvidenceBasedDescription: empty string, never a placeholder, when category is missing', () => {
  assert.equal(composeEvidenceBasedDescription({ name: 'De Markt' }), '')
  assert.equal(composeEvidenceBasedDescription({}), '')
  assert.equal(composeEvidenceBasedDescription(), '')
})

test('composeEvidenceBasedDescription: never invents marketing language — output is exactly the fixed factual template, nothing appended', () => {
  const result = composeEvidenceBasedDescription({ name: 'Mr. Moos', category: 'CafeOrCoffeeShop', address: '4811 AB Breda' })
  assert.equal(result, 'Mr. Moos is een café in Breda.')
  assert.doesNotMatch(result, /heerlijk|geweldig|beste|top|amazing|delicious/i)
})

// ─── Structural safety net ────────────────────────────────────────────────

test('structural safety net: never calls out to an AI adapter, Supabase, or any I/O — pure string composition only', () => {
  const source = fs.readFileSync(require.resolve('./restaurantConceptDescription.js'), 'utf8')
  assert.doesNotMatch(source, /claudeStructuringAdapter|fetch\(|supabase/i)
})
