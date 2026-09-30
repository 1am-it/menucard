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
//      library (plus its worker module — see `loadPdfjsLib`) via
//      `await import(...)` calls inside one async function. This is
//      Node's own documented, standard CommonJS-importing-ESM interop
//      mechanism, not a workaround.
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

const zlib = require('node:zlib')

/** A reasoned, generous-for-a-real-menu-PDF default — a technical,
 * never business-facing bound (per this ticket's own "Vaststaande
 * productkeuzes" §4: no product-level PDF-count limit, but real
 * technical budgets on bytes/pages/time). Callers may override. */
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024 // 15 MB
const DEFAULT_MAX_PAGES = 30
const DEFAULT_TIMEOUT_MS = 15000

/** A real, technical ceiling on the decompressed size of any ONE
 * content-stream `zlib.inflateSync` call inside
 * `extractDigitalPdfTextViaRawStreams` — never left unbounded. Found
 * during this fix's own self-review, not merely a theoretical concern:
 * confirmed directly that 50 MB of trivial repeated data compresses to
 * roughly 50 KB (a ~1000x amplification), which an unbounded
 * `inflateSync` would happily allocate in full — a real decompression-
 * bomb risk this fallback's own byte-level scan would otherwise
 * introduce on top of the existing, unrelated `maxBytes` budget on the
 * PDF's own COMPRESSED input size. Generous for any real PDF content
 * stream (even one compressed 50-100x from an already
 * `DEFAULT_MAX_BYTES`-bounded input stays well under this), never
 * business-facing. */
const FALLBACK_MAX_INFLATED_BYTES = 128 * 1024 * 1024 // 128 MB

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

/** The one, single place `pdfjs-dist` is ever loaded from — both
 * `extractDigitalPdfText` and `extractDigitalPdfLines` call this instead
 * of each holding their own `await import(...)`, so this file keeps
 * exactly two literal import specifiers (the worker module, then the
 * library), verified by a structural test. Node's own dynamic `import()`
 * already caches by specifier, so calling this more than once across a
 * process's lifetime is cheap either way.
 *
 * The worker module is imported first, deliberately. Under Node, PDF.js
 * always runs its worker as a same-thread "fake worker" and, unless
 * `globalThis.pdfjsWorker` is already set, loads it through a COMPUTED
 * dynamic import of "./pdf.worker.mjs", relative to wherever `pdf.mjs`
 * itself ends up at runtime. No static file tracer can follow a computed
 * specifier: a production build of this project traced `pdf.mjs` into
 * the analysis route's serverless-function file list but not
 * `pdf.worker.mjs`, and running this module against only those traced
 * files reproduced "Setting up fake worker failed" for every PDF (mapped
 * to `pdf_corrupt`, rolled up to `pdf_extraction_failed`), while every
 * local run with the full `node_modules` present succeeded. Evaluating
 * the worker module sets `globalThis.pdfjsWorker` itself, which PDF.js
 * checks before ever attempting that computed import — the same
 * same-thread execution model as before, but now a literal, traceable
 * dependency. */
async function loadPdfjsLib() {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  return import('pdfjs-dist/legacy/build/pdf.mjs')
}

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

/** The fixed, five-byte PDF magic number (`%PDF-`) every valid PDF file
 * starts with, per the PDF specification's own "File Structure" chapter
 * — checked BEFORE this module ever hands bytes to `pdfjs-dist`, as a
 * cheap, explicit defense-in-depth signature check. `fetchResult.contentType`
 * (checked one layer up, by the caller) is a claim the remote server
 * made about itself — never trusted alone; this module verifies the
 * bytes it was actually given are structurally a PDF, independent of
 * whatever content-type header accompanied them. */
function hasPdfSignature(bytes) {
  if (bytes.length < 5) return false
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d // "%PDF-"
}

/** Shared validation every extraction entry point in this file applies
 * first, identically — never duplicated with a subtly different check
 * at a second call site. Throws `pdf_corrupt` for anything that is not
 * even byte-shaped like a PDF, and `pdf_too_large` for the byte-budget
 * violation — both checked before any parsing library, real or
 * fallback, ever sees the bytes. */
function validatePdfBytesOrThrow(pdfBytes, maxBytes) {
  if (!Buffer.isBuffer(pdfBytes) && !(pdfBytes instanceof Uint8Array)) {
    throw new PdfExtractionError('pdf_corrupt', 'Input is not a byte buffer')
  }
  if (pdfBytes.length === 0) {
    throw new PdfExtractionError('pdf_corrupt', 'Empty input')
  }
  if (pdfBytes.length > maxBytes) {
    throw new PdfExtractionError('pdf_too_large', `PDF exceeds maxBytes=${maxBytes}`)
  }
  if (!hasPdfSignature(pdfBytes)) {
    throw new PdfExtractionError('pdf_corrupt', 'Input does not start with the PDF signature (%PDF-)')
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

  // Checked before ever touching the parsing library — the cheapest,
  // earliest possible fail-closed point for byte-shape, size budget, and
  // the PDF signature itself.
  validatePdfBytesOrThrow(pdfBytes, maxBytes)

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
      const pdfjsLib = await loadPdfjsLib()

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

/** Groups raw pdfjs text items into visual lines by Y-coordinate, sorted
 * left-to-right within a line — never by their raw content-stream
 * order alone. Confirmed necessary, not merely nice-to-have, against a
 * real digital restaurant menu PDF during this fix's own diagnosis: a
 * genuine multi-column layout emits every item name run, THEN every
 * price in that column, in raw stream order — `extractDigitalPdfText`'s
 * own flattened, single-string-per-page join destroys the one signal
 * (shared Y position) that still lets a price be paired with its own
 * name. `yToleranceUnits` absorbs the small sub-pixel Y jitter within
 * one visual text row (confirmed empirically against that same real
 * PDF: same-row items differ by well under 1 unit) — never large enough
 * to merge two genuinely different rows. */
function groupItemsIntoLines(items, yToleranceUnits = 2) {
  const bucketed = new Map()
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue
    const x = item.transform[4]
    const y = item.transform[5]
    const bucketKey = Math.round(y / yToleranceUnits) * yToleranceUnits
    if (!bucketed.has(bucketKey)) bucketed.set(bucketKey, [])
    bucketed.get(bucketKey).push({ str: item.str, x, y })
  }
  const sortedYs = [...bucketed.keys()].sort((a, b) => b - a) // top of page first
  return sortedYs.map((y) => ({
    y,
    items: bucketed.get(y).sort((a, b) => a.x - b.x),
  }))
}

/**
 * Extracts digital PDF text as **position-aware lines**, one array per
 * page — never the flattened, single-string-per-page shape
 * `extractDigitalPdfText` returns. This is what
 * `src/lib/pdfMenuStructuring.js` requires to pair a menu item's name
 * with its own price; `extractDigitalPdfText` itself is never modified
 * and stays the right choice for anything that only needs plain text
 * (e.g. the existing `unknownMenuContexts` word/page count).
 *
 * Resolves `{ pages: [{ pageNumber, lines: [{ y, items: [{ str, x }] }] }],
 * pageCount }`. Applies the exact same validation, byte/page/time
 * budgets, and closed `PdfExtractionError` vocabulary as
 * `extractDigitalPdfText` — every existing security/budget boundary is
 * reused unchanged, never re-implemented with a subtly different
 * limit. A page with zero text items still contributes an empty
 * `lines: []` entry — never silently dropped, so a caller can tell "no
 * lines on this page" apart from "this page does not exist."
 */
async function extractDigitalPdfLines(pdfBytes, options = {}) {
  const maxBytes = typeof options.maxBytes === 'number' ? options.maxBytes : DEFAULT_MAX_BYTES
  const maxPages = typeof options.maxPages === 'number' ? options.maxPages : DEFAULT_MAX_PAGES
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS

  validatePdfBytesOrThrow(pdfBytes, maxBytes)

  let timeoutHandle
  const timedOut = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new PdfExtractionError('pdf_too_large', `PDF processing exceeded timeoutMs=${timeoutMs}`))
    }, timeoutMs)
  })

  let doc
  try {
    try {
      const pdfjsLib = await loadPdfjsLib()
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

      const pages = []
      let anyLineFound = false
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await Promise.race([doc.getPage(pageNumber), timedOut])
        const textContent = await Promise.race([page.getTextContent(), timedOut])
        const lines = groupItemsIntoLines(textContent.items)
        if (lines.length > 0) anyLineFound = true
        pages.push({ pageNumber, lines })
      }

      if (!anyLineFound) {
        // Same honest signal extractDigitalPdfText's own pdf_no_text_layer
        // case already gives — never guessed at, never a trigger for a
        // future pixel-based pass.
        throw new PdfExtractionError('pdf_no_text_layer', 'PDF loaded successfully but contains no extractable text')
      }

      return { pages, pageCount: doc.numPages }
    } catch (err) {
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

/** Decodes a PDF string-literal body's own escape sequences
 * (`\n`/`\r`/`\t`/`\(`/`\)`/`\\`/a one-to-three-digit octal `\ddd`) per
 * the PDF specification's own "Literal Strings" syntax — the same
 * escaping every real PDF writer already produces, never a guessed or
 * approximate decoding. An unrecognized escape (should not occur in a
 * spec-conforming file) is passed through as its own literal character
 * rather than dropped, so a decoding gap is visible, never silently
 * lossy. */
function decodePdfStringLiteral(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const next = raw[i + 1]
    if (next === 'n') {
      out += '\n'
      i += 1
    } else if (next === 'r') {
      out += '\r'
      i += 1
    } else if (next === 't') {
      out += '\t'
      i += 1
    } else if (next === '(' || next === ')' || next === '\\') {
      out += next
      i += 1
    } else if (next >= '0' && next <= '7') {
      let octal = next
      let j = i + 2
      for (let digits = 0; digits < 2 && raw[j] >= '0' && raw[j] <= '7'; digits += 1, j += 1) octal += raw[j]
      out += String.fromCharCode(parseInt(octal, 8))
      i = j - 1
    } else {
      out += next || ''
      i += 1
    }
  }
  return out
}

/** Every `(literal) Tj` and `[(literal) ... ] TJ` text-showing operator
 * in one already-decompressed PDF content-stream string, in the order
 * they appear — the same two operators `pdfjs-dist` itself ultimately
 * reads text from, applied here as a direct, best-effort byte-level
 * scan for exactly the case this fallback exists for: the surrounding
 * PDF *structure* (page tree, xref) is broken, but this one content
 * stream's own bytes are intact. Never invents text that is not a real,
 * decoded string literal already present in the stream. */
function extractTextShowingOperators(streamText) {
  const parts = []
  for (const m of streamText.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
    parts.push(decodePdfStringLiteral(m[1]))
  }
  for (const m of streamText.matchAll(/\[((?:[^[\]\\]|\\.)*)\]\s*TJ/g)) {
    for (const sm of m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) {
      parts.push(decodePdfStringLiteral(sm[1]))
    }
  }
  return parts.join(' ')
}

/**
 * The maintainable fallback strategy this fix's own ticket requires:
 * when the primary, structure-aware parser (`pdfjs-dist`, via
 * `extractDigitalPdfText`) cannot even open or navigate a PDF's object
 * graph, this function bypasses that graph entirely and scans the raw
 * bytes directly for `stream`/`endstream` blocks, decompresses each
 * (FlateDecode via `node:zlib`, the by far most common PDF stream
 * filter; a stream that fails to inflate is tried as already-literal
 * text instead, never discarded outright), and recovers whatever real
 * `Tj`/`TJ` text-showing content those streams still contain.
 *
 * Deliberately has NO knowledge of pages, page order, or page count —
 * this is a genuine, honest limitation of a structure-bypassing
 * fallback, not an oversight; see `extractDigitalPdfTextWithFallback`'s
 * own `pageCount: null` for how a caller is told this explicitly, never
 * left to assume a real page count exists.
 *
 * Returns a plain string (`''` when nothing was recovered) — never
 * throws; a caller decides what an empty result means for its own
 * error handling. Never a pixel-based text-recognition operation of any
 * kind: this only ever recovers text that was already digitally
 * embedded in the file, exactly like the primary parser it stands in
 * for.
 */
function extractDigitalPdfTextViaRawStreams(pdfBytes) {
  const raw = pdfBytes.toString('latin1')
  const recovered = []
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const streamBytes = Buffer.from(m[1], 'latin1')
    let streamText
    try {
      streamText = zlib.inflateSync(streamBytes, { maxOutputLength: FALLBACK_MAX_INFLATED_BYTES }).toString('latin1')
    } catch {
      // Not FlateDecode-compressed (or genuinely corrupt) — try the raw
      // bytes as already-literal text rather than giving up on this one
      // stream; a stream with no real Tj/TJ content simply contributes
      // nothing below, never a fabricated fallback string.
      streamText = streamBytes.toString('latin1')
    }
    const extracted = extractTextShowingOperators(streamText).trim()
    if (extracted.length > 0) recovered.push(extracted)
  }
  return recovered.join('\n\n').trim()
}

/**
 * Orchestrates the primary parser and the raw-stream fallback into one
 * entry point: tries `extractDigitalPdfText` first, unchanged; only for
 * the two failure classes a raw byte scan could plausibly still recover
 * something from (`pdf_corrupt` — the object graph is broken;
 * `pdf_no_text_layer` — the structured parser found zero text items,
 * which a differently-decoded stream might still contain real text
 * for) does it then attempt the fallback.
 *
 * **Never attempts the fallback for `pdf_encrypted` or
 * `pdf_too_large`** — encryption is a legitimacy boundary a raw byte
 * scan must never be used to bypass (this fallback has no decryption
 * capability at all in any case, but the exclusion is stated explicitly
 * here so a future change can never accidentally wire one in), and a
 * byte/page/time budget is a resource limit, not a parsing weakness, so
 * a fallback attempt would only spend more of that same budget for no
 * legitimate reason. Every existing SSRF/host/redirect/byte/page/timeout
 * boundary this ticket's own hard requirements name is therefore left
 * completely intact — this function only ever adds a second *parsing*
 * attempt within the boundaries the primary path already enforced.
 *
 * Resolves `{ text, pageCount, usedFallback }` — `pageCount` is the
 * real, structured page count when the primary path succeeded
 * (`usedFallback: false`), or `null` when the fallback recovered the
 * text instead (`usedFallback: true`), since a raw byte scan has no
 * reliable page boundaries to report — never a guessed count. Rejects
 * with the ORIGINAL `PdfExtractionError` when the fallback also finds
 * nothing (or was never attempted) — never invents a new, less precise
 * reason once the primary parser has already given a specific one.
 */
async function extractDigitalPdfTextWithFallback(pdfBytes, options = {}) {
  try {
    const result = await extractDigitalPdfText(pdfBytes, options)
    return { ...result, usedFallback: false }
  } catch (err) {
    if (!(err instanceof PdfExtractionError)) throw err
    if (err.reason !== 'pdf_corrupt' && err.reason !== 'pdf_no_text_layer') throw err

    const fallbackText = extractDigitalPdfTextViaRawStreams(pdfBytes)
    if (fallbackText.length === 0) throw err

    return { text: fallbackText, pageCount: null, usedFallback: true }
  }
}

module.exports = {
  ALLOWED_PDF_ERROR_REASONS,
  PdfExtractionError,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_PAGES,
  DEFAULT_TIMEOUT_MS,
  FALLBACK_MAX_INFLATED_BYTES,
  hasPdfSignature,
  extractDigitalPdfText,
  extractDigitalPdfLines,
  extractDigitalPdfTextViaRawStreams,
  extractDigitalPdfTextWithFallback,
}
