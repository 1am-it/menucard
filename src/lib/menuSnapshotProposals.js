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
const { isValidHttpUrl } = require('./importInbox')

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

// Fixed sets only — never free text. Mirrors
// supabase/migrations/0011_be17_menu_snapshot_foundation.sql's own check
// constraints exactly; these are a UX/clarity guard only, never the
// authoritative check (the migration's own constraints are, regardless
// of what any caller sends).
const ALLOWED_SOURCE_TYPES = ['own_website', 'pdf', 'manual']
const ALLOWED_QUALITY_SCORES = ['low', 'medium', 'high']
const ALLOWED_DECISIONS = ['needs_review', 'approved_internal', 'rejected', 'deferred']
const ALLOWED_REJECTION_REASONS = ['source_unreliable', 'content_mismatch', 'duplicate_snapshot', 'insufficient_content', 'other']
const MAX_NOTE_LENGTH = 2000

// Mirrors the migration's own `menu_context ~ '^[^-]+-[a-z]+$'` check —
// the existing `{restaurantId}-{mealType}` shape data/menus.json already
// uses (e.g. "23-borrel"), never a new addressing scheme.
const MENU_CONTEXT_PATTERN = /^[^-]+-[a-z]+$/

function isValidMenuContext(value) {
  return typeof value === 'string' && MENU_CONTEXT_PATTERN.test(value)
}

/**
 * Validates one new-snapshot request body before it is ever inserted.
 * `restaurantId` is intentionally accepted as any non-empty string —
 * this project's restaurant identity lives in data/restaurants.json, not
 * a database table, so there is no foreign key or lookup to validate
 * against here (mirrors menu_snapshot_proposals.restaurant_id's own
 * design). `capturedContent` must already be a parsed JSON value (an
 * object or array), never a raw string a caller merely claims is JSON —
 * parsing/rejecting malformed JSON is the route's own responsibility
 * before this function ever runs.
 */
function validateSnapshotProposalInput({ restaurantId, menuContext, sourceUrl, sourceType, qualityScore, capturedContent }) {
  if (typeof restaurantId !== 'string' || restaurantId.trim().length === 0) {
    return { valid: false, reason: 'invalid-restaurant-id' }
  }
  if (!isValidMenuContext(menuContext)) {
    return { valid: false, reason: 'invalid-menu-context' }
  }
  if (!isValidHttpUrl(sourceUrl)) {
    return { valid: false, reason: 'invalid-source-url' }
  }
  if (!ALLOWED_SOURCE_TYPES.includes(sourceType)) {
    return { valid: false, reason: 'invalid-source-type' }
  }
  if (!ALLOWED_QUALITY_SCORES.includes(qualityScore)) {
    return { valid: false, reason: 'invalid-quality-score' }
  }
  if (capturedContent === null || capturedContent === undefined || typeof capturedContent !== 'object') {
    return { valid: false, reason: 'invalid-captured-content' }
  }

  return {
    valid: true,
    restaurantId: restaurantId.trim(),
    menuContext,
    sourceUrl: sourceUrl.trim(),
    sourceType,
    qualityScore,
    capturedContent,
  }
}

function snapshotProposalValidationMessage(reason) {
  if (reason === 'invalid-restaurant-id') return 'restaurant_id is required.'
  if (reason === 'invalid-menu-context') return 'menu_context must look like "{restaurantId}-{mealtype}", e.g. "23-borrel".'
  if (reason === 'invalid-source-url') return 'source_url must be a valid http(s) URL.'
  if (reason === 'invalid-source-type') return `source_type must be one of: ${ALLOWED_SOURCE_TYPES.join(', ')}.`
  if (reason === 'invalid-quality-score') return `quality_score must be one of: ${ALLOWED_QUALITY_SCORES.join(', ')}.`
  if (reason === 'invalid-captured-content') return 'captured_content must be a JSON object or array.'
  return 'Invalid request.'
}

/**
 * Validates one new review-decision request body — the same symmetric
 * "reason required exactly when rejected" rule as
 * menu_snapshot_reviews_check in the migration, and the same shape as
 * src/lib/importInbox.js's own validateReviewDecisionInput.
 */
function validateSnapshotReviewInput({ decision, reason, note }) {
  if (!ALLOWED_DECISIONS.includes(decision)) {
    return { valid: false, reason: 'invalid-decision' }
  }

  const needsReason = decision === 'rejected'
  const hasReason = typeof reason === 'string' && reason.length > 0
  if (needsReason && !hasReason) {
    return { valid: false, reason: 'missing-reason' }
  }
  if (!needsReason && hasReason) {
    return { valid: false, reason: 'reason-not-allowed' }
  }
  if (hasReason && !ALLOWED_REJECTION_REASONS.includes(reason)) {
    return { valid: false, reason: 'invalid-reason' }
  }

  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') {
      return { valid: false, reason: 'invalid-note' }
    }
    if (note.length > MAX_NOTE_LENGTH) {
      return { valid: false, reason: 'note-too-long' }
    }
  }

  return {
    valid: true,
    decision,
    reason: hasReason ? reason : null,
    note: note || null,
  }
}

function snapshotReviewValidationMessage(reason) {
  if (reason === 'invalid-decision') return `decision must be one of: ${ALLOWED_DECISIONS.join(', ')}.`
  if (reason === 'missing-reason') return 'A reason is required when decision is "rejected".'
  if (reason === 'reason-not-allowed') return 'A reason is only allowed when decision is "rejected".'
  if (reason === 'invalid-reason') return `reason must be one of: ${ALLOWED_REJECTION_REASONS.join(', ')}.`
  if (reason === 'invalid-note') return 'note must be a string.'
  if (reason === 'note-too-long') return `note must be at most ${MAX_NOTE_LENGTH} characters.`
  return 'Invalid request.'
}

/**
 * Groups an unordered list of review rows (as a single, un-filtered
 * `menu_snapshot_reviews` query covering many snapshots would return) by
 * `snapshot_id`, for O(1) lookup per snapshot when listing many
 * snapshots at once — never one query per snapshot. Pure; never touches
 * Supabase. Mirrors
 * src/lib/importInbox.js's buildReviewStatusByCandidateId shape.
 */
function groupReviewsBySnapshotId(reviewRows) {
  const bySnapshotId = {}
  for (const row of reviewRows || []) {
    if (!row || row.snapshot_id === undefined || row.snapshot_id === null) continue
    const key = String(row.snapshot_id)
    if (!bySnapshotId[key]) bySnapshotId[key] = []
    bySnapshotId[key].push(row)
  }
  return bySnapshotId
}

module.exports = {
  computeCanonicalContentHash,
  DEFAULT_SNAPSHOT_STATUS,
  pickLatestSnapshotReviewRow,
  deriveEffectiveSnapshotStatus,
  ALLOWED_SOURCE_TYPES,
  ALLOWED_QUALITY_SCORES,
  ALLOWED_DECISIONS,
  ALLOWED_REJECTION_REASONS,
  MAX_NOTE_LENGTH,
  isValidMenuContext,
  validateSnapshotProposalInput,
  snapshotProposalValidationMessage,
  validateSnapshotReviewInput,
  snapshotReviewValidationMessage,
  groupReviewsBySnapshotId,
}
