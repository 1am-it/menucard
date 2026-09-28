// BE-21 — thin CLI entry point tying the benchmark foundation together
// end to end: runs the deterministic adapter plus the two deliberately
// unavailable stubs against the committed manifest, writes the
// machine-readable report to `ops/benchmark/output/latest-run.json`
// (gitignored — a run's own output, never a committed artifact), and
// prints the human-readable summary to stdout. Fully offline; see
// `runner.js`'s own header for the reproducibility/offline guarantees
// this script itself adds nothing on top of.
//
// `if (require.main === module)` entry-point pattern matches this
// project's own `ops/scripts/import-breda-osm.js` convention exactly.
//
// Isolated tooling, never imported by product code — see manifest.js's
// own header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const path = require('node:path')
const fs = require('node:fs')

const { runBenchmark } = require('./runner')
const { createDeterministicAdapter, createUnavailableAdapter } = require('./adapters')
const { buildMachineReadableReport, buildHumanReadableSummary } = require('./report')

const OUTPUT_DIR = path.join(__dirname, 'output')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'latest-run.json')

async function main() {
  const runResult = await runBenchmark({
    adapters: [createDeterministicAdapter(), createUnavailableAdapter('ai_structured'), createUnavailableAdapter('ocr')],
  })
  const machineReport = buildMachineReadableReport(runResult)
  const humanSummary = buildHumanReadableSummary(machineReport)

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(machineReport, null, 2), 'utf8')

  console.log(humanSummary)
  console.log('')
  console.log(`Volledig machineleesbaar rapport geschreven naar: ${OUTPUT_PATH}`)

  if (!machineReport.manifestValid) {
    // A structurally invalid manifest is a real configuration bug in
    // this benchmark's own files — never silently reported as "done."
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}

module.exports = { main, OUTPUT_DIR, OUTPUT_PATH }
