'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const manifestData = require('./manifest.json')
const {
  ALLOWED_SOURCE_TYPES,
  ALLOWED_PROVENANCE,
  MANDATORY_SIX_URLS,
  validateManifestEntry,
  validateManifest,
} = require('./manifest')

test('validateManifest: the actual committed manifest.json is valid', () => {
  const { valid, problems } = validateManifest(manifestData)
  assert.deepEqual(problems, [])
  assert.equal(valid, true)
})

test('validateManifest: manifest.json contains exactly the six mandatory sources, each flagged mandatorySubset', () => {
  const mandatoryEntries = manifestData.filter((e) => e.mandatorySubset === true)
  assert.equal(mandatoryEntries.length, 6)
  const urls = mandatoryEntries.map((e) => e.referenceUrl).sort()
  assert.deepEqual(urls, [...MANDATORY_SIX_URLS].sort())
})

test('validateManifest: not one entry in manifest.json has fetched: true — this foundation never performs a real fetch', () => {
  for (const entry of manifestData) {
    if (entry.provenance === 'real_benchmark_evidence_pending') {
      assert.equal(entry.fetched, false, `${entry.id} must have fetched: false`)
    }
  }
})

test('validateManifest: every stratification category be-21 names is covered by at least one fixture-backed entry', () => {
  const fixtureEntries = manifestData.filter((e) => e.provenance !== 'real_benchmark_evidence_pending')
  const coveredTypes = new Set(fixtureEntries.map((e) => e.sourceType))
  for (const sourceType of ALLOWED_SOURCE_TYPES) {
    assert.ok(coveredTypes.has(sourceType), `no fixture-backed entry covers sourceType "${sourceType}"`)
  }
})

test('validateManifest: detects a duplicate id', () => {
  const broken = [
    { ...manifestData[6], id: 'dup' },
    { ...manifestData[7], id: 'dup' },
  ]
  const { valid, problems } = validateManifest(broken)
  assert.equal(valid, false)
  assert.ok(problems.some((p) => p.includes('duplicate id: dup')))
})

test('validateManifest: detects a missing mandatory source', () => {
  const withoutOne = manifestData.filter((e) => e.id !== 'real-01-debotanistbreda')
  const { valid, problems } = validateManifest(withoutOne)
  assert.equal(valid, false)
  assert.ok(problems.some((p) => p.includes('https://debotanistbreda.nl/')))
})

test('validateManifestEntry: rejects an unknown sourceType', () => {
  const entry = { ...manifestData[6], sourceType: 'not_a_real_category' }
  const problems = validateManifestEntry(entry)
  assert.ok(problems.some((p) => p.includes('sourceType')))
})

test('validateManifestEntry: rejects a real_benchmark_evidence_pending entry that claims fetched: true', () => {
  const entry = { ...manifestData[0], fetched: true }
  const problems = validateManifestEntry(entry)
  assert.ok(problems.some((p) => p.includes('fetched: false')))
})

test('validateManifestEntry: rejects a real_benchmark_evidence_pending entry that carries a groundTruth', () => {
  const entry = { ...manifestData[0], groundTruth: { name: 'Should never be here' } }
  const problems = validateManifestEntry(entry)
  assert.ok(problems.some((p) => p.includes('groundTruth: null')))
})

test('validateManifestEntry: rejects a fixture-backed entry that carries a referenceUrl', () => {
  const entry = { ...manifestData[6], referenceUrl: 'https://debotanistbreda.nl/' }
  const problems = validateManifestEntry(entry)
  assert.ok(problems.some((p) => p.includes('referenceUrl: null')))
})

test('validateManifestEntry: rejects mandatorySubset: true on a fixture-backed entry', () => {
  const entry = { ...manifestData[6], mandatorySubset: true }
  const problems = validateManifestEntry(entry)
  assert.ok(problems.some((p) => p.includes('mandatorySubset may only be true')))
})

test('validateManifestEntry: rejects an unknown groundTruth key', () => {
  const entry = { ...manifestData[6], groundTruth: { ...manifestData[6].groundTruth, notARealField: 'x' } }
  const problems = validateManifestEntry(entry)
  assert.ok(problems.some((p) => p.includes('notARealField')))
})

test('validateManifestEntry: rejects an expectedErrorCode outside the closed PDF error vocabulary', () => {
  const entry = { ...manifestData[10], expectedErrorCode: 'made_up_reason' }
  const problems = validateManifestEntry(entry)
  assert.ok(problems.some((p) => p.includes('expectedErrorCode')))
})

test('ALLOWED_PROVENANCE and ALLOWED_SOURCE_TYPES are non-empty closed lists', () => {
  assert.ok(ALLOWED_PROVENANCE.length > 0)
  assert.ok(ALLOWED_SOURCE_TYPES.length > 0)
})
