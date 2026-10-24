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
  return { tag, attrs, children: [], parent: null, index: 0, sameTagIndex: 1, tagCounts: Object.create(null), hidden: false }
}

/**
 * CSS-based invisibility only (`hidden`, `display:none`, `visibility:hidden`,
 * `opacity:0`, a 0/1px clipped box). Such a subtree is never shown to a
 * visitor. It is not skipped by default — a tab panel may use it for real
 * menu content — but it is never trusted for injected third-party text
 * either (see SPAM_PATTERN below). `aria-hidden` stays a marker: assistive
 * technology hiding is a different signal and already handled by isMarker.
 */
const HIDDEN_STYLE_PATTERN = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?(?:[;\s]|$)|height\s*:\s*(?:0|1)(?:px|rem|em)\b|clip\s*:\s*rect\(\s*0)/i

function isHiddenElement(node) {
  const attrs = node.attrs || {}
  if (Object.prototype.hasOwnProperty.call(attrs, 'hidden')) return true
  // `aria-hidden="true"` removes the subtree from the accessibility tree: a
  // different signal from CSS, but a real "not shown" declaration.
  if (typeof attrs['aria-hidden'] === 'string' && attrs['aria-hidden'].trim().toLowerCase() === 'true') return true
  const style = attrs.style
  return typeof style === 'string' && HIDDEN_STYLE_PATTERN.test(style)
}

/**
 * A page can hide an alternative view of the same card with its own stylesheet
 * (the live Pellens page hides a legacy duplicate module with
 * `… .fl-module:not(…) {display:none!important}`), not only with an inline
 * style or a `hidden` attribute. Only an explicitly hiding declaration counts;
 * a conditional (`@media`, `@supports`, `@keyframes`) block is never applied,
 * because its effect depends on a viewport or feature this reader does not
 * have. A selector this small matcher does not fully understand is skipped —
 * never half-applied — so an unreadable rule can never silently hide a menu.
 * Hiding only changes what the walk *prefers*: a hidden subtree is counted
 * once only when the visible side provably carries the same priced dishes (see
 * the hidden-view gate in extractWithinBudget); otherwise it stays visible as
 * an explicit limitation.
 */
const MAX_HIDDEN_RULES = 40
const MAX_HIDDEN_SELECTOR_TEXT = 400
// A page's stylesheet is read up to this many characters; a bigger block is
// not silently trusted for hiding, it is simply not scanned.
const MAX_CSS_TEXT = 256 * 1024
const CSS_HIDES_PATTERN = /(?:^|[;{])\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i
const CSS_STYLE_OPEN = /<style\b([^>]*)>/gi
// Global on purpose: `exec` only honours `lastIndex` on a global/sticky regex,
// so the closing tag must be searched from the end of the opening tag.
const CSS_STYLE_CLOSE = /<\/style/gi
const CSS_AT_RULE = /^@/

/** Reads a balanced `(…)` group starting at `start` (the index of "("). */
function readParenGroup(text, start) {
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return { body: text.slice(start + 1, i), next: i + 1 }
    }
  }
  return null
}

/** One compound selector: tag, #id, .class, [attr], :not(…), :has(…). */
function parseCssCompound(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_HIDDEN_SELECTOR_TEXT) return null
  const compound = { tag: null, ids: [], classes: [], attrs: [], nots: [], has: [] }
  let i = 0
  const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(text)
  if (tagMatch) {
    compound.tag = tagMatch[1].toLowerCase()
    i = tagMatch[0].length
  }
  while (i < text.length) {
    const ch = text[i]
    if (ch === '#' || ch === '.') {
      const match = (ch === '#' ? /^#([\w-]+)/ : /^\.([\w-]+)/).exec(text.slice(i))
      if (!match) return null
      ;(ch === '#' ? compound.ids : compound.classes).push(match[1])
      i += match[0].length
      continue
    }
    if (ch === '[') {
      const end = text.indexOf(']', i)
      if (end < 0) return null
      const body = text.slice(i + 1, end).trim()
      const match = /^([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*))\s*)?$/.exec(body)
      if (!match) return null
      const value = match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5]
      compound.attrs.push({ name: match[1].toLowerCase(), op: match[2] || null, value: value === undefined ? '' : value })
      i = end + 1
      continue
    }
    if (text.slice(i, i + 5) === ':not(') {
      const group = readParenGroup(text, i + 4)
      if (!group) return null
      const parts = group.body.split(',').map((part) => parseCssCompound(part.trim()))
      if (parts.some((part) => part === null)) return null
      compound.nots.push(parts)
      i = group.next
      continue
    }
    if (text.slice(i, i + 5) === ':has(') {
      const group = readParenGroup(text, i + 4)
      if (!group) return null
      const parts = parseCssSelector(group.body.trim())
      if (!parts) return null
      compound.has.push(parts)
      i = group.next
      continue
    }
    // Any other pseudo-class (`:first-child`, `:nth-child(…), :empty`) or a
    // pseudo-element is not applied: skip the whole selector (fail closed).
    return null
  }
  if (compound.tag === null && compound.ids.length === 0 && compound.classes.length === 0 && compound.attrs.length === 0 && compound.nots.length === 0 && compound.has.length === 0) return null
  return compound
}

/** A selector chain (compounds + combinators); `null` when unsupported. */
function parseCssSelector(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_HIDDEN_SELECTOR_TEXT) return null
  const parts = []
  let buffer = ''
  let depth = 0
  let combinator = null
  const flush = () => {
    const compound = parseCssCompound(buffer.trim())
    if (!compound) return false
    parts.push({ combinator: parts.length === 0 ? null : combinator, compound })
    buffer = ''
    return true
  }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (depth === 0 && (ch === '>' || /\s/.test(ch))) {
      // "a > b", "a>b" and "a b": a child combinator is kept once seen,
      // surrounding whitespace never adds another level.
      if (buffer.trim()) {
        if (!flush()) return false
        combinator = ch === '>' ? '>' : ' '
      } else if (ch === '>') {
        combinator = '>'
      }
      continue
    }
    buffer += ch
  }
  if (buffer.trim()) {
    if (!flush()) return null
  }
  if (parts.length === 0) return null
  if (parts[0].combinator !== null) return null
  return parts
}

/** Collects the selectors of unconditional hiding rules in the page's own CSS. */
function collectHiddenSelectors(html) {
  const selectors = []
  CSS_STYLE_OPEN.lastIndex = 0
  let open
  // One forward pass: each `<style>` block is consumed up to its own closing
  // tag, so a hostile page with many unclosed tags can never re-scan the input
  // (a lazy `[\s\S]*?` over a multi-megabyte body would).
  while (selectors.length < MAX_HIDDEN_RULES && (open = CSS_STYLE_OPEN.exec(html))) {
    const bodyStart = open.index + open[0].length
    CSS_STYLE_CLOSE.lastIndex = bodyStart
    const close = CSS_STYLE_CLOSE.exec(html)
    if (!close) break
    CSS_STYLE_OPEN.lastIndex = close.index + close[0].length
    if (/\bmedia\s*=/i.test(open[1] || '')) continue
    const css = html.slice(bodyStart, Math.min(close.index, bodyStart + MAX_CSS_TEXT))
    const stack = []
    let preludeStart = 0
    let i = 0
    while (i < css.length && selectors.length < MAX_HIDDEN_RULES) {
      const ch = css[i]
      if (ch === '{') {
        const prelude = css.slice(preludeStart, i).trim()
        const atRule = CSS_AT_RULE.test(prelude)
        if (!atRule && !stack.some((entry) => entry)) {
          const end = css.indexOf('}', i)
          if (end < 0) break
          if (CSS_HIDES_PATTERN.test(css.slice(i + 1, end))) {
            for (const part of prelude.split(',')) {
              const parsed = parseCssSelector(part.trim())
              if (parsed) selectors.push(parsed)
              if (selectors.length >= MAX_HIDDEN_RULES) break
            }
          }
          i = end + 1
          preludeStart = i
          continue
        }
        stack.push(atRule)
        i += 1
        preludeStart = i
        continue
      }
      if (ch === '}') {
        stack.pop()
        i += 1
        preludeStart = i
        continue
      }
      i += 1
    }
  }
  return selectors
}

function hasClassToken(attrs, name) {
  return typeof attrs.class === 'string' && attrs.class.split(/\s+/).includes(name)
}

function attrMatches(attrs, condition) {
  const present = Object.prototype.hasOwnProperty.call(attrs, condition.name)
  if (!condition.op) return present
  if (!present) return false
  const value = String(attrs[condition.name])
  switch (condition.op) {
    case '=':
      return value === condition.value
    case '~=':
      return condition.value !== '' && value.split(/\s+/).includes(condition.value)
    case '^=':
      return condition.value !== '' && value.startsWith(condition.value)
    case '$=':
      return condition.value !== '' && value.endsWith(condition.value)
    case '*=':
      return condition.value !== '' && value.includes(condition.value)
    case '|=':
      return value === condition.value || value.startsWith(`${condition.value}-`)
    default:
      return false
  }
}

function matchesCssCompound(node, compound, budget) {
  if (!node || node.tag === '#text' || node.tag === '#root') return false
  if (budget) budget.spend(1)
  const attrs = node.attrs || {}
  if (compound.tag && node.tag !== compound.tag) return false
  for (const id of compound.ids) if (attrs.id !== id) return false
  for (const name of compound.classes) if (!hasClassToken(attrs, name)) return false
  for (const condition of compound.attrs) if (!attrMatches(attrs, condition)) return false
  for (const alternatives of compound.nots) {
    if (alternatives.some((part) => matchesCssCompound(node, part, budget))) return false
  }
  for (const parts of compound.has) {
    if (!hasDescendantMatching(node, parts, budget)) return false
  }
  return true
}

function matchesCssSelector(node, parts, budget, index = parts.length - 1) {
  if (!node || index < 0) return false
  const part = parts[index]
  if (!matchesCssCompound(node, part.compound, budget)) return false
  if (index === 0) return true
  if (part.combinator === '>') return matchesCssSelector(node.parent, parts, budget, index - 1)
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (matchesCssSelector(ancestor, parts, budget, index - 1)) return true
  }
  return false
}

function hasDescendantMatching(node, parts, budget) {
  if (budget) budget.spend(node.children.length)
  const queue = [...node.children]
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]
    if (budget) budget.spend(1)
    if (current.tag === '#text') continue
    if (matchesCssSelector(current, parts, budget)) return true
    if (budget) budget.spend(current.children.length)
    for (const child of current.children) queue.push(child)
  }
  return false
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
  // Rules from the page's own stylesheet that hide a subtree unconditionally.
  const hiddenSelectors = source.includes('<style') ? collectHiddenSelectors(source) : []
  const matchesHiddenCss = (node) => {
    if (hiddenSelectors.length === 0 || node.tag === '#text') return false
    for (const parts of hiddenSelectors) {
      if (matchesCssSelector(node, parts, budget)) return true
    }
    return false
  }
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
    node.hidden = parent.hidden === true || isHiddenElement(node) || matchesHiddenCss(node)
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

// ─── Injected / non-menu content (#59 Delivery Lead review 6316295818) ─────
//
// A restaurant site can be hijacked: third-party gambling/pharmacy text is
// injected, sometimes invisible, and carries its own "prices". The extractor
// must never turn that into accepted dishes. The pattern below is a generic
// vocabulary, never a per-domain allow/deny list. One strong operator name is
// already a signal; two distinct signals are enough to refuse the content.
const SPAM_PATTERN = /\b(?:unibet|bet365|1xbet|20bet|bwin|betway|casino|casinos|sportsvæddemål|sportwetten|pengespil|spilleautomater|spiloplevelser|apuestas|bookmakers?|betting|viagra|cialis|payday(?:\s+loans?)?|forex)\b/gi

function spamSignals(text) {
  const found = new Set()
  for (const match of String(text || '').matchAll(SPAM_PATTERN)) found.add(match[0].toLowerCase())
  return found
}

const INJECTION_BLOCK_MIN_CHARS = 80

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

// ─── Whole euros as a printed price (AA1, Lead review 6383853638) ──────────
//
// Some cards print a price as a whole number of euros, without cents and
// without a currency sign: "Zeebaars 34    geschroeid | oester", "Vijf-gangen
// 130". That is the same money parser, not a second family: the same digit
// shape, the same quantity/unit vocabulary and the same time/date vocabulary
// are reused here. Only the printed context is stricter, because a bare
// integer is also a weight, a year, a house number or a phone group.
//
// A bare integer is a price only when every one of these holds:
//   1. shape: 1–3 digits, no leading zero, optional ",-"; a decimal, a euro
//      sign or a percentage stays with `findPrices`;
//   2. it sits on a printed cell boundary — two or more spaces, a tab, a
//      printed column separator (| · •) or the end of the printed segment — on
//      at least one side;
//   3. at least two letters print before it inside that same cell (a name);
//   4. no unit or counting word directly follows it ("75 gram", "6 stuks",
//      "5 gangen", "12 x", "10%");
//   5. it is not a year, a clock time, a date or a phone group.
// The caller still confirms the section: one bare integer on its own is never
// enough (see `pricedLinesOfSource` in src/lib/menuSourceCoverage.js).
// Anything doubtful stays a plain number — a false price is worse than a
// missed one.

/** A unit, a counting word, a time or a year directly after the amount. */
const COUNTING_WORD_AFTER = /^\s?(?:%|(?:gram|grams|gr|g|kg|kilo|cl|ml|dl|l|ltr|liter|liters|litre|litres|mg|oz|lb|st|stk|stuks|personen|persoon|pers|pp|gangen|gang|x|×|uur|u|h|hr|min|minuut|minuten|jaar|maanden|mnd|weken|dagen|keer|kazen|glazen|glas|flessen|fles|gerechten|borden|kopjes|bolletjes|sneetjes|plakjes)(?!\p{L}))/iu

/** A word that numbers something rather than naming a dish: "op nummer 1". */
const NUMBERING_WORD_BEFORE = /\b(?:nummer|nr|nrs|punt|stap|etage|verdieping|keuze|optie|plek|plaats|tafel|kamer|pagina)\s*[.:]?\s*$/i

const WHOLE_EURO_PATTERN = /(?<![\d.,€])(\d{1,3})(?:\s*,\s*[-–])?(?![\d.,:]*\d)(?!\s*%)/g

/** True when the text before `index` ends on a printed cell boundary. */
function boundaryBefore(text, index) {
  if (index === 0) return true
  if (text[index - 1] === '\t') return true
  let i = index - 1
  while (i >= 0 && text[i] === ' ') i -= 1
  if (index - 1 - i >= 2) return true
  return i >= 0 && (text[i] === '|' || text[i] === '·' || text[i] === '•')
}

/** True when the text from `end` starts with a printed cell boundary. */
function boundaryAfter(text, end) {
  if (end >= text.length) return true
  const next = text.slice(end, end + 4)
  if (next[0] === '\t') return true
  if (next.startsWith('  ')) return true
  return /^\s*[|·•]/.test(next)
}

/**
 * At least two letters print before the amount: its name, in its own cell or in
 * the printed cell just before it (a tab- or column-separated card). Bounded
 * look-back, trailing separators dropped.
 */
function printedNameBefore(text, index) {
  const from = Math.max(0, index - 240)
  return isPlausibleItemName(text.slice(from, index).replace(/[\s|·•]+$/, ''))
}

/**
 * Every bare whole-euro amount in `text` with the verdict of the line rule.
 * Exported for the offline diagnosis, so a refused amount is reported with its
 * own reason instead of disappearing silently.
 */
function wholeEuroAmountTokens(text) {
  const source = String(text || '')
  const tokens = []
  for (const m of source.matchAll(WHOLE_EURO_PATTERN)) {
    const raw = m[0].trim()
    const index = m.index
    const length = m[0].length
    const digits = m[1]
    const token = { raw, index, length, amountMinorUnits: Number(digits) * 100, hasEuroSign: false, reason: null }
    const after = source.slice(index + length, index + length + 12)
    const around = source.slice(Math.max(0, index - 16), index + length + 8)
    if (/^0/.test(digits)) token.reason = 'leading_zero'
    else if (index > 0 && /[\p{L}\p{N}]/u.test(source[index - 1])) token.reason = 'glued'
    else if (COUNTING_WORD_AFTER.test(after)) token.reason = 'unit'
    else if (NUMBERING_WORD_BEFORE.test(source.slice(Math.max(0, index - 24), index))) token.reason = 'counting_word'
    else if (MONTH_DATE_PATTERN.test(around) || ON_DATE_PATTERN.test(around)) token.reason = 'date'
    else if (isClockText(source.slice(Math.max(0, index - 12), index + length + 2)) || /[:.]\d{2}/.test(source.slice(index + length, index + length + 4))) token.reason = 'time'
    else if (/\b(?:tel|telefoon|mobiel|gsm|fax)\b/i.test(source.slice(Math.max(0, index - 24), index))) token.reason = 'phone'
    else if (!boundaryBefore(source, index) && !boundaryAfter(source, index + length)) token.reason = 'no_boundary'
    else if (!printedNameBefore(source, index)) token.reason = 'no_name'
    tokens.push(token)
  }
  return tokens
}

/** The bare whole-euro amounts of `text` that pass the whole line rule. */
function findWholeEuroPrices(text) {
  return wholeEuroAmountTokens(text)
    .filter((token) => token.reason === null)
    .map(({ raw, index, length, amountMinorUnits, hasEuroSign }) => ({ raw, index, length, amountMinorUnits, hasEuroSign }))
}

/**
 * Every printed price of one printed segment: the money parser above plus the
 * confirmed whole euros, in printed order. A whole euro that would overlap or
 * follow a money token is already that token and is skipped, so an amount is
 * never counted twice.
 */
function findPrintedPrices(text) {
  const source = String(text || '')
  const money = findPrices(source)
  const taken = money.map((price) => [price.index, price.index + price.length])
  const whole = findWholeEuroPrices(source)
    .filter((price) => {
      const end = price.index + price.length
      if (taken.some(([start, stop]) => price.index < stop && start < end)) return false
      return !/€\s*$/.test(source.slice(0, price.index))
    })
    .map((price) => ({ ...price, wholeEuro: true }))
  return [...money, ...whole].sort((a, b) => a.index - b.index)
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
const PRICE_ONLY_PATTERN = /^(€\s*)?(\d{1,3})(?:[.,](\d{1,2}))?(?:(?:\s*,\s*|\s+)[-–])?(\s*€)?$/

function parsePriceOnly(text) {
  const match = PRICE_ONLY_PATTERN.exec(String(text || '').trim())
  if (!match) return null
  const euros = Number(match[2])
  const cents = match[3] === undefined ? 0 : Number(match[3].length === 1 ? match[3] + '0' : match[3])
  const amountMinorUnits = euros * 100 + cents
  if (amountMinorUnits < 50 || amountMinorUnits > 50000) return null
  return { amountMinorUnits, hasEuroSign: Boolean(match[1] || match[4]) }
}

/** True when a descendant of `node` is a `br` (cached per node). */
function containsBr(node, budget) {
  if (node.hasBrDescendant !== undefined) return node.hasBrDescendant
  let found = false
  const stack = [...node.children]
  while (stack.length > 0 && !found) {
    const current = stack.pop()
    if (budget) budget.spend(1)
    if (current.tag === 'br') {
      found = true
      break
    }
    for (const child of current.children || []) stack.push(child)
  }
  node.hasBrDescendant = found
  return found
}

/**
 * A shallow copy of `element` holding only the parts of its first line.
 * A CMS routinely closes a bold dish title with a `br` inside the bold element
 * (`<strong>Ossenhaas <br></strong>rosé …`), and a flattened line would lose
 * the title's own markup — the block then depended on a capitalisation guess
 * and dishes such as "Ossenhaas" or "Pasta zalm" disappeared. The copy keeps
 * the element's identity (tag/attrs) for exactly the text before the break;
 * later lines keep their own parts. (#59 review 6323277596)
 */
function inlineLineHead(element, parts) {
  return {
    tag: element.tag,
    attrs: element.attrs,
    children: parts,
    parent: element.parent,
    index: element.index,
    sameTagIndex: element.sameTagIndex,
    tagCounts: Object.create(null),
    hidden: element.hidden,
  }
}

/**
 * The lines of one inline element, split at a `br` at any depth. A CMS often
 * wraps a whole dish line list in a `<span>` (`<span><br>NAME 25<br>
 * description</span>`, the live Chocolat dinnerkaart), so a line is not only
 * defined by a `br` that is a direct child. A block-level child means the
 * element is not a line list: `null` (fail closed).
 */
function inlineLines(node, budget) {
  const lines = [[]]
  for (const child of node.children) {
    budget.spend(1)
    if (child.tag === 'br') {
      lines.push([])
      continue
    }
    if (child.tag === '#text') {
      lines[lines.length - 1].push(child)
      continue
    }
    if (BLOCK_TAGS.has(child.tag)) return null
    if (containsBr(child, budget)) {
      const inner = inlineLines(child, budget)
      if (!inner) return null
      if (inner[0].length > 0) lines[lines.length - 1].push(inlineLineHead(child, inner[0]))
      for (let i = 1; i < inner.length; i += 1) lines.push(inner[i])
      continue
    }
    lines[lines.length - 1].push(child)
  }
  return lines
}

/** The `p`/`div` as line parts, flattening inline elements that hold a `br`. */
function splitLines(node, budget) {
  if (node.tag !== 'p' && node.tag !== 'div') return null
  const lines = [[]]
  for (const child of node.children) {
    budget.spend(1)
    if (child.tag === 'br') {
      lines.push([])
      continue
    }
    if (child.tag === '#text') {
      lines[lines.length - 1].push(child)
      continue
    }
    if (BLOCK_TAGS.has(child.tag)) return null
    if (containsBr(child, budget)) {
      const inner = inlineLines(child, budget)
      if (!inner) return null
      if (inner[0].length > 0) lines[lines.length - 1].push(inlineLineHead(child, inner[0]))
      for (let i = 1; i < inner.length; i += 1) lines.push(inner[i])
      continue
    }
    lines[lines.length - 1].push(child)
  }
  return lines
}

/**
 * The lines of a `p`/`div` split at `br`, when at least two lines end in
 * their own price-only inline element; otherwise `null`. A line holding a
 * block element is never a dish line (the structure is not a plain list).
 * Every inspected child is charged to `budget`.
 */
function lineBreakLines(node, budget, markerCounter) {
  if (node.tag !== 'p' && node.tag !== 'div') return null
  const lines = splitLines(node, budget)
  if (!lines) return null
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
const END_PRICE_PATTERN = /(?:^|\s)((?:€\s*)?\d{1,3}(?:[.,]\d{1,2})?(?:(?:\s*,\s*|\s+)[-–])?(?:\s*€)?)$/
// A number right before the end price ("25 / 30", "8,50 - 12,50"): a range or
// a second price, never one dish price.
const PRICE_BEFORE_END_PATTERN = /(?:^|\s)(?:€\s*)?\d{1,3}(?:[.,]\d{1,2})?\s*(?:[/|\-–]|of|or|en)?\s*$/i
// An explicit supplement or surcharge clause ANYWHERE in a dish block, not
// only at its very end: "35 - supplement eendenlever 9", "17 - in plaats van
// dessert, supplement 8,50", "(supp. ganzenlever €4)", "meerprijs". Its amount
// may never become the dish's main price (#59 reviews 6315269210 and
// 6323277596; the live Zuyd/Chocolat/Andalous sources triggered this).
const SUPPLEMENT_MARKER_PATTERN = /\b(?:supplement(?:en)?|suppl\.?|supp|toeslag|meerprijs)\b/i

/**
 * Splits one line at its first explicit supplement marker. `rest` keeps the
 * text on the dish side (including the main price before the marker),
 * `clause` is the supplement text itself. A marker without an amount still
 * marks the line as a supplement ("Geraspte kaas … meerprijs").
 */
function splitSupplementClause(line) {
  const value = String(line || '')
  const match = SUPPLEMENT_MARKER_PATTERN.exec(value)
  if (!match) return null
  const before = value.slice(0, match.index)
  return {
    rest: before.replace(/[\s\-–—,(]+$/, '').trim(),
    clause: value.slice(match.index).trim(),
  }
}

// A supplement marker directly before the only amount of a line: that amount
// is not the line's dish price, so the line is refused instead of mispriced.
const SUPPLEMENT_BEFORE_PRICE_PATTERN = /\b(?:supplement(?:en)?|suppl\.?|supp|toeslag|meerprijs)\b[^€\d]{0,40}$/i
// A bulleted legend/footnote line after a standalone price; it is not a dish
// description and cannot be the end price of the block.
const LEGEND_LINE_PATTERN = /^[○●•·*†‡]\s*/;

// Time context right before a bare number ("open tot 22", "vanaf 17"): never a price.
const TIME_WORD_BEFORE_PATTERN = /\b(?:vanaf|tot|om|tussen|van|t\/m|tot en met|uur|open|geopend|gesloten|sluit|aanvang|from|until|at)\s*$/i

/** Text of one inline line part (text node or inline element). */
function partText(part, markerCounter, budget) {
  return part.tag === '#text' ? part.text : textOf(part, { markerCounter, budget })
}

// A price at the end of a title line (`<strong>Soep, €7,50</strong>` or
// `NAME 25`), optionally followed by a compact diet/allergen notation such as
// "V" or "(V)". The notation is never interpreted; it is only not part of the
// name. Whole euros are allowed because the line structure gives the meaning.
const TITLE_PRICE_PATTERN = /\s*((?:€\s*)?\d{1,3}(?:[.,]\d{1,2})?)\s*(?:\(\s*(?:V|VG|VE|GF|G|N|S)\s*\)|\b(?:V|VG|VE|GF|N)\b)?\s*$/i

/**
 * `name` + trailing price of one title line, or null. Never when the name
 * itself holds another price (that is a variant/range, not one dish).
 */
function splitTitlePrice(text) {
  const value = String(text || '').trim()
  const match = TITLE_PRICE_PATTERN.exec(value)
  if (!match) return null
  const name = cleanName(value.slice(0, match.index))
  if (!isPlausibleItemName(name) || name.length > 80) return null
  // A second price before this one is never collapsed into one dish price.
  if (findPrices(name).length > 0) return null
  const price = parsePriceOnly(match[1])
  if (!price) return null
  return { name, price, priceText: match[1].trim() }
}

/**
 * A `NAME 25` line without bold markup is only a dish name when it looks
 * like a printed menu line: short, no sentence punctuation, and either
 * upper-case or consistently capitalised. This keeps ordinary prose that
 * happens to end in a number out of the menu (fail closed).
 */
function looksLikePlainDishLine(text) {
  const value = String(text || '').trim()
  if (!value || value.length > 80) return false
  if (/[.!?;:]$/.test(value)) return false
  const words = value.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 10) return false
  if ((value.match(/\p{L}/gu) || []).length < 2) return false
  if ((value.match(/\p{Ll}/gu) || []).length === 0) return true
  const capitalised = words.filter((word) => /^\p{Lu}/u.test(word)).length
  return capitalised >= Math.ceil(words.length * 0.6)
}

/**
 * The bold/anchor text a line starts with: the part itself when it is a
 * `strong`/`b`, or the first meaningful child when the part is an inline
 * wrapper around one (`<span><strong>C</strong></span>`). The text is taken
 * exactly as printed — no de-spacing and no case change.
 */
function lineAnchorText(part, markerCounter, budget) {
  if (!part || part.tag === '#text') return ''
  if (TITLE_ANCHOR_TAGS.has(part.tag)) return cleanName(partText(part, markerCounter, budget))
  const child = (part.children || []).find((c) => (c.tag === '#text' ? c.text.trim() !== '' : textOf(c, { markerCounter, budget }) !== ''))
  if (child && child.tag !== '#text' && TITLE_ANCHOR_TAGS.has(child.tag)) return cleanName(partText(child, markerCounter, budget))
  return ''
}

/**
 * The dish blocks of a `p`/`div`: lines split at `br` (also inside an inline
 * wrapper). A block starts with a bold title anchor — including the common
 * `NAME, €7,50` anchor — or, when the CMS prints no bold markup, with a
 * clearly menu-shaped `NAME 25` line that is directly followed by a
 * description line. Any other text before a block start refuses the whole
 * element (fail closed). Results are cached per node.
 */
function formattedBlocks(node, budget, markerCounter) {
  if (node.formattedBlocks !== undefined) return node.formattedBlocks
  node.formattedBlocks = null
  if (node.tag !== 'p' && node.tag !== 'div') return null
  const lines = splitLines(node, budget)
  if (!lines) return null
  const lineInfo = []
  for (const parts of lines) {
    const meaningful = parts.filter((c) => (c.tag === '#text' ? c.text.trim() !== '' : !isMarker(c) && textOf(c, { markerCounter, budget }) !== ''))
    if (meaningful.length === 0) {
      lineInfo.push(null)
      continue
    }
    const first = meaningful[0]
    const firstText = partText(first, markerCounter, budget).replace(/\s+/g, ' ').trim()
    // The bold run that carries the dish title can be the first part of the
    // line or a later one: a CMS splits one printed name over two runs
    // ("<strong>C</strong><span><strong>onference Peer 18</strong></span>").
    // The printed order is kept and the runs join with the space the source
    // prints between them — never de-spaced into a guessed word, never dropped.
    let titleIndex = -1
    let anchorText = ''
    let fragment = ''
    for (let partIndex = 0; partIndex < meaningful.length; partIndex += 1) {
      const candidate = lineAnchorText(meaningful[partIndex], markerCounter, budget)
      if (!candidate) break
      const priced = splitTitlePrice(candidate)
      const nameLike = isPlausibleItemName(candidate) && candidate.length <= 80 && findPrices(candidate).length === 0 && !END_PRICE_PATTERN.test(candidate)
      // A printed dish name starts with a capital. A bold run that starts in
      // lower case and has no printed fragment in front of it ("inclusief
      // gebakken ganzenlever 54") is the continuation of the dish above, never
      // a new dish of its own.
      const startsLowercase = /^\p{Ll}/u.test(candidate)
      if (priced && (!startsLowercase || fragment)) {
        titleIndex = partIndex
        anchorText = candidate
        break
      }
      if (partIndex === 0 && nameLike && !startsLowercase) {
        titleIndex = partIndex
        anchorText = candidate
        break
      }
      if (partIndex > 0) break
      if (findPrices(candidate).length > 1) {
        // A bold title with two amounts ("Mixed Grill, €27,50 (1 pers.) /
        // €48,50 (2 pers.)") is a dish with price variants; the walk turns it
        // into one item with every printed amount.
        node.multiPriceAnchorLines = (node.multiPriceAnchorLines || 0) + 1
        break
      }
      if (/^\p{L}{1,3}$/u.test(candidate)) {
        fragment = candidate
        continue
      }
      break
    }
    let title = ''
    let titlePrice = null
    let linePrice = null
    if (anchorText) {
      const priced = splitTitlePrice(anchorText)
      if (priced) {
        title = priced.name
        titlePrice = priced
      } else {
        title = anchorText
      }
      if (fragment) title = `${fragment} ${title}`
    } else {
      const text = meaningful.map((c) => partText(c, markerCounter, budget)).join(' ').replace(/\s+/g, ' ').trim()
      const priced = splitTitlePrice(text)
      if (priced && looksLikePlainDishLine(priced.name)) linePrice = priced
    }
    const restStart = titleIndex >= 0 ? titleIndex + 1 : 0
    const rest = meaningful.slice(restStart).map((c) => partText(c, markerCounter, budget)).join(' ').replace(/\s+/g, ' ').trim()
    lineInfo.push({ title, titlePrice, linePrice, rest, fragment: titleIndex >= 0 ? '' : fragment })
  }
  // A dish title the CMS split over two markup runs keeps exactly the printed
  // text: a bold fragment ("C") directly followed by a line whose title
  // continues in lower case ("onference Peer 18") is ONE title, joined with the
  // space the source prints between the runs. Never de-spaced into a guessed
  // word, and never dropped into the previous dish's description.
  for (let index = 0; index + 1 < lineInfo.length; index += 1) {
    const info = lineInfo[index]
    const next = lineInfo[index + 1]
    if (!info || !info.fragment || !next || !next.title) continue
    if (!/^\p{Ll}/u.test(next.title)) continue
    next.title = `${info.fragment} ${next.title}`
    lineInfo[index] = null
  }
  const blocks = []
  let current = null
  for (let index = 0; index < lineInfo.length; index += 1) {
    const info = lineInfo[index]
    if (!info) continue
    if (info.title) {
      current = { title: info.title, lines: info.rest ? [info.rest] : [] }
      if (info.titlePrice) current.titlePrice = info.titlePrice
      blocks.push(current)
      continue
    }
    if (info.linePrice) {
      // A marked-up title that happens to end in a price (`<b>Soep 7,50</b>`)
      // was already handled above; this is the unmarked line-list shape. It
      // needs a following description line, never a run of bare priced names.
      const next = lineInfo[index + 1]
      if (next && next.rest && !next.title && !next.linePrice) {
        current = { title: info.linePrice.name, lines: [], titlePrice: info.linePrice, plain: true }
        blocks.push(current)
        continue
      }
    }
    if (!info.rest) continue
    if (!current) return null
    current.lines.push(info.rest)
  }
  if (blocks.length === 0) return null
  node.formattedBlocks = blocks
  return blocks
}

/**
 * Amounts on the dish side of a supplement clause, in source order. Whole
 * euros count here because the clause proves the line is a dish line
 * ("… ossenhaas 35 - supplement eendenlever 9"); a bare quantity such as
 * "6 stuks" or "2 personen" is still not an amount.
 */
function amountsBeforeClause(text) {
  const found = []
  for (const match of String(text || '').matchAll(/(?:^|[\s(])((?:€\s*)?\d{1,3}(?:[.,]\d{1,2})?)(?=\s*(?:$|[-–—,()]))/g)) {
    const price = parsePriceOnly(match[1])
    if (price) found.push({ price, raw: match[1].trim(), index: match.index + match[0].indexOf(match[1]) })
  }
  return found
}

/** How many printed words directly before an amount may label that amount
 *  ("2 stuks", "inclusief gebakken ganzenlever"). */
const VARIANT_LABEL_MAX_WORDS = 4
const VARIANT_SEPARATOR_PATTERN = /[|/·•–—]+/g
/** A bare whole-euro amount ("65", "98"): the shape a printed card uses when it
 *  leaves out the cents. Never a number glued to a decimal, a unit or a year. */
const WHOLE_EURO_AMOUNT = /(?<![\d.,€])(\d{1,3})(?![\d.,]*\d)(?!\s*%)/g
const QUANTITY_UNIT_AFTER = /^(?:gram|grams|gr|kg|kilo|cl|ml|dl|ltr|liter|liters|st|stk|stuks|pers|persoon|personen|pp|glas|glazen|fles|flessen|btl|karaf|gangen|gang|uur|mnd|min)\b/i
/** The tokens a gap between two amounts of ONE dish may hold: the label of the
 *  next amount ("50 gram") and printed separators. Any other word means the gap
 *  names something of its own, so the two amounts are not one dish's variants. */
const VARIANT_GAP_TOKEN = /^(?:[|/·•–—,()+-]+|\d{1,4}|gram|grams|gr|kg|kilo|cl|ml|dl|ltr|liter|liters|st|stk|stuks|pers|persoon|personen|pp|glas|glazen|fles|flessen|btl|karaf|gangen|gang|uur|met|of|en|and|or|from|vanaf|inclusief|incl)$/i

/**
 * The short printed label directly before one amount of a variant row. Only
 * the words the source itself prints are used (never an invented "klein"/
 * "groot"), a portion pair directly before the amount ("30 gram") is the whole
 * label, the separators (`|`, `/`) are not part of it, and a label that is
 * really a whole sentence is refused.
 */
function variantLabel(text) {
  const words = cleanName(String(text || '').replace(VARIANT_SEPARATOR_PATTERN, ' '))
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return null
  const portion = words.length >= 2 && /^\d{1,4}$/.test(words[words.length - 2]) && QUANTITY_UNIT_AFTER.test(words[words.length - 1])
  const label = portion ? words.slice(-2).join(' ') : words.slice(-VARIANT_LABEL_MAX_WORDS).join(' ')
  return label.length > 0 && label.length <= 40 ? label : null
}

/** One comparable amount per variant, in the same two-decimal form the
 *  reference comparison and the price fields use ("65.00"). */
function variantAmount(amountMinorUnits) {
  return (amountMinorUnits / 100).toFixed(2)
}

/** The one comparable price field of a multi-price dish: every printed amount,
 *  never one of them. The printed form stays in the item's quote. */
function variantsPriceText(variants) {
  return variants.map((variant) => variantAmount(variant.amountMinorUnits)).join(' / ')
}

/** Bare whole-euro amounts of one row, in source order; an amount directly
 *  followed by a unit ("30 gram") is a portion label, not an amount. */
function wholeEuroAmounts(text) {
  const found = []
  for (const match of String(text || '').matchAll(WHOLE_EURO_AMOUNT)) {
    const after = text.slice(match.index + match[0].length).replace(/^[\s|/·•,]+/, '')
    if (after && QUANTITY_UNIT_AFTER.test(after)) continue
    const value = Number(match[1])
    if (!Number.isFinite(value) || value < 1 || value > 500) continue
    found.push({ index: match.index, length: match[1].length, raw: match[1], amountMinorUnits: value * 100 })
  }
  return found
}

/**
 * Every amount of one dish line with the label printed directly before it, in
 * source order ("30 gram 65 | 50 gram 98"). Only a row that ENDS in an amount
 * and whose amounts are separated by nothing but labels and separators is a
 * variant row: "Soep 6,50 Salade 7,50" and "Pizza 12,50 met 3 soorten kaas" are
 * never one dish with variants. Returns null otherwise.
 */
function pricesVariantsFromRow(text) {
  const source = String(text || '')
  const found = [...findPrices(source), ...wholeEuroAmounts(source)]
    .sort((a, b) => a.index - b.index)
  const amounts = []
  for (const option of found) {
    const previous = amounts[amounts.length - 1]
    if (previous && option.index < previous.index + previous.length) continue
    amounts.push(option)
  }
  if (amounts.length < 2) return null
  const tail = source.slice(amounts[amounts.length - 1].index + amounts[amounts.length - 1].length)
  if (!/^[\s|/·•,.)-]*$/.test(tail)) return null
  const variants = []
  let cursor = 0
  for (const amount of amounts) {
    const gap = source.slice(cursor, amount.index)
    if (cursor > 0) {
      const gapWords = gap.split(/\s+/).filter(Boolean)
      if (gapWords.length > 5 || !gapWords.every((word) => VARIANT_GAP_TOKEN.test(word))) return null
    }
    variants.push({ label: variantLabel(gap), amountMinorUnits: amount.amountMinorUnits })
    cursor = amount.index + amount.length
  }
  return { variants, prefix: source.slice(0, amounts[0].index), suffix: tail }
}

/** A trailing printed portion label ("… room 20 gram") is the label of the
 *  next variant, not part of the dish description. */
const TRAILING_VARIANT_LABEL = /\s+\d{1,4}\s*(?:gram|grams|gr|kg|cl|ml|dl|ltr|liter|st|stk|stuks|pers|persoon|personen|pp|glas|glazen|fles|flessen)$/i

function stripTrailingVariantLabel(text) {
  return String(text || '').replace(TRAILING_VARIANT_LABEL, '').trim()
}

/** Shape stored on an item: priceStatus multiple_undecomposed with the
 *  printed labels and the comparable amount text. */
function variantItemFields(variants) {
  const stored = variants.map((variant) => ({ label: variant.label || null, price: variantAmount(variant.amountMinorUnits) }))
  return {
    priceStatus: 'multiple_undecomposed',
    amountMinorUnits: null,
    currency: null,
    priceVariants: stored,
    priceText: variantsPriceText(variants),
  }
}

function blockEndPrice(block, budget) {
  const sourceLines = (block.lines || [])
    .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  // Bulleted legend/footnote lines after a dish are neither its description
  // nor its price ("○ crème brûlée │ …" after "Kaasgerecht … 29,50"): they
  // never block the end price of the dish above them.
  while (sourceLines.length > 0 && LEGEND_LINE_PATTERN.test(sourceLines[sourceLines.length - 1])) sourceLines.pop()
  budget.spend(1 + Math.ceil(sourceLines.join(' ').length / 16))
  // An explicit supplement clause anywhere in the block belongs to the dish
  // price BEFORE it; the amount after the marker is never that price. The
  // original text stays in `sourceBody` for the review quote.
  let supplementText = null
  const rawLines = []
  for (const line of sourceLines) {
    const split = splitSupplementClause(line)
    if (!split) {
      rawLines.push(line)
      continue
    }
    supplementText = supplementText ? `${supplementText} ${split.clause}` : split.clause
    if (split.rest) rawLines.push(split.rest)
  }
  const sourceBody = sourceLines.join(' ').trim()
  const rawBody = rawLines.join(' ').trim()
  if (supplementText) {
    const amounts = amountsBeforeClause(rawBody)
    if (amounts.length === 1) {
      const only = amounts[0]
      return {
        body: rawBody,
        rawBody: sourceBody,
        supplementText,
        price: only.price,
        priceText: only.raw,
        before: cleanName(rawBody.slice(0, only.index)),
        priceBeforeSupplement: true,
      }
    }
    // The block carries its price in the title and only a supplement below it.
    if (amounts.length === 0 && block.titlePrice && findPrices(supplementText).length > 0) {
      return {
        body: rawBody,
        rawBody: sourceBody,
        supplementText,
        price: block.titlePrice.price,
        priceText: block.titlePrice.priceText,
        before: rawBody,
        priceFromTitle: true,
      }
    }
    // A block that declares itself a supplement without any amount
    // ("Geraspte kaas, €2,00 / meerprijs") is a surcharge, never a dish.
    if (amounts.length === 0 && findPrices(supplementText).length === 0) {
      return { body: rawBody, rawBody: sourceBody, supplementText, price: null, priceText: '', before: rawBody, supplementOnly: true }
    }
    return {
      body: rawBody,
      rawBody: sourceBody,
      supplementText,
      price: null,
      priceText: '',
      before: rawBody,
      ...(amounts.length > 1 ? { priceVariants: true } : {}),
    }
  }
  const match = END_PRICE_PATTERN.exec(rawBody)
  if (match) {
    const price = parsePriceOnly(match[1])
    return {
      body: rawBody,
      rawBody: sourceBody,
      supplementText,
      price,
      priceText: price ? match[1].trim() : '',
      before: price ? rawBody.slice(0, match.index).trim() : rawBody,
    }
  }
  // The title line itself carries the price (`NAME, €7,50` / `NAME 25`). It
  // is the dish price only when the description below holds no amount.
  if (block.titlePrice) {
    const bodyHasPrice = findPrices(rawBody).length > 0
    return {
      body: rawBody,
      rawBody: sourceBody,
      supplementText,
      price: bodyHasPrice ? null : block.titlePrice.price,
      priceText: bodyHasPrice ? '' : block.titlePrice.priceText,
      before: rawBody,
      priceFromTitle: !bodyHasPrice,
    }
  }
  // A dish price can sit on its own line followed only by a bulleted legend
  // ("16,50" then "○ …"). That line is the dish price; the legend is not.
  for (let index = rawLines.length - 2; index >= 0; index -= 1) {
    const priceOnly = parsePriceOnly(rawLines[index])
    const after = rawLines.slice(index + 1)
    if (!priceOnly || after.length === 0 || !after.every((line) => LEGEND_LINE_PATTERN.test(line))) continue
    const body = rawLines.slice(0, index + 1).join(' ')
    return {
      body,
      rawBody: sourceBody,
      supplementText,
      price: priceOnly,
      priceText: rawLines[index],
      before: rawLines.slice(0, index).join(' ').trim(),
      ignoredLegendLines: after.length,
    }
  }
  return { body: rawBody, rawBody: sourceBody, supplementText, price: null, priceText: '', before: rawBody, ...(findPrices(rawBody).length > 1 ? { priceVariants: true } : {}) }
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
  // A CMS spacer paragraph (`<p>&nbsp;</p>`, an empty `<p>`) is not a dish
  // and must not split one printed menu into two runs (the live Chocolat
  // dinnerkaart separates every dish with one).
  const spacer = (sibling) => {
    if (sibling.tag !== 'p' && sibling.tag !== 'div') return false
    if (isHeading(sibling)) return false
    return !sibling.children.some((child) => child.tag !== '#text' || child.text.trim() !== '')
  }
  const siblings = parent.children
  let start = node.index
  while (start > 0 && (budget.spend(1), fits(siblings[start - 1]) || spacer(siblings[start - 1]))) start -= 1
  if (!parent.formattedRunPriced) parent.formattedRunPriced = new Map()
  if (!parent.formattedRunPriced.has(start)) {
    let total = 0
    for (let i = start; i < siblings.length && (budget.spend(1), fits(siblings[i]) || spacer(siblings[i])); i += 1) {
      if (!fits(siblings[i])) continue
      total += priced(formattedBlocks(siblings[i], budget, markerCounter))
    }
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
/** A trailing spelled-out weight ("STEAK TARTARE 90 GRAM") is a serving size,
 * not the dish name; it stays visible in the full quote. Abbreviated units
 * ("250 g", "500 ml", "0,75 l") are left in the name: the source prints those
 * as part of the item, and the corpus fixtures rely on that. */
const TRAILING_PORTION_PATTERN = /\s*\(?\b\d{1,4}\s*(?:gram|grams)\b\.?\)?\s*$/i
/**
 * A trailing spelled-out weight ("STEAK TARTARE 90 GRAM") is a serving size,
 * not the dish name. A portion that stands behind an explicit separator
 * ("Pata negra | 80 gram") is part of the source's own label and is kept —
 * truncating it produced exactly the "afgekapte naam" the counting rules
 * forbid (#59 review 6334231310, found by re-running the Blossem probe).
 */
const PORTION_SEPARATOR_BEFORE = /[|/\-–—:·]\s*$/

function stripTrailingPortion(text) {
  const match = TRAILING_PORTION_PATTERN.exec(text)
  if (!match) return text
  const before = text.slice(0, match.index)
  if (PORTION_SEPARATOR_BEFORE.test(before)) return text
  return before
}

function displayName(name) {
  const tail = name.length > 32 ? name.slice(-32) : name
  const stripped = stripTrailingPortion(tail.replace(TRAILING_ALCOHOL_PERCENT, ''))
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

const MIN_TAB_PANELS = 1
const MAX_TAB_PANELS = 24

/**
 * A labelled tab control (`role="tab"` with `aria-controls`/`data-target`)
 * declares a menu variant a visitor can switch to; the panel with that id is
 * where the variant's dishes live. Only a control whose target id exists in
 * the document can add a route level — a stray `role="tab"` never does (K2).
 */
function collectTabPanels(root, budget) {
  const panels = new Map()
  if (budget) budget.spend(root.children.length)
  const queue = [...root.children]
  for (let head = 0; head < queue.length && panels.size < MAX_TAB_PANELS; head += 1) {
    const node = queue[head]
    if (budget) budget.spend(1)
    if (node.tag === '#text') continue
    const attrs = node.attrs || {}
    if (attrs.role === 'tab' && typeof attrs['aria-controls'] === 'string') {
      const targetId = panelTargetId(attrs)
      const label = targetId ? clip(textOf(node, { budget })) : ''
      if (targetId && label) panels.set(targetId, label)
    }
    if (budget) budget.spend(node.children.length)
    for (const child of node.children) queue.push(child)
  }
  return panels.size >= MIN_TAB_PANELS ? panels : new Map()
}

/**
 * A heading whose text is exactly the declared accessible name of an element
 * around it (`<section aria-label="Onze kaart"><h2>Onze kaart</h2>`) is the
 * source's OWN card title. When a page title is printed above it ("Welkom bij
 * …"), that page title must not become the menu title (K2).
 */
function isRegionTitle(node, text) {
  const wanted = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!wanted) return false
  let depth = 0
  for (let parent = node.parent; parent && depth < MAX_DEPTH; parent = parent.parent, depth += 1) {
    const attrs = parent.attrs || {}
    const label = typeof attrs['aria-label'] === 'string' ? attrs['aria-label'].replace(/\s+/g, ' ').trim().toLowerCase() : ''
    if (label && label === wanted) return true
  }
  return false
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
  let termPairs = 0
  const queue = [...node.children]
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]
    if (budget) budget.spend(1)
    if (!current || current.tag === '#text') continue
    if (isListItem(current)) listItems += 1
    if (current.tag === 'tr') rows += 1
    // Two or more terms make it a definition LIST around several dishes (a
    // `dl.pm-dishes` block with its own `dt`/`dd` rows), never one dish.
    if (current.tag === 'dt') termPairs += 1
    for (const child of current.children) queue.push(child)
  }
  return listItems >= 3 || rows >= 2 || termPairs >= 2
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

// ─── A name with its own description in one cell (K1) ──────────────────────

/** Inline elements that can hold a dish description next to the name. */
const INLINE_DESC_TAGS = new Set(['span', 'em', 'i', 'small', 'b', 'strong', 'a', 'mark', 'cite', 'q', 'sub', 'sup'])

/**
 * A row/term cell whose first text run is the dish name and whose ONE inline
 * child element holds the description — `<th scope="row">Naam<span>druif,
 * prei</span></th>`, `<dt>Naam<span>zwarte knoflook</span></dt>`,
 * `<li>Naam<span>…</span></li>`. Read as one merged string the name would be
 * wrong ("Naamdruif, prei"), and a merged word can even hide a service unit
 * ("2 gangenvoor- en hoofdgerecht"). Only this exact shape is split: exactly
 * one inline element, no block element, no price in either half, and after it
 * at most a bare price. Anything else keeps the previous behaviour (fail
 * closed, never a guessed description).
 */
function splitInlineHead(node, markerCounter, budget) {
  const children = node.children || []
  if (children.length < 2 || isMarker(node)) return null
  let inline = null
  let headText = ''
  let restText = ''
  for (const child of children) {
    budget.spend(1)
    if (child.tag === '#text') {
      if (inline === null) headText += child.text
      else restText += child.text
      continue
    }
    if (inline !== null) return null
    if (!INLINE_DESC_TAGS.has(child.tag)) return null
    inline = child
  }
  if (!inline || isMarker(inline) || isPriceElement(inline)) return null
  const head = headText.replace(/\s+/g, ' ').trim()
  const tail = textOf(inline, { markerCounter, budget }).replace(/\s+/g, ' ').trim()
  if (!head || !tail) return null
  if (head.length > MAX_ITEM_TEXT || tail.length > MAX_ITEM_TEXT) return null
  if (findPrices(head).length > 0 || findPrices(tail).length > 0) return null
  if (letterCount(head) < 2 || letterCount(tail) < 1) return null
  // Only a bare price may follow the description, never more text.
  const rest = restText.replace(/\s+/g, ' ').trim()
  if (rest) {
    const prices = findPrices(rest)
    if (prices.length === 0) return null
    let leftover = ''
    let from = 0
    for (const price of prices) {
      leftover += rest.slice(from, price.index)
      from = price.index + price.length
    }
    leftover = (leftover + rest.slice(from)).replace(/[€\s.,:;()\-–—]/g, '')
    if (leftover.length > 0) return null
  }
  return { head, tail, priceText: rest }
}

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
    // A cell of the shape "name + one inline description" keeps its two halves
    // apart instead of becoming one merged name (K1).
    const cells = []
    for (const c of node.children) {
      budget.spend(1)
      if (c.tag === 'td' || c.tag === 'th') {
        const split = splitInlineHead(c, markerCounter, budget)
        cells.push({ text: split ? `${split.head} ${split.tail}` : textOf(c, { markerCounter, budget }), split })
      }
    }
    const kinds = cells.map((cell) => {
      budget.spend(1 + Math.ceil(Math.min(cell.text.length, MAX_ITEM_TEXT) / 16))
      return classifyCell(cell.text)
    })
    const fullText = cells.map((cell) => cell.text).join(' ')
    if (rowHasSeveralNamePricePairs(kinds)) return { name: '', priceText: '', description: '', fullText, ambiguous: true }
    const priceCells = cells.filter((cell, i) => kinds[i] === 'price')
    const other = cells.filter((cell, i) => kinds[i] !== 'price' && kinds[i] !== 'variant' && cell.text.length > 0)
    const first = other[0] || null
    const description = [
      first && first.split ? first.split.tail : '',
      ...other.slice(1).map((cell) => cell.text),
    ].filter(Boolean).join(' ')
    return { name: first ? (first.split ? first.split.head : first.text) : '', priceText: priceCells.map((cell) => cell.text).join(' '), description, fullText }
  }
  if (pattern === 'definition') {
    // A term cell "name + inline description" is split; the term keeps its own
    // name and the description stays its description (K1).
    const split = splitInlineHead(node, markerCounter, budget)
    const name = split ? split.head : textOf(node, { markerCounter, budget })
    const dds = []
    const siblings = node.parent.children
    for (let i = node.index + 1; i < siblings.length && siblings[i].tag === 'dd'; i += 1) dds.push(textOf(siblings[i], { markerCounter, budget }))
    const ddText = dds.join(' ')
    const priceText = [ddText, split ? split.priceText : ''].filter(Boolean).join(' ')
    return {
      name,
      priceText,
      description: split ? split.tail : '',
      fullText: `${split ? `${split.head} ${split.tail}` : name} ${priceText}`.trim(),
      nameHasPrice: findPrices(name).length > 0,
    }
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
    // "Name + one inline description (+ a bare price)": no merged name (K1).
    const split = splitInlineHead(node, markerCounter, budget)
    if (split) {
      return {
        name: split.head,
        priceText: split.priceText,
        description: split.tail,
        fullText: `${split.head} ${split.tail}${split.priceText ? ` ${split.priceText}` : ''}`,
      }
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
  return {
    candidates: 0,
    counted: 0,
    rejected: 0,
    duplicatesRemoved: 0,
    ignoredMarkers: 0,
    depthLimited: false,
    workUnits: 0,
    injectedBlocksSkipped: 0,
    priceVariantLines: 0,
    priceVariantItems: 0,
    // A hidden alternative view of the same card that was counted once
    // (items) and hidden content without a visible counterpart that was kept
    // and reported instead (items). Never a silent omission (K3).
    hiddenViewsMerged: 0,
    hiddenUniqueItems: 0,
  }
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
  // Headings the page hides: their excluded content is not a source-level
  // limitation (it is hidden on purpose), so it is not reported as one.
  const hiddenHeadingPaths = new Set()
  const rejected = []
  const seen = new Set()

  function noteExcludedContent(path, reason, lines = 1) {
    if (!Array.isArray(path) || path.length === 0) return
    const key = JSON.stringify(path)
    const entry = excludedByPath.get(key) || { path, unpricedLines: 0, reason }
    entry.unpricedLines += lines
    excludedByPath.set(key, entry)
  }

  // A line refused as a service unit (a course/portion price of an arrangement)
  // is kept per heading path. When that whole section yields no dish it is
  // reported as an arrangement, never as a missing dish (K4).
  const serviceUnitByPath = new Map()
  function noteServiceUnit(path) {
    if (!Array.isArray(path) || path.length === 0) return
    // Register the section even when every one of its lines was refused, so an
    // arrangement stays visible instead of disappearing from the report (K4).
    sectionFor(path)
    const key = JSON.stringify(path)
    const entry = serviceUnitByPath.get(key) || { path, lines: 0 }
    entry.lines += 1
    serviceUnitByPath.set(key, entry)
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

  /** The spam signals of a hidden block, when it is long enough to be an
   * injected third-party section rather than a short hidden label. */
  function injectedContentSignals(node, markerCounter, budget) {
    const text = textOf(node, { markerCounter, budget })
    if (text.length < INJECTION_BLOCK_MIN_CHARS) return null
    const signals = spamSignals(text)
    return signals.size >= 2 ? [...signals] : null
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
    if (hasServiceUnit(fullText) || PER_TABLE_PATTERN.test(fullText)) {
      // A course/portion price of an arrangement is not a dish; when nothing
      // else in that section is a dish it is reported as an arrangement (K4).
      if (hasServiceUnit(fullText)) noteServiceUnit(headingPath)
      return reject(fullText, 'service_unit', node)
    }
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
        return addItem(section, node, pattern, { name: cleanName(name.replace(ON_REQUEST_PATTERN, '')), priceStatus: 'on_request', amountMinorUnits: null, currency: null, description: null }, { quote: fullText })
      }
      if (isPlausibleItemName(name) && name.length <= 80) section.unpriced.push({ text: fullText, node })
      return undefined
    }
    if (!isPlausibleItemName(name) || item.nameHasPrice) return reject(fullText, 'missing_name', node)
    // An explicit supplement/surcharge directly before the only amount is not
    // the dish's main price; refuse the line instead of inventing a price.
    if (prices.length === 1) {
      const priceIndex = fullText.lastIndexOf(prices[0].raw)
      const beforePrice = priceIndex >= 0 ? fullText.slice(0, priceIndex) : fullText
      if (SUPPLEMENT_BEFORE_PRICE_PATTERN.test(beforePrice)) return reject(fullText, 'supplement_price', node)
    }
    if (prices.length > 1 && hasNameBetweenPrices(item.priceText, prices)) return reject(fullText, 'ambiguous_structure', node)
    const description = cleanName(item.description)
    const descriptionValue = description && findPrices(description).length === 0 && isPlausibleItemName(description) ? clip(description) : null
    if (prices.length > 1) {
      // A dual price ("glas 5,50 / fles 27,50"): the unit label before the
      // first price belongs to that price, not to the dish name. Every printed
      // amount is kept as its own variant — never one of them as "the" price.
      const tail = name.length > 48 ? name.slice(-48) : name
      const dualName = cleanName(name.slice(0, name.length - tail.length) + tail.replace(DUAL_PRICE_UNIT_SUFFIX, ''))
      const row = pricesVariantsFromRow(item.priceText)
      const variants = row
        ? row.variants
        : prices.map((price) => ({ label: null, amountMinorUnits: price.amountMinorUnits }))
      return addItem(section, node, pattern, {
        name: clip(displayName(isPlausibleItemName(dualName) ? dualName : name)),
        ...variantItemFields(variants),
        description: descriptionValue,
      }, { quote: fullText })
    }
    const price = prices[0]
    return addItem(section, node, pattern, {
      name: clip(displayName(name)),
      priceStatus: 'known',
      amountMinorUnits: price.amountMinorUnits,
      currency: price.hasEuroSign || /€/.test(item.priceText) ? 'EUR' : null,
      description: descriptionValue,
    }, { quote: fullText })
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
    if (hasServiceUnit(fullText) || PER_TABLE_PATTERN.test(fullText)) {
      if (hasServiceUnit(fullText)) noteServiceUnit(headingPath)
      return reject(fullText, 'service_unit', node)
    }
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
    }, { quote: fullText })
  }

  // One block of a `formatted_block` run: the same refusals as handleItem,
  // plus the strict end-price rule (exactly one price, at the very end).
  function handleBlock(block, node, headingPath) {
    stats.candidates += 1
    const { body, rawBody, price, priceText, before, supplementText, priceFromTitle, priceVariants, supplementOnly } = blockEndPrice(block, budget)
    // The quote keeps the source line, including an explicit supplement clause;
    // only the price decision is made on the stripped text.
    const fullText = `${block.title} ${rawBody || body}`.trim()
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
    if (hasServiceUnit(fullText) || PER_TABLE_PATTERN.test(fullText)) {
      if (hasServiceUnit(fullText)) noteServiceUnit(headingPath)
      return reject(fullText, 'service_unit', node)
    }
    const name = cleanName(block.title)
    const section = sectionFor(headingPath)
    // A dish whose row prints several amounts is ONE dish with price variants
    // ("30 gram 65 | 50 gram 98", a base amount in the title with the inclusive
    // amount at the end of the row). Every printed amount is kept with the label
    // the source prints before it; none of them becomes "the" price and none is
    // dropped. Two name+price pairs never reach this point
    // (pricesVariantsFromRow refuses them), and a supplement clause keeps its
    // own refusal below.
    const rowVariants = pricesVariantsFromRow(body)
    if (!price) {
      // A block that declares itself a supplement ("meerprijs") is never a dish.
      if (supplementOnly) return reject(fullText, 'supplement_price', node)
      if (rowVariants && isPlausibleItemName(name)) {
        const variantDescription = stripTrailingVariantLabel(cleanName(rowVariants.prefix))
        return addItem(section, node, 'formatted_block', {
          name: clip(displayName(name)),
          ...variantItemFields(rowVariants.variants),
          description: variantDescription && isPlausibleItemName(variantDescription) ? clip(variantDescription) : null,
        }, { quote: fullText })
      }
      // Several prices without one provable relation to the dish (no label, or a
      // second dish name between them) stay an explicit, visible limit.
      if (priceVariants || amountsBeforeClause(body).length > 1) {
        stats.priceVariantLines += 1
        return reject(fullText, 'ambiguous_structure', node)
      }
      // A price that is not the last token is never read as the dish price.
      if (findPrices(body).length > 0) return reject(fullText, 'ambiguous_structure', node)
      if (isPlausibleItemName(name) && name.length <= 80) section.unpriced.push({ text: fullText, node })
      return undefined
    }
    if (TIME_WORD_BEFORE_PATTERN.test(before)) return reject(fullText, 'clock_time', node)
    if (!isPlausibleItemName(name)) return reject(fullText, 'missing_name', node)
    if (rowVariants) {
      // The last amount of the row is the one `blockEndPrice` took; the earlier
      // amounts of the same row belong to the same dish.
      const variantDescription = stripTrailingVariantLabel(cleanName(rowVariants.prefix))
      return addItem(section, node, 'formatted_block', {
        name: clip(displayName(name)),
        ...variantItemFields(rowVariants.variants),
        description: variantDescription && isPlausibleItemName(variantDescription) ? clip(variantDescription) : null,
      }, { quote: fullText })
    }
    // A title that carries the base amount and a row that ends in a second,
    // labelled amount ("Mechelse Koekoek 44 … inclusief gebakken ganzenlever 54")
    // prints two prices for one dish. Keeping only the row amount invents a
    // different dish; both are kept as variants.
    if (block.titlePrice && priceFromTitle !== true) {
      // The label of the second amount is the printed text of the row it ends:
      // "… inclusief gebakken ganzenlever 54" → "inclusief gebakken ganzenlever".
      const lastLine =
        [...(block.lines || [])].reverse().find((line) => typeof line === 'string' && line.trim() && END_PRICE_PATTERN.test(line.trim())) || ''
      const label = variantLabel(lastLine.trim().replace(/(?:€\s*)?\d{1,3}(?:[.,]\d{1,2})?\s*$/, ''))
      const descriptionText = label && before.trim().endsWith(label) ? before.trim().slice(0, before.trim().length - label.length) : before
      return addItem(section, node, 'formatted_block', {
        name: clip(displayName(name)),
        ...variantItemFields([
          { label: null, amountMinorUnits: block.titlePrice.price.amountMinorUnits },
          { label, amountMinorUnits: price.amountMinorUnits },
        ]),
        description: cleanName(descriptionText) && isPlausibleItemName(cleanName(descriptionText)) ? clip(cleanName(descriptionText)) : null,
      }, { quote: fullText })
    }
    // A second price, a price range or a price variant before the end price.
    // Whole euros count as well ("vier stuks 13 - zes stuks 19,50"): a second
    // amount on the dish's own line is a variant, never part of the price.
    if (findPrices(before).length > 0 || amountsBeforeClause(before).length > 0 || (!priceFromTitle && PRICE_BEFORE_END_PATTERN.test(before))) {
      stats.priceVariantLines += 1
      return reject(fullText, 'ambiguous_structure', node)
    }
    const description = cleanName(before)
    // The quote must show the amount a reviewer has to check. A title-price
    // block keeps its price outside `body`, so it is appended here.
    const quoteText = price && priceText && !fullText.includes(priceText) ? `${fullText} ${priceText}` : fullText
    return addItem(section, node, 'formatted_block', {
      name: clip(displayName(name)),
      priceStatus: 'known',
      amountMinorUnits: price.amountMinorUnits,
      currency: price.hasEuroSign || /€/.test(priceText) ? 'EUR' : null,
      description: description && isPlausibleItemName(description) ? clip(description) : null,
    }, supplementText ? { quote: quoteText, supplementText } : { quote: quoteText })
  }

  function addItem(section, node, pattern, item, evidenceExtra = null) {
    const key = `${JSON.stringify(section.path)}|${item.name.toLowerCase()}|${item.priceStatus}|${item.amountMinorUnits}`
    if (seen.has(key)) {
      stats.duplicatesRemoved += 1
      return undefined
    }
    seen.add(key)
    const evidence = { pattern, locator: locatorOf(node, budget) }
    // A dish read from a subtree the page hides stays traceable, and a dish
    // from a labelled tab panel is a deliberate variant — never a "hidden
    // duplicate view" (K2/K3).
    if (node.hidden === true) evidence.hidden = 'true'
    if (openPanelDepth > 0) evidence.panel = 'tab'
    if (evidenceExtra && typeof evidenceExtra === 'object') {
      for (const [name, value] of Object.entries(evidenceExtra)) {
        if (typeof value === 'string' && value.trim()) evidence[name] = value.trim().slice(0, 200)
      }
    }
    section.items.push({ ...item, evidence })
    if (item.priceStatus === 'multiple_undecomposed') stats.priceVariantItems += 1
    return undefined
  }

  // Document-order walk with an explicit heading stack; bounded depth.
  const headingStack = []
  // Labelled tab panels (`role="tab"` + aria-controls) are menu variants: the
  // label becomes a route level, and their content is never treated as a
  // "hidden duplicate view" (a variant is a deliberate second path).
  const tabPanels = collectTabPanels(root, budget)
  let openPanelDepth = 0
  // Panel labels are siblings even when each panel holds deeper h3 sections,
  // so their level is anchored once (below the surrounding heading), not
  // re-derived from the deepest section of the previous panel.
  let panelLevel = null
  // The first h1 labels the menu document. A CMS often prints a later h1 for
  // just one more section (the live Chocolat "NAGERECHTEN"); that must not pop
  // the menu title out of the route (#59 review 6323277596).
  let documentTitleSeen = false
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
      // Hidden, third-party injected text (a hijacked restaurant site) is
      // never read as menu content. Only a hidden block with at least two
      // distinct spam/injection signals is skipped: a hidden tab panel with
      // real dishes keeps its current, tested behaviour.
      if (child.hidden && child.tag !== '#text') {
        const injected = injectedContentSignals(child, markerCounter, budget)
        if (injected) {
          stats.injectedBlocksSkipped += 1
          continue
        }
      }
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
          let level = panelHeading
            ? (Number(child.attrs && child.attrs['aria-level']) || panelLevel)
            : headingLevel(child)
          // The first h1 is the menu document's own title. A later h1 that
          // introduces one more section ("NAGERECHTEN" after the dinner
          // sections) sits directly below that title instead of replacing it.
          if (!panelHeading && level === 1) {
            if (documentTitleSeen) level = 2
            else documentTitleSeen = true
          }
          // The source's OWN card title — a heading that is exactly the
          // declared name of the region around it — replaces a page title that
          // is printed directly above it ("Welkom bij …" above "Onze kaart").
          // Only at that position (nothing but the page title would survive
          // this heading); a nested region label keeps its place in the route
          // (K2).
          if (
            !panelHeading &&
            level > 1 &&
            headingStack.length > 0 &&
            headingStack[0].level === 1 &&
            headingStack.filter((entry) => entry.level < level).length === 1 &&
            isRegionTitle(child, text)
          ) {
            headingStack.length = 0
            headingStack.push({ level: 1, text })
            continue
          }
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
          if (child.hidden === true) hiddenHeadingPaths.add(JSON.stringify(currentPath()))
        }
        continue
      }
      // A labelled tab panel is a menu variant: its label sits above the
      // sections inside it, and the label is removed again once the panel ends
      // so the next variant starts at the same level (K2).
      const tabLabel = !isHeading(child) && child.attrs && typeof child.attrs.id === 'string' ? tabPanels.get(child.attrs.id) : null
      if (tabLabel) {
        if (!Number.isInteger(panelLevel)) panelLevel = 2
        const level = Number(child.attrs['aria-level']) || panelLevel
        const label = clip(tabLabel)
        if (label) {
          // Restore exactly the route that existed before the panel: the
          // enclosing section heading must survive a variant's own sections.
          const savedDepth = headingStack.length
          headingStack.push({ level, text: label })
          openPanelDepth += 1
          walk(child, depth + 1, extraLabel)
          openPanelDepth -= 1
          headingStack.length = savedDepth
          continue
        }
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
        if (child.multiPriceAnchorLines) {
          stats.priceVariantLines += child.multiPriceAnchorLines
          child.multiPriceAnchorLines = 0
        }
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

  // No menu from non-menu content: when the sections/items this run accepted
  // carry two or more distinct spam/injection signals, the page is not a
  // menu. Nothing is accepted and the caller gets one explicit reason instead
  // of 72 "dishes" from a hijacked block.
  const acceptedSignals = new Set()
  for (const section of sectionsByKey.values()) {
    if (section.items.length === 0) continue
    for (const label of section.path) for (const signal of spamSignals(label)) acceptedSignals.add(signal)
    for (const item of section.items) {
      const evidence = item.evidence && typeof item.evidence === 'object' ? item.evidence : {}
      for (const signal of spamSignals(`${item.name || ''} ${item.description || ''} ${evidence.quote || ''}`)) acceptedSignals.add(signal)
    }
  }
  if (acceptedSignals.size >= 2) {
    stats.workUnits = budget.used
    stats.counted = 0
    stats.contentSuspicion = { reason: 'content_not_menu_suspected', signals: [...acceptedSignals].slice(0, 10) }
    return unparsed('content_not_menu_suspected', rejected, stats)
  }

  // ─── A hidden alternative view of the same card is counted once (K3) ─────
  //
  // A source can print the same card twice: the real (tabbed) view and a
  // legacy/duplicate block that its own CSS hides. Such a hidden section is
  // only dropped when the visible side provably carries the same priced dishes
  // (every amount of the hidden section is still available on the visible
  // side, by count). Hidden content without that counterpart is KEPT — a
  // unique card is never silently dropped — and only counted as a visible
  // limitation. A hidden section from a labelled tab panel is a variant, never
  // a duplicate.
  const isHiddenOnlySection = (section) =>
    section.items.length > 0 &&
    section.items.every((item) => {
      const evidence = item.evidence && typeof item.evidence === 'object' ? item.evidence : {}
      return evidence.hidden === 'true' && evidence.panel !== 'tab'
    })
  const allSections = [...sectionsByKey.values()].filter((section) => section.items.length > 0)
  const visibleAmounts = new Map()
  for (const section of allSections) {
    if (isHiddenOnlySection(section)) continue
    for (const item of section.items) {
      if (Number.isInteger(item.amountMinorUnits)) visibleAmounts.set(item.amountMinorUnits, (visibleAmounts.get(item.amountMinorUnits) || 0) + 1)
    }
  }
  const duplicateHiddenSections = new Set()
  for (const section of allSections) {
    if (!isHiddenOnlySection(section)) continue
    const needed = new Map()
    let verifiable = section.items.length >= 2
    for (const item of section.items) {
      if (!Number.isInteger(item.amountMinorUnits)) {
        verifiable = false
        break
      }
      needed.set(item.amountMinorUnits, (needed.get(item.amountMinorUnits) || 0) + 1)
    }
    const duplicated = verifiable && [...needed].every(([amount, count]) => (visibleAmounts.get(amount) || 0) >= count)
    if (duplicated) {
      duplicateHiddenSections.add(section)
      stats.hiddenViewsMerged += section.items.length
    } else {
      stats.hiddenUniqueItems += section.items.length
    }
  }

  // Unpriced lines are only reported where the same section has priced
  // items — a navigation list never becomes rejected-line noise.
  const sections = []
  for (const section of sectionsByKey.values()) {
    if (duplicateHiddenSections.has(section)) continue
    if (section.items.length === 0) {
      // A recognised heading whose content yielded no dish with a readable
      // price (an arrangement/choice menu, or unreadable price lines) is
      // never silently discarded: the path and the line count are reported.
      const serviceUnit = serviceUnitByPath.get(JSON.stringify(section.path))
      if (hiddenHeadingPaths.has(JSON.stringify(section.path))) continue
      if (section.unpriced.length > 0 && section.path.length > 0) noteExcludedContent(section.path, 'no_recognized_price')
      else if (serviceUnit && section.path.length > 0) noteExcludedContent(section.path, 'service_unit', serviceUnit.lines)
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
  findWholeEuroPrices,
  findPrintedPrices,
  wholeEuroAmountTokens,
  isClockText,
  isDateText,
  displayName,
  decodeEntities,
  isProseHeading,
  extractHtmlMenuStructure,
  createHtmlStructureAdapter,
  spamSignals,
}
