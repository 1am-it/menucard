// BE-22 — a small, strict, deterministic HTML menu structure adapter, first
// built for the offline benchmark (`html_structure`). Reads an
// already-available HTML string only: no fetch, no browser, no provider, no
// AI, no OCR, no network import of any kind.
//
// BE-25 fase 2 promoted it to product code: the live analysis
// (src/lib/restaurantSourceAnalysis.js) runs it on a menu page that the
// bounded same-host discovery already found, when that page carries no
// JSON-LD menu. ops/benchmark/htmlMenuStructure.js re-exports this module.
//
// What it recognizes — only narrow, explainable local structures where a
// name and a price sit in the SAME element:
//   - `list_item`     an `li` / `role="listitem"`
//   - `table_row`     a `tr` with `td` cells (one cell is the price)
//   - `definition`    a `dt` with its following `dd`
//   - `repeated_card` two or more sibling elements with the same tag and the
//                     same item-like class (menu-item, dish, gerecht, …)
//   - `line_break_list` (BE-25) a `p`/`div` whose lines are separated by
//                     `br`, two or more lines each ending in its own inline
//                     price element (`strong`/`b`/`span`/`em`) that holds
//                     nothing but a price; the dish name is the text before
//                     it on the same line. Only here a one-decimal notation
//                     ("14.5") counts as a price, because the element holds
//                     the price alone.
//   - `formatted_block` a `p`/`div` (split at `br`) holding repeated dish
//                     blocks: a bold title anchor (`strong`/`b`) at the
//                     start of a line, an optional description on the same
//                     and/or following lines, and exactly one price at the
//                     very end of the block as plain text. Only under a menu
//                     heading and only when the container (or its run of
//                     sibling containers) holds at least two priced blocks;
//                     only there a bare whole number ("25") counts as the end
//                     price. Several prices, a price that is not at the end,
//                     a price range, a supplement line, a service unit, a
//                     time or a date make the block a rejected line.
// Sections come from semantic headings (`h1`–`h6`, `role="heading"`) and from
// the label of a list item that contains a nested list; the full heading path
// is kept (nesting is never flattened away). A description is only taken from
// inside the same item element. Allergen/diet/icon markers are excluded from
// names and counted, never interpreted.
//
// What it refuses (fail closed, with a reason — see menuExtractionContract.js
// REJECTION_REASONS): lines under an opening-hours, contact, reservation,
// review, arrangement, voucher, admission, parking or cloakroom heading;
// clock times (ranges, and single times in clear time context such as
// "vanaf 12.00" or "21.30 uur"); dates in clear date/event context; service
// units (per person, per table, arrangements, packages, courses — a small
// local list, see SERVICE_UNIT_PATTERN); modifiers ("+ extra …"); a price
// without a name; a name without a price (recorded only in a section that also
// has priced items, so navigation links never become noise); and an element
// holding several independent name/price pairs — in one list item, definition,
// table row (two name runs and two price runs) or card (two name or two price
// elements, or a price outside its price element) — never merged, never read
// as its first pair. Volumes and weights ("0,75 l", "33cl", "250 g", a
// sub-euro "0,75 L") before the first price are never prices; a size letter
// or unit-like token after a price is kept as a price (fail closed). Prices in running text
// (paragraphs, prose) never count — only the structures above. Fewer than
// MIN_ITEMS counted items → `unparsed`.
//
// Bounded in input AND in work: at most MAX_HTML_LENGTH characters,
// MAX_NODES nodes and MAX_PARSE_DEPTH open elements; the tokenizer is a
// single forward pass (unclosed `script`/`style`/comment blocks are consumed
// once, never re-scanned; closing tags never search the open-element stack
// for a tag that is not open); and every unit of work — tokens, forward
// scans, stack steps, tree visits, text inspected — is charged to a
// deterministic budget of
// MAX_WORK units. Exceeding any bound returns `unparsed`, never a partial menu.
//
// Never emits `confidence` or `reviewReady`, and nothing it returns creates a
// concept, proposal, review or publication.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const {
  MENU_EXTRACTION_CONTRACT_VERSION,
  MAX_REJECTED,
  MAX_SECTIONS,
  MAX_ITEMS,
  MAX_TEXT,
  emptyCost,
} = require('./menuExtractionContract')

const MIN_ITEMS = 3
const MAX_HTML_LENGTH = 2 * 1024 * 1024
const MAX_NODES = 50000
const MAX_DEPTH = 200 // structure walk depth
const MAX_PARSE_DEPTH = 1000 // open elements while tokenizing
const MAX_WORK = 3000000 // deterministic work units per extraction
const MAX_ITEM_TEXT = 600 // longer text in one item element is never a single dish
const MAX_ATTRIBUTE_TEXT = 2048
const IMPLICIT_CLOSE_SCAN_LIMIT = 64
const SCAN_CHARS = 64 // characters of forward scanning per work unit
const MAX_REJECTED_TEXT = 120

// ─── A deterministic work budget ───────────────────────────────────────────

class WorkLimitExceeded extends Error {}

function createBudget(limit = MAX_WORK) {
  return {
    used: 0,
    limit,
    spend(units = 1) {
      this.used += units
      if (this.used > this.limit) throw new WorkLimitExceeded('work limit exceeded')
    },
  }
}

// ─── A bounded, single-pass, tolerant HTML tree builder (no dependency) ───

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
/** Elements whose content is never menu text; consumed up to their closing
 * tag (or to the end of the input when unclosed) in ONE forward search. */
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'head'])
const BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'dl', 'table', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'td', 'th', 'dt', 'dd', 'br'])

// The HTML 4 named character references (case-sensitive: "&Eacute;" is É,
// "&eacute;" is é): the Latin-1 block U+00A0–U+00FF in code-point order,
// plus the markup and typographic ones menus use (quotes, dashes, …).
const LATIN1_ENTITY_NAMES = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot ' +
  'cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml ' +
  'Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ' +
  'ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ')
const NAMED_ENTITIES = Object.assign(
  Object.create(null),
  Object.fromEntries(LATIN1_ENTITY_NAMES.map((name, i) => [name, String.fromCodePoint(0xa0 + i)])),
  {
    nbsp: ' ', // kept as a plain space, as before: menu text never needs a hard space
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜',
    ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
    dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›',
    euro: '€', trade: '™', minus: '−', frasl: '⁄', deg: '°', half: '½',
  }
)
// The markup entities are also accepted in upper case ("&AMP;"), as browsers do.
const CASE_INSENSITIVE_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot'])

/**
 * Decodes HTML character references in text that was ALREADY separated from
 * markup (one text node or attribute value) — the one decoding step for menu
 * text, applied exactly once: "&amp;lsquo;" becomes the literal "&lsquo;",
 * never "‘". Unknown names, a bare "&" and invalid code points stay as they
 * are. Shared with the JSON-LD menu path (menuJsonLdExtraction.js).
 */
function decodeEntities(text) {
  return String(text).replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,15});/g, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      const valid = Number.isFinite(n) && n > 0 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff)
      return valid ? String.fromCodePoint(n) : whole
    }
    const named = NAMED_ENTITIES[code] !== undefined ? NAMED_ENTITIES[code] : CASE_INSENSITIVE_ENTITIES.has(code.toLowerCase()) ? NAMED_ENTITIES[code.toLowerCase()] : undefined
    return named === undefined ? whole : named
  })
}

/** Unterminated quotes consume to the end of the (capped) attribute text in
 * one pass instead of failing and re-scanning. */
function parseAttributes(raw) {
  const attrs = {}
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s"'=<>`]+)))?/g
  const text = raw.length > MAX_ATTRIBUTE_TEXT ? raw.slice(0, MAX_ATTRIBUTE_TEXT) : raw
  let match
  while ((match = re.exec(text))) {
    const name = match[1].toLowerCase()
    attrs[name] = decodeEntities(match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : '')
  }
  return attrs
}

const IMPLICIT_CLOSE = {
  li: [new Set(['li']), new Set(['ul', 'ol'])],
  dt: [new Set(['dt', 'dd']), new Set(['dl'])],
  dd: [new Set(['dt', 'dd']), new Set(['dl'])],
  tr: [new Set(['tr']), new Set(['table', 'tbody', 'thead', 'tfoot'])],
  td: [new Set(['td', 'th']), new Set(['tr', 'table'])],
  th: [new Set(['td', 'th']), new Set(['tr', 'table'])],
}

const TAG_NAME = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/y
const closingTagPatterns = new Map()
function closingTagPattern(tag) {
  if (!closingTagPatterns.has(tag)) closingTagPatterns.set(tag, new RegExp(`</${tag}\\s*>`, 'gi'))
  return closingTagPatterns.get(tag)
}

function newElement(tag, attrs) {
  return { tag, attrs, children: [], parent: null, index: 0, sameTagIndex: 1, tagCounts: Object.create(null) }
}

/**
 * Builds a tree from `html` in one forward pass. Returns
 * `{ root, nodeCount, truncated, truncatedReason }`; `truncated` is true when
 * MAX_NODES or MAX_PARSE_DEPTH was reached (the caller fails closed). Throws
 * WorkLimitExceeded when the budget runs out (the caller fails closed).
 *
 * Linear by construction: every search moves forward and never revisits
 * consumed input (the next `<`/`>` positions are memoized and only
 * recomputed once passed); a closing tag for an element that is not open is
 * ignored in O(1) via per-tag open counts; popping is amortized (each element
 * is pushed once); implicit closing inspects at most IMPLICIT_CLOSE_SCAN_LIMIT
 * stack levels.
 */
function parseHtml(html, budget = createBudget()) {
  const source = String(html)
  const n = source.length
  const root = newElement('#root', {})
  const stack = [root]
  const openCounts = Object.create(null)
  let nodeCount = 0
  let pos = 0
  let nextLt = -2
  let nextGt = -2
  // Forward scans are charged too (one unit per SCAN_CHARS characters), so
  // ANY re-scanning regression exhausts the budget instead of hanging.
  const chargeScan = (from, found) => budget.spend(1 + Math.floor(((found === -1 ? n : found) - from) / SCAN_CHARS))
  const ltFrom = (p) => {
    if (nextLt !== -1 && nextLt < p) {
      nextLt = source.indexOf('<', p)
      chargeScan(p, nextLt)
    }
    return nextLt
  }
  const gtFrom = (p) => {
    if (nextGt !== -1 && nextGt < p) {
      nextGt = source.indexOf('>', p)
      chargeScan(p, nextGt)
    }
    return nextGt
  }
  const done = (truncatedReason) => ({ root, nodeCount, truncated: Boolean(truncatedReason), truncatedReason: truncatedReason || null })

  function append(node) {
    const parent = stack[stack.length - 1]
    node.parent = parent
    node.index = parent.children.length
    parent.children.push(node)
    if (node.tag !== '#text') {
      parent.tagCounts[node.tag] = (parent.tagCounts[node.tag] || 0) + 1
      node.sameTagIndex = parent.tagCounts[node.tag]
    }
    nodeCount += 1
    budget.spend(1)
  }
  function addText(raw) {
    budget.spend(Math.ceil(raw.length / 64))
    if (!raw.trim()) return
    append({ tag: '#text', text: decodeEntities(raw), parent: null, index: 0 })
  }
  function pop() {
    const node = stack.pop()
    openCounts[node.tag] -= 1
    budget.spend(1)
  }

  while (pos < n) {
    if (nodeCount >= MAX_NODES) return done('too_many_nodes')
    budget.spend(1)
    const lt = ltFrom(pos)
    if (lt === -1) {
      addText(source.slice(pos))
      break
    }
    if (lt > pos) {
      addText(source.slice(pos, lt))
      pos = lt
      continue
    }
    if (source.startsWith('<!--', pos)) {
      const end = source.indexOf('-->', pos + 4)
      chargeScan(pos, end)
      pos = end === -1 ? n : end + 3
      continue
    }
    const next = source[pos + 1]
    if (next === '!' || next === '?') {
      const gt = gtFrom(pos)
      pos = gt === -1 ? n : gt + 1
      continue
    }
    TAG_NAME.lastIndex = pos
    const m = TAG_NAME.exec(source)
    if (!m) {
      addText('<')
      pos += 1
      continue
    }
    const nameEnd = pos + m[0].length
    const gt = gtFrom(nameEnd)
    const lt2 = ltFrom(nameEnd)
    if (gt === -1 || (lt2 !== -1 && lt2 < gt)) {
      // Never closed before the next `<`: the `<` is plain text.
      addText('<')
      pos += 1
      continue
    }
    const raw = source.slice(nameEnd, gt)
    pos = gt + 1
    const tag = m[2].toLowerCase()

    if (m[1] === '/') {
      if (!openCounts[tag]) continue // not open anywhere: ignored in O(1)
      while (stack.length > 1 && stack[stack.length - 1].tag !== tag) pop()
      if (stack.length > 1) pop()
      continue
    }

    const selfClosing = raw.trimEnd().endsWith('/')
    if (SKIPPED_TAGS.has(tag)) {
      if (!selfClosing) {
        const close = closingTagPattern(tag)
        close.lastIndex = pos
        const found = close.exec(source)
        chargeScan(pos, found ? found.index : -1)
        pos = found ? found.index + found[0].length : n
      }
      continue
    }

    const implicit = IMPLICIT_CLOSE[tag]
    if (implicit && [...implicit[0]].some((t) => openCounts[t] > 0)) {
      for (let i = stack.length - 1, steps = 0; i > 0 && steps < IMPLICIT_CLOSE_SCAN_LIMIT; i -= 1, steps += 1) {
        budget.spend(1)
        const open = stack[i]
        if (implicit[1].has(open.tag)) break
        if (implicit[0].has(open.tag)) {
          while (stack.length > i) pop()
          break
        }
      }
    } else if (BLOCK_TAGS.has(tag) && tag !== 'br' && stack[stack.length - 1].tag === 'p') {
      // `br` is in BLOCK_TAGS only so text gets a space at a line break; in
      // HTML a `br` never closes an open paragraph (BE-25).
      pop()
    }

    const node = newElement(tag, parseAttributes(raw))
    append(node)
    if (!VOID_TAGS.has(tag) && !selfClosing) {
      if (stack.length > MAX_PARSE_DEPTH) return done('too_deep')
      stack.push(node)
      openCounts[tag] = (openCounts[tag] || 0) + 1
    }
  }
  return done(null)
}

// ─── Text helpers ──────────────────────────────────────────────────────────

const MARKER_PATTERN = /(allergen|allergie|diet|dieet|vegan|vegetar|gluten|lactose|noten|nuts|icon|badge|spicy|pittig)/i

/** Allergen/diet/icon markers: excluded from item text, counted. */
function isMarker(node) {
  if (node.tag === 'img' || node.tag === 'i') return true
  const a = node.attrs || {}
  if (a['aria-hidden'] === 'true') return true
  return [a.class, a['aria-label'], a.title].some((v) => typeof v === 'string' && MARKER_PATTERN.test(v))
}

/** Text of a subtree, markers excluded, block boundaries as spaces.
 * Iterative — never recurses; every visited node is charged to `budget`.
 * `skip(node)` may exclude a subtree. */
function textOf(start, { skip, markerCounter, budget } = {}) {
  const parts = []
  const stack = [start]
  while (stack.length > 0) {
    const node = stack.pop()
    if (budget) budget.spend(1)
    if (node.tag === '#text') {
      parts.push(node.text)
      continue
    }
    if (node !== start && isMarker(node)) {
      if (markerCounter) markerCounter.count += 1
      continue
    }
    if (node !== start && skip && skip(node)) continue
    if (BLOCK_TAGS.has(node.tag)) parts.push(' ')
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i])
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function clip(text, max = MAX_TEXT) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** O(depth): sibling positions were recorded while parsing. */
function locatorOf(node, budget) {
  const segments = []
  for (let n = node; n && n.tag !== '#root'; n = n.parent) {
    if (budget) budget.spend(1)
    const count = n.parent ? n.parent.tagCounts[n.tag] || 1 : 1
    segments.push(count > 1 ? `${n.tag}[${n.sameTagIndex}]` : n.tag)
  }
  const joined = segments.reverse().join('>')
  return joined.length > MAX_TEXT ? `…${joined.slice(joined.length - (MAX_TEXT - 1))}` : joined
}

const EDGE_PUNCTUATION = new Set([' ', '.', '-', '–', '—', '|', ':', '·', '…', '•', ','])

/** Trims separators from both ends with plain loops (no backtracking regex). */
function cleanName(text) {
  const t = String(text || '').replace(/\s+/g, ' ')
  let start = 0
  let end = t.length
  while (start < end && EDGE_PUNCTUATION.has(t[start])) start += 1
  while (end > start && EDGE_PUNCTUATION.has(t[end - 1])) end -= 1
  return t.slice(start, end)
}

// ─── Prices, quantities, times, dates, units ──────────────────────────────

/** A price token: optional €, 1–3 digits with exactly two decimals or ",-",
 * or "€" with whole euros. Never a bare integer (quantities, grams, people),
 * never a percentage, never a 1-decimal value (alcohol %). */
const PRICE_PATTERN = /(€\s*)?(?<![\d.,])(\d{1,3})(?:[.,](\d{2})|,[-–])(?![\d.,]*\d)(?!\s*%)|€\s*(\d{1,3})(?![\d.,]*\d)(?!\s*%)/g

/** A multi-letter volume or weight unit directly after a number ("33cl",
 * "500 ml", "1 kg", "1,50 liter") — that number is a quantity, any case. */
const MULTI_LETTER_UNIT_AFTER = /^\s?(?:ltr|liter|liters|litre|litres|cl|ml|dl|kg|kilo|gr|gram|grams|mg|oz|lb)(?!\p{L})/iu
/** A single-letter unit ("0,75 l", "250 g"). Lower case is a unit; an
 * upper-case "L"/"G" is also a common SIZE letter ("12,50 L" = large), so it
 * only counts as a unit for a sub-euro quantity such as "0,75 L". */
const SINGLE_LETTER_UNIT_AFTER = /^\s?([lLgG])(?!\p{L})/u

function isQuantityToken(text, end, amountMinorUnits) {
  const after = text.slice(end, end + 10)
  if (MULTI_LETTER_UNIT_AFTER.test(after)) return true
  const single = SINGLE_LETTER_UNIT_AFTER.exec(after)
  if (!single) return false
  return single[1] === 'l' || single[1] === 'g' || amountMinorUnits < 100
}

/**
 * Money tokens in `text`. A number directly followed by a volume/weight unit
 * is a quantity and skipped — but only BEFORE the first money token and only
 * without €: a unit-like token after a price ("9,50 m 12,50 l") is kept as a
 * price, so a second price can never hide as a "volume" and turn an item
 * into one known amount (fail closed: multiple_undecomposed).
 */
function findPrices(text) {
  const prices = []
  for (const m of text.matchAll(PRICE_PATTERN)) {
    const hasEuroSign = m[0].includes('€')
    const euros = m[2] !== undefined ? Number(m[2]) : Number(m[4])
    const cents = m[3] !== undefined ? Number(m[3]) : 0
    const amountMinorUnits = euros * 100 + cents
    if (!hasEuroSign && prices.length === 0 && isQuantityToken(text, m.index + m[0].length, amountMinorUnits)) continue
    prices.push({ raw: m[0].trim(), index: m.index, length: m[0].length, amountMinorUnits, hasEuroSign })
  }
  return prices
}

// Full weekday names anywhere; the short Dutch forms ("ma", "zo", …) only
// directly before a time, a dash or "t/m", since "zo" and "do" are also
// ordinary words in a dish description.
const WEEKDAY_PATTERN = /\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(ma|di|wo|do|vr|za|zo)\b\.?\s*(?:[-–]|t\/m|tot|\d)/i
// Ranges only with clock minutes (00/15/30/45), like BE-20's own PDF
// clock-time rule, so a dual price such as "5.50 - 27.50" is never mistaken
// for opening hours.
const CLOCK = '(?:[01]?\\d|2[0-4])[.:](?:00|15|30|45)'
const TIME_RANGE_PATTERN = new RegExp(`\\b${CLOCK}\\s*(?:-|–|tot|t/m|to|until)\\s*${CLOCK}\\b`, 'i')
// A single clock time is only a time in clear time context: directly after
// a time word ("vanaf 12.00", "om 18.30", "sluit 21.45") or directly before
// "uur"/"u"/"h". Dot or colon notation only — "vanaf 12,50" and
// "vanaf € 12.50" stay prices (Dutch prices use a comma, or show €).
const ANY_CLOCK = '(?:[01]?\\d|2[0-4])[.:][0-5]\\d'
const CLOCK_IN_CONTEXT_PATTERN = new RegExp(
  `\\b(?:vanaf|tot|om|tussen|van|from|until|till|at|aanvang|geopend|open|gesloten|sluit|sluiting)\\s+(?:ca\\.?\\s*)?${ANY_CLOCK}(?![\\d.,]*\\d)` +
    `|(?<![€\\d.,]\\s?)\\b${ANY_CLOCK}\\s*(?:uur|u|h|hrs?|am|pm)(?!\\p{L})`,
  'iu'
)

// A date is only recognized in clear date context: a day with a month name
// ("15 mei", "1 dec."), or a bare day.month ("24.12") in an item that also
// names an event/date word or says "op 24.12". With € it is money.
const MONTH_NAMES = 'januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|january|february|march|june|july|august|october'
const MONTH_ABBREVIATIONS = 'jan|feb|mrt|apr|jun|jul|aug|sep|sept|okt|oct|nov|dec'
const DAY = '(?:[0-2]?\\d|3[01])'
const MONTH_DATE_PATTERN = new RegExp(`\\b${DAY}\\s*(?:${MONTH_NAMES}|${MONTH_ABBREVIATIONS})\\b|\\b(?:${MONTH_NAMES})\\s+${DAY}\\b`, 'i')
const DOT_DATE = `(?<![€\\d.,]\\s?)(?:0?[1-9]|[12]\\d|3[01])\\.(?:0[1-9]|1[0-2])(?![\\d.,]*\\d)`
const DOT_DATE_PATTERN = new RegExp(DOT_DATE)
const ON_DATE_PATTERN = new RegExp(`\\bop\\s+${DOT_DATE}`, 'i')
const EVENT_CONTEXT_PATTERN = /\b(?:datum|date|evenement(?:en)?|events?|concert|optreden|festival|feest|party|markt|workshop|editie)\b/i

function isClockText(text) {
  return WEEKDAY_PATTERN.test(text) || TIME_RANGE_PATTERN.test(text) || CLOCK_IN_CONTEXT_PATTERN.test(text)
}

function isDateText(text) {
  return MONTH_DATE_PATTERN.test(text) || ON_DATE_PATTERN.test(text) || (EVENT_CONTEXT_PATTERN.test(text) && DOT_DATE_PATTERN.test(text))
}

const ON_REQUEST_PATTERN = /\b(op aanvraag|dagprijs|marktprijs|market price|price on request|p\.o\.a\.?)\b/i
const MODIFIER_PATTERN = /^\s*(\+|extra\b|supplement|toevoeging|add\b|met extra\b)/i
const PER_TABLE_PATTERN = /\bper\s+(tafel|table|tafelgroep)\b|\bp\.\s?t\.(?=\s|$)/i

// Service units: an offer or service, never a dish or drink. BE-20's own
// service-unit and plausible-name helpers exist only on the unmerged
// `fix/be20-pdf-menu-recognition` branch, not on `main`; this benchmark
// therefore keeps this small, local list (whole words, Dutch compounds of
// arrangement/pakket) and must be consolidated with BE-20's once that branch
// is merged — never two diverging vocabularies in product code.
const SERVICE_UNIT_PATTERN = /\b(?:\w*arrangement(?:en)?|\w*pakket(?:ten)?|\d+\s*-?\s*gangen(?:menu)?|gangen|gangenmenu|courses|per\s+persoon|per\s+person|pp|zaalhuur|huur|dagdeel|dagdelen|borg|packages?|hire|rental|deposit)\b|\bp\.\s?p\.(?=\s|$|[,;)])/i

function hasServiceUnit(text) {
  return SERVICE_UNIT_PATTERN.test(String(text || ''))
}

/** At least two letters — a lone "-" or price is never a dish name. */
function isPlausibleItemName(name) {
  return typeof name === 'string' && (name.match(/\p{L}/gu) || []).length >= 2
}

// ─── line_break_list (BE-25) ───────────────────────────────────────────────

const LINE_PRICE_TAGS = new Set(['strong', 'b', 'span', 'em'])
// A price element holding a price and nothing else: "14.5", "14,50", "9",
// "€ 12,50", "12,-". Amounts from 0,50 up to 500,00 only.
const PRICE_ONLY_PATTERN = /^(€\s*)?(\d{1,3})(?:[.,](\d{1,2}))?(?:\s*,[-–])?(\s*€)?$/

function parsePriceOnly(text) {
  const match = PRICE_ONLY_PATTERN.exec(String(text || '').trim())
  if (!match) return null
  const euros = Number(match[2])
  const cents = match[3] === undefined ? 0 : Number(match[3].length === 1 ? match[3] + '0' : match[3])
  const amountMinorUnits = euros * 100 + cents
  if (amountMinorUnits < 50 || amountMinorUnits > 50000) return null
  return { amountMinorUnits, hasEuroSign: Boolean(match[1] || match[4]) }
}

/**
 * The lines of a `p`/`div` split at `br`, when at least two lines end in
 * their own price-only inline element; otherwise `null`. A line holding a
 * block element is never a dish line (the structure is not a plain list).
 * Every inspected child is charged to `budget`.
 */
function lineBreakLines(node, budget, markerCounter) {
  if (node.tag !== 'p' && node.tag !== 'div') return null
  const lines = [[]]
  for (const child of node.children) {
    budget.spend(1)
    if (child.tag === 'br') {
      lines.push([])
      continue
    }
    if (child.tag !== '#text' && BLOCK_TAGS.has(child.tag)) return null
    lines[lines.length - 1].push(child)
  }
  const result = []
  for (const parts of lines) {
    const meaningful = parts.filter((c) => (c.tag === '#text' ? c.text.trim() !== '' : !isMarker(c) && textOf(c, { markerCounter, budget }) !== ''))
    if (meaningful.length === 0) continue
    const last = meaningful[meaningful.length - 1]
    const priceText = last.tag !== '#text' && LINE_PRICE_TAGS.has(last.tag) ? textOf(last, { markerCounter, budget }) : ''
    const price = priceText ? parsePriceOnly(priceText) : null
    const nameParts = price ? meaningful.slice(0, -1) : meaningful
    const name = nameParts
      .map((c) => (c.tag === '#text' ? c.text : textOf(c, { markerCounter, budget })))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    result.push({ name, priceText: price ? priceText : '', price })
  }
  return result.filter((l) => l.price).length >= 2 ? result : null
}

// ─── formatted_block ───────────────────────────────────────────────────────

const TITLE_ANCHOR_TAGS = new Set(['strong', 'b'])
// The end price of a formatted block: the last token, preceded by a space or
// the start of the block text. Whole euros are allowed here (structure gives
// the meaning), 0,50 – 500,00 only (parsePriceOnly).
const END_PRICE_PATTERN = /(?:^|\s)((?:€\s*)?\d{1,3}(?:[.,]\d{1,2})?(?:\s*,[-–])?(?:\s*€)?)$/
// A number right before the end price ("25 / 30", "8,50 - 12,50"): a range or
// a second price, never one dish price.
const PRICE_BEFORE_END_PATTERN = /(?:^|\s)(?:€\s*)?\d{1,3}(?:[.,]\d{1,2})?\s*(?:[/|\-–]|of|or|en)?\s*$/i
// Time context right before a bare number ("open tot 22", "vanaf 17"): never a price.
const TIME_WORD_BEFORE_PATTERN = /\b(?:vanaf|tot|om|tussen|van|t\/m|tot en met|uur|open|geopend|gesloten|sluit|aanvang|from|until|at)\s*$/i

/** Text of one inline line part (text node or inline element). */
function partText(part, markerCounter, budget) {
  return part.tag === '#text' ? part.text : textOf(part, { markerCounter, budget })
}

/**
 * The dish blocks of a `p`/`div`: lines split at `br`; a line that starts
 * with a bold title anchor starts a block, the following lines belong to it.
 * `null` when the element holds a block-level child, when text comes before
 * the first title anchor, or when it has no title anchor at all — the shape
 * is then not a dish-block list (fail closed). Results are cached per node.
 */
function formattedBlocks(node, budget, markerCounter) {
  if (node.formattedBlocks !== undefined) return node.formattedBlocks
  node.formattedBlocks = null
  if (node.tag !== 'p' && node.tag !== 'div') return null
  const lines = [[]]
  for (const child of node.children) {
    budget.spend(1)
    if (child.tag === 'br') {
      lines.push([])
      continue
    }
    if (child.tag !== '#text' && BLOCK_TAGS.has(child.tag)) return null
    lines[lines.length - 1].push(child)
  }
  const blocks = []
  let current = null
  for (const parts of lines) {
    const meaningful = parts.filter((c) => (c.tag === '#text' ? c.text.trim() !== '' : !isMarker(c) && textOf(c, { markerCounter, budget }) !== ''))
    if (meaningful.length === 0) continue
    const first = meaningful[0]
    const title = first.tag !== '#text' && TITLE_ANCHOR_TAGS.has(first.tag) ? cleanName(textOf(first, { markerCounter, budget })) : ''
    const isAnchor = title !== '' && isPlausibleItemName(title) && title.length <= 80 && findPrices(title).length === 0 && !END_PRICE_PATTERN.test(title)
    const rest = (isAnchor ? meaningful.slice(1) : meaningful).map((c) => partText(c, markerCounter, budget)).join(' ').replace(/\s+/g, ' ').trim()
    if (isAnchor) {
      current = { title, lines: rest ? [rest] : [] }
      blocks.push(current)
    } else {
      if (!current) return null
      current.lines.push(rest)
    }
  }
  if (blocks.length === 0) return null
  node.formattedBlocks = blocks
  return blocks
}

function blockEndPrice(block, budget) {
  const body = block.lines.join(' ').replace(/\s+/g, ' ').trim()
  budget.spend(1 + Math.ceil(body.length / 16))
  const match = END_PRICE_PATTERN.exec(body)
  const price = match ? parsePriceOnly(match[1]) : null
  return { body, price, priceText: price ? match[1].trim() : '', before: price ? body.slice(0, match.index).trim() : body }
}

/**
 * The blocks of `node` when they form a repeated dish-block structure: at
 * least two blocks with an end price in this element, or — one block per
 * element — in the contiguous run of `p`/`div` dish-block siblings it
 * belongs to (a heading or any other element ends the run). Otherwise null.
 */
function formattedBlockRun(node, budget, markerCounter) {
  const blocks = formattedBlocks(node, budget, markerCounter)
  if (!blocks) return null
  const priced = (list) => list.filter((b) => blockEndPrice(b, budget).price).length
  if (priced(blocks) >= 2) return blocks
  const parent = node.parent
  if (!parent) return null
  // Only the CONTIGUOUS run of dish-block siblings around this element: a
  // heading, any other element or text between them ends the run, so blocks
  // under a next heading (or elsewhere on the page) never count.
  const fits = (sibling) => (sibling.tag === 'p' || sibling.tag === 'div') && !isHeading(sibling) && formattedBlocks(sibling, budget, markerCounter) !== null
  const siblings = parent.children
  let start = node.index
  while (start > 0 && (budget.spend(1), fits(siblings[start - 1]))) start -= 1
  if (!parent.formattedRunPriced) parent.formattedRunPriced = new Map()
  if (!parent.formattedRunPriced.has(start)) {
    let total = 0
    for (let i = start; i < siblings.length && (budget.spend(1), fits(siblings[i])); i += 1) total += priced(formattedBlocks(siblings[i], budget, markerCounter))
    parent.formattedRunPriced.set(start, total)
  }
  return parent.formattedRunPriced.get(start) >= 2 ? blocks : null
}

/** Unit labels that belong to one of several prices ("glas 5,50 / fles
 * 27,50", "klein 3,50 groot 4,50"); only matched on a short name tail. */
const DUAL_PRICE_UNIT_SUFFIX = /[\s\-–—|:,/]{0,8}(?:per\s+)?(?:glas|fles|karaf|carafe|bottle|glass|klein|groot|small|large|half|heel)\s*$/i
const PRICE_VARIANT_WORDS = /(?:per\s+)?\b(?:glas|fles|karaf|carafe|bottle|glass|klein|middel|groot|small|medium|large|half|heel|of|or|en|and)\b/gi

/** True when the text between two prices names something of its own
 * ("Fictieve soep 6,50 Fictieve salade 7,50") — two items, never merged. */
function hasNameBetweenPrices(priceText, prices) {
  for (let i = 1; i < prices.length; i += 1) {
    const between = priceText.slice(prices[i - 1].index + prices[i - 1].length, prices[i].index).replace(PRICE_VARIANT_WORDS, ' ')
    if ((between.match(/\p{L}/gu) || []).length >= 3) return true
  }
  return false
}

/** A trailing alcohol percentage ("Fictief bier 5,0%", "… 8,5% vol") is
 * removed from the displayed name only; never anything mid-name, never 100%. */
const TRAILING_ALCOHOL_PERCENT = /\s*[(\-–]?\s*(?<![\d.,])\d{1,2}(?:[.,]\d{1,2})?\s*%\s*(?:vol\.?|abv|alc\.?)?\s*\)?$/i

function displayName(name) {
  const tail = name.length > 32 ? name.slice(-32) : name
  const stripped = tail.replace(TRAILING_ALCOHOL_PERCENT, '')
  const result = cleanName(name.slice(0, name.length - tail.length) + stripped)
  return isPlausibleItemName(result) ? result : name
}

/** Headings whose content is never a menu: opening hours, contact,
 * reservations, reviews, arrangements/venue, and — narrow, explicit labels
 * only — vouchers, tickets, admission, parking and cloakroom. Matched as
 * whole words. This is not semantic recognition: an UNLABELLED list of such
 * prices is not caught (see README). */
const NON_MENU_HEADING_PATTERN = /\b(openingstijden|openingsuren|opening hours|contact|reserveren|reservering(en)?|reservations?|booking|reviews?|recensies?|beoordelingen|testimonials?|ervaringen|arrangement(en)?|vergader\w*|zaalhuur|zaalverhuur|verhuur|route|bereikbaarheid|adres|nieuwsbrief|vacatures?|cadeaubon(nen)?|cadeaukaart(en)?|gift ?cards?|vouchers?|tickets?|entree|entreeprijzen|toegang(sprijzen)?|parkeren|parkeertarieven|parking|garderobe|webshop|merchandise)\b/i

// ─── Structure detection ───────────────────────────────────────────────────

const CARD_CLASS_PATTERN = /(menu[-_ ]?item|menu[-_ ]?card|dish|gerecht|product|item|card)/i
// A layout container (accordion panel, column, section) is never one dish,
// even when its class also looks card-like ("menucard__column").
const CONTAINER_CLASS_PATTERN = /(?:^|[-_ ]+)(columns?|panel|section|group|grid|list|wrapper|inner)(?:$|[-_ ]+)/i
const NAME_CLASS_PATTERN = /(name|naam|title|titel)/i
const PRICE_CLASS_PATTERN = /(price|prijs)/i
const DESC_CLASS_PATTERN = /(desc|omschrijving|beschrijving|ingredi|info|text)/i

function isHeading(node) {
  return /^h[1-6]$/.test(node.tag) || (node.attrs && node.attrs.role === 'heading')
}

/**
 * A structural panel toggle is a menu-variant label, not decoration: a real
 * clickable header that declares both an expanded state and the panel it
 * controls (aria-controls, or a selector in data-target) only counts when
 * that panel element actually exists inside the same block. This keeps a
 * cookie/banner button from ever becoming a menu heading.
 */
function panelTargetId(attrs) {
  const raw = (attrs && (attrs['aria-controls'] || attrs['data-target'])) || '';
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const quoted = raw.match(/['"]([^'"]+)['"]/);
  if (quoted) return quoted[1].trim();
  const idSelector = raw.match(/#([A-Za-z0-9_-]+)/);
  if (idSelector) return idSelector[1];
  return /^[A-Za-z0-9_-]+$/.test(raw.trim()) ? raw.trim() : null;
}

const PANEL_LABEL_EXCLUDE = /\b(cookies?|accepteer|accepteren|accept|instellingen|settings|zoeken|zoek|search|login|inloggen|bestellen|bestel|order|reserveren|reserveer|reserve|sluiten|sluit|close|openen|open|menu|navigatie|navigation|filter|filters)\b/i

function panelHasMenuContent(panel, budget) {
  return Boolean(
    findDescendant(panel, (n) => isHeading(n), budget) ||
      findDescendant(panel, (n) => isList(n) && n.children.filter((c) => isListItem(c)).length >= 3, budget) ||
      findDescendant(panel, (n) => (n.tag === 'p' || n.tag === 'div') && n.children.some((c) => c.tag === 'br'), budget),
  )
}

function isPanelHeading(node, budget) {
  const attrs = node.attrs || {};
  if (attrs.role !== 'button' && node.tag !== 'button') return false;
  if (typeof attrs['aria-expanded'] !== 'string') return false;
  const label = textOf(node, { budget }).replace(/\s+/g, ' ').trim();
  if (!label || label.length > 80 || label.split(' ').filter(Boolean).length > 6 || /\d/.test(label)) return false;
  if (PANEL_LABEL_EXCLUDE.test(label)) return false;
  const targetId = panelTargetId(attrs);
  if (!targetId || !node.parent) return false;
  const panel = findDescendant(node.parent, (n) => {
    const a = n.attrs || {};
    return a.id === targetId || a['san-id'] === targetId || a.name === targetId;
  }, budget);
  if (!panel || panel === node) return false;
  return panelHasMenuContent(panel, budget);
}

const MIN_SENTENCE_WORDS = 7

/**
 * A heading that clearly reads as a sentence, not as a section name: at least
 * seven words ending in . ! ? or …, or two sentences. Length alone never
 * counts — a long section name stays a section name. Generic text shape only.
 */
function isProseHeading(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  const words = t.split(' ').filter(Boolean).length
  if (words >= MIN_SENTENCE_WORDS && /[.!?…]$/.test(t)) return true
  return words >= MIN_SENTENCE_WORDS - 1 && /[.!?]\s+\p{Lu}/u.test(t)
}

function headingLevel(node) {
  if (/^h[1-6]$/.test(node.tag)) return Number(node.tag[1])
  const level = Number(node.attrs && node.attrs['aria-level'])
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2
}

function isList(node) {
  return node.tag === 'ul' || node.tag === 'ol' || (node.attrs && node.attrs.role === 'list')
}

function isListItem(node) {
  return node.tag === 'li' || (node.attrs && node.attrs.role === 'listitem')
}

/** Sibling tag+class counts are computed once per parent, not per child. */
function isRepeatedCard(node, budget) {
  const cls = node.attrs && node.attrs.class
  if (!cls || !CARD_CLASS_PATTERN.test(cls) || !node.parent) return false
  const parent = node.parent
  if (!parent.cardKeyCounts) {
    parent.cardKeyCounts = new Map()
    for (const child of parent.children) {
      if (budget) budget.spend(1)
      if (child.tag === '#text' || !child.attrs || typeof child.attrs.class !== 'string') continue
      const key = `${child.tag}\u0000${child.attrs.class}`
      parent.cardKeyCounts.set(key, (parent.cardKeyCounts.get(key) || 0) + 1)
    }
  }
  return (parent.cardKeyCounts.get(`${node.tag}\u0000${cls}`) || 0) >= 2
}

/**
 * A card-like repeated block can itself be a container around a whole menu
 * (an accordion panel with several sub-headings and lists). Counting its
 * nested list items and table rows keeps that block from being read as one
 * giant "dish"; a normal dish card (one name heading) stays an item.
 */
function looksLikeMenuContainer(node, budget) {
  let listItems = 0
  let rows = 0
  const queue = [...node.children]
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]
    if (budget) budget.spend(1)
    if (!current || current.tag === '#text') continue
    if (isListItem(current)) listItems += 1
    if (current.tag === 'tr') rows += 1
    for (const child of current.children) queue.push(child)
  }
  return listItems >= 3 || rows >= 2
}

function findDescendant(node, predicate, budget) {
  if (budget) budget.spend(node.children.length)
  const queue = [...node.children]
  for (let head = 0; head < queue.length; head += 1) {
    const n = queue[head]
    if (budget) budget.spend(1)
    if (n.tag === '#text') continue
    if (predicate(n)) return n
    if (budget) budget.spend(n.children.length)
    for (const child of n.children) queue.push(child)
  }
  return null
}

function classMatches(node, pattern) {
  return Boolean(node.attrs && typeof node.attrs.class === 'string' && pattern.test(node.attrs.class))
}

function letterCount(text) {
  return (text.match(/\p{L}/gu) || []).length
}

/** One table cell: 'price' (only prices, optionally with variant words such
 * as "glas"/"fles"), 'variant' (only variant words), 'name' (a plausible
 * name, no price), 'mixed' (a name AND a price in one cell), or 'other'. */
function classifyCell(cell) {
  if (cell.length === 0 || cell.length > MAX_ITEM_TEXT) return 'other'
  const prices = findPrices(cell)
  let rest = ''
  let from = 0
  for (const p of prices) {
    rest += cell.slice(from, p.index)
    from = p.index + p.length
  }
  rest = (rest + cell.slice(from)).replace(PRICE_VARIANT_WORDS, ' ')
  const restLetters = letterCount(rest)
  if (prices.length > 0) return restLetters < 3 ? 'price' : 'mixed'
  if (restLetters === 0 && letterCount(cell) > 0) return 'variant'
  return isPlausibleItemName(cell) ? 'name' : 'other'
}

/** Several independent name+price groups in one row: at least two runs of
 * name cells AND at least two runs of price cells ("soep | 6,50 | salade |
 * 7,50"). One name with several price cells (glas/fles) is one item. */
function rowHasSeveralNamePricePairs(kinds) {
  let nameRuns = 0
  let priceRuns = 0
  let last = null
  for (const kind of kinds) {
    if (kind === 'name' || kind === 'mixed') {
      if (last !== 'name') nameRuns += 1
      last = 'name'
    }
    if (kind === 'price' || kind === 'mixed') {
      if (last !== 'price' || kind === 'mixed') priceRuns += 1
      last = 'price'
    }
  }
  return nameRuns >= 2 && priceRuns >= 2
}

/** Outermost descendants matching `predicate` (never descending into a match
 * or into a subtree `skip` excludes); stops once `limit` are found. */
function findOutermost(node, predicate, budget, { skip, limit = 2 } = {}) {
  const found = []
  if (budget) budget.spend(node.children.length)
  const queue = [...node.children]
  for (let head = 0; head < queue.length && found.length < limit; head += 1) {
    const n = queue[head]
    if (budget) budget.spend(1)
    if (n.tag === '#text') continue
    if (predicate(n)) {
      found.push(n)
      continue
    }
    if (skip && skip(n)) continue
    if (budget) budget.spend(n.children.length)
    for (const child of n.children) queue.push(child)
  }
  return found
}

const isNameElement = (n) => classMatches(n, NAME_CLASS_PATTERN) || /^h[3-6]$/.test(n.tag) || n.tag === 'strong' || n.tag === 'b' || (n.attrs && n.attrs.itemprop === 'name')
const isPriceElement = (n) => classMatches(n, PRICE_CLASS_PATTERN) || (n.attrs && n.attrs.itemprop === 'price')
const isDescriptionElement = (n) => classMatches(n, DESC_CLASS_PATTERN) || n.tag === 'p' || (n.attrs && n.attrs.itemprop === 'description')

/**
 * The last inline element of an item, when it is a price-only tail such as
 * `<strong>4.5</strong>`. Menus commonly print one decimal ("4.5"), which the
 * generic money scanner deliberately does not accept in prose; a dedicated
 * trailing element is structural evidence, so the strict `parsePriceOnly`
 * (0,50–500,00) applies here instead. This is what keeps a real list item
 * from silently becoming an unpriced line.
 */
function trailingPriceElement(node, budget, markerCounter) {
  const meaningful = node.children.filter((child) => (child.tag === '#text' ? child.text.trim() !== '' : textOf(child, { markerCounter, budget }) !== ''))
  const last = meaningful[meaningful.length - 1]
  if (!last || last.tag === '#text' || !LINE_PRICE_TAGS.has(last.tag)) return null
  const text = textOf(last, { markerCounter, budget }).trim()
  if (!text) return null
  const price = parsePriceOnly(text)
  return price ? { element: last, text, price } : null
}

/** Splits one item element into { name, priceText, description, fullText }.
 * `ambiguous: true` marks an element holding several independent
 * name/price pairs — never read as one item, never partially. */
function readItem(node, pattern, markerCounter, budget) {
  if (pattern === 'table_row') {
    // Linear: each cell is classified once (charged), membership by index.
    const cells = []
    for (const c of node.children) {
      budget.spend(1)
      if (c.tag === 'td' || c.tag === 'th') cells.push(textOf(c, { markerCounter, budget }))
    }
    const kinds = cells.map((cell) => {
      budget.spend(1 + Math.ceil(Math.min(cell.length, MAX_ITEM_TEXT) / 16))
      return classifyCell(cell)
    })
    const fullText = cells.join(' ')
    if (rowHasSeveralNamePricePairs(kinds)) return { name: '', priceText: '', description: '', fullText, ambiguous: true }
    const priceCells = cells.filter((cell, i) => kinds[i] === 'price')
    const other = cells.filter((cell, i) => kinds[i] !== 'price' && kinds[i] !== 'variant' && cell.length > 0)
    return { name: other[0] || '', priceText: priceCells.join(' '), description: other.slice(1).join(' '), fullText }
  }
  if (pattern === 'definition') {
    const name = textOf(node, { markerCounter, budget })
    const dds = []
    const siblings = node.parent.children
    for (let i = node.index + 1; i < siblings.length && siblings[i].tag === 'dd'; i += 1) dds.push(textOf(siblings[i], { markerCounter, budget }))
    const ddText = dds.join(' ')
    return { name, priceText: ddText, description: '', fullText: `${name} ${ddText}`.trim(), nameHasPrice: findPrices(name).length > 0 }
  }
  // Markers are counted once, on the full-text pass only.
  const fullText = textOf(node, { markerCounter, budget })
  // A real price-only tail element is stronger evidence than a prose scan and
  // accepts the common one-decimal format ("4.5"). A second price anywhere
  // before it still makes the element ambiguous.
  if (pattern === 'list_item') {
    const tail = trailingPriceElement(node, budget, markerCounter)
    if (tail) {
      const outside = textOf(node, { skip: (n) => n === tail.element, budget }).trim()
      budget.spend(Math.ceil(outside.length / 16))
      if (findPrices(outside).length > 0) return { name: '', priceText: '', description: '', fullText, ambiguous: true }
      return { name: outside, priceText: tail.text, description: '', fullText, price: tail.price }
    }
  }
  // Name elements inside a description (a <strong> word in a <p>) are not
  // independent names; nested matches count once (outermost only).
  const nameEls = findOutermost(node, isNameElement, budget, { skip: isDescriptionElement })
  const priceEls = findOutermost(node, isPriceElement, budget)
  if (nameEls.length >= 2 || priceEls.length >= 2) return { name: '', priceText: '', description: '', fullText, ambiguous: true }
  const nameEl = nameEls[0] || null
  const priceEl = priceEls[0] || null
  if (nameEl && priceEl) {
    // A price outside the one price element is a second pair: ambiguous.
    const outside = textOf(node, { skip: (n) => n === priceEl, budget })
    budget.spend(Math.ceil(outside.length / 16))
    if (findPrices(outside).length > 0) return { name: '', priceText: '', description: '', fullText, ambiguous: true }
    const descEl = findDescendant(node, (n) => n !== nameEl && n !== priceEl && isDescriptionElement(n), budget)
    const description = descEl ? textOf(descEl, { budget }) : ''
    const priceText = textOf(priceEl, { budget })
    // A dedicated price element (class/itemprop "price"/"prijs") is
    // structural evidence, exactly like the trailing price element of a
    // list item above. Menus commonly print whole euros ("18") or one
    // decimal ("15.5") there, which the generic prose scanner deliberately
    // refuses; the strict price-only rule (0,50–500,00) applies instead.
    const price = parsePriceOnly(priceText)
    return {
      name: textOf(nameEl, { budget }),
      priceText,
      description,
      fullText,
      ...(price ? { price } : {}),
    }
  }
  // No explicit name/price elements: the name is the text before the first
  // price, the description what follows the last one (inside this element).
  budget.spend(Math.ceil(fullText.length / 16))
  const prices = findPrices(fullText)
  if (prices.length === 0) return { name: fullText, priceText: '', description: '', fullText }
  const first = prices[0]
  const last = prices[prices.length - 1]
  return {
    name: fullText.slice(0, first.index),
    priceText: fullText.slice(first.index, last.index + last.length),
    description: fullText.slice(last.index + last.length),
    fullText,
  }
}

// ─── The extraction ────────────────────────────────────────────────────────

function emptyStats() {
  return { candidates: 0, counted: 0, rejected: 0, duplicatesRemoved: 0, ignoredMarkers: 0, depthLimited: false, workUnits: 0 }
}

function unparsed(reason, rejected, stats) {
  return { contractVersion: MENU_EXTRACTION_CONTRACT_VERSION, status: 'unparsed', reason, sections: [], rejected, stats, cost: emptyCost() }
}

/**
 * Extracts a menu structure from one HTML string. Pure and synchronous;
 * returns a result valid under menuExtractionContract.js. `options.maxWork`
 * lowers the work budget (tests only); it can never raise it above MAX_WORK.
 */
function extractHtmlMenuStructure(html, options = {}) {
  const stats = emptyStats()
  if (typeof html !== 'string' || html.length === 0) return unparsed('empty_input', [], stats)
  if (html.length > MAX_HTML_LENGTH) return unparsed('input_too_large', [], stats)
  const limit = Number.isInteger(options.maxWork) && options.maxWork > 0 ? Math.min(options.maxWork, MAX_WORK) : MAX_WORK
  const budget = createBudget(limit)
  try {
    return extractWithinBudget(html, budget, stats)
  } catch (err) {
    if (!(err instanceof WorkLimitExceeded)) throw err
    // Partial progress is reported as-is; no partial menu ever is.
    stats.workUnits = Math.min(budget.used, budget.limit)
    stats.counted = 0
    return unparsed('work_limit_exceeded', [], stats)
  }
}

function extractWithinBudget(html, budget, stats) {
  const { root, truncated, truncatedReason } = parseHtml(html, budget)
  if (truncated) {
    stats.workUnits = budget.used
    return unparsed(truncatedReason, [], stats)
  }

  const markerCounter = { count: 0 }
  const sectionsByKey = new Map() // path key -> { path, items, unpriced: [] }
  const excludedByPath = new Map() // path key -> { path, unpricedLines, reason }
  const rejected = []
  const seen = new Set()

  function noteExcludedContent(path, reason) {
    if (!Array.isArray(path) || path.length === 0) return
    const key = JSON.stringify(path)
    const entry = excludedByPath.get(key) || { path, unpricedLines: 0, reason }
    entry.unpricedLines += 1
    excludedByPath.set(key, entry)
  }

  /** Several alternative end prices on one line ("3 gangen 57 | 4 gangen 66 |
   * 5 gangen 76", "glas 5,50 / fles 27,50") cannot be one dish price. Such a
   * block is reported as excluded content instead of being flattened. */
  function hasAlternativeEndPrices(text) {
    const parts = String(text || '').split(/\s*[|/]\s*/).filter((part) => part.trim().length > 0)
    if (parts.length < 2) return false
    let priced = 0
    for (const part of parts) {
      const match = part.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*$/)
      if (match && parsePriceOnly(match[1])) priced += 1
    }
    return priced >= 2
  }

  function reject(text, reason, node) {
    stats.rejected += 1
    if (rejected.length < MAX_REJECTED) rejected.push({ text: clip(text, MAX_REJECTED_TEXT) || '(leeg)', reason, locator: locatorOf(node, budget) || '(root)' })
  }

  function sectionFor(path) {
    const key = JSON.stringify(path)
    // A sentence kept in the route (not safely nested below a real section
    // heading) is never trusted as structure: the section is uncertain.
    if (!sectionsByKey.has(key)) sectionsByKey.set(key, { path, items: [], unpriced: [], uncertain: path.some(isProseHeading) })
    return sectionsByKey.get(key)
  }

  function handleItem(node, pattern, headingPath) {
    stats.candidates += 1
    const item = readItem(node, pattern, markerCounter, budget)
    const fullText = item.fullText
    if (fullText.length > MAX_ITEM_TEXT) {
      // Far too much text for one dish: never guessed at. Only worth a
      // rejected line when it holds a price at all.
      budget.spend(Math.ceil(fullText.length / 16))
      if (findPrices(fullText).length > 0) reject(fullText, 'ambiguous_structure', node)
      return undefined
    }
    // Every pattern below runs over at most MAX_ITEM_TEXT characters.
    budget.spend(fullText.length + 1)
    const pathText = headingPath.join(' ')
    if (NON_MENU_HEADING_PATTERN.test(pathText)) {
      if (findPrices(fullText).length > 0 || isClockText(fullText)) reject(fullText, 'non_menu_section', node)
      return undefined
    }
    if (isClockText(fullText)) return reject(fullText, 'clock_time', node)
    if (isDateText(fullText)) return reject(fullText, 'date', node)
    if (MODIFIER_PATTERN.test(fullText)) return reject(fullText, 'modifier', node)
    if (hasServiceUnit(fullText) || PER_TABLE_PATTERN.test(fullText)) return reject(fullText, 'service_unit', node)
    // Several independent name/price pairs (table row, card, list item):
    // never one item, never the first pair alone.
    if (item.ambiguous) return reject(fullText, 'ambiguous_structure', node)

    const name = cleanName(item.name)
    const prices = item.price
      ? [{ raw: item.priceText, amountMinorUnits: item.price.amountMinorUnits, hasEuroSign: false }]
      : findPrices(item.priceText)
    const section = sectionFor(headingPath)
    if (prices.length === 0) {
      if (ON_REQUEST_PATTERN.test(fullText) && isPlausibleItemName(name.replace(ON_REQUEST_PATTERN, ''))) {
        return addItem(section, node, pattern, { name: cleanName(name.replace(ON_REQUEST_PATTERN, '')), priceStatus: 'on_request', amountMinorUnits: null, currency: null, description: null })
      }
      if (isPlausibleItemName(name) && name.length <= 80) section.unpriced.push({ text: fullText, node })
      return undefined
    }
    if (!isPlausibleItemName(name) || item.nameHasPrice) return reject(fullText, 'missing_name', node)
    if (prices.length > 1 && hasNameBetweenPrices(item.priceText, prices)) return reject(fullText, 'ambiguous_structure', node)
    const description = cleanName(item.description)
    const descriptionValue = description && findPrices(description).length === 0 && isPlausibleItemName(description) ? clip(description) : null
    if (prices.length > 1) {
      // A dual price ("glas 5,50 / fles 27,50"): the unit label before the
      // first price belongs to that price, not to the dish name.
      const tail = name.length > 48 ? name.slice(-48) : name
      const dualName = cleanName(name.slice(0, name.length - tail.length) + tail.replace(DUAL_PRICE_UNIT_SUFFIX, ''))
      return addItem(section, node, pattern, {
        name: clip(displayName(isPlausibleItemName(dualName) ? dualName : name)),
        priceStatus: 'multiple_undecomposed',
        amountMinorUnits: null,
        currency: null,
        description: descriptionValue,
      })
    }
    const price = prices[0]
    return addItem(section, node, pattern, {
      name: clip(displayName(name)),
      priceStatus: 'known',
      amountMinorUnits: price.amountMinorUnits,
      currency: price.hasEuroSign || /€/.test(item.priceText) ? 'EUR' : null,
      description: descriptionValue,
    })
  }

  // One dish line of a `line_break_list`: the same refusals as handleItem
  // (non-menu sections, clock times, dates, modifiers, service units), the
  // strict price-only element as the price, the text before it as the name.
  function handleLine(line, node, headingPath) {
    stats.candidates += 1
    const fullText = (line.name + ' ' + line.priceText).trim()
    if (fullText.length > MAX_ITEM_TEXT) return undefined
    budget.spend(fullText.length + 1)
    const pathText = headingPath.join(' ')
    if (NON_MENU_HEADING_PATTERN.test(pathText)) {
      if (line.price || isClockText(fullText)) reject(fullText, 'non_menu_section', node)
      return undefined
    }
    if (isClockText(fullText)) return reject(fullText, 'clock_time', node)
    if (isDateText(fullText)) return reject(fullText, 'date', node)
    if (MODIFIER_PATTERN.test(fullText)) return reject(fullText, 'modifier', node)
    if (hasServiceUnit(fullText) || PER_TABLE_PATTERN.test(fullText)) return reject(fullText, 'service_unit', node)
    const name = cleanName(line.name)
    const section = sectionFor(headingPath)
    if (!line.price) {
      if (isPlausibleItemName(name) && name.length <= 80) section.unpriced.push({ text: fullText, node })
      return undefined
    }
    // A name that itself holds a price is two items run together: never read.
    if (!isPlausibleItemName(name) || findPrices(name).length > 0) return reject(fullText, 'missing_name', node)
    return addItem(section, node, 'line_break_list', {
      name: clip(displayName(name)),
      priceStatus: 'known',
      amountMinorUnits: line.price.amountMinorUnits,
      currency: line.price.hasEuroSign ? 'EUR' : null,
      description: null,
    })
  }

  // One block of a `formatted_block` run: the same refusals as handleItem,
  // plus the strict end-price rule (exactly one price, at the very end).
  function handleBlock(block, node, headingPath) {
    stats.candidates += 1
    const { body, price, priceText, before } = blockEndPrice(block, budget)
    const fullText = `${block.title} ${body}`.trim()
    if (fullText.length > MAX_ITEM_TEXT) {
      budget.spend(Math.ceil(fullText.length / 16))
      if (findPrices(fullText).length > 0) reject(fullText, 'ambiguous_structure', node)
      return undefined
    }
    budget.spend(fullText.length + 1)
    if (NON_MENU_HEADING_PATTERN.test(headingPath.join(' '))) {
      if (price || findPrices(fullText).length > 0 || isClockText(fullText)) reject(fullText, 'non_menu_section', node)
      return undefined
    }
    if (isClockText(fullText)) return reject(fullText, 'clock_time', node)
    if (isDateText(fullText)) return reject(fullText, 'date', node)
    if (block.lines.some((line) => MODIFIER_PATTERN.test(line)) || MODIFIER_PATTERN.test(block.title)) return reject(fullText, 'modifier', node)
    if (hasServiceUnit(fullText) || PER_TABLE_PATTERN.test(fullText)) return reject(fullText, 'service_unit', node)
    const name = cleanName(block.title)
    const section = sectionFor(headingPath)
    if (!price) {
      // A price that is not the last token is never read as the dish price.
      if (findPrices(body).length > 0) return reject(fullText, 'ambiguous_structure', node)
      if (isPlausibleItemName(name) && name.length <= 80) section.unpriced.push({ text: fullText, node })
      return undefined
    }
    if (TIME_WORD_BEFORE_PATTERN.test(before)) return reject(fullText, 'clock_time', node)
    // A second price, a price range or a price variant before the end price.
    if (findPrices(before).length > 0 || PRICE_BEFORE_END_PATTERN.test(before)) return reject(fullText, 'ambiguous_structure', node)
    if (!isPlausibleItemName(name)) return reject(fullText, 'missing_name', node)
    const description = cleanName(before)
    return addItem(section, node, 'formatted_block', {
      name: clip(displayName(name)),
      priceStatus: 'known',
      amountMinorUnits: price.amountMinorUnits,
      currency: price.hasEuroSign || /€/.test(priceText) ? 'EUR' : null,
      description: description && isPlausibleItemName(description) ? clip(description) : null,
    })
  }

  function addItem(section, node, pattern, item) {
    const key = `${JSON.stringify(section.path)}|${item.name.toLowerCase()}|${item.priceStatus}|${item.amountMinorUnits}`
    if (seen.has(key)) {
      stats.duplicatesRemoved += 1
      return undefined
    }
    seen.add(key)
    section.items.push({ ...item, evidence: { pattern, locator: locatorOf(node, budget) } })
    return undefined
  }

  // Document-order walk with an explicit heading stack; bounded depth.
  const headingStack = []
  // Panel labels are siblings even when each panel holds deeper h3 sections,
  // so their level is anchored once (below the surrounding heading), not
  // re-derived from the deepest section of the previous panel.
  let panelLevel = null
  function currentPath(extra) {
    const labels = headingStack.map((h) => h.text)
    return extra ? [...labels, extra] : labels
  }

  function walk(node, depth, extraLabel) {
    if (depth > MAX_DEPTH) {
      stats.depthLimited = true
      return
    }
    for (const child of node.children) {
      budget.spend(1)
      // Markers only matter inside item text (textOf); the walk never skips
      // an element for its class, so an item classed "vegan" is still read.
      if (child.tag === '#text') continue
      const panelHeading = !isHeading(child) && isPanelHeading(child, budget)
      if (isHeading(child) || panelHeading) {
        const raw = textOf(child, { markerCounter, budget })
        const text = clip(raw)
        if (text) {
          const top = headingStack[headingStack.length - 1]
          // A panel label (DINNER/LUNCH) is a menu-variant level above the
          // h3 sections inside its panel. An explicit aria-level always wins;
          // otherwise it sits at level 2 so a later h3 section can never pop
          // the variant back out of the route.
          if (panelHeading && !Number.isInteger(panelLevel)) panelLevel = 2
          const level = panelHeading
            ? (Number(child.attrs && child.attrs['aria-level']) || panelLevel)
            : headingLevel(child)
          // A sentence-like heading nested BELOW a real section heading
          // ("Deze gerechten worden geserveerd in …" under "A LA CARTE") is
          // context for that section: skipped, the dishes stay in it. On the
          // same or a higher level it is kept in the route, so its dishes
          // never join the previous section; the hierarchy then marks that
          // route uncertain ("Controle nodig").
          if (!panelHeading && top && level > top.level && isProseHeading(raw)) continue
          // A section heading identical to the enclosing label (Blossem:
          // panel "BITES" containing h3 "BITES") adds a level but no
          // information; it is not duplicated in the route.
          if (top && top.text === text && level >= top.level) continue
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) headingStack.pop()
          headingStack.push({ level, text })
        }
        continue
      }
      if (isListItem(child)) {
        budget.spend(child.children.length)
        const nested = child.children.filter((c) => c.tag !== '#text' && isList(c))
        if (nested.length > 0) {
          const rawLabel = textOf(child, { skip: isList, markerCounter, budget })
          // A nested list's label is never dropped, not even when it reads as
          // a sentence: its dishes stay under exactly that source label (never
          // under a previous sibling section, never flattened into the parent),
          // and a sentence-like label makes the section uncertain (sectionFor).
          const label = clip(rawLabel)
          for (const list of nested) walk(list, depth + 1, label || extraLabel)
          continue
        }
        handleItem(child, 'list_item', currentPath(extraLabel))
        continue
      }
      if (child.tag === 'tr' && (budget.spend(child.children.length), child.children.some((c) => c.tag === 'td'))) {
        handleItem(child, 'table_row', currentPath(extraLabel))
        continue
      }
      if (child.tag === 'dt') {
        handleItem(child, 'definition', currentPath(extraLabel))
        continue
      }
      if ((child.tag === 'p' || child.tag === 'div') && (budget.spend(child.children.length), child.children.some((c) => c.tag === 'br'))) {
        const lines = lineBreakLines(child, budget, markerCounter)
        if (lines) {
          for (const line of lines) handleLine(line, child, currentPath(extraLabel))
          continue
        }
      }
      // A "card" that itself holds a priced line list (BE-25) is a container
      // around a whole menu (an accordion panel, a column), not one dish:
      // walk into it instead of reading it as a single item. The same applies
      // to an accordion panel whose content is a list or several sub-headings
      // (the real Blossem BITES panel).
      if (
        isRepeatedCard(child, budget) &&
        !classMatches(child, CONTAINER_CLASS_PATTERN) &&
        !looksLikeMenuContainer(child, budget) &&
        !findDescendant(child, (n) => (n.tag === 'p' || n.tag === 'div') && n.children.some((c) => c.tag === 'br') && lineBreakLines(n, budget, markerCounter) !== null, budget)
      ) {
        handleItem(child, 'repeated_card', currentPath(extraLabel))
        continue
      }
      // Repeated dish blocks (title anchor, description, end price), only
      // under a menu heading: without a heading the structure is not
      // trusted (fail closed).
      if (child.tag === 'p' || child.tag === 'div') {
        const path = currentPath(extraLabel)
        const blocks = path.length > 0 ? formattedBlockRun(child, budget, markerCounter) : null
        if (blocks) {
          for (const block of blocks) handleBlock(block, child, path)
          continue
        }
        // A paragraph without line breaks that carries several alternative
        // end prices is an arrangement/choice offer, not one dish. It is
        // reported under its heading, never flattened into a fake item.
        if (
          path.length > 0 &&
          !child.children.some((c) => c.tag === 'br') &&
          child.children.every((c) => c.tag === '#text' || LINE_PRICE_TAGS.has(c.tag)) &&
          hasAlternativeEndPrices(textOf(child, { markerCounter, budget }))
        ) {
          noteExcludedContent(path, 'alternative_prices')
          continue
        }
      }
      walk(child, depth + 1, extraLabel)
    }
  }
  walk(root, 0, null)
  stats.ignoredMarkers = markerCounter.count

  // Unpriced lines are only reported where the same section has priced
  // items — a navigation list never becomes rejected-line noise.
  const sections = []
  for (const section of sectionsByKey.values()) {
    if (section.items.length === 0) {
      // A recognised heading whose content yielded no dish with a readable
      // price (an arrangement/choice menu, or unreadable price lines) is
      // never silently discarded: the path and the line count are reported.
      if (section.unpriced.length > 0 && section.path.length > 0) noteExcludedContent(section.path, 'no_recognized_price')
      continue
    }
    for (const line of section.unpriced) reject(line.text, 'missing_price', line.node)
    sections.push(section.uncertain ? { path: section.path, items: section.items, uncertain: true } : { path: section.path, items: section.items })
  }
  const excludedSections = [...excludedByPath.values()]
  const counted = sections.reduce((n, s) => n + s.items.length, 0)
  stats.counted = counted
  stats.workUnits = budget.used

  if (counted < MIN_ITEMS) return unparsed(counted === 0 ? 'no_structured_items' : 'too_few_items', rejected, stats)
  if (sections.length > MAX_SECTIONS || counted > MAX_ITEMS) return unparsed('too_many_items', rejected, stats)
  return { contractVersion: MENU_EXTRACTION_CONTRACT_VERSION, status: 'parsed', reason: null, sections, excludedSections, rejected, stats, cost: emptyCost() }
}

/** The `html_structure` adapter — the same AdapterResult envelope as
 * adapters.js, with the menu result under `menuExtraction`. */
function createHtmlStructureAdapter() {
  return {
    kind: 'html_structure',
    available: true,
    async run(fixture) {
      let menuExtraction
      const errors = []
      try {
        menuExtraction = extractHtmlMenuStructure(fixture && fixture.html)
      } catch (err) {
        // Defense in depth only — an adapter never throws into the runner,
        // and an internal failure is never a guessed menu.
        menuExtraction = unparsed('internal_error', [], emptyStats())
        errors.push({ code: 'internal_error' })
      }
      return {
        kind: 'html_structure',
        available: true,
        fields: {},
        menuContextNames: [],
        unknownMenuContextCount: 0,
        errors,
        notes: [],
        menuExtraction,
      }
    },
  }
}

module.exports = {
  MIN_ITEMS,
  MAX_HTML_LENGTH,
  MAX_NODES,
  MAX_DEPTH,
  MAX_PARSE_DEPTH,
  MAX_WORK,
  MAX_ITEM_TEXT,
  createBudget,
  parseHtml,
  findPrices,
  isClockText,
  isDateText,
  displayName,
  decodeEntities,
  isProseHeading,
  extractHtmlMenuStructure,
  createHtmlStructureAdapter,
}
