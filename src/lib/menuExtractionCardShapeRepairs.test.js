'use strict'

// #59 review 6334231310 (K1–K4) — one regression per error class, on FICTIONAL
// fixtures with the same shape as the measured deviation. No website,
// restaurant, domain or real dish name is used here, and no rule below depends
// on a measured source.
//
//   K1  a row/term cell whose first text run is the name and whose single
//       inline child holds the description
//   K2  the source's own card title instead of the page title, and a labelled
//       tab (role="tab" + aria-controls) as a route level
//   K3  a hidden alternative view of the same card counted once — never a
//       silent omission of a unique card
//   K4  course prices inside a named arrangement are an arrangement, not dishes

const test = require('node:test')
const assert = require('node:assert/strict')

const { extractHtmlMenuStructure } = require('./htmlMenuStructure')
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis')

function items(result) {
  return result.sections.flatMap((section) => section.items.map((item) => ({ ...item, path: section.path })))
}

function find(result, name) {
  return items(result).find((item) => item.name.toLowerCase() === name.toLowerCase()) || null
}

// ─── K1: name and description in one cell ──────────────────────────────────

test('K1: a row cell keeps the name and its inline description apart', () => {
  const html = `<h2>Fictieve kaart</h2>
    <table><tbody>
      <tr><th scope="row">Fictieve ham<span>fictieve druif, prei</span></th><td>€22,00</td></tr>
      <tr><th scope="row">Fictieve vis<span>fictief vijgenblad</span></th><td>€18,00</td></tr>
      <tr><th scope="row">Fictieve kaas<span>fictieve peer</span></th><td>€17,00</td></tr>
    </tbody></table>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  const dish = find(result, 'Fictieve ham')
  assert.ok(dish, 'the name is the first text run, not "Fictieve hamfictieve druif, prei"')
  assert.equal(dish.description, 'fictieve druif, prei')
  assert.equal(dish.amountMinorUnits, 2200)
  assert.equal(find(result, 'Fictieve vis').description, 'fictief vijgenblad')
  // The supporting passage keeps both halves of the source cell.
  assert.match(dish.evidence.quote, /Fictieve ham fictieve druif, prei/)
})

test('K1: a term cell and a list item split the same way', () => {
  const html = `<h2>Fictieve kaart</h2>
    <dl>
      <div><dt>Fictieve soep<span>fictieve prei</span></dt><dd>€6,50</dd></div>
      <div><dt>Fictieve salade<span>fictieve radijs</span></dt><dd>€7,50</dd></div>
      <div><dt>Fictieve brood<span>fictieve boter</span></dt><dd>€3,50</dd></div>
    </dl>
    <ul>
      <li>Fictieve wrap<span>fictieve kip</span> 9,50</li>
      <li>Fictieve tosti<span>fictieve kaas</span> 8,50</li>
      <li>Fictieve dummy<span>fictieve noten</span> 7,50</li>
    </ul>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.equal(find(result, 'Fictieve soep').amountMinorUnits, 650)
  assert.equal(find(result, 'Fictieve soep').description, 'fictieve prei')
  assert.equal(find(result, 'Fictieve wrap').amountMinorUnits, 950)
  assert.equal(find(result, 'Fictieve wrap').description, 'fictieve kip')
  assert.equal(find(result, 'Fictieve wrap').priceStatus, 'known')
})

test('K1: a price-only inline element is still a price, never a description', () => {
  const html = `<h2>Fictieve kaart</h2>
    <ul>
      <li>Fictieve pizza <span>11,50</span></li>
      <li>Fictieve pasta <span>12,50</span></li>
      <li>Fictieve risotto <span>13,50</span></li>
    </ul>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  const pizza = find(result, 'Fictieve pizza')
  assert.equal(pizza.amountMinorUnits, 1150)
  assert.equal(pizza.description, null)
})

test('K1: a cell with two inline children is not guessed apart', () => {
  const html = `<h2>Fictieve kaart</h2>
    <ul>
      <li><strong>Fictieve een</strong><em>fictief een</em> 9,50</li>
      <li><strong>Fictieve twee</strong><em>fictief twee</em> 8,50</li>
      <li><strong>Fictieve drie</strong><em>fictief drie</em> 7,50</li>
    </ul>`
  const result = extractHtmlMenuStructure(html)
  // Exactly one inline sibling is the provable shape. With two, nothing is
  // split and no description is invented: the price stays correct.
  assert.equal(result.status, 'parsed')
  const row = items(result)[0]
  assert.equal(row.amountMinorUnits, 950)
  assert.equal(row.description, null)
  assert.equal(row.name, 'Fictieve eenfictief een')
})

test('K1: a section with two definition lists is a list of dishes, not one dish', () => {
  const html = `<h2>Fictieve kaart</h2>
    <section>
      <h4>Fictieve eerste rubriek</h4>
      <dl class="fictive-dishes">
        <div><dt>Fictieve soep</dt><dd>6,50</dd></div>
        <div><dt>Fictieve salade</dt><dd>7,50</dd></div>
      </dl>
      <h4 class="fictive-subheading">Fictieve tweede rubriek</h4>
      <dl class="fictive-dishes">
        <div><dt>Fictieve friet</dt><dd>3,50</dd></div>
        <div><dt>Fictieve mayonaise</dt><dd>1,50</dd></div>
      </dl>
    </section>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(items(result).map((item) => [item.name, item.amountMinorUnits]), [
    ['Fictieve soep', 650],
    ['Fictieve salade', 750],
    ['Fictieve friet', 350],
    ['Fictieve mayonaise', 150],
  ])
  assert.deepEqual(result.sections.map((section) => section.path), [
    ['Fictieve kaart', 'Fictieve eerste rubriek'],
    ['Fictieve kaart', 'Fictieve tweede rubriek'],
  ])
})


// ─── K2: the source's own card title and labelled tabs ─────────────────────

test('K2: a labelled tab is a route level and the card title wins over the page title', () => {
  const html = `<header><h1>Welkom bij Fictief</h1><p>Fictief restaurant in Fictieve Stad.</p></header>
    <section aria-label="Onze fictieve kaart">
      <div><h2>Onze fictieve kaart</h2></div>
      <div role="tablist" aria-label="Kies een kaart">
        <a role="tab" aria-controls="fictief-lunch" aria-selected="true" href="#fictief-lunch">Lunch</a>
        <a role="tab" aria-controls="fictief-diner" aria-selected="false" href="#fictief-diner">Diner</a>
      </div>
      <section id="fictief-lunch" role="tabpanel">
        <h4>Fictieve brioches</h4>
        <dl>
          <div><dt>Fictieve een<span>fictieve prei</span></dt><dd>11,50</dd></div>
          <div><dt>Fictieve twee</dt><dd>12,50</dd></div>
          <div><dt>Fictieve drie</dt><dd>13,50</dd></div>
        </dl>
        <section><h3>Fictieve tabel</h3>
          <table><tbody>
            <tr><th scope="row">Fictieve vier<span>fictieve room</span></th><td>€21,50</td></tr>
            <tr><th scope="row">Fictieve vijf</th><td>€19,50</td></tr>
            <tr><th scope="row">Fictieve zes</th><td>€47,00</td></tr>
          </tbody></table>
        </section>
      </section>
      <section id="fictief-diner" role="tabpanel">
        <h4>Fictieve brioches</h4>
        <dl>
          <div><dt>Fictieve een</dt><dd>21,50</dd></div>
          <div><dt>Fictieve twee</dt><dd>22,50</dd></div>
          <div><dt>Fictieve drie</dt><dd>23,50</dd></div>
        </dl>
      </section>
    </section>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(result.sections.map((section) => section.path), [
    ['Onze fictieve kaart', 'Lunch', 'Fictieve brioches'],
    ['Onze fictieve kaart', 'Lunch', 'Fictieve tabel'],
    ['Onze fictieve kaart', 'Diner', 'Fictieve brioches'],
  ])
  // The page title is not a menu route level, and both variants stay separate.
  assert.equal(items(result).some((item) => item.path.includes('Welkom bij Fictief')), false)
  assert.equal(find(result, 'Fictieve een').path.join(' › '), 'Onze fictieve kaart › Lunch › Fictieve brioches')
})

test('K2: without a card title the page heading still labels the menu', () => {
  const html = `<h1>Fictieve lunchkaart</h1>
    <h2>Fictieve voorgerechten</h2>
    <ul><li>Fictieve soep 6,50</li><li>Fictieve salade 7,50</li><li>Fictieve brood 3,50</li></ul>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(result.sections.map((section) => section.path), [['Fictieve lunchkaart', 'Fictieve voorgerechten']])
})

// ─── K3: a hidden alternative view of the same card ────────────────────────

/** The visible tab view plus a legacy duplicate block its own CSS hides. */
const HIDDEN_DUPLICATE_HTML = `<html><head><style>
  #fictief-kaart .fictive-col:has(#fictief-tabs) > .fictive-module:not(.fictive-actief) {display:none!important;}
</style></head><body>
  <div id="fictief-kaart"><div class="fictive-col">
    <div class="fictive-module fictive-actief">
      <section aria-label="Onze fictieve kaart">
        <div><h2>Onze fictieve kaart</h2></div>
        <section id="fictief-tabs">
          <h4>Fictieve brioches</h4>
          <dl>
            <div><dt>Fictieve een<span>fictieve prei</span></dt><dd>11,50</dd></div>
            <div><dt>Fictieve twee<span>fictieve room</span></dt><dd>12,50</dd></div>
            <div><dt>Fictieve drie<span>fictieve kaas</span></dt><dd>13,50</dd></div>
          </dl>
        </section>
      </section>
    </div>
    <div class="fictive-module fictive-legacy">
      <section>
        <h2>Fictieve brioches</h2>
        <div class="fictive-item"><h3 class="fictive-name">Fictief broodje</h3><p class="fictive-desc">Fictieve prei</p><span class="fictive-price">€11.50</span></div>
        <div class="fictive-item"><h3 class="fictive-name">Fictief broodje</h3><p class="fictive-desc">Fictieve room</p><span class="fictive-price">€12.50</span></div>
        <div class="fictive-item"><h3 class="fictive-name">Fictief broodje</h3><p class="fictive-desc">Fictieve kaas</p><span class="fictive-price">€13.50</span></div>
      </section>
    </div>
  </div></div>
</body></html>`

test('K3: a hidden duplicate view is counted once, never as extra dishes', () => {
  const result = extractHtmlMenuStructure(HIDDEN_DUPLICATE_HTML)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(items(result).map((item) => [item.name, item.amountMinorUnits]), [
    ['Fictieve een', 1150],
    ['Fictieve twee', 1250],
    ['Fictieve drie', 1350],
  ])
  assert.equal(result.stats.hiddenViewsMerged, 3)
  assert.equal(result.stats.hiddenUniqueItems, 0)
})

test('K3: the hidden copy is reported as evidence, not silently dropped', async () => {
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: HIDDEN_DUPLICATE_HTML, homepageUrl: 'https://fictief-voorbeeld.test/menu' })
  assert.ok(
    analysis.limitations.some((line) => /verborgen tweede weergave van dezelfde kaart is één keer geteld/.test(line)),
    `expected a visible hidden-view limitation, got: ${analysis.limitations.join(' | ')}`,
  )
})

test('K2: a nested region label never replaces the enclosing section', () => {
  const html = `<h1>Fictieve kaart</h1>
    <h2>Diner</h2>
    <section aria-label="Fictieve voorgerechten"><h3>Fictieve voorgerechten</h3>
      <ul><li>Fictieve soep 6,50</li><li>Fictieve salade 7,50</li><li>Fictieve brood 3,50</li></ul>
    </section>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(result.sections.map((section) => section.path), [['Fictieve kaart', 'Diner', 'Fictieve voorgerechten']])
})

test('K3: hidden content without a visible counterpart is kept and reported', async () => {
  const html = `<html><body>
    <h1>Fictieve kaart</h1>
    <ul><li>Fictieve soep 6,50</li><li>Fictieve salade 7,50</li><li>Fictieve brood 3,50</li></ul>
    <div hidden><h2>Fictieve verborgen kaart</h2>
      <ul><li>Fictieve verborgen een 4,50</li><li>Fictieve verborgen twee 5,50</li></ul>
    </div>
  </body></html>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  // A unique card behind a hidden marker is never silently dropped.
  assert.ok(find(result, 'Fictieve verborgen een'), 'the unique hidden dish is kept')
  assert.equal(result.stats.hiddenUniqueItems, 2)
  assert.equal(result.stats.hiddenViewsMerged, 0)
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: html, homepageUrl: 'https://fictief-voorbeeld.test/menu' })
  assert.ok(
    analysis.limitations.some((line) => /alleen in een verborgen weergave zonder zichtbare tegenhanger/.test(line)),
    `expected a hidden-unique limitation, got: ${analysis.limitations.join(' | ')}`,
  )
})

test('K3: aria-hidden and an inline display:none mark the same duplicate', () => {
  for (const marker of ['aria-hidden="true"', 'style="display:none"']) {
    const html = `<h1>Fictieve kaart</h1>
      <ul><li>Fictieve soep 6,50</li><li>Fictieve salade 7,50</li><li>Fictieve brood 3,50</li></ul>
      <div ${marker}><h2>Fictieve tweede weergave</h2>
        <ul><li>Fictieve tweede soep 6,50</li><li>Fictieve tweede salade 7,50</li></ul>
      </div>`
    const result = extractHtmlMenuStructure(html)
    assert.equal(result.stats.hiddenViewsMerged, 2, `marker ${marker}`)
    assert.equal(find(result, 'Fictieve tweede soep'), null, `marker ${marker}: no duplicate dish`)
    assert.ok(find(result, 'Fictieve soep'), `marker ${marker}: the visible dish stays`)
  }
})

test('K3: a hiding rule in a later stylesheet block is read too', () => {
  const html = `<html><head>
    <style>.fictive-unused {color:red}</style>
    <style>#fictief-tweede {display:none}</style>
  </head><body>
    <h1>Fictieve kaart</h1>
    <ul><li>Fictieve soep 6,50</li><li>Fictieve salade 7,50</li><li>Fictieve brood 3,50</li></ul>
    <div id="fictief-tweede"><h2>Fictieve tweede weergave</h2>
      <ul><li>Fictieve tweede soep 6,50</li><li>Fictieve tweede salade 7,50</li></ul>
    </div>
  </body></html>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.equal(result.stats.hiddenViewsMerged, 2)
  assert.equal(find(result, 'Fictieve tweede soep'), null)
})

test('K3: an inactive tab panel is a menu variant, never a duplicate', () => {
  const html = `<section aria-label="Onze fictieve kaart">
    <div><h2>Onze fictieve kaart</h2></div>
    <div role="tablist"><a role="tab" aria-controls="fictief-een" href="#fictief-een">Lunch</a><a role="tab" aria-controls="fictief-twee" href="#fictief-twee">Diner</a></div>
    <section id="fictief-een" role="tabpanel"><h4>Fictieve gerechten</h4>
      <ul><li>Fictieve soep 6,50</li><li>Fictieve salade 7,50</li><li>Fictieve brood 3,50</li></ul>
    </section>
    <section id="fictief-twee" role="tabpanel" hidden><h4>Fictieve gerechten</h4>
      <ul><li>Fictieve soep 6,50</li><li>Fictieve salade 7,50</li><li>Fictieve brood 3,50</li></ul>
    </section>
  </section>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  assert.equal(result.stats.hiddenViewsMerged, 0)
  assert.deepEqual(result.sections.map((section) => section.path), [
    ['Onze fictieve kaart', 'Lunch', 'Fictieve gerechten'],
    ['Onze fictieve kaart', 'Diner', 'Fictieve gerechten'],
  ])
})

// ─── K4: course prices inside a named arrangement ──────────────────────────

test('K4: course prices of a named arrangement are an arrangement, not dishes', async () => {
  const html = `<h1>Fictieve kaart</h1>
    <h4>Fictief dagmenu</h4>
    <dl>
      <div><dt>2 gangen<span>fictief voor- en hoofdgerecht</span></dt><dd>€45,00</dd></div>
      <div><dt>3 gangen<span>fictief voor-, hoofd- en nagerecht</span></dt><dd>€55,00</dd></div>
    </dl>
    <h4>Fictieve gerechten</h4>
    <dl>
      <div><dt>Fictieve soep<span>fictieve prei</span></dt><dd>€6,50</dd></div>
      <div><dt>Fictieve salade<span>fictieve radijs</span></dt><dd>€7,50</dd></div>
      <div><dt>Fictieve brood<span>fictieve boter</span></dt><dd>€3,50</dd></div>
    </dl>`
  const result = extractHtmlMenuStructure(html)
  assert.equal(result.status, 'parsed')
  // No course line becomes a dish and no dish disappears.
  assert.deepEqual(items(result).map((item) => item.name), ['Fictieve soep', 'Fictieve salade', 'Fictieve brood'])
  assert.deepEqual(result.excludedSections, [
    { path: ['Fictieve kaart', 'Fictief dagmenu'], unpricedLines: 2, reason: 'service_unit' },
  ])
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: html, homepageUrl: 'https://fictief-voorbeeld.test/menu' })
  assert.ok(
    analysis.limitations.some((line) => /horen bij een arrangement of keuzemenu/.test(line)),
    `expected an arrangement limitation, got: ${analysis.limitations.join(' | ')}`,
  )
})
