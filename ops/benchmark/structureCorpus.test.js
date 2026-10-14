'use strict'

// The regression gate of the menu source structure corpus. A change to any
// guarded module (structureCorpusRunner.js GUARDED_MODULES: parser,
// analysis, hierarchy, concept, export, batch status) must keep EVERY
// classified STRUCT-* case green — not one targeted test. Run with
// `npm run test:menu-structure` (also part of `npm test`).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { STRUCTURE_CORPUS_VERSION, LAYERS, STRUCTURE_CASES } = require('./structureCorpus')
const { GUARDED_MODULES, runStructureCorpus } = require('./structureCorpusRunner')
const { formatReport } = require('./runStructureCorpus')
const { EVIDENCE_PATTERNS, REJECTION_REASONS } = require('../../src/lib/menuExtractionContract')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
let run = null
async function corpus() {
  if (!run) run = await runStructureCorpus()
  return run
}

test('catalogue: versioned, unique STRUCT-NNN ids, known layers, expectations or a documented open choice', () => {
  assert.match(STRUCTURE_CORPUS_VERSION, /^\d+\.\d+\.\d+$/)
  const ids = STRUCTURE_CASES.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const c of STRUCTURE_CASES) {
    assert.match(c.id, /^STRUCT-\d{3}$/, c.id)
    assert.ok(typeof c.name === 'string' && c.name.length > 0, c.id)
    assert.ok(['classified', 'unclassified'].includes(c.status), c.id)
    assert.ok(Array.isArray(c.layers) && c.layers.length > 0 && c.layers.every((l) => LAYERS.includes(l)), c.id)
    assert.ok(c.input && (typeof c.input.page === 'string' || typeof c.input.homepage === 'string'), c.id)
    if (c.status === 'classified') assert.ok(Object.keys(c.expected || {}).length > 0, `${c.id} needs expectations`)
    else assert.ok(typeof c.note === 'string' && c.note.length > 0, `${c.id} needs a note on the open product choice`)
  }
})

test('the whole corpus runs through the real chain and every classified pattern passes', async () => {
  const { results } = await corpus()
  const failed = results.filter((r) => r.outcome === 'fail')
  assert.deepEqual(failed.map((r) => `${r.id}: ${r.failures.join(' | ')}`), [])
  assert.ok(results.filter((r) => r.outcome === 'pass').length >= 20)
  // Unclassified cases run (they produce an observation) but never decide.
  for (const r of results.filter((x) => x.status === 'unclassified')) {
    assert.equal(r.outcome, 'unclassified')
    assert.ok(r.actual, r.id)
  }
})

test('coverage: every layer, every HTML evidence pattern and every rejection reason is pinned by a classified case', () => {
  const classified = STRUCTURE_CASES.filter((c) => c.status === 'classified')
  for (const layer of LAYERS) assert.ok(classified.some((c) => c.layers.includes(layer)), `layer ${layer}`)
  const patterns = new Set(classified.flatMap((c) => (c.expected.evidencePatterns || [])))
  // list_item is the default pattern of most cases; model_quote belongs to a model adapter, not HTML.
  for (const pattern of EVIDENCE_PATTERNS.filter((p) => p !== 'model_quote' && p !== 'list_item')) assert.ok(patterns.has(pattern), `evidence pattern ${pattern}`)
  const reasons = new Set(classified.flatMap((c) => c.expected.parserRejected || []))
  for (const reason of REJECTION_REASONS) assert.ok(reasons.has(reason), `rejection reason ${reason}`)
  // Both structure outcomes are pinned.
  const structures = new Set(classified.flatMap((c) => (c.expected.menus || []).map((m) => m.structure)))
  assert.ok(structures.has('normalized') && structures.has('uncertain'))
})

test('the runner loads every guarded product module — no second parser, no copy of the chain', async () => {
  await corpus()
  const loaded = new Set(Object.keys(require.cache).map((file) => path.relative(REPO_ROOT, file).split(path.sep).join('/')))
  for (const file of GUARDED_MODULES) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `${file} exists`)
    assert.ok(loaded.has(file), `${file} is exercised by the corpus`)
  }
  const runner = fs.readFileSync(path.join(__dirname, 'structureCorpusRunner.js'), 'utf8')
  assert.doesNotMatch(runner, /\bfetch\(|https?\.request|child_process|process\.env/)
})

test('data minimisation: only fictional .invalid hosts and fictional dish names', async () => {
  const { results } = await corpus()
  const source = fs.readFileSync(path.join(__dirname, 'structureCorpus.js'), 'utf8')
  const urls = source.match(/https?:\/\/[^\s'"`)<]+/g) || []
  for (const url of urls) assert.match(url, /^https:\/\/(www\.fictief-struct\.invalid|schema\.org)/, url)
  for (const r of results) {
    for (const [dish] of (r.actual && r.actual.dishesByPath) || []) assert.match(dish, /^Fictie/, `${r.id}: ${dish}`)
  }
})

test('the gate is wired: npm scripts run the corpus, and the report shows every case', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  assert.match(pkg.scripts['test:menu-structure'], /ops\/benchmark\/structureCorpus\.test\.js/)
  assert.ok(pkg.scripts.test.includes('"ops/**/*.test.js"'), 'npm test includes the ops tests (and so the corpus)')
  assert.match(pkg.scripts['benchmark:menu-structure'], /ops\/benchmark\/runStructureCorpus\.js/)
  const { text, counts } = formatReport(await corpus())
  for (const c of STRUCTURE_CASES) assert.ok(text.includes(c.id), c.id)
  assert.equal(counts.fail, 0)
})
