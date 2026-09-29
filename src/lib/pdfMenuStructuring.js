// BE-20 — deterministic menu section/item/price recognition from
// position-aware digital-PDF lines (see `src/lib/pdfTextExtraction.js`'s
// own `extractDigitalPdfLines`/`extractDigitalPdfTextWithFallback` —
// never from the flattened, single-string-per-page text
// `extractDigitalPdfText` returns, since pairing a dish name with its
// own price requires the visual line grouping that flattened text
// destroys).
//
// **Never fabricates a menu item.** A (name, price) pair is only ever
// recognized when both a real, non-empty name run and a real,
// pattern-matched price token are actually present, together, on the
// same reconstructed visual line — never guessed at, never invented to
// fill a gap. A line with a price token but no preceding text
// contributes nothing; a line with text but no price token contributes
// nothing as a standalone item (it may, under a narrow, explicit
// condition below, extend the immediately preceding item's own
// description — never a new item).
//
// **Confidence is always exactly `'middel'`, never `'hoog'`.** Matches
// `be-20-general-restaurant-source-extraction.md`'s own explicit rule:
// "`pdf_text` without AI structuring is, on the same basis, at most
// `middel`" — regardless of how clean a deterministic pattern match
// looks, since this module performs no cross-page/cross-source
// confirmation of a menu item (there is no second independent sighting
// to confirm against, the same "unverified" reasoning
// `src/lib/fieldConfidence.js` already applies to restaurant fields).
// Never `'laag'` either — a clean pattern match is not itself evidence
// of a conflict.
//
// **Known, explicit limitation — documented here, not swept under the
// rug**: a real-world PDF whose layout places two visually independent
// columns (e.g. a menu-item column and an unrelated marketing-text
// column) at overlapping Y-positions on the same page can still,
// occasionally, misattribute a no-price line to the wrong preceding
// item if their X-positions happen to be close enough to pass the
// alignment check below. This module reduces that risk (the X-alignment
// heuristic), it does not eliminate it — every recognized item stays at
// confidence `'middel'`, explicitly reviewable, precisely because
// deterministic recognition of this kind is never claimed to be
// perfect.
//
// Deliberately CommonJS, same reasoning as every pure-logic module
// under `src/lib/`.

'use strict'

const { computeFieldEvidenceHash } = require('./fieldEvidenceHash')

/** The one confidence value this module ever assigns — see this file's
 * own header for why it is never `'hoog'` or `'laag'`. */
const MENU_ITEM_CONFIDENCE = 'middel'

/** Matches `// SOME NAME` — a leading-`//`-prefixed section marker,
 * with NO closing `//`. Confirmed directly against a real restaurant
 * menu PDF during this fix's own diagnosis: what first looked, in
 * `extractDigitalPdfText`'s own flattened text, like a wrapped
 * `// NAME //` marker turned out, once position-aware lines separated
 * the real items, to be several independent, PREFIX-ONLY markers next
 * to each other (`// WARME DRANKEN`, `// FRISDRANK`, each its own text
 * item on the same visual row) — the trailing `//` a flattened join
 * seems to show is really the START of the NEXT marker, not a closing
 * delimiter. Requires the WHOLE trimmed item text to match, never a
 * substring inside a longer line, so a stray `//` in ordinary text (a
 * URL fragment, a date) is never mistaken for a section header. */
const SECTION_MARKER_PATTERN = /^\/\/\s*(.+)$/

/** A price-looking token: one to four digits, a decimal separator
 * (`.`/`,`, matching both English- and Dutch-formatted menus), and one
 * or two fraction digits — and nothing else on the token. Deliberately
 * does NOT match a value with a trailing `%` (an ABV/alcohol
 * percentage, e.g. `6.5%`, is never a price) or a value that is part of
 * a larger token. A "8.5 / 24.0"-style glass/bottle dual price is
 * currently only recognized as its first token — a named, explicit gap,
 * not a silent wrong answer (see this file's own header). */
const PRICE_TOKEN_PATTERN = /^\d{1,4}[.,]\d{1,2}$/

/** How close (in the PDF's own coordinate units) a no-price line's own
 * leftmost X must be to the immediately preceding item's own leftmost X
 * before this module ever treats it as that item's description
 * continuation — the X-alignment heuristic this file's own header
 * documents as a real, but not perfect, cross-column contamination
 * guard. */
const DESCRIPTION_X_ALIGNMENT_TOLERANCE = 20

function isPriceToken(str) {
  return typeof str === 'string' && PRICE_TOKEN_PATTERN.test(str.trim())
}

/** `null` unless every item on the line is, on its own, a section
 * marker — a line mixing a section marker with ordinary item text is
 * deliberately never split into two independent readings; see this
 * file's own header for the single-active-section limitation this
 * implies for a page whose header row holds two side-by-side section
 * names. Returns the array of matched section names, in line order. */
function pureSectionMarkerNames(lineItems) {
  const nonBlank = lineItems.filter((it) => it.str.trim().length > 0)
  if (nonBlank.length === 0) return null
  const names = []
  for (const it of nonBlank) {
    const match = it.str.trim().match(SECTION_MARKER_PATTERN)
    if (!match) return null
    names.push(match[1].trim())
  }
  return names
}

function joinText(strs) {
  return strs
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Splits a reconstructed line's own items into individual whitespace-
 * separated words, each still carrying an approximate X position —
 * necessary, not merely convenient: confirmed empirically that
 * `pdfjs-dist` does not reliably keep a name and its own trailing price
 * as two separate text items. Whether it does depends on the exact
 * visual gap between them (its own internal text-layer heuristic, not
 * something this module controls) — the exact same real PDF this fix
 * diagnosed against showed both behaviors on different lines. Scanning
 * per-word rather than per-item is what makes price detection reliable
 * regardless of which way pdfjs happened to split (or not split) a
 * given line's own items. A word past the first one to come from a
 * multi-word item reuses that item's own start X — an approximation,
 * since pdfjs does not hand back per-word positions, but a strictly
 * better one than treating the whole merged string as unsplittable. */
function tokenizeLineIntoWords(lineItems) {
  const words = []
  for (const item of lineItems) {
    for (const word of item.str.split(/\s+/)) {
      if (word.length > 0) words.push({ text: word, x: item.x })
    }
  }
  return words
}

/**
 * The one entry point. `pages` is exactly `extractDigitalPdfLines`'s own
 * `{ pages }` array (or `extractDigitalPdfTextWithFallback`'s fallback
 * path supplies none — this module is never called for a fallback
 * result, which has no position data to structure at all; see the
 * caller in `restaurantSourceAnalysis.js`).
 *
 * Returns `{ categories: [{ name, items: [{ name, desc, price,
 * confidence, contentHash }] }] }` — deliberately the same
 * `categories: [{ name, items: [{ name, desc, price }] }]` shape
 * `src/lib/menuJsonLdExtraction.js` already established for JSON-LD
 * menus, so this never becomes a second, competing model. `name` on a
 * category is `null` for any item found on a page before the first
 * section marker (an honest "no section header found yet" bucket,
 * never a guessed section name). A category with zero items is never
 * included.
 */
function structurePdfLinesIntoMenu(pages) {
  const categoriesByName = new Map() // name (or null) -> { name, items: [] }
  let currentCategoryName = null

  function categoryFor(name) {
    if (!categoriesByName.has(name)) categoriesByName.set(name, { name, items: [] })
    return categoriesByName.get(name)
  }

  for (const page of Array.isArray(pages) ? pages : []) {
    // A description continuation must come from the immediately
    // preceding line on the SAME page — reset at every page boundary,
    // since cross-page attribution is never valid (see this file's own
    // header).
    let lastItemOnThisPage = null

    for (const line of page.lines || []) {
      const sectionNames = pureSectionMarkerNames(line.items)
      if (sectionNames) {
        // Multiple side-by-side headers on one row: only the first
        // becomes the active section — a documented, explicit
        // limitation, never a guess at which item belongs to which of
        // several simultaneous headers.
        currentCategoryName = sectionNames[0]
        lastItemOnThisPage = null
        continue
      }

      const lineText = joinText(line.items.map((it) => it.str))
      if (lineText.length === 0) continue

      const recognizedItems = []
      let buffer = []
      let bufferStartX = null
      for (const word of tokenizeLineIntoWords(line.items)) {
        if (isPriceToken(word.text)) {
          const name = joinText(buffer)
          if (name.length > 0) {
            recognizedItems.push({ name, price: word.text.trim(), startX: bufferStartX })
          }
          buffer = []
          bufferStartX = null
        } else {
          if (buffer.length === 0) bufferStartX = word.x
          buffer.push(word.text)
        }
      }

      if (recognizedItems.length > 0) {
        const category = categoryFor(currentCategoryName)
        for (const { name, price, startX } of recognizedItems) {
          const item = { name, desc: null, price, startX, evidenceText: lineText }
          category.items.push(item)
          lastItemOnThisPage = item
        }
        continue
      }

      // No price token anywhere on this line — a candidate description
      // continuation for the immediately preceding item, but only when
      // its own leftmost X aligns with that item's own name column
      // (see DESCRIPTION_X_ALIGNMENT_TOLERANCE's own doc comment).
      // Never creates a new, price-less "item" — that would not be a
      // reviewable menu candidate, just unattributed text.
      if (lastItemOnThisPage && line.items.length > 0) {
        const leftmostX = Math.min(...line.items.map((it) => it.x))
        if (Math.abs(leftmostX - lastItemOnThisPage.startX) <= DESCRIPTION_X_ALIGNMENT_TOLERANCE) {
          lastItemOnThisPage.desc = lastItemOnThisPage.desc ? `${lastItemOnThisPage.desc} ${lineText}` : lineText
          lastItemOnThisPage.evidenceText = `${lastItemOnThisPage.evidenceText}\n${lineText}`
        }
        // Outside the tolerance: dropped, never attached — an unrelated
        // column's text must never become a fabricated description.
      }
    }
  }

  const categories = [...categoriesByName.values()]
    .map((category) => ({
      name: category.name,
      items: category.items.map((item) => ({
        name: item.name,
        desc: item.desc,
        price: item.price,
        confidence: MENU_ITEM_CONFIDENCE,
        contentHash: computeFieldEvidenceHash(item.evidenceText),
      })),
    }))
    .filter((category) => category.items.length > 0)

  return { categories }
}

module.exports = {
  MENU_ITEM_CONFIDENCE,
  SECTION_MARKER_PATTERN,
  PRICE_TOKEN_PATTERN,
  isPriceToken,
  pureSectionMarkerNames,
  structurePdfLinesIntoMenu,
}
