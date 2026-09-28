'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { phonesLikelyMatch, websitesLikelyMatch, checkFieldContextStatus } = require('./fieldContextConflict')

test('phonesLikelyMatch: true for the same Dutch number in different formats', () => {
  assert.equal(phonesLikelyMatch('076 3032490', '+31763032490'), true)
})

test('phonesLikelyMatch: false for two genuinely different valid Dutch numbers', () => {
  assert.equal(phonesLikelyMatch('076 3032490', '020 1234567'), false)
})

test('phonesLikelyMatch: null (inconclusive, never a guessed conflict) when either side does not parse', () => {
  assert.equal(phonesLikelyMatch('not a phone number', '076 3032490'), null)
  assert.equal(phonesLikelyMatch('076 3032490', ''), null)
})

test('websitesLikelyMatch: true for the same host with a different path', () => {
  assert.equal(websitesLikelyMatch('https://debotanistbreda.nl/', 'https://debotanistbreda.nl/menukaart'), true)
})

test('websitesLikelyMatch: false for two different hosts', () => {
  assert.equal(websitesLikelyMatch('https://debotanistbreda.nl/', 'https://bobbisbar.nl/'), false)
})

test('websitesLikelyMatch: null when either side is not a real URL', () => {
  assert.equal(websitesLikelyMatch('not a url', 'https://debotanistbreda.nl/'), null)
})

// ─── checkFieldContextStatus — the tri-state contract ──────────────────────

test('checkFieldContextStatus: "unverified" when there are no other sightings at all — never "consistent"', () => {
  assert.equal(checkFieldContextStatus('address', 'Tolbrugstraat 19, 4811 WN Breda', []), 'unverified')
})

test('checkFieldContextStatus: "conflict" for address — a different Dutch postcode found on another page', () => {
  const result = checkFieldContextStatus('address', 'Tolbrugstraat 19, 4811 WN Breda', ['Hoofdkantoor 1, 1011 AB Amsterdam'])
  assert.equal(result, 'conflict')
})

test('checkFieldContextStatus: "consistent" for address — the same postcode actively restated and confirmed on another page', () => {
  const result = checkFieldContextStatus('address', 'Tolbrugstraat 19, 4811 WN Breda', ['4811 WN Breda (ingang achterzijde)'])
  assert.equal(result, 'consistent')
})

test('checkFieldContextStatus: "conflict" for phone — a genuinely different number found elsewhere', () => {
  assert.equal(checkFieldContextStatus('phone', '076 3032490', ['020 1234567']), 'conflict')
})

test('checkFieldContextStatus: "conflict" for website — a different host found elsewhere', () => {
  assert.equal(checkFieldContextStatus('website', 'https://debotanistbreda.nl/', ['https://someotherchain.nl/']), 'conflict')
})

test('checkFieldContextStatus: "unverified" (never "consistent") when every other sighting is inconclusive — an inconclusive comparison is not a validation', () => {
  const result = checkFieldContextStatus('address', 'Tolbrugstraat 19, 4811 WN Breda', ['geen adres gevonden', ''])
  assert.equal(result, 'unverified')
})

test('checkFieldContextStatus: "conflict" wins even when mixed with a confirmed match — one genuine disagreement outweighs any number of agreements', () => {
  const result = checkFieldContextStatus('address', 'Tolbrugstraat 19, 4811 WN Breda', [
    '4811 WN Breda (achteringang)', // confirmed match
    '1011 AB Amsterdam', // confirmed conflict
  ])
  assert.equal(result, 'conflict')
})

test('checkFieldContextStatus: "unverified" for an unrecognized field name — fails closed, never throws, never "consistent"', () => {
  assert.equal(checkFieldContextStatus('opening_hours', 'x', ['y']), 'unverified')
})

test('checkFieldContextStatus: "unverified" for a non-array otherValues — fails closed, never throws', () => {
  assert.equal(checkFieldContextStatus('address', 'x', null), 'unverified')
  assert.equal(checkFieldContextStatus('address', 'x', undefined), 'unverified')
})

test('checkFieldContextStatus: name/category use the same substring-inclusive comparison already proven for restaurant names', () => {
  assert.equal(checkFieldContextStatus('name', 'De Botanist Breda', ['De Botanist']), 'consistent')
  assert.equal(checkFieldContextStatus('name', 'De Botanist Breda', ["Bobbi's Bar"]), 'conflict')
  assert.equal(checkFieldContextStatus('category', 'Restaurant', ['Restaurant']), 'consistent')
})

// ─── Structural safety net ────────────────────────────────────────────────

test('structural safety net: reuses the existing, already-tested comparers — never a new, independently invented fuzzy-match heuristic', () => {
  const source = fs.readFileSync(require.resolve('./fieldContextConflict.js'), 'utf8')
  assert.match(source, /require\(['"]\.\/candidateSuggestions['"]\)/)
  assert.match(source, /require\(['"]\.\/candidateNormalization['"]\)/)
})

test('structural safety net: never fetches, never touches the database layer or the DOM', () => {
  const source = fs.readFileSync(require.resolve('./fieldContextConflict.js'), 'utf8')
  assert.doesNotMatch(source, /fetch\(|safeOutboundFetch|supabase/i)
  assert.doesNotMatch(source, /document\.|window\./)
})

test('structural safety net: the module no longer defines or exports the old boolean-returning function — only its own header comment may still name it, as history', () => {
  const source = fs.readFileSync(require.resolve('./fieldContextConflict.js'), 'utf8')
  assert.doesNotMatch(source, /function detectFieldContextConflict/)
  assert.doesNotMatch(source, /^\s*detectFieldContextConflict,?\s*$/m)
  assert.equal(typeof require('./fieldContextConflict').detectFieldContextConflict, 'undefined')
})

test('structural safety net: the module exposes exactly the three documented context statuses', () => {
  const source = fs.readFileSync(require.resolve('./fieldContextConflict.js'), 'utf8')
  for (const status of ['consistent', 'conflict', 'unverified']) {
    assert.ok(source.includes(`'${status}'`), `expected the module to return '${status}'`)
  }
})
