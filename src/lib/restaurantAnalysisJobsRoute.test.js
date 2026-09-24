'use strict'

// Structural safety net for
// app/api/internal/v1/restaurant-analysis-jobs/route.js and its
// [id]/route.js status-poll sibling — read directly from their actual
// source, exactly like this project's existing structural tests for
// every other BE-17/18/19 route (see src/lib/urlIntakesRoute.test.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const POST_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/restaurant-analysis-jobs/route.js')
const GET_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/restaurant-analysis-jobs/[id]/route.js')

function readPostRouteSource() {
  return fs.readFileSync(POST_ROUTE_PATH, 'utf8')
}
function readGetRouteSource() {
  return fs.readFileSync(GET_ROUTE_PATH, 'utf8')
}

// ─── POST /api/internal/v1/restaurant-analysis-jobs ────────────────────────

test('structural safety net: the restaurant-analysis-jobs POST route authenticates and requires isInternalOnly before doing anything else', () => {
  const source = readPostRouteSource()
  assert.match(source, /authenticateInternalRequest\(request\)/)
  assert.match(source, /if \(!auth\.ok\)/)
  assert.match(source, /isInternalOnly\(auth\.roles\)/)
});

test('structural safety net: only ever fetches via safeOutboundFetch — no second HTTP client, no bare fetch() to an arbitrary URL', () => {
  const source = readPostRouteSource()
  assert.match(source, /import \{ fetchWebsiteSafely \} from ['"]@\/src\/lib\/safeOutboundFetch['"]/)
  assert.doesNotMatch(source, /require\(['"]node:https?['"]\)/)
  assert.doesNotMatch(source, /axios/)
})

test('structural safety net: every non-robots.txt fetch uses encoding: "buffer" — the entry/candidate content may be a PDF, never assumed to be text', () => {
  const source = readPostRouteSource()
  const bufferFetchCount = (source.match(/encoding: 'buffer'/g) || []).length
  assert.ok(bufferFetchCount >= 2, 'expected at least the entry fetch and the candidate fetch to both request encoding: "buffer"')
})

test('structural safety net: the entry URL is gated by classifyRobotsGate before the page itself is ever fetched', () => {
  const source = readPostRouteSource()
  assert.match(source, /classifyRobotsGate\(/)
  assert.match(source, /robotsGate\.shouldFetchPage/)
})

test('structural safety net: never accepts a restaurant field, match type, or analysis hash from the client body — only body.url is ever read', () => {
  const source = readPostRouteSource()
  assert.doesNotMatch(source, /body\.restaurant_match_type/)
  assert.doesNotMatch(source, /body\.matched_restaurant_id/)
  assert.doesNotMatch(source, /body\.candidate_summary/)
  assert.doesNotMatch(source, /body\.analysis_result_hash/)
  assert.doesNotMatch(source, /body\.field_evidence/)
})

test('structural safety net: reuses buildCandidateSummary and computeAnalysisResultHash unchanged — never builds its own candidate_summary shape or hash', () => {
  const source = readPostRouteSource()
  assert.match(source, /import \{ canonicalizeSourceUrl, buildCandidateSummary, computeReceiptExpiry \} from ['"]@\/src\/lib\/urlIntakes['"]/)
  assert.match(source, /import \{ computeAnalysisResultHash \} from ['"]@\/src\/lib\/urlIntakeReceiptHash['"]/)
})

test('structural safety net: only ever writes to restaurant_source_analysis_jobs, url_intake_analysis_receipts, or reads markets — never url_intakes, restaurant_profile_drafts, or menu_snapshot_proposals directly', () => {
  const source = readPostRouteSource()
  const fromCalls = [...source.matchAll(/\.from\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(fromCalls)].sort(), ['markets', 'restaurant_source_analysis_jobs', 'url_intake_analysis_receipts'])
})

test('structural safety net: a succeeded job transition always sets result_receipt_id alongside status "succeeded" — matches the migration\'s own biconditional', () => {
  const source = readPostRouteSource()
  const succeededUpdateMatch = source.match(/updateJobSucceeded[\s\S]*?transitionJob\(jobId, fromStatuses, 'succeeded', \{[\s\S]*?result_receipt_id: receiptId/)
  assert.ok(succeededUpdateMatch, 'expected the succeeded-path transition to set both status and result_receipt_id together')
})

test('structural safety net: every respondFailed call site passes one of the closed job-level error reasons — never a bare status without one', () => {
  const source = readPostRouteSource()
  const failedCallSites = [...source.matchAll(/respondFailed\(jobId, \[[^\]]*\], '([^']+)'/g)].map((m) => m[1])
  assert.ok(failedCallSites.length >= 5, 'expected multiple distinct failure call sites')
  const closedErrorReasons = [
    'unsafe_url', 'robots_disallowed', 'unsupported_content_type', 'fetch_failed',
    'pdf_extraction_failed', 'ai_structuring_failed', 'budget_exceeded',
    'no_reliable_content_found', 'internal_error',
  ]
  for (const reason of failedCallSites) {
    assert.ok(closedErrorReasons.includes(reason), `${reason} must be one of the closed job-level error reasons`)
  }
})

test('structural safety net: every job-status transition is validated through the shared, tested restaurantSourceAnalysisJobs module — never a raw, unvalidated write', () => {
  const source = readPostRouteSource()
  assert.match(
    source,
    /import \{\s*isValidJobStatus,\s*isValidJobErrorReason,\s*canTransitionJobStatus,\s*rollUpPdfAdapterErrorReason,?\s*\} from ['"]@\/src\/lib\/restaurantSourceAnalysisJobs['"]/
  )
  assert.match(source, /isValidJobStatus\(toStatus\)/)
  assert.match(source, /canTransitionJobStatus\(fromStatus, toStatus\)/)
  assert.match(source, /isValidJobErrorReason\(extraFields\.error_reason\)/)
})

test('structural safety net: every job-status write is a compare-and-swap guarded by the job\'s expected current status — never an unconditional update', () => {
  const source = readPostRouteSource()
  const transitionFnMatch = source.match(/async function transitionJob[\s\S]*?\n}/)
  assert.ok(transitionFnMatch, 'expected to find transitionJob')
  const fnBody = transitionFnMatch[0]
  assert.match(fnBody, /\.in\('status', fromStatuses\)/, 'the update must only match rows whose current status is one of the expected source statuses')
  assert.match(fnBody, /\.select\('id'\)/, 'the update must select back the affected row to confirm it was actually changed')
  assert.match(fnBody, /if \(error \|\| !data \|\| data\.length === 0\) return false/, 'zero affected rows must be treated as an unconfirmed transition, not a silent success')
})

test('structural safety net: respondFailed never claims job.status "failed" in its response unless updateJobFailed actually confirmed the write', () => {
  const source = readPostRouteSource()
  const fnStart = source.indexOf('async function respondFailed')
  const fnBody = source.slice(fnStart, source.indexOf('\n}', fnStart))
  assert.match(fnBody, /const confirmed = await updateJobFailed\(/)
  assert.match(fnBody, /if \(confirmed\)/)
  // The non-confirmed branch must return a response with no `job` key at all.
  const elseReturnMatch = fnBody.match(/return NextResponse\.json\(\{ error: message \}, \{ status: httpStatus \}\)/)
  assert.ok(elseReturnMatch, 'expected the unconfirmed-failure branch to return a plain error with no job status claim')
})

test('structural safety net: a receipt-issued-but-job-update-failed outcome never falsely reports success — updateJobSucceeded\'s own confirmation is checked before the success response', () => {
  const source = readPostRouteSource()
  assert.match(source, /const succeededConfirmed = await updateJobSucceeded\(/)
  assert.match(source, /if \(!succeededConfirmed\)/)
})

test('structural safety net: the entire running-phase of the analysis is wrapped in a catch-all that marks the job failed rather than leaking a raw exception', () => {
  const source = readPostRouteSource()
  assert.match(source, /const runningConfirmed = await updateJobRunning\(jobId\)/)
  assert.match(source, /if \(!runningConfirmed\)/)
  // The try block that starts right after the running-transition is
  // confirmed must have a matching catch that calls respondFailed with
  // 'internal_error' — never a bare rethrow.
  const tryStart = source.indexOf('try {', source.indexOf('runningConfirmed'))
  const lastCatchIndex = source.lastIndexOf('} catch {')
  assert.ok(tryStart !== -1 && lastCatchIndex > tryStart, 'expected a try block after the running transition with a trailing catch-all')
  const catchBody = source.slice(lastCatchIndex, source.indexOf('\n}', lastCatchIndex))
  assert.match(catchBody, /respondFailed\(jobId, \['running'\], 'internal_error'/)
})

test('structural safety net: the entry-URL-is-PDF path never re-throws a non-PdfExtractionError — every failure there rolls up to a closed reason', () => {
  const source = readPostRouteSource()
  assert.doesNotMatch(source, /if \(!\(err instanceof PdfExtractionError\)\) throw err/)
})

test('structural safety net: no raw PDF text excerpt is ever assembled into the entry-URL-is-PDF result — only a derived word count', () => {
  const source = readPostRouteSource()
  assert.doesNotMatch(source, /textPreview/)
  assert.match(source, /wordCount: countWords\(pdfResult\.text\)/)
})

test('structural safety net: a PDF closed error is rolled up via rollUpPdfAdapterErrorReason, never passed through as a raw adapter reason', () => {
  const source = readPostRouteSource()
  assert.match(source, /rollUpPdfAdapterErrorReason\(err\.reason\)/)
})

test('structural safety net: no internal error detail (a caught error object) is ever serialized into a response', () => {
  const source = readPostRouteSource()
  assert.doesNotMatch(source, /NextResponse\.json\(\{[^}]*err(?:or)?\.(message|stack)/)
})

test('structural safety net: no OCR, screenshot, image-rendering, or browser-automation dependency', () => {
  const source = readPostRouteSource()
  assert.doesNotMatch(source, /tesseract|puppeteer|playwright|browserless|canvas|screenshot/i)
})

// ─── GET /api/internal/v1/restaurant-analysis-jobs/[id] ────────────────────

test('structural safety net: the restaurant-analysis-jobs [id] route authenticates, requires isInternalOnly, and exposes GET only', () => {
  const source = readGetRouteSource()
  assert.match(source, /authenticateInternalRequest\(request\)/)
  assert.match(source, /isInternalOnly\(auth\.roles\)/)
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/)
})

test('structural safety net: the [id] route scopes its query to the requesting account\'s own jobs only', () => {
  const source = readGetRouteSource()
  assert.match(source, /\.eq\('actor_user_id', auth\.userId\)/)
})

test('structural safety net: the [id] route never returns field_evidence for a job that has not succeeded', () => {
  const source = readGetRouteSource()
  assert.match(source, /job\.status === 'succeeded' \? job\.field_evidence : null/)
})

test('structural safety net: the [id] route never writes — read-only, matching a status-poll endpoint\'s own contract', () => {
  const source = readGetRouteSource()
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
})
