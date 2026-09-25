'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const {
  ALLOWED_JOB_STATUSES,
  ALLOWED_JOB_ERROR_REASONS,
  PDF_ADAPTER_ERROR_REASONS,
  CLAUDE_ADAPTER_ERROR_REASONS,
  MAX_ATTEMPT_COUNT,
  isValidJobStatus,
  isValidJobErrorReason,
  canTransitionJobStatus,
  canRetryJob,
  rollUpPdfAdapterErrorReason,
  rollUpClaudeAdapterErrorReason,
  rollUpClaudeAdapterBudgetOverrun,
} = require('./restaurantSourceAnalysisJobs')

test('ALLOWED_JOB_STATUSES: the fixed, closed four-value set', () => {
  assert.deepEqual([...ALLOWED_JOB_STATUSES].sort(), ['failed', 'pending', 'running', 'succeeded'])
})

test('ALLOWED_JOB_ERROR_REASONS: the fixed, closed nine-value set from the ticket', () => {
  assert.deepEqual(
    [...ALLOWED_JOB_ERROR_REASONS].sort(),
    [
      'ai_structuring_failed', 'budget_exceeded', 'fetch_failed', 'internal_error',
      'no_reliable_content_found', 'pdf_extraction_failed', 'robots_disallowed',
      'unsafe_url', 'unsupported_content_type',
    ]
  )
})

test('isValidJobStatus / isValidJobErrorReason: accept only their own fixed vocabulary', () => {
  assert.equal(isValidJobStatus('pending'), true)
  assert.equal(isValidJobStatus('queued'), false)
  assert.equal(isValidJobErrorReason('budget_exceeded'), true)
  assert.equal(isValidJobErrorReason('some_new_reason'), false)
})

test('canTransitionJobStatus: pending may move to running or failed, never directly to succeeded', () => {
  assert.equal(canTransitionJobStatus('pending', 'running'), true)
  assert.equal(canTransitionJobStatus('pending', 'failed'), true)
  assert.equal(canTransitionJobStatus('pending', 'succeeded'), false)
})

test('canTransitionJobStatus: running may move to succeeded or failed, never back to pending', () => {
  assert.equal(canTransitionJobStatus('running', 'succeeded'), true)
  assert.equal(canTransitionJobStatus('running', 'failed'), true)
  assert.equal(canTransitionJobStatus('running', 'pending'), false)
})

test('canTransitionJobStatus: succeeded and failed are both terminal — no further transition is ever allowed', () => {
  for (const terminal of ['succeeded', 'failed']) {
    for (const target of ALLOWED_JOB_STATUSES) {
      assert.equal(canTransitionJobStatus(terminal, target), false, `${terminal} -> ${target} must be disallowed`)
    }
  }
})

test('canTransitionJobStatus: throws on an unknown status rather than silently reporting "not allowed"', () => {
  assert.throws(() => canTransitionJobStatus('pending', 'archived'), /Unknown job status/)
  assert.throws(() => canTransitionJobStatus('archived', 'pending'), /Unknown job status/)
})

test('canRetryJob: true below MAX_ATTEMPT_COUNT, false at or above it — never silent infinite retry', () => {
  assert.equal(canRetryJob(1), true)
  assert.equal(canRetryJob(MAX_ATTEMPT_COUNT - 1), true)
  assert.equal(canRetryJob(MAX_ATTEMPT_COUNT), false)
  assert.equal(canRetryJob(MAX_ATTEMPT_COUNT + 1), false)
})

test('canRetryJob: false for a non-numeric attempt count — fails closed', () => {
  assert.equal(canRetryJob('3'), false)
  assert.equal(canRetryJob(undefined), false)
  assert.equal(canRetryJob(null), false)
})

test('rollUpPdfAdapterErrorReason: every PDF adapter reason rolls up to the single job-level pdf_extraction_failed', () => {
  for (const reason of PDF_ADAPTER_ERROR_REASONS) {
    assert.equal(rollUpPdfAdapterErrorReason(reason), 'pdf_extraction_failed')
  }
})

test('rollUpPdfAdapterErrorReason: throws on a reason outside the closed PDF adapter vocabulary', () => {
  assert.throws(() => rollUpPdfAdapterErrorReason('pdf_wrong_password'), /Unknown PDF adapter error reason/)
})

test('rollUpClaudeAdapterErrorReason: every Claude adapter reason rolls up to the single, terminal ai_structuring_failed', () => {
  for (const reason of CLAUDE_ADAPTER_ERROR_REASONS) {
    assert.equal(rollUpClaudeAdapterErrorReason(reason), 'ai_structuring_failed')
  }
})

test('rollUpClaudeAdapterErrorReason: throws on a reason outside the closed Claude adapter vocabulary', () => {
  assert.throws(() => rollUpClaudeAdapterErrorReason('overloaded'), /Unknown Claude adapter error reason/)
})

test('rollUpClaudeAdapterBudgetOverrun: rolls up to budget_exceeded, never ai_structuring_failed — a deliberately separate mapping', () => {
  assert.equal(rollUpClaudeAdapterBudgetOverrun(), 'budget_exceeded')
})

test('the job-level and per-adapter error vocabularies never overlap in the wrong direction: no per-adapter reason is itself a valid job-level reason', () => {
  for (const reason of [...PDF_ADAPTER_ERROR_REASONS, ...CLAUDE_ADAPTER_ERROR_REASONS]) {
    assert.equal(isValidJobErrorReason(reason), false, `${reason} must not itself be a job-level error_reason`)
  }
})

// ─── Structural safety net ────────────────────────────────────────────────

test('structural safety net: never touches Supabase, the DOM, or any server-only Node hashing primitive', () => {
  const source = fs.readFileSync(require.resolve('./restaurantSourceAnalysisJobs.js'), 'utf8')
  assert.doesNotMatch(source, /node:crypto|supabase/i)
  assert.doesNotMatch(source, /document\.|window\./)
})

test('structural safety net: the migration defines exactly the same status and error_reason vocabularies as this module', () => {
  const migrationSource = fs.readFileSync(
    require.resolve('../../supabase/migrations/0014_be20_restaurant_source_analysis_jobs.sql'),
    'utf8'
  )
  for (const status of ALLOWED_JOB_STATUSES) {
    assert.ok(migrationSource.includes(`'${status}'`), `migration must mention status '${status}'`)
  }
  for (const reason of ALLOWED_JOB_ERROR_REASONS) {
    assert.ok(migrationSource.includes(`'${reason}'`), `migration must mention error_reason '${reason}'`)
  }
})

test('structural safety net: both new tables carry a market_id column referencing markets(id), matching every other market-bound record in this project', () => {
  const migrationSource = fs.readFileSync(
    require.resolve('../../supabase/migrations/0014_be20_restaurant_source_analysis_jobs.sql'),
    'utf8'
  )
  const marketIdMatches = [...migrationSource.matchAll(/market_id\s+uuid not null references markets\(id\)/g)]
  assert.equal(marketIdMatches.length, 2, 'expected url_intake_batches and restaurant_source_analysis_jobs to each declare market_id')
})

test('structural safety net: field_evidence\'s "null until succeeded" invariant is enforced by an actual CHECK constraint, not only a comment', () => {
  const migrationSource = fs.readFileSync(
    require.resolve('../../supabase/migrations/0014_be20_restaurant_source_analysis_jobs.sql'),
    'utf8'
  )
  assert.match(migrationSource, /check \(\(status = 'succeeded'\) = \(field_evidence is not null\)\)/)
})
