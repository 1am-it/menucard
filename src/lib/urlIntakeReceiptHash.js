// Server-only hash logic for BE-19's url_intake_analysis_receipts
// (analysis_result_hash, supabase/migrations/0013_be19_url_intakes.sql).
// Split out of src/lib/urlIntakes.js the same way
// src/lib/menuSnapshotHash.js was split from
// src/lib/menuSnapshotProposals.js — this one uses `node:crypto` and
// must never be imported from client code or any code path that could
// ship it to the browser. Only server-side route handlers are intended
// callers.
//
// Deliberately CommonJS, same reasoning as src/lib/menuSnapshotHash.js.

'use strict'

const crypto = require('node:crypto')

/**
 * Recursively sorts every object's own keys (arrays keep their existing
 * order) so two independently constructed but semantically identical
 * analysis payloads always serialize identically — the exact same
 * reasoning src/lib/menuSnapshotHash.js's own `canonicalize` already
 * applies one layer up, deliberately duplicated here rather than shared,
 * matching this project's existing precedent for small, purpose-specific
 * helpers.
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort()
    const result = {}
    for (const key of sortedKeys) {
      result[key] = canonicalize(value[key])
    }
    return result
  }
  return value
}

/**
 * The migration's own `analysis_result_hash` column requires exactly
 * this shape (64 lowercase hex characters) — hex-encoded SHA-256 of the
 * canonical JSON form of the receipt's full binding: actor, canonical
 * URL, restaurant match type/candidate, and the bounded candidate
 * summary. Always recomputed here, server-side, from the actual values
 * being written/re-checked — a caller must never be able to supply its
 * own hash, or the hash could silently drift from what it claims to
 * describe. Recomputed identically at redemption time
 * (create_url_intake_from_receipt) as the integrity self-check.
 */
function computeAnalysisResultHash({ actorUserId, canonicalSourceUrl, restaurantMatchType, matchedRestaurantId, candidateSummary }) {
  const canonicalJson = JSON.stringify(
    canonicalize({
      actorUserId,
      canonicalSourceUrl,
      restaurantMatchType,
      matchedRestaurantId: matchedRestaurantId || null,
      candidateSummary,
    })
  )
  return crypto.createHash('sha256').update(canonicalJson).digest('hex')
}

module.exports = {
  computeAnalysisResultHash,
}
