// BE-20 — deterministic restaurant-field extraction WITH per-field
// source evidence (the raw fragment a value came from), so the caller
// can compute a content-hash and confidence tier per field.
//
// Deliberately a **separate module** from `src/lib/candidateSuggestions.js`,
// never a modification of it — that file's own `extractFromJsonLd`/
// `parseContactSuggestionsFromHtml` have an existing, tested guarantee
// ("never reads menu/price/image fields") that must never be put at risk
// by a second caller needing a different output shape. This mirrors the
// exact reasoning `src/lib/menuJsonLdExtraction.js`'s own header already
// gives for being a deliberately independent copy rather than a shared
// import. The scanning pattern (JSON-LD script tags, `tel:`/`<address>`
// fallback) is intentionally the same proven strategy, re-implemented
// here only because this caller additionally needs the raw source
// fragment each value came from — `candidateSuggestions.js` itself never
// needed that and is not changed to provide it.
//
// Never fetches anything — the caller supplies already-fetched HTML via
// this project's existing, unchanged SSRF-hardened fetch helper. Never
// touches Supabase, the DOM, or any server-only Node hashing primitive —
// content-hash computation itself lives in the separate
// `src/lib/fieldEvidenceHash.js`.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

const { composeAddressFromSchemaOrg } = require('./candidateSuggestions')

const JSON_LD_SCRIPT_PATTERN = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

/** Same relevant schema.org business types `candidateSuggestions.js`'s
 * own `RELEVANT_SCHEMA_TYPES` already uses — kept in sync deliberately,
 * not a subtly different copy. */
const RELEVANT_SCHEMA_TYPES = ['restaurant', 'foodestablishment', 'localbusiness', 'organization', 'cafeorcoffeeshop', 'bar']

function schemaTypeMatches(typeValue) {
  const types = Array.isArray(typeValue) ? typeValue : [typeValue]
  return types.some((t) => typeof t === 'string' && RELEVANT_SCHEMA_TYPES.includes(t.toLowerCase()))
}

function findRelevantSchemaNode(parsedJsonLd) {
  const candidates = []
  if (Array.isArray(parsedJsonLd)) {
    candidates.push(...parsedJsonLd)
  } else if (parsedJsonLd && typeof parsedJsonLd === 'object') {
    candidates.push(parsedJsonLd)
    if (Array.isArray(parsedJsonLd['@graph'])) candidates.push(...parsedJsonLd['@graph'])
  }
  return candidates.find((node) => node && typeof node === 'object' && schemaTypeMatches(node['@type'])) || null
}

/**
 * `{ name, category, address, phone, website }` (each `null` if absent)
 * plus `rawSourceFragment` — the exact raw text of the `<script
 * type="application/ld+json">` block the relevant node was found in, so
 * the caller can compute a content-hash over precisely that evidence.
 * The first block containing a relevant node wins, exactly matching
 * `candidateSuggestions.js`'s own "first relevant node found wins" rule.
 * Returns `null` when no relevant JSON-LD node exists anywhere on the
 * page — never guessed at.
 */
function extractFieldsFromJsonLdWithEvidence(html) {
  if (typeof html !== 'string') return null
  for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
    let parsed
    try {
      parsed = JSON.parse(match[1])
    } catch (err) {
      continue // malformed block — skip it, never guess at its content
    }
    const node = findRelevantSchemaNode(parsed)
    if (!node) continue
    return {
      name: typeof node.name === 'string' && node.name.trim() ? node.name.trim() : null,
      category: Array.isArray(node['@type']) ? node['@type'][0] : typeof node['@type'] === 'string' ? node['@type'] : null,
      address: composeAddressFromSchemaOrg(node.address),
      phone: typeof node.telephone === 'string' && node.telephone.trim() ? node.telephone.trim() : null,
      website: typeof node.url === 'string' && node.url.trim() ? node.url.trim() : null,
      rawSourceFragment: match[0],
    }
  }
  return null
}

const TEL_LINK_PATTERN = /<a[^>]+href\s*=\s*["']tel:([^"']+)["'][^>]*>[\s\S]*?<\/a>/i
const ADDRESS_TAG_PATTERN = /<address[^>]*>[\s\S]*?<\/address>/i

function stripHtmlTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `{ address, phone }` (each `{ value, rawSourceFragment }` or `null`)
 * from explicit `tel:` links / `<address>` tags only — never a general
 * text scrape, exactly matching `candidateSuggestions.js`'s own fallback
 * scope. `rawSourceFragment` here is the exact matched HTML element
 * (e.g. the whole `<address>...</address>` tag), not the whole page.
 */
function extractFieldsFromFallbackMarkupWithEvidence(html) {
  if (typeof html !== 'string') return { address: null, phone: null }
  const telMatch = html.match(TEL_LINK_PATTERN)
  const addressMatch = html.match(ADDRESS_TAG_PATTERN)
  return {
    phone: telMatch ? { value: telMatch[1].trim(), rawSourceFragment: telMatch[0] } : null,
    address: addressMatch ? { value: stripHtmlTags(addressMatch[0]), rawSourceFragment: addressMatch[0] } : null,
  }
}

/**
 * The one entry point. Returns one entry per populated field:
 * `{ [fieldName]: { value, extractionMethod: 'json_ld' | 'html',
 * rawSourceFragment } }` — a field with no reliable value from either
 * tier is simply absent from the result, never present with a guessed or
 * empty-string value. JSON-LD is preferred per field; the HTML fallback
 * only fills a field JSON-LD itself left empty — mirroring
 * `candidateSuggestions.js`'s own "JSON-LD first, narrow fallback"
 * strategy, applied per field here rather than as one all-or-nothing
 * choice, since a real page may have JSON-LD `name`/`address` but no
 * `telephone`, with a `tel:` link elsewhere covering that specific gap.
 */
function extractRestaurantFieldsWithEvidence(html) {
  const jsonLd = extractFieldsFromJsonLdWithEvidence(html)
  const fallback = extractFieldsFromFallbackMarkupWithEvidence(html)

  const result = {}

  if (jsonLd) {
    for (const fieldName of ['name', 'category', 'address', 'phone', 'website']) {
      const value = jsonLd[fieldName]
      if (typeof value === 'string' && value.trim().length > 0) {
        result[fieldName] = { value, extractionMethod: 'json_ld', rawSourceFragment: jsonLd.rawSourceFragment }
      }
    }
  }

  for (const fieldName of ['address', 'phone']) {
    if (result[fieldName]) continue // JSON-LD already covered this field
    const fallbackField = fallback[fieldName]
    if (fallbackField) {
      result[fieldName] = { value: fallbackField.value, extractionMethod: 'html', rawSourceFragment: fallbackField.rawSourceFragment }
    }
  }

  return result
}

module.exports = {
  extractFieldsFromJsonLdWithEvidence,
  extractFieldsFromFallbackMarkupWithEvidence,
  extractRestaurantFieldsWithEvidence,
}
