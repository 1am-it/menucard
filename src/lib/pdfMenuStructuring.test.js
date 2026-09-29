'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { extractDigitalPdfLines } = require('./pdfTextExtraction')
const { computeFieldEvidenceHash } = require('./fieldEvidenceHash')
const {
  MENU_ITEM_CONFIDENCE,
  isPriceToken,
  pureSectionMarkerNames,
  structurePdfLinesIntoMenu,
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
  assert.deepEqual(structurePdfLinesIntoMenu([]), { categories: [] })
  assert.deepEqual(structurePdfLinesIntoMenu(undefined), { categories: [] })
})

test('structural safety net: never imports an OCR, screenshot, image-rendering, network, or browser-automation dependency', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(require.resolve('./pdfMenuStructuring.js'), 'utf8')
  assert.doesNotMatch(source, /tesseract|puppeteer|playwright|browserless|canvas|screenshot|fetch\(|safeOutboundFetch/i)
})
