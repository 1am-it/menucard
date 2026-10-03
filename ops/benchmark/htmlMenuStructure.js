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
// review or arrangement heading; clock times; per-person/per-table and other
// service units (per person, per table, arrangements, packages, courses —
// a small local list, see SERVICE_UNIT_PATTERN); modifiers
// ("+ extra …"); a price without a name; a name without a price (recorded
// only in a section that also has priced items, so navigation links never
// become noise). Prices in running text (paragraphs, prose) never count —
// only the structures above. Fewer than MIN_ITEMS counted items → `unparsed`.
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
const MAX_DEPTH = 200
const MAX_REJECTED_TEXT = 120

// ─── A bounded, tolerant HTML tree builder (no dependency) ────────────────

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const SKIPPED_BLOCKS = /<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi
const BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'dl', 'table', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'td', 'th', 'dt', 'dd', 'br'])

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—', hellip: '…' }

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    const named = NAMED_ENTITIES[code.toLowerCase()]
    return named === undefined ? whole : named
  })
}

function parseAttributes(raw) {
  const attrs = {}
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match
  while ((match = re.exec(raw))) {
    const name = match[1].toLowerCase()
    attrs[name] = decodeEntities(match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : '')
  }
  return attrs
}

function nearest(node, tags, stopTags) {
  for (let n = node; n && n.tag !== '#root'; n = n.parent) {
    if (tags.has(n.tag)) return n
    if (stopTags && stopTags.has(n.tag)) return null
  }
  return null
}

const IMPLICIT_CLOSE = {
  li: [new Set(['li']), new Set(['ul', 'ol'])],
  dt: [new Set(['dt', 'dd']), new Set(['dl'])],
  dd: [new Set(['dt', 'dd']), new Set(['dl'])],
  tr: [new Set(['tr']), new Set(['table', 'tbody', 'thead', 'tfoot'])],
  td: [new Set(['td', 'th']), new Set(['tr', 'table'])],
  th: [new Set(['td', 'th']), new Set(['tr', 'table'])],
}

/** Builds a tree from `html`. Returns `{ root, nodeCount, truncated }`;
 * `truncated` is true when MAX_NODES was reached (the caller fails closed). */
function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null }
  const cleaned = String(html).replace(/<!--[\s\S]*?-->/g, ' ').replace(SKIPPED_BLOCKS, ' ')
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)|</g
  let current = root
  let nodeCount = 0
  let match
  while ((match = re.exec(cleaned))) {
    if (nodeCount >= MAX_NODES) return { root, nodeCount, truncated: true }
    if (match[4] !== undefined || match[0] === '<') {
      const text = decodeEntities(match[4] !== undefined ? match[4] : '<')
      if (text.trim()) {
        current.children.push({ tag: '#text', text, parent: current })
        nodeCount += 1
      }
      continue
    }
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()
    if (closing) {
      const open = nearest(current, new Set([tag]))
      if (open) current = open.parent
      continue
    }
    const implicit = IMPLICIT_CLOSE[tag]
    if (implicit) {
      const open = nearest(current, implicit[0], implicit[1])
      if (open) current = open.parent
    } else if (BLOCK_TAGS.has(tag) && current.tag === 'p') {
      current = current.parent
    }
    const node = { tag, attrs: parseAttributes(match[3]), children: [], parent: current }
    current.children.push(node)
    nodeCount += 1
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(match[3])) current = node
  }
  return { root, nodeCount, truncated: false }
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
 * Iterative — never recurses. `skip(node)` may exclude a subtree. */
function textOf(start, { skip, markerCounter } = {}) {
  const parts = []
  const stack = [start]
  while (stack.length > 0) {
    const node = stack.pop()
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

function locatorOf(node) {
  const segments = []
  for (let n = node; n && n.tag !== '#root'; n = n.parent) {
    const same = n.parent ? n.parent.children.filter((c) => c.tag === n.tag) : [n]
    segments.unshift(same.length > 1 ? `${n.tag}[${same.indexOf(n) + 1}]` : n.tag)
  }
  const joined = segments.join('>')
  return joined.length > MAX_TEXT ? `…${joined.slice(joined.length - (MAX_TEXT - 1))}` : joined
}

// ─── Prices, times, units ──────────────────────────────────────────────────

/** A price token: optional €, 1–3 digits with exactly two decimals or ",-",
 * or "€" with whole euros. Never a bare integer (quantities, grams, people),
 * never a percentage, never a 1-decimal value (alcohol %). */
const PRICE_PATTERN = /(€\s*)?(?<![\d.,])(\d{1,3})(?:[.,](\d{2})|,[-–])(?![\d.,]*\d)(?!\s*%)|€\s*(\d{1,3})(?![\d.,]*\d)(?!\s*%)/g

function findPrices(text) {
  const prices = []
  for (const m of text.matchAll(PRICE_PATTERN)) {
    const euros = m[2] !== undefined ? Number(m[2]) : Number(m[4])
    const cents = m[3] !== undefined ? Number(m[3]) : 0
    prices.push({ raw: m[0].trim(), index: m.index, length: m[0].length, amountMinorUnits: euros * 100 + cents, hasEuroSign: m[0].includes('€') })
  }
  return prices
}

// Full weekday names anywhere; the short Dutch forms ("ma", "zo", …) only
// directly before a time, a dash or "t/m", since "zo" and "do" are also
// ordinary words in a dish description.
const WEEKDAY_PATTERN = /\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(ma|di|wo|do|vr|za|zo)\b\.?\s*(?:[-–]|t\/m|tot|\d)/i
// Only clock minutes (00/15/30/45), like BE-20's own PDF clock-time rule, so
// a dual price such as "5.50 - 27.50" is never mistaken for opening hours.
const CLOCK = '(?:[01]?\\d|2[0-4])[.:](?:00|15|30|45)'
const TIME_RANGE_PATTERN = new RegExp(`\\b${CLOCK}\\s*(?:-|–|tot|t/m|to|until)\\s*${CLOCK}\\b|\\b${CLOCK}\\s*(?:uur|u\\b|h\\b)`, 'i')
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
const DUAL_PRICE_UNIT_SUFFIX = /[\s\-–—|:,/]*(?:per\s+)?(?:glas|fles|karaf|carafe|bottle|glass|klein|groot|small|large|half|heel)\s*$/i

/** Headings whose content is never a menu: opening hours, contact,
 * reservations, reviews, arrangements/venue — matched as whole words. */
const NON_MENU_HEADING_PATTERN = /\b(openingstijden|openingsuren|opening hours|contact|reserveren|reservering(en)?|reservations?|booking|reviews?|recensies?|beoordelingen|testimonials?|ervaringen|arrangement(en)?|vergader\w*|zaalhuur|zaalverhuur|verhuur|route|bereikbaarheid|adres|nieuwsbrief|vacatures?)\b/i

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

function isRepeatedCard(node) {
  const cls = node.attrs && node.attrs.class
  if (!cls || !CARD_CLASS_PATTERN.test(cls) || !node.parent) return false
  return node.parent.children.filter((c) => c.tag === node.tag && c.attrs && c.attrs.class === cls).length >= 2
}

function findDescendant(node, predicate) {
  const stack = [...node.children]
  while (stack.length > 0) {
    const n = stack.shift()
    if (n.tag === '#text') continue
    if (predicate(n)) return n
    stack.push(...n.children)
  }
  return null
}

function classMatches(node, pattern) {
  return Boolean(node.attrs && typeof node.attrs.class === 'string' && pattern.test(node.attrs.class))
}

/** Splits one item element into { name, priceText, description, fullText }. */
function readItem(node, pattern, markerCounter) {
  if (pattern === 'table_row') {
    const cells = node.children.filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => textOf(c, { markerCounter }))
    const priceCells = cells.filter((c) => findPrices(c).length > 0 && c.replace(PRICE_PATTERN, '').trim() === '')
    const other = cells.filter((c) => !priceCells.includes(c) && c.length > 0)
    return { name: other[0] || '', priceText: priceCells.join(' '), description: other.slice(1).join(' '), fullText: cells.join(' ') }
  }
  if (pattern === 'definition') {
    const name = textOf(node, { markerCounter })
    const dds = []
    for (let sib = node.parent.children[node.parent.children.indexOf(node) + 1]; sib && sib.tag === 'dd'; sib = node.parent.children[node.parent.children.indexOf(sib) + 1]) {
      dds.push(textOf(sib, { markerCounter }))
    }
    const ddText = dds.join(' ')
    return { name, priceText: ddText, description: '', fullText: `${name} ${ddText}`.trim(), nameHasPrice: findPrices(name).length > 0 }
  }
  // Markers are counted once, on the full-text pass only.
  const fullText = textOf(node, { markerCounter })
  const nameEl = findDescendant(node, (n) => classMatches(n, NAME_CLASS_PATTERN) || /^h[3-6]$/.test(n.tag) || n.tag === 'strong' || n.tag === 'b' || (n.attrs && n.attrs.itemprop === 'name'))
  const priceEl = findDescendant(node, (n) => classMatches(n, PRICE_CLASS_PATTERN) || (n.attrs && n.attrs.itemprop === 'price'))
  const descEl = findDescendant(node, (n) => n !== nameEl && n !== priceEl && (classMatches(n, DESC_CLASS_PATTERN) || n.tag === 'p' || (n.attrs && n.attrs.itemprop === 'description')))
  if (nameEl && priceEl) {
    const description = descEl ? textOf(descEl) : ''
    return { name: textOf(nameEl), priceText: textOf(priceEl), description: findPrices(description).length > 0 ? '' : description, fullText }
  }
  // No explicit name/price elements: the name is the text before the first
  // price, the description what follows it (still inside this one element).
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

function cleanName(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.\-–—|:·…•,]+$/u, '')
    .replace(/^[\s.\-–—|:·…•,]+/u, '')
    .trim()
}

// ─── The extraction ────────────────────────────────────────────────────────

function unparsed(reason, rejected, stats) {
  return { contractVersion: MENU_EXTRACTION_CONTRACT_VERSION, status: 'unparsed', reason, sections: [], rejected, stats, cost: emptyCost() }
}

/**
 * Extracts a menu structure from one HTML string. Pure and synchronous;
 * returns a result valid under menuExtractionContract.js.
 */
function extractHtmlMenuStructure(html) {
  const stats = { candidates: 0, counted: 0, rejected: 0, duplicatesRemoved: 0, ignoredMarkers: 0, depthLimited: false }
  if (typeof html !== 'string' || html.length === 0) return unparsed('empty_input', [], stats)
  if (html.length > MAX_HTML_LENGTH) return unparsed('input_too_large', [], stats)
  const { root, truncated } = parseHtml(html)
  if (truncated) return unparsed('too_many_nodes', [], stats)

  const markerCounter = { count: 0 }
  const sectionsByKey = new Map() // path key -> { path, items, unpriced: [] }
  const rejected = []
  const seen = new Set()

  function reject(text, reason, node) {
    stats.rejected += 1
    if (rejected.length < MAX_REJECTED) rejected.push({ text: clip(text, MAX_REJECTED_TEXT) || '(leeg)', reason, locator: locatorOf(node) })
  }

  function sectionFor(path) {
    const key = JSON.stringify(path)
    if (!sectionsByKey.has(key)) sectionsByKey.set(key, { path, items: [], unpriced: [] })
    return sectionsByKey.get(key)
  }

  function handleItem(node, pattern, headingPath) {
    stats.candidates += 1
    const item = readItem(node, pattern, markerCounter)
    const fullText = item.fullText
    const pathText = headingPath.join(' ')
    if (NON_MENU_HEADING_PATTERN.test(pathText)) {
      if (findPrices(fullText).length > 0 || TIME_RANGE_PATTERN.test(fullText)) reject(fullText, 'non_menu_section', node)
      return
    }
    if (WEEKDAY_PATTERN.test(fullText) || TIME_RANGE_PATTERN.test(fullText)) return reject(fullText, 'clock_time', node)
    if (MODIFIER_PATTERN.test(fullText)) return reject(fullText, 'modifier', node)
    if (hasServiceUnit(fullText) || PER_TABLE_PATTERN.test(fullText)) return reject(fullText, 'service_unit', node)

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
    const description = cleanName(item.description)
    const descriptionValue = description && findPrices(description).length === 0 && isPlausibleItemName(description) ? clip(description) : null
    if (prices.length > 1) {
      // A dual price ("glas 5,50 / fles 27,50"): the unit label before the
      // first price belongs to that price, not to the dish name.
      const dualName = cleanName(name.replace(DUAL_PRICE_UNIT_SUFFIX, ''))
      return addItem(section, node, pattern, {
        name: clip(isPlausibleItemName(dualName) ? dualName : name),
        priceStatus: 'multiple_undecomposed',
        amountMinorUnits: null,
        currency: null,
        description: descriptionValue,
      })
    }
    const price = prices[0]
    return addItem(section, node, pattern, {
      name: clip(name),
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
    section.items.push({ ...item, evidence: { pattern, locator: locatorOf(node) } })
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
      // Markers only matter inside item text (textOf); the walk never skips
      // an element for its class, so an item classed "vegan" is still read.
      if (child.tag === '#text') continue
      if (isHeading(child)) {
        const text = clip(textOf(child, { markerCounter }))
        if (text) {
          const level = headingLevel(child)
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) headingStack.pop()
          headingStack.push({ level, text })
        }
        continue
      }
      if (isListItem(child)) {
        const nested = child.children.filter((c) => c.tag !== '#text' && isList(c))
        if (nested.length > 0) {
          const label = clip(textOf(child, { skip: isList, markerCounter }))
          for (const list of nested) walk(list, depth + 1, label || extraLabel)
          continue
        }
        handleItem(child, 'list_item', currentPath(extraLabel))
        continue
      }
      if (child.tag === 'tr' && child.children.some((c) => c.tag === 'td')) {
        handleItem(child, 'table_row', currentPath(extraLabel))
        continue
      }
      if (child.tag === 'dt') {
        handleItem(child, 'definition', currentPath(extraLabel))
        continue
      }
      if (isRepeatedCard(child)) {
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
      return {
        kind: 'html_structure',
        available: true,
        fields: {},
        menuContextNames: [],
        unknownMenuContextCount: 0,
        errors: [],
        notes: [],
        menuExtraction: extractHtmlMenuStructure(fixture.html),
      }
    },
  }
}

module.exports = {
  MIN_ITEMS,
  MAX_HTML_LENGTH,
  MAX_NODES,
  MAX_DEPTH,
  parseHtml,
  findPrices,
  extractHtmlMenuStructure,
  createHtmlStructureAdapter,
}
