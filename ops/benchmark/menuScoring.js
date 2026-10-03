// BE-22 — scoring for the menu-structure track. Judges one adapter's
// `menuExtraction` against one synthetic case's explicit expected result,
// and aggregates per `(sourceType, adapterKind)` — never one blended figure,
// the same separation scoring.js's own `aggregateScores` keeps for the
// field track.
//
// What this file never does: derive or report a `confidence`/`reviewReady`
// value. A menu item's trust stays BE-20's concern; this only counts what
// matches the expected result. An output that breaks the shared contract is
// `invalid_output`, never partially scored.
//
// Isolated tooling, never imported by product code — see manifest.js's own
// header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const { validateMenuExtraction, emptyCost } = require('./menuExtractionContract')
const { medianOf } = require('./scoring')

const MENU_CASE_STATUSES = ['scored', 'invalid_output', 'not_evaluated']

function normalizeName(name) {
  return String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function lastLabel(path) {
  const labels = (path || []).filter(Boolean)
  return labels.length > 0 ? labels[labels.length - 1] : null
}

function flattenPredicted(menuExtraction) {
  if (menuExtraction.status !== 'parsed') return []
  const out = []
  for (const section of menuExtraction.sections) {
    for (const item of section.items) out.push({ section: lastLabel(section.path), path: section.path, ...item })
  }
  return out
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null
}

/**
 * Scores one case. `menuCase.expected.items` rows are
 * `[sectionLabel, name, priceStatus, amountMinorUnits]`; items match by
 * normalized name. A matched item with another price state or amount is a
 * wrong price; with another section (or another full heading path, where
 * the case lists one) a wrong section — both still count as found, so
 * precision/recall measure recognition and the error counts measure detail.
 */
function scoreMenuCase(menuCase, adapterResult, { timingMs = null } = {}) {
  const base = { caseId: menuCase.id, kind: menuCase.kind || null, timingMs, cost: emptyCost() }
  const menuExtraction = adapterResult && adapterResult.menuExtraction
  const problems = validateMenuExtraction(menuExtraction)
  if (problems.length > 0) return { ...base, status: 'invalid_output', problems }

  const expected = menuCase.expected
  const predicted = flattenPredicted(menuExtraction)
  const expectedByName = new Map(expected.items.map(([section, name, priceStatus, amountMinorUnits]) => [normalizeName(name), { section, name, priceStatus, amountMinorUnits }]))

  let truePositives = 0
  let wrongPrices = 0
  let wrongSections = 0
  const falsePositiveNames = []
  const matched = new Set()
  for (const item of predicted) {
    const key = normalizeName(item.name)
    const want = expectedByName.get(key)
    if (!want || matched.has(key)) {
      falsePositiveNames.push(item.name)
      continue
    }
    matched.add(key)
    truePositives += 1
    if (item.priceStatus !== want.priceStatus || item.amountMinorUnits !== want.amountMinorUnits) wrongPrices += 1
    const wantPath = expected.paths && expected.paths[want.name]
    const pathWrong = wantPath ? JSON.stringify(item.path.filter(Boolean)) !== JSON.stringify(wantPath) : false
    if (item.section !== want.section || pathWrong) wrongSections += 1
  }
  const missedNames = [...expectedByName.values()].filter((want) => !matched.has(normalizeName(want.name))).map((want) => want.name)

  const rejectedReasons = [...new Set(menuExtraction.rejected.map((line) => line.reason))]
  const missingRejectionReasons = (expected.rejectedReasons || []).filter((reason) => !rejectedReasons.includes(reason))

  let wrongDescriptions = 0
  for (const [name, description] of Object.entries(expected.descriptions || {})) {
    const item = predicted.find((p) => normalizeName(p.name) === normalizeName(name))
    if (!item || item.description !== description) wrongDescriptions += 1
  }

  const parsed = menuExtraction.status === 'parsed'
  const stats = menuExtraction.stats || {}
  return {
    ...base,
    status: 'scored',
    extractionStatus: menuExtraction.status,
    extractionReason: menuExtraction.reason || null,
    falseMenu: parsed && !expected.isMenu,
    missedMenu: !parsed && expected.isMenu,
    truePositives,
    falsePositives: falsePositiveNames.length,
    falseNegatives: missedNames.length,
    falsePositiveNames,
    missedNames,
    precision: ratio(truePositives, truePositives + falsePositiveNames.length),
    recall: ratio(truePositives, truePositives + missedNames.length),
    wrongPrices,
    wrongSections,
    wrongDescriptions,
    missingRejectionReasons,
    // What a human reviewer would have to look at: every proposed item plus
    // every rejected line. Never a substitute for that review.
    reviewLoad: predicted.length + menuExtraction.rejected.length,
    duplicatesRemoved: Number.isInteger(stats.duplicatesRemoved) ? stats.duplicatesRemoved : null,
    ignoredMarkers: Number.isInteger(stats.ignoredMarkers) ? stats.ignoredMarkers : null,
    cost: menuExtraction.cost,
  }
}

/** One bucket per `(sourceType, adapterKind)` actually present. */
function aggregateMenuScores(menuCaseScores) {
  const buckets = new Map()
  for (const score of menuCaseScores) {
    const key = `${score.sourceType}::${score.adapterKind}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        sourceType: score.sourceType,
        adapterKind: score.adapterKind,
        scoredCaseCount: 0,
        invalidOutputCaseCount: 0,
        notEvaluatedCaseCount: 0,
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
        wrongPrices: 0,
        wrongSections: 0,
        falseMenus: 0,
        missedMenus: 0,
        casesMissingRejectionReasons: 0,
        reviewLoad: 0,
        timingMsSamples: [],
      })
    }
    const bucket = buckets.get(key)
    if (score.status === 'not_evaluated') {
      bucket.notEvaluatedCaseCount += 1
      continue
    }
    if (score.status === 'invalid_output') {
      bucket.invalidOutputCaseCount += 1
      continue
    }
    bucket.scoredCaseCount += 1
    bucket.truePositives += score.truePositives
    bucket.falsePositives += score.falsePositives
    bucket.falseNegatives += score.falseNegatives
    bucket.wrongPrices += score.wrongPrices
    bucket.wrongSections += score.wrongSections
    if (score.falseMenu) bucket.falseMenus += 1
    if (score.missedMenu) bucket.missedMenus += 1
    if (score.missingRejectionReasons.length > 0) bucket.casesMissingRejectionReasons += 1
    bucket.reviewLoad += score.reviewLoad
    if (typeof score.timingMs === 'number') bucket.timingMsSamples.push(score.timingMs)
  }
  return [...buckets.values()].map(({ timingMsSamples, ...bucket }) => ({
    ...bucket,
    precision: ratio(bucket.truePositives, bucket.truePositives + bucket.falsePositives),
    recall: ratio(bucket.truePositives, bucket.truePositives + bucket.falseNegatives),
    // Local execution time only — never a vendor latency claim.
    medianTimingMs: medianOf(timingMsSamples),
    // Always null: no provider is activated in this environment.
    costEurCents: null,
  }))
}

module.exports = {
  MENU_CASE_STATUSES,
  normalizeName,
  scoreMenuCase,
  aggregateMenuScores,
}
