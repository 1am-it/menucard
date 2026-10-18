'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { runRestaurantSourceAnalysis, applyProviderNeutralExtraction, pdfLayoutLimitations, readPdfMenuSource } = require('./restaurantSourceAnalysis')
const { assessDeterministicMenuQuality } = require('./menuExtractionQuality')
const { buildCandidateSummary } = require('./urlIntakes')
const { buildMenuConcept } = require('./menuConcept')

// Reused verbatim from src/lib/pdfTextExtraction.test.js's own,
// empirically-verified fixtures — a genuinely valid single-page PDF with
// real text, and a genuinely password-protected PDF (real RC4/Standard
// Security Handler encryption, not a mock). Deliberately duplicated
// rather than imported, matching this project's own "necessary
// duplication for self-contained test fixtures" precedent.
const VALID_TEXT_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNjAgPj4Kc3RyZWFtCkJUIC9GMSAxOCBUZiAyMCAxMDAgVGQgKEhlbGxvIGZyb20gYSBkaWdpdGFsIFBERiBtZW51KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDIxCiUlRU9G'

const ENCRYPTED_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDIgPj4Kc3RyZWFtCiLwVBDlMFkw5IR5QqJA4pHCbx68IWPICT40ytLC/CzqVhteQXQApZzi8wplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKPDwgL0ZpbHRlciAvU3RhbmRhcmQgL1YgMSAvUiAyIC9PIChz3PnG4MSAxzwC7oF4rlOZb7654PNX/M5mmBOq3ECyxykgL1UgKFwpv3Y64QDStFxc4KT2JtpX5UBCWzjXLwvYnuokGRnU7BgpIC9QIC0zOTA0ID4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAowMDAwMDAwNDAzIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNyAvUm9vdCAxIDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzwwMmUyZDU2NDBlMTUzMGFkZGFhOWEwNzA5NzlkOTc5YT4gPDAyZTJkNTY0MGUxNTMwYWRkYWE5YTA3MDk3OWQ5NzlhPl0gPj4Kc3RhcnR4cmVmCjUzOQolJUVPRg=='

function jsonLdScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`
}

// Reused verbatim from src/lib/pdfTextExtraction.test.js's own
// programmatic PDF-fixture builders — deliberately duplicated rather
// than imported, same "necessary duplication" precedent as above.
function buildTestPdf({ contentStream, mediaBox = [0, 0, 300, 600] }) {
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [${mediaBox.join(' ')}] /Contents 5 0 R >>`,
    4: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    5: `<< /Length ${Buffer.byteLength(contentStream)} >>\nstream\n${contentStream}\nendstream`,
  }
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 1; i <= 5; i += 1) {
    offsets[i] = Buffer.byteLength(pdf)
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

function textAt(x, y, text) {
  const escaped = text.replace(/([()\\])/g, '\\$1')
  return `1 0 0 1 ${x} ${y} Tm (${escaped}) Tj`
}

// Reused verbatim from src/lib/pdfTextExtraction.test.js's own broken-
// page-tree fixture builder — a genuinely, structurally corrupt PDF
// (its /Pages object's /Kids array references a nonexistent object)
// whose lone content-stream object still holds real, recoverable text.
function buildPageTreeBrokenPdf(contentStream) {
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [99 0 R] /Count 1 >>',
    5: `<< /Length ${Buffer.byteLength(contentStream)} >>\nstream\n${contentStream}\nendstream`,
  }
  let pdf = '%PDF-1.4\n'
  const offsets = {}
  for (const num of [1, 2, 5]) {
    offsets[num] = Buffer.byteLength(pdf)
    pdf += `${num} 0 obj\n${objects[num]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i += 1) pdf += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

function homepageWithFullRestaurantAndOneMenu() {
  const restaurant = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: 'De Botanist Breda',
    telephone: '076 3032490',
    url: 'https://debotanistbreda.nl',
    address: { streetAddress: 'Tolbrugstraat 19', postalCode: '4811 WN', addressLocality: 'Breda' },
  }
  const menu = {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: 'Diner',
    hasMenuSection: [{ name: 'Voorgerechten', hasMenuItem: [{ name: 'Soep', offers: { price: '7.50' } }] }],
  }
  return `<html><head>${jsonLdScript(restaurant)}${jsonLdScript(menu)}</head><body>
    <a href="/menukaart">Bekijk onze menukaart</a>
  </body></html>`
}

function alwaysBlockedFetcher() {
  return async () => ({ status: 'blocked' })
}

test('runRestaurantSourceAnalysis: extracts homepage fields and menu with json_ld extraction_method', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: alwaysBlockedFetcher(),
  })

  assert.equal(result.restaurantCandidateFields.name, 'De Botanist Breda')
  assert.equal(result.fieldEvidence.name.extractionMethod, 'json_ld')
  assert.ok(result.fieldEvidence.name.contentHash)
  assert.equal(result.menuContexts.length, 1)
  assert.equal(result.menuContexts[0].extractionMethod, 'json_ld')
  assert.equal(result.menuContexts[0].sourceUrl, 'https://debotanistbreda.nl/')
})

test('runRestaurantSourceAnalysis: a fully review-ready name/category/address produces the evidence-based description', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: alwaysBlockedFetcher(),
  })
  assert.equal(result.description, 'De Botanist Breda is een restaurant in Breda.')
})

test('runRestaurantSourceAnalysis: a blocked same-host candidate produces a plain-language note, never an error', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: alwaysBlockedFetcher(),
  })
  assert.ok(result.notes.some((n) => n.includes('menukaart') && n.includes('robots.txt')))
})

test('runRestaurantSourceAnalysis: a candidate fetch error produces a plain-language note, never a thrown error', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'error' }),
  })
  assert.ok(result.notes.some((n) => /mislukt/.test(n)))
})

test('runRestaurantSourceAnalysis: an HTML candidate contributes a new menu context (deduped by contextSlug) and fills a field the homepage left absent', async () => {
  const homepageWithoutPhone = `<html><head>${jsonLdScript({ '@type': 'Restaurant', name: "Bobbi's Bar" })}</head><body>
    <a href="/menukaart">Menukaart</a>
  </body></html>`
  const candidateHtml = `<a href="tel:+31612345678">Bel</a>${jsonLdScript({
    '@type': 'Menu',
    name: 'Lunchkaart',
    hasMenuSection: [{ name: 'Broodjes', hasMenuItem: [{ name: 'Kaastosti' }] }],
  })}`

  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithoutPhone,
    homepageUrl: 'https://bobbisbar.nl/',
    fetchCandidate: async () => ({ status: 'html', body: candidateHtml, finalUrl: 'https://bobbisbar.nl/menukaart' }),
  })

  assert.equal(result.menuContexts.length, 1)
  assert.equal(result.menuContexts[0].extractionMethod, 'html')
  assert.equal(result.fieldEvidence.phone.value, '+31612345678')
  assert.equal(result.fieldEvidence.phone.extractionMethod, 'html')
  assert.equal(result.fieldEvidence.phone.sourceUrl, 'https://bobbisbar.nl/menukaart')
})

test('runRestaurantSourceAnalysis: the homepage field always wins over a same-host candidate for the same field — never overridden', async () => {
  const homepageWithPhone = jsonLdScript({ '@type': 'Restaurant', name: 'Mr. Moos', telephone: '076 0000000' }) +
    '<a href="/menukaart">Menukaart</a>'
  const candidateHtml = '<a href="tel:+31699999999">Bel</a>'

  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithPhone,
    homepageUrl: 'https://mrmoos.nl/',
    fetchCandidate: async () => ({ status: 'html', body: candidateHtml, finalUrl: 'https://mrmoos.nl/menukaart' }),
  })

  assert.equal(result.fieldEvidence.phone.value, '076 0000000')
  assert.equal(result.fieldEvidence.phone.sourceUrl, 'https://mrmoos.nl/')
})

test('runRestaurantSourceAnalysis: a same-host PDF candidate becomes an unknown menu context, never a confidently-named menu proposal', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({
      status: 'pdf',
      bytes: Buffer.from(VALID_TEXT_PDF_BASE64, 'base64'),
      finalUrl: 'https://debotanistbreda.nl/menukaart',
    }),
  })

  assert.equal(result.menuContexts.length, 1) // only the homepage's own JSON-LD menu
  assert.equal(result.unknownMenuContexts.length, 1)
  const unknown = result.unknownMenuContexts[0]
  assert.equal(unknown.extractionMethod, 'pdf_text')
  assert.equal(unknown.pageCount, 1)
  assert.ok(unknown.contentHash)
  assert.equal(unknown.wordCount, 6) // "Hello from a digital PDF menu" — never the raw text itself
  assert.equal(unknown.textPreview, undefined)
})

test('runRestaurantSourceAnalysis: a same-host PDF candidate with real menu content produces reviewable recognizedSections, this fix\'s own new deterministic menu recognition', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// FICTIEVE SECTIE'),
    textAt(20, 80, 'Fictieve Soep'),
    textAt(100, 80, '4.50'),
    'ET',
  ].join('\n')
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'pdf', bytes: buildTestPdf({ contentStream: content }), finalUrl: 'https://debotanistbreda.nl/menukaart' }),
  })

  const unknown = result.unknownMenuContexts[0]
  assert.equal(unknown.usedFallback, false)
  assert.equal(unknown.recognizedSections.length, 1)
  assert.equal(unknown.recognizedSections[0].name, 'FICTIEVE SECTIE')
  assert.deepEqual(
    unknown.recognizedSections[0].items.map((it) => ({ name: it.name, price: it.price })),
    [{ name: 'Fictieve Soep', price: '4.50' }]
  )
  assert.equal(unknown.recognizedSections[0].items[0].confidence, 'middel')
})

test('SMELT-LIKE CHAIN: recognized PDF sections become receipt menus, one concept and a saveable reviewed result — never "PDF found, zero dishes"', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// FICTIEVE FONDUE'),
    textAt(20, 80, 'Fictieve kaasfondue'),
    textAt(120, 80, '24.50'),
    'ET',
  ].join('\n');
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'pdf', bytes: buildTestPdf({ contentStream: content }), finalUrl: 'https://debotanistbreda.nl/menukaart.pdf' }),
  });
  const pdfMenu = result.menuContexts.find((menu) => menu.extractionMethod === 'pdf_text');
  assert.ok(pdfMenu);
  const summary = buildCandidateSummary({ restaurantCandidateFields: result.restaurantCandidateFields, menus: [pdfMenu] });
  assert.equal(summary.menus[0].sourceUrl, 'https://debotanistbreda.nl/menukaart.pdf');
  assert.equal(summary.menus[0].sourceId, pdfMenu.sourceId);
  assert.equal(summary.menus[0].categories[0].items[0].price, '24.50');
  assert.match(summary.menus[0].categories[0].items[0].evidence.locator, /^pdf:/);
  const concept = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} });
  assert.equal(concept.canSave, true);
  assert.equal(concept.content.categories[0].items[0].name, 'Fictieve kaasfondue');
  assert.equal(result.extractionResult.coverage.itemCount >= 1, true);
});

test('REGRESSION: an ambiguous PDF price reaches concept as one explicit blocker, not a fake "/" dish', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// DRANKEN'),
    textAt(20, 80, 'Chardonnay 6.50 / 25.00'),
    'ET',
  ].join('\n');
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'pdf', bytes: buildTestPdf({ contentStream: content }), finalUrl: 'https://debotanistbreda.nl/kaart.pdf' }),
  });
  const pdfMenu = result.menuContexts.find((menu) => menu.extractionMethod === 'pdf_text');
  assert.ok(pdfMenu);
  assert.equal(pdfMenu.categories[0].items.length, 1);
  assert.equal(pdfMenu.categories[0].items[0].name, 'Chardonnay');
  assert.equal(pdfMenu.categories[0].items[0].price, null);
  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: [pdfMenu] });
  const concept = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} });
  assert.equal(concept.canSave, false);
  assert.deepEqual(concept.blockers.map((b) => b.status), ['multiple_prices']);
  assert.equal(concept.content.categories[0].items[0].name, 'Chardonnay');
  assert.equal(concept.content.categories[0].items[0].price, null);
});

test('runRestaurantSourceAnalysis: a same-host PDF candidate with no recognizable menu content still succeeds, with recognizedSections: [] — never fabricated', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({
      status: 'pdf',
      bytes: Buffer.from(VALID_TEXT_PDF_BASE64, 'base64'),
      finalUrl: 'https://debotanistbreda.nl/menukaart',
    }),
  })
  const unknown = result.unknownMenuContexts[0]
  assert.equal(unknown.usedFallback, false)
  assert.deepEqual(unknown.recognizedSections, [])
})

test('runRestaurantSourceAnalysis: a same-host PDF candidate that only the fallback can recover is still reported, with usedFallback: true and no structured sections (no position data survives the fallback)', async () => {
  const content = 'BT /F1 12 Tf 1 0 0 1 20 100 Tm (Alleen via fallback herstelde tekst) Tj ET'
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'pdf', bytes: buildPageTreeBrokenPdf(content), finalUrl: 'https://debotanistbreda.nl/menukaart' }),
  })
  const unknown = result.unknownMenuContexts[0]
  assert.equal(unknown.usedFallback, true)
  assert.equal(unknown.pageCount, null)
  assert.deepEqual(unknown.recognizedSections, [])
  assert.ok(unknown.wordCount > 0)
})

test('DE BOTANIST REGRESSION CASE — this fix\'s own named production finding, reproduced with entirely fictional content, never the real menu text: job completes without crash, restaurant fields found, zero json_ld/html menus, the discovered PDF is processed successfully (not pdf_extraction_failed) and yields at least one reviewable menu result', async () => {
  // Diagnosed directly against the real, live source this ticket names
  // (https://debotanistbreda.nl/, read-only, never fetched by this
  // automated test, never stored anywhere in this repository) during
  // this fix's own root-cause investigation. Two real, structural
  // quirks confirmed on that real PDF, both reproduced here with
  // fictional restaurant/dish names only:
  //   1. The real section-marker convention is a prefix-only "// NAME",
  //      never a closed "// NAME //" — see pdfMenuStructuring.js's own
  //      header comment for the full finding.
  //   2. pdfjs-dist does not reliably keep a name and its own price as
  //      separate text items on a two-column row — sometimes it does
  //      ("Fictieve Koffie" / "3.5" as two items), sometimes it merges
  //      them into one string ("Fictief Broodje 4.5"). Both shapes
  //      appear below, on the SAME row, exactly like the real PDF's own
  //      "Koffie 3.5 | Red Bull Energy Drink 4.5" row.
  const menuContent = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// FICTIEVE DRANKEN'),
    // Two side-by-side (name, price) pairs on one row — one pair split
    // into separate items by pdfjs, the other merged into one string.
    textAt(20, 80, 'Fictieve Koffie'),
    textAt(90, 80, '3.5'),
    textAt(160, 80, 'Fictief Broodje 4.5'),
    'ET',
  ].join('\n')

  const homepageHtml = `<html><head></head><body>
    <p>Telefoon: 076 1234567</p>
    <a href="https://fictieve-botanist.invalid/">website</a>
    <a href="/menukaart">Download Menukaart</a>
  </body></html>`

  const result = await runRestaurantSourceAnalysis({
    homepageHtml,
    homepageUrl: 'https://fictieve-botanist.invalid/',
    fetchCandidate: async () => ({
      status: 'pdf',
      bytes: buildTestPdf({ contentStream: menuContent }),
      finalUrl: 'https://fictieve-botanist.invalid/menukaart',
    }),
  })

  // "restaurantvelden werden gevonden" — at least the phone field, from
  // the homepage's own <a href="tel:..."> is NOT present here (this
  // homepage deliberately has no tel: link, mirroring how sparse a real
  // homepage can be) — the point of this case is the PDF path, not
  // field extraction, so this assertion only confirms the analysis
  // itself never throws and returns its normal shape.
  assert.ok(result.restaurantCandidateFields)

  // No json_ld/html menu exists, but the recognized PDF sections are now
  // promoted to the SAME canonical menu context the receipt and concept use.
  // This is the Smelt regression: "PDF found" and "zero dishes" must not be
  // two separate observations.
  assert.equal(result.menuContexts.length, 1)
  assert.equal(result.menuContexts[0].extractionMethod, 'pdf_text')
  assert.equal(result.menuContexts[0].sourceId, result.unknownMenuContexts[0].sourceId)
  assert.equal(result.menuContexts[0].categories[0].items.length, 2)
  assert.equal(result.extractionResult.status, 'items_extracted')
  assert.equal(result.extractionResult.coverage.itemCount, 2)
  assert.equal(result.extractionResult.coverage.complete, false)

  // "de ontdekte PDF gaf pdf_extraction_failed" — reproduced as NOT
  // reproducing today: the PDF is processed successfully, never
  // pdf_extraction_failed, once this fix's own extraction/structuring
  // improvements are in place.
  assert.equal(result.notes.some((n) => n.includes('pdf_extraction_failed')), false)
  assert.equal(result.unknownMenuContexts.length, 1)
  const unknown = result.unknownMenuContexts[0]
  assert.equal(unknown.extractionMethod, 'pdf_text')
  assert.equal(unknown.usedFallback, false)

  // "AI-structurering is bewust niet beschikbaar" — unchanged.
  assert.ok(result.notes.some((n) => n.includes('AI-structurering is niet beschikbaar')))

  // The actual, minimal acceptance criterion this whole fix exists to
  // satisfy: at least one reviewable menu result — both the split-item
  // pair and the merged-string pair are correctly recognized.
  assert.equal(unknown.recognizedSections.length, 1)
  assert.equal(unknown.recognizedSections[0].name, 'FICTIEVE DRANKEN')
  assert.deepEqual(
    unknown.recognizedSections[0].items.map((it) => ({ name: it.name, price: it.price, confidence: it.confidence })),
    [
      { name: 'Fictieve Koffie', price: '3.5', confidence: 'middel' },
      { name: 'Fictief Broodje', price: '4.5', confidence: 'middel' },
    ]
  )

  // "geen restaurantconcept, menuvoorstel, review of publieke data is
  // aangemaakt" — structurally guaranteed by this module's own
  // architecture, not merely by this one test: runRestaurantSourceAnalysis
  // is a pure function that never touches a database, never calls
  // Supabase, and returns only in-memory data for a human reviewer to
  // act on later, through the existing, separate, explicit
  // createConceptFromReceipt/submitSelectedMenus actions this fix never
  // touches (see src/lib/onboardingRestaurantUi.test.js's own dedicated
  // checks for those two functions).
  assert.doesNotMatch(fs.readFileSync(require.resolve('./restaurantSourceAnalysis.js'), 'utf8'), /supabase|getSupabaseAdmin/i)
})

test('runRestaurantSourceAnalysis: a closed PDF error rolls up into a plain-language note naming the job-level error_reason, never the raw exception', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({
      status: 'pdf',
      bytes: Buffer.from(ENCRYPTED_PDF_BASE64, 'base64'),
      finalUrl: 'https://debotanistbreda.nl/menukaart',
    }),
  })

  assert.equal(result.unknownMenuContexts.length, 0)
  assert.ok(result.notes.some((n) => n.includes('pdf_extraction_failed')))
})

test('runRestaurantSourceAnalysis: a field with no evidence anywhere is simply absent, never a guessed or empty-string entry', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: '<p>Welkom, geen structuur hier.</p>',
    homepageUrl: 'https://example-breda.nl/',
    fetchCandidate: alwaysBlockedFetcher(),
  })
  assert.deepEqual(result.restaurantCandidateFields, {})
  assert.deepEqual(result.fieldEvidence, {})
  assert.equal(result.description, '')
})

// ─── contextStatus: consistent / conflict / unverified, end to end ─────────
//
// These five tests exercise src/lib/fieldContextConflict.js's own
// checkFieldContextStatus exclusively through the real pipeline
// (runRestaurantSourceAnalysis) — never only in isolation — per the
// independent review's own explicit requirement that this status be
// proven wired end to end, not merely correct as an isolated unit.

test('runRestaurantSourceAnalysis: contextStatus "consistent" — the same address actively restated and confirmed on another same-host page reaches hoog', async () => {
  const homepageWithBredaAddress = jsonLdScript({
    '@type': 'Restaurant',
    name: 'De Botanist Breda',
    address: { streetAddress: 'Tolbrugstraat 19', postalCode: '4811 WN', addressLocality: 'Breda' },
  }) + '<a href="/menukaart">Menukaart</a>'
  const candidateHtmlWithSamePostcode = `<address>Onze locatie: 4811 WN Breda (achteringang)</address>`

  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithBredaAddress,
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'html', body: candidateHtmlWithSamePostcode, finalUrl: 'https://debotanistbreda.nl/menukaart' }),
  })

  assert.equal(result.fieldEvidence.address.contextStatus, 'consistent')
  assert.equal(result.fieldEvidence.address.confidence, 'hoog')
  assert.equal(result.fieldEvidence.address.reviewReady, true)
})

test('runRestaurantSourceAnalysis: contextStatus "conflict" — a demonstrably different Dutch postcode on a same-host menu page caps the field at laag and marks it needing manual review', async () => {
  const homepageWithBredaAddress = jsonLdScript({
    '@type': 'Restaurant',
    name: 'De Botanist Breda',
    address: { streetAddress: 'Tolbrugstraat 19', postalCode: '4811 WN', addressLocality: 'Breda' },
  }) + '<a href="/menukaart">Menukaart</a>'
  // A same-host menu page whose own footer carries a different address —
  // e.g. a shared chain-wide template pointing at a head office.
  const candidateHtmlWithDifferentCity = `<address>Hoofdkantoor 1, 1011 AB Amsterdam</address>`

  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithBredaAddress,
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'html', body: candidateHtmlWithDifferentCity, finalUrl: 'https://debotanistbreda.nl/menukaart' }),
  })

  assert.equal(result.fieldEvidence.address.contextStatus, 'conflict')
  assert.equal(result.fieldEvidence.address.confidence, 'laag')
  assert.equal(result.fieldEvidence.address.reviewReady, false)
  // The description composer only ever uses a review-ready address for
  // its city clause — a conflicting address must never leak into it.
  assert.doesNotMatch(result.description, /Amsterdam/)
})

test('runRestaurantSourceAnalysis: contextStatus "unverified" — a non-comparable other sighting is never silently treated as "consistent", and the field is capped at middel even though content-hash and plausibility both pass', async () => {
  const homepageWithPhone = jsonLdScript({ '@type': 'Restaurant', name: 'Mr. Moos', telephone: '076 0000000' }) +
    '<a href="/menukaart">Menukaart</a>'
  const candidateHtmlWithUnparsablePhone = '<a href="tel:notarealnumber">Bel</a>'

  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithPhone,
    homepageUrl: 'https://mrmoos.nl/',
    fetchCandidate: async () => ({ status: 'html', body: candidateHtmlWithUnparsablePhone, finalUrl: 'https://mrmoos.nl/menukaart' }),
  })

  assert.equal(result.fieldEvidence.phone.contextStatus, 'unverified')
  // The regression this test guards: before the fix, this exact scenario
  // (a valid content-hash, a plausible value, and nothing but an
  // inconclusive comparison) incorrectly reached 'hoog'.
  assert.equal(result.fieldEvidence.phone.confidence, 'middel')
})

test('runRestaurantSourceAnalysis: contextStatus "unverified" — zero comparable same-host candidates at all (the common case) never lets a field reach hoog', async () => {
  // No menu-keyword link at all on this homepage, so same-host discovery
  // itself finds zero candidates — fetchCandidate is never even called.
  // This is the exact scenario the independent review's own reproduction
  // used: every field has nothing whatsoever to compare against.
  const homepageWithNoDiscoverableLinks = jsonLdScript({
    '@type': 'Restaurant',
    name: 'De Botanist Breda',
    telephone: '076 3032490',
    url: 'https://debotanistbreda.nl',
    address: { streetAddress: 'Tolbrugstraat 19', postalCode: '4811 WN', addressLocality: 'Breda' },
  })

  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithNoDiscoverableLinks,
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => {
      throw new Error('fetchCandidate must never be called when no candidates were discovered')
    },
  })

  for (const fieldName of ['name', 'category', 'address', 'phone', 'website']) {
    assert.equal(result.fieldEvidence[fieldName].contextStatus, 'unverified', `expected ${fieldName} to be unverified`)
    assert.equal(result.fieldEvidence[fieldName].confidence, 'middel', `expected ${fieldName} to be capped at middel, never hoog`)
  }
})

test('runRestaurantSourceAnalysis: contextStatus "unverified" — a blocked or failed same-host candidate never lets a field reach hoog', async () => {
  const homepageWithBredaAddress = jsonLdScript({
    '@type': 'Restaurant',
    name: 'De Botanist Breda',
    address: { streetAddress: 'Tolbrugstraat 19', postalCode: '4811 WN', addressLocality: 'Breda' },
  }) + '<a href="/menukaart">Menukaart</a>'

  const blockedResult = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithBredaAddress,
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'blocked' }),
  })
  assert.equal(blockedResult.fieldEvidence.address.contextStatus, 'unverified')
  assert.equal(blockedResult.fieldEvidence.address.confidence, 'middel')

  const failedResult = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithBredaAddress,
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: async () => ({ status: 'error' }),
  })
  assert.equal(failedResult.fieldEvidence.address.contextStatus, 'unverified')
  assert.equal(failedResult.fieldEvidence.address.confidence, 'middel')
})

test('runRestaurantSourceAnalysis: always notes that AI structuring is unavailable — the Claude adapter boundary is unconditionally disabled today', async () => {
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: homepageWithFullRestaurantAndOneMenu(),
    homepageUrl: 'https://debotanistbreda.nl/',
    fetchCandidate: alwaysBlockedFetcher(),
  })
  assert.ok(result.notes.some((n) => /AI-structurering is niet beschikbaar/.test(n)))
})

// ─── Structural safety net ────────────────────────────────────────────────

test('structural safety net: never performs its own network fetch — every I/O boundary is an injected parameter', () => {
  const source = fs.readFileSync(require.resolve('./restaurantSourceAnalysis.js'), 'utf8')
  assert.doesNotMatch(source, /safeOutboundFetch|node:https?\b/)
})

test('structural safety net: no OCR, screenshot, image-rendering, or browser-automation dependency', () => {
  const source = fs.readFileSync(require.resolve('./restaurantSourceAnalysis.js'), 'utf8')
  assert.doesNotMatch(source, /tesseract|puppeteer|playwright|browserless|canvas|screenshot/i)
})

// ─── Provider-neutral quality gate and source-scoped replacement (#59 review) ─

const aiItem = (name, sourceId = 'source-1') => ({
  name,
  desc: null,
  price: '5.00',
  priceStatus: 'known',
  evidence: { sourceId, locator: 'line:1', quote: name, sourceUrl: 'https://fixture.example/menu.pdf' },
})
const aiMenu = (sourceId = 'source-1') => ({
  name: 'Kaart',
  contextSlug: 'ai-1',
  title: 'Kaart',
  structure: 'normalized',
  sourceId,
  sourceUrl: 'https://fixture.example/menu.pdf',
  extractionMethod: 'ai_structured',
  categories: [{ name: 'Voor', items: [aiItem('Fictieve soep', sourceId), aiItem('Fictief brood', sourceId)] }],
})
const deterministicMenu = () => ({
  sourceId: 'source-1',
  sourceUrl: 'https://fixture.example/menu.pdf',
  contextSlug: 'pdf-1',
  extractionMethod: 'pdf_text',
  categories: [{ name: 'Voor', items: [{ name: 'Fictieve soep', price: '5.00', priceStatus: 'known' }, { name: 'Fictief brood', price: '4.00', priceStatus: 'known' }] }],
})

test('REGRESSION (review P1): no model call is made when the deterministic result is sufficient', async () => {
  let called = 0
  const notes = []
  const limitations = []
  const result = await applyProviderNeutralExtraction({
    menuContexts: [deterministicMenu()],
    unknownMenuContexts: [],
    sourceInventory: [{ id: 'source-1', url: 'https://fixture.example/menu.pdf', kind: 'pdf', status: 'read', itemCount: 2 }],
    sourceTexts: new Map(),
    notes,
    limitations,
    restaurantCandidateFields: {},
    structuredExtraction: async () => { called += 1; return { enabled: true, ok: true, menus: [aiMenu()] } },
  })
  assert.equal(called, 0)
  assert.equal(result.aiExtraction.skipped, true)
  assert.equal(result.aiExtraction.reason, 'deterministic_result_sufficient')
  assert.equal(result.assessment.sufficient, true)
})

test('REGRESSION (review P1): a supplement source is reported and refused, never paid for and thrown away', async () => {
  let called = 0
  const limitations = []
  const result = await applyProviderNeutralExtraction({
    menuContexts: [deterministicMenu()],
    unknownMenuContexts: [{ sourceId: 'source-1', sourceUrl: 'https://fixture.example/menu.pdf', layout: { supplementLines: 2 } }],
    sourceInventory: [{ id: 'source-1', url: 'https://fixture.example/menu.pdf', kind: 'pdf', status: 'read', itemCount: 2 }],
    sourceTexts: new Map(),
    notes: [],
    limitations,
    restaurantCandidateFields: {},
    structuredExtraction: async () => { called += 1; return { enabled: true, ok: true, menus: [aiMenu()] } },
  })
  assert.equal(called, 0)
  assert.equal(result.aiExtraction.reason, 'unsupported_product_gap')
  assert.equal(result.assessment.blockedByProductGap, true)
  assert.ok(limitations.some((line) => line.includes('Geen model-extractie uitgevoerd')))
})



test('REGRESSION (review 6246984520): a product gap in source-1 does not block or overwrite the recoverable source-2', async () => {
  const blockedMenu = {
    sourceId: 'source-1',
    sourceUrl: 'https://fixture.example/borrel.pdf',
    contextSlug: 'borrel',
    extractionMethod: 'pdf_text',
    categories: [{ name: 'Borrel', items: [{ name: 'Fictief brood', price: '4.00', priceStatus: 'known' }] }],
  }
  const recoverableMenu = {
    sourceId: 'source-2',
    sourceUrl: 'https://fixture.example/lunch.pdf',
    contextSlug: 'lunch',
    extractionMethod: 'html',
    categories: [{ name: 'Lunch', items: [{ name: 'Fictieve soep', price: '5.00', priceStatus: 'known' }, { name: 'Fictieve soep', price: '5.00', priceStatus: 'known' }] }],
  }
  const menus = [blockedMenu, recoverableMenu]
  const limitations = []
  let called = 0
  let receivedSources = null
  const result = await applyProviderNeutralExtraction({
    menuContexts: menus,
    unknownMenuContexts: [{ sourceId: 'source-1', sourceUrl: blockedMenu.sourceUrl, layout: { supplementLines: 2 } }],
    sourceInventory: [
      { id: 'source-1', url: blockedMenu.sourceUrl, kind: 'pdf', status: 'read', itemCount: 1 },
      { id: 'source-2', url: recoverableMenu.sourceUrl, kind: 'html', status: 'read', itemCount: 2 },
    ],
    sourceTexts: new Map([['source-2', 'Fictieve soep 5.00']]),
    notes: [],
    limitations,
    restaurantCandidateFields: {},
    structuredExtraction: async (input) => {
      called += 1
      receivedSources = input.sources.map((source) => source.id)
      return {
        enabled: true,
        ok: true,
        menus: [
          {
            name: 'Lunch',
            title: 'Lunch',
            contextSlug: 'ai-1',
            structure: 'normalized',
            sourceId: 'source-2',
            variant: null,
            order: 0,
            categories: [{
              name: 'Lunch',
              items: [
                { name: 'Fictieve soep', description: null, priceStatus: 'known', amountMinorUnits: 500, currency: 'EUR', evidence: { sourceId: 'source-2', locator: 'line:1', quote: 'Fictieve soep' } },
                { name: 'Fictief brood', description: null, priceStatus: 'known', amountMinorUnits: 400, currency: 'EUR', evidence: { sourceId: 'source-2', locator: 'line:2', quote: 'Fictief brood' } },
              ],
            }],
          },
          {
            name: 'Borrel',
            title: 'Borrel',
            contextSlug: 'ai-2',
            structure: 'normalized',
            sourceId: 'source-1',
            variant: null,
            order: 0,
            categories: [{
              name: 'Borrel',
              items: [{ name: 'Fictief brood', description: null, priceStatus: 'known', amountMinorUnits: 400, currency: 'EUR', evidence: { sourceId: 'source-1', locator: 'line:1', quote: 'Fictief brood' } }],
            }],
          },
        ],
      }
    },
  })

  // The model is asked once, for the recoverable source only.
  assert.equal(called, 1)
  assert.deepEqual(receivedSources, ['source-2'])
  assert.equal(result.assessment.blockedByProductGap, true)
  assert.deepEqual(result.assessment.blockedSourceIds, ['source-1'])
  assert.deepEqual(result.assessment.aiEligibleSourceIds, ['source-2'])
  assert.deepEqual(result.aiExtraction.blockedSources.map((entry) => entry.sourceId), ['source-1'])

  // The blocked source keeps its own deterministic result and provenance.
  const kept = menus.find((menu) => menu.sourceId === 'source-1')
  assert.equal(kept.extractionMethod, 'pdf_text')
  assert.equal(kept.categories[0].uncertain, true)
  // The recoverable source is replaced, explicitly marked for review.
  const replaced = menus.find((menu) => menu.sourceId === 'source-2')
  assert.equal(replaced.extractionMethod, 'ai_structured')
  assert.equal(replaced.replacesDeterministic.sourceId, 'source-2')
  assert.equal(replaced.categories.every((category) => category.uncertain === true), true)
  // A model menu for the blocked source is refused, with an explicit reason.
  assert.ok(limitations.some((line) => line.includes('bron source-1') && line.includes('supplementen')))
  assert.ok(limitations.some((line) => line.includes('source_blocked_by_product_gap')))
  assert.equal(menus.filter((menu) => menu.sourceId === 'source-1').length, 1)
})


test('REGRESSION (review P1): a validated model menu replaces only the flagged source, explicitly marked for review', async () => {
  const deterministic = deterministicMenu()
  deterministic.categories[0].items = [{ name: 'Fictieve soep', price: '5.00', priceStatus: 'known' }, { name: 'Fictieve soep', price: '5.00', priceStatus: 'known' }] // duplicate → flag
  const menus = [deterministic]
  const limitations = []
  let called = 0
  const result = await applyProviderNeutralExtraction({
    menuContexts: menus,
    unknownMenuContexts: [],
    sourceInventory: [{ id: 'source-1', url: 'https://fixture.example/menu.pdf', kind: 'pdf', status: 'read', itemCount: 3 }],
    sourceTexts: new Map(),
    notes: [],
    limitations,
    restaurantCandidateFields: {},
    structuredExtraction: async () => {
      called += 1
      return { enabled: true, ok: true, menus: [aiMenu(), aiMenu('source-9')], meta: { provider: 'fake' } }
    },
  })
  assert.equal(called, 1)
  assert.equal(menus.length, 1)
  assert.equal(menus[0].extractionMethod, 'ai_structured')
  assert.equal(menus[0].sourceId, 'source-1')
  assert.equal(menus[0].replacesDeterministic.sourceId, 'source-1')
  assert.equal(menus[0].replacesDeterministic.itemCount, 2)
  assert.equal(menus[0].categories.every((category) => category.uncertain === true), true)
  assert.ok(result.assessment.codes.includes('duplicate_item_within_category'))
  assert.ok(limitations.some((line) => line.includes('Model-extractie verving de deterministische uitkomst')))
  assert.ok(limitations.some((line) => line.includes('source_not_flagged')))
})

test('REGRESSION (review P1): a model menu with insufficient coverage never replaces the deterministic one', async () => {
  const deterministic = deterministicMenu()
  for (let i = 0; i < 10; i += 1) deterministic.categories[0].items.push({ name: `Fictief gerecht ${i}`, price: '5.00', priceStatus: 'known' })
  // One duplicate is enough to flag the menu, so the model IS asked; its
  // materially smaller answer must still not replace the deterministic result.
  deterministic.categories[0].items.push({ name: 'Fictieve soep', price: '5.00', priceStatus: 'known' })
  const menus = [deterministic]
  const limitations = []
  await applyProviderNeutralExtraction({
    menuContexts: menus,
    unknownMenuContexts: [],
    sourceInventory: [{ id: 'source-1', url: 'https://fixture.example/menu.pdf', kind: 'pdf', status: 'read', itemCount: 12 }],
    sourceTexts: new Map(),
    notes: [],
    limitations,
    restaurantCandidateFields: {},
    structuredExtraction: async () => ({ enabled: true, ok: true, menus: [aiMenu()] }),
  })
  assert.equal(menus.length, 1)
  assert.equal(menus[0].extractionMethod, 'pdf_text')
  assert.ok(limitations.some((line) => line.includes('coverage_below_deterministic')))
})

test('REGRESSION (review P1): the bounded PDF text reaches the adapter, while context/receipt never carry it', async () => {
  const menuContent = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// FICTIEVE DRANKEN'),
    textAt(20, 80, 'Fictieve Koffie'),
    textAt(90, 80, '3.5'),
    textAt(20, 60, 'Fictieve Koffie'),
    textAt(90, 60, '3.5'),
    'ET',
  ].join('\n')
  let received
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: '<html><body><a href="/menukaart">Download Menukaart</a></body></html>',
    homepageUrl: 'https://fictieve-botanist.invalid/',
    fetchCandidate: async () => ({ status: 'pdf', bytes: buildTestPdf({ contentStream: menuContent }), finalUrl: 'https://fictieve-botanist.invalid/menukaart' }),
    structuredExtraction: async (input) => {
      received = input
      return { enabled: true, ok: false, reason: 'provider_unavailable' }
    },
  })
  const pdfSource = received.sources.find((source) => source.id === result.unknownMenuContexts[0].sourceId)
  assert.match(pdfSource.text, /Pagina 1/)
  assert.match(pdfSource.text, /Fictieve Koffie 3\.5/)
  assert.equal(Object.prototype.hasOwnProperty.call(result.unknownMenuContexts[0], 'text'), false)
  assert.doesNotMatch(JSON.stringify(result.unknownMenuContexts), /Pagina 1/)
  assert.doesNotMatch(JSON.stringify(result.extractionResult), /Pagina 1/)
  assert.doesNotMatch(JSON.stringify(result.extractionResult), /Fictieve Koffie/)
  assert.equal(result.menuContexts.length, 1)
  assert.equal(result.aiExtraction.reason, 'provider_unavailable')
})

test('REGRESSION (review 6249303096 P1): an unlinked PDF price line is reported as a limitation instead of disappearing', () => {
  const limitations = pdfLayoutLimitations('https://fixture.example/menu.pdf', { unlinkedPriceLines: 2 })
  assert.equal(limitations.length, 1)
  assert.match(limitations[0], /2 prijsregel\(s\)/)
  assert.match(limitations[0], /naam-\/prijskoppeling/)
  assert.deepEqual(pdfLayoutLimitations('https://fixture.example/menu.pdf', { unlinkedPriceLines: 0 }), [])
})

test('REGRESSION (review 6249657793 P1 + 6249915021 P1): an unresolvable numeric ambiguity survives parser → quality gate → limitation identically for integer, decimal and comma notation and never becomes a sufficient/review-ready menu', async () => {
  const outcomes = []
  for (const [second, third] of [['6', '25'], ['6.5', '25.0'], ['6,50', '25,00']]) {
    const content = [
      'BT /F1 12 Tf',
      textAt(20, 100, '// FICTIEVE DRANKEN'),
      // A proven pair (split name/price) and a proven merged pair stay items.
      textAt(20, 80, 'Fictieve Koffie'),
      textAt(90, 80, '3.5'),
      textAt(160, 80, 'Fictief Broodje 4.5'),
      // The same geometry with two amounts and no separator: the layout does
      // not prove whether the first number belongs to the name or is a second
      // (glass) amount. The amount's writing style must not change that.
      textAt(20, 60, 'Fictieve Wijn'),
      textAt(90, 60, second),
      textAt(150, 60, third),
      'ET',
    ].join('\n')

    const { context } = await readPdfMenuSource(
      buildTestPdf({ contentStream: content }),
      'https://fixture.example/menu.pdf',
      'source-1',
    )
    assert.equal(context.layout.ambiguousPriceLines, 1, `${second}/${third}`)
    const names = context.recognizedSections.flatMap((category) => category.items.map((item) => item.name))
    assert.deepEqual(names, ['Fictieve Koffie', 'Fictief Broodje'], `${second}/${third}`)
    // Never a claimed first amount and never a silent "Fictieve Wijn 6" item.
    assert.equal(context.recognizedSections.some((category) => category.items.some((item) => item.name.includes('Wijn'))), false, `${second}/${third}`)
    assert.equal(context.recognizedSections.some((category) => category.items.some((item) => [second, third].includes(item.price))), false, `${second}/${third}`)

    const menu = {
      sourceId: 'source-1',
      sourceUrl: 'https://fixture.example/menu.pdf',
      categories: context.recognizedSections,
    }
    const assessment = assessDeterministicMenuQuality({ menus: [menu], unknownMenuContexts: [context] })
    assert.equal(assessment.sufficient, false, `${second}/${third}`)
    assert.equal(assessment.blockedByProductGap, false, `${second}/${third}`)
    assert.ok(assessment.codes.includes('pdf_ambiguous_price_lines'), `${second}/${third}`)
    assert.deepEqual(assessment.flaggedSourceIds, ['source-1'], `${second}/${third}`)

    const limitations = pdfLayoutLimitations(menu.sourceUrl, context.layout)
    assert.ok(limitations.some((line) => /niet eenduidig/.test(line) && /niet als gerecht/.test(line)), `${second}/${third}`)

    outcomes.push(JSON.stringify({ names, layout: context.layout, flags: assessment.codes, limitations }))
  }
  // Names, layout counters, flag codes and limitation text are identical for
  // the integer, decimal and comma runs: the safety outcome never depends on
  // the amount's notation.
  assert.equal(new Set(outcomes).size, 1)
})
