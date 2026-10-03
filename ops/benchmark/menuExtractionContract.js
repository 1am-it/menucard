// BE-22 — the one shared output contract for menu-structure extraction in
// the offline benchmark: the deterministic `html_structure` adapter today,
// and a future model-assisted (`ai_structured`) adapter later — measured
// against exactly the same shape, never a second one.
//
// What this contract deliberately does NOT contain: `confidence`,
// `reviewReady`, or any other self-assessment. Trust is never claimed by an
// adapter (see adapters.js's own `assertNeverCarriesPrecomputedConfidence`,
// which also checks menu items) and nothing here creates a concept,
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
  'clock_time', // opening hours, time ranges
  'service_unit', // per person, per table, arrangements, packages, courses
  'modifier', // "+ extra …", supplements
  'missing_name', // a price with no name in the same local structure
  'missing_price', // a name with no price (and no explicit on-request phrase)
  'non_menu_section', // under an opening-hours/contact/reviews/reservation/arrangement heading
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

function hasForbiddenTrustKey(object) {
  return Boolean(object) && typeof object === 'object' && FORBIDDEN_TRUST_KEYS.some((key) => Object.prototype.hasOwnProperty.call(object, key))
}

/**
 * Validates one menu extraction result against this contract. Returns an
 * array of problem strings — empty when valid. Never throws.
 */
function validateMenuExtraction(result) {
  const problems = []
  if (!result || typeof result !== 'object') return ['result is not an object']
  if (hasForbiddenTrustKey(result)) problems.push('result carries confidence/reviewReady — forbidden')
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
    if (hasForbiddenTrustKey(section)) problems.push(`sections[${s}] carries confidence/reviewReady`)
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
      if (hasForbiddenTrustKey(item)) problems.push(`${where} carries confidence/reviewReady`)
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
    if (!REJECTION_REASONS.includes(line.reason)) problems.push(`rejected[${r}].reason must be one of ${REJECTION_REASONS.join(', ')}`)
    if (!isBoundedString(line.text)) problems.push(`rejected[${r}].text must be a short non-empty string`)
  })

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
  emptyCost,
  validateMenuExtraction,
}
