'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { extractDigitalPdfText, PdfExtractionError, ALLOWED_PDF_ERROR_REASONS } = require('./pdfTextExtraction')

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
