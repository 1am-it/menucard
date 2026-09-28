'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { computeFieldEvidenceHash } = require('./fieldEvidenceHash')

test('computeFieldEvidenceHash: returns a 64-character lowercase hex string for a real fragment', () => {
  const hash = computeFieldEvidenceHash('<address>Tolbrugstraat 19, 4811 WN Breda</address>')
  assert.equal(typeof hash, 'string')
  assert.equal(hash.length, 64)
  assert.match(hash, /^[0-9a-f]{64}$/)
})

test('computeFieldEvidenceHash: deterministic — identical input always yields identical output', () => {
  const fragment = 'Menukaart — Lunch'
  assert.equal(computeFieldEvidenceHash(fragment), computeFieldEvidenceHash(fragment))
})

test('computeFieldEvidenceHash: different fragments yield different hashes', () => {
  const a = computeFieldEvidenceHash('fragment A')
  const b = computeFieldEvidenceHash('fragment B')
  assert.notEqual(a, b)
})

test('computeFieldEvidenceHash: returns null for an empty string, never a hash of nothing', () => {
  assert.equal(computeFieldEvidenceHash(''), null)
})

test('computeFieldEvidenceHash: returns null for non-string input — never guesses', () => {
  assert.equal(computeFieldEvidenceHash(null), null)
  assert.equal(computeFieldEvidenceHash(undefined), null)
  assert.equal(computeFieldEvidenceHash(42), null)
  assert.equal(computeFieldEvidenceHash({}), null)
})

test('computeFieldEvidenceHash: never imports anything beyond node:crypto (server-only module boundary)', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(require.resolve('./fieldEvidenceHash.js'), 'utf8')
  const requireCalls = [...source.matchAll(/require\((['"])(.*?)\1\)/g)].map((m) => m[2])
  assert.deepEqual(requireCalls, ['node:crypto'])
})
