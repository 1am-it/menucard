// BE-20 — explainable, server-side context-conflict detection for
// extracted restaurant fields. Reuses this project's existing, already-
// tested comparers exactly — never a new, invented fuzzy-match
// heuristic: `namesLikelyMatch`/`postcodesLikelyMatch`
// (src/lib/candidateSuggestions.js) and `normalizePhoneNL`/
// `normalizeWebsite` (src/lib/candidateNormalization.js).
//
// A "context conflict" here means: this same analysis found more than one
// materially different value for the same field across different pages
// of the same restaurant's own website (e.g. the homepage states one
// address, a same-host subpage states a different one) — the same,
// self-contained signal the ticket's own motivating example describes
// ("a chain/head-office address surfacing on a location-specific page"),
// detectable here without any external database or AI: a single
// restaurant's own site should state one consistent value per field
// across its own pages.
//
// **Safe by construction, per BE-20's own confidence rule**: when a
// comparison is inconclusive (at least one side has nothing recognizable
// to compare — e.g. a phone number that does not parse), this module
// never asserts a conflict. An unconfirmed conflict simply means the
// field's confidence stays at whatever `deriveFieldConfidence`
// (src/lib/fieldConfidence.js) would otherwise assign without one — at
// most `middel` unless it also has a valid content-hash and passes its
// own plausibility check, never silently promoted to `hoog` merely
// because no conflict happened to be found. A conflict is only ever
// asserted from a genuine, explainable mismatch, never guessed.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

const { normalizePhoneNL, normalizeWebsite } = require('./candidateNormalization')
const { namesLikelyMatch, postcodesLikelyMatch } = require('./candidateSuggestions')
const { normalizeHostname } = require('./restaurantHostMatch')

/** `true`/`false` only when both sides parse as a real Dutch phone number
 * — `null` (inconclusive, never a guessed conflict) otherwise. */
function phonesLikelyMatch(a, b) {
  const na = normalizePhoneNL(a)
  const nb = normalizePhoneNL(b)
  if (!na.valid || !nb.valid) return null
  return na.normalized === nb.normalized
}

/** `true`/`false` only when both sides parse as a real http(s) URL —
 * `null` (inconclusive) otherwise. Compares hostnames only, via the same
 * `normalizeHostname` src/lib/restaurantHostMatch.js already uses for
 * same-host comparison — `normalizeWebsite` itself validates the URL
 * shape but deliberately leaves path/query/fragment untouched, so
 * comparing its own `.normalized` output directly would wrongly flag two
 * pages of the very same site (different paths, same host) as a
 * conflict. */
function websitesLikelyMatch(a, b) {
  const na = normalizeWebsite(a)
  const nb = normalizeWebsite(b)
  if (!na.valid || !nb.valid) return null
  const hostA = normalizeHostname(na.normalized)
  const hostB = normalizeHostname(nb.normalized)
  if (!hostA || !hostB) return null
  return hostA === hostB
}

/** One comparator per allowed field name (src/lib/fieldConfidence.js's own
 * `ALLOWED_FIELD_NAMES`) — each returns `true` (same)/`false` (different)/
 * `null` (inconclusive), never throws on a malformed value. `name` and
 * `category` share `namesLikelyMatch`: both are short, free-text labels
 * where the same substring-inclusive comparison already proven for
 * restaurant names is an honest, conservative fit. */
const FIELD_COMPARATORS = {
  name: namesLikelyMatch,
  category: namesLikelyMatch,
  address: postcodesLikelyMatch,
  phone: phonesLikelyMatch,
  website: websitesLikelyMatch,
}

/**
 * `true` only when at least one of `otherValues` is DEFINITIVELY not the
 * same as `primaryValue` for this field (comparator returns `false`) —
 * never from an inconclusive (`null`) comparison, and `false` for an
 * unrecognized field name or a non-array `otherValues` (fails closed to
 * "no conflict asserted," never throws). `otherValues` is every other
 * value this same analysis found for this field on a different page of
 * the same site; an empty array (the field was only ever found once)
 * always returns `false`.
 */
function detectFieldContextConflict(fieldName, primaryValue, otherValues) {
  const comparator = FIELD_COMPARATORS[fieldName]
  if (typeof comparator !== 'function' || !Array.isArray(otherValues)) return false
  return otherValues.some((otherValue) => comparator(primaryValue, otherValue) === false)
}

module.exports = {
  phonesLikelyMatch,
  websitesLikelyMatch,
  detectFieldContextConflict,
}
