// BE-21 — the benchmark score model. Reuses BE-20's own contracts
// exactly: `ALLOWED_FIELD_NAMES`/`deriveFieldConfidence` from
// `src/lib/fieldConfidence.js` (confidence is ALWAYS re-derived here from
// an adapter's raw evidence inputs, never trusted from the adapter — see
// `adapters.js`'s own header for why), and `normalizePhoneNL`/
// `normalizeWebsite` from `src/lib/candidateNormalization.js` for
// field-value comparison. Never a second, competing confidence/evidence
// model.
//
// Isolated tooling, never imported by product code — see manifest.js's
// own header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const { ALLOWED_FIELD_NAMES, deriveFieldConfidence } = require('../../src/lib/fieldConfidence')
const { normalizePhoneNL, normalizeWebsite } = require('../../src/lib/candidateNormalization')

/** The only per-field accuracy outcomes this model produces — a closed
 * set, never a free-text verdict:
 *  - `match`: expected a value, extractor found the same value.
 *  - `mismatch`: expected a value, extractor found a DIFFERENT value.
 *  - `missing`: expected a value, extractor found nothing.
 *  - `correctly_absent`: expected nothing, extractor found nothing.
 *  - `unexpected_extra`: expected nothing, extractor found a value
 *    anyway — this model's proxy for be-21's own "false-positive rate."
 */
const ALLOWED_ACCURACY_CLASSES = ['match', 'mismatch', 'missing', 'correctly_absent', 'unexpected_extra']

/** The only per-case status values a scored case can carry. A pending
 * real source is never silently scored as if it were a fixture — it is
 * always, explicitly `skipped_pending_real_fetch`. `not_evaluated` is
 * `runner.js`'s own status for a deliberately unavailable adapter
 * (`ai_structured`/`ocr` today) — never blended into ordinary
 * accuracy/miss statistics, since "not evaluated" and "evaluated and
 * wrong" are different findings this model must never conflate. */
const ALLOWED_CASE_STATUSES = ['scored', 'skipped_pending_real_fetch', 'not_evaluated']

/** Normalizes one field's value for equality comparison only — never for
 * storage or display. Reuses BE-20's own normalizers for phone/website
 * (the same shape/plausibility rules `src/lib/fieldConfidence.js`'s own
 * `checkFieldPlausibility` already relies on); name/category/address
 * compare on trimmed, case-insensitive text — this benchmark never
 * invents a second, looser or stricter text-matching heuristic than
 * what BE-20's own `src/lib/candidateSuggestions.js` comparators already
 * embody for context-status checking. */
function normalizeForComparison(fieldName, value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (fieldName === 'phone') {
    const n = normalizePhoneNL(trimmed)
    return n.valid ? n.normalized : trimmed.toLowerCase()
  }
  if (fieldName === 'website') {
    const n = normalizeWebsite(trimmed)
    return n.valid ? n.normalized : trimmed.toLowerCase()
  }
  return trimmed.toLowerCase()
}

/**
 * Classifies one field's accuracy. `expected`/`actual` are the raw
 * ground-truth/extracted values (or `null`/`undefined` for "not
 * expected"/"not extracted") — never pre-normalized by the caller.
 */
function scoreFieldAccuracy(expected, actual) {
  const hasExpected = typeof expected === 'string' && expected.trim().length > 0
  const hasActual = typeof actual === 'string' && actual.trim().length > 0
  if (!hasExpected && !hasActual) return 'correctly_absent'
  if (!hasExpected && hasActual) return 'unexpected_extra'
  if (hasExpected && !hasActual) return 'missing'
  return 'match' // exact comparison happens in scoreCase, which knows fieldName for normalization
}

/**
 * Scores one manifest entry against one adapter's result.
 *
 * A `real_benchmark_evidence_pending` entry is NEVER scored — this
 * function returns `{ status: 'skipped_pending_real_fetch', ... }`
 * immediately, before looking at `adapterResult` at all, since no real
 * fetch has ever happened for it in this environment.
 *
 * For every other entry, every one of BE-20's five canonical fields is
 * scored — including a field the manifest's own `groundTruth` never
 * mentions, which means "expected: absent" (see this file's own
 * `resolveExpectedFieldValue`). Confidence is ALWAYS re-derived here via
 * BE-20's own unmodified `deriveFieldConfidence`, from the adapter's raw
 * evidence inputs — an adapter's own opinion of its confidence, if it
 * had one, is structurally impossible to reach this function at all
 * (see `adapters.js`).
 */
function resolveExpectedFieldValue(groundTruth, fieldName) {
  if (!groundTruth || typeof groundTruth !== 'object') return null
  const value = groundTruth[fieldName]
  return typeof value === 'string' ? value : null
}

function scoreCase(manifestEntry, adapterResult, { timingMs = null } = {}) {
  if (manifestEntry.provenance === 'real_benchmark_evidence_pending') {
    return {
      caseId: manifestEntry.id,
      sourceType: manifestEntry.sourceType,
      status: 'skipped_pending_real_fetch',
      reason: 'no real fetch has been performed for this source in this environment',
    }
  }

  const fieldScores = {}
  for (const fieldName of ALLOWED_FIELD_NAMES) {
    const expected = resolveExpectedFieldValue(manifestEntry.groundTruth, fieldName)
    const evidence = adapterResult.fields ? adapterResult.fields[fieldName] : undefined
    const actual = evidence ? evidence.value : null

    let accuracyClass = scoreFieldAccuracy(expected, actual)
    if (accuracyClass === 'match') {
      // scoreFieldAccuracy only knows "both present" — the actual
      // equality check needs fieldName-aware normalization.
      const same = normalizeForComparison(fieldName, expected) === normalizeForComparison(fieldName, actual)
      accuracyClass = same ? 'match' : 'mismatch'
    }

    let confidence = null
    let contextStatus = null
    let hasContentHash = false
    if (evidence) {
      hasContentHash = Boolean(evidence.hasContentHash)
      contextStatus = evidence.contextStatus
      // THE re-derivation this whole benchmark exists to guarantee — see
      // this file's own header and adapters.js's own header comment.
      confidence = deriveFieldConfidence({
        fieldName,
        value: evidence.value,
        extractionMethod: evidence.extractionMethod,
        hasContentHash,
        contextStatus,
      })
    }

    fieldScores[fieldName] = { accuracyClass, confidence, contextStatus, hasContentHash }
  }

  const expectedMenuNames = Array.isArray(manifestEntry.groundTruth && manifestEntry.groundTruth.menuContextNames)
    ? manifestEntry.groundTruth.menuContextNames
    : []
  const actualMenuNames = Array.isArray(adapterResult.menuContextNames) ? adapterResult.menuContextNames : []
  const expectedSet = new Set(expectedMenuNames)
  const actualSet = new Set(actualMenuNames)
  const menuScore = {
    matched: [...expectedSet].filter((n) => actualSet.has(n)),
    missing: [...expectedSet].filter((n) => !actualSet.has(n)),
    unexpectedExtra: [...actualSet].filter((n) => !expectedSet.has(n)),
  }

  const expectedUnknownMenuContextCount =
    manifestEntry.groundTruth && typeof manifestEntry.groundTruth.unknownMenuContextCount === 'number'
      ? manifestEntry.groundTruth.unknownMenuContextCount
      : 0
  const unknownMenuContextCountMatch = expectedUnknownMenuContextCount === (adapterResult.unknownMenuContextCount || 0)

  const expectedErrorCode = manifestEntry.expectedErrorCode || null
  const reportedErrorCodes = (adapterResult.errors || []).map((e) => e.code)
  let errorClassification
  if (expectedErrorCode === null && reportedErrorCodes.length === 0) {
    errorClassification = 'no_error_expected_none_reported'
  } else if (expectedErrorCode === null && reportedErrorCodes.length > 0) {
    errorClassification = 'unexpected_error_reported'
  } else if (expectedErrorCode !== null && reportedErrorCodes.includes(expectedErrorCode)) {
    errorClassification = 'error_classification_correct'
  } else {
    errorClassification = 'error_classification_incorrect_or_missing'
  }

  return {
    caseId: manifestEntry.id,
    sourceType: manifestEntry.sourceType,
    status: 'scored',
    fieldScores,
    menuScore,
    unknownMenuContextCountMatch,
    errorClassification,
    // Local execution time only — see aggregateScores' own note. Never
    // representative of a real vendor's network/processing latency.
    timingMs,
    // Always null today: no vendor is activated in this environment, so
    // no real cost has ever been incurred or measured. A structurally
    // present, honestly-empty field, never a fabricated figure.
    costCents: null,
  }
}

/**
 * Aggregates scored cases by `sourceType` **and** `adapterKind` — NEVER
 * one blended figure across source types (be-21's own explicit
 * requirement), and never one blended figure across adapters either,
 * so a future `ai_structured`/`ocr` result can sit next to
 * `deterministic` for direct comparison rather than diluting it. A
 * score's `adapterKind` is attached by `runner.js`, not by `scoreCase`
 * itself (`scoring.js` stays agnostic to which adapter produced a
 * result — see `scoreCase`'s own doc comment).
 *
 * Cases with `status: 'skipped_pending_real_fetch'` (a real source no
 * fetch has ever been performed for) or `status: 'not_evaluated'` (a
 * deliberately unavailable adapter) are each counted separately and
 * excluded from every accuracy/coverage computation — neither was ever
 * genuinely scored, and the two must never be conflated with each other
 * or with an ordinary miss.
 */
function aggregateScores(caseScores) {
  const buckets = {}

  for (const score of caseScores) {
    const adapterKind = score.adapterKind || 'unknown'
    const key = `${score.sourceType}::${adapterKind}`
    if (!buckets[key]) {
      buckets[key] = {
        sourceType: score.sourceType,
        adapterKind,
        scoredCaseCount: 0,
        pendingRealFetchCaseCount: 0,
        notEvaluatedCaseCount: 0,
        fieldsEvaluated: 0,
        fieldsMatched: 0,
        falsePositiveFieldCount: 0,
        evidenceCoverageNumerator: 0,
        evidenceCoverageDenominator: 0,
        confidenceDistribution: { hoog: 0, middel: 0, laag: 0 },
        errorClassificationCounts: {},
        timingMsSamples: [],
      }
    }
    const bucket = buckets[key]

    if (score.status === 'skipped_pending_real_fetch') {
      bucket.pendingRealFetchCaseCount += 1
      continue
    }
    if (score.status === 'not_evaluated') {
      bucket.notEvaluatedCaseCount += 1
      continue
    }

    bucket.scoredCaseCount += 1
    if (typeof score.timingMs === 'number') bucket.timingMsSamples.push(score.timingMs)
    bucket.errorClassificationCounts[score.errorClassification] = (bucket.errorClassificationCounts[score.errorClassification] || 0) + 1

    for (const fieldScore of Object.values(score.fieldScores)) {
      if (fieldScore.accuracyClass === 'unexpected_extra') bucket.falsePositiveFieldCount += 1
      if (['match', 'mismatch', 'missing'].includes(fieldScore.accuracyClass)) {
        bucket.fieldsEvaluated += 1
        if (fieldScore.accuracyClass === 'match') bucket.fieldsMatched += 1
      }
      if (fieldScore.confidence) {
        bucket.confidenceDistribution[fieldScore.confidence] += 1
        // Evidence coverage: be-21's own "share of fields with a valid
        // content-hash reference" — over every field that was actually
        // extracted (has a confidence at all), never over every field
        // that merely could have existed.
        bucket.evidenceCoverageDenominator += 1
        if (fieldScore.hasContentHash) bucket.evidenceCoverageNumerator += 1
      }
    }
  }

  return Object.values(buckets).map((bucket) => ({
    sourceType: bucket.sourceType,
    adapterKind: bucket.adapterKind,
    scoredCaseCount: bucket.scoredCaseCount,
    pendingRealFetchCaseCount: bucket.pendingRealFetchCaseCount,
    notEvaluatedCaseCount: bucket.notEvaluatedCaseCount,
    fieldAccuracy: bucket.fieldsEvaluated > 0 ? bucket.fieldsMatched / bucket.fieldsEvaluated : null,
    fieldsEvaluated: bucket.fieldsEvaluated,
    falsePositiveFieldCount: bucket.falsePositiveFieldCount,
    evidenceCoverage: bucket.evidenceCoverageDenominator > 0 ? bucket.evidenceCoverageNumerator / bucket.evidenceCoverageDenominator : null,
    confidenceDistribution: bucket.confidenceDistribution,
    errorClassificationCounts: bucket.errorClassificationCounts,
    // Median, not mean — a handful of local runs on developer hardware
    // is too small/noisy a sample for a mean to mean much; still never
    // presented as vendor latency, only as this foundation's own local
    // execution-time signal. `null` when no case in this bucket reported
    // a numeric timing.
    medianTimingMs: medianOf(bucket.timingMsSamples),
    // Always null: no vendor is activated in this environment, so no
    // real cost has ever been measured — see scoreCase's own comment.
    costCentsPerAnalysis: null,
  }))
}

function medianOf(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

module.exports = {
  ALLOWED_ACCURACY_CLASSES,
  ALLOWED_CASE_STATUSES,
  normalizeForComparison,
  scoreFieldAccuracy,
  scoreCase,
  aggregateScores,
  medianOf,
}
