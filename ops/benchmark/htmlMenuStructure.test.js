'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  MIN_ITEMS,
  MAX_HTML_LENGTH,
  MAX_NODES,
  MAX_DEPTH,
  findPrices,
  extractHtmlMenuStructure,
  createHtmlStructureAdapter,
} = require('./htmlMenuStructure')
const { validateMenuExtraction } = require('./menuExtractionContract')
const { HTML_MENU_CASES } = require('./htmlMenuFixtures')

function flatten(result) {
  return result.sections.flatMap((section) =>
    section.items.map((item) => [section.path.filter(Boolean).slice(-1)[0] || null, item.name, item.priceStatus, item.amountMinorUnits])
  )
}

function findItem(result, name) {
  for (const section of result.sections) {
    const item = section.items.find((i) => i.name === name)
    if (item) return { section, item }
  }
  return null
}

function listOf(count, priceText = '€ 4,50') {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return `<ul>${Array.from({ length: count }, (_, i) => `<li>Fictief item ${letters[i % 26]}${letters[Math.floor(i / 26) % 26]}${i} ${priceText}</li>`).join('')}</ul>`
}

// One regression test per synthetic fixture — every supported pattern and
// every rejected structure.
for (const menuCase of HTML_MENU_CASES) {
  test(`fixture ${menuCase.id} (${menuCase.kind}): ${menuCase.expected.isMenu ? 'parsed exactly as expected' : 'never becomes a menu'}`, () => {
    const result = extractHtmlMenuStructure(menuCase.html)
    assert.deepEqual(validateMenuExtraction(result), [], 'output must satisfy the shared contract')
    assert.equal(result.status, menuCase.expected.isMenu ? 'parsed' : 'unparsed')
    assert.deepEqual(flatten(result), menuCase.expected.items)

    const reasons = new Set(result.rejected.map((line) => line.reason))
    for (const reason of menuCase.expected.rejectedReasons || []) {
      assert.ok(reasons.has(reason), `expected a rejected line with reason ${reason}`)
    }
    for (const [name, description] of Object.entries(menuCase.expected.descriptions || {})) {
      assert.equal(findItem(result, name).item.description, description)
    }
    for (const [name, path] of Object.entries(menuCase.expected.paths || {})) {
      assert.deepEqual(findItem(result, name).section.path, path)
    }
    if (menuCase.expected.minIgnoredMarkers) assert.ok(result.stats.ignoredMarkers >= menuCase.expected.minIgnoredMarkers)
    if (menuCase.expected.minDuplicatesRemoved) assert.ok(result.stats.duplicatesRemoved >= menuCase.expected.minDuplicatesRemoved)
    assert.ok(!JSON.stringify(result).includes('99,00'), 'script content is never read')
  })
}

test('fixtures: every case is synthetic ("Fictie…" names) and has a unique id', () => {
  const ids = HTML_MENU_CASES.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const menuCase of HTML_MENU_CASES) {
    for (const [, name] of menuCase.expected.items) assert.match(name, /^Fictie/, `${menuCase.id}: ${name}`)
  }
})

test('fixtures: both menu and non-menu cases are present', () => {
  assert.ok(HTML_MENU_CASES.filter((c) => c.expected.isMenu).length >= 5)
  assert.ok(HTML_MENU_CASES.filter((c) => !c.expected.isMenu).length >= 5)
})

test('no result ever carries confidence or reviewReady', () => {
  for (const menuCase of HTML_MENU_CASES) {
    const text = JSON.stringify(extractHtmlMenuStructure(menuCase.html))
    assert.ok(!/"confidence"|"reviewReady"/.test(text), menuCase.id)
  }
})

test('findPrices: euro formats become integer minor units', () => {
  assert.deepEqual(findPrices('€ 12,50').map((p) => p.amountMinorUnits), [1250])
  assert.deepEqual(findPrices('12.50').map((p) => p.amountMinorUnits), [1250])
  assert.deepEqual(findPrices('7,-').map((p) => p.amountMinorUnits), [700])
  assert.deepEqual(findPrices('€ 9').map((p) => p.amountMinorUnits), [900])
  assert.deepEqual(findPrices('4,50 of 5,00').map((p) => p.amountMinorUnits), [450, 500])
  assert.equal(findPrices('€ 9')[0].hasEuroSign, true)
  assert.equal(findPrices('12,50')[0].hasEuroSign, false)
})

test('findPrices: percentages, years, clock times and unsupported formats are never prices', () => {
  assert.deepEqual(findPrices('10%'), [])
  assert.deepEqual(findPrices('2025'), [])
  assert.deepEqual(findPrices('18:30'), [])
  // Amounts with a thousands separator fail closed (not recognized) rather
  // than being misread as a smaller amount.
  assert.deepEqual(findPrices('1.250,00'), [])
  assert.deepEqual(findPrices('€12,5'), [])
})

test('a known price records EUR only when the source shows €', () => {
  const withSign = extractHtmlMenuStructure(`<h2>Fictief</h2>${listOf(3, '€ 4,50')}`)
  const without = extractHtmlMenuStructure(`<h2>Fictief</h2>${listOf(3, '4,50')}`)
  assert.equal(withSign.sections[0].items[0].currency, 'EUR')
  assert.equal(without.sections[0].items[0].currency, null)
  assert.equal(without.sections[0].items[0].amountMinorUnits, 450)
})

test(`fewer than ${MIN_ITEMS} items stays unparsed (too_few_items)`, () => {
  const result = extractHtmlMenuStructure(`<h2>Fictief</h2>${listOf(MIN_ITEMS - 1)}`)
  assert.equal(result.status, 'unparsed')
  assert.equal(result.reason, 'too_few_items')
  assert.deepEqual(result.sections, [])
})

test('bounds: empty, non-string, oversized and node-heavy input fail closed', () => {
  assert.equal(extractHtmlMenuStructure('').reason, 'empty_input')
  assert.equal(extractHtmlMenuStructure(null).reason, 'empty_input')
  assert.equal(extractHtmlMenuStructure('x'.repeat(MAX_HTML_LENGTH + 1)).reason, 'input_too_large')
  assert.equal(extractHtmlMenuStructure('<div>'.repeat(MAX_NODES + 5)).reason, 'too_many_nodes')
})

test('bounds: nesting deeper than MAX_DEPTH is not walked and never throws', () => {
  const depth = MAX_DEPTH + 20
  const result = extractHtmlMenuStructure(`${'<div>'.repeat(depth)}${listOf(4)}${'</div>'.repeat(depth)}`)
  assert.equal(result.status, 'unparsed')
  assert.equal(result.stats.depthLimited, true)
})

test('bounds: more items than the contract allows is unparsed (too_many_items)', () => {
  const result = extractHtmlMenuStructure(`<h2>Fictief</h2>${listOf(1200)}`)
  assert.equal(result.status, 'unparsed')
  assert.equal(result.reason, 'too_many_items')
  assert.deepEqual(validateMenuExtraction(result), [])
})

test('script, style and template content is never read as menu text', () => {
  const html = `<h2>Fictieve kaart</h2>${listOf(3)}<script>var x = "<li>Fictief geheim € 9,99</li>"</script><template><li>Fictief sjabloon € 8,88</li></template>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.equal(result.sections[0].items.length, 3)
  assert.ok(!JSON.stringify(result).includes('Fictief geheim'))
  assert.ok(!JSON.stringify(result).includes('Fictief sjabloon'))
})

test('adapter: resolves the AdapterResult envelope with a contract-valid menuExtraction and no fields', async () => {
  const adapter = createHtmlStructureAdapter()
  assert.equal(adapter.kind, 'html_structure')
  assert.equal(adapter.available, true)
  const result = await adapter.run({ html: HTML_MENU_CASES[0].html })
  assert.deepEqual(result.fields, {})
  assert.deepEqual(result.errors, [])
  assert.deepEqual(validateMenuExtraction(result.menuExtraction), [])
})

test('adapter: a missing fixture body is unparsed, never thrown', async () => {
  const result = await createHtmlStructureAdapter().run({})
  assert.equal(result.menuExtraction.status, 'unparsed')
  assert.equal(result.menuExtraction.reason, 'empty_input')
})

test('deterministic: the same input always yields the same result', () => {
  for (const menuCase of HTML_MENU_CASES) {
    assert.deepEqual(extractHtmlMenuStructure(menuCase.html), extractHtmlMenuStructure(menuCase.html))
  }
})
