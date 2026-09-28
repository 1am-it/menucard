'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis')

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
