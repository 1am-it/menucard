'use strict'

// #59 review 6323277596 — one regression per measured error class, on a
// FICTIONAL fixture with the same shape as the real deviation. No website,
// restaurant, domain or real dish name is used here; the repairs must not
// depend on the measured sources.

const test = require('node:test')
const assert = require('node:assert/strict')

const { extractHtmlMenuStructure } = require('./htmlMenuStructure')
const { structurePdfLinesIntoMenu } = require('./pdfMenuStructuring')
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis')

function items(result) {
  return result.sections.flatMap((section) => section.items.map((item) => ({ ...item, path: section.path })))
}

function find(result, name) {
  return items(result).find((item) => item.name.toLowerCase() === name.toLowerCase()) || null
}

function prices(result) {
  return items(result).map((item) => item.amountMinorUnits)
}

// ─── Class A: an inline title element closed by a line break ───────────────

test('A: a bold title closed by a line break keeps its own title and price', () => {
  const html = `<h1>Fictieve kaart</h1><h2>Fictieve a la carte</h2>
    <p><strong>Fictieve ossenhaas <br /></strong>fictief rundvlees met jus<br />35 - <em>supplement fictieve eendenlever 9</em><br /><br />
    <strong>Fictieve zeetong</strong><br />fictieve vis met saus<br />39<br /><br />
    <strong>Fictief gehakt <br /></strong>fictief gehakt met kaas<br />28</p>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.equal(find(result, 'Fictieve ossenhaas').amountMinorUnits, 3500)
  assert.equal(find(result, 'Fictieve zeetong').amountMinorUnits, 3900)
  // The sibling whose bold title ends in a line break is not swallowed by the
  // block above it, and its own price is not taken from the next dish.
  assert.equal(find(result, 'Fictief gehakt').amountMinorUnits, 2800)
  assert.equal(prices(result).includes(900), false, 'the supplement is never a dish price')
})

test('A: a dish line whose bold title ends in a line break is read in every column', () => {
  const column = (body) => `<div class="fictive-column"><div class="fictive-inner">${body}</div></div>`
  const html = `<h1>Fictieve kaart</h1><h2>Fictieve pasta</h2>
    <div class="fictive-row">
      ${column('<p><b>Fictieve pasta zalm, 16,00<br /></b>pasta met fictieve zalm</p><p><b>Fictieve pasta funghi, 11,00<br /></b>pasta met fictieve paddenstoelen</p><p><b>Fictieve pasta bolognese, 13,00<br /></b>pasta met fictief gehakt</p>')}
      ${column('<p><b>Fictieve pasta pollo, 13,00<br /></b>pasta met fictieve kip</p><p><b>Fictieve pasta scampi, 16,00<br /></b>pasta met fictieve garnalen</p><p><b>Fictieve pasta veggie, 11,00<br /></b>pasta met fictieve groenten</p>')}
    </div>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(items(result).map((item) => [item.name, item.amountMinorUnits]), [
    ['Fictieve pasta zalm', 1600],
    ['Fictieve pasta funghi', 1100],
    ['Fictieve pasta bolognese', 1300],
    ['Fictieve pasta pollo', 1300],
    ['Fictieve pasta scampi', 1600],
    ['Fictieve pasta veggie', 1100],
  ])
})

// ─── Class B: supplement clauses anywhere in a dish block ──────────────────

test('B: a supplement clause never becomes the main price, wherever it is printed', () => {
  const html = `<h2>Fictieve kaart</h2>
    <p><strong>Fictief gerecht</strong> - 17 - <em>in plaats van dessert, supplement 8,50</em><br /><br />
       <strong>Fictieve sandwich, €18</strong><br />fictief broodje met fictieve room (supp. fictieve ganzenlever €4)<br /><br />
       <strong>Fictief gerecht met saus, €12,50</strong><br />fictieve saus (supp. 130 gr. €8)<br /><br />
       <strong>Fictieve soep</strong> 6,50<br /><br />
       <strong>Fictieve salade</strong> 7,50</p>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.equal(find(result, 'Fictief gerecht').amountMinorUnits, 1700)
  assert.equal(find(result, 'Fictieve sandwich').amountMinorUnits, 1800)
  assert.equal(find(result, 'Fictief gerecht met saus').amountMinorUnits, 1250)
  assert.equal(prices(result).includes(850), false, 'the 8,50 supplement is no dish price')
  assert.equal(prices(result).includes(400), false, 'the €4 supplement is no dish price')
  assert.equal(prices(result).includes(800), false, 'the €8 supplement is no dish price')
  assert.match(find(result, 'Fictief gerecht').evidence.supplementText, /supplement 8,50/i)
})

test('B: a line that declares itself a surcharge is never a dish', () => {
  const html = `<h2>Fictieve kaart</h2>
    <p><strong>Fictieve soep</strong> 6,50<br /><br />
       <strong>Fictieve salade</strong> 7,50<br /><br />
       <strong>Fictief geraspt product, €2,00</strong><br />meerprijs<br /><br />
       <strong>Fictief brood</strong> 3,00</p>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.equal(find(result, 'Fictief geraspt product'), null, 'a surcharge is never a dish')
  assert.ok(result.rejected.some((line) => line.reason === 'supplement_price'))
  assert.equal(prices(result).includes(200), false)
})

// ─── Class C: a legend after an inline price ───────────────────────────────

test('C: bulleted legend lines after a dish never hide its inline price', () => {
  const html = `<h2>Fictieve kaart</h2>
    <p><strong>Fictieve oesterproeverij Deluxe</strong> - 6 fictieve stuks - 29,50<br />○ fictieve legende een<br />○ fictieve legende twee<br /><br />
       <strong>Fictieve soep</strong> 6,50<br /><br />
       <strong>Fictieve salade</strong> 7,50</p>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  const dish = find(result, 'Fictieve oesterproeverij Deluxe')
  assert.ok(dish, 'the dish stays')
  assert.equal(dish.amountMinorUnits, 2950)
  assert.equal(/legende/.test(dish.description || ''), false, 'the legend is not the description')
})

// ─── Class D: a later h1 for one more section ──────────────────────────────

test('D: a later top-level heading does not drop the menu title from the route', () => {
  const html = `<h1>FICTIEVE DINERKAART</h1>
    <h2>VOORGERECHTEN</h2>
    <p><strong>Fictief voorgerecht</strong><br />fictieve omschrijving<br />8</p>
    <p><strong>Fictief tweede voorgerecht</strong><br />fictieve omschrijving<br />9</p>
    <h2>HOOFDGERECHTEN</h2>
    <p><strong>Fictief hoofdgerecht</strong><br />fictieve omschrijving<br />18</p>
    <p><strong>Fictief tweede hoofdgerecht</strong><br />fictieve omschrijving<br />19</p>
    <h1>NAGERECHTEN</h1>
    <p><strong>Fictief nagerecht</strong><br />fictieve omschrijving<br />7</p>
    <p><strong>Fictief tweede nagerecht</strong><br />fictieve omschrijving<br />6</p>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(result.sections.map((section) => section.path), [
    ['FICTIEVE DINERKAART', 'VOORGERECHTEN'],
    ['FICTIEVE DINERKAART', 'HOOFDGERECHTEN'],
    ['FICTIEVE DINERKAART', 'NAGERECHTEN'],
  ])
})

// ─── Class E: several prices for one dish (bounded, never flattened) ───────

test('E: a dish with several prices is refused as one amount and counted', () => {
  const html = `<h2>Fictieve kaart</h2>
    <p><strong>Fictief kaasassortiment</strong><br />fictieve selectie van kazen<br />vier stuks 13 - zes stuks 19,50 - in plaats van dessert, supplement 8,50<br /><br />
       <strong>Fictieve mixed grill, €27,50 (1 pers.) / €48,50 (2 pers.)</strong><br />fictieve mix van vlees<br /><br />
       <strong>Fictieve soep</strong> 6,50<br /><br />
       <strong>Fictieve salade</strong> 7,50<br /><br />
       <strong>Fictief brood</strong> 3,00</p>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.equal(find(result, 'Fictief kaasassortiment'), null, 'never flattened to 13,00 or 19,50')
  assert.equal(find(result, 'Fictieve mixed grill'), null, 'never flattened to 27,50 or 48,50')
  for (const amount of [1300, 1950, 2750, 4850, 850]) {
    assert.equal(prices(result).includes(amount), false, `no single amount ${amount} is invented`)
  }
  assert.ok(result.stats.priceVariantLines >= 2, `expected both variant lines to be counted, got ${result.stats.priceVariantLines}`)
})

test('E: the analysis reports the price-variant limit in plain language', async () => {
  const html = `<html><body><h1>Fictieve kaart</h1>
    <p><strong>Fictief kaasassortiment</strong><br />fictieve selectie van kazen<br />vier stuks 13 - zes stuks 19,50<br /><br />
       <strong>Fictieve soep</strong> 6,50<br /><br />
       <strong>Fictieve salade</strong> 7,50<br /><br />
       <strong>Fictief brood</strong> 3,00</p></body></html>`
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: html, homepageUrl: 'https://fictief-voorbeeld.test/menu' })
  assert.ok(
    analysis.limitations.some((line) => /meerdere prijzen \(prijsvarianten/.test(line)),
    `expected a visible price-variant limitation, got: ${analysis.limitations.join(' | ')}`,
  )
})

// ─── Class F: a PDF price with no words before it ──────────────────────────

test('F: a PDF price without a usable name is not invented as a dish', () => {
  const { categories, layout } = structurePdfLinesIntoMenu([
    {
      lines: [
        { items: [{ x: 20, y: 200, str: '// FICTIEVE GERECHTEN' }] },
        { items: [{ x: 20, y: 180, str: '€' }, { x: 120, y: 180, str: '39.50' }] },
        { items: [{ x: 20, y: 160, str: 'Fictieve soep' }, { x: 120, y: 160, str: '6.50' }] },
        { items: [{ x: 20, y: 140, str: 'Fictieve salade' }, { x: 120, y: 140, str: '7.50' }] },
        { items: [{ x: 20, y: 120, str: 'Fictief brood' }, { x: 120, y: 120, str: '3.00' }] },
      ],
    },
  ])
  const names = categories.flatMap((category) => category.items).map((item) => item.name)
  assert.equal(names.includes('€'), false, 'a lone currency sign is never a dish name')
  assert.ok(names.includes('Fictieve soep'))
  assert.ok(layout.unlinkedPriceLines >= 1, 'the unlinked price is reported, not silently dropped')
})
