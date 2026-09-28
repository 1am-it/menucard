// BE-20 — pure decision logic for the "Minimal durable analysis-job
// contract" (planning/specs/tickets/be-20-general-restaurant-source-extraction.md),
// implemented by this project's own 0014 migration for the new job table.
// Never touches the database layer, the DOM, or React, and never uses any
// server-only Node hashing primitive — mirrors src/lib/urlIntakes.js's own
// split between pure decision logic and server-only concerns exactly.
//
// Deliberately CommonJS, same reasoning as src/lib/urlIntakes.js.

'use strict'

const ALLOWED_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed']

/** Mirrors the migration's own check constraint exactly — never a wider
 * or narrower set defined independently in application code. */
const ALLOWED_JOB_ERROR_REASONS = [
  'unsafe_url',
  'robots_disallowed',
  'unsupported_content_type',
  'fetch_failed',
  'pdf_extraction_failed',
  'ai_structuring_failed',
  'budget_exceeded',
  'no_reliable_content_found',
  'internal_error',
]

/** Per-adapter error reasons that roll up into one job-level
 * `error_reason` value — never a competing vocabulary, per the ticket's
 * own "Closed, per-adapter error vocabulary" section. Exported so a
 * caller can validate an adapter's own raw outcome before mapping it,
 * without duplicating this list. */
const PDF_ADAPTER_ERROR_REASONS = ['pdf_too_large', 'pdf_encrypted', 'pdf_corrupt', 'pdf_no_text_layer']
const CLAUDE_ADAPTER_ERROR_REASONS = ['schema_violation', 'timeout', 'rate_limited', 'model_unavailable']

/** Every one of PDF_ADAPTER_ERROR_REASONS rolls up to this single
 * job-level reason — folding a finer-grained cause into the coarser,
 * reviewer-facing vocabulary, never surfacing the adapter-level detail
 * itself to a reviewer. */
function rollUpPdfAdapterErrorReason(pdfErrorReason) {
  if (!PDF_ADAPTER_ERROR_REASONS.includes(pdfErrorReason)) {
    throw new Error(`Unknown PDF adapter error reason: ${pdfErrorReason}`)
  }
  return 'pdf_extraction_failed'
}

/** `schema_violation`/`timeout`/`rate_limited`/`model_unavailable` roll up
 * to the job's own terminal `ai_structuring_failed` — reserved
 * exclusively for this case, per the ticket's own explicit instruction
 * that a Claude-adapter *budget* overrun must never be reported this way
 * (see rollUpClaudeAdapterBudgetOverrun below for that separate case).
 *
 * **Not called anywhere in this build today, same as
 * rollUpClaudeAdapterBudgetOverrun below — also a deliberate, documented
 * gap.** src/lib/claudeStructuringAdapter.js's own boundary always
 * resolves `{ enabled: false }` and never performs a real call, so it
 * never produces any of these four error shapes to roll up. Both
 * functions exist, already tested, as the fixed mapping a real future
 * Claude integration would need on day one — building a fake/simulated
 * Claude failure path now, merely to exercise these call sites, would
 * mean pretending an external AI call exists in this build, which it
 * explicitly, deliberately does not. */
function rollUpClaudeAdapterErrorReason(claudeErrorReason) {
  if (!CLAUDE_ADAPTER_ERROR_REASONS.includes(claudeErrorReason)) {
    throw new Error(`Unknown Claude adapter error reason: ${claudeErrorReason}`)
  }
  return 'ai_structuring_failed'
}

/** A Claude-adapter budget overrun rolls up to the job's own existing,
 * separate `budget_exceeded` — the same value any other budget overrun in
 * the job already uses, never a second, competing meaning for
 * `ai_structuring_failed`. Kept as its own named function (rather than a
 * bare string constant) so every call site reads as a deliberate mapping
 * decision, not a magic value. */
function rollUpClaudeAdapterBudgetOverrun() {
  return 'budget_exceeded'
}

const MAX_ATTEMPT_COUNT = 5

/** The fixed status transitions this job lifecycle allows — a job may
 * only ever move forward, never backward, and 'succeeded'/'failed' are
 * both terminal (a fresh, deliberate re-analysis always creates a new
 * job, per the ticket's own "Idempotency" bullet — it never resurrects an
 * old one by transitioning it out of a terminal state). */
const ALLOWED_STATUS_TRANSITIONS = {
  pending: ['running', 'failed'],
  running: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
}

function isValidJobStatus(status) {
  return ALLOWED_JOB_STATUSES.includes(status)
}

function isValidJobErrorReason(errorReason) {
  return ALLOWED_JOB_ERROR_REASONS.includes(errorReason)
}

/** `true` only for a transition this lifecycle actually allows. Throws on
 * an unrecognized `fromStatus`/`toStatus` value — fails closed rather
 * than silently treating an unknown status as "not allowed" the same way
 * a real disallowed transition would look. */
function canTransitionJobStatus(fromStatus, toStatus) {
  if (!isValidJobStatus(fromStatus)) throw new Error(`Unknown job status: ${fromStatus}`)
  if (!isValidJobStatus(toStatus)) throw new Error(`Unknown job status: ${toStatus}`)
  return ALLOWED_STATUS_TRANSITIONS[fromStatus].includes(toStatus)
}

/** `true` when another attempt may still be made — never silent infinite
 * retry, per the ticket's own "Retries" bullet.
 *
 * **Not called anywhere in this build today — a deliberate, documented
 * gap, not an oversight.** This project's own idempotency decision
 * (be-20-general-restaurant-source-extraction.md's own "Idempotency"
 * bullet, restated in app/api/internal/v1/restaurant-analysis-jobs/route.js's
 * own header comment) is explicit that "a fresh, deliberate re-analysis
 * after a terminal `failed` state always creates a genuinely new job,
 * never silently resurrects the old one" — meaning every job this route
 * creates today has exactly one attempt, `attempt_count` never moves off
 * its schema default of `1`, and there is no real call site for this
 * function to guard yet. It exists now, already tested, as the fixed
 * ceiling a future *within-one-job* retry mechanism (e.g. one bounded
 * internal retry of a single flaky sub-step, distinct from today's
 * "start a brand-new job" reviewer-facing retry) would need — building
 * that mechanism now, merely to give this function a caller, would be
 * inventing functionality this checkpoint's own scope does not ask for. */
function canRetryJob(attemptCount) {
  return typeof attemptCount === 'number' && attemptCount < MAX_ATTEMPT_COUNT
}

module.exports = {
  ALLOWED_JOB_STATUSES,
  ALLOWED_JOB_ERROR_REASONS,
  PDF_ADAPTER_ERROR_REASONS,
  CLAUDE_ADAPTER_ERROR_REASONS,
  MAX_ATTEMPT_COUNT,
  ALLOWED_STATUS_TRANSITIONS,
  isValidJobStatus,
  isValidJobErrorReason,
  canTransitionJobStatus,
  canRetryJob,
  rollUpPdfAdapterErrorReason,
  rollUpClaudeAdapterErrorReason,
  rollUpClaudeAdapterBudgetOverrun,
}
