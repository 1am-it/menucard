'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const manifestData = require('./manifest.json')
const { buildFixture } = require('./fixtures')
const { createDeterministicAdapter } = require('./adapters')
const { scoreFieldAccuracy, scoreCase, aggregateScores, medianOf, normalizeForComparison } = require('./scoring')

function entryById(id) {
  return manifestData.find((e) => e.id === id)
}

async function scoreFixtureCase(id, { timingMs = 1 } = {}) {
  const entry = entryById(id)
  const fixture = buildFixture(entry.fixtureId)
  const adapter = createDeterministicAdapter()
  const result = await adapter.run(fixture)
  return scoreCase(entry, result, { timingMs })
}

test('scoreFieldAccuracy: the four non-normalization-dependent outcomes', () => {
  assert.equal(scoreFieldAccuracy(null, null), 'correctly_absent')
  assert.equal(scoreFieldAccuracy(null, 'surprise'), 'unexpected_extra')
  assert.equal(scoreFieldAccuracy('expected', null), 'missing')
  assert.equal(scoreFieldAccuracy('same', 'same'), 'match')
})

test('scoreCase: a real_benchmark_evidence_pending entry is never scored, regardless of what adapterResult contains', () => {
  const entry = entryById('real-01-debotanistbreda')
  const score = scoreCase(entry, { fields: { name: { value: 'should never be read' } } })
  assert.equal(score.status, 'skipped_pending_real_fetch')
  assert.equal('fieldScores' in score, false)
})

test('scoreCase: a consistent same-host confirmation reaches confidence "hoog" only for the field that was actually confirmed', async () => {
  const score = await scoreFixtureCase('fixture-html-only-consistent')
  assert.equal(score.fieldScores.address.contextStatus, 'consistent')
  assert.equal(score.fieldScores.address.confidence, 'hoog')
  assert.equal(score.fieldScores.address.accuracyClass, 'match')
})

test('scoreCase: THE core BE-21 invariant — a field sighted only once (never actively confirmed) is capped at "middel", never "hoog", even with valid evidence and a plausible value', async () => {
  const score = await scoreFixtureCase('fixture-html-only-consistent')
  for (const fieldName of ['name', 'category', 'phone', 'website']) {
    assert.equal(score.fieldScores[fieldName].contextStatus, 'unverified')
    assert.equal(score.fieldScores[fieldName].confidence, 'middel', `${fieldName} must be capped at middel when unverified`)
    assert.notEqual(score.fieldScores[fieldName].confidence, 'hoog')
  }
})

test('scoreCase: THE other core BE-21 invariant — a genuine same-host conflict always caps confidence at "laag", never higher, while the extracted VALUE remains the location page\'s own correct value', async () => {
  const score = await scoreFixtureCase('fixture-chain-location-conflict')
  assert.equal(score.fieldScores.address.contextStatus, 'conflict')
  assert.equal(score.fieldScores.address.confidence, 'laag')
  assert.equal(score.fieldScores.address.accuracyClass, 'match')
})

test('scoreCase: a javascript-dependent page with nothing server-rendered scores every field "correctly_absent", never "missing" or fabricated', async () => {
  const score = await scoreFixtureCase('fixture-javascript-dependent-empty')
  for (const fieldName of Object.keys(score.fieldScores)) {
    assert.equal(score.fieldScores[fieldName].accuracyClass, 'correctly_absent')
    assert.equal(score.fieldScores[fieldName].confidence, null)
  }
})

test('scoreCase: a multilingual menu keyword ("Speisekarte") is discovered and matches the expected menu context name', async () => {
  const score = await scoreFixtureCase('fixture-multilingual-menu-keyword')
  assert.deepEqual(score.menuScore, { matched: ['Speisekarte'], missing: [], unexpectedExtra: [] })
})

test('scoreCase: the digital-PDF-entry fixture matches its expected unknown-menu-context count', async () => {
  const score = await scoreFixtureCase('fixture-digital-pdf-valid')
  assert.equal(score.unknownMenuContextCountMatch, true)
  assert.equal(score.errorClassification, 'no_error_expected_none_reported')
})

test('scoreCase: an encrypted-PDF fixture is classified error_classification_correct against its expected pdf_encrypted code', async () => {
  const score = await scoreFixtureCase('fixture-digital-pdf-encrypted')
  assert.equal(score.errorClassification, 'error_classification_correct')
})

test('scoreCase: a no-text-layer PDF fixture is classified error_classification_correct against its expected pdf_no_text_layer code', async () => {
  const score = await scoreFixtureCase('fixture-scanned-pdf-no-text-layer')
  assert.equal(score.errorClassification, 'error_classification_correct')
})

test('scoreCase: wrong expected error code is classified error_classification_incorrect_or_missing, never silently accepted', async () => {
  const entry = { ...entryById('fixture-digital-pdf-encrypted'), expectedErrorCode: 'pdf_too_large' }
  const fixture = buildFixture(entry.fixtureId)
  const result = await createDeterministicAdapter().run(fixture)
  const score = scoreCase(entry, result, { timingMs: 1 })
  assert.equal(score.errorClassification, 'error_classification_incorrect_or_missing')
})

test('scoreCase: costCents is always null — no vendor is ever activated in this environment', async () => {
  const score = await scoreFixtureCase('fixture-html-only-consistent')
  assert.equal(score.costCents, null)
})

test('normalizeForComparison: phone/website normalize via BE-20\'s own normalizers; free text is trimmed/lowercased', () => {
  assert.equal(normalizeForComparison('phone', '076 1234567'), normalizeForComparison('phone', '0761234567'))
  assert.equal(normalizeForComparison('name', 'Fixture Bistro Noord'), normalizeForComparison('name', '  fixture bistro noord  '))
  assert.equal(normalizeForComparison('name', ''), null)
})

test('medianOf: odd/even sample counts and the empty case', () => {
  assert.equal(medianOf([]), null)
  assert.equal(medianOf([5]), 5)
  assert.equal(medianOf([1, 3, 2]), 2)
  assert.equal(medianOf([1, 2, 3, 4]), 2.5)
})

test('aggregateScores: never blends different sourceTypes into one figure', async () => {
  const consistentScore = await scoreFixtureCase('fixture-html-only-consistent') // html_only
  const conflictScore = await scoreFixtureCase('fixture-chain-location-conflict') // chain_location
  const buckets = aggregateScores([consistentScore, conflictScore])
  const sourceTypes = buckets.map((b) => b.sourceType).sort()
  assert.deepEqual(sourceTypes, ['chain_location', 'html_only'])
  assert.equal(buckets.length, 2)
})

test('aggregateScores: a skipped_pending_real_fetch case is counted separately and never enters the accuracy denominator', () => {
  const pending = { caseId: 'real-01', sourceType: 'html_only', status: 'skipped_pending_real_fetch' }
  const buckets = aggregateScores([pending])
  assert.equal(buckets[0].pendingRealFetchCaseCount, 1)
  assert.equal(buckets[0].scoredCaseCount, 0)
  assert.equal(buckets[0].fieldAccuracy, null)
})

test('aggregateScores: evidence coverage and confidence distribution are computed only over fields the adapter actually extracted', async () => {
  const score = await scoreFixtureCase('fixture-html-only-consistent')
  const [bucket] = aggregateScores([score])
  // 5 fields extracted, all with a valid content-hash.
  assert.equal(bucket.evidenceCoverage, 1)
  assert.equal(bucket.confidenceDistribution.hoog, 1) // address
  assert.equal(bucket.confidenceDistribution.middel, 4) // name/category/phone/website
  assert.equal(bucket.confidenceDistribution.laag, 0)
})

test('aggregateScores: costCentsPerAnalysis is always null — never a fabricated or estimated figure', async () => {
  const score = await scoreFixtureCase('fixture-html-only-consistent')
  const [bucket] = aggregateScores([score])
  assert.equal(bucket.costCentsPerAnalysis, null)
})
