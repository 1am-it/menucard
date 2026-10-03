'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { runMenuBenchmark, MENU_SOURCE_TYPE } = require('./menuBenchmark')
const { createHtmlStructureAdapter } = require('./htmlMenuStructure')
const { createUnavailableAdapter, assertNeverCarriesPrecomputedConfidence } = require('./adapters')
const { HTML_MENU_CASES } = require('./htmlMenuFixtures')
const { aggregateMenuScores } = require('./menuScoring')
const { buildMachineReadableReport, buildHumanReadableSummary, MENU_TRACK_DISCLAIMER } = require('./report')
const { stripTimingForComparison } = require('./runner')

function adapters() {
  return [createHtmlStructureAdapter(), createUnavailableAdapter('ai_structured')]
}

test('runMenuBenchmark: every case × adapter is recorded, under the html_only source type', async () => {
  const { menuCaseScores } = await runMenuBenchmark({ adapters: adapters() })
  assert.equal(menuCaseScores.length, HTML_MENU_CASES.length * 2)
  assert.ok(menuCaseScores.every((s) => s.sourceType === MENU_SOURCE_TYPE))
})

test('runMenuBenchmark: the ai_structured stub is not_evaluated for every case, never scored', async () => {
  const { menuCaseScores } = await runMenuBenchmark({ adapters: adapters() })
  const ai = menuCaseScores.filter((s) => s.adapterKind === 'ai_structured')
  assert.equal(ai.length, HTML_MENU_CASES.length)
  assert.ok(ai.every((s) => s.status === 'not_evaluated' && s.precision === undefined))
})

test('runMenuBenchmark: html_structure finds no false menus and no wrong prices on the synthetic set', async () => {
  const { menuCaseScores } = await runMenuBenchmark({ adapters: adapters() })
  const [bucket] = aggregateMenuScores(menuCaseScores.filter((s) => s.adapterKind === 'html_structure'))
  assert.equal(bucket.scoredCaseCount, HTML_MENU_CASES.length)
  assert.equal(bucket.invalidOutputCaseCount, 0)
  assert.equal(bucket.falseMenus, 0)
  assert.equal(bucket.missedMenus, 0)
  assert.equal(bucket.wrongPrices, 0)
  assert.equal(bucket.falsePositives, 0)
  assert.equal(bucket.costEurCents, null)
})

test('runMenuBenchmark: an adapter that smuggles confidence throws before scoring', async () => {
  const cheating = {
    kind: 'html_structure',
    available: true,
    async run(fixture) {
      const result = await createHtmlStructureAdapter().run(fixture)
      if (result.menuExtraction.sections[0]) result.menuExtraction.sections[0].items[0].reviewReady = true
      return result
    },
  }
  await assert.rejects(() => runMenuBenchmark({ cases: [HTML_MENU_CASES[0]], adapters: [cheating] }), /confidence\/reviewReady/)
})

test('assertNeverCarriesPrecomputedConfidence: covers the menu result, its sections and items; ignores results without one', () => {
  const base = () => ({ fields: {}, menuExtraction: { sections: [{ path: [], items: [{ name: 'Fictief' }] }] } })
  assert.doesNotThrow(() => assertNeverCarriesPrecomputedConfidence(base()))
  assert.doesNotThrow(() => assertNeverCarriesPrecomputedConfidence({ fields: {} }))
  const onMenu = base()
  onMenu.menuExtraction.confidence = 'hoog'
  const onSection = base()
  onSection.menuExtraction.sections[0].confidence = 'hoog'
  const onItem = base()
  onItem.menuExtraction.sections[0].items[0].reviewReady = true
  for (const result of [onMenu, onSection, onItem]) assert.throws(() => assertNeverCarriesPrecomputedConfidence(result))
})

test('runMenuBenchmark: deterministic once timing is stripped', async () => {
  const first = await runMenuBenchmark({ adapters: adapters() })
  const second = await runMenuBenchmark({ adapters: adapters() })
  assert.deepEqual(stripTimingForComparison(first.menuCaseScores), stripTimingForComparison(second.menuCaseScores))
})

test('runMenuBenchmark: requires adapters', async () => {
  await assert.rejects(() => runMenuBenchmark({ adapters: [] }))
})

test('report: the menu track appears only when given, with its own disclaimer and separate buckets', async () => {
  const { menuCaseScores } = await runMenuBenchmark({ adapters: adapters() })
  const base = { manifestValid: true, manifestProblems: [], caseScores: [] }
  const without = buildMachineReadableReport(base)
  assert.equal(without.menuBuckets, undefined)
  assert.ok(!buildHumanReadableSummary(without).includes('BE-22'))

  const withMenu = buildMachineReadableReport({ ...base, menuCaseScores })
  assert.equal(withMenu.menuDisclaimer, MENU_TRACK_DISCLAIMER)
  assert.equal(withMenu.menuBuckets.length, 2)
  assert.ok(withMenu.menuBuckets.every((b) => b.costEurCents === null))
  const summary = buildHumanReadableSummary(withMenu)
  assert.ok(summary.includes('menu: html_only × html_structure'))
  assert.ok(summary.includes('menu: html_only × ai_structured'))
  assert.ok(summary.includes(MENU_TRACK_DISCLAIMER))
  assert.deepEqual(JSON.parse(JSON.stringify(withMenu)), withMenu)
})
