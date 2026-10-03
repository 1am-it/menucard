'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  MENU_EXTRACTION_CONTRACT_VERSION,
  MENU_ADAPTER_KINDS,
  PRICE_STATUSES,
  REJECTION_REASONS,
  emptyCost,
  findForbiddenTrustKey,
  TRUST_SCAN_MAX_DEPTH,
  TRUST_SCAN_MAX_NODES,
  validateMenuExtraction,
} = require('./menuExtractionContract')
const { ADAPTER_KINDS } = require('./adapters')

function validResult() {
  return {
    contractVersion: MENU_EXTRACTION_CONTRACT_VERSION,
    status: 'parsed',
    reason: null,
    sections: [
      {
        path: ['Fictieve kaart'],
        items: [
          { name: 'Fictief broodje', priceStatus: 'known', amountMinorUnits: 650, currency: 'EUR', description: null, evidence: { pattern: 'list_item', locator: 'ul>li' } },
          { name: 'Fictieve wijn', priceStatus: 'multiple_undecomposed', amountMinorUnits: null, currency: null, description: null, evidence: { pattern: 'table_row', locator: 'tr' } },
          { name: 'Fictieve vis', priceStatus: 'on_request', amountMinorUnits: null, currency: null, description: 'Fictief', evidence: { pattern: 'model_quote', locator: 'p' } },
        ],
      },
    ],
    rejected: [{ text: 'ma t/m vr 12.00 - 22.00', reason: 'clock_time', locator: 'ul>li[2]' }],
    cost: emptyCost(),
  }
}

test('a well-formed result is valid', () => {
  assert.deepEqual(validateMenuExtraction(validResult()), [])
})

test('money states are exactly MARKET-02\'s four', () => {
  assert.deepEqual(PRICE_STATUSES, ['known', 'multiple_undecomposed', 'on_request', 'unknown'])
})

test('the ai_structured kind is the one adapters.js already reserves; ADAPTER_KINDS stays unchanged', () => {
  assert.ok(ADAPTER_KINDS.includes('ai_structured'))
  assert.ok(MENU_ADAPTER_KINDS.includes('ai_structured'))
  assert.ok(!ADAPTER_KINDS.includes('html_structure'))
})

test('emptyCost: every cost field is null — never a fabricated figure', () => {
  assert.deepEqual(emptyCost(), { costEurCents: null, inputTokens: null, outputTokens: null })
})

test('confidence or reviewReady anywhere is invalid', () => {
  const onResult = { ...validResult(), confidence: 'hoog' }
  const onSection = validResult()
  onSection.sections[0].reviewReady = true
  const onItem = validResult()
  onItem.sections[0].items[0].confidence = 'hoog'
  for (const result of [onResult, onSection, onItem]) assert.ok(validateMenuExtraction(result).length > 0)
})

test('a known price needs an integer amount; other states never carry one', () => {
  const noAmount = validResult()
  noAmount.sections[0].items[0].amountMinorUnits = 6.5
  const amountOnDual = validResult()
  amountOnDual.sections[0].items[1].amountMinorUnits = 550
  const currencyOnRequest = validResult()
  currencyOnRequest.sections[0].items[2].currency = 'EUR'
  const foreignCurrency = validResult()
  foreignCurrency.sections[0].items[0].currency = 'USD'
  for (const result of [noAmount, amountOnDual, currencyOnRequest, foreignCurrency]) assert.ok(validateMenuExtraction(result).length > 0)
})

test('an invented price state or rejection reason is invalid', () => {
  const state = validResult()
  state.sections[0].items[0].priceStatus = 'approximate'
  const reason = validResult()
  reason.rejected[0].reason = 'looks_odd'
  assert.ok(validateMenuExtraction(state).length > 0)
  assert.ok(validateMenuExtraction(reason).length > 0)
  assert.ok(REJECTION_REASONS.includes('clock_time'))
})

test('every item needs evidence with a known pattern and a short locator', () => {
  const missing = validResult()
  delete missing.sections[0].items[0].evidence
  const unknownPattern = validResult()
  unknownPattern.sections[0].items[0].evidence.pattern = 'guess'
  assert.ok(validateMenuExtraction(missing).length > 0)
  assert.ok(validateMenuExtraction(unknownPattern).length > 0)
})

test('long text is rejected so a result cannot smuggle bulk source text', () => {
  const longName = validResult()
  longName.sections[0].items[0].name = 'x'.repeat(500)
  const longDescription = validResult()
  longDescription.sections[0].items[0].description = 'x'.repeat(500)
  assert.ok(validateMenuExtraction(longName).length > 0)
  assert.ok(validateMenuExtraction(longDescription).length > 0)
})

test('an unparsed result needs a reason and carries no sections', () => {
  const noReason = { ...validResult(), status: 'unparsed', reason: null, sections: [] }
  const withSections = { ...validResult(), status: 'unparsed', reason: 'too_few_items' }
  assert.ok(validateMenuExtraction(noReason).length > 0)
  assert.ok(validateMenuExtraction(withSections).length > 0)
  assert.deepEqual(validateMenuExtraction({ ...validResult(), status: 'unparsed', reason: 'too_few_items', sections: [] }), [])
})

test('cost must be present; non-null cost must be a non-negative integer', () => {
  const missing = validResult()
  delete missing.cost
  const negative = validResult()
  negative.cost.costEurCents = -1
  assert.ok(validateMenuExtraction(missing).length > 0)
  assert.ok(validateMenuExtraction(negative).length > 0)
})

test('never throws on garbage input', () => {
  for (const input of [undefined, null, 42, 'menu', [], { status: 'parsed' }]) {
    assert.ok(Array.isArray(validateMenuExtraction(input)))
    assert.ok(validateMenuExtraction(input).length > 0)
  }
})

// ─── M3: the trust-key ban is recursive, bounded and cycle-safe ───────────

test('M3: confidence/reviewReady is invalid at any depth — evidence, rejected, stats, cost, arrays', () => {
  const mutations = [
    (r) => { r.sections[0].items[0].evidence.confidence = 'hoog' },
    (r) => { r.rejected[0].reviewReady = true },
    (r) => { r.stats = { counted: 3, confidence: 1 } },
    (r) => { r.cost.reviewReady = false },
    (r) => { r.sections[0].path = ['Fictief'], r.sections[0].extra = [[{ deeper: { confidence: 'laag' } }]] },
  ]
  for (const mutate of mutations) {
    const result = validResult()
    mutate(result)
    const problems = validateMenuExtraction(result)
    assert.equal(problems.length, 1, JSON.stringify(problems))
    assert.match(problems[0], /forbidden at any depth/)
  }
})

test('M3: findForbiddenTrustKey reports the path; clean structures, primitives and shared references pass', () => {
  assert.equal(findForbiddenTrustKey(validResult()), null)
  assert.equal(findForbiddenTrustKey(null), null)
  assert.equal(findForbiddenTrustKey('confidence'), null)
  assert.equal(findForbiddenTrustKey({ notes: ['confidence is a word, not a key'] }), null)
  const shared = { a: 1 }
  assert.equal(findForbiddenTrustKey({ x: shared, y: shared, z: [shared, shared] }), null)
  assert.equal(findForbiddenTrustKey({ a: [{ b: { reviewReady: true } }] }), '$.a[0].b.reviewReady is forbidden')
})

test('M3: a cyclic structure is a violation, never an endless loop', () => {
  const cyclic = validResult()
  cyclic.stats = {}
  cyclic.sections[0].items[0].evidence.self = cyclic
  assert.match(findForbiddenTrustKey(cyclic), /cyclic structure/)
  assert.ok(validateMenuExtraction(cyclic).length > 0)
})

test('M3: an over-deep or over-large structure is a violation, never a stack overflow', () => {
  let deep = {}
  const top = deep
  for (let i = 0; i < 100000; i += 1) deep = deep.next = {}
  assert.match(findForbiddenTrustKey(top), new RegExp(`deeper than ${TRUST_SCAN_MAX_DEPTH}`))
  const wide = { list: Array.from({ length: TRUST_SCAN_MAX_NODES + 10 }, () => ({})) }
  assert.match(findForbiddenTrustKey(wide), /more than/)
})

test('M3: a getter that throws is a violation, never a crash', () => {
  const hostile = validResult()
  Object.defineProperty(hostile, 'trap', { enumerable: true, get() { throw new Error('boom') } })
  assert.equal(findForbiddenTrustKey(hostile), 'structure could not be inspected')
})

test('M3: rejected[].locator follows the evidence-locator rule; stats must be flat counters/flags', () => {
  const noLocator = validResult()
  delete noLocator.rejected[0].locator
  const longLocator = validResult()
  longLocator.rejected[0].locator = 'x'.repeat(500)
  const badStats = { ...validResult(), stats: { counted: -1 } }
  const nestedStats = { ...validResult(), stats: { inner: { a: 1 } } }
  for (const result of [noLocator, longLocator, badStats, nestedStats]) assert.ok(validateMenuExtraction(result).length > 0)
  assert.deepEqual(validateMenuExtraction({ ...validResult(), stats: { counted: 3, depthLimited: false } }), [])
})
