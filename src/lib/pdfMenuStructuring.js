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

/** An alcohol-by-volume token ("5.0%", "6,8 %vol"). It is never a dish name
 * and never a price; leaving it in a name turns "Texels Skiller Wit 5.0%"
 * into a different item name and can create a name-only fake item. */
const ABV_TOKEN_PATTERN = /^\d{1,2}(?:[.,]\d{1,2})?\s*%$/i

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
  let totalItems = 0
  const byKey = new Map()
  for (const line of (page && Array.isArray(page.lines) && page.lines) || []) {
    for (const item of (line && Array.isArray(line.items) && line.items) || []) {
      if (!item || typeof item.str !== 'string' || !item.str.trim() || typeof item.x !== 'number') continue
      if (!Number.isInteger(item.seq) || typeof item.y !== 'number') return { suppressedSeqs: new Set(), count: 0, offset: null }
      totalItems += 1
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
  // A real second text layer covers a substantial part of the page (the
  // confirmed Smelt case repeats a whole column). Repeated prices and repeated
  // short labels on an ordinary menu (De Botanist: five "0.6" syrups and two
  // "4.2" drinks) can otherwise look like a shifted layer and would silently
  // delete real items. Fail closed: a partial coincidence is not an overlay.
  const minimumCoverage = Math.max(MIN_DUPLICATE_LAYER_ITEMS, Math.ceil(totalItems * 0.3))
  if (suppressedSeqs.size < minimumCoverage) {
    return { suppressedSeqs: new Set(), count: 0, offset: null }
  }
  const overlap =
    Math.min(Math.max(...primaryYs), Math.max(...overlayYs)) - Math.max(Math.min(...primaryYs), Math.min(...overlayYs))
  if (overlap <= 0) return { suppressedSeqs: new Set(), count: 0, offset: null }
  return { suppressedSeqs, count: suppressedSeqs.size, offset: modal.delta }
}

/**
 * Some real menu PDFs place two long section markers on one visual row
 * (De Botanist: "// WARME DRANKEN" left, "// FRISDRANK" right). That row is
 * direct evidence of two columns. Using every text X position instead merges
 * the columns, because the gutter between the left price and the right name
 * is narrower than the name-to-price gap inside either column. The marker row
 * therefore defines the column starts when it exists; otherwise the previous
 * position-clustering fallback applies.
 */
function markerRowColumnStarts(page, suppressedSeqs = new Set()) {
  let best = null
  for (const line of (page && Array.isArray(page.lines) && page.lines) || []) {
    const items = (line && Array.isArray(line.items) ? line.items : []).filter(
      (item) =>
        item &&
        typeof item.str === 'string' &&
        item.str.trim().length > 0 &&
        typeof item.x === 'number' &&
        !(Number.isInteger(item.seq) && suppressedSeqs.has(item.seq)),
    )
    if (items.length < 2) continue
    if (!pureSectionMarkerNames(items)) continue
    if (!best || items.length > best.length) best = items
  }
  if (!best) return null
  const starts = []
  for (const x of best.map((item) => item.x).sort((a, b) => a - b)) {
    if (starts.length === 0 || x - starts[starts.length - 1] > 20) starts.push(x)
  }
  return starts.length >= 2 ? starts : null
}

/**
 * Stable page-level column anchors. Derived once per page from every item's
 * X position, never re-derived per line: a row that is empty in one column
 * must not shift the remaining text into that column's state (the real
 * "right-hand dish attributed to the left heading" defect).
 */
function pageColumnAnchors(page, suppressedSeqs = new Set()) {
  const markerStarts = markerRowColumnStarts(page, suppressedSeqs)
  if (markerStarts) {
    return markerStarts.map((start, index) => ({
      min: start,
      max: index + 1 < markerStarts.length ? markerStarts[index + 1] - 1 : Infinity,
      center: start,
    }))
  }
  // No row with two markers. The page may still have two columns whose
  // headings sit on different rows (LUNCH left, SOEPEN EN SALADES right).
  // Count the X positions of text that carries letters; a position that
  // occurs at least twice is a real text column, while a one-off page title
  // or prose fragment is not. Prices are numeric and therefore never define
  // a column here.
  const counts = new Map()
  for (const line of (page && Array.isArray(page.lines) && page.lines) || []) {
    for (const item of (line && Array.isArray(line.items) && line.items) || []) {
      if (!item || typeof item.str !== 'string' || !item.str.trim()) continue
      if (typeof item.x !== 'number') continue
      if (Number.isInteger(item.seq) && suppressedSeqs.has(item.seq)) continue
      if (!/\p{L}/u.test(item.str)) continue
      const key = Math.round(item.x)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  const xs = [...counts.entries()].filter(([, count]) => count >= 2).map(([x]) => x).sort((a, b) => a - b)
  if (xs.length === 0) return []
  const clusters = [{ min: xs[0], max: xs[0], count: counts.get(xs[0]) }]
  for (const x of xs.slice(1)) {
    const current = clusters[clusters.length - 1]
    if (x - current.max > 50) clusters.push({ min: x, max: x, count: counts.get(x) })
    else {
      current.max = x
      current.count += counts.get(x)
    }
  }
  const usable = clusters.filter((cluster) => cluster.count >= 3)
  if (usable.length === 0) return []
  return usable.map((cluster, index) => ({
    min: cluster.min,
    max: index + 1 < usable.length ? usable[index + 1].min - 1 : Infinity,
    center: cluster.min,
  }))
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
 * A short, capitalized price-less line directly above an explicit serving
 * range ("Voor 1, 2 of 4 personen") introduces an arrangement/choice menu.
 * It is not a description of the previous dish; making it one silently
 * attaches arrangement text to an unrelated item (the real Smelt BORREL
 * "Kaasfondue naar keuze" line). Counted, never stored as a dish.
 */
function looksLikeArrangementLeadIn(lineText, nextText) {
  const text = String(lineText || '').trim()
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 4) return false
  if (!/^\p{Lu}/u.test(text)) return false
  if (/[.,:;!?]$/.test(text)) return false
  return /^(voor|vanaf)\s+\d/i.test(String(nextText || '').trim())
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
  // A question/exclamation/period is prose, not a section label.
  if (/[.!?]$/.test(lineText)) return false
  return /^\p{Lu}/u.test(visible[0].text)
}

/** Splits a reconstructed line's own items into individual whitespace-
 * separated words, each still carrying its source text item's X position.
 * pdfjs does not reliably keep a name and its own trailing price as two
 * separate text items; whether it does depends on the exact visual gap (its
 * own internal text-layer heuristic, not something this module controls).
 * `priceOnlyItem` therefore records the one positional fact the PDF itself
 * gives us: an item whose whole text is prices/separators is a price run,
 * while a number that is merely part of a name-bearing item
 * ("Monkey 47", "0.0 Regrets", "6 st.") is not a price position. A price
 * variant sequence ("Wijn 6.5 / 25.0" merged into one item) is recognized at
 * line level by the caller. */
function tokenizeLineIntoWords(lineItems) {
  const words = []
  for (let itemIndex = 0; itemIndex < lineItems.length; itemIndex += 1) {
    const item = lineItems[itemIndex]
    const parts = item.str.split(/\s+/).filter((part) => part.length > 0)
    if (parts.length === 0) continue
    const priceOnlyItem = parts.every((part) => isPriceToken(part) || isPriceVariantSeparator(part))
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      words.push({ text: parts[partIndex], x: item.x, priceOnlyItem, itemIndex, itemLast: partIndex === parts.length - 1 })
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

/** The maximum vertical distance (PDF units) between a name baseline and the
 * price-only baseline directly below it in the same column before the two may
 * be read as one item. Measured against the pinned De Botanist PDF: genuine
 * name/price pairs sit 1.2–18.5 units apart while the median printed row gap
 * is ~11.2; the one 127.8-unit candidate is a loose amount, not a pair. A
 * footer amount hundreds of units away is therefore never that dish's price
 * (review P1), and a price at a normal second-baseline distance still is. */
const MAX_NAME_PRICE_BASELINE_DISTANCE = 24

function baselinesAreVerticallyAdjacent(nameBaselineItems, priceBaselineItems) {
  const ys = (items) =>
    (Array.isArray(items) ? items : [])
      .map((item) => (item && typeof item.y === 'number' ? item.y : null))
      .filter((y) => y !== null)
  const nameYs = ys(nameBaselineItems)
  const priceYs = ys(priceBaselineItems)
  if (nameYs.length === 0 || priceYs.length === 0) return false
  // Within a baseline all items are at most BASELINE_TOLERANCE apart, so the
  // topmost Y is a stable representative of that baseline.
  return Math.abs(Math.max(...nameYs) - Math.max(...priceYs)) <= MAX_NAME_PRICE_BASELINE_DISTANCE
}

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
  // Visual order is left-to-right within a baseline and top-to-bottom across
  // baselines. The PDF content stream is not guaranteed to be in either
  // order: De Botanist emits a price a fraction above its own name, so the
  // price would otherwise be read first and pushed into the ambiguous-prose
  // path. Sorting here keeps every item's own name before its price.
  groups.sort((a, b) => {
    if (a.y === null || b.y === null) return a.y === b.y ? 0 : a.y === null ? 1 : -1
    return b.y - a.y
  })
  return groups.map((group) => group.items.slice().sort((a, b) => a.x - b.x))
}

/** A baseline that holds only one or more price tokens (and variant
 * separators) is the price of the name line directly above it in the same
 * column. Real De Botanist prints "Cappuccino" and "3.8" on two baselines;
 * treating the price as a description and the name as a section heading
 * invents both a category and a missing dish. Returns null unless every
 * visible token is a price or a separator. */
function priceOnlyBaseline(baselineItems) {
  const visible = (Array.isArray(baselineItems) ? baselineItems : []).filter(
    (item) => item && typeof item.str === 'string' && item.str.trim().length > 0,
  )
  if (visible.length === 0) return null
  const prices = []
  for (const item of visible) {
    const text = item.str.trim()
    if (isPriceToken(text)) prices.push(text)
    else if (!isPriceVariantSeparator(text)) return null
  }
  if (prices.length === 0) return null
  return { prices, text: joinText(visible.map((item) => item.str)) }
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
  const categoriesByKey = new Map() // JSON path -> { name, path, items: [], uncertain }
  const layout = {
    duplicateLayerItems: 0,
    duplicateLayerOffsets: [],
    ambiguousPriceLines: 0,
    unlinkedPriceLines: 0,
    supplementLines: 0,
    arrangementLines: 0,
    unrecognizedHeadingLines: 0,
  }

  function categoryFor(path, uncertain) {
    const key = JSON.stringify(path)
    if (!categoriesByKey.has(key)) {
      categoriesByKey.set(key, {
        name: path.length > 0 ? path[path.length - 1] : null,
        path,
        items: [],
        uncertain: uncertain === true,
      })
    }
    return categoriesByKey.get(key)
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
    // Collect every column's visual baselines for the whole page first: a
    // look-ahead (arrangement lead-in -> serving range) must see the next
    // line, not only another item on the same line.
    const columnBaselines = anchors.map(() => [])

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
        if (!columnBaselines[columnIndex]) columnBaselines[columnIndex] = []
        for (const baseline of splitColumnByBaseline(columnItems)) columnBaselines[columnIndex].push(baseline)
      })
    }
    // pdfjs often emits a name and its own price as separate visual lines that
    // differ by less than one coordinate unit (De Botanist: "Cappuccino" at
    // 502.97, "3.8" at 503.74). Merge across the original lines after all
    // items of the page are known, so such a pair is one baseline and reads
    // as "name price" instead of a price-only line plus a heading-like name.
    columnBaselines.forEach((baselines, columnIndex) => {
      columnBaselines[columnIndex] = splitColumnByBaseline(baselines.flat())
    })

    columnBaselines.forEach((baselines, columnIndex) => {
      const state = { menuName: null, categoryPath: null, categoryInferred: false, lastItem: null, pendingSupplement: false }
      // A price on its own baseline is consumed by the name line above it;
      // other items on that same baseline (a second column's item) stay.
      const consumedItems = new Set()

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
        for (let baselineIndex = 0; baselineIndex < baselines.length; baselineIndex += 1) {
          const baselineItems = baselines[baselineIndex].filter((item) => !consumedItems.has(item))
          if (baselineItems.length === 0) continue
          const nextBaseline = (baselines[baselineIndex + 1] || []).filter((item) => !consumedItems.has(item))
          const sectionNames = pureSectionMarkerNames(baselineItems)
          const plainSection = sectionNames ? null : pdfSectionLabel(baselineItems)
          if (sectionNames || plainSection) {
            // On a single combined row only the first marker is used, exactly
            // as before. When a real column split exists, each column keeps its
            // own active section.
            const headingText = joinText(baselineItems.map((it) => it.str))
            const carriesServiceTime = /\d{1,2}:\d{2}/.test(headingText)
            if (sectionNames) {
              // An explicit // marker is its own top-level section.
              state.menuName = sectionNames[0]
              state.categoryPath = [sectionNames[0]]
              state.categoryInferred = false
            } else if (carriesServiceTime || !state.menuName) {
              // A plain heading with a service time (DINNER 17:30, LUNCH
              // 12:00–15:00) is the menu level; without one it stays top-level
              // when nothing is active.
              state.menuName = plainSection
              state.categoryPath = [plainSection]
              state.categoryInferred = false
            } else {
              // A plain heading below an active menu heading is a subcategory
              // (Smelt: LUNCH > Eieren/Broodjes/Overig). The level is inferred
              // from order and column state, not typography, so it is marked
              // uncertain for review.
              state.categoryPath = [state.menuName, plainSection]
              state.categoryInferred = true
            }
            state.lastItem = null
            state.pendingSupplement = false
            continue
          }

          const lineText = joinText(baselineItems.map((it) => it.str))
          if (lineText.length === 0 || isPdfChrome(baselineItems)) continue

          const words = tokenizeLineIntoWords(baselineItems)
          // A line explicitly labelled "Supplement ..." is a relation the
          // product cannot store. It is never emitted as an ordinary dish,
          // whether the amount is printed inline ("Supplement serranoham 2.5")
          // or on the wrapped continuation of the supplement name
          // ("Supplement krokante" then lowercase "prosciutto 2.5").
          if (/^supplement(?:en)?\b/i.test(lineText)) {
            state.pendingSupplement = !words.some((word) => isPriceToken(word.text))
            layout.supplementLines += 1
            state.lastItem = null
            continue
          }
          if (state.pendingSupplement) {
            state.pendingSupplement = false
            // Only a lowercase wrapped continuation belongs to the supplement
            // name; a capitalized line is a new dish and must stay one.
            if (/^\p{Ll}/u.test(lineText)) {
              layout.supplementLines += 1
              state.lastItem = null
              continue
            }
          }
          // A price is credible when its own PDF text item consists solely of
          // prices/separators ("4.50"), when it is part of an explicit variant
          // sequence ("6.5 / 25.0"), or when pdfjs merged a trailing price into
          // a name-bearing item ("Fictief Broodje 3.00") and no separately
          // positioned price run sits to its right. A price-shaped number inside
          // a name is never a price when a real price run is printed to its
          // right ("Monkey 47" -> 10.0, "0.0 Regrets" -> 7.5, "6 st." -> 65.0).
          // (review 6249303096 P1)
          const variantItemIndexes = new Set()
          for (let index = 0; index + 2 < words.length; index += 1) {
            if (
              isPriceToken(words[index].text) &&
              isPriceVariantSeparator(words[index + 1].text) &&
              isPriceToken(words[index + 2].text)
            ) {
              for (const variantWord of words.slice(index, index + 3)) variantItemIndexes.add(variantWord.itemIndex)
            }
          }
          const isPriceWord = (word) =>
            isPriceToken(word.text) &&
            (word.priceOnlyItem ||
              variantItemIndexes.has(word.itemIndex) ||
              (word.itemLast === true && !words.some((other) => other.priceOnlyItem && other.x > word.x)))
          // A baseline that holds nothing but price tokens/separators and was
          // not consumed by a name baseline above it is read content the parser
          // cannot link to an item. Count it so review sees it; never silently
          // drop it and never attach it to an unrelated dish.
          const priceOnlyLine =
            words.length > 0 && words.every((word) => isPriceToken(word.text) || isPriceVariantSeparator(word.text))
          if (priceOnlyLine) {
            layout.unlinkedPriceLines += 1
            state.lastItem = null
            continue
          }
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
          const pricePositions = words.map((word, index) => (isPriceWord(word) ? index : -1)).filter((index) => index >= 0)
          const priceShapedPositions = words
            .map((word, index) => (isPriceToken(word.text) ? index : -1))
            .filter((index) => index >= 0)
          // The line ends in a price-shaped token, but its own text item also
          // contains name text (or a unit) instead of being a price run. Do not
          // guess an item, do not attach the line to the previous dish, and do
          // not throw it away silently: count it as an unlinked price line.
          if (pricePositions.length === 0 && priceShapedPositions.length > 0 && priceShapedPositions[priceShapedPositions.length - 1] === words.length - 1) {
            layout.unlinkedPriceLines += 1
            state.lastItem = null
            continue
          }
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
            if (isPriceWord(word)) {
              const name = joinText(buffer)
              if (name.length > 0) recognizedItems.push({ name, price: word.text.trim(), startX: bufferStartX })
              buffer = []
              bufferStartX = null
            } else if (ABV_TOKEN_PATTERN.test(word.text)) {
              // ABV is a property, not part of the dish name.
              continue
            } else {
              if (buffer.length === 0) bufferStartX = word.x
              buffer.push(word.text)
            }
          }

          if (recognizedItems.length > 0) {
            const category = categoryFor(state.categoryPath || [], state.categoryInferred)
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

          // Name and price on two consecutive baselines in this column.
          // De Botanist prints many items this way ("Cappuccino" then
          // "3.8"); the price is not a description and the name is not a
          // section heading. Only a line that already looks like a short
          // capitalized item name is paired, only with a baseline that holds
          // nothing but prices/separators, and only when that baseline is
          // demonstrably close: a loose amount hundreds of units further down
          // the page is never this dish's price (review P1).
          const nextPrices = baselinesAreVerticallyAdjacent(baselineItems, nextBaseline)
            ? priceOnlyBaseline(nextBaseline)
            : null
          if (nextPrices && looksLikeUnrecognizedHeading(words, lineText)) {
            const category = categoryFor(state.categoryPath || [], state.categoryInferred)
            const priceVariants = nextPrices.prices.length > 1
              ? nextPrices.prices.map((price) => ({ label: null, price }))
              : null
            const item = {
              name: lineText,
              desc: null,
              price: priceVariants ? null : nextPrices.prices[0],
              priceStatus: priceVariants ? 'multiple_undecomposed' : 'known',
              ...(priceVariants ? { priceVariants, priceText: nextPrices.text } : {}),
              startX: Math.min(...baselineItems.map((it) => it.x)),
              evidenceText: `${lineText} ${nextPrices.text}`,
            }
            category.items.push(item)
            state.lastItem = item
            for (const priceItem of nextBaseline) {
              const priceItemText = priceItem.str.trim()
              if (isPriceToken(priceItemText) || isPriceVariantSeparator(priceItemText)) consumedItems.add(priceItem)
            }
            continue
          }

          // A single Title Case word directly below an item, aligned with
          // that item's name, is a flavour/variant continuation ("Red Bull
          // Red Edition" -> "Watermelon", "Texels Skuumkoppe" ->
          // "Dunkelweizen"), not a new section. Multi-word and ALL-CAPS lines
          // keep the existing heading path; a plural ("Broodjes", "Oesters")
          // is treated as a category, not a flavour word.
          if (/^\p{Lu}[\p{Ll}'-]+$/u.test(lineText) && !/s$/i.test(lineText) && state.lastItem) {
            if (attachDescription(baselineItems)) continue
          }

          // No usable price on this baseline. A short capitalized line is a
          // possible heading this parser does not recognize; it ends the
          // previous item's description block. Below an active menu heading it
          // is kept as an inferred subcategory (marked uncertain), so its
          // dishes never join the parent section.
          if (looksLikeUnrecognizedHeading(words, lineText)) {
            if (state.menuName) {
              state.categoryPath = [state.menuName, lineText]
              state.categoryInferred = true
              state.lastItem = null
              continue
            }
            layout.unrecognizedHeadingLines += 1
            state.lastItem = null
            continue
          }
          // "Kaasfondue naar keuze" followed by "Voor 1, 2 of 4 personen" is an
          // arrangement lead-in, not a description of the previous dish.
          if (state.menuName && looksLikeArrangementLeadIn(lineText, joinText(nextBaseline.map((it) => it.str)))) {
            layout.arrangementLines += 1
            state.lastItem = null
            continue
          }
          // Otherwise: a description continuation for the immediately
          // preceding item in the same column.
          attachDescription(baselineItems)
        }
      })
    }

  const categories = [...categoriesByKey.values()]
    .map((category) => ({
      name: category.name,
      ...(category.path.length > 0 ? { path: category.path } : {}),
      ...(category.uncertain ? { uncertain: true } : {}),
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
  splitColumnByBaseline,
  pageColumnAnchors,
  splitLineIntoPageColumns,
  duplicateLayoutLayer,
  pureSectionMarkerNames,
  compactPdfLayoutText,
  structurePdfLinesIntoMenu,
}
