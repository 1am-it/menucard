// BE-22 — the one shared output contract for menu-structure extraction in
// the offline benchmark: the deterministic `html_structure` adapter today,
// and a future model-assisted (`ai_structured`) adapter later — measured
// against exactly the same shape, never a second one.
//
// What this contract deliberately does NOT contain: `confidence`,
// `reviewReady`, or any other self-assessment. Trust is never claimed by an
// adapter: `findForbiddenTrustKey` below rejects those keys at ANY depth, and
// adapters.js's own `assertNeverCarriesPrecomputedConfidence` applies the
// same recursive scan to every adapter result. Nothing here creates a concept,
// proposal, review or publication. Money follows MARKET-02's four states
// (`docs/api/canonical-restaurant-menu-schema.md` §4a).
//
// Cost fields exist so a later, separately authorized AI trial reports cost
// in the same place; in this environment they are always `null` — no
// provider, key, SDK or paid service is configured or called.
//
// Isolated tooling, never imported by product code — see manifest.js's own
// header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const MENU_EXTRACTION_CONTRACT_VERSION = 1

/** The menu-track adapter kinds. `ai_structured` is the same kind name the
 * existing adapter contract (adapters.js `ADAPTER_KINDS`) already reserves
 * for the deliberately unavailable model-assisted stub. */
const MENU_ADAPTER_KINDS = ['html_structure', 'ai_structured']

const MENU_EXTRACTION_STATUSES = ['parsed', 'unparsed']

/** MARKET-02 `Money.pricing_status` — never a fifth, invented state. */
const PRICE_STATUSES = ['known', 'multiple_undecomposed', 'on_request', 'unknown']

/** Why a line was not counted as a dish or drink — a closed vocabulary. */
const REJECTION_REASONS = [
  'clock_time', // opening hours, time ranges, a clock time in clear time context ("vanaf 12.00")
  'date', // a date in clear date/event context ("Fictief feest 24.12", "15 mei")
  'service_unit', // per person, per table, arrangements, packages, courses
  'modifier', // "+ extra …", supplements
  'missing_name', // a price with no name in the same local structure
  'missing_price', // a name with no price (and no explicit on-request phrase)
  'non_menu_section', // under an opening-hours/contact/reviews/reservation/arrangement/voucher/… heading
  'ambiguous_structure', // several name+price pairs in one element, or an oversized element with a price
]

/** The evidence patterns the deterministic adapter may cite. A model
 * adapter would cite `model_quote` with a short source locator instead. */
const EVIDENCE_PATTERNS = ['list_item', 'table_row', 'definition', 'repeated_card', 'model_quote']

const FORBIDDEN_TRUST_KEYS = ['confidence', 'reviewReady']

/** Bounds on what a result may carry, so a result can never grow without
 * limit or smuggle bulk source text. */
const MAX_SECTIONS = 100
const MAX_ITEMS = 1000
const MAX_REJECTED = 200
const MAX_TEXT = 160

/** Empty cost record — every field `null` until a separately authorized
 * provider exists; never a fabricated figure. */
function emptyCost() {
  return { costEurCents: null, inputTokens: null, outputTokens: null }
}

function isBoundedString(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT
}

/** Bounds on the recursive trust-key scan, so a deep, huge or cyclic
 * structure can never hang or crash it — exceeding one is itself a
 * violation (fail closed). */
const TRUST_SCAN_MAX_DEPTH = 64
const TRUST_SCAN_MAX_NODES = 100000
const TRUST_SCAN_MAX_ENTRIES = 1000000

/**
 * Accepts only plain, JSON-safe data — and within it, no `confidence` or
 * `reviewReady` key at ANY depth (evidence, rejected lines, stats, cost,
 * notes, `_internal`, arrays, anything). Returns `null` when clean,
 * otherwise a short description of the first violation. Never throws.
 *
 * Strict by design, so "no trust key anywhere" is technically true rather
 * than true-for-enumerable-keys-only:
 *   - every own key is inspected (`Reflect.ownKeys`): non-enumerable keys,
 *     symbol keys and accessor properties (getters/setters) are violations,
 *     and a getter is never invoked;
 *   - only plain objects (prototype `Object.prototype` or `null`) and arrays
 *     are allowed, so an inherited trust key on a custom prototype is a
 *     violation too; functions, symbols and bigints are not JSON values;
 *   - a cycle, more than TRUST_SCAN_MAX_DEPTH levels, more than
 *     TRUST_SCAN_MAX_NODES objects or TRUST_SCAN_MAX_ENTRIES keys, or a
 *     structure that throws while being inspected (e.g. a Proxy) is a
 *     violation rather than traversed.
 */
function findForbiddenTrustKey(value) {
  let visitedNodes = 0
  let visitedEntries = 0
  const onPath = new Set()
  function visit(node, path, depth) {
    const type = typeof node
    if (type === 'function' || type === 'symbol' || type === 'bigint') return `non-JSON value (${type}) at ${path}`
    if (node === null || type !== 'object') return null
    if (onPath.has(node)) return `cyclic structure at ${path}`
    if (depth > TRUST_SCAN_MAX_DEPTH) return `structure deeper than ${TRUST_SCAN_MAX_DEPTH} levels at ${path}`
    visitedNodes += 1
    if (visitedNodes > TRUST_SCAN_MAX_NODES) return `more than ${TRUST_SCAN_MAX_NODES} nested objects`
    const isArray = Array.isArray(node)
    const proto = Object.getPrototypeOf(node)
    if (!(isArray ? proto === Array.prototype : proto === Object.prototype || proto === null)) return `unexpected prototype (not plain data) at ${path}`
    onPath.add(node)
    try {
      for (const key of Reflect.ownKeys(node)) {
        visitedEntries += 1
        if (visitedEntries > TRUST_SCAN_MAX_ENTRIES) return `more than ${TRUST_SCAN_MAX_ENTRIES} keys`
        if (isArray && key === 'length') continue
        if (typeof key === 'symbol') return `symbol key at ${path}`
        const childPath = isArray ? `${path}[${key}]` : `${path}.${key}`
        if (FORBIDDEN_TRUST_KEYS.includes(key)) return `${childPath} is forbidden`
        const descriptor = Object.getOwnPropertyDescriptor(node, key)
        if (!descriptor) continue
        if (descriptor.get || descriptor.set) return `accessor property at ${childPath}`
        if (!descriptor.enumerable) return `non-enumerable property at ${childPath}`
        const found = visit(descriptor.value, childPath, depth + 1)
        if (found) return found
      }
    } finally {
      onPath.delete(node)
    }
    return null
  }
  try {
    return visit(value, '$', 0)
  } catch (err) {
    // Proxies or exotic objects that throw — never trusted, never a crash.
    return 'structure could not be inspected'
  }
}

/**
 * Validates one menu extraction result against this contract. Returns an
 * array of problem strings — empty when valid. Never throws.
 */
function validateMenuExtraction(result) {
  const problems = []
  if (!result || typeof result !== 'object') return ['result is not an object']
  const trustViolation = findForbiddenTrustKey(result)
  if (trustViolation) return [`confidence/reviewReady (or an uninspectable structure) is forbidden at any depth: ${trustViolation}`]
  if (result.contractVersion !== MENU_EXTRACTION_CONTRACT_VERSION) problems.push(`contractVersion must be ${MENU_EXTRACTION_CONTRACT_VERSION}`)
  if (!MENU_EXTRACTION_STATUSES.includes(result.status)) problems.push(`status must be one of ${MENU_EXTRACTION_STATUSES.join(', ')}`)
  if (result.status === 'unparsed' && !isBoundedString(result.reason)) problems.push('an unparsed result needs a reason')
  if (!Array.isArray(result.sections)) problems.push('sections must be an array')
  if (!Array.isArray(result.rejected)) problems.push('rejected must be an array')
  if (problems.length > 0) return problems

  if (result.sections.length > MAX_SECTIONS) problems.push(`more than ${MAX_SECTIONS} sections`)
  if (result.rejected.length > MAX_REJECTED) problems.push(`more than ${MAX_REJECTED} rejected lines`)
  if (result.status === 'unparsed' && result.sections.length > 0) problems.push('an unparsed result carries no sections')

  let itemCount = 0
  result.sections.forEach((section, s) => {
    if (!section || typeof section !== 'object') {
      problems.push(`sections[${s}] must be an object`)
      return
    }
    if (!Array.isArray(section.path) || !section.path.every((label) => label === null || isBoundedString(label))) {
      problems.push(`sections[${s}].path must be an array of short labels (or null for an unlabelled block)`)
    }
    if (!Array.isArray(section.items) || section.items.length === 0) {
      problems.push(`sections[${s}].items must be a non-empty array`)
      return
    }
    section.items.forEach((item, i) => {
      itemCount += 1
      const where = `sections[${s}].items[${i}]`
      if (!item || typeof item !== 'object') {
        problems.push(`${where} must be an object`)
        return
      }
      if (!isBoundedString(item.name)) problems.push(`${where}.name must be a short non-empty string`)
      if (!PRICE_STATUSES.includes(item.priceStatus)) problems.push(`${where}.priceStatus must be one of ${PRICE_STATUSES.join(', ')}`)
      const known = item.priceStatus === 'known'
      if (known && !(Number.isInteger(item.amountMinorUnits) && item.amountMinorUnits >= 0)) {
        problems.push(`${where}: a known price needs a non-negative integer amountMinorUnits`)
      }
      if (!known && item.amountMinorUnits !== null) problems.push(`${where}: amountMinorUnits must be null unless priceStatus is known`)
      if (item.currency !== null && item.currency !== 'EUR') problems.push(`${where}.currency must be null or EUR`)
      if (!known && item.currency !== null) problems.push(`${where}: currency must be null unless priceStatus is known`)
      if (item.description !== null && !isBoundedString(item.description)) problems.push(`${where}.description must be null or a short string`)
      if (!item.evidence || !EVIDENCE_PATTERNS.includes(item.evidence.pattern) || !isBoundedString(item.evidence.locator)) {
        problems.push(`${where}.evidence needs a known pattern and a short locator`)
      }
    })
  })
  if (itemCount > MAX_ITEMS) problems.push(`more than ${MAX_ITEMS} items`)

  result.rejected.forEach((line, r) => {
    if (!line || typeof line !== 'object') {
      problems.push(`rejected[${r}] must be an object`)
      return
    }
    if (!REJECTION_REASONS.includes(line.reason)) problems.push(`rejected[${r}].reason must be one of ${REJECTION_REASONS.join(', ')}`)
    if (!isBoundedString(line.text)) problems.push(`rejected[${r}].text must be a short non-empty string`)
    // The same locator rule as an item's evidence: short and non-empty.
    if (!isBoundedString(line.locator)) problems.push(`rejected[${r}].locator must be a short non-empty string`)
  })

  // stats is optional; when present, a flat object of counters/flags only.
  if (result.stats !== undefined) {
    const stats = result.stats
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      problems.push('stats must be an object when present')
    } else {
      for (const [key, value] of Object.entries(stats)) {
        if (!(typeof value === 'boolean' || (Number.isInteger(value) && value >= 0))) problems.push(`stats.${key} must be a non-negative integer or a boolean`)
      }
    }
  }

  const cost = result.cost
  if (!cost || typeof cost !== 'object') {
    problems.push('cost must be present (all null when no provider is used)')
  } else {
    for (const key of ['costEurCents', 'inputTokens', 'outputTokens']) {
      if (cost[key] !== null && !(Number.isInteger(cost[key]) && cost[key] >= 0)) problems.push(`cost.${key} must be null or a non-negative integer`)
    }
  }
  return problems
}

module.exports = {
  MENU_EXTRACTION_CONTRACT_VERSION,
  MENU_ADAPTER_KINDS,
  MENU_EXTRACTION_STATUSES,
  PRICE_STATUSES,
  REJECTION_REASONS,
  EVIDENCE_PATTERNS,
  MAX_SECTIONS,
  MAX_ITEMS,
  MAX_REJECTED,
  MAX_TEXT,
  TRUST_SCAN_MAX_DEPTH,
  TRUST_SCAN_MAX_NODES,
  TRUST_SCAN_MAX_ENTRIES,
  emptyCost,
  findForbiddenTrustKey,
  validateMenuExtraction,
}
