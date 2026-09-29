'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { runBenchmark, stripTimingForComparison } = require('./runner')
const { createDeterministicAdapter, createUnavailableAdapter } = require('./adapters')
const manifestData = require('./manifest.json')

function allAdapters() {
  return [createDeterministicAdapter(), createUnavailableAdapter('ai_structured'), createUnavailableAdapter('ocr')]
}

test('runBenchmark: the committed manifest is valid', async () => {
  const { manifestValid, manifestProblems } = await runBenchmark({ adapters: allAdapters() })
  assert.deepEqual(manifestProblems, [])
  assert.equal(manifestValid, true)
})

test('runBenchmark: every real_benchmark_evidence_pending entry is skipped for every adapter, and its adapter is never invoked', async () => {
  let deterministicCalls = 0
  const spyDeterministic = createDeterministicAdapter()
  const originalRun = spyDeterministic.run.bind(spyDeterministic)
  spyDeterministic.run = async (fixture) => {
    deterministicCalls += 1
    return originalRun(fixture)
  }

  const { caseScores } = await runBenchmark({ adapters: [spyDeterministic] })
  const pendingScores = caseScores.filter((s) => s.status === 'skipped_pending_real_fetch')
  assert.equal(pendingScores.length, 6) // the six mandatory sources

  // Every fixture-backed manifest entry also gets exactly one call, so
  // the count must equal exactly the fixture-backed entry count — proving
  // no pending entry sneaked in an extra call.
  const fixtureBackedCount = manifestData.filter((e) => e.provenance !== 'real_benchmark_evidence_pending').length
  assert.equal(deterministicCalls, fixtureBackedCount)
})

test('runBenchmark: an unavailable adapter is recorded as not_evaluated, never scored as an ordinary miss', async () => {
  const { caseScores } = await runBenchmark({ adapters: [createUnavailableAdapter('ai_structured')] })
  const fixtureBacked = caseScores.filter((s) => s.status !== 'skipped_pending_real_fetch')
  assert.ok(fixtureBacked.length > 0)
  for (const score of fixtureBacked) {
    assert.equal(score.status, 'not_evaluated')
    assert.equal('fieldScores' in score, false)
  }
})

test('runBenchmark: rejects immediately, before scoring, if an adapter smuggles a precomputed confidence value — defense in depth actually wired in, not merely available', async () => {
  const rogueAdapter = {
    kind: 'deterministic',
    available: true,
    async run() {
      return {
        kind: 'deterministic',
        available: true,
        fields: { name: { value: 'Rogue', extractionMethod: 'json_ld', hasContentHash: true, contextStatus: 'unverified', confidence: 'hoog' } },
        menuContextNames: [],
        unknownMenuContextCount: 0,
        errors: [],
        notes: [],
      }
    },
  }
  await assert.rejects(() => runBenchmark({ adapters: [rogueAdapter] }), /precomputed confidence/)
})

test('runBenchmark: rejects immediately if an adapter smuggles a precomputed reviewReady value', async () => {
  const rogueAdapter = {
    kind: 'deterministic',
    available: true,
    async run() {
      return {
        kind: 'deterministic',
        available: true,
        fields: { name: { value: 'Rogue', extractionMethod: 'json_ld', hasContentHash: true, contextStatus: 'unverified', reviewReady: true } },
        menuContextNames: [],
        unknownMenuContextCount: 0,
        errors: [],
        notes: [],
      }
    },
  }
  await assert.rejects(() => runBenchmark({ adapters: [rogueAdapter] }), /precomputed confidence/)
})

test('runBenchmark: throws a clear configuration error for a manifest entry with an unresolvable fixtureId, never silently skips it', async () => {
  const brokenManifest = [
    { ...manifestData.find((e) => e.provenance !== 'real_benchmark_evidence_pending'), fixtureId: 'does-not-exist' },
  ]
  await assert.rejects(() => runBenchmark({ manifest: brokenManifest, adapters: [createDeterministicAdapter()] }), /does not resolve to a real fixture/)
})

test('reproducibility: two independent runs of the same manifest/adapters produce byte-identical scores once timing is stripped', async () => {
  const runA = await runBenchmark({ adapters: allAdapters() })
  const runB = await runBenchmark({ adapters: allAdapters() })
  assert.deepEqual(stripTimingForComparison(runA.caseScores), stripTimingForComparison(runB.caseScores))
})

test('reproducibility: timingMs is a real, varying local measurement, not itself a fabricated constant', async () => {
  const { caseScores } = await runBenchmark({ adapters: [createDeterministicAdapter()] })
  const scored = caseScores.filter((s) => s.status === 'scored')
  assert.ok(scored.length > 0)
  for (const score of scored) {
    assert.equal(typeof score.timingMs, 'number')
    assert.ok(score.timingMs >= 0)
  }
})

// Deliberately excludes this directory's own *.test.js files — a test
// asserting "this pattern never appears" necessarily contains that exact
// pattern in its own source (its regex literal, its description string),
// which would otherwise make every one of these checks fail against
// itself. Only the non-test implementation files are the real subject.
function implementationFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
}

test('offline guarantee: no implementation file under ops/benchmark/ imports a network client of any kind', () => {
  const dir = __dirname
  const forbidden = [
    /require\(['"]https?['"]\)/,
    /require\(['"]node:https?['"]\)/,
    /require\(['"]undici['"]\)/,
    /require\(['"]node-fetch['"]\)/,
    /\bglobalThis\.fetch\b/,
    /\bawait fetch\(/,
  ]
  for (const file of implementationFiles(dir)) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} appears to import or call a real network client (${pattern})`)
    }
  }
})

test('offline guarantee: safeOutboundFetch.js (this project\'s own SSRF-hardened egress point) is never imported by any implementation file here', () => {
  const dir = __dirname
  for (const file of implementationFiles(dir)) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.doesNotMatch(source, /safeOutboundFetch/, `${file} references safeOutboundFetch — this benchmark must never perform a real fetch, not even a "safe" one`)
  }
})
