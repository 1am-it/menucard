// BE-20 — server-only content-hash logic for per-field source evidence.
// Computes a hex-encoded SHA-256 over the exact raw source fragment a
// field's value was derived from (e.g. the specific JSON-LD block, or
// the specific HTML substring an address/phone was read from) — never a
// hash of the *value* itself, and never the fragment stored durably
// (matches `docs/api/url-intake-schema.md`'s own data-minimisation
// stance: this hash is a pointer for audit/dispute purposes, not a
// second copy of the source).
//
// Split out from `src/lib/fieldConfidence.js` for the same reason
// `src/lib/menuSnapshotHash.js` was split from
// `src/lib/menuSnapshotProposals.js`, and `src/lib/urlIntakeReceiptHash.js`
// from `src/lib/urlIntakes.js`: this module uses `node:crypto` and must
// never be imported from client ('use client') code — only server-side
// route handlers are intended callers. `fieldConfidence.js` itself stays
// free of any server-only Node builtin so it can be imported safely from
// a client component if a future UI ever needs the same confidence rule
// client-side (e.g. to render a badge).
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

const crypto = require('node:crypto')

/**
 * Hex-encoded SHA-256 (64 lowercase hex characters, matching this
 * project's existing hash-column convention, e.g.
 * `menu_snapshot_proposals.content_hash`,
 * `url_intake_analysis_receipts.analysis_result_hash`) of the exact raw
 * source fragment string passed in. Returns `null` for anything that
 * isn't a non-empty string — never guesses a hash for missing evidence,
 * since "no evidence" and "evidence hashed as empty string" must never
 * be indistinguishable.
 */
function computeFieldEvidenceHash(rawSourceFragment) {
  if (typeof rawSourceFragment !== 'string' || rawSourceFragment.length === 0) return null
  return crypto.createHash('sha256').update(rawSourceFragment).digest('hex')
}

module.exports = {
  computeFieldEvidenceHash,
}
