// BE-20 — composes the reviewable `Korte omschrijving` (short description)
// for a restaurant concept, built only from demonstrable source evidence —
// never generic marketing copy invented to fill the field. Stays empty
// when the source provides insufficient evidence, per this ticket's own
// "Visual contract" section.
//
// Deliberately a plain string composer, not a template engine or a call
// to any AI adapter — the description is only ever assembled from field
// values this same analysis already extracted and validated
// (src/lib/fieldConfidence.js), never phrased or embellished by a model.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

/** A small, closed mapping from a schema.org `@type` to a plain Dutch
 * noun — used only to phrase a factual sentence, never to invent a
 * category the source did not itself provide. An unrecognized `@type`
 * falls back to the generic, honest `horecazaak` rather than guessing at
 * a more specific word the evidence does not support. */
const CATEGORY_LABELS_NL = {
  restaurant: 'restaurant',
  foodestablishment: 'eetgelegenheid',
  cafeorcoffeeshop: 'café',
  bar: 'bar',
  localbusiness: 'horecazaak',
  organization: 'horecazaak',
}

function categoryLabel(category) {
  if (typeof category !== 'string') return null
  return CATEGORY_LABELS_NL[category.toLowerCase()] || 'horecazaak'
}

/** `address` here is always the already-composed
 * `"street, postcode locality"` shape src/lib/candidateSuggestions.js's
 * own `composeAddressFromSchemaOrg` produces — extracts only the
 * locality (the free text after the Dutch postcode), never the street or
 * postcode itself, and only when that exact shape is actually present.
 * Never geocodes, never guesses a city from a differently-shaped string. */
const NL_POSTCODE_THEN_LOCALITY_PATTERN = /\b\d{4}\s*[A-Za-z]{2}\s+(.+)$/

function extractCityFromComposedAddress(address) {
  if (typeof address !== 'string') return null
  const match = address.match(NL_POSTCODE_THEN_LOCALITY_PATTERN)
  return match ? match[1].trim() || null : null
}

/**
 * `{ name, category, address }` — each either a plain string value
 * (already confirmed review-ready by the caller — see
 * `isFieldReviewReady` in src/lib/fieldConfidence.js) or `null`/absent,
 * meaning that field's own evidence was not strong enough to build a
 * sentence from.
 *
 * Returns a plain factual Dutch sentence when at least `name` and
 * `category` are both present, optionally extended with the city parsed
 * out of `address` when that is present too; returns `''` (never `null`,
 * never a placeholder) when there is insufficient evidence to say
 * anything factual at all.
 */
function composeEvidenceBasedDescription({ name, category, address } = {}) {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  const label = categoryLabel(category)
  if (!trimmedName || !label) return ''

  const city = extractCityFromComposedAddress(address)
  if (city) {
    return `${trimmedName} is een ${label} in ${city}.`
  }
  return `${trimmedName} is een ${label}.`
}

module.exports = {
  CATEGORY_LABELS_NL,
  extractCityFromComposedAddress,
  composeEvidenceBasedDescription,
}
