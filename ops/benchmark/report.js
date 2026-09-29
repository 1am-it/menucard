// BE-21 — machine-readable + human-readable reporting for one
// `runner.js` run. Both report shapes carry the same explicit disclaimer
// text, in the report itself, not only in surrounding documentation —
// this is deliberate: a report that gets copied out of this repository
// must still be self-evidently NOT the real be-21 vendor benchmark.
//
// Isolated tooling, never imported by product code — see manifest.js's
// own header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const { aggregateScores } = require('./scoring')

/** Present in every report this file produces, machine-readable and
 * human-readable alike — the one, single source of this exact wording,
 * so it can never drift between the two formats. */
const FOUNDATION_DISCLAIMER =
  'This is a local, offline, synthetic BE-21 benchmark FOUNDATION — never the real, 50-100-source vendor benchmark be-21-restaurant-source-extraction-vendor-benchmark.md itself describes. No real restaurant source has been fetched. No OCR or browser-rendering vendor has been evaluated, contacted, or billed. Synthetic/local fixtures never demonstrate real-website or vendor quality.'

/**
 * `{ generatedAt, disclaimer, manifestValid, manifestProblems, buckets,
 * caseScores }` — a plain, JSON-serializable object. `generatedAt` is
 * metadata only (real wall-clock time); every other field is exactly as
 * deterministic as `runner.js`'s own `caseScores` already are.
 */
function buildMachineReadableReport({ manifestValid, manifestProblems, caseScores }) {
  return {
    generatedAt: new Date().toISOString(),
    disclaimer: FOUNDATION_DISCLAIMER,
    manifestValid,
    manifestProblems,
    buckets: aggregateScores(caseScores),
    caseScores,
  }
}

function formatPercent(fraction) {
  return typeof fraction === 'number' ? `${Math.round(fraction * 1000) / 10}%` : 'n.v.t. (geen gescoorde velden)'
}

function formatMs(ms) {
  return typeof ms === 'number' ? `${Math.round(ms * 10) / 10}ms` : 'n.v.t.'
}

/**
 * A short, plain-text, Dutch summary — a handful of lines per
 * (sourceType, adapterKind) bucket, never one blended figure. Always
 * opens and closes with the same disclaimer `buildMachineReadableReport`
 * carries, in this report's own body — a reader must never be able to
 * separate the numbers from that context.
 */
function buildHumanReadableSummary(machineReport) {
  const lines = []
  lines.push('BE-21 — lokale benchmarkfoundation (GEEN echte vendor-benchmark)')
  lines.push(FOUNDATION_DISCLAIMER)
  lines.push('')
  lines.push(`Gegenereerd: ${machineReport.generatedAt}`)
  lines.push(`Manifest geldig: ${machineReport.manifestValid ? 'ja' : 'nee'}`)
  if (!machineReport.manifestValid) {
    for (const problem of machineReport.manifestProblems) lines.push(`  - PROBLEEM: ${problem}`)
  }
  lines.push('')

  for (const bucket of machineReport.buckets) {
    lines.push(`## ${bucket.sourceType} × ${bucket.adapterKind}`)
    lines.push(`  Gescoorde cases: ${bucket.scoredCaseCount}`)
    lines.push(`  Wachtend op echte fetch (nooit uitgevoerd): ${bucket.pendingRealFetchCaseCount}`)
    lines.push(`  Niet geëvalueerd (leverancier niet actief): ${bucket.notEvaluatedCaseCount}`)
    if (bucket.scoredCaseCount > 0) {
      lines.push(`  Veldaccuratesse: ${formatPercent(bucket.fieldAccuracy)} (${bucket.fieldsEvaluated} velden beoordeeld)`)
      lines.push(`  Onterecht gevonden velden (false positives): ${bucket.falsePositiveFieldCount}`)
      lines.push(`  Evidence-coverage (geldige content-hash): ${formatPercent(bucket.evidenceCoverage)}`)
      lines.push(
        `  Confidence-verdeling: hoog=${bucket.confidenceDistribution.hoog}, middel=${bucket.confidenceDistribution.middel}, laag=${bucket.confidenceDistribution.laag}`
      )
      lines.push(`  Foutclassificatie: ${JSON.stringify(bucket.errorClassificationCounts)}`)
      lines.push(`  Mediane lokale looptijd: ${formatMs(bucket.medianTimingMs)} (lokale uitvoeringstijd — geen leverancier-latency)`)
    }
    lines.push(`  Kosten per analyse: niet gemeten — geen leverancier actief in deze omgeving`)
    lines.push('')
  }

  lines.push(FOUNDATION_DISCLAIMER)
  return lines.join('\n')
}

module.exports = {
  FOUNDATION_DISCLAIMER,
  buildMachineReadableReport,
  buildHumanReadableSummary,
}
