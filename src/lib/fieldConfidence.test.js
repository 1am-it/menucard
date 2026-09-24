'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const {
  ALLOWED_CONFIDENCE_TIERS,
  ALLOWED_EXTRACTION_METHODS,
  ALLOWED_FIELD_NAMES,
  checkFieldPlausibility,
  deriveFieldConfidence,
  isFieldReviewReady,
} = require('./fieldConfidence')

// ─── Fixed vocabularies ──────────────────────────────────────────────────

test('ALLOWED_CONFIDENCE_TIERS is exactly hoog/middel/laag', () => {
  assert.deepEqual(ALLOWED_CONFIDENCE_TIERS, ['hoog', 'middel', 'laag'])
})

test('ALLOWED_EXTRACTION_METHODS includes every BE-20 method plus the reserved future ocr value', () => {
  assert.deepEqual(ALLOWED_EXTRACTION_METHODS, ['json_ld', 'html', 'pdf_text', 'ai_structured', 'ocr'])
})

test('ALLOWED_FIELD_NAMES matches restaurantProfileDrafts.js\'s own allowlist exactly', () => {
  const { ALLOWED_DRAFT_FIELD_NAMES } = require('./restaurantProfileDrafts')
  assert.deepEqual(ALLOWED_FIELD_NAMES, ALLOWED_DRAFT_FIELD_NAMES)
})

// ─── checkFieldPlausibility ──────────────────────────────────────────────

test('checkFieldPlausibility: phone — a real Dutch mobile number is plausible', () => {
  assert.equal(checkFieldPlausibility('phone', '06 12345678'), true)
})

test('checkFieldPlausibility: phone — an obviously non-phone string is not plausible', () => {
  assert.equal(checkFieldPlausibility('phone', 'bel ons gerust'), false)
})

test('checkFieldPlausibility: website — a real http(s) URL is plausible', () => {
  assert.equal(checkFieldPlausibility('website', 'https://debotanistbreda.nl'), true)
})

test('checkFieldPlausibility: website — a non-URL string is not plausible', () => {
  assert.equal(checkFieldPlausibility('website', 'onze-website'), false)
})

test('checkFieldPlausibility: address — a string containing a recognizable NL postcode is plausible', () => {
  assert.equal(checkFieldPlausibility('address', 'Tolbrugstraat 19, 4811 WN Breda'), true)
})

test('checkFieldPlausibility: address — a string without any recognizable postcode is not plausible', () => {
  assert.equal(checkFieldPlausibility('address', 'ergens in het centrum'), false)
})

test('checkFieldPlausibility: name/category — a reasonable-length string is plausible', () => {
  assert.equal(checkFieldPlausibility('name', 'De Botanist Breda'), true)
  assert.equal(checkFieldPlausibility('category', 'Restaurant'), true)
})

test('checkFieldPlausibility: name/category — an empty or absurdly long string is not plausible', () => {
  assert.equal(checkFieldPlausibility('name', ''), false)
  assert.equal(checkFieldPlausibility('name', 'x'), false)
  assert.equal(checkFieldPlausibility('category', 'x'.repeat(500)), false)
})

test('checkFieldPlausibility: an unknown field name fails closed, never guessed at', () => {
  assert.equal(checkFieldPlausibility('opening_hours', 'ma-vr 12:00-22:00'), false)
})

test('checkFieldPlausibility: non-string or missing value is never plausible', () => {
  assert.equal(checkFieldPlausibility('name', null), false)
  assert.equal(checkFieldPlausibility('name', undefined), false)
  assert.equal(checkFieldPlausibility('name', 42), false)
})

// ─── deriveFieldConfidence ───────────────────────────────────────────────

test('deriveFieldConfidence: no content-hash at all is always middel, never hoog — for every extraction method, regardless of context status', () => {
  for (const method of ALLOWED_EXTRACTION_METHODS) {
    const confidence = deriveFieldConfidence({
      fieldName: 'phone',
      value: '06 12345678',
      extractionMethod: method,
      hasContentHash: false,
      contextStatus: 'consistent',
    })
    assert.equal(confidence, 'middel', `expected middel for method ${method} without content-hash`)
  }
})

test('deriveFieldConfidence: contextStatus "conflict" is always laag, regardless of plausibility', () => {
  const confidence = deriveFieldConfidence({
    fieldName: 'phone',
    value: '06 12345678',
    extractionMethod: 'json_ld',
    hasContentHash: true,
    contextStatus: 'conflict',
  })
  assert.equal(confidence, 'laag')
})

test('deriveFieldConfidence: contextStatus "unverified" is always at most middel, never hoog — even with a valid content-hash and a plausible value', () => {
  const confidence = deriveFieldConfidence({
    fieldName: 'phone',
    value: '06 12345678',
    extractionMethod: 'json_ld',
    hasContentHash: true,
    contextStatus: 'unverified',
  })
  assert.equal(confidence, 'middel')
})

test('deriveFieldConfidence: hoog requires content-hash + plausibility + contextStatus "consistent", for json_ld (deterministic method is never automatically hoog)', () => {
  const plausibleAndValidated = deriveFieldConfidence({
    fieldName: 'phone',
    value: '06 12345678',
    extractionMethod: 'json_ld',
    hasContentHash: true,
    contextStatus: 'consistent',
  })
  assert.equal(plausibleAndValidated, 'hoog')

  const implausibleDespiteHash = deriveFieldConfidence({
    fieldName: 'phone',
    value: 'niet een telefoonnummer',
    extractionMethod: 'json_ld',
    hasContentHash: true,
    contextStatus: 'consistent',
  })
  assert.equal(implausibleDespiteHash, 'middel')
})

test('deriveFieldConfidence: ai_structured never self-assigns hoog without the same plausibility check passing', () => {
  const confidence = deriveFieldConfidence({
    fieldName: 'website',
    value: 'not-a-url',
    extractionMethod: 'ai_structured',
    hasContentHash: true,
    contextStatus: 'consistent',
  })
  assert.equal(confidence, 'middel')
})

test('deriveFieldConfidence: the rule is uniform across html and pdf_text as well — same inputs, same outcome as json_ld', () => {
  const inputs = { fieldName: 'website', value: 'https://example.nl', hasContentHash: true, contextStatus: 'consistent' }
  const outcomes = ['json_ld', 'html', 'pdf_text', 'ai_structured'].map((extractionMethod) =>
    deriveFieldConfidence({ ...inputs, extractionMethod })
  )
  assert.deepEqual(outcomes, ['hoog', 'hoog', 'hoog', 'hoog'])
})

test('deriveFieldConfidence: throws on an unknown extraction_method — never silently accepted', () => {
  assert.throws(() =>
    deriveFieldConfidence({
      fieldName: 'phone',
      value: '06 12345678',
      extractionMethod: 'guessed',
      hasContentHash: true,
      contextStatus: 'consistent',
    })
  )
})

test('deriveFieldConfidence: throws on an unknown field_name — never silently accepted', () => {
  assert.throws(() =>
    deriveFieldConfidence({
      fieldName: 'opening_hours',
      value: 'ma-vr 12:00-22:00',
      extractionMethod: 'json_ld',
      hasContentHash: true,
      contextStatus: 'consistent',
    })
  )
})

test('deriveFieldConfidence: throws on an unknown context status — never silently accepted, never defaults to permissive', () => {
  assert.throws(() =>
    deriveFieldConfidence({
      fieldName: 'phone',
      value: '06 12345678',
      extractionMethod: 'json_ld',
      hasContentHash: true,
      contextStatus: 'maybe',
    }),
    /Unknown context status/
  )
  assert.throws(() =>
    deriveFieldConfidence({
      fieldName: 'phone',
      value: '06 12345678',
      extractionMethod: 'json_ld',
      hasContentHash: true,
      contextStatus: undefined,
    }),
    /Unknown context status/
  )
})

// ─── isFieldReviewReady ──────────────────────────────────────────────────

test('isFieldReviewReady: true for hoog with a content-hash', () => {
  assert.equal(isFieldReviewReady({ hasContentHash: true, confidence: 'hoog' }), true)
})

test('isFieldReviewReady: true for middel with a content-hash (still reviewable, just not automatically trusted)', () => {
  assert.equal(isFieldReviewReady({ hasContentHash: true, confidence: 'middel' }), true)
})

test('isFieldReviewReady: false for laag, even with a content-hash — needs handmatige beoordeling', () => {
  assert.equal(isFieldReviewReady({ hasContentHash: true, confidence: 'laag' }), false)
})

test('isFieldReviewReady: false without a content-hash, regardless of confidence', () => {
  assert.equal(isFieldReviewReady({ hasContentHash: false, confidence: 'hoog' }), false)
})

test('isFieldReviewReady: throws on an unknown confidence tier', () => {
  assert.throws(() => isFieldReviewReady({ hasContentHash: true, confidence: 'onbekend' }))
})

// ─── Structural safety net ───────────────────────────────────────────────

test('structural safety net: fieldConfidence.js never imports node:crypto or touches Supabase/DOM — must stay safely client-importable', () => {
  const source = fs.readFileSync(require.resolve('./fieldConfidence.js'), 'utf8')
  assert.doesNotMatch(source, /node:crypto/)
  assert.doesNotMatch(source, /supabase/i)
  assert.doesNotMatch(source, /document\.|window\./)
})
