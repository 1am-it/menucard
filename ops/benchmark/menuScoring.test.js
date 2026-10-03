'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { scoreMenuCase, aggregateMenuScores } = require('./menuScoring')
const { MENU_EXTRACTION_CONTRACT_VERSION, emptyCost } = require('./menuExtractionContract')

function item(name, priceStatus, amountMinorUnits) {
  return {
    name,
    priceStatus,
    amountMinorUnits,
    currency: priceStatus === 'known' ? 'EUR' : null,
    description: null,
    evidence: { pattern: 'list_item', locator: 'ul>li' },
  }
}

function parsed(sections, rejected = []) {
  return { menuExtraction: { contractVersion: MENU_EXTRACTION_CONTRACT_VERSION, status: 'parsed', reason: null, sections, rejected, stats: {}, cost: emptyCost() } }
}

const menuCase = {
  id: 'synthetic',
  expected: {
    isMenu: true,
    items: [
      ['Kaart', 'Fictief a', 'known', 450],
      ['Kaart', 'Fictief b', 'known', 500],
      ['Kaart', 'Fictief c', 'multiple_undecomposed', null],
    ],
    rejectedReasons: ['modifier'],
  },
}

test('a perfect result scores precision 1, recall 1 and no errors', () => {
  const result = parsed([{ path: ['Kaart'], items: [item('Fictief a', 'known', 450), item('Fictief b', 'known', 500), item('Fictief c', 'multiple_undecomposed', null)] }], [
    { text: '+ extra fictief', reason: 'modifier' },
  ])
  const score = scoreMenuCase(menuCase, result)
  assert.equal(score.status, 'scored')
  assert.equal(score.precision, 1)
  assert.equal(score.recall, 1)
  assert.equal(score.wrongPrices, 0)
  assert.equal(score.wrongSections, 0)
  assert.equal(score.reviewLoad, 4)
  assert.deepEqual(score.missingRejectionReasons, [])
  assert.deepEqual(score.cost, emptyCost())
})

test('wrong prices, wrong sections, false positives and misses are counted separately', () => {
  const result = parsed([
    { path: ['Kaart'], items: [item('Fictief a', 'known', 999), item('Fictief extra', 'known', 100)] },
    { path: ['Anders'], items: [item('Fictief b', 'known', 500)] },
  ])
  const score = scoreMenuCase(menuCase, result)
  assert.equal(score.truePositives, 2)
  assert.equal(score.falsePositives, 1)
  assert.equal(score.falseNegatives, 1)
  assert.equal(score.wrongPrices, 1)
  assert.equal(score.wrongSections, 1)
  assert.deepEqual(score.missedNames, ['Fictief c'])
  assert.deepEqual(score.missingRejectionReasons, ['modifier'])
})

test('a dual price collapsed into one amount is a wrong price', () => {
  const result = parsed([{ path: ['Kaart'], items: [item('Fictief a', 'known', 450), item('Fictief b', 'known', 500), item('Fictief c', 'known', 550)] }])
  assert.equal(scoreMenuCase(menuCase, result).wrongPrices, 1)
})

test('a parsed non-menu is a false menu; an unparsed menu is a missed menu', () => {
  const nonMenu = { id: 'n', expected: { isMenu: false, items: [] } }
  const falseMenu = scoreMenuCase(nonMenu, parsed([{ path: ['Openingstijden'], items: [item('Fictief maandag', 'known', 1200)] }]))
  assert.equal(falseMenu.falseMenu, true)
  assert.equal(falseMenu.falsePositives, 1)
  const unparsed = { menuExtraction: { contractVersion: MENU_EXTRACTION_CONTRACT_VERSION, status: 'unparsed', reason: 'too_few_items', sections: [], rejected: [], cost: emptyCost() } }
  const missed = scoreMenuCase(menuCase, unparsed)
  assert.equal(missed.missedMenu, true)
  assert.equal(missed.recall, 0)
  assert.equal(missed.precision, null)
})

test('a contract-breaking result is invalid_output, never partially scored', () => {
  const result = parsed([{ path: ['Kaart'], items: [{ ...item('Fictief a', 'known', 450), confidence: 'hoog' }] }])
  const score = scoreMenuCase(menuCase, result)
  assert.equal(score.status, 'invalid_output')
  assert.ok(score.problems.length > 0)
  assert.equal(score.precision, undefined)
  assert.equal(scoreMenuCase(menuCase, {}).status, 'invalid_output')
})

test('a full heading path mismatch is a wrong section when the case lists one', () => {
  const withPath = { ...menuCase, expected: { ...menuCase.expected, paths: { 'Fictief a': ['Dranken', 'Kaart'] } } }
  const result = parsed([{ path: ['Eten', 'Kaart'], items: [item('Fictief a', 'known', 450), item('Fictief b', 'known', 500), item('Fictief c', 'multiple_undecomposed', null)] }])
  assert.equal(scoreMenuCase(withPath, result).wrongSections, 1)
})

test('aggregateMenuScores: one bucket per (sourceType, adapterKind); not_evaluated and invalid never blended in', () => {
  const good = scoreMenuCase(menuCase, parsed([{ path: ['Kaart'], items: [item('Fictief a', 'known', 450)] }]), { timingMs: 2 })
  const buckets = aggregateMenuScores([
    { sourceType: 'html_only', adapterKind: 'html_structure', ...good },
    { sourceType: 'html_only', adapterKind: 'html_structure', ...scoreMenuCase(menuCase, {}) },
    { sourceType: 'html_only', adapterKind: 'ai_structured', caseId: 'x', status: 'not_evaluated' },
    { sourceType: 'other', adapterKind: 'html_structure', ...good },
  ])
  assert.equal(buckets.length, 3)
  const main = buckets.find((b) => b.sourceType === 'html_only' && b.adapterKind === 'html_structure')
  assert.equal(main.scoredCaseCount, 1)
  assert.equal(main.invalidOutputCaseCount, 1)
  assert.equal(main.precision, 1)
  assert.equal(main.recall, 1 / 3)
  assert.equal(main.medianTimingMs, 2)
  assert.equal(main.costEurCents, null)
  const ai = buckets.find((b) => b.adapterKind === 'ai_structured')
  assert.equal(ai.notEvaluatedCaseCount, 1)
  assert.equal(ai.scoredCaseCount, 0)
  assert.equal(ai.precision, null)
})

test('never derives or reports confidence/reviewReady', () => {
  const score = scoreMenuCase(menuCase, parsed([{ path: ['Kaart'], items: [item('Fictief a', 'known', 450)] }]))
  assert.ok(!/confidence|reviewReady/.test(JSON.stringify(score)))
  assert.ok(!/confidence|reviewReady/.test(JSON.stringify(aggregateMenuScores([{ sourceType: 's', adapterKind: 'k', ...score }]))))
})
