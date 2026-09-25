// BE-20 — explainable, server-side context-validation status for
// extracted restaurant fields. Reuses this project's existing, already-
// tested comparers exactly — never a new, invented fuzzy-match
// heuristic: `namesLikelyMatch`/`postcodesLikelyMatch`
// (src/lib/candidateSuggestions.js) and `normalizePhoneNL`/
// `normalizeWebsite` (src/lib/candidateNormalization.js).
//
// A field's context status here means: has this same analysis actively
// compared this field's value against another independent sighting of
// the same field on a different page of the same site — and if so, did
// they agree? Three outcomes, never a boolean:
//   - `'consistent'` — actively compared against at least one other
//     sighting, and every comparison that could be made agreed (e.g. the
//     homepage states one Dutch postcode, a same-host subpage restates
//     the same one).
//   - `'conflict'` — actively compared, and at least one other sighting
//     genuinely disagreed (e.g. a chain/head-office address surfacing on
//     a location-specific page — the ticket's own motivating example).
//   - `'unverified'` — no comparable second sighting exists at all (no
//     same-host candidate was found or fetched, a candidate was blocked
//     or failed, or a candidate simply did not happen to restate this
//     field), or every comparison attempted was inconclusive (neither
//     side parsed into a comparable shape). **This is not the same as
//     `'consistent'` and must never be treated as such.**
//
// **Corrected 2026-09-24, following an independent review.** This module
// previously exported a boolean `detectFieldContextConflict`, which
// returned `false` both when a field was genuinely compared and found
// consistent, AND when there was nothing to compare against at all —
// silently conflating "positively validated" with "never validated."
// Since `otherValues` is empty in the common case (same-host discovery
// often finds no candidates, or a found candidate simply doesn't restate
// a given field), that boolean made `hoog` reachable from content-hash +
// plausibility alone far more often than BE-20's own confidence rule
// intends. `checkFieldContextStatus` below replaces it with an explicit
// third `'unverified'` outcome, which src/lib/fieldConfidence.js's own
// `deriveFieldConfidence` now treats the same way as "not yet validated"
// (capped at `middel`), never as a green light for `hoog`.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

const { normalizePhoneNL, normalizeWebsite } = require('./candidateNormalization')
const { namesLikelyMatch, postcodesLikelyMatch } = require('./candidateSuggestions')
const { normalizeHostname } = require('./restaurantHostMatch')

/** `true`/`false` only when both sides parse as a real Dutch phone number
 * — `null` (inconclusive, never a guessed match or conflict) otherwise. */
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
 * The one entry point. Returns `'consistent'` | `'conflict'` |
 * `'unverified'` — never a boolean, and never guesses `'consistent'`
 * from the mere absence of a disagreement.
 *
 * - An unrecognized `fieldName`, a non-array `otherValues`, or an empty
 *   `otherValues` array (the field was only ever found once) all return
 *   `'unverified'` — there is nothing to have validated against.
 * - If ANY comparison against `otherValues` comes back `false` (a
 *   genuine, explainable mismatch), this returns `'conflict'`
 *   immediately — a single confirmed disagreement outweighs any number
 *   of confirmed agreements, since a chain/head-office page mixed in
 *   among otherwise-consistent pages is exactly the risk this check
 *   exists to catch.
 * - Otherwise, `'consistent'` only if at least one comparison came back
 *   `true` (a genuine, explainable agreement) — if every comparison was
 *   inconclusive (`null`, e.g. an unparsable value on the other page),
 *   this returns `'unverified'`, never `'consistent'`: an inconclusive
 *   comparison is not a validation.
 */
function checkFieldContextStatus(fieldName, primaryValue, otherValues) {
  const comparator = FIELD_COMPARATORS[fieldName]
  if (typeof comparator !== 'function' || !Array.isArray(otherValues) || otherValues.length === 0) {
    return 'unverified'
  }

  let sawConfirmedMatch = false
  for (const otherValue of otherValues) {
    const result = comparator(primaryValue, otherValue)
    if (result === false) return 'conflict'
    if (result === true) sawConfirmedMatch = true
  }
  return sawConfirmedMatch ? 'consistent' : 'unverified'
}

module.exports = {
  phonesLikelyMatch,
  websitesLikelyMatch,
  checkFieldContextStatus,
}
