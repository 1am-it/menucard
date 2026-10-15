// Menu source structure regression corpus — CLI. Runs every STRUCT-* case
// through the real product chain (structureCorpusRunner.js), prints a compact
// pass/fail table per pattern, writes the machine-readable result to
// ops/benchmark/output/structure-corpus.json (gitignored, never committed)
// and exits non-zero when any classified case fails. Fully offline.
//
//   npm run benchmark:menu-structure
//
// Isolated tooling, never imported by product code. CommonJS.

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { STRUCTURE_CORPUS_VERSION } = require('./structureCorpus')
const { runStructureCorpus } = require('./structureCorpusRunner')

const OUTPUT_DIR = path.join(__dirname, 'output')

/** The human-readable report: one line per case, failures indented below it. */
function formatReport({ results }) {
  const counts = { pass: 0, fail: 0, unclassified: 0 }
  for (const r of results) counts[r.outcome] += 1
  const lines = [
    `Menu-structuurcorpus v${STRUCTURE_CORPUS_VERSION} — ${results.length} gevallen: ${counts.pass} pass, ${counts.fail} fail, ${counts.unclassified} unclassified`,
    '',
  ]
  for (const r of results) {
    lines.push(`${r.id}  ${r.outcome.toUpperCase().padEnd(12)}  ${r.name}  [${r.layers.join(', ')}]`)
    for (const failure of r.failures) lines.push(`    - ${failure}`)
    if (r.outcome === 'unclassified' && r.note) lines.push(`    · ${r.note}`)
  }
  return { text: lines.join('\n'), counts }
}

async function main() {
  const run = await runStructureCorpus()
  const { text, counts } = formatReport(run)
  console.log(text)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const machine = {
    version: STRUCTURE_CORPUS_VERSION,
    counts,
    results: run.results.map((r) => ({ id: r.id, name: r.name, status: r.status, layers: r.layers, outcome: r.outcome, failures: r.failures, note: r.note })),
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'structure-corpus.json'), `${JSON.stringify(machine, null, 2)}\n`)
  process.exitCode = counts.fail > 0 ? 1 : 0
}

if (require.main === module) main()

module.exports = { formatReport }
