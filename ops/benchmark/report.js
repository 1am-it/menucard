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
const { aggregateMenuScores } = require('./menuScoring')

/** Present in every report this file produces, machine-readable and
 * human-readable alike — the one, single source of this exact wording,
 * so it can never drift between the two formats. */
const FOUNDATION_DISCLAIMER =
  'This is a local, offline, synthetic BE-21 benchmark FOUNDATION — never the real, 50-100-source vendor benchmark be-21-restaurant-source-extraction-vendor-benchmark.md itself describes. No real restaurant source has been fetched. No OCR or browser-rendering vendor has been evaluated, contacted, or billed. Synthetic/local fixtures never demonstrate real-website or vendor quality.'

/** BE-22 — the menu-structure track's own wording, carried alongside the
 * foundation disclaimer wherever menu results appear. */
const MENU_TRACK_DISCLAIMER =
  "BE-22 menu track: synthetic, self-written HTML fixtures only. Scores prove the offline machinery, never that any real restaurant website's HTML menu is supported — that needs a separately authorized benchmark on real sources. No AI, OCR or document provider was called; cost is not measured."

/**
 * `{ generatedAt, disclaimer, manifestValid, manifestProblems, buckets,
 * caseScores }` — a plain, JSON-serializable object. `generatedAt` is
 * metadata only (real wall-clock time); every other field is exactly as
 * deterministic as `runner.js`'s own `caseScores` already are.
 */
function buildMachineReadableReport({ manifestValid, manifestProblems, caseScores, menuCaseScores }) {
  const report = {
    generatedAt: new Date().toISOString(),
    disclaimer: FOUNDATION_DISCLAIMER,
    manifestValid,
    manifestProblems,
    buckets: aggregateScores(caseScores),
    caseScores,
  }
  // BE-22 — the menu track is optional and additive; a field-only run's
  // report is unchanged.
  if (Array.isArray(menuCaseScores)) {
    report.menuDisclaimer = MENU_TRACK_DISCLAIMER
    report.menuBuckets = aggregateMenuScores(menuCaseScores)
    report.menuCaseScores = menuCaseScores
  }
  return report
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

  if (Array.isArray(machineReport.menuBuckets)) {
    lines.push('BE-22 — menustructuur-track (synthetische HTML, offline)')
    lines.push(machineReport.menuDisclaimer)
    lines.push('')
    for (const bucket of machineReport.menuBuckets) {
      lines.push(`## menu: ${bucket.sourceType} × ${bucket.adapterKind}`)
      lines.push(`  Gescoorde cases: ${bucket.scoredCaseCount}`)
      lines.push(`  Ongeldige output (contract geschonden): ${bucket.invalidOutputCaseCount}`)
      lines.push(`  Niet geëvalueerd (leverancier niet actief): ${bucket.notEvaluatedCaseCount}`)
      if (bucket.scoredCaseCount > 0) {
        lines.push(`  Precisie: ${formatPercent(bucket.precision)}; recall: ${formatPercent(bucket.recall)}`)
        lines.push(`  Gevonden/onterecht/gemist: ${bucket.truePositives}/${bucket.falsePositives}/${bucket.falseNegatives}`)
        lines.push(`  Verkeerde prijzen: ${bucket.wrongPrices}; verkeerde secties: ${bucket.wrongSections}`)
        lines.push(`  Onterecht als menu herkend: ${bucket.falseMenus}; gemiste menu's: ${bucket.missedMenus}`)
        lines.push(`  Cases met ontbrekende afwijsreden: ${bucket.casesMissingRejectionReasons}`)
        lines.push(`  Reviewlast (items + afgewezen regels): ${bucket.reviewLoad}`)
        lines.push(`  Mediane lokale looptijd: ${formatMs(bucket.medianTimingMs)} (lokale uitvoeringstijd — geen leverancier-latency)`)
      }
      lines.push('  Kosten: niet gemeten — geen leverancier actief in deze omgeving')
      lines.push('')
    }
  }

  lines.push(FOUNDATION_DISCLAIMER)
  return lines.join('\n')
}

module.exports = {
  FOUNDATION_DISCLAIMER,
  MENU_TRACK_DISCLAIMER,
  buildMachineReadableReport,
  buildHumanReadableSummary,
}
