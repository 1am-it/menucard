'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const {
  extractFieldsFromJsonLdWithEvidence,
  extractFieldsFromFallbackMarkupWithEvidence,
  extractRestaurantFieldsWithEvidence,
} = require('./restaurantFieldEvidence')

function jsonLdScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`
}

// ─── extractFieldsFromJsonLdWithEvidence ─────────────────────────────────

test('extractFieldsFromJsonLdWithEvidence: extracts fields and the exact raw script-tag fragment', () => {
  const node = {
    '@type': 'Restaurant',
    name: 'De Botanist Breda',
    telephone: '076 3032490',
    url: 'https://debotanistbreda.nl',
    address: { streetAddress: 'Tolbrugstraat 19', postalCode: '4811 WN', addressLocality: 'Breda' },
  }
  const html = `<html><head>${jsonLdScript(node)}</head></html>`
  const result = extractFieldsFromJsonLdWithEvidence(html)
  assert.equal(result.name, 'De Botanist Breda')
  assert.equal(result.phone, '076 3032490')
  assert.equal(result.website, 'https://debotanistbreda.nl')
  assert.equal(result.address, 'Tolbrugstraat 19, 4811 WN Breda')
  assert.equal(result.rawSourceFragment, jsonLdScript(node))
})

test('extractFieldsFromJsonLdWithEvidence: returns null when no relevant schema.org node exists', () => {
  const html = jsonLdScript({ '@type': 'Article', name: 'Een blogpost' })
  assert.equal(extractFieldsFromJsonLdWithEvidence(html), null)
})

test('extractFieldsFromJsonLdWithEvidence: skips a malformed JSON-LD block rather than throwing', () => {
  const html = '<script type="application/ld+json">{ not valid json </script>' + jsonLdScript({ '@type': 'Restaurant', name: 'OK' })
  const result = extractFieldsFromJsonLdWithEvidence(html)
  assert.equal(result.name, 'OK')
})

test('extractFieldsFromJsonLdWithEvidence: resolves a relevant node inside @graph', () => {
  const html = jsonLdScript({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'LocalBusiness', name: 'Bobbi\'s Bar' }] })
  const result = extractFieldsFromJsonLdWithEvidence(html)
  assert.equal(result.name, "Bobbi's Bar")
})

test('extractFieldsFromJsonLdWithEvidence: returns null given no HTML at all', () => {
  assert.equal(extractFieldsFromJsonLdWithEvidence(''), null)
  assert.equal(extractFieldsFromJsonLdWithEvidence(null), null)
})

// ─── extractFieldsFromFallbackMarkupWithEvidence ─────────────────────────

test('extractFieldsFromFallbackMarkupWithEvidence: finds a tel: link and its own raw fragment', () => {
  const html = '<a href="tel:+31763032490">Bel ons</a>'
  const result = extractFieldsFromFallbackMarkupWithEvidence(html)
  assert.equal(result.phone.value, '+31763032490')
  assert.equal(result.phone.rawSourceFragment, html)
})

test('extractFieldsFromFallbackMarkupWithEvidence: finds an <address> tag and its own raw fragment', () => {
  const html = '<address>Tolbrugstraat 19, 4811 WN Breda</address>'
  const result = extractFieldsFromFallbackMarkupWithEvidence(html)
  assert.equal(result.address.value, 'Tolbrugstraat 19, 4811 WN Breda')
  assert.equal(result.address.rawSourceFragment, html)
})

test('extractFieldsFromFallbackMarkupWithEvidence: both null when neither exists', () => {
  const result = extractFieldsFromFallbackMarkupWithEvidence('<p>Welkom</p>')
  assert.deepEqual(result, { phone: null, address: null })
})

// ─── extractRestaurantFieldsWithEvidence (the combined entry point) ──────

test('extractRestaurantFieldsWithEvidence: JSON-LD fields are labeled extraction_method json_ld', () => {
  const html = jsonLdScript({ '@type': 'Restaurant', name: 'De Botanist Breda' })
  const result = extractRestaurantFieldsWithEvidence(html)
  assert.equal(result.name.value, 'De Botanist Breda')
  assert.equal(result.name.extractionMethod, 'json_ld')
  assert.ok(result.name.rawSourceFragment.includes('De Botanist Breda'))
});

test('extractRestaurantFieldsWithEvidence: HTML fallback fills a field JSON-LD itself left empty, labeled html', () => {
  const html = jsonLdScript({ '@type': 'Restaurant', name: 'Bobbi\'s Bar' }) + '<a href="tel:+31612345678">Bel</a>'
  const result = extractRestaurantFieldsWithEvidence(html)
  assert.equal(result.name.extractionMethod, 'json_ld')
  assert.equal(result.phone.value, '+31612345678')
  assert.equal(result.phone.extractionMethod, 'html')
})

test('extractRestaurantFieldsWithEvidence: JSON-LD wins over the HTML fallback when both are present for the same field', () => {
  const html = jsonLdScript({ '@type': 'Restaurant', telephone: '076 3032490' }) + '<a href="tel:+31600000000">Bel</a>'
  const result = extractRestaurantFieldsWithEvidence(html)
  assert.equal(result.phone.value, '076 3032490')
  assert.equal(result.phone.extractionMethod, 'json_ld')
})

test('extractRestaurantFieldsWithEvidence: returns {} when nothing reliable is found anywhere — never guessed at', () => {
  const result = extractRestaurantFieldsWithEvidence('<p>Welkom op onze website</p>')
  assert.deepEqual(result, {})
})

test('extractRestaurantFieldsWithEvidence: a field absent from both tiers is simply absent from the result, never present as null/empty', () => {
  // `category` is populated too here, derived from the node's own
  // `@type` — a real, present signal, not a guess. Only `address`,
  // `phone`, and `website` are genuinely absent from this fixture.
  const html = jsonLdScript({ '@type': 'Restaurant', name: 'Alleen een naam' })
  const result = extractRestaurantFieldsWithEvidence(html)
  assert.deepEqual(Object.keys(result).sort(), ['category', 'name'])
  assert.equal(result.address, undefined)
  assert.equal(result.phone, undefined)
  assert.equal(result.website, undefined)
})

// ─── Structural safety net ───────────────────────────────────────────────

test('structural safety net: never reads menu, price, or image fields from a JSON-LD node, even when present on the same node', () => {
  const source = fs.readFileSync(require.resolve('./restaurantFieldEvidence.js'), 'utf8')
  assert.doesNotMatch(source, /\.menu\b|hasMenu|priceRange|\.image\b/)
})

test('structural safety net: never fetches anything itself — no import of safeOutboundFetch or any HTTP client', () => {
  const source = fs.readFileSync(require.resolve('./restaurantFieldEvidence.js'), 'utf8')
  assert.doesNotMatch(source, /safeOutboundFetch|node:http|node:https/)
})
