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

/** A standalone supplement label opens a supplement SECTION, whose rows are
 * relations the current product concept cannot store. It must be exactly the
 * label (optionally with a parenthetical note or trailing colon), so the real
 * inline forms "Supplement serranoham 2.5" and "Supplement krokante" stay the
 * existing one-row inline markers instead of swallowing the next ordinary
 * dish. A plain (no "//") label is only accepted in its plural form for the
 * same reason. See review 6252891629 P1. */
const SUPPLEMENT_HEADING_PATTERN = /^supplement(?:en)?(?:\s*\([^)]*\))?\s*:?$/i

function isSupplementHeadingText(value, { explicitMarker = false } = {}) {
  const text = String(value || '').trim()
  if (!SUPPLEMENT_HEADING_PATTERN.test(text)) return false
  // A "//" marker is explicit source evidence whether it prints singular or
  // plural; a plain label must be the plural section form and capitalized,
  // exactly like every other plain section label in this file.
  if (!explicitMarker && !/^supplementen\b/i.test(text)) return false
  return explicitMarker || /^\p{Lu}/u.test(text)
}

/** The plain-text supplement section label, or null. Never a price-bearing
 * line: "Supplement serranoham 2.5" is an inline marker, not a heading. */
function plainSupplementHeading(lineItems) {
  if (lineItems.some((item) => isPriceToken(String(item.str).trim()))) return null
  const text = joinText(lineItems.map((item) => item.str))
  return isSupplementHeadingText(text) ? text.replace(/\s*:$/, '').trim() : null
}

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

/** A unit directly after a number makes that number a portion/quantity
 * ("6 st.", "2 personen", "0,3 l"), never an amount. Deliberately a closed
 * vocabulary: an unknown word after a number is not treated as a unit, so a
 * real price is never reclassified because of a stray label. */
const QUANTITY_UNIT_PATTERN = /^(?:st|stk|stuks?|pers|persoon|personen|pp|glas|glazen|fles|flessen|btl|bottel|karaf|cl|ml|liter|l|gram|gr|kg|cm|%)\.?$/i

/** "0.0"/"0,00" is the common alcohol-free marker ("0.0 Regrets"), never a
 * price: a genuinely free item is printed as "gratis", not as a zero amount. */
const ZERO_AMOUNT_MARKER_PATTERN = /^0[.,]0+$/

function isQuantityUnit(str) {
  return typeof str === 'string' && QUANTITY_UNIT_PATTERN.test(str.trim())
}

/** Whether a token carries name text. An ABV token is a property, not a
 * name, so it never counts as a name boundary here. */
function isNameWord(word) {
  const text = word && typeof word.text === 'string' ? word.text : ''
  return /\p{L}/u.test(text) && !ABV_TOKEN_PATTERN.test(text)
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
  // A marker that sits at a stable text-column start defines that column even
  // when no second marker shares its row (De Botanist page 3: PREMIUM
  // FRISDRANKEN on the left, `// Double Dutch` further down on the right). A
  // centered menu title ("// ONZE COCKTAILS") is not a column start and must
  // not create one; requiring a repeated text X filters those out. The column
  // is widened 10 units to the left because a marker can be indented slightly
  // relative to its own items (page 14: `// OESTERS` at 217.5, items at 217.5;
  // page 5: `// KLASSIEKERS` at 220.9, the column starts at 217.5).
  if (xs.length > 0) {
    const stableStarts = [...counts.entries()].filter(([, count]) => count >= 3).map(([x]) => x)
    const markerXs = []
    for (const line of (page && Array.isArray(page.lines) && page.lines) || []) {
      for (const item of (line && Array.isArray(line.items) && line.items) || []) {
        if (!item || typeof item.str !== 'string' || typeof item.x !== 'number') continue
        if (Number.isInteger(item.seq) && suppressedSeqs.has(item.seq)) continue
        const match = item.str.trim().match(SECTION_MARKER_PATTERN)
        if (!match) continue
        if (!stableStarts.some((x) => Math.abs(x - item.x) <= 20)) continue
        markerXs.push(item.x)
      }
    }
    const markerStarts = []
    for (const x of markerXs.sort((a, b) => a - b)) {
      if (markerStarts.length === 0 || x - markerStarts[markerStarts.length - 1] > 20) markerStarts.push(x)
    }
    if (markerStarts.length >= 2) {
      return markerStarts.map((start, index) => ({
        min: Math.max(0, start - 10),
        max: index + 1 < markerStarts.length ? markerStarts[index + 1] - 11 : Infinity,
        center: start,
      }))
    }
  }
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

/**
 * A name that sits on its own baseline directly above a price-only baseline may
 * be longer than the two-word heuristic used for an *inferred heading*. Real
 * menus print "Blue Velvet Gnocchi" and "The Crunchy Caprese" on one baseline
 * with only the amount below it. This predicate is used only for that already
 * bounded name/price pairing: the price baseline must be within
 * MAX_NAME_PRICE_BASELINE_DISTANCE and hold nothing but prices/separators, so a
 * prose sentence is still never promoted to a dish. Commas/semicolons and a
 * trailing sentence mark stay prose.
 */
function looksLikePairableItemName(words, lineText) {
  const visible = (Array.isArray(words) ? words : []).filter(
    (word) => word && typeof word.text === 'string' && word.text.trim().length > 0,
  )
  if (visible.length === 0 || visible.length > 6) return false
  if (!isNameWord(visible[0])) return false
  if (!/^\p{Lu}/u.test(visible[0].text)) return false
  const lastWord = visible[visible.length - 1].text
  const endsWithPortionLabel = STANDALONE_PORTION_PATTERN.test(lastWord)
  if (/[;,:]$/.test(lineText) || /[!?]$/.test(lineText)) return false
  // A trailing period is a sentence mark, except in a unit abbreviation that
  // is already recognised as a portion label ("Rendang Croquettes 6st.").
  if (lineText.endsWith('.') && !endsWithPortionLabel) return false
  return true
}

/**
 * A short Title-Case line directly below a priced item, aligned with its name,
 * is a description/tasting note in this layout ("England IPA" under "Juice
 * Punch New", "Hibiscus Soda" under a truncated drink name), not a section
 * heading. Multi-word headings are never promoted from such a position; a real
 * heading is still recognised by `//`, a known plain label, or a separate
 * heading position. ALL-CAPS lines stay headings.
 */
function looksLikeShortItemContinuation(lineText) {
  const text = String(lineText || '').trim()
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 4) return false
  if (/[0-9]/.test(text) || /[.!?:;,]$/.test(text)) return false
  if (!/^\p{Lu}/u.test(text)) return false
  if (text === text.toUpperCase()) return false
  return true
}

/**
 * "8st.", "6 st.", "2 personen" on its own is a portion/quantity label, never
 * part of a dish name. `QUANTITY_UNIT_PATTERN` already provides the closed unit
 * vocabulary; this helper only matches the complete token, so "8st." inside a
 * longer name is left untouched.
 */
const STANDALONE_PORTION_PATTERN = /^\d{1,3}\s*(?:st|stk|stuks?|pers|persoon|personen|pp|glas|glazen|fles|flessen|btl|bottel|karaf|cl|ml|liter|l|gram|gr|kg)\.?$/i

function isStandalonePortionToken(str) {
  return typeof str === 'string' && STANDALONE_PORTION_PATTERN.test(str.trim())
}

/**
 * A wrapped item name is only extended when the source itself gives explicit
 * evidence. Two dishes/shapes are otherwise indistinguishable from a
 * description:
 *   - a connector at the end of the name ("Dutch Cucumber &", "Kazen van",
 *     "Liquid Dessert -") or at the start of the continuation ("/ Ginger Ale",
 *     "(20cl)");
 *   - a portion label on the continuation baseline ("8st.") or a parenthesised
 *     portion inside it ("(20cl)");
 *   - a short "&" variant list ("Passionfruit & Lime");
 *   - the same brand/name prefix repeating on the next priced item, which is a
 *     choice-list pattern ("Cultcha Kombucha X" followed by "Cultcha Kombucha
 *     Y").
 * Without one of these, the line stays a description or is reported as an
 * unresolved continuation; it is never guessed into the name.
 */
function nameContinuationEvidence(previousName, continuationText, nextItems, nextLineText, hasStandalonePortion) {
  const previous = String(previousName || '').trim()
  const continuation = String(continuationText || '').trim()
  if (previous.length === 0 || continuation.length === 0) return null
  const continuationWords = continuation.split(/\s+/).filter(Boolean)
  const continuationIsNameLike = /^\p{Lu}/u.test(continuation) && continuationWords.length >= 2
  if (/(?:[/&+\-–—,]|\b(?:van|met|en|of))$/i.test(previous)) return 'name-connector'
  if (/^[/&+\-–—(]/.test(continuation)) return 'continuation-connector'
  if (isStandalonePortionToken(continuation) || hasStandalonePortion === true) return 'portion'
  if (/\(\s*\d{1,3}\s*(?:cl|ml|l|liter|gram|gr|kg|st|stk|pers|personen)\s*\)/i.test(continuation)) return 'portion'
  if (continuationIsNameLike && continuation.includes('&')) return 'variant-list'
  const firstWord = previous.split(/\s+/).filter(Boolean)[0]
  const nextText = joinText((Array.isArray(nextItems) ? nextItems : []).map((item) => item.str))
  const nextFirstWord = nextText.split(/\s+/).filter(Boolean)[0]
  if (continuationIsNameLike && firstWord && nextFirstWord && nextFirstWord.toLowerCase() === firstWord.toLowerCase()) {
    return 'repeated-prefix'
  }
  // Look one line further only when that line is the next priced item; the
  // repeated prefix is the evidence, not the mere presence of another line.
  const beyondText = String(nextLineText || '').trim()
  const beyondFirstWord = beyondText.split(/\s+/).filter(Boolean)[0]
  if (continuationIsNameLike && firstWord && beyondFirstWord && beyondFirstWord.toLowerCase() === firstWord.toLowerCase()) {
    return 'repeated-prefix'
  }
  return null
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

/**
 * Splits one baseline's price-shaped tokens into name evidence and amount
 * candidates using only explicit local evidence, never a bare numeric block
 * and never the amount's own writing style.
 * pdfjs may keep a name-internal number in the name's own item ("Monkey 47",
 * "6 st.") or split it into its own item ("Monkey", "47"); neither text-item
 * shape proves by itself which number belongs to the name and which is the
 * amount, because pdfjs also merges an ordinary name and its trailing price
 * into one item ("Fictief Broodje 3.00").
 *   - a number directly followed by a unit is a quantity ("6 st.", "0,3 l");
 *   - a leading "0.0" alcohol-free marker opens the name ("0.0 Regrets"),
 *     never a nameless price; any other leading number is not glued onto the
 *     following name because it may be a neighbouring column's price run;
 *   - every other price-shaped token between a name run and a trailing amount
 *     is ambiguous, whether it is printed as "6", "6.0" or "6,00". The line
 *     proves a name run and an amount column, not which number belongs to the
 *     name; calling the first one name text silently promotes the second to a
 *     known price (review 6249915021 P1). A pdfjs text item is not proof
 *     either: pdfjs merges a name and a nearby amount into one item, so
 *     "Monkey 47 10.0" and a glass/bottle row are the same evidence. Explicit
 *     variants ("6.5 / 25.0") are never ambiguous.
 * Returns index sets, never source text.
 */
function classifyNumericEvidence(words) {
  const nameEmbedded = new Set()
  const ambiguous = new Set()
  const list = Array.isArray(words) ? words : []
  const nameAt = list.map((word) => isNameWord(word))
  const variantSequenceAt = (index) =>
    (index >= 2 && isPriceToken(list[index - 2].text) && isPriceVariantSeparator(list[index - 1].text)) ||
    (index + 2 < list.length && isPriceVariantSeparator(list[index + 1].text) && isPriceToken(list[index + 2].text))
  for (let index = 0; index < list.length; index += 1) {
    if (!isPriceToken(list[index].text)) continue
    if (variantSequenceAt(index)) continue
    const next = list[index + 1]
    // 1. A number followed by a unit and then by a real amount is a
    //    quantity, not an amount ("Oesters 6 st. 24.00", "1 fles 25.00").
    //    Without a later amount the number keeps its ordinary reading, so a
    //    genuine "Wijn 6.5 glas" price is not silently reclassified.
    if (
      next &&
      isQuantityUnit(next.text) &&
      list.slice(index + 2).some((word) => isPriceToken(word.text))
    ) {
      nameEmbedded.add(index)
      continue
    }
    const nameBefore = nameAt.slice(0, index).some(Boolean)
    const nameAfter = nameAt.slice(index + 1).some(Boolean)
    // 2. A leading "0.0" alcohol-free marker opens the name ("0.0 Regrets")
    //    instead of becoming a nameless price. Any other leading number keeps
    //    the conservative reading: it is a price run that may belong to a
    //    neighbouring column, so it is never glued onto the following name.
    if (!nameBefore && nameAfter && ZERO_AMOUNT_MARKER_PATTERN.test(list[index].text.trim())) {
      nameEmbedded.add(index)
      continue
    }
    // 3. Any other number between a name run and a trailing amount column.
    //    This is the only place the previous rule used the amount's writing
    //    style as a tie-breaker: a decimal became ambiguous while the same
    //    evidence printed as an integer became name text and thereby promoted
    //    the next number to a known price ("Wijn 6 25" -> "Wijn 6", 25 known).
    //    A name number and a glass/bottle amount column are indistinguishable
    //    here, and pdfjs's own text-item grouping is not independent proof
    //    (it merges a name and a nearby amount into one item). Report the row;
    //    only explicit evidence above resolves a number, and no spelling may
    //    ever change that decision.
    if (!nameBefore || nameAfter) continue
    if (!list.slice(index + 1).some((word) => isPriceToken(word.text))) continue
    if (ZERO_AMOUNT_MARKER_PATTERN.test(list[index].text.trim())) {
      nameEmbedded.add(index)
      continue
    }
    ambiguous.add(index)
  }
  return { nameEmbedded, ambiguous }
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
 * baselines separate so a description is never glued onto the dish name. A
 * standalone ABV item is dropped before grouping (see splitColumnByBaseline),
 * and an amount printed a hair above its own name is paired by the bounded
 * look-behind in the parser, so no larger tolerance is needed here. */
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
    // An ABV token ("5.0%") is a property, never a name or a price. Dropping a
    // standalone ABV item before grouping keeps it from being glued onto a name
    // when pdfjs prints it on a micro-baseline of its own; the amount and the
    // name remain, and the ABV is not stored anyway.
    if (item && typeof item.str === 'string' && ABV_TOKEN_PATTERN.test(item.str.trim())) continue
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
    inheritedSectionColumns: 0,
    inheritedSubheadingColumns: 0,
    nameContinuationLines: 0,
    portionLines: 0,
    // Bounded provenance for a supplement section: the printed heading and
    // page numbers only. Never the supplement item names or amounts.
    supplementSections: [],
  }

  // A supplement heading applies to the whole section in its own column until
  // the next demonstrable section heading. The same heading may occur on more
  // than one page; merge it into one provenance entry with a line count.
  const supplementSectionProvenance = new Map()
  const recordSupplementSection = (heading, pageNumber) => {
    if (!supplementSectionProvenance.has(heading)) {
      supplementSectionProvenance.set(heading, { heading, pages: new Set(), lines: 0 })
    }
    const entry = supplementSectionProvenance.get(heading)
    if (Number.isInteger(pageNumber)) entry.pages.add(pageNumber)
    return entry
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

    // Headings on this page, in visual order. A column that prints no heading of
    // its own continues the section of the adjacent column above it (a real
    // magazine layout: the STARTERS heading sits in the left column while the
    // right column keeps listing starters). That relation is structural evidence,
    // not a guess, but it stays marked uncertain for review. A marker that opens
    // a column directly beneath exactly one parent heading is a brand/sub-heading
    // of that parent (De Botanist: "// PREMIUM FRISDRANKEN" above "// Double
    // Dutch"), never a second top-level section.
    const headingEvents = []
    const stableTextStarts = (() => {
      const counts = new Map()
      for (const line of (page && Array.isArray(page.lines) && page.lines) || []) {
        for (const item of (line && Array.isArray(line.items) && line.items) || []) {
          if (!item || typeof item.str !== 'string' || !item.str.trim()) continue
          if (typeof item.x !== 'number' || !/\p{L}/u.test(item.str)) continue
          if (Number.isInteger(item.seq) && duplicateLayer.suppressedSeqs.has(item.seq)) continue
          const key = Math.round(item.x)
          counts.set(key, (counts.get(key) || 0) + 1)
        }
      }
      return [...counts.entries()].filter(([, count]) => count >= 3).map(([x]) => x)
    })()
    columnBaselines.forEach((baselines, columnIndex) => {
      for (const baseline of baselines) {
        const items = baseline.filter((item) => item && typeof item.str === 'string' && item.str.trim().length > 0)
        if (items.length === 0) continue
        const names = pureSectionMarkerNames(items)
        const plain = names ? null : pdfSectionLabel(items)
        if (!names && !plain) continue
        const leftmostX = Math.min(...items.map((item) => (typeof item.x === 'number' ? item.x : 0)))
        headingEvents.push({
          y: Math.max(...items.map((item) => (typeof item.y === 'number' ? item.y : 0))),
          x: leftmostX,
          columnIndex,
          path: names ? [names[0]] : [plain],
          // A centered menu title ("// SHARED DINING 17:00 - 21:00") is not a
          // column heading; only a marker at a repeated text-column start can be
          // the parent of a sub-heading.
          stableColumnStart: stableTextStarts.some((x) => Math.abs(x - leftmostX) <= 20),
        })
      }
    })
    const closestAbove = (events, y) => {
      const above = events.filter((event) => event.y > y + BASELINE_TOLERANCE).sort((a, b) => a.y - b.y)
      return above.length > 0 ? above[0] : null
    }

    const SUBHEADING_PARENT_WINDOW = 40
    // Two section markers on the same printed row can differ by a couple of
    // text-layer units (De Botanist WITTE/ROSÉ: 1.25). They are siblings, not a
    // parent/child pair; only a visibly lower marker is a sub-heading.
    const SIBLING_HEADING_TOLERANCE = 3

    columnBaselines.forEach((baselines, columnIndex) => {
      const firstContentY = (() => {
        for (const baseline of baselines) {
          const items = baseline.filter((item) => item && typeof item.str === 'string' && item.str.trim().length > 0)
          if (items.length === 0) continue
          const isHeading = Boolean(pureSectionMarkerNames(items) || pdfSectionLabel(items))
          if (!isHeading) return Math.max(...items.map((item) => (typeof item.y === 'number' ? item.y : 0)))
        }
        return -Infinity
      })()
      const ownHeading = closestAbove(
        headingEvents.filter((event) => event.columnIndex === columnIndex),
        firstContentY,
      )
      let inheritedEvent = null
      let inheritedAsSubheading = false
      if (!ownHeading) {
        inheritedEvent = closestAbove(
          headingEvents.filter((event) => event.columnIndex !== columnIndex),
          firstContentY,
        )
      } else {
        const parent = closestAbove(
          headingEvents.filter((event) => event.columnIndex !== columnIndex && event.stableColumnStart),
          ownHeading.y,
        )
        const distance = parent ? parent.y - ownHeading.y : Infinity
        if (parent && distance > SIBLING_HEADING_TOLERANCE && distance <= SUBHEADING_PARENT_WINDOW) {
          inheritedEvent = parent
          inheritedAsSubheading = true
        }
      }
      const inheritedPath = inheritedEvent ? [...inheritedEvent.path] : null
      // A "//" supplement marker is explicit, so a column with no heading of
      // its own may inherit it. Such a column must never turn supplement rows
      // into ordinary dishes (that was review 6252891629 P1).
      const inheritedSupplement = Boolean(
        inheritedPath &&
          inheritedPath.length === 1 &&
          isSupplementHeadingText(inheritedPath[0], { explicitMarker: true }),
      )
      const currentPageNumber = Number.isInteger(page.pageNumber) ? page.pageNumber : null
      const state = {
        menuName: inheritedPath && !inheritedSupplement ? inheritedPath[0] : null,
        categoryPath: inheritedSupplement ? null : inheritedPath,
        categoryInferred: Boolean(inheritedPath) && !inheritedSupplement,
        inheritedParentActive: inheritedAsSubheading && !inheritedSupplement,
        inheritedSectionPending: Boolean(inheritedEvent) && !inheritedAsSubheading && !inheritedSupplement,
        supplementSection: inheritedSupplement ? recordSupplementSection(inheritedPath[0], currentPageNumber) : null,
        lastItem: null,
        lastItemBaselineIndex: -1,
        pendingSupplement: false,
      }
      const addItem = (category, item) => {
        category.items.push(item)
        // An item added through an inherited section (or an inferred
        // sub-heading) makes the whole category a review target, even when the
        // category was first created by a confidently headed sibling column.
        if (state.categoryInferred) category.uncertain = true
        if (state.inheritedSectionPending) {
          layout.inheritedSectionColumns += 1
          state.inheritedSectionPending = false
        }
      }
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
          const plainSupplement = sectionNames ? null : plainSupplementHeading(baselineItems)
          if (sectionNames || plainSection || plainSupplement) {
            // On a single combined row only the first marker is used, exactly
            // as before. When a real column split exists, each column keeps its
            // own active section.
            const headingText = joinText(baselineItems.map((it) => it.str))
            const carriesServiceTime = /\d{1,2}:\d{2}/.test(headingText)
            // Review 6252891629 P1: an explicit supplement heading applies to
            // the whole section in this column, not only to the heading row.
            // Every row below it is a modifier relation the product cannot
            // store, so none may become an ordinary dish with a main price.
            const markerSupplement = Boolean(
              sectionNames &&
                sectionNames.length > 0 &&
                sectionNames.every((name) => isSupplementHeadingText(name, { explicitMarker: true })),
            )
            const supplementHeading = markerSupplement ? sectionNames[0] : plainSupplement
            if (supplementHeading) {
              state.supplementSection = recordSupplementSection(supplementHeading, currentPageNumber)
              state.menuName = null
              state.categoryPath = null
              state.categoryInferred = false
              state.inheritedParentActive = false
              state.inheritedSectionPending = false
              state.lastItem = null
              state.pendingSupplement = false
              continue
            }
            // Any other demonstrable section heading closes an active
            // supplement section; content below it is ordinary menu content
            // again.
            state.supplementSection = null
            if (sectionNames) {
              if (state.inheritedParentActive && state.categoryPath && state.categoryPath.length > 0) {
                // A brand/section marker that opens this column directly under
                // the parent section heading is a subcategory of it, not a new
                // top-level section. Nested and reviewable, never silently
                // flattened into the parent name.
                state.categoryPath = [...state.categoryPath, sectionNames[0]]
                state.categoryInferred = true
                state.inheritedParentActive = false
                state.inheritedSectionPending = false
                layout.inheritedSubheadingColumns += 1
              } else {
                // An explicit // marker is its own top-level section.
                state.menuName = sectionNames[0]
                state.categoryPath = [sectionNames[0]]
                state.categoryInferred = false
              }
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
            state.inheritedParentActive = false
            state.lastItem = null
            state.pendingSupplement = false
            continue
          }

          const lineText = joinText(baselineItems.map((it) => it.str))
          if (lineText.length === 0 || isPdfChrome(baselineItems)) continue

          // Inside an explicit supplement section every content line is a
          // modifier relation, never an ordinary dish. Count it with bounded
          // provenance (heading + page, never the item name/amount) so review
          // sees an explicit product gap instead of a plausible main price.
          if (state.supplementSection) {
            layout.supplementLines += 1
            state.supplementSection.lines += 1
            if (Number.isInteger(currentPageNumber)) state.supplementSection.pages.add(currentPageNumber)
            state.lastItem = null
            state.pendingSupplement = false
            continue
          }

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
          // A supplement/extra ("+ Bresaola", "+ Gebakken krieltjes 5",
          // "Botersla ... + Bresaola 15") is a relation the current product
          // concept cannot store. Emitting it as an ordinary dish would
          // disguise a modifier as a main item, so it is skipped and counted.
          // This must run before name-continuation handling: the leading "+"
          // is a supplement marker, not a wrapped-name connector.
          const hasSupplementMarker = words.some(
            (word) => word.text === '+' || (word.text.startsWith('+') && word.text.length > 1 && !isPriceToken(word.text.slice(1))),
          )
          if (hasSupplementMarker) {
            layout.supplementLines += 1
            continue
          }
          // A portion label on its own ("8st.", "6 st.", "2 personen") is a
          // relation the product cannot store yet. It is counted, never attached
          // as a description or appended to the dish name.
          const visibleItems = baselineItems.filter((it) => it && typeof it.str === 'string' && it.str.trim().length > 0)
          const portionOnly =
            visibleItems.length > 0 && visibleItems.every((it) => isStandalonePortionToken(it.str))
          if (portionOnly) {
            layout.portionLines += 1
            if (state.lastItem) state.lastItemBaselineIndex = baselineIndex
            continue
          }
          // A wrapped name is extended only on explicit source evidence (see
          // nameContinuationEvidence). A same-X line directly below a priced item
          // that has no such evidence stays a description; it is never promoted
          // to a section heading.
          const lineHasPrice = words.some((word) => isPriceToken(word.text))
          // An amount printed a hair ABOVE its own name (a separate ABV row can
          // push pdfjs's amount baseline above the name: the real
          // "Desperados" row is 1.9 units above its name). This must run before
          // name-continuation handling: the line is a new item, not the tail of
          // the previous one. Only an unconsumed, price-only baseline
          // immediately above and within 3 units is used.
          const previousBaseline = (baselines[baselineIndex - 1] || []).filter((item) => !consumedItems.has(item))
          if (!lineHasPrice && previousBaseline.length > 0 && looksLikePairableItemName(words, lineText)) {
            const previousPrices = priceOnlyBaseline(previousBaseline)
            const previousY = Math.max(...previousBaseline.map((it) => (typeof it.y === 'number' ? it.y : 0)))
            const currentY = Math.max(...baselineItems.map((it) => (typeof it.y === 'number' ? it.y : 0)))
            const distance = previousY - currentY
            if (previousPrices && distance > 0 && distance <= 3) {
              const category = categoryFor(state.categoryPath || [], state.categoryInferred)
              const priceVariants = previousPrices.prices.length > 1
                ? previousPrices.prices.map((price) => ({ label: null, price }))
                : null
              const item = {
                name: lineText,
                desc: null,
                price: priceVariants ? null : previousPrices.prices[0],
                priceStatus: priceVariants ? 'multiple_undecomposed' : 'known',
                ...(priceVariants ? { priceVariants, priceText: previousPrices.text } : {}),
                startX: Math.min(...baselineItems.map((it) => it.x)),
                evidenceText: `${lineText} ${previousPrices.text}`,
              }
              addItem(category, item)
              state.lastItem = item
              state.lastItemBaselineIndex = baselineIndex
              for (const priceItem of previousBaseline) {
                const priceItemText = priceItem.str.trim()
                if (isPriceToken(priceItemText) || isPriceVariantSeparator(priceItemText)) consumedItems.add(priceItem)
              }
              // The baseline was counted as unlinked when it was read; it is
              // linked now, so the honest counter must not keep it.
              layout.unlinkedPriceLines = Math.max(0, layout.unlinkedPriceLines - 1)
              continue
            }
          }
          if (!lineHasPrice && state.lastItem && !state.lastItem.desc) {
            const nameParts = visibleItems.filter((it) => !isStandalonePortionToken(it.str))
            const continuationText = joinText(nameParts.map((it) => it.str))
            const leftmostX = visibleItems.length > 0 ? Math.min(...visibleItems.map((it) => it.x)) : null
            const aligned = leftmostX !== null && Math.abs(leftmostX - state.lastItem.startX) <= DESCRIPTION_X_ALIGNMENT_TOLERANCE
            const closeEnough = state.lastItemBaselineIndex >= 0 && baselineIndex - state.lastItemBaselineIndex <= 2
            const nextLineText = joinText((baselines[baselineIndex + 2] || []).map((it) => it.str))
            const hasStandalonePortion = visibleItems.some((it) => isStandalonePortionToken(it.str))
            const evidence =
              aligned && closeEnough && continuationText.length > 0
                ? nameContinuationEvidence(state.lastItem.name, continuationText, nextBaseline, nextLineText, hasStandalonePortion)
                : null
            const joined = evidence ? joinText([state.lastItem.name, continuationText]) : ''
            if (evidence && joined.length <= 120) {
              state.lastItem.name = joined
              state.lastItem.evidenceText = `${state.lastItem.evidenceText}\n${continuationText}`
              if (leftmostX !== null) state.lastItem.startX = Math.min(state.lastItem.startX, leftmostX)
              if (hasStandalonePortion) layout.portionLines += 1
              state.lastItemBaselineIndex = baselineIndex
              layout.nameContinuationLines += 1
              continue
            }
          }
          // Name-internal numbers are name evidence whether pdfjs glued them
          // into the name's own item or split them into a separate numeric
          // item: the whole local line/column (name run, unit, trailing amount
          // position) decides, never a bare numeric block.
          // (review 6249303096 P1, review 6249657793 P1)
          const numericEvidence = classifyNumericEvidence(words)
          // A price is credible when its own PDF text item consists solely of
          // prices/separators ("4.50"), when it is part of an explicit variant
          // sequence ("6.5 / 25.0"), or when pdfjs merged a trailing price into
          // a name-bearing item ("Fictief Broodje 3.00") and no separately
          // positioned price run sits to its right. A price-shaped number that
          // classifyNumericEvidence placed inside the name is never a price.
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
          const isPriceWord = (word, index) =>
            isPriceToken(word.text) &&
            !numericEvidence.nameEmbedded.has(index) &&
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
          // A decimal number between the name and the trailing amount can be
          // either name text or a second glass/bottle amount; the line itself
          // does not prove which. Report it and claim no price at all: a
          // guessed known amount or an invented name is never acceptable.
          if (numericEvidence.ambiguous.size > 0) {
            layout.ambiguousPriceLines += 1
            state.lastItem = null
            continue
          }
          const pricePositions = words.map((word, index) => (isPriceWord(word, index) ? index : -1)).filter((index) => index >= 0)
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
          // invents an item and drops the real description. A row that pdfjs
          // merged into ONE string can hold two side-by-side (name, price)
          // pairs ("Koffie 3.5 Broodje 4.5"); only the trailing amount is
          // proven, so the interior number stays in the name rather than being
          // split at an unproven boundary. A real two-column row is separated
          // by the page column anchors before this point.
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
          for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
            const word = words[wordIndex]
            if (isPriceWord(word, wordIndex)) {
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
              addItem(category, item)
              state.lastItem = item
              state.lastItemBaselineIndex = baselineIndex
            }
            continue
          }

          // Name and price on two consecutive baselines in this column.
          // De Botanist prints many items this way ("Cappuccino" then
          // "3.8"); the price is not a description and the name is not a
          // section heading. A name may be longer than two words when the
          // price baseline is demonstrably local (MAX_NAME_PRICE_BASELINE_
          // DISTANCE) and holds nothing but prices/separators; that is the
          // real "Blue Velvet Gnocchi" / "The Crunchy Caprese" layout.
          const nextPrices = baselinesAreVerticallyAdjacent(baselineItems, nextBaseline)
            ? priceOnlyBaseline(nextBaseline)
            : null
          if (nextPrices && looksLikePairableItemName(words, lineText)) {
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
            addItem(category, item)
            state.lastItem = item
            state.lastItemBaselineIndex = baselineIndex
            for (const priceItem of nextBaseline) {
              const priceItemText = priceItem.str.trim()
              if (isPriceToken(priceItemText) || isPriceVariantSeparator(priceItemText)) consumedItems.add(priceItem)
            }
            continue
          }

          // A single Title Case word directly below an item, aligned with
          // that item's name, is a flavour/variant continuation ("Red Bull
          // Red Edition" -> "Watermelon", "Texels Skuumkoppe" ->
          // "Dunkelweizen"), not a new section. A short Title-Case line that
          // directly follows the name is likewise a description/tasting note
          // ("England IPA", "Hibiscus Soda"), never a guessed sub-heading.
          // A plural ("Broodjes", "Oesters") is treated as a category.
          const singleFlavourWord = /^\p{Lu}[\p{Ll}'-]+$/u.test(lineText) && !/s$/i.test(lineText)
          const shortDescription =
            looksLikeShortItemContinuation(lineText) &&
            state.lastItemBaselineIndex >= 0 &&
            baselineIndex - state.lastItemBaselineIndex === 1
          if (state.lastItem && (singleFlavourWord || shortDescription)) {
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

  // Bounded provenance, deterministic order: a review can see WHICH explicit
  // supplement section and pages were deliberately not stored as dishes.
  layout.supplementSections = [...supplementSectionProvenance.values()]
    .map((entry) => ({
      heading: entry.heading,
      pages: [...entry.pages].sort((a, b) => a - b),
      lines: entry.lines,
    }))
    .sort((a, b) => (a.pages[0] || 0) - (b.pages[0] || 0) || a.heading.localeCompare(b.heading))

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
  classifyNumericEvidence,
  splitLineIntoColumns,
  splitColumnByBaseline,
  pageColumnAnchors,
  splitLineIntoPageColumns,
  duplicateLayoutLayer,
  pureSectionMarkerNames,
  compactPdfLayoutText,
  structurePdfLinesIntoMenu,
}
