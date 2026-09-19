// Pure logic for BE-17's menu snapshot proposal foundation
// (menu_snapshot_proposals/menu_snapshot_reviews,
// supabase/migrations/0011_be17_menu_snapshot_foundation.sql). No route,
// RPC, or UI exists against these tables yet — this module only computes
// the two things application code will eventually need before writing or
// reading a row: a deterministic content hash, and the effective review
// status derived from a snapshot's review history. See
// planning/specs/tickets/be-17-menu-proposal-snapshot-foundation.md.
//
// Deliberately CommonJS, same reasoning as src/lib/importInbox.js —
// directly testable via this project's existing `node --test` tooling,
// no new dependency.
//
// This module never touches Supabase, the filesystem, or the network —
// it only takes an already-fetched value/rows and returns a hash or a
// derived status.

const crypto = require('node:crypto')

/**
 * Recursively sorts every object's own keys (arrays keep their existing
 * order — a snapshot's dish order is meaningful content, not something
 * to normalize away) so that two independently constructed but
 * semantically identical `captured_content` values always serialize to
 * the exact same string, regardless of the key order either producer
 * happened to build them in. This is what makes
 * computeCanonicalContentHash deterministic across two independent
 * captures of unchanged content.
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
 * The migration's own `content_hash` column requires exactly this shape
 * (64 lowercase hex characters) — hex-encoded SHA-256 of the canonical
 * JSON form of `content`. Always recomputed here, server-side, from the
 * actual `captured_content` being written — a caller must never be able
 * to supply its own hash, or the hash could silently drift from what it
 * claims to describe.
 */
function computeCanonicalContentHash(content) {
  const canonicalJson = JSON.stringify(canonicalize(content))
  return crypto.createHash('sha256').update(canonicalJson).digest('hex')
}

/**
 * Picks the single latest row from one snapshot's full review
 * history — the row with the latest `decided_at`, tie-broken by the
 * higher `id` (review rows are inserted with a monotonically increasing
 * `bigint identity` id, so this is a safe, deterministic tie-break for
 * two decisions recorded within the same timestamp resolution). Returns
 * `null` given no rows — never throws, never guesses from partial or
 * malformed input. Mirrors
 * src/lib/importInbox.js's pickLatestReviewRow exactly, for
 * menu_snapshot_reviews rows instead of import_candidate_reviews rows.
 */
function pickLatestSnapshotReviewRow(reviewRows) {
  if (!Array.isArray(reviewRows) || reviewRows.length === 0) {
    return null
  }
  let latest = null
  for (const row of reviewRows) {
    if (!row || !row.decided_at) continue
    if (!latest) {
      latest = row
      continue
    }
    const latestTime = new Date(latest.decided_at).getTime()
    const rowTime = new Date(row.decided_at).getTime()
    if (rowTime > latestTime || (rowTime === latestTime && Number(row.id) > Number(latest.id))) {
      latest = row
    }
  }
  return latest
}

// No review row exists yet for a brand-new snapshot — this is a pure
// application-level default, never itself stored on any row (storing it
// would be indistinguishable from storing nothing, and would need
// special-casing everywhere "latest row wins" logic runs). Mirrors
// src/lib/importInbox.js's own DEFAULT_REVIEW_STATUS reasoning exactly.
const DEFAULT_SNAPSHOT_STATUS = 'unreviewed'

/**
 * Picks the effective status for one snapshot from its full review
 * history — see pickLatestSnapshotReviewRow for the tie-break rule.
 * Returns DEFAULT_SNAPSHOT_STATUS when given no rows. This is the only
 * place a snapshot's "current status" is ever computed — no column on
 * menu_snapshot_proposals or menu_snapshot_reviews stores it directly.
 */
function deriveEffectiveSnapshotStatus(reviewRows) {
  const latest = pickLatestSnapshotReviewRow(reviewRows)
  return latest ? latest.decision : DEFAULT_SNAPSHOT_STATUS
}

module.exports = {
  computeCanonicalContentHash,
  DEFAULT_SNAPSHOT_STATUS,
  pickLatestSnapshotReviewRow,
  deriveEffectiveSnapshotStatus,
}
