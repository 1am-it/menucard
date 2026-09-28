// BE-21 — the local fixture registry backing `manifest.json`'s
// `synthetic_fixture`/`local_be20_fixture` entries. Every homepage URL
// used here is on the `.invalid` top-level domain — reserved by RFC 2606
// specifically so it can never resolve to a real site, which is also why
// none of these can ever be confused with be-20/be-21's own six named,
// real, mandatory sources (all `.nl`). Nothing here is fetched over a
// network by anything in this project; these are plain in-memory strings
// and byte buffers, exactly like `src/lib/restaurantSourceAnalysis.test.js`'s
// own existing fixture-building functions.
//
// Never claims to represent, resemble, or substitute for any real
// restaurant's actual website — see `manifest.js`'s own header comment
// on the `synthetic_fixture` vs `real_benchmark_evidence_pending`
// distinction.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

// Reused verbatim from src/lib/pdfTextExtraction.test.js — a genuinely
// valid single-page digital PDF, a genuinely password-protected PDF, and
// a structurally valid PDF with a zero-length content stream (the
// project's own directly-verified stand-in for a scanned/image-only
// PDF's "no extractable text" outcome). Deliberately duplicated rather
// than imported, matching src/lib/restaurantSourceAnalysis.test.js's own
// "necessary duplication for self-contained test fixtures" precedent.
const VALID_TEXT_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNjAgPj4Kc3RyZWFtCkJUIC9GMSAxOCBUZiAyMCAxMDAgVGQgKEhlbGxvIGZyb20gYSBkaWdpdGFsIFBERiBtZW51KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDIxCiUlRU9G'

const NO_TEXT_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMCA+PgpzdHJlYW0KCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgozNjAKJSVFT0Y='

const ENCRYPTED_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDIgPj4Kc3RyZWFtCiLwVBDlMFkw5IR5QqJA4pHCbx68IWPICT40ytLC/CzqVhteQXQApZzi8wplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKPDwgL0ZpbHRlciAvU3RhbmRhcmQgL1YgMSAvUiAyIC9PIChz3PnG4MSAxzwC7oF4rlOZb7654PNX/M5mmBOq3ECyxykgL1UgKFwpv3Y64QDStFxc4KT2JtpX5UBCWzjXLwvYnuokGRnU7BgpIC9QIC0zOTA0ID4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAowMDAwMDAwNDAzIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNyAvUm9vdCAxIDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzwwMmUyZDU2NDBlMTUzMGFkZGFhOWEwNzA5NzlkOTc5YT4gPDAyZTJkNTY0MGUxNTMwYWRkYWE5YTA3MDk3OWQ5NzlhPl0gPj4Kc3RhcnR4cmVmCjUzOQolJUVPRg=='

function jsonLdScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`
}

/**
 * Every fixture returns:
 * `{ entryIsPdf, homepageHtml, homepageUrl, pdfBase64, candidateResponses }`
 * — `candidateResponses` maps an exact candidate URL string to the
 * `fetchCandidate`-shaped result `src/lib/restaurantSourceAnalysis.js`
 * itself expects (`{ status: 'html'|'pdf'|'blocked'|'error', ... }`), so
 * `runner.js` can hand the whole map straight to a small lookup function
 * — never a real network call.
 */
const FIXTURES = {
  // html_only — a consistent same-host confirmation. The homepage gives
  // name/address/phone/website via JSON-LD; a same-host "/openingstijden"
  // page (linked with a menu-unrelated but plausible label so it is
  // discovered only through its own JSON-LD re-statement, not through
  // sameHostDiscovery — actually discovered via the "menukaart" link) also
  // restates the same phone, producing a genuine `consistent` context
  // status for phone (content-hash + plausibility + consistent -> hoog).
  'synthetic-html-full-consistent': () => {
    const homepageUrl = 'https://fixture-one.invalid/'
    const restaurant = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: 'Fixture Bistro Noord',
      telephone: '076 1234567',
      url: homepageUrl,
      address: { streetAddress: 'Voorbeeldstraat 1', postalCode: '4800 AA', addressLocality: 'Breda' },
    }
    const menu = {
      '@context': 'https://schema.org',
      '@type': 'Menu',
      name: 'Diner',
      hasMenuSection: [{ name: 'Voorgerechten', hasMenuItem: [{ name: 'Soep', offers: { price: '6.50' } }] }],
    }
    const homepageHtml = `<html><head>${jsonLdScript(restaurant)}${jsonLdScript(menu)}</head><body>
      <a href="/menukaart">Bekijk de menukaart</a>
    </body></html>`
    const candidateUrl = 'https://fixture-one.invalid/menukaart'
    const candidateHtml = `<html><body><address>Voorbeeldstraat 1, 4800 AA Breda — tel. 076 1234567</address></body></html>`
    return {
      entryIsPdf: false,
      homepageHtml,
      homepageUrl,
      pdfBase64: null,
      candidateResponses: {
        [candidateUrl]: { status: 'html', body: candidateHtml, finalUrl: candidateUrl },
      },
    }
  },

  // chain_location — the ticket's own motivating example: a same-host
  // page restates a DIFFERENT postcode (as if it were a chain's
  // head-office address bleeding onto a location-specific page),
  // producing a genuine `conflict` context status for address (-> laag).
  'synthetic-html-chain-location-conflict': () => {
    const homepageUrl = 'https://fixture-two.invalid/'
    const restaurant = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: 'Fixture Grill Zuid',
      telephone: '076 7654321',
      url: homepageUrl,
      address: { streetAddress: 'Locatiestraat 5', postalCode: '4811 BB', addressLocality: 'Breda' },
    }
    const homepageHtml = `<html><head>${jsonLdScript(restaurant)}</head><body>
      <a href="/menukaart">Bekijk de kaart</a>
    </body></html>`
    const candidateUrl = 'https://fixture-two.invalid/menukaart'
    // A different postcode on the same host — the honest simulation of a
    // chain/head-office address surfacing (in this page's own footer) on
    // what is otherwise a location-specific page. The link text/path
    // must contain one of sameHostDiscovery.js's own closed
    // MENU_KEYWORDS ("kaart") for this candidate to be discovered and
    // fetched at all — a real chain page in the wild would equally need
    // to be reached through that same bounded, keyword-matched discovery
    // step, never a special case for this fixture.
    const candidateHtml = `<html><body><address>Hoofdkantoor, Kantoorweg 99, 3000 XX Rotterdam</address></body></html>`
    return {
      entryIsPdf: false,
      homepageHtml,
      homepageUrl,
      pdfBase64: null,
      candidateResponses: {
        [candidateUrl]: { status: 'html', body: candidateHtml, finalUrl: candidateUrl },
      },
    }
  },

  // multilingual — the menu link uses a German keyword
  // (`sameHostDiscovery.js`'s own `MENU_KEYWORDS` already includes
  // "speisekarte"/"carte"), proving bounded discovery is not
  // Dutch/English-only within its own fixed, closed list.
  'synthetic-html-multilingual-menu-keyword': () => {
    const homepageUrl = 'https://fixture-three.invalid/'
    const homepageHtml = `<html><head></head><body>
      <a href="/speisekarte">Speisekarte</a>
    </body></html>`
    const candidateUrl = 'https://fixture-three.invalid/speisekarte'
    const menu = {
      '@context': 'https://schema.org',
      '@type': 'Menu',
      name: 'Speisekarte',
      hasMenuSection: [{ name: 'Vorspeisen', hasMenuItem: [{ name: 'Suppe', offers: { price: '5.00' } }] }],
    }
    const candidateHtml = `<html><head>${jsonLdScript(menu)}</head><body></body></html>`
    return {
      entryIsPdf: false,
      homepageHtml,
      homepageUrl,
      pdfBase64: null,
      candidateResponses: {
        [candidateUrl]: { status: 'html', body: candidateHtml, finalUrl: candidateUrl },
      },
    }
  },

  // javascript_dependent — a static fetch of a page whose real content a
  // JavaScript bundle would normally inject client-side. Deliberately
  // near-empty: this foundation's own honest demonstration that fase 1
  // reports "nothing reliable found" rather than guessing, exactly what
  // be-20's own "Non-goals for fase 1" already states for this source
  // type — never a simulated browser render.
  'synthetic-html-javascript-dependent-empty': () => {
    const homepageUrl = 'https://fixture-four.invalid/'
    const homepageHtml = `<html><head></head><body><div id="app"></div></body></html>`
    return {
      entryIsPdf: false,
      homepageHtml,
      homepageUrl,
      pdfBase64: null,
      candidateResponses: {},
    }
  },

  // digital_pdf — the entry URL itself is a genuinely valid digital PDF
  // (local_be20_fixture, reused verbatim from pdfTextExtraction.test.js).
  'local-be20-digital-pdf-valid': () => ({
    entryIsPdf: true,
    homepageHtml: null,
    homepageUrl: 'https://fixture-five.invalid/menu.pdf',
    pdfBase64: VALID_TEXT_PDF_BASE64,
    candidateResponses: {},
  }),

  // digital_pdf (encrypted) — closed-error-vocabulary case: a real,
  // password-protected PDF (local_be20_fixture).
  'local-be20-digital-pdf-encrypted': () => ({
    entryIsPdf: true,
    homepageHtml: null,
    homepageUrl: 'https://fixture-six.invalid/menu-locked.pdf',
    pdfBase64: ENCRYPTED_PDF_BASE64,
    candidateResponses: {},
  }),

  // scanned_pdf — a structurally valid PDF with a zero-length content
  // stream, this project's own directly-verified stand-in for "loads
  // successfully but has no extractable text" (local_be20_fixture). The
  // honest, non-OCR outcome be-20 itself requires: `pdf_no_text_layer`,
  // never a guess and never a trigger to run OCR now.
  'local-be20-scanned-pdf-no-text-layer': () => ({
    entryIsPdf: true,
    homepageHtml: null,
    homepageUrl: 'https://fixture-seven.invalid/menu-scanned.pdf',
    pdfBase64: NO_TEXT_PDF_BASE64,
    candidateResponses: {},
  }),
}

/** `null` for an unknown fixture id — never throws, never guesses. */
function buildFixture(fixtureId) {
  const builder = FIXTURES[fixtureId]
  return typeof builder === 'function' ? builder() : null
}

module.exports = {
  FIXTURE_IDS: Object.keys(FIXTURES),
  buildFixture,
}
