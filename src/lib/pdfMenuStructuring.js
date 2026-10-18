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

/** A price-looking token: an integer of one to three digits (real menus
 * commonly print "8", "12", "28"), or one to four digits with a decimal
 * separator and one/two fraction digits. Deliberately does NOT match a
 * four-digit integer (a year, e.g. `2026`), a trailing `%` (ABV), or a
 * value inside a larger token. A "8.5 / 24.0"-style dual price is kept as
 * explicit variants by the line parser below, never silently reduced to
 * the first token. */
const PRICE_TOKEN_PATTERN = /^(?:\d{1,3}|\d{1,4}[.,]\d{1,2})$/

/** How close (in the PDF's own coordinate units) a no-price line's own
 * leftmost X must be to the immediately preceding item's own leftmost X
 * before this module ever treats it as that item's description
 * continuation — the X-alignment heuristic this file's own header
 * documents as a real, but not perfect, cross-column contamination
 * guard. */
const DESCRIPTION_X_ALIGNMENT_TOLERANCE = 20

/** A separator between two prices on one visual line: "6.50 / 25.00".
 * It is never a dish name and never a second item. */
const PRICE_VARIANT_SEPARATOR_PATTERN = /^[/|,;+&–—-]+$/

function isPriceToken(str) {
  return typeof str === 'string' && PRICE_TOKEN_PATTERN.test(str.trim())
}

function isPriceVariantSeparator(str) {
  return typeof str === 'string' && PRICE_VARIANT_SEPARATOR_PATTERN.test(str.trim())
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

/** Real PDFs often use plain headings (no `//`) and repeat a service time on
 * the same line. Only this explicitly known vocabulary is treated as a
 * section; arbitrary prose is never promoted to a category. */
const PDF_SECTION_LABELS = new Set([
  'kaasfondue',
  'diner',
  'lunch',
  'borrel',
  'vooraf',
  'hoofd',
  'dessert',
  'desserts',
  'overig',
  'dranken',
  'warme dranken',
  'frisdrank',
])

function pdfSectionLabel(lineItems) {
  if (lineItems.some((item) => isPriceToken(item.str))) return null
  const text = joinText(lineItems.map((item) => item.str))
    .replace(/\s+\d{1,2}:\d{2}(?:\s*[–-]\s*\d{1,2}:\d{2})?.*$/, '')
    .trim()
  return PDF_SECTION_LABELS.has(text.toLowerCase()) ? text : null
}

const PDF_CHROME_PATTERNS = [
  /^geserveerd met\b/i,
  /^smaak\s*:/i,
  /^wijntip\s*:/i,
  /^vraag onze\b/i,
  /^voor \d/i,
  /^allergenen\b/i,
  /^v\s*=\s*vegetarisch\b/i,
]

function isPdfChrome(lineItems) {
  const text = joinText(lineItems.map((item) => item.str))
  return PDF_CHROME_PATTERNS.some((pattern) => pattern.test(text))
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

/** A horizontal gap larger than this is a separate menu column, not the
 * normal name-to-price gap. The real Smelt PDF uses x≈23 and x≈442. */
const COLUMN_GAP = 150

/**
 * Split one visual line into independent columns. Without this a two-column
 * PDF concatenates a left dish with a right dish on the same baseline, which
 * is exactly how real menus acquire invented names and prices.
 */
function splitLineIntoColumns(lineItems) {
  const items = (Array.isArray(lineItems) ? lineItems : []).filter((item) => item && item.str.trim().length > 0)
  if (items.length === 0) return []
  const byX = [...items].sort((a, b) => a.x - b.x)
  const columns = [[byX[0]]]
  for (let i = 1; i < byX.length; i += 1) {
    const current = byX[i]
    const previous = byX[i - 1]
    if (current.x - previous.x > COLUMN_GAP) columns.push([current])
    else columns[columns.length - 1].push(current)
  }
  return columns
}

/** pdfjs may group a name, its description and its price into one visual
 * "line" even when they sit on slightly different baselines. Keep those
 * baselines separate so a description is never glued onto the dish name. */
const BASELINE_TOLERANCE = 1

function splitColumnByBaseline(columnItems) {
  const groups = []
  for (const item of columnItems) {
    const y = typeof item.y === 'number' ? item.y : null
    let group = y === null ? null : groups.find((candidate) => candidate.y !== null && Math.abs(candidate.y - y) <= BASELINE_TOLERANCE)
    if (!group) {
      group = { y, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups.map((group) => group.items)
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

  function categoryFor(name) {
    if (!categoriesByName.has(name)) categoriesByName.set(name, { name, items: [] })
    return categoriesByName.get(name)
  }

  for (const page of Array.isArray(pages) ? pages : []) {
    // A description continuation must come from the immediately preceding
    // line in the SAME column on the SAME page. Columns have independent
    // section and continuation state; reset at every page boundary.
    const columnStates = []

    for (const line of page.lines || []) {
      const columns = splitLineIntoColumns(line.items)
      columns.forEach((columnItems, columnIndex) => {
        if (!columnStates[columnIndex]) columnStates[columnIndex] = { categoryName: null, lastItem: null }
        const state = columnStates[columnIndex]
        for (const baselineItems of splitColumnByBaseline(columnItems)) {
          const sectionNames = pureSectionMarkerNames(baselineItems)
          const plainSection = sectionNames ? null : pdfSectionLabel(baselineItems)
          if (sectionNames || plainSection) {
            // On a single combined row only the first marker is used, exactly
            // as before. When a real column split exists, each column keeps its
            // own active section.
            state.categoryName = sectionNames ? sectionNames[0] : plainSection
            state.lastItem = null
            continue
          }

          const lineText = joinText(baselineItems.map((it) => it.str))
          if (lineText.length === 0 || isPdfChrome(baselineItems)) continue

          const recognizedItems = []
          let buffer = []
          let bufferStartX = null
          for (const word of tokenizeLineIntoWords(baselineItems)) {
            if (isPriceToken(word.text)) {
              const name = joinText(buffer)
              if (name.length > 0) recognizedItems.push({ name, price: word.text.trim(), startX: bufferStartX })
              buffer = []
              bufferStartX = null
            } else {
              if (buffer.length === 0) bufferStartX = word.x
              buffer.push(word.text)
            }
          }

          if (recognizedItems.length > 0) {
            const category = categoryFor(state.categoryName)
            // Merge "name price / secondPrice" into ONE item with two named-less
            // price variants. The separator itself is never a dish name. The
            // product contract cannot store variants yet, so `price` stays null;
            // the concept layer turns this into an explicit blocker rather than
            // silently choosing the first/lowest price or creating "/".
            const lineItems = []
            for (const recognized of recognizedItems) {
              if (isPriceVariantSeparator(recognized.name) && lineItems.length > 0) {
                const previous = lineItems[lineItems.length - 1]
                if (!previous.priceVariants) {
                  previous.priceVariants = [{ label: null, price: previous.price }]
                  previous.priceText = previous.price
                }
                previous.priceVariants.push({ label: null, price: recognized.price })
                previous.priceText = `${previous.priceText} / ${recognized.price}`
                continue
              }
              lineItems.push({ ...recognized })
            }
            for (const recognized of lineItems) {
              const item = {
                name: recognized.name,
                desc: null,
                price: recognized.priceVariants ? null : recognized.price,
                priceStatus: recognized.priceVariants ? 'multiple_undecomposed' : 'known',
                ...(recognized.priceVariants ? { priceVariants: recognized.priceVariants, priceText: recognized.priceText } : {}),
                startX: recognized.startX,
                evidenceText: lineText,
              }
              category.items.push(item)
              state.lastItem = item
            }
            continue
          }

          // No price token anywhere in this baseline — a description
          // continuation for the immediately preceding item in the same
          // column, only when its leftmost X aligns with that item's name.
          if (state.lastItem && baselineItems.length > 0) {
            const leftmostX = Math.min(...baselineItems.map((it) => it.x))
            if (Math.abs(leftmostX - state.lastItem.startX) <= DESCRIPTION_X_ALIGNMENT_TOLERANCE) {
              state.lastItem.desc = state.lastItem.desc ? `${state.lastItem.desc} ${lineText}` : lineText
              state.lastItem.evidenceText = `${state.lastItem.evidenceText}\n${lineText}`
            }
          }
        }
      })
    }
  }

  const categories = [...categoriesByName.values()]
    .map((category) => ({
      name: category.name,
      items: category.items.map((item) => ({
        name: item.name,
        desc: item.desc,
        price: item.price,
        priceStatus: item.priceStatus,
        ...(item.priceVariants ? { priceVariants: item.priceVariants } : {}),
        ...(item.priceText ? { priceText: item.priceText } : {}),
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
  isPriceVariantSeparator,
  splitLineIntoColumns,
  pureSectionMarkerNames,
  structurePdfLinesIntoMenu,
}
