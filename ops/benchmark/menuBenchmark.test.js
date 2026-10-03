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

// ─── M3: end-to-end rogue adapters fail BEFORE any scoring happens ────────

/** Loads `moduleName` fresh with `exportName` of `dependencyName` replaced by
 * a spy, so a test can prove the runner never reached scoring. */
function loadWithScoringSpy(moduleName, dependencyName, exportName) {
  const modulePath = require.resolve(moduleName)
  const dependency = require(dependencyName)
  const original = dependency[exportName]
  const calls = []
  dependency[exportName] = (...args) => {
    calls.push(args)
    return original(...args)
  }
  delete require.cache[modulePath]
  const loaded = require(modulePath)
  return {
    loaded,
    calls,
    restore() {
      dependency[exportName] = original
      delete require.cache[modulePath]
    },
  }
}

function rogueMenuAdapter(mutate) {
  return {
    kind: 'html_structure',
    available: true,
    async run(fixture) {
      const result = await createHtmlStructureAdapter().run(fixture)
      mutate(result)
      return result
    },
  }
}

const NESTED_MUTATIONS = {
  evidence: (r) => { r.menuExtraction.sections[0].items[0].evidence.confidence = 'hoog' },
  rejected: (r) => { r.menuExtraction.rejected.push({ text: 'Fictief', reason: 'modifier', locator: 'li', reviewReady: true }) },
  stats: (r) => { r.menuExtraction.stats.confidence = 1 },
  cost: (r) => { r.menuExtraction.cost.reviewReady = false },
  notes: (r) => { r.notes.push({ confidence: 'hoog' }) },
  cycle: (r) => { r.menuExtraction.stats = { counted: 1 }; r._loop = r },
  // N6: hidden trust keys
  nonEnumerable: (r) => { Object.defineProperty(r.menuExtraction.sections[0].items[0], 'confidence', { value: 'hoog', enumerable: false }) },
  inherited: (r) => { r.menuExtraction.sections[0].items[0] = Object.assign(Object.create({ reviewReady: true }), r.menuExtraction.sections[0].items[0]) },
  getter: (r) => { Object.defineProperty(r.menuExtraction.sections[0].items[0].evidence, 'confidence', { enumerable: true, get: () => 'hoog' }) },
  symbol: (r) => { r.menuExtraction.stats[Symbol('reviewReady')] = true },
}

for (const [where, mutate] of Object.entries(NESTED_MUTATIONS)) {
  test(`M3 end-to-end: a menu adapter smuggling trust/cycles in ${where} makes the runner throw before scoreMenuCase is called`, async () => {
    const spy = loadWithScoringSpy('./menuBenchmark', './menuScoring', 'scoreMenuCase')
    try {
      await assert.rejects(() => spy.loaded.runMenuBenchmark({ cases: [HTML_MENU_CASES[0]], adapters: [rogueMenuAdapter(mutate)] }), /forbidden by this contract/)
      assert.equal(spy.calls.length, 0, 'scoring must never be reached')
    } finally {
      spy.restore()
    }
  })
}

test('N6 end-to-end (field track): an inherited trust key on a field value throws before scoreCase is called', async () => {
  const spy = loadWithScoringSpy('./runner', './scoring', 'scoreCase')
  try {
    const rogue = {
      kind: 'deterministic',
      available: true,
      async run() {
        const value = Object.assign(Object.create({ confidence: 'hoog' }), { text: 'Fictief' })
        return { kind: 'deterministic', available: true, fields: { name: { value, extractionMethod: 'json_ld', hasContentHash: true, contextStatus: 'unverified' } }, menuContextNames: [], unknownMenuContextCount: 0, errors: [], notes: [], _internal: { unknownMenuContexts: [] } }
      },
    }
    await assert.rejects(() => spy.loaded.runBenchmark({ adapters: [rogue] }), /precomputed confidence/)
    assert.equal(spy.calls.length, 0, 'scoring must never be reached')
  } finally {
    spy.restore()
  }
})

test('M3 end-to-end: a clean menu adapter does reach scoring (the spy works)', async () => {
  const spy = loadWithScoringSpy('./menuBenchmark', './menuScoring', 'scoreMenuCase')
  try {
    await spy.loaded.runMenuBenchmark({ cases: [HTML_MENU_CASES[0]], adapters: [createHtmlStructureAdapter()] })
    assert.equal(spy.calls.length, 1)
  } finally {
    spy.restore()
  }
})

test('M3 end-to-end (field track): a nested confidence anywhere in a field-track result throws before scoreCase is called', async () => {
  const spy = loadWithScoringSpy('./runner', './scoring', 'scoreCase')
  try {
    const rogue = {
      kind: 'deterministic',
      available: true,
      async run() {
        return {
          kind: 'deterministic',
          available: true,
          fields: { name: { value: { nested: [{ reviewReady: true }] }, extractionMethod: 'json_ld', hasContentHash: true, contextStatus: 'unverified' } },
          menuContextNames: [],
          unknownMenuContextCount: 0,
          errors: [],
          notes: [],
          _internal: { unknownMenuContexts: [] },
        }
      },
    }
    await assert.rejects(() => spy.loaded.runBenchmark({ adapters: [rogue] }), /precomputed confidence/)
    assert.equal(spy.calls.length, 0, 'scoring must never be reached')
  } finally {
    spy.restore()
  }
})
