'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { extractDigitalPdfText, extractDigitalPdfLines, PdfExtractionError, ALLOWED_PDF_ERROR_REASONS, hasPdfSignature } = require('./pdfTextExtraction')

/**
 * Builds a minimal, valid, single-page digital PDF from a raw content
 * stream — computes every xref byte offset programmatically rather
 * than by hand, so a test can place text at exact (x, y) coordinates
 * without the fragile manual offset arithmetic this file's own
 * pre-existing fixtures needed. Never used to fabricate anything other
 * than test input; production code never calls this.
 */
function buildTestPdf({ contentStream, contentStreams, mediaBox = [0, 0, 300, 600] }) {
  const streams = contentStreams || [contentStream]
  const pageCount = streams.length
  const pageObjNums = streams.map((_, i) => 3 + i * 2) // page N's own content stream is pageObjNums[i] + 1
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

/** One `Tm (text) Tj` text-showing operation at an absolute (x, y). */
function textAt(x, y, text) {
  const escaped = text.replace(/([()\\])/g, '\\$1')
  return `1 0 0 1 ${x} ${y} Tm (${escaped}) Tj`
}

// Self-contained, hand-built minimal PDF fixtures (no external files, no
// PDF-authoring library — none exists in this project and none should be
// added merely to generate test fixtures). Each was empirically verified
// against this project's own pinned `pdfjs-dist` legacy build before being
// embedded here (see this checkpoint's own build/verification notes):
// the valid-text fixture round-trips to the exact expected string, the
// no-text fixture loads with zero extracted text items (never an
// exception), and the encrypted fixture — a genuine RC4/Standard-Security-
// Handler-encrypted PDF with a real, non-empty user password, not a mock —
// throws a real `PasswordException` when opened without a password.

const VALID_TEXT_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNjAgPj4Kc3RyZWFtCkJUIC9GMSAxOCBUZiAyMCAxMDAgVGQgKEhlbGxvIGZyb20gYSBkaWdpdGFsIFBERiBtZW51KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDIxCiUlRU9G'

const NO_TEXT_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMCA+PgpzdHJlYW0KCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgozNjAKJSVFT0Y='

const ENCRYPTED_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDIgPj4Kc3RyZWFtCiLwVBDlMFkw5IR5QqJA4pHCbx68IWPICT40ytLC/CzqVhteQXQApZzi8wplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKPDwgL0ZpbHRlciAvU3RhbmRhcmQgL1YgMSAvUiAyIC9PIChz3PnG4MSAxzwC7oF4rlOZb7654PNX/M5mmBOq3ECyxykgL1UgKFwpv3Y64QDStFxc4KT2JtpX5UBCWzjXLwvYnuokGRnU7BgpIC9QIC0zOTA0ID4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAowMDAwMDAwNDAzIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNyAvUm9vdCAxIDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzwwMmUyZDU2NDBlMTUzMGFkZGFhOWEwNzA5NzlkOTc5YT4gPDAyZTJkNTY0MGUxNTMwYWRkYWE5YTA3MDk3OWQ5NzlhPl0gPj4Kc3RhcnR4cmVmCjUzOQolJUVPRg=='

// Two-page PDF whose page tree's second kid reference resolves to the
// wrong object type (a dangling/broken page reference, not merely a
// broken content stream) — empirically verified against this project's
// own pinned pdfjs-dist build to load successfully as a document
// (numPages: 2) but throw a real, uncaught exception specifically at
// `doc.getPage(2)` time. This is the regression fixture for the
// independent review finding that per-page failures were not being
// mapped to the closed PdfExtractionError vocabulary — pdfjs-dist itself
// is otherwise very fault-tolerant about a merely-corrupt CONTENT
// STREAM (confirmed separately to degrade to zero text items rather than
// throw, exactly like a genuine scanned/image-only page), so a broken
// page-tree reference specifically was required to reproduce a real,
// uncaught per-page throw.
const PAGE_TREE_BROKEN_SECOND_PAGE_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA2MCAwIFJdIC9Db3VudCAyID4+CmVuZG9iagozIDAgb2JqCjw8IC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNCAwIFIgPj4gPj4gL01lZGlhQm94IFswIDAgMzAwIDIwMF0gL0NvbnRlbnRzIDUgMCBSID4+CmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKNSAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMTggVGYgMjAgMTAwIFRkIChQYWdlIG9uZSB0ZXh0KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNyAwIFIgPj4KZW5kb2JqCjcgMCBvYmoKPDwgL0xlbmd0aCA0MCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0KZ2FyYmFnZS1ub3QtcmVhbGx5LWZsYXRlLWNvbXByZXNzZWQtZGF0YQplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMjIgMDAwMDAgbiAKMDAwMDAwMDI0OCAwMDAwMCBuIAowMDAwMDAwMzE4IDAwMDAwIG4gCjAwMDAwMDA0MTIgMDAwMDAgbiAKMDAwMDAwMDUzOCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDggL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjY0OQolJUVPRg=='

function pdfBytes(base64) {
  return Buffer.from(base64, 'base64')
}

test('extractDigitalPdfText: extracts the real text from a valid digital PDF', async () => {
  const result = await extractDigitalPdfText(pdfBytes(VALID_TEXT_PDF_BASE64))
  assert.equal(result.text, 'Hello from a digital PDF menu')
  assert.equal(result.pageCount, 1)
})

test('extractDigitalPdfText: pdf_too_large when bytes exceed maxBytes', async () => {
  await assert.rejects(
    () => extractDigitalPdfText(pdfBytes(VALID_TEXT_PDF_BASE64), { maxBytes: 10 }),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_too_large')
      return true
    }
  )
})

test('extractDigitalPdfText: pdf_too_large when page count exceeds maxPages', async () => {
  await assert.rejects(
    () => extractDigitalPdfText(pdfBytes(VALID_TEXT_PDF_BASE64), { maxPages: 0 }),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_too_large')
      return true
    }
  )
})

test('extractDigitalPdfText: pdf_encrypted for a genuinely password-protected PDF', async () => {
  await assert.rejects(
    () => extractDigitalPdfText(pdfBytes(ENCRYPTED_PDF_BASE64)),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_encrypted')
      return true
    }
  )
})

test('extractDigitalPdfText: pdf_corrupt for bytes that are not a PDF at all', async () => {
  await assert.rejects(
    () => extractDigitalPdfText(Buffer.from('this is not a pdf at all', 'utf8')),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_corrupt')
      return true
    }
  )
})

test('hasPdfSignature: recognizes the real %PDF- magic number and rejects unrelated file signatures, never trusting a claimed content-type alone', () => {
  assert.equal(hasPdfSignature(pdfBytes(VALID_TEXT_PDF_BASE64)), true)
  assert.equal(hasPdfSignature(Buffer.from('this is not a pdf at all', 'utf8')), false)
  // A PNG magic number — the exact "server lied about content-type, or
  // the download was truncated/substituted" scenario this signature
  // check exists to catch before pdfjs ever sees the bytes.
  assert.equal(hasPdfSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), false)
  assert.equal(hasPdfSignature(Buffer.alloc(0)), false)
  assert.equal(hasPdfSignature(Buffer.from('%PDF', 'utf8')), false) // too short — missing the trailing "-"
})

test('extractDigitalPdfText: pdf_corrupt for bytes with a real image signature (PNG), never handed to pdfjs at all', async () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  await assert.rejects(
    () => extractDigitalPdfText(pngBytes),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_corrupt')
      assert.match(err.message, /signature/)
      return true
    }
  )
})

test('extractDigitalPdfText: pdf_corrupt for an empty buffer', async () => {
  await assert.rejects(
    () => extractDigitalPdfText(Buffer.alloc(0)),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_corrupt')
      return true
    }
  )
})

test('extractDigitalPdfText: pdf_no_text_layer for a structurally valid PDF with no extractable text (simulates a scanned/image-only PDF)', async () => {
  await assert.rejects(
    () => extractDigitalPdfText(pdfBytes(NO_TEXT_PDF_BASE64)),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_no_text_layer')
      return true
    }
  )
})

test('extractDigitalPdfText: pdf_corrupt for a document that loads successfully but throws on a later page (regression: per-page errors must map to the closed vocabulary, never leak a raw pdfjs exception)', async () => {
  await assert.rejects(
    () => extractDigitalPdfText(pdfBytes(PAGE_TREE_BROKEN_SECOND_PAGE_PDF_BASE64)),
    (err) => {
      assert.ok(err instanceof PdfExtractionError, `expected a PdfExtractionError, got ${err && err.constructor && err.constructor.name}`)
      assert.equal(err.reason, 'pdf_corrupt')
      return true
    }
  )
})

test('extractDigitalPdfLines: reconstructs visual rows by Y-position, correctly pairing a name with its own price even though pdfjs emits them as separate items', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// SECTION ONE //'),
    textAt(20, 80, 'Soep'),
    textAt(100, 80, '4.50'),
    textAt(20, 60, 'Broodje'),
    textAt(100, 60, '3.00'),
    textAt(20, 50, 'met kaas en ham'),
    'ET',
  ].join('\n')
  const { pages, pageCount } = await extractDigitalPdfLines(buildTestPdf({ contentStream: content }))
  assert.equal(pageCount, 1)
  assert.equal(pages.length, 1)
  const lineTexts = pages[0].lines.map((line) => line.items.map((it) => it.str).join('|'))
  assert.deepEqual(lineTexts, ['// SECTION ONE //', 'Soep| |4.50', 'Broodje| |3.00', 'met kaas en ham'])
  // Top-of-page first — the section marker's Y (100) must sort before
  // the item rows below it (80, 60, 50).
  assert.deepEqual(pages[0].lines.map((l) => l.y), [100, 80, 60, 50])
})

test('extractDigitalPdfLines: items within a small Y jitter band are still grouped into one line, never split into near-duplicate rows', async () => {
  const content = ['BT /F1 12 Tf', textAt(20, 100, 'Naam'), textAt(100, 100.4, '5.00'), 'ET'].join('\n')
  const { pages } = await extractDigitalPdfLines(buildTestPdf({ contentStream: content }))
  assert.equal(pages[0].lines.length, 1)
  // pdfjs may insert its own synthetic whitespace item for the horizontal
  // gap between the two Tj calls — real text content is still exactly
  // these two strings, on one reconstructed line, never two.
  const realStrings = pages[0].lines[0].items.map((it) => it.str).filter((s) => s.trim().length > 0)
  assert.deepEqual(realStrings, ['Naam', '5.00'])
})

test('extractDigitalPdfLines: a page with no text items still contributes an empty lines array, never silently dropped', async () => {
  // Two pages: the first has real text (so the document as a whole is
  // not pdf_no_text_layer), the second is a valid, empty text object —
  // no Tj at all — the exact case this test exists to check.
  const pdfBuf = buildTestPdf({
    contentStreams: [['BT /F1 12 Tf', textAt(20, 100, 'Pagina één'), 'ET'].join('\n'), 'BT ET'],
  })
  const { pages, pageCount } = await extractDigitalPdfLines(pdfBuf)
  assert.equal(pageCount, 2)
  assert.equal(pages.length, 2)
  assert.equal(pages[0].pageNumber, 1)
  assert.ok(pages[0].lines.length > 0)
  assert.deepEqual(pages[1], { pageNumber: 2, lines: [] })
})

test('extractDigitalPdfLines: pdf_no_text_layer when every page is empty — same honest signal as extractDigitalPdfText', async () => {
  await assert.rejects(
    () => extractDigitalPdfLines(pdfBytes(NO_TEXT_PDF_BASE64)),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_no_text_layer')
      return true
    }
  )
})

test('extractDigitalPdfLines: pdf_encrypted for a genuinely password-protected PDF — the exact same closed reason as extractDigitalPdfText', async () => {
  await assert.rejects(
    () => extractDigitalPdfLines(pdfBytes(ENCRYPTED_PDF_BASE64)),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_encrypted')
      return true
    }
  )
})

test('extractDigitalPdfLines: pdf_too_large when maxBytes is exceeded — the same byte budget as extractDigitalPdfText, never bypassed', async () => {
  await assert.rejects(
    () => extractDigitalPdfLines(pdfBytes(VALID_TEXT_PDF_BASE64), { maxBytes: 10 }),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_too_large')
      return true
    }
  )
})

test('extractDigitalPdfLines: rejects bytes with no PDF signature, never handed to pdfjs — same defense in depth as extractDigitalPdfText', async () => {
  await assert.rejects(
    () => extractDigitalPdfLines(Buffer.from('not a pdf', 'utf8')),
    (err) => {
      assert.ok(err instanceof PdfExtractionError)
      assert.equal(err.reason, 'pdf_corrupt')
      return true
    }
  )
})

test('PdfExtractionError: rejects an unknown reason, keeping the error vocabulary closed', () => {
  assert.throws(() => new PdfExtractionError('pdf_wrong_password_lol'), /Unknown PDF extraction error reason/)
})

test('structural safety net: the closed error vocabulary has exactly the four required outcomes, no more', () => {
  assert.deepEqual(
    [...ALLOWED_PDF_ERROR_REASONS].sort(),
    ['pdf_corrupt', 'pdf_encrypted', 'pdf_no_text_layer', 'pdf_too_large']
  )
})

test('structural safety net: never imports an OCR, screenshot, image-rendering, or browser-automation dependency', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(require.resolve('./pdfTextExtraction.js'), 'utf8')
  assert.doesNotMatch(source, /tesseract|ocr|puppeteer|playwright|browserless|canvas|screenshot/i)
})

test('structural safety net: only ever imports the Node-specific legacy pdfjs-dist build, never the default/browser entry point', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(require.resolve('./pdfTextExtraction.js'), 'utf8')
  const importCalls = [...source.matchAll(/import\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(importCalls, ['pdfjs-dist/legacy/build/pdf.mjs'])
})
