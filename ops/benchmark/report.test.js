'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { runBenchmark, stripTimingForComparison } = require('./runner')
const { createDeterministicAdapter, createUnavailableAdapter } = require('./adapters')
const { FOUNDATION_DISCLAIMER, buildMachineReadableReport, buildHumanReadableSummary } = require('./report')

async function sampleRun() {
  return runBenchmark({ adapters: [createDeterministicAdapter(), createUnavailableAdapter('ai_structured'), createUnavailableAdapter('ocr')] })
}

test('buildMachineReadableReport: round-trips through JSON.stringify/parse without loss', async () => {
  const runResult = await sampleRun()
  const report = buildMachineReadableReport(runResult)
  const roundTripped = JSON.parse(JSON.stringify(report))
  assert.deepEqual(roundTripped.buckets, report.buckets)
  assert.deepEqual(roundTripped.caseScores, report.caseScores)
})

test('buildMachineReadableReport: always carries the foundation disclaimer verbatim', async () => {
  const report = buildMachineReadableReport(await sampleRun())
  assert.equal(report.disclaimer, FOUNDATION_DISCLAIMER)
})

test('buildMachineReadableReport: never blends sourceType or adapterKind — one bucket per combination actually present', async () => {
  const report = buildMachineReadableReport(await sampleRun())
  const keys = report.buckets.map((b) => `${b.sourceType}::${b.adapterKind}`)
  assert.equal(new Set(keys).size, keys.length) // no duplicate bucket key
  const adapterKinds = new Set(report.buckets.map((b) => b.adapterKind))
  assert.ok(adapterKinds.has('deterministic'))
  assert.ok(adapterKinds.has('ai_structured'))
  assert.ok(adapterKinds.has('ocr'))
})

test('buildMachineReadableReport: no bucket ever reports a non-null cost — no vendor is activated in this environment', async () => {
  const report = buildMachineReadableReport(await sampleRun())
  for (const bucket of report.buckets) {
    assert.equal(bucket.costCentsPerAnalysis, null)
  }
})

test('buildMachineReadableReport: deterministic across runs once generatedAt and timingMs are excluded', async () => {
  const reportA = buildMachineReadableReport(await sampleRun())
  const reportB = buildMachineReadableReport(await sampleRun())
  assert.deepEqual(stripTimingForComparison(reportA.caseScores), stripTimingForComparison(reportB.caseScores))
  assert.deepEqual(reportA.buckets.map((b) => ({ ...b, medianTimingMs: null })), reportB.buckets.map((b) => ({ ...b, medianTimingMs: null })))
})

test('buildHumanReadableSummary: opens and closes with the same foundation disclaimer', async () => {
  const report = buildMachineReadableReport(await sampleRun())
  const summary = buildHumanReadableSummary(report)
  const occurrences = summary.split(FOUNDATION_DISCLAIMER).length - 1
  assert.ok(occurrences >= 2, 'the disclaimer must appear at least at the start and the end')
})

test('buildHumanReadableSummary: reports every sourceType × adapterKind bucket separately, never one blended line', async () => {
  const report = buildMachineReadableReport(await sampleRun())
  const summary = buildHumanReadableSummary(report)
  for (const bucket of report.buckets) {
    assert.ok(summary.includes(`## ${bucket.sourceType} × ${bucket.adapterKind}`))
  }
})

test('buildHumanReadableSummary: states explicitly that cost was not measured, never a fabricated number', async () => {
  const report = buildMachineReadableReport(await sampleRun())
  const summary = buildHumanReadableSummary(report)
  assert.ok(summary.includes('niet gemeten'))
})

test('buildHumanReadableSummary: an invalid manifest is surfaced as a visible problem, never silently hidden', () => {
  const summary = buildHumanReadableSummary({
    generatedAt: '2026-01-01T00:00:00.000Z',
    manifestValid: false,
    manifestProblems: ['some entry: something is wrong'],
    buckets: [],
  })
  assert.ok(summary.includes('Manifest geldig: nee'))
  assert.ok(summary.includes('something is wrong'))
})
