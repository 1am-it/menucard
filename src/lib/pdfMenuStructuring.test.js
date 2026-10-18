'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { extractDigitalPdfLines } = require('./pdfTextExtraction')
const { computeFieldEvidenceHash } = require('./fieldEvidenceHash')
const {
  MENU_ITEM_CONFIDENCE,
  isPriceToken,
  classifyNumericEvidence,
  pureSectionMarkerNames,
  structurePdfLinesIntoMenu,
  duplicateLayoutLayer,
  compactPdfLayoutText,
} = require('./pdfMenuStructuring')

// Reused from pdfTextExtraction.test.js's own PDF-fixture-building
// helpers — deliberately duplicated rather than imported, matching this
// project's own "necessary duplication for self-contained test
// fixtures" precedent (e.g. src/lib/restaurantSourceAnalysis.test.js).
function buildTestPdf({ contentStream, contentStreams, mediaBox = [0, 0, 300, 600] }) {
  const streams = contentStreams || [contentStream]
  const pageCount = streams.length
  const pageObjNums = streams.map((_, i) => 3 + i * 2)
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  }
  const fontObjNum = 3 + pageCount * 2
  streams.forEach((stream, i) => {
    const pageNum = pageObjNums[i]
    const contentsNum = pageNum + 1
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [${mediaBox.join(' ')}] /Contents ${contentsNum} 0 R >>`
    objects[contentsNum] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  })
  objects[fontObjNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  const objectNumbers = Object.keys(objects)
    .map(Number)
    .sort((a, b) => a - b)
  const maxObjNum = objectNumbers[objectNumbers.length - 1]

  let pdf = '%PDF-1.4\n'
  const offsets = new Array(maxObjNum + 1).fill(null)
  for (const num of objectNumbers) {
    offsets[num] = Buffer.byteLength(pdf)
    pdf += `${num} 0 obj\n${objects[num]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${maxObjNum + 1}\n0000000000 65535 f \n`
  for (let num = 1; num <= maxObjNum; num += 1) {
    const offset = offsets[num] === null ? 0 : offsets[num]
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${maxObjNum + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

function textAt(x, y, text) {
  const escaped = text.replace(/([()\\])/g, '\\$1')
  return `1 0 0 1 ${x} ${y} Tm (${escaped}) Tj`
}

async function structureFromContentStream(contentStream) {
  const { pages } = await extractDigitalPdfLines(buildTestPdf({ contentStream }))
  return structurePdfLinesIntoMenu(pages)
}

test('isPriceToken: recognizes Dutch/English price shapes, rejects percentages and free text', () => {
  assert.equal(isPriceToken('3.5'), true)
  assert.equal(isPriceToken('12,50'), true)
  assert.equal(isPriceToken('6.5%'), false) // an ABV percentage, never a price
  assert.equal(isPriceToken('Soep'), false)
  assert.equal(isPriceToken(''), false)
  assert.equal(isPriceToken(null), false)
})

test('classifyNumericEvidence: quantity/unit and leading-zero evidence stay, while integer, decimal and comma amounts get one and the same ambiguity decision', () => {
  const words = (...texts) => texts.map((text) => ({ text }))
  // Group words into the pdfjs text items they came from; the grouping may
  // not change the ambiguity decision either.
  const grouped = (...items) =>
    items.flatMap((item, itemIndex) => item.split(/\s+/).filter(Boolean).map((text) => ({ text, itemIndex })))
  // A portion with its unit before the real amount is a quantity.
  assert.deepEqual([...classifyNumericEvidence(words('Oesters', '6', 'st.', '24.00')).nameEmbedded], [1])
  // A serving label after a price without a later amount is not a quantity.
  assert.deepEqual([...classifyNumericEvidence(words('Wijn', '6.5', 'glas')).nameEmbedded], [])
  // A leading 0.0 alcohol-free marker opens the name.
  assert.deepEqual([...classifyNumericEvidence(words('0.0', 'Regrets', '7.50')).nameEmbedded], [0])
  // Review 6249915021 P1: neither the amount's writing style nor the pdfjs
  // text-item grouping may decide whether a row is ambiguous. "6", "6.0" and
  // "6,00" are exactly the same evidence, split, name-glued or whole-line-glued.
  for (const amount of ['6', '6.0', '6,00']) {
    for (const items of [['Wijn', amount, '25'], [`Wijn ${amount}`, '25'], [`Wijn ${amount} 25`]]) {
      const evidence = classifyNumericEvidence(grouped(...items))
      const label = `${amount} in ${JSON.stringify(items)}`
      assert.deepEqual([...evidence.nameEmbedded], [], label)
      assert.deepEqual([...evidence.ambiguous], [1], label)
    }
  }
  // Without grouping metadata there is no proof: "Monkey 47 10.00" and a
  // glass/bottle row have the same layout, so neither reading is claimed.
  const nameNumber = classifyNumericEvidence(words('Monkey', '47', '10.00'))
  assert.deepEqual([...nameNumber.nameEmbedded], [])
  assert.deepEqual([...nameNumber.ambiguous], [1])
  // An explicit variant sequence is never ambiguous.
  const variant = classifyNumericEvidence(words('Wijn', '6.5', '/', '25.0'))
  assert.deepEqual([...variant.nameEmbedded], [])
  assert.deepEqual([...variant.ambiguous], [])
})

test('pureSectionMarkerNames: matches a whole item of "// NAME" (prefix-only, no closing "//" — the real, verified format), never a substring inside ordinary text', () => {
  assert.deepEqual(pureSectionMarkerNames([{ str: '// WARME DRANKEN', x: 0 }]), ['WARME DRANKEN'])
  assert.equal(pureSectionMarkerNames([{ str: 'Zie onze // instagram // pagina', x: 0 }]), null)
  assert.equal(pureSectionMarkerNames([{ str: 'Soep', x: 0 }]), null)
})

test('structurePdfLinesIntoMenu: recognizes a real, reviewable (section, name, price) result from a clean single-column layout — this fix\'s own core acceptance criterion', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// FICTIEVE SECTIE'),
    textAt(20, 80, 'Fictieve Soep'),
    textAt(100, 80, '4.50'),
    textAt(20, 60, 'Fictief Broodje'),
    textAt(100, 60, '3.00'),
    'ET',
  ].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories.length, 1)
  assert.equal(categories[0].name, 'FICTIEVE SECTIE')
  assert.deepEqual(
    categories[0].items.map((it) => ({ name: it.name, price: it.price, desc: it.desc })),
    [
      { name: 'Fictieve Soep', price: '4.50', desc: null },
      { name: 'Fictief Broodje', price: '3.00', desc: null },
    ]
  )
})

test('structurePdfLinesIntoMenu: every recognized item carries confidence "middel", never "hoog", regardless of how clean the match is', async () => {
  const content = ['BT /F1 12 Tf', textAt(20, 100, '// SECTIE'), textAt(20, 80, 'Item'), textAt(100, 80, '5.00'), 'ET'].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories[0].items[0].confidence, MENU_ITEM_CONFIDENCE)
  assert.equal(categories[0].items[0].confidence, 'middel')
  assert.notEqual(categories[0].items[0].confidence, 'hoog')
})

test('structurePdfLinesIntoMenu: every recognized item carries a real content-hash of its own exact evidence line, matching computeFieldEvidenceHash directly', async () => {
  const content = ['BT /F1 12 Tf', textAt(20, 100, '// SECTIE'), textAt(20, 80, 'Item'), textAt(100, 80, '5.00'), 'ET'].join('\n')
  const { categories } = await structureFromContentStream(content)
  const item = categories[0].items[0]
  assert.equal(item.contentHash, computeFieldEvidenceHash('Item 5.00'))
})

test('structurePdfLinesIntoMenu: a description line immediately below, X-aligned with the item\'s own name, is attached — never a new, price-less item', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// SECTIE'),
    textAt(20, 80, 'Fictieve Churros'),
    textAt(100, 80, '11.5'),
    textAt(22, 68, 'Gevuld met kaneelsuiker'),
    'ET',
  ].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories[0].items.length, 1)
  assert.equal(categories[0].items[0].desc, 'Gevuld met kaneelsuiker')
})

test('structurePdfLinesIntoMenu: a same-Y-band line from an unrelated, far-off column is NEVER attached as a description — the X-alignment guard against cross-column contamination', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// SECTIE'),
    textAt(20, 80, 'Fictieve Churros'),
    textAt(100, 80, '11.5'),
    // Far to the right, well outside the tolerance — simulates an
    // unrelated marketing-column line at a similar Y, exactly the real
    // multi-column contamination risk this fix's own diagnosis found.
    textAt(220, 68, 'Onze zaak is al 10 jaar open'),
    'ET',
  ].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories[0].items.length, 1)
  assert.equal(categories[0].items[0].desc, null)
})

test('structurePdfLinesIntoMenu: a price with no preceding name contributes nothing — never a fabricated, nameless item', async () => {
  const content = ['BT /F1 12 Tf', textAt(20, 100, '// SECTIE'), textAt(20, 80, '5.00'), 'ET'].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories.length, 0)
})

test('structurePdfLinesIntoMenu: text with no price and no preceding item is dropped, never becomes a standalone item', async () => {
  const content = ['BT /F1 12 Tf', textAt(20, 100, 'Welkom bij ons restaurant'), 'ET'].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories.length, 0)
})

test('structurePdfLinesIntoMenu: items found before any section marker are bucketed under a category with name: null, never a guessed section name', async () => {
  const content = ['BT /F1 12 Tf', textAt(20, 100, 'Vooraf Item'), textAt(100, 100, '2.50'), 'ET'].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories.length, 1)
  assert.equal(categories[0].name, null)
  assert.equal(categories[0].items[0].name, 'Vooraf Item')
})

test('pureSectionMarkerNames: two side-by-side prefix markers on one row (a real, verified layout — two columns\' headers sharing a Y-position) both match, in line order', () => {
  assert.deepEqual(
    pureSectionMarkerNames([
      { str: '// WARME DRANKEN', x: 20 },
      { str: '// FRISDRANK', x: 160 },
    ]),
    ['WARME DRANKEN', 'FRISDRANK']
  )
})

test('structurePdfLinesIntoMenu: two side-by-side section headers on ONE real PDF line, through the full end-to-end flow — only the first is ever used as the active section; the second is never silently used to misattribute a dish to the wrong section', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// EERSTE KOP'),
    textAt(160, 100, '// TWEEDE KOP'), // same row as the first — the real, verified layout
    textAt(20, 80, 'Testgerecht'),
    textAt(100, 80, '9.50'),
    'ET',
  ].join('\n')
  const { categories } = await structureFromContentStream(content)

  // Exactly one category exists — the first header's own name. The
  // second, side-by-side header is never silently promoted into its
  // own category — this is the documented, unchanged limitation, not a
  // claim that it is now supported.
  assert.equal(categories.length, 1)
  assert.equal(categories[0].name, 'EERSTE KOP')
  assert.equal(categories.some((c) => c.name === 'TWEEDE KOP'), false)

  // The dish that actually follows on the next line is attributed to
  // the first (active) section — never dropped, never attached to a
  // category under the ignored second header's name instead.
  assert.deepEqual(
    categories[0].items.map((it) => ({ name: it.name, price: it.price })),
    [{ name: 'Testgerecht', price: '9.50' }]
  )
})

test('structurePdfLinesIntoMenu: multiple sections on one page are each recognized with their own items', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 200, '// EERSTE SECTIE'),
    textAt(20, 180, 'Item A'),
    textAt(100, 180, '3.00'),
    textAt(20, 140, '// TWEEDE SECTIE'),
    textAt(20, 120, 'Item B'),
    textAt(100, 120, '4.00'),
    'ET',
  ].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories.length, 2)
  assert.deepEqual(categories.map((c) => c.name), ['EERSTE SECTIE', 'TWEEDE SECTIE'])
  assert.equal(categories[0].items[0].name, 'Item A')
  assert.equal(categories[1].items[0].name, 'Item B')
})

test('REGRESSION: "Chardonnay 6.50 / 25.00" is one item with price variants, never a second item named "/"', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// DRANKEN'),
    textAt(20, 80, 'Chardonnay 6.50 / 25.00'),
    'ET',
  ].join('\n')
  const { categories } = await structureFromContentStream(content)
  assert.equal(categories[0].items.length, 1)
  const [item] = categories[0].items
  assert.equal(item.name, 'Chardonnay')
  assert.equal(item.price, null)
  assert.equal(item.priceStatus, 'multiple_undecomposed')
  assert.equal(item.priceText, '6.50 / 25.00')
  assert.deepEqual(item.priceVariants, [{ label: null, price: '6.50' }, { label: null, price: '25.00' }])
  assert.equal(categories[0].items.some((i) => i.name === '/'), false)
});

test('REGRESSION: two real PDF columns and separate baselines never merge into one invented dish', async () => {
  const { categories } = structurePdfLinesIntoMenu([
    {
      lines: [
        {
          items: [
            { x: 22.7, y: 486.98, str: 'Hollands' },
            { x: 72.8, y: 486.98, str: '27' },
            { x: 442.2, y: 486.98, str: 'Lucques olijven' },
            { x: 442.2, y: 485.33, str: 'Frisse olijven uit de Languedoc' },
            { x: 527.3, y: 486.98, str: '8' },
          ],
        },
      ],
    },
  ])
  const items = categories.flatMap((category) => category.items)
  assert.deepEqual(items.map((item) => [item.name, item.price]), [
    ['Hollands', '27'],
    ['Lucques olijven', '8'],
  ])
  assert.equal(items[1].desc, 'Frisse olijven uit de Languedoc')
});

test('integer prices are recognized, but a four-digit year is not', async () => {
  assert.equal(isPriceToken('8'), true)
  assert.equal(isPriceToken('27'), true)
  assert.equal(isPriceToken('2026'), false)
});

test('structurePdfLinesIntoMenu: a description never carries over across a page boundary — reset per page', async () => {
  const { pages } = await extractDigitalPdfLines(
    buildTestPdf({
      contentStreams: [
        ['BT /F1 12 Tf', textAt(20, 100, '// SECTIE'), textAt(20, 80, 'Item'), textAt(100, 80, '5.00'), 'ET'].join('\n'),
        ['BT /F1 12 Tf', textAt(22, 100, 'Beschrijving die op pagina 2 staat'), 'ET'].join('\n'),
      ],
    })
  )
  const { categories } = structurePdfLinesIntoMenu(pages)
  assert.equal(categories[0].items[0].desc, null)
})

test('structurePdfLinesIntoMenu: an empty or missing pages array resolves categories: [], never throws', () => {
  assert.deepEqual(structurePdfLinesIntoMenu([]).categories, [])
  assert.deepEqual(structurePdfLinesIntoMenu(undefined).categories, [])
})

test('REGRESSION (review P1): columns are stable when a row is empty on one side — a right-hand dish never lands under the left heading', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 200, items: [{ str: '// LINKS', x: 20, y: 200 }, { str: '// RECHTS', x: 440, y: 200 }] },
      { y: 180, items: [{ str: 'Linksgerecht', x: 20, y: 180 }, { str: '10.00', x: 100, y: 180 }] },
      { y: 160, items: [{ str: 'Rechtsgerecht', x: 440, y: 160 }, { str: '12.50', x: 520, y: 160 }] },
      { y: 140, items: [{ str: 'Nog links', x: 20, y: 140 }, { str: '11.00', x: 100, y: 140 }] },
    ],
  }
  const { categories } = structurePdfLinesIntoMenu([page])
  const byName = Object.fromEntries(categories.map((category) => [category.name, category.items.map((item) => item.name)]))
  assert.deepEqual(byName.LINKS, ['Linksgerecht', 'Nog links'])
  assert.deepEqual(byName.RECHTS, ['Rechtsgerecht'])
})

test('REGRESSION (review 6249303096 P1): price evidence is per column — a sparse left column keeps its only valid amount when the right column repeats two price positions', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// ETEN', x: 20, y: 400 }, { str: '// DRANKEN', x: 220, y: 400 }] },
      {
        y: 380,
        items: [
          { str: 'Soep', x: 20, y: 380 },
          { str: '8.5', x: 100, y: 380 },
          { str: 'Wijn A', x: 220, y: 380 },
          { str: '6.5', x: 300, y: 380 },
          { str: '/', x: 320, y: 380 },
          { str: '25.0', x: 340, y: 380 },
        ],
      },
      {
        y: 360,
        items: [
          { str: 'Wijn B', x: 220, y: 360 },
          { str: '7.5', x: 300, y: 360 },
          { str: '/', x: 320, y: 360 },
          { str: '28.0', x: 340, y: 360 },
        ],
      },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  const eten = categories.find((category) => category.name === 'ETEN')
  const dranken = categories.find((category) => category.name === 'DRANKEN')
  assert.deepEqual(eten.items.map((item) => [item.name, item.price, item.priceStatus]), [['Soep', '8.5', 'known']])
  assert.deepEqual(
    dranken.items.map((item) => [item.name, item.price, item.priceStatus, item.priceText]),
    [
      ['Wijn A', null, 'multiple_undecomposed', '6.5 / 25.0'],
      ['Wijn B', null, 'multiple_undecomposed', '7.5 / 28.0'],
    ],
  )
  assert.deepEqual(dranken.items[0].priceVariants, [{ label: null, price: '6.5' }, { label: null, price: '25.0' }])
  assert.deepEqual(dranken.items[1].priceVariants, [{ label: null, price: '7.5' }, { label: null, price: '28.0' }])
  assert.equal(layout.ambiguousPriceLines, 0)
  assert.equal(layout.unlinkedPriceLines, 0)
})

test('REGRESSION (review 6249303096 P1): a loose amount far below a name is never linked as its price, and the unlinked price is reported', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 700, items: [{ str: '// DRANKEN', x: 20, y: 700 }] },
      { y: 650, items: [{ str: 'Koffie', x: 20, y: 650 }] },
      { y: 100, items: [{ str: '25.00', x: 100, y: 100 }] },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  const items = categories.flatMap((category) => category.items)
  assert.equal(items.some((item) => item.name === 'Koffie'), false)
  assert.equal(items.some((item) => item.price === '25.00'), false)
  assert.equal(layout.unlinkedPriceLines, 1)
})

test('REGRESSION (review 6249303096 P1): a normal second-baseline distance is still a local name/price relation, a large gap in the same column is not', () => {
  const page = (gap) => ({
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// WARME DRANKEN', x: 20, y: 400 }] },
      { y: 380, items: [{ str: 'Cappuccino', x: 20, y: 380 }] },
      { y: 380 - gap, items: [{ str: '3.8', x: 100, y: 380 - gap }] },
    ],
  })
  const near = structurePdfLinesIntoMenu([page(7)])
  assert.deepEqual(near.categories[0].items.map((item) => [item.name, item.price, item.priceStatus]), [
    ['Cappuccino', '3.8', 'known'],
  ])
  assert.equal(near.layout.unlinkedPriceLines, 0)

  const far = structurePdfLinesIntoMenu([page(60)])
  assert.deepEqual(far.categories.flatMap((category) => category.items), [])
  assert.equal(far.layout.unlinkedPriceLines, 1)
})

test('REGRESSION (review 6249303096 P1): name/price baselines in two columns never borrow the other column’s amount', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// ETEN', x: 20, y: 400 }, { str: '// DRANKEN', x: 220, y: 400 }] },
      { y: 380, items: [{ str: 'Soep', x: 20, y: 380 }, { str: 'Wijn A', x: 220, y: 380 }] },
      { y: 373, items: [{ str: '8.5', x: 100, y: 373 }, { str: '6.5', x: 300, y: 373 }] },
    ],
  }
  const { categories } = structurePdfLinesIntoMenu([page])
  const byName = Object.fromEntries(categories.map((category) => [category.name, category.items.map((item) => [item.name, item.price])]))
  assert.deepEqual(byName.ETEN, [['Soep', '8.5']])
  assert.deepEqual(byName.DRANKEN, [['Wijn A', '6.5']])
})

test('REGRESSION (review 6249303096 P1): two price variants on the next baseline stay one blocked item, never a silent main price', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 380, items: [{ str: 'Wijn A', x: 220, y: 380 }] },
      { y: 374, items: [{ str: '6.5', x: 300, y: 374 }, { str: '/', x: 320, y: 374 }, { str: '25.0', x: 340, y: 374 }] },
      { y: 360, items: [{ str: 'Wijn B', x: 220, y: 360 }] },
      { y: 354, items: [{ str: '7.5', x: 300, y: 354 }, { str: '/', x: 320, y: 354 }, { str: '28.0', x: 340, y: 354 }] },
    ],
  }
  const { categories } = structurePdfLinesIntoMenu([page])
  const items = categories.flatMap((category) => category.items)
  assert.deepEqual(items.map((item) => [item.name, item.price, item.priceStatus, item.priceText]), [
    ['Wijn A', null, 'multiple_undecomposed', '6.5 / 25.0'],
    ['Wijn B', null, 'multiple_undecomposed', '7.5 / 28.0'],
  ])
  assert.deepEqual(items[0].priceVariants, [{ label: null, price: '6.5' }, { label: null, price: '25.0' }])
})

test('REGRESSION (review 6249303096 P1 + 6249915021 P1): an unproven number between a name and a separately positioned price is reported, never claimed as price or as name text; explicit evidence still parses', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// DRANKEN', x: 20, y: 400 }] },
      // "Monkey 47" glued by pdfjs is still indistinguishable from a
      // glass/bottle row: a name number and an amount column look the same.
      { y: 380, items: [{ str: 'Monkey 47', x: 20, y: 380 }, { str: '10.0', x: 100, y: 380 }] },
      { y: 360, items: [{ str: 'Ceremonial Matcha 0.0', x: 20, y: 360 }, { str: '5.5', x: 100, y: 360 }] },
      { y: 340, items: [{ str: 'Proeverij van 4 Kazen van', x: 20, y: 340 }, { str: '14.5', x: 100, y: 340 }] },
      { y: 320, items: [{ str: 'Pornstar Martini Boom 6 st.', x: 20, y: 320 }, { str: '65.0', x: 100, y: 320 }] },
      // pdfjs can merge a trailing price into the name item; with no separate
      // price run on the line, that trailing amount is still the price.
      { y: 300, items: [{ str: 'Fictief Broodje 3.00', x: 20, y: 300 }] },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  // A unit ("6 st."), a leading 0.0 marker, a name word after the number and a
  // single trailing amount stay provable. The bare "Monkey 47" + "10.0" row
  // does not: it is reported instead of inventing either reading.
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [
    ['Ceremonial Matcha 0.0', '5.5'],
    ['Proeverij van 4 Kazen van', '14.5'],
    ['Pornstar Martini Boom 6 st.', '65.0'],
    ['Fictief Broodje', '3.00'],
  ])
  assert.equal(categories.some((category) => category.items.some((item) => item.price === '47' || item.name === 'Monkey 47')), false)
  assert.equal(layout.ambiguousPriceLines, 1)
  assert.equal(layout.unlinkedPriceLines, 0)
})

test('REGRESSION (review P1): an identical, overlapping second text layer is ignored instead of merging two dish names', () => {
  const base = [
    ['Hollands', '27'],
    ['Zwitsers', '29.5'],
    ['Truffel', '28'],
    ['Italiaans', '29.5'],
    ['Frans', '29.5'],
    ['Spaans', '27'],
  ]
  const lines = [{ y: 300, items: [{ str: '// KAASFONDUE', x: 20, y: 300, seq: 0 }] }]
  base.forEach(([name, price], i) => {
    lines.push({ y: 280 - i * 20, items: [{ str: name, x: 20, y: 280 - i * 20, seq: 1 + i * 2 }, { str: price, x: 90, y: 280 - i * 20, seq: 2 + i * 2 }] })
  })
  // The overlay: the same block drawn 40 units higher, later in the stream.
  lines.push({ y: 340, items: [{ str: '// KAASFONDUE', x: 20, y: 340, seq: 40 }] })
  base.forEach(([name, price], i) => {
    lines.push({ y: 320 - i * 20, items: [{ str: name, x: 20, y: 320 - i * 20, seq: 41 + i * 2 }, { str: price, x: 90, y: 320 - i * 20, seq: 42 + i * 2 }] })
  })
  const { categories, layout } = structurePdfLinesIntoMenu([{ pageNumber: 1, lines }])
  assert.equal(layout.duplicateLayerItems, 13)
  assert.deepEqual(categories.flatMap((category) => category.items.map((item) => [item.name, item.price])), base)
})

test('a legitimately repeated dish list further down the page is never treated as an overlay', () => {
  const lines = [{ y: 400, items: [{ str: '// LUNCH', x: 20, y: 400, seq: 0 }] }]
  ;['Soep 5.00', 'Brood 3.00', 'Salade 6.00', 'Taart 4.00', 'Koffie 2.50'].forEach((line, i) => {
    const [name, price] = line.split(' ')
    lines.push({ y: 380 - i * 20, items: [{ str: name, x: 20, y: 380 - i * 20, seq: 1 + i * 2 }, { str: price, x: 90, y: 380 - i * 20, seq: 2 + i * 2 }] })
  })
  lines.push({ y: 200, items: [{ str: '// DINER', x: 20, y: 200, seq: 30 }] })
  ;['Soep 5.00', 'Brood 3.00', 'Salade 6.00', 'Taart 4.00', 'Koffie 2.50'].forEach((line, i) => {
    const [name, price] = line.split(' ')
    lines.push({ y: 180 - i * 20, items: [{ str: name, x: 20, y: 180 - i * 20, seq: 31 + i * 2 }, { str: price, x: 90, y: 180 - i * 20, seq: 32 + i * 2 }] })
  })
  const { categories, layout } = structurePdfLinesIntoMenu([{ pageNumber: 1, lines }])
  assert.equal(layout.duplicateLayerItems, 0)
  const byName = Object.fromEntries(categories.map((category) => [category.name, category.items.length]))
  assert.deepEqual(byName, { LUNCH: 5, DINER: 5 })
})

test('REGRESSION: a number inside a description never becomes the previous dish\'s price', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 200, items: [{ str: '// BORREL', x: 20, y: 200 }] },
      { y: 180, items: [{ str: 'Oude boeren kaas', x: 20, y: 180 }, { str: '8', x: 120, y: 180 }] },
      { y: 160, items: [{ str: 'Klassieke Stolwijker van 2,5 jaar oud met huisgemaakte chutney', x: 20, y: 160 }] },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [['Oude boeren kaas', '8']])
  assert.equal(categories[0].items[0].desc, 'Klassieke Stolwijker van 2,5 jaar oud met huisgemaakte chutney')
  // The number inside the prose is not a price position at all now, so it is
  // neither an item nor an ambiguous price line.
  assert.equal(layout.ambiguousPriceLines, 0)
  assert.equal(layout.unlinkedPriceLines, 0)
})

test('REGRESSION: a supplement line is never disguised as an ordinary dish; it is skipped and counted', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 200, items: [{ str: '// LUNCH', x: 20, y: 200 }] },
      { y: 180, items: [{ str: 'Brood', x: 20, y: 180 }, { str: '6', x: 80, y: 180 }] },
      { y: 160, items: [{ str: '+ Bresaola', x: 20, y: 160 }, { str: '15', x: 110, y: 160 }] },
      { y: 140, items: [{ str: '+', x: 20, y: 140 }, { str: '5', x: 60, y: 140 }] },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  assert.deepEqual(categories[0].items.map((item) => item.name), ['Brood'])
  assert.equal(layout.supplementLines, 2)
})

test('REGRESSION (review 6249303096 P1): explicit "Supplement" lines and their lowercase wrapped continuation stay supplements, never ordinary dishes', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// LUNCH', x: 20, y: 400 }] },
      { y: 380, items: [{ str: 'Brood', x: 20, y: 380 }, { str: '6', x: 80, y: 380 }] },
      { y: 360, items: [{ str: 'Supplement serranoham', x: 20, y: 360 }, { str: '2.5', x: 100, y: 360 }] },
      { y: 340, items: [{ str: 'Supplement krokante', x: 20, y: 340 }] },
      { y: 320, items: [{ str: 'prosciutto', x: 20, y: 320 }, { str: '2.5', x: 100, y: 320 }] },
      { y: 300, items: [{ str: 'Burrata Primavera', x: 20, y: 300 }, { str: '14.5', x: 100, y: 300 }] },
      { y: 280, items: [{ str: 'Supplement dun gesneden', x: 20, y: 280 }] },
      { y: 260, items: [{ str: 'Spicy Cauli Crunch', x: 20, y: 260 }, { str: '11.5', x: 100, y: 260 }] },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  assert.deepEqual(categories[0].items.map((item) => [item.name, item.price]), [
    ['Brood', '6'],
    ['Burrata Primavera', '14.5'],
    ['Spicy Cauli Crunch', '11.5'],
  ])
  // Inline supplement, wrapped supplement heading + continuation, and the
  // heading whose next line is a real capitalized dish are all handled.
  assert.equal(layout.supplementLines, 4)
})

test('REGRESSION (review 6252891629 P1): an explicit // supplement heading protects the whole section until the next real section', () => {
  const rows = [
    ['Havermelk', '0.5'],
    ['Hazelnootsiroop', '0.6'],
    ['Karamelsiroop', '0.6'],
    ['Witte chocoladesiroop', '0.6'],
    ['Honing', '0.6'],
    ['Slagroom', '0.6'],
  ]
  const lines = [
    { y: 400, items: [{ str: '// WARME DRANKEN', x: 20, y: 400 }] },
    { y: 380, items: [{ str: 'Koffie', x: 20, y: 380 }, { str: '3.5', x: 100, y: 380 }] },
    { y: 360, items: [{ str: '// SUPPLEMENTEN', x: 20, y: 360 }] },
    ...rows.map(([name, price], index) => ({
      y: 340 - index * 20,
      items: [{ str: name, x: 20, y: 340 - index * 20 }, { str: price, x: 100, y: 340 - index * 20 }],
    })),
    { y: 200, items: [{ str: '// DESSERTS', x: 20, y: 200 }] },
    { y: 180, items: [{ str: 'Taart', x: 20, y: 180 }, { str: '6', x: 100, y: 180 }] },
  ]
  const { categories, layout } = structurePdfLinesIntoMenu([{ pageNumber: 2, lines }])
  // The supplement rows never become ordinary dishes with a main price.
  assert.deepEqual(categories.map((category) => [category.name, category.items.map((item) => item.name)]), [
    ['WARME DRANKEN', ['Koffie']],
    ['DESSERTS', ['Taart']],
  ])
  assert.equal(layout.supplementLines, 6)
  // Bounded provenance: heading and page, never item text.
  assert.deepEqual(layout.supplementSections, [{ heading: 'SUPPLEMENTEN', pages: [2], lines: 6 }])
  assert.deepEqual(categories.find((category) => category.name === 'DESSERTS').items.map((item) => [item.name, item.price]), [
    ['Taart', '6'],
  ])
  assert.equal(layout.unlinkedPriceLines, 0)
})

test('REGRESSION (review 6252891629 P1): a recognizable plain supplement heading opens the same section, while a singular inline "Supplement" row does not', () => {
  const plain = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: 'SUPPLEMENTEN (per stuk)', x: 20, y: 400 }] },
      { y: 380, items: [{ str: 'Havermelk', x: 20, y: 380 }, { str: '0.5', x: 100, y: 380 }] },
      { y: 360, items: [{ str: 'Honing', x: 20, y: 360 }, { str: '0.6', x: 100, y: 360 }] },
      { y: 340, items: [{ str: '// DESSERTS', x: 20, y: 340 }] },
      { y: 320, items: [{ str: 'Taart', x: 20, y: 320 }, { str: '6', x: 100, y: 320 }] },
    ],
  }
  const structured = structurePdfLinesIntoMenu([plain])
  assert.deepEqual(structured.categories.map((category) => category.name), ['DESSERTS'])
  assert.equal(structured.layout.supplementLines, 2)
  assert.deepEqual(structured.layout.supplementSections, [{ heading: 'SUPPLEMENTEN (per stuk)', pages: [1], lines: 2 }])

  // The existing inline forms keep working: a capitalized dish after the
  // wrapped "Supplement ..." continuation is not swallowed by a section.
  const inline = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// LUNCH', x: 20, y: 400 }] },
      { y: 380, items: [{ str: 'Supplement krokante', x: 20, y: 380 }] },
      { y: 360, items: [{ str: 'prosciutto', x: 20, y: 360 }, { str: '2.5', x: 100, y: 360 }] },
      { y: 340, items: [{ str: 'Burrata Primavera', x: 20, y: 340 }, { str: '14.5', x: 100, y: 340 }] },
    ],
  }
  const inlineStructured = structurePdfLinesIntoMenu([inline])
  assert.deepEqual(inlineStructured.categories.flatMap((category) => category.items.map((item) => item.name)), ['Burrata Primavera'])
  assert.equal(inlineStructured.layout.supplementLines, 2)
  assert.deepEqual(inlineStructured.layout.supplementSections, [])
})

test('REGRESSION (review 6252891629 P1): a supplement section is column- and page-safe and never captures a neighbouring column', () => {
  const page = {
    pageNumber: 2,
    lines: [
      { y: 400, items: [{ str: '// SUPPLEMENTEN', x: 20, y: 400 }, { str: '// FRISDRANK', x: 220, y: 400 }] },
      { y: 380, items: [{ str: 'Havermelk', x: 20, y: 380 }, { str: '0.5', x: 100, y: 380 }, { str: 'Pepsi', x: 220, y: 380 }, { str: '3.6', x: 300, y: 380 }] },
      { y: 360, items: [{ str: 'Honing', x: 20, y: 360 }, { str: '0.6', x: 100, y: 360 }, { str: 'Fristi', x: 220, y: 360 }, { str: '3.6', x: 300, y: 360 }] },
      { y: 340, items: [{ str: '// DESSERTS', x: 20, y: 340 }] },
      { y: 320, items: [{ str: 'Taart', x: 20, y: 320 }, { str: '6', x: 100, y: 320 }] },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  const byName = Object.fromEntries(categories.map((category) => [category.name, category.items.map((item) => item.name)]))
  assert.deepEqual(byName.FRISDRANK, ['Pepsi', 'Fristi'])
  assert.deepEqual(byName.DESSERTS, ['Taart'])
  assert.equal(categories.some((category) => category.items.some((item) => ['Havermelk', 'Honing'].includes(item.name))), false)
  assert.deepEqual(layout.supplementSections, [{ heading: 'SUPPLEMENTEN', pages: [2], lines: 2 }])
  assert.equal(layout.supplementLines, 2)

  // A new page starts without supplement state: its rows are ordinary content
  // and are never swallowed by the previous page's section.
  const nextPage = {
    pageNumber: 3,
    lines: [
      { y: 400, items: [{ str: '// LUNCH', x: 20, y: 400 }] },
      { y: 380, items: [{ str: 'Soep', x: 20, y: 380 }, { str: '5', x: 100, y: 380 }] },
    ],
  }
  const next = structurePdfLinesIntoMenu([page, nextPage])
  assert.equal(next.categories.some((category) => category.items.some((item) => item.name === 'Soep')), true)
  assert.deepEqual(next.layout.supplementSections, [{ heading: 'SUPPLEMENTEN', pages: [2], lines: 2 }])
})


test('plain section labels: a capitalized known heading counts, a lowercase wrapped fragment never does', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 200, 'Diner 17:30 - 21:30'),
    textAt(20, 180, 'Soep'),
    textAt(100, 180, '5.00'),
    'ET',
  ].join('\n')
  const { pages } = await extractDigitalPdfLines(buildTestPdf({ contentStream: content }))
  assert.equal(structurePdfLinesIntoMenu(pages).categories[0].name, 'Diner')

  const lower = { pageNumber: 1, lines: [{ y: 200, items: [{ str: 'kaasfondue', x: 20, y: 200 }, { str: 'Soep', x: 20, y: 180 }, { str: '5.00', x: 100, y: 180 }] }] }
  const structured = structurePdfLinesIntoMenu([lower])
  assert.deepEqual(structured.categories.map((category) => category.name), [null])
})

test('plain sub-headings below a menu heading keep their parent path, and an arrangement lead-in is not glued to a dish', () => {
  const line = (y, left, right) => {
    const items = []
    if (left) items.push({ str: left, x: 20, y })
    if (right) items.push({ str: right, x: 440, y })
    return { y, items }
  }
  const pair = (y, name, price, xName, xPrice) => ({ y, items: [{ str: name, x: xName, y }, { str: price, x: xPrice, y }] })
  const lines = [
    line(500, 'BORREL Om te delen vanaf 14:30', 'LUNCH 12:00 – 15:00'),
    line(480, null, 'Eieren'),
    pair(470, 'Brood', '6', 20, 100),
    pair(450, 'Omelette du fromage (V)', '11', 440, 560),
    pair(430, 'Rillette van gerookte makreel', '12', 20, 100),
    line(410, 'Met zwarte peper mayonaise en bruschetta', null),
    line(400, null, 'Broodjes'),
    pair(390, 'Groninger mozzarella (V)', '12', 440, 560),
    line(370, 'Kaasfondue naar keuze', null),
    line(360, 'Voor 1, 2 of 4 personen', null),
    line(350, null, 'Overig'),
    pair(340, 'Tosti (V)', '8', 440, 560),
  ]
  const { categories, layout } = structurePdfLinesIntoMenu([{ pageNumber: 2, lines }])
  assert.deepEqual(categories.map((category) => category.path), [
    ['BORREL'],
    ['LUNCH', 'Eieren'],
    ['LUNCH', 'Broodjes'],
    ['LUNCH', 'Overig'],
  ])
  // The nesting is inferred from order, never typography: it stays reviewable.
  assert.deepEqual(categories.filter((category) => category.path[0] === 'LUNCH').map((category) => category.uncertain === true), [true, true, true])
  const rillette = categories[0].items.find((item) => item.name === 'Rillette van gerookte makreel')
  assert.equal(rillette.desc, 'Met zwarte peper mayonaise en bruschetta')
  assert.equal(layout.arrangementLines, 1)
})

test('REGRESSION (review 6249657793 P1 + 6249915021 P1): portions with a unit and a leading 0.0 stay name evidence, while a bare name/number pair is reported instead of guessed, glued or split', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// DRANKEN', x: 20, y: 400 }] },
      // Split by pdfjs: name, name number and real amount as three items.
      // A gin number and a glass amount have this exact same shape, so no
      // reading is claimed (review 6249915021 P1).
      { y: 380, items: [{ str: 'Monkey', x: 20, y: 380 }, { str: '47', x: 60, y: 380 }, { str: '10.00', x: 120, y: 380 }] },
      // Glued by pdfjs: the same unproven shape, same decision.
      { y: 360, items: [{ str: 'Monkey 47', x: 20, y: 360 }, { str: '10.00', x: 120, y: 360 }] },
      // Split portion with its unit: the unit is explicit local evidence.
      { y: 340, items: [{ str: 'Oesters', x: 20, y: 340 }, { str: '6', x: 60, y: 340 }, { str: 'st.', x: 75, y: 340 }, { str: '24.00', x: 120, y: 340 }] },
      { y: 320, items: [{ str: 'Oesters 6 st.', x: 20, y: 320 }, { str: '24.00', x: 120, y: 320 }] },
      // Split alcohol-free marker: the leading number starts the name.
      { y: 300, items: [{ str: '0.0', x: 20, y: 300 }, { str: 'Regrets', x: 50, y: 300 }, { str: '7.50', x: 120, y: 300 }] },
      // A bare quantity without unit text is not proven: report the row.
      { y: 280, items: [{ str: 'Oesters', x: 20, y: 280 }, { str: '6', x: 60, y: 280 }, { str: '24.00', x: 120, y: 280 }] },
      // A real integer amount keeps working.
      { y: 260, items: [{ str: 'Soep', x: 20, y: 260 }, { str: '8', x: 120, y: 260 }] },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  assert.deepEqual(categories.flatMap((category) => category.items.map((item) => [item.name, item.price, item.priceStatus])), [
    ['Oesters 6 st.', '24.00', 'known'],
    ['Oesters 6 st.', '24.00', 'known'],
    ['0.0 Regrets', '7.50', 'known'],
    ['Soep', '8', 'known'],
  ])
  // No invented "st." item, no bogus known price 47/6 and no invented name.
  assert.equal(categories.some((category) => category.items.some((item) => item.name === 'st.' || item.name === 'Monkey 47' || item.name === 'Oesters 6' || ['47', '6'].includes(item.price))), false)
  assert.equal(layout.ambiguousPriceLines, 3)
  assert.equal(layout.unlinkedPriceLines, 0)
  assert.equal(layout.unrecognizedHeadingLines, 0)
})

test('REGRESSION (review 6249915021 P1): "Wijn 6 25", "Wijn 6.0 25.0" and "Wijn 6,00 25,00" get one identical ambiguity outcome for split items, a name-glued number and a whole-line merge — never a silent name or known price', () => {
  const run = (items) => {
    const { categories, layout } = structurePdfLinesIntoMenu([
      {
        pageNumber: 1,
        lines: [
          { y: 400, items: [{ str: '// DRANKEN', x: 20, y: 400 }] },
          { y: 380, items },
        ],
      },
    ])
    return {
      items: categories.flatMap((category) => category.items.map((item) => [item.name, item.price, item.priceStatus])),
      ambiguousPriceLines: layout.ambiguousPriceLines,
      unlinkedPriceLines: layout.unlinkedPriceLines,
    }
  }
  const shapesFor = (second, third) => ({
    // Split by pdfjs, the reviewer's exact repro geometry and a near variant.
    split: run([{ str: 'Wijn', x: 20, y: 380 }, { str: second, x: 100, y: 380 }, { str: third, x: 160, y: 380 }]),
    splitNearName: run([{ str: 'Wijn', x: 20, y: 380 }, { str: second, x: 60, y: 380 }, { str: third, x: 120, y: 380 }]),
    // Two widely separated amount columns are still two unproven amounts.
    splitFarColumns: run([{ str: 'Wijn', x: 20, y: 380 }, { str: second, x: 100, y: 380 }, { str: third, x: 220, y: 380 }]),
    // A number glued into the name item is not proof: pdfjs also merges a name
    // and a nearby amount into one item.
    gluedNameNumber: run([{ str: `Wijn ${second}`, x: 20, y: 380 }, { str: third, x: 160, y: 380 }]),
    // pdfjs merged the whole row: the grouping proves nothing.
    gluedWholeLine: run([{ str: `Wijn ${second} ${third}`, x: 20, y: 380 }]),
  })
  const spellings = [['6', '25'], ['6.0', '25.0'], ['6,00', '25,00']]
  const byShape = new Map()
  for (const [second, third] of spellings) {
    for (const [shape, outcome] of Object.entries(shapesFor(second, third))) {
      if (!byShape.has(shape)) byShape.set(shape, [])
      byShape.get(shape).push(JSON.stringify(outcome))
    }
  }
  // The amount's notation never changes the safety decision for one shape.
  for (const [shape, outcomes] of byShape) assert.equal(new Set(outcomes).size, 1, shape)

  const expected = {
    split: { items: [], ambiguousPriceLines: 1, unlinkedPriceLines: 0 },
    splitNearName: { items: [], ambiguousPriceLines: 1, unlinkedPriceLines: 0 },
    splitFarColumns: { items: [], ambiguousPriceLines: 1, unlinkedPriceLines: 0 },
    gluedNameNumber: { items: [], ambiguousPriceLines: 1, unlinkedPriceLines: 0 },
    gluedWholeLine: { items: [], ambiguousPriceLines: 1, unlinkedPriceLines: 0 },
  }
  assert.deepEqual(shapesFor('6', '25'), expected)
})

test('REGRESSION (review 6249915021 P1): explicit units, a separator, a single integer price and multiple dishes/columns keep their proven behaviour', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// ETEN', x: 20, y: 400 }, { str: '// DRANKEN', x: 220, y: 400 }] },
      {
        y: 380,
        items: [
          { str: 'Oesters', x: 20, y: 380 },
          { str: '6', x: 60, y: 380 },
          { str: 'st.', x: 75, y: 380 },
          { str: '24', x: 100, y: 380 },
          { str: 'Wijn A', x: 220, y: 380 },
          { str: '6.5', x: 300, y: 380 },
          { str: '/', x: 320, y: 380 },
          { str: '25.0', x: 340, y: 380 },
        ],
      },
      {
        y: 360,
        items: [
          { str: 'Soep', x: 20, y: 360 },
          { str: '8', x: 100, y: 360 },
          { str: 'Wijn B', x: 220, y: 360 },
          { str: '7.5', x: 300, y: 360 },
          { str: '/', x: 320, y: 360 },
          { str: '28.0', x: 340, y: 360 },
        ],
      },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  const byName = Object.fromEntries(categories.map((category) => [category.name, category.items.map((item) => [item.name, item.price, item.priceStatus, item.priceText])]))
  assert.deepEqual(byName.ETEN, [
    ['Oesters 6 st.', '24', 'known', undefined],
    ['Soep', '8', 'known', undefined],
  ])
  assert.deepEqual(byName.DRANKEN, [
    ['Wijn A', null, 'multiple_undecomposed', '6.5 / 25.0'],
    ['Wijn B', null, 'multiple_undecomposed', '7.5 / 28.0'],
  ])
  assert.equal(layout.ambiguousPriceLines, 0)
  assert.equal(layout.unlinkedPriceLines, 0)
})

test('REGRESSION (review 6249657793 P1): two dishes on one row without page anchors, multiple columns, explicit glass/bottle variants and supplements stay safe', () => {
  // No repeated letter-bearing X positions: the page has no column anchors, so
  // this row must still be read as two independent (name, price) pairs.
  const singleRow = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// ETEN', x: 20, y: 400 }] },
      { y: 380, items: [{ str: 'Soep', x: 20, y: 380 }, { str: '8', x: 100, y: 380 }, { str: 'Wijn', x: 220, y: 380 }, { str: '6', x: 300, y: 380 }] },
    ],
  }
  const row = structurePdfLinesIntoMenu([singleRow])
  assert.deepEqual(row.categories.flatMap((category) => category.items.map((item) => [item.name, item.price])), [
    ['Soep', '8'],
    ['Wijn', '6'],
  ])
  assert.equal(row.layout.ambiguousPriceLines, 0)

  // Two real marker-defined columns, a split quantity in the left column, an
  // explicit glass/bottle variant in the right column and a supplement line.
  const page = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// ETEN', x: 20, y: 400 }, { str: '// DRANKEN', x: 220, y: 400 }] },
      {
        y: 380,
        items: [
          { str: 'Soep', x: 20, y: 380 },
          { str: '8.5', x: 100, y: 380 },
          { str: 'Wijn A', x: 220, y: 380 },
          { str: '6.5', x: 300, y: 380 },
          { str: '/', x: 320, y: 380 },
          { str: '25.0', x: 340, y: 380 },
        ],
      },
      {
        y: 360,
        items: [
          { str: 'Brood', x: 20, y: 360 },
          { str: '6', x: 100, y: 360 },
          { str: 'Wijn B', x: 220, y: 360 },
          { str: '7.5', x: 300, y: 360 },
          { str: '/', x: 320, y: 360 },
          { str: '28.0', x: 340, y: 360 },
        ],
      },
      { y: 340, items: [{ str: '+ Bresaola', x: 20, y: 340 }, { str: '15', x: 100, y: 340 }] },
      { y: 320, items: [{ str: 'Oesters', x: 20, y: 320 }, { str: '6', x: 60, y: 320 }, { str: 'st.', x: 75, y: 320 }, { str: '24.00', x: 120, y: 320 }] },
    ],
  }
  const structured = structurePdfLinesIntoMenu([page])
  const eten = structured.categories.find((category) => category.name === 'ETEN')
  const dranken = structured.categories.find((category) => category.name === 'DRANKEN')
  assert.deepEqual(eten.items.map((item) => [item.name, item.price]), [
    ['Soep', '8.5'],
    ['Brood', '6'],
    ['Oesters 6 st.', '24.00'],
  ])
  assert.deepEqual(dranken.items.map((item) => [item.name, item.price, item.priceStatus, item.priceText]), [
    ['Wijn A', null, 'multiple_undecomposed', '6.5 / 25.0'],
    ['Wijn B', null, 'multiple_undecomposed', '7.5 / 28.0'],
  ])
  assert.equal(structured.layout.supplementLines, 1)
  assert.equal(structured.layout.ambiguousPriceLines, 0)
  assert.equal(structured.layout.unlinkedPriceLines, 0)
})

test('REGRESSION (review 6249657793 P1): a decimal number before the trailing amount with no separator is reported as ambiguous, never claimed as a known price or silently turned into a name', () => {
  const page = {
    pageNumber: 1,
    lines: [
      { y: 400, items: [{ str: '// DRANKEN', x: 20, y: 400 }] },
      { y: 380, items: [{ str: 'Koffie', x: 20, y: 380 }, { str: '3.5', x: 120, y: 380 }] },
      // "Wijn 6.5 25.0" without "/" could be a name number or a glass price:
      // the layout does not prove which, so no item and no price are claimed.
      { y: 360, items: [{ str: 'Wijn', x: 20, y: 360 }, { str: '6.5', x: 60, y: 360 }, { str: '25.0', x: 120, y: 360 }] },
      { y: 340, items: [{ str: 'Soep', x: 20, y: 340 }, { str: '5.0', x: 120, y: 340 }] },
    ],
  }
  const { categories, layout } = structurePdfLinesIntoMenu([page])
  assert.deepEqual(categories.flatMap((category) => category.items.map((item) => [item.name, item.price])), [
    ['Koffie', '3.5'],
    ['Soep', '5.0'],
  ])
  assert.equal(layout.ambiguousPriceLines, 1)
  assert.equal(layout.unlinkedPriceLines, 0)
})

test('REGRESSION (review 6249657793 P1): a price run from a neighbouring, merged column cluster is never glued onto the following right-hand name', () => {
  // The real De Botanist shape: a left-column price (5.5) shares a baseline
  // with a right-hand name/price pair, and the page anchors merge those X
  // positions into one cluster. The orphan price must not become a name prefix.
  const page = {
    pageNumber: 3,
    lines: [
      { y: 546, items: [{ str: '// PREMIUM FRISDRANKEN', x: 36, y: 546 }] },
      { y: 526, items: [{ str: 'Cultcha Kombucha', x: 42, y: 526 }, { str: '5.5', x: 184, y: 526 }, { str: '// Double Dutch', x: 227, y: 526 }] },
      { y: 514, items: [{ str: 'Passionfruit & Lime', x: 42, y: 514 }, { str: 'Ginger Beer', x: 227, y: 514 }, { str: '4.6', x: 369, y: 514 }] },
      { y: 504, items: [{ str: 'Cultcha Kombucha', x: 42, y: 504 }, { str: '5.5', x: 184, y: 504 }, { str: 'Pink Grapefruit Soda', x: 227, y: 504 }, { str: '4.6', x: 369, y: 504 }] },
    ],
  }
  const { categories } = structurePdfLinesIntoMenu([page])
  const items = categories.flatMap((category) => category.items.map((item) => [item.name, item.price]))
  assert.deepEqual(items.filter(([name]) => /Ginger Beer|Grapefruit Soda/.test(name)), [
    ['Ginger Beer', '4.6'],
    ['Pink Grapefruit Soda', '4.6'],
  ])
  // The left column's own 5.5 stays its own item; it is never a name prefix.
  // Review 6250261342: the wrapped variant line "Passionfruit & Lime" is now
  // joined to its own name on explicit evidence (a short "&" variant list and
  // the repeated "Cultcha" prefix on the next priced item). The price relation
  // itself is unchanged: the orphan 5.5 never becomes a name and no amount is
  // borrowed from the right column.
  assert.deepEqual(items.filter(([name]) => name.startsWith('Cultcha Kombucha')), [
    ['Cultcha Kombucha Passionfruit & Lime', '5.5'],
    ['Cultcha Kombucha', '5.5'],
  ])
  assert.equal(items.some(([name]) => name.startsWith('5.5')), false)
})

test('compactPdfLayoutText: bounded, page-aware, column-aware, and free of the duplicate overlay', () => {
  const base = ['Soep 5.00', 'Brood 3.00', 'Salade 6.00', 'Taart 4.00', 'Koffie 2.50']
  const lines = [{ y: 300, items: [{ str: '// LINKS', x: 20, y: 300, seq: 0 }, { str: '// RECHTS', x: 440, y: 300, seq: 1 }] }]
  base.forEach((line, i) => {
    const [name, price] = line.split(' ')
    lines.push({
      y: 280 - i * 20,
      items: [
        { str: name, x: 20, y: 280 - i * 20, seq: 2 + i * 2 },
        { str: price, x: 100, y: 280 - i * 20, seq: 3 + i * 2 },
        ...(i === 0 ? [{ str: 'Bier', x: 440, y: 280, seq: 60 }, { str: '3.00', x: 500, y: 280, seq: 61 }] : []),
      ],
    })
  })
  // The same left column drawn 40 units higher, later in the stream.
  lines.push({ y: 340, items: [{ str: '// LINKS', x: 20, y: 340, seq: 40 }] })
  base.forEach((line, i) => {
    const [name, price] = line.split(' ')
    lines.push({
      y: 320 - i * 20,
      items: [
        { str: name, x: 20, y: 320 - i * 20, seq: 41 + i * 2 },
        { str: price, x: 100, y: 320 - i * 20, seq: 42 + i * 2 },
      ],
    })
  })
  const { text, truncated } = compactPdfLayoutText([{ pageNumber: 1, lines }], { maxChars: 500 })
  assert.equal(truncated, false)
  assert.match(text, /Pagina 1/)
  assert.match(text, /Soep 5\.00 \| Bier 3\.00/)
  assert.equal((text.match(/Soep/g) || []).length, 1)

  const bounded = compactPdfLayoutText([{ pageNumber: 1, lines }], { maxChars: 12 })
  assert.equal(bounded.truncated, true)
  assert.equal(bounded.text.length <= 12, true)
})

test('duplicateLayoutLayer: no content-stream sequence means no suppression, never a guess', () => {
  const page = { lines: [{ y: 100, items: [{ str: 'Soep', x: 20, y: 100 }] }] }
  assert.deepEqual(duplicateLayoutLayer(page), { suppressedSeqs: new Set(), count: 0, offset: null })
})

test('structural safety net: never imports an OCR, screenshot, image-rendering, network, or browser-automation dependency', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(require.resolve('./pdfMenuStructuring.js'), 'utf8')
  assert.doesNotMatch(source, /tesseract|puppeteer|playwright|browserless|canvas|screenshot|fetch\(|safeOutboundFetch/i)
})
