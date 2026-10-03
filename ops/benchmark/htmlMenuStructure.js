// BE-22 — a small, strict, deterministic HTML menu structure adapter for
// the offline benchmark (`html_structure`). Reads an already-available HTML
// string only: no fetch, no browser, no provider, no AI, no OCR, no network
// import of any kind. Never imported by product code — see manifest.js's own
// header comment — and never wired into BE-20's live analysis pipeline.
//
// What it recognizes — only narrow, explainable local structures where a
// name and a price sit in the SAME element:
//   - `list_item`     an `li` / `role="listitem"`
//   - `table_row`     a `tr` with `td` cells (one cell is the price)
//   - `definition`    a `dt` with its following `dd`
//   - `repeated_card` two or more sibling elements with the same tag and the
//                     same item-like class (menu-item, dish, gerecht, …)
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

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—', hellip: '…' }

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,10});/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    const named = NAMED_ENTITIES[code.toLowerCase()]
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
    } else if (BLOCK_TAGS.has(tag) && stack[stack.length - 1].tag === 'p') {
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
const NAME_CLASS_PATTERN = /(name|naam|title|titel)/i
const PRICE_CLASS_PATTERN = /(price|prijs)/i
const DESC_CLASS_PATTERN = /(desc|omschrijving|beschrijving|ingredi|info|text)/i

function isHeading(node) {
  return /^h[1-6]$/.test(node.tag) || (node.attrs && node.attrs.role === 'heading')
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
    return { name: textOf(nameEl, { budget }), priceText: textOf(priceEl, { budget }), description, fullText }
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
  const rejected = []
  const seen = new Set()

  function reject(text, reason, node) {
    stats.rejected += 1
    if (rejected.length < MAX_REJECTED) rejected.push({ text: clip(text, MAX_REJECTED_TEXT) || '(leeg)', reason, locator: locatorOf(node, budget) || '(root)' })
  }

  function sectionFor(path) {
    const key = JSON.stringify(path)
    if (!sectionsByKey.has(key)) sectionsByKey.set(key, { path, items: [], unpriced: [] })
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
    const prices = findPrices(item.priceText)
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
      if (isHeading(child)) {
        const text = clip(textOf(child, { markerCounter, budget }))
        if (text) {
          const level = headingLevel(child)
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) headingStack.pop()
          headingStack.push({ level, text })
        }
        continue
      }
      if (isListItem(child)) {
        budget.spend(child.children.length)
        const nested = child.children.filter((c) => c.tag !== '#text' && isList(c))
        if (nested.length > 0) {
          const label = clip(textOf(child, { skip: isList, markerCounter, budget }))
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
      if (isRepeatedCard(child, budget)) {
        handleItem(child, 'repeated_card', currentPath(extraLabel))
        continue
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
    if (section.items.length === 0) continue
    for (const line of section.unpriced) reject(line.text, 'missing_price', line.node)
    sections.push({ path: section.path, items: section.items })
  }
  const counted = sections.reduce((n, s) => n + s.items.length, 0)
  stats.counted = counted
  stats.workUnits = budget.used

  if (counted < MIN_ITEMS) return unparsed(counted === 0 ? 'no_structured_items' : 'too_few_items', rejected, stats)
  if (sections.length > MAX_SECTIONS || counted > MAX_ITEMS) return unparsed('too_many_items', rejected, stats)
  return { contractVersion: MENU_EXTRACTION_CONTRACT_VERSION, status: 'parsed', reason: null, sections, rejected, stats, cost: emptyCost() }
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
  extractHtmlMenuStructure,
  createHtmlStructureAdapter,
}
