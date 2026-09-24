// BE-20 — server-only digital PDF text extraction. Extracts machine-
// readable text from an already-fetched PDF's raw bytes — never a
// scanned/image PDF's pixels (that is explicitly a fase-2, pixel-based
// text-recognition concern, out of scope here; see "Non-goals for fase 1" in
// `be-20-general-restaurant-source-extraction.md`).
//
// Uses `pdfjs-dist` (Mozilla's PDF.js), pinned to an exact version in
// `package.json`/`package-lock.json`. Evaluated and chosen over
// `pdf-parse` after a real, direct compatibility check against this
// project's actual Node runtime — see that check's own findings below,
// since two real, non-obvious things were found that a version-number
// read alone would not have surfaced:
//
//   1. `pdfjs-dist`'s own default entry point
//      (`require('pdfjs-dist')`/`import 'pdfjs-dist'`, i.e.
//      `build/pdf.mjs`) is a browser-oriented build. Loading it under
//      plain Node throws `TypeError: Promise.try is not a function`,
//      because that build unconditionally calls `Promise.try` — a very
//      recent JavaScript engine addition this project's actual pinned
//      Node runtime does not yet have, despite `pdfjs-dist`'s own
//      `engines` field claiming Node 22.13+ support. The library's own
//      Node.js entry point,`pdfjs-dist/legacy/build/pdf.mjs`, does not
//      hit this code path and was directly, empirically verified to
//      extract real text from a real, minimal PDF fixture in this exact
//      runtime — this module therefore only ever imports the `legacy`
//      path, never the package's bare default export.
//   2. `pdfjs-dist` ships as pure ESM (`"main": "build/pdf.mjs"`, no
//      CommonJS build at all) — this module stays CommonJS, matching
//      every other pure-logic module in `src/lib/`, and loads the
//      library via a single `await import(...)` call inside its one
//      async function. This is Node's own documented, standard
//      CommonJS-importing-ESM interop mechanism, not a workaround.
//
// `pdfjs-dist` itself introduces zero new `npm audit` findings in this
// project (independently confirmed at pin time) — the four pre-existing
// `npm audit` findings in this dependency tree (in `next`, `postcss`,
// `sharp`, `nanoid`) predate this change entirely and are out of this
// ticket's scope (no framework/unrelated dependency upgrade is performed
// here, per this ticket's own explicit instruction).
//
// Server-only: dynamically imports `pdfjs-dist`, a large library with no
// business being sent to the browser bundle — only server-side route
// handlers are intended callers, matching this project's established
// `menuSnapshotHash.js`/`urlIntakeReceiptHash.js`/`fieldEvidenceHash.js`
// server-only-module convention.

'use strict'

/** A reasoned, generous-for-a-real-menu-PDF default — a technical,
 * never business-facing bound (per this ticket's own "Vaststaande
 * productkeuzes" §4: no product-level PDF-count limit, but real
 * technical budgets on bytes/pages/time). Callers may override. */
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024 // 15 MB
const DEFAULT_MAX_PAGES = 30
const DEFAULT_TIMEOUT_MS = 15000

/** The closed, four-value error vocabulary this ticket's own
 * documentation requires at minimum, plus nothing else — an
 * unrecognized load failure is deliberately folded into `pdf_corrupt`
 * (the closest honest fit: "this could not be read as a usable PDF"),
 * never a fifth, ad-hoc category invented for this module alone. A
 * page-count or processing-time budget overrun is folded into
 * `pdf_too_large` (the same "too large [for us] to process" outcome,
 * regardless of which dimension — bytes, pages, or time — triggered
 * it), matching this ticket's own existing job-level `budget_exceeded`
 * discipline of never multiplying near-duplicate categories.
 */
const ALLOWED_PDF_ERROR_REASONS = ['pdf_too_large', 'pdf_encrypted', 'pdf_corrupt', 'pdf_no_text_layer']

class PdfExtractionError extends Error {
  constructor(reason, message) {
    super(message || reason)
    this.name = 'PdfExtractionError'
    if (!ALLOWED_PDF_ERROR_REASONS.includes(reason)) {
      throw new Error(`Unknown PDF extraction error reason: ${reason}`)
    }
    this.reason = reason
  }
}

/**
 * Extracts machine-readable text from digital PDF bytes. Resolves
 * `{ text, pageCount }` — `text` is the newline-joined text of every
 * page that had any, trimmed; never empty (an all-empty result is
 * itself the `pdf_no_text_layer` error case, thrown, never returned as
 * a success with an empty string). Rejects with a `PdfExtractionError`
 * (see `.reason`, one of `ALLOWED_PDF_ERROR_REASONS`) on any violation —
 * never partially resolves with an untrusted/incomplete result.
 *
 * `pdfBytes` must be a `Buffer`/`Uint8Array` of the already-fetched PDF
 * — this module never fetches anything itself; the caller is
 * responsible for obtaining the bytes via this project's existing,
 * unchanged SSRF-hardened fetch path.
 */
async function extractDigitalPdfText(pdfBytes, options = {}) {
  const maxBytes = typeof options.maxBytes === 'number' ? options.maxBytes : DEFAULT_MAX_BYTES
  const maxPages = typeof options.maxPages === 'number' ? options.maxPages : DEFAULT_MAX_PAGES
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS

  if (!Buffer.isBuffer(pdfBytes) && !(pdfBytes instanceof Uint8Array)) {
    throw new PdfExtractionError('pdf_corrupt', 'Input is not a byte buffer')
  }
  if (pdfBytes.length === 0) {
    throw new PdfExtractionError('pdf_corrupt', 'Empty input')
  }
  // Checked before ever touching the parsing library — the cheapest,
  // earliest possible fail-closed point for the byte-size budget.
  if (pdfBytes.length > maxBytes) {
    throw new PdfExtractionError('pdf_too_large', `PDF exceeds maxBytes=${maxBytes}`)
  }

  let timeoutHandle
  const timedOut = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new PdfExtractionError('pdf_too_large', `PDF processing exceeded timeoutMs=${timeoutMs}`))
    }, timeoutMs)
  })

  let doc
  try {
    try {
      // Loaded only here, only via `await import(...)` — see this file's
      // own header for why this is required (an ESM-only package) and why
      // it must be the `legacy` entry point specifically (the package's
      // own default entry point is not Node-compatible in this project's
      // pinned runtime).
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes),
        isEvalSupported: false,
        useWorkerFetch: false,
        disableFontFace: true,
      })
      doc = await Promise.race([loadingTask.promise, timedOut])

      if (doc.numPages > maxPages) {
        throw new PdfExtractionError('pdf_too_large', `PDF has ${doc.numPages} pages, exceeds maxPages=${maxPages}`)
      }

      // Every step below — resolving a page, reading its text content —
      // is included in this SAME try block, not a separate one scoped
      // only to document loading. A structurally valid PDF (per the
      // outer getDocument() call above) can still fail per page: e.g. a
      // dangling page-tree reference that resolves to the wrong object
      // type. pdfjs-dist itself is otherwise very fault-tolerant about a
      // malformed CONTENT STREAM specifically — confirmed directly, it
      // degrades to an empty text-items array rather than throwing (the
      // same behavior a genuinely scanned/image-only page produces,
      // correctly handled below as pdf_no_text_layer) — but a broken
      // PAGE-TREE reference is a different, real failure mode that does
      // throw at getPage() time, confirmed directly against a hand-built
      // fixture whose second page's own kid reference resolves to the
      // wrong object type. Without this per-page code living inside the
      // same catch-all below, such an error would propagate as a raw,
      // untyped exception instead of this module's own closed
      // PdfExtractionError contract — this is the exact gap an
      // independent review found and this fix closes.
      const pageTexts = []
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await Promise.race([doc.getPage(pageNumber), timedOut])
        const textContent = await Promise.race([page.getTextContent(), timedOut])
        const pageText = textContent.items
          .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (pageText.length > 0) pageTexts.push(pageText)
      }

      const fullText = pageTexts.join('\n\n').trim()
      if (fullText.length === 0) {
        // A structurally valid PDF with zero extractable text — the
        // deterministic, closed signal for "likely a scanned/image-only
        // PDF", per this project's own directly-verified finding that
        // `pdfjs-dist` never throws for this case, it simply returns no
        // text items. Never guessed at as "empty menu"; never silently
        // escalated to a pixel-based text-recognition pass in fase 1 —
        // see this ticket's own explicit requirement that this outcome
        // stay an honest end result for a later such pass, never a
        // trigger to run one now.
        throw new PdfExtractionError('pdf_no_text_layer', 'PDF loaded successfully but contains no extractable text')
      }

      return { text: fullText, pageCount: doc.numPages }
    } catch (err) {
      // The one, single place every failure from the block above — load
      // failure, page-count overrun, a per-page exception, or the
      // no-text-layer case — is mapped to this module's own closed
      // vocabulary. Never returns a partial result assembled from
      // whatever pages happened to succeed before a later page failed —
      // an untrusted/incomplete extraction is exactly what this module's
      // own contract already refuses to resolve with.
      if (err instanceof PdfExtractionError) throw err
      if (err && err.name === 'PasswordException') {
        throw new PdfExtractionError('pdf_encrypted', 'PDF requires a password')
      }
      throw new PdfExtractionError('pdf_corrupt', (err && err.message) || 'Failed to process PDF')
    }
  } finally {
    clearTimeout(timeoutHandle)
    if (doc) {
      await doc.cleanup().catch(() => {})
    }
  }
}

module.exports = {
  ALLOWED_PDF_ERROR_REASONS,
  PdfExtractionError,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_PAGES,
  DEFAULT_TIMEOUT_MS,
  extractDigitalPdfText,
}
