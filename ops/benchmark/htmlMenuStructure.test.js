'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  MIN_ITEMS,
  MAX_HTML_LENGTH,
  MAX_NODES,
  MAX_DEPTH,
  MAX_PARSE_DEPTH,
  MAX_WORK,
  MAX_ITEM_TEXT,
  parseHtml,
  createBudget,
  isClockText,
  isDateText,
  displayName,
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
  assert.equal(extractHtmlMenuStructure('<span></span>'.repeat(MAX_NODES + 5)).reason, 'too_many_nodes')
  assert.equal(extractHtmlMenuStructure('<div>'.repeat(MAX_PARSE_DEPTH + 5)).reason, 'too_deep')
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

// ─── M2: bounded work on broken or hostile HTML ───────────────────────────

const HOSTILE_UNITS = {
  'unclosed <script': '<script ',
  'unclosed comment': '<!--',
  'unclosed <style>': '<style>',
  'stray closing tags': '</span>',
  'tag without >': '<a b="',
  'deeply nested divs': '<div>',
  'li with deep nesting': '<li><div><div><div>',
  'dt/dt under deep nesting': '<dt></dt>',
  'unterminated entity': '&aaaaaaaaa',
  'sibling cards': '<div class="card">x</div>',
}

function hostile(unit, length) {
  const prefix = unit === '<dt></dt>' ? `<dl><dt><dl>${'<div>'.repeat(900)}` : ''
  return prefix + unit.repeat(Math.floor((length - prefix.length) / unit.length))
}

for (const [label, unit] of Object.entries(HOSTILE_UNITS)) {
  test(`M2 ${label}: a maximum-size hostile input ends unparsed within the deterministic work budget`, () => {
    const result = extractHtmlMenuStructure(hostile(unit, MAX_HTML_LENGTH - 16))
    assert.equal(result.status, 'unparsed')
    assert.ok(result.stats.workUnits <= MAX_WORK, `work ${result.stats.workUnits}`)
    assert.deepEqual(validateMenuExtraction(result), [])
  })
}

test('M2: work grows linearly — doubling a hostile input at most ~doubles the work (no quadratic re-scanning)', () => {
  for (const unit of ['</span>', '<a b="', '<p a=" ', '&aaaaaaaaa', '<li>x', '<x-'.padEnd(40, 'y')]) {
    const small = extractHtmlMenuStructure(`<div>${unit.repeat(2000)}</div>`).stats.workUnits
    const large = extractHtmlMenuStructure(`<div>${unit.repeat(4000)}</div>`).stats.workUnits
    assert.ok(large <= small * 2.2 + 50, `${unit}: ${small} -> ${large}`)
  }
})

test('M2: an unclosed script, style or comment consumes the rest of the input in ONE forward scan', () => {
  for (const opener of ['<script>', '<style>', '<!--', '<script>'.repeat(5000), '<!--'.repeat(5000)]) {
    const html = `<p>Fictief</p>${opener}${'<li>Fictief geheim € 9,99</li>'.repeat(20000)}`
    const budget = createBudget()
    const { root } = parseHtml(html, budget)
    // One pass costs about html.length / 64 units; any re-scan multiplies it.
    assert.ok(budget.used <= Math.ceil(html.length / 64) * 2 + 50, `${opener.slice(0, 8)}: ${budget.used} units for ${html.length} chars`)
    assert.ok(!JSON.stringify(root.children.map((c) => c.tag)).includes('li'))
  }
})

test('M2: a closing tag for an element that is not open is ignored without searching the stack', () => {
  const budget = createBudget()
  parseHtml(`${'<div>'.repeat(900)}${'</span>'.repeat(5000)}`, budget)
  assert.ok(budget.used < 20000, `${budget.used} units for 5000 stray closers under 900 levels`)
})

test('M2: implicit closing inspects a bounded number of stack levels, not the whole stack', () => {
  const budget = createBudget()
  parseHtml(`<dl><dt><dl>${'<div>'.repeat(900)}${'<dt></dt>'.repeat(1000)}`, budget)
  // ~64 levels per <dt> at most; scanning all 900 levels would cost ~900 000.
  assert.ok(budget.used < 150000, `${budget.used} units`)
})

test('M2: exceeding the work budget fails closed as work_limit_exceeded, never a partial menu', () => {
  const html = `<h2>Fictief</h2>${listOf(50)}`
  assert.equal(extractHtmlMenuStructure(html).status, 'parsed')
  const limited = extractHtmlMenuStructure(html, { maxWork: 200 })
  assert.equal(limited.status, 'unparsed')
  assert.equal(limited.reason, 'work_limit_exceeded')
  assert.deepEqual(limited.sections, [])
  assert.deepEqual(validateMenuExtraction(limited), [])
})

test('M2: options.maxWork can only lower the budget, never raise it', () => {
  const result = extractHtmlMenuStructure(hostile('<dt></dt>', MAX_HTML_LENGTH - 16), { maxWork: MAX_WORK * 10 })
  assert.ok(result.stats.workUnits <= MAX_WORK)
})

test('M2: a realistic 1000-item menu page parses well inside the budget', () => {
  const sections = Array.from({ length: 40 }, (_, s) => `<h2>Fictieve sectie ${s}</h2><ul>${Array.from({ length: 25 }, (_, i) => `<li><span class="name">Fictief gerecht ${s}-${i}</span> <span class="desc">Met fictieve saus</span> <span class="price">€ ${i + 3},50</span></li>`).join('')}</ul>`).join('')
  const result = extractHtmlMenuStructure(`<h1>Fictieve kaart</h1>${sections}`)
  assert.equal(result.status, 'parsed')
  assert.equal(result.stats.counted, 1000)
  assert.ok(result.stats.workUnits < MAX_WORK / 10, `work ${result.stats.workUnits}`)
})

test(`M2: an item element with more than ${MAX_ITEM_TEXT} characters is never read as one dish`, () => {
  const long = `Fictief ${'woord '.repeat(150)}`
  const result = extractHtmlMenuStructure(`<h2>Fictief</h2><ul><li>${long} 4,50</li><li>${long}</li><li>Fictief a 4,50</li><li>Fictief b 5,00</li><li>Fictief c 6,00</li></ul>`)
  assert.equal(result.status, 'parsed')
  assert.equal(result.sections[0].items.length, 3)
  assert.equal(result.rejected.filter((r) => r.reason === 'ambiguous_structure').length, 1)
})

// ─── H1: clock times and dates versus ordinary prices ─────────────────────

test('H1: clock times in clear time context are recognized', () => {
  for (const text of ['Lunch vanaf 12.00', 'Diner vanaf 17.30', 'Keuken sluit om 21.45', 'Ontbijt 08.30 uur', 'Open tot 22:00', 'Fictief 12.00 - 16.00', 'Maandag gesloten']) {
    assert.ok(isClockText(text), text)
  }
})

test('H1: ordinary prices are never mistaken for times', () => {
  for (const text of ['Fictieve pasta 12.50', 'Fictieve plank vanaf 12,50', 'Fictieve schotel vanaf € 14.50', 'Fictieve soep 6.30', 'Fictieve huiswijn glas 5.50 - fles 27.50', 'Fictieve open sandwich 7.50', '€ 12.00 uur']) {
    assert.ok(!isClockText(text), text)
  }
})

test('H1: dates in clear date/event context are recognized', () => {
  for (const text of ['Fictief event 12.05', 'Fictief feest 24.12', 'Fictieve markt op 01.06', 'Fictief concert 15 mei', 'Fictieve proeverij 1 dec.']) {
    assert.ok(isDateText(text), text)
  }
})

test('H1: prices without date context — or with € — are never dates', () => {
  for (const text of ['Fictieve marktsalade 12.05', 'Fictieve proeverij 24.50', 'Fictief concert-diner € 24.12', 'Fictief feest 24,12', 'Fictieve soep 12.05']) {
    assert.ok(!isDateText(text), text)
  }
})

test('H1: a list of single times or dates never yields a menu; a dot-price list does', () => {
  const times = extractHtmlMenuStructure('<h2>Fictief</h2><ul><li>Lunch vanaf 12.00</li><li>Diner vanaf 17.30</li><li>Borrel vanaf 16.00</li></ul>')
  const dates = extractHtmlMenuStructure('<h2>Fictief</h2><ul><li>Fictief event 12.05</li><li>Fictief feest 24.12</li><li>Fictieve markt op 01.06</li></ul>')
  const prices = extractHtmlMenuStructure('<h2>Fictief</h2><ul><li>Fictief a 12.00</li><li>Fictief b 17.30</li><li>Fictief c 16.00</li></ul>')
  assert.equal(times.status, 'unparsed')
  assert.equal(dates.status, 'unparsed')
  assert.equal(prices.status, 'parsed')
  assert.deepEqual(prices.sections[0].items.map((i) => i.amountMinorUnits), [1200, 1730, 1600])
})

// ─── M1: volumes and weights are never prices ─────────────────────────────

test('M1: volume and weight tokens are skipped, comma and dot, with and without a space', () => {
  for (const text of ['0,75 l', '0.75l', '0,33 cl', '0,50 ml', '0,25 kg', '0.25kg', '1,50 liter', '0,20 g', '0,50 gr']) {
    assert.deepEqual(findPrices(text), [], text)
  }
  assert.deepEqual(findPrices('Fictief bier 0,33 l 4,50').map((p) => p.amountMinorUnits), [450])
  assert.deepEqual(findPrices('Fictieve steak 250 g 24,50').map((p) => p.amountMinorUnits), [2450])
  // A unit-like word that is not a unit is no reason to drop a price.
  assert.deepEqual(findPrices('Fictief 4,50 lunch').map((p) => p.amountMinorUnits), [450])
  assert.deepEqual(findPrices('Fictief 5,50 glas').map((p) => p.amountMinorUnits), [550])
  // With € it is money.
  assert.deepEqual(findPrices('€ 4,50 l').map((p) => p.amountMinorUnits), [450])
})

test('M1: a volume never turns one real price into multiple_undecomposed, and two real prices stay multiple_undecomposed', () => {
  const result = extractHtmlMenuStructure('<h2>Fictief</h2><ul><li>Fictief bier 0,33 l 4,50</li><li>Fictieve wijn 0,75 l glas 5,50 / fles 27,50</li><li>Fictief c 3,00</li></ul>')
  assert.deepEqual(result.sections[0].items.map((i) => [i.priceStatus, i.amountMinorUnits]), [['known', 450], ['multiple_undecomposed', null], ['known', 300]])
})

// ─── L1: two dishes in one element ─────────────────────────────────────────

test('L1: two name+price pairs in one element are rejected — no partial dish or price is claimed', () => {
  const result = extractHtmlMenuStructure('<h2>Fictief</h2><ul><li>Fictieve soep 6,50 Fictieve salade 7,50</li><li>Fictieve a 4,50</li><li>Fictieve b 5,00</li><li>Fictieve c 6,00</li></ul>')
  const text = JSON.stringify(result.sections)
  assert.ok(!text.includes('soep') && !text.includes('salade'))
  assert.ok(!result.sections[0].items.some((i) => i.amountMinorUnits === 650 || i.amountMinorUnits === 750))
  assert.equal(result.rejected.filter((r) => r.reason === 'ambiguous_structure').length, 1)
})

test('L1: the same rule holds inside a card price element and a definition', () => {
  const card = (name, price) => `<div class="menu-item"><h3>${name}</h3><span class="price">${price}</span></div>`
  const cards = extractHtmlMenuStructure(`<h2>Fictief</h2>${card('Fictieve soep', '6,50 Fictieve salade 7,50')}${card('Fictieve a', '4,50')}${card('Fictieve b', '5,00')}${card('Fictieve c', '6,00')}`)
  const dl = extractHtmlMenuStructure('<h2>Fictief</h2><dl><dt>Fictieve soep</dt><dd>6,50 Fictieve salade 7,50</dd><dt>Fictieve a</dt><dd>4,50</dd><dt>Fictieve b</dt><dd>5,00</dd><dt>Fictieve c</dt><dd>6,00</dd></dl>')
  for (const result of [cards, dl]) {
    assert.equal(result.sections[0].items.length, 3)
    assert.ok(result.rejected.some((r) => r.reason === 'ambiguous_structure'))
  }
})

// ─── L2: non-dish price sections (narrow labels only) ─────────────────────

test('L2: labelled voucher, ticket, admission, parking and cloakroom sections are never menus', () => {
  for (const heading of ['Cadeaubonnen', 'Cadeaukaarten', 'Tickets', 'Entree', 'Toegangsprijzen', 'Parkeren', 'Garderobe', 'Webshop']) {
    const result = extractHtmlMenuStructure(`<h2>${heading}</h2>${listOf(4)}`)
    assert.equal(result.status, 'unparsed', heading)
    assert.ok(result.rejected.every((r) => r.reason === 'non_menu_section'), heading)
  }
})

test('L2 documented limitation: an UNLABELLED list of non-dish prices is still read as a menu (not semantically solved)', () => {
  const card = (name, price) => `<div class="product-card"><h3>${name}</h3><span class="price">${price}</span></div>`
  const result = extractHtmlMenuStructure(`${card('Fictieve bon 25', '€ 25')}${card('Fictieve bon 50', '€ 50')}${card('Fictieve bon 75', '€ 75')}`)
  // Documents a known gap; if a future change closes it, update this test
  // and the README together.
  assert.equal(result.status, 'parsed')
})

// ─── Cosmetic: trailing alcohol percentage in the displayed name ──────────

test('displayName drops only a trailing alcohol percentage — never mid-name, never 100%', () => {
  assert.equal(displayName('Fictief bier 5,0%'), 'Fictief bier')
  assert.equal(displayName('Fictieve tripel (8,5% vol)'), 'Fictieve tripel')
  assert.equal(displayName('Fictieve tripel 8,5% vol'), 'Fictieve tripel')
  assert.equal(displayName('Fictieve 100%'), 'Fictieve 100%')
  assert.equal(displayName('Fictieve 50% korting burger'), 'Fictieve 50% korting burger')
  assert.equal(displayName('5%'), '5%')
})

// ─── N1: table rows with several name+price pairs ─────────────────────────

const table = (...rows) => `<h2>Fictief</h2><table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`
const FILLER_ROWS = [['Fictief a', '4,50'], ['Fictief b', '5,00'], ['Fictief c', '6,00']]

test('N1: two name cells each with their own price cell are ambiguous — the first dish is never claimed', () => {
  for (const row of [
    ['Fictieve soep', '6,50', 'Fictieve salade', '7,50'],
    ['6,50', 'Fictieve soep', '7,50', 'Fictieve salade'],
    ['Fictieve soep', 'Met brood', '6,50', 'Fictieve salade', '7,50'],
    ['Fictieve soep 6,50', 'Fictieve salade 7,50'],
  ]) {
    const result = extractHtmlMenuStructure(table(row, ...FILLER_ROWS))
    assert.equal(result.status, 'parsed', JSON.stringify(row))
    assert.equal(result.sections[0].items.length, 3, JSON.stringify(row))
    assert.ok(!JSON.stringify(result.sections).includes('soep'), JSON.stringify(row))
    assert.ok(result.rejected.some((r) => r.reason === 'ambiguous_structure'), JSON.stringify(row))
  }
})

test('N1: one name with two real price variants stays one multiple_undecomposed item', () => {
  for (const row of [
    ['Fictieve huiswijn', '5,50', '27,50'],
    ['Fictieve huiswijn', 'glas', '5,50', 'fles', '27,50'],
    ['Fictieve huiswijn', 'glas 5,50', 'fles 27,50'],
    ['Fictieve huiswijn', 'Droog en fris', '5,50', '27,50'],
  ]) {
    const result = extractHtmlMenuStructure(table(row, ...FILLER_ROWS))
    const item = result.sections[0].items[0]
    assert.equal(item.name, 'Fictieve huiswijn', JSON.stringify(row))
    assert.equal(item.priceStatus, 'multiple_undecomposed', JSON.stringify(row))
    assert.equal(item.amountMinorUnits, null)
    assert.ok(!result.rejected.some((r) => r.reason === 'ambiguous_structure'), JSON.stringify(row))
  }
})

test('N1: a name, a description cell and one price cell stay one known item', () => {
  const result = extractHtmlMenuStructure(table(['Fictieve quiche', 'Met fictieve prei', '9,25'], ...FILLER_ROWS))
  const item = result.sections[0].items[0]
  assert.deepEqual([item.name, item.priceStatus, item.amountMinorUnits, item.description], ['Fictieve quiche', 'known', 925, 'Met fictieve prei'])
})

// ─── N2: cards and list items with several name/price elements ────────────

const card = (inner) => `<div class="menu-item">${inner}</div>`
const FILLER_CARDS = ['Fictief a', 'Fictief b', 'Fictief c'].map((n, i) => card(`<h3>${n}</h3><span class="price">${i + 4},00</span>`)).join('')

test('N2: two name or two price elements in one card are ambiguous — no first item or price is claimed', () => {
  for (const inner of [
    '<h3>Fictieve soep</h3><span class="price">6,50</span><h3>Fictieve salade</h3><span class="price">7,50</span>',
    '<h3>Fictieve soep</h3><h3>Fictieve salade</h3><span class="price">6,50</span>',
    '<h3>Fictieve soep</h3><span class="price">6,50</span><span class="price">7,50</span>',
    '<h3>Fictieve soep</h3><span class="price">6,50</span> Fictieve salade 7,50',
  ]) {
    const result = extractHtmlMenuStructure(`<h2>Fictief</h2>${card(inner)}${FILLER_CARDS}`)
    assert.equal(result.sections[0].items.length, 3, inner)
    assert.ok(!JSON.stringify(result.sections).includes('soep'), inner)
    assert.ok(!result.sections[0].items.some((i) => i.amountMinorUnits === 650), inner)
    assert.ok(result.rejected.some((r) => r.reason === 'ambiguous_structure'), inner)
  }
})

test('N2: a card with exactly one name and one price stays supported — nested and description markup do not count twice', () => {
  for (const [inner, description] of [
    ['<h3>Fictieve soep</h3><span class="price">€ 6,50</span>', null],
    ['<h3 class="name"><strong>Fictieve soep</strong></h3><span class="price"><span class="price-amount">€ 6,50</span></span>', null],
    ['<h3>Fictieve soep</h3><p class="desc">Met <strong>verse</strong> kruiden</p><span class="price">€ 6,50</span>', 'Met verse kruiden'],
  ]) {
    const result = extractHtmlMenuStructure(`<h2>Fictief</h2>${card(inner)}${FILLER_CARDS}`)
    const item = result.sections[0].items[0]
    assert.deepEqual([item.name, item.priceStatus, item.amountMinorUnits, item.description], ['Fictieve soep', 'known', 650, description], inner)
  }
})

test('N2: a list item with name/price elements follows the same rule', () => {
  const result = extractHtmlMenuStructure('<h2>Fictief</h2><ul><li><b>Fictieve soep</b> <span class="price">6,50</span> <b>Fictieve salade</b> <span class="price">7,50</span></li><li>Fictief a 4,50</li><li>Fictief b 5,00</li><li>Fictief c 6,00</li></ul>')
  assert.equal(result.sections[0].items.length, 3)
  assert.ok(result.rejected.some((r) => r.reason === 'ambiguous_structure'))
})

// ─── N3: size letters versus volume units ─────────────────────────────────

test('N3: an upper-case size letter after a price is never a volume', () => {
  assert.deepEqual(findPrices('Fictieve pizza 9,50 M 12,50 L').map((p) => p.amountMinorUnits), [950, 1250])
  assert.deepEqual(findPrices('Fictieve pizza 12,50 L').map((p) => p.amountMinorUnits), [1250])
  assert.deepEqual(findPrices('Fictieve pizza 9,50 G').map((p) => p.amountMinorUnits), [950])
})

test('N3: a real quantity is still skipped, upper or lower case, before the price', () => {
  assert.deepEqual(findPrices('Fictief bier 0,75 L 4,50').map((p) => p.amountMinorUnits), [450])
  assert.deepEqual(findPrices('Fictief bier 0,75 l 4,50').map((p) => p.amountMinorUnits), [450])
  assert.deepEqual(findPrices('Fictief bier 0,33l 4,50').map((p) => p.amountMinorUnits), [450])
  assert.deepEqual(findPrices('Fictief bier 33 CL 4,50').map((p) => p.amountMinorUnits), [450])
  assert.deepEqual(findPrices('Fictieve kaas 0,25 KG 4,50').map((p) => p.amountMinorUnits), [450])
  assert.deepEqual(findPrices('Fictieve kaas 0,20 G 4,50').map((p) => p.amountMinorUnits), [450])
})

test('N3: a unit-like token AFTER a price is kept as a price (fail closed), so two prices stay two', () => {
  assert.deepEqual(findPrices('Fictieve calzone 10,50 m 13,50 l').map((p) => p.amountMinorUnits), [1050, 1350])
  assert.deepEqual(findPrices('Fictief tapbier 4,50 (0,25 l)').map((p) => p.amountMinorUnits), [450, 25])
})

test('N3: in an item, a size pair is multiple_undecomposed and glas/fles stays multiple_undecomposed', () => {
  const result = extractHtmlMenuStructure('<h2>Fictief</h2><ul><li>Fictieve pizza 9,50 M 12,50 L</li><li>Fictieve wijn 0,75 L glas 5,50 / fles 27,50</li><li>Fictief bier 0,75 L 4,50</li></ul>')
  assert.deepEqual(result.sections[0].items.map((i) => [i.name, i.priceStatus, i.amountMinorUnits, i.description]), [
    ['Fictieve pizza', 'multiple_undecomposed', null, null],
    ['Fictieve wijn 0,75 L', 'multiple_undecomposed', null, null],
    ['Fictief bier 0,75 L', 'known', 450, null],
  ])
})

// ─── N4: table rows are linear and fully charged ──────────────────────────

test('N4: many table cells are processed linearly and every cell classification is charged', () => {
  const wideRow = (count) => `<table><tr>${'<td>1,00</td>'.repeat(count)}${Array.from({ length: count }, (_, i) => `<td>Fictief ${i}</td>`).join('')}</tr></table>`
  const small = extractHtmlMenuStructure(wideRow(2000))
  const large = extractHtmlMenuStructure(wideRow(4000))
  assert.equal(large.status, 'unparsed')
  assert.ok(large.stats.workUnits <= small.stats.workUnits * 2.2 + 50, `${small.stats.workUnits} -> ${large.stats.workUnits}`)
  // Beyond parsing, reading the row charges per cell at least: one child
  // step, two tree visits (td + text) and a classification (>= 2 units).
  const html = wideRow(4000)
  const parseBudget = createBudget()
  parseHtml(html, parseBudget)
  const cells = 8000
  assert.ok(large.stats.workUnits - parseBudget.used >= cells * 5, `read cost ${large.stats.workUnits - parseBudget.used} for ${cells} cells`)
})
