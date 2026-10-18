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

/** A document that draws the exact same text twice — an overlay/animation
 * layer, confirmed against the real Smelt Breda menu PDF: that PDF repeats
 * the whole left column 40 units higher, including its own section header.
 * Reading both copies on one baseline pairs unrelated names with each
 * other's price (the real "Hollands Zwitsers" defect). A duplicate is only
 * recognized when ALL of these hold, so a legitimately repeated dish on
 * two menus is never removed:
 *   - at least this many identical (text, x) pairs share one Y offset;
 *   - the two copies' vertical spans overlap (a second list further down
 *     the page, e.g. lunch after dinner, does not);
 *   - the later-drawn copy (higher content-stream `seq`) is the overlay.
 * The last rule is a documented convention, not a visual proof. */
const MIN_DUPLICATE_LAYER_ITEMS = 5
const DUPLICATE_DELTA_TOLERANCE = 2

function layoutItemKey(item) {
  return `${item.str.replace(/\s+/g, ' ').trim().toLowerCase()}|${Math.round(item.x)}`
}

/**
 * Finds an identical, vertically shifted duplicate text layer on one page.
 * Returns `{ suppressedSeqs: Set<number>, count, offset }`; an empty set
 * when the page has no such layer or no item carries a content-stream
 * `seq` (e.g. a hand-built test fixture).
 */
function duplicateLayoutLayer(page) {
  const byKey = new Map()
  for (const line of (page && Array.isArray(page.lines) && page.lines) || []) {
    for (const item of (line && Array.isArray(line.items) && line.items) || []) {
      if (!item || typeof item.str !== 'string' || !item.str.trim() || typeof item.x !== 'number') continue
      if (!Number.isInteger(item.seq) || typeof item.y !== 'number') return { suppressedSeqs: new Set(), count: 0, offset: null }
      const key = layoutItemKey(item)
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(item)
    }
  }

  const deltaCounts = new Map()
  for (const list of byKey.values()) {
    if (list.length < 2) continue
    // Pair by content-stream order: the later-drawn copy of a block sits at a
    // consistent signed offset from the earlier one. Absolute offsets would
    // confuse two different dishes that happen to share a price and an X.
    const ordered = [...list].sort((a, b) => a.seq - b.seq)
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const delta = Math.round((ordered[j].y - ordered[i].y) * 2) / 2
        if (Math.abs(delta) < DUPLICATE_DELTA_TOLERANCE) continue
        deltaCounts.set(delta, (deltaCounts.get(delta) || 0) + 1)
      }
    }
  }
  let modal = null
  for (const [delta, count] of deltaCounts) if (!modal || count > modal.count) modal = { delta, count }
  if (!modal || modal.count < MIN_DUPLICATE_LAYER_ITEMS) return { suppressedSeqs: new Set(), count: 0, offset: null }

  const suppressedSeqs = new Set()
  const primaryYs = []
  const overlayYs = []
  for (const list of byKey.values()) {
    if (list.length < 2) continue
    const ordered = [...list].sort((a, b) => a.seq - b.seq)
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        if (Math.abs(ordered[j].y - ordered[i].y - modal.delta) > DUPLICATE_DELTA_TOLERANCE) continue
        suppressedSeqs.add(ordered[j].seq)
        primaryYs.push(ordered[i].y)
        overlayYs.push(ordered[j].y)
      }
    }
  }
  if (suppressedSeqs.size < MIN_DUPLICATE_LAYER_ITEMS || primaryYs.length === 0) {
    return { suppressedSeqs: new Set(), count: 0, offset: null }
  }
  const overlap =
    Math.min(Math.max(...primaryYs), Math.max(...overlayYs)) - Math.max(Math.min(...primaryYs), Math.min(...overlayYs))
  if (overlap <= 0) return { suppressedSeqs: new Set(), count: 0, offset: null }
  return { suppressedSeqs, count: suppressedSeqs.size, offset: modal.delta }
}

/**
 * Stable page-level column anchors. Derived once per page from every item's
 * X position, never re-derived per line: a row that is empty in one column
 * must not shift the remaining text into that column's state (the real
 * "right-hand dish attributed to the left heading" defect).
 */
function pageColumnAnchors(page, suppressedSeqs = new Set()) {
  const xs = []
  for (const line of (page && Array.isArray(page.lines) && page.lines) || []) {
    for (const item of (line && Array.isArray(line.items) && line.items) || []) {
      if (!item || typeof item.str !== 'string' || !item.str.trim()) continue
      if (typeof item.x !== 'number') continue
      if (Number.isInteger(item.seq) && suppressedSeqs.has(item.seq)) continue
      xs.push(item.x)
    }
  }
  if (xs.length === 0) return []
  xs.sort((a, b) => a - b)
  const anchors = [{ min: xs[0], max: xs[0] }]
  for (const x of xs.slice(1)) {
    const current = anchors[anchors.length - 1]
    if (x - current.max > COLUMN_GAP) anchors.push({ min: x, max: x })
    else current.max = x
  }
  return anchors.map((anchor) => ({ ...anchor, center: (anchor.min + anchor.max) / 2 }))
}

function columnIndexForX(anchors, x) {
  let bestIndex = 0
  let bestDistance = Infinity
  anchors.forEach((anchor, index) => {
    const distance = x < anchor.min ? anchor.min - x : x > anchor.max ? x - anchor.max : 0
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}

/** Assign one reconstructed line's items to the page's stable columns. */
function splitLineIntoPageColumns(lineItems, anchors) {
  if (anchors.length === 0) return []
  const columns = anchors.map(() => [])
  for (const item of Array.isArray(lineItems) ? lineItems : []) {
    if (!item || typeof item.str !== 'string') continue
    columns[columnIndexForX(anchors, item.x)].push(item)
  }
  return columns
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
  const rawText = joinText(lineItems.map((item) => item.str))
  const text = rawText.replace(/\s+\d{1,2}:\d{2}(?:\s*[–-]\s*\d{1,2}:\d{2})?.*$/, '').trim()
  const words = text.split(' ').filter(Boolean)
  // A plain label must start with a capital letter. A wrapped sentence
  // fragment such as the real Smelt "kaasfondue" (the tail of a burger
  // description) is lowercase and must never become a section header.
  const startsWithCapital = (value) => /^\p{Lu}/u.test(value)
  if (PDF_SECTION_LABELS.has(text.toLowerCase()) && startsWithCapital(text)) return text
  // A heading may carry a short service note on the same line
  // ("BORREL Om te delen vanaf 14:30"). That form is only accepted when the
  // line really contains a time — "Kaasfondue naar keuze" is a menu lead-in,
  // not a section, and must not capture the items below it.
  const carriesTime = /\d{1,2}:\d{2}/.test(rawText)
  if (carriesTime && words.length > 1 && words.length <= 6 && PDF_SECTION_LABELS.has(words[0].toLowerCase()) && startsWithCapital(words[0])) {
    return words[0]
  }
  return null
}

const PDF_CHROME_PATTERNS = [
  /^geserveerd\b/i,
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

/**
 * A short capitalised, price-less line that is neither chrome nor a known
 * section nor a description of the previous item is probably a heading this
 * parser does not recognize (the real Smelt lunch sub-headings "Eieren" and
 * "Broodjes"). It is never promoted to a category — doing so would invent
 * structure — but the count is reported so review is honest about it.
 */
function looksLikeUnrecognizedHeading(words, lineText) {
  const visible = (Array.isArray(words) ? words : []).filter((word) => word && word.text.length > 0)
  if (visible.length === 0 || visible.length > 2) return false
  if (/[0-9]/.test(lineText) || lineText.endsWith(':')) return false
  return /^\p{Lu}/u.test(visible[0].text)
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
  const layout = {
    duplicateLayerItems: 0,
    duplicateLayerOffsets: [],
    ambiguousPriceLines: 0,
    supplementLines: 0,
    unrecognizedHeadingLines: 0,
  }

  function categoryFor(name) {
    if (!categoriesByName.has(name)) categoriesByName.set(name, { name, items: [] })
    return categoriesByName.get(name)
  }

  for (const page of Array.isArray(pages) ? pages : []) {
    // A document may draw the same text twice (confirmed in the real Smelt
    // PDF: a complete second left column, 40 units higher). The later copy is
    // an overlay and is ignored; see duplicateLayoutLayer's own header.
    const duplicateLayer = duplicateLayoutLayer(page)
    if (duplicateLayer.count > 0) {
      layout.duplicateLayerItems += duplicateLayer.count
      layout.duplicateLayerOffsets.push(duplicateLayer.offset)
    }
    // Columns are anchored to the whole page, not to one row's index, so an
    // empty left column never shifts right-hand content into the left state.
    const anchors = pageColumnAnchors(page, duplicateLayer.suppressedSeqs)
    const columnStates = anchors.map(() => ({ categoryName: null, lastItem: null }))

    for (const line of page.lines || []) {
      const items = (line && Array.isArray(line.items) ? line.items : []).filter(
        (item) =>
          item &&
          typeof item.str === 'string' &&
          !(Number.isInteger(item.seq) && duplicateLayer.suppressedSeqs.has(item.seq)),
      )
      if (items.length === 0) continue
      const columns = anchors.length > 0 ? splitLineIntoPageColumns(items, anchors) : [items]
      columns.forEach((columnItems, columnIndex) => {
        if (!columnStates[columnIndex]) columnStates[columnIndex] = { categoryName: null, lastItem: null }
        const state = columnStates[columnIndex]

        // A description continuation for the immediately preceding item in
        // the SAME column on the SAME page, only when its leftmost X aligns
        // with that item's name. Never a new item, never another column.
        const attachDescription = (baselineItems) => {
          if (!state.lastItem) return false
          const visible = (Array.isArray(baselineItems) ? baselineItems : []).filter(
            (it) => it && typeof it.str === 'string' && it.str.trim().length > 0,
          )
          if (visible.length === 0) return false
          const leftmostX = Math.min(...visible.map((it) => it.x))
          if (Math.abs(leftmostX - state.lastItem.startX) > DESCRIPTION_X_ALIGNMENT_TOLERANCE) return false
          const text = joinText(visible.map((it) => it.str))
          if (text.length === 0) return false
          state.lastItem.desc = state.lastItem.desc ? `${state.lastItem.desc} ${text}` : text
          state.lastItem.evidenceText = `${state.lastItem.evidenceText}\n${text}`
          return true
        }
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

          const words = tokenizeLineIntoWords(baselineItems)
          // A supplement/extra ("+ Bresaola", "+ Gebakken krieltjes 5",
          // "Botersla ... + Bresaola 15") is a relation the current product
          // concept cannot store. Emitting it as an ordinary dish would
          // disguise a modifier as a main item, so it is skipped and counted.
          const hasSupplementMarker = words.some(
            (word) => word.text === '+' || (word.text.startsWith('+') && word.text.length > 1 && !isPriceToken(word.text.slice(1))),
          )
          if (hasSupplementMarker) {
            layout.supplementLines += 1
            continue
          }
          const pricePositions = words.map((word, index) => (isPriceToken(word.text) ? index : -1)).filter((index) => index >= 0)
          // A price in the middle of a line, with no price at the end, is prose:
          // the real Smelt PDF has "Klassieke Stolwijker van 2,5 jaar oud ..." —
          // reading that as a dish named "Klassieke Stolwijker van" priced 2,50
          // invents an item and drops the real description. Two (name, price)
          // pairs merged into one text string by pdfjs ("Koffie 3.5 Broodje
          // 4.5", the real De Botanist shape) still end with a price and are
          // accepted as two items.
          const priceNotAtLineEnd = pricePositions.length > 0 && pricePositions[pricePositions.length - 1] !== words.length - 1
          if (priceNotAtLineEnd) {
            layout.ambiguousPriceLines += 1
            if (!attachDescription(baselineItems) && looksLikeUnrecognizedHeading(words, lineText)) {
              layout.unrecognizedHeadingLines += 1
            }
            continue
          }

          const recognizedItems = []
          let buffer = []
          let bufferStartX = null
          for (const word of words) {
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

          // No usable price on this baseline. A short capitalized line is a
          // possible heading this parser does not recognize; it never becomes
          // a category and it ends the previous item's description block.
          if (looksLikeUnrecognizedHeading(words, lineText)) {
            layout.unrecognizedHeadingLines += 1
            state.lastItem = null
            continue
          }
          // Otherwise: a description continuation for the immediately
          // preceding item in the same column.
          attachDescription(baselineItems)
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

  return { categories, layout }
}

const MAX_LAYOUT_TEXT_CHARS = 20_000
const MAX_LAYOUT_LINE_CHARS = 400

/**
 * A bounded, page- and column-aware text view of the same lines the menu
 * parser reads. This is the ONLY PDF source text handed to a future model
 * adapter: it keeps the page and column relation (a column separator), drops
 * a duplicate overlay layer, and is truncated honestly. It contains source
 * text, so callers must never log it or persist it in a receipt.
 */
function compactPdfLayoutText(pages, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars > 0 ? options.maxChars : MAX_LAYOUT_TEXT_CHARS
  const parts = []
  let length = 0
  let truncated = false
  for (const page of Array.isArray(pages) ? pages : []) {
    const duplicateLayer = duplicateLayoutLayer(page)
    const anchors = pageColumnAnchors(page, duplicateLayer.suppressedSeqs)
    const lines = []
    for (const line of (page && Array.isArray(page.lines) && page.lines) || []) {
      const items = (line && Array.isArray(line.items) ? line.items : []).filter(
        (item) =>
          item &&
          typeof item.str === 'string' &&
          item.str.trim().length > 0 &&
          !(Number.isInteger(item.seq) && duplicateLayer.suppressedSeqs.has(item.seq)),
      )
      if (items.length === 0) continue
      const columns = anchors.length > 0 ? splitLineIntoPageColumns(items, anchors) : [items]
      const text = columns
        .map((column) => joinText(column.map((item) => item.str)))
        .filter(Boolean)
        .join(' | ')
      if (text) lines.push(text.slice(0, MAX_LAYOUT_LINE_CHARS))
    }
    if (lines.length === 0) continue
    const block = `Pagina ${page.pageNumber}\n${lines.join('\n')}\n`
    if (length + block.length > maxChars) {
      parts.push(block.slice(0, Math.max(0, maxChars - length)))
      truncated = true
      break
    }
    parts.push(block)
    length += block.length
  }
  return { text: parts.join('\n').trim(), truncated }
}

module.exports = {
  MENU_ITEM_CONFIDENCE,
  SECTION_MARKER_PATTERN,
  PRICE_TOKEN_PATTERN,
  MIN_DUPLICATE_LAYER_ITEMS,
  MAX_LAYOUT_TEXT_CHARS,
  isPriceToken,
  isPriceVariantSeparator,
  splitLineIntoColumns,
  pageColumnAnchors,
  splitLineIntoPageColumns,
  duplicateLayoutLayer,
  pureSectionMarkerNames,
  compactPdfLayoutText,
  structurePdfLinesIntoMenu,
}
