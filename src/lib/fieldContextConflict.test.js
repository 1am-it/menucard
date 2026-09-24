'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { phonesLikelyMatch, websitesLikelyMatch, detectFieldContextConflict } = require('./fieldContextConflict')

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

test('detectFieldContextConflict: false when there are no other sightings at all', () => {
  assert.equal(detectFieldContextConflict('address', 'Tolbrugstraat 19, 4811 WN Breda', []), false)
})

test('detectFieldContextConflict: true for address — a different Dutch postcode found on another page', () => {
  const result = detectFieldContextConflict('address', 'Tolbrugstraat 19, 4811 WN Breda', ['Hoofdkantoor 1, 1011 AB Amsterdam'])
  assert.equal(result, true)
})

test('detectFieldContextConflict: false for address — the same postcode restated on another page', () => {
  const result = detectFieldContextConflict('address', 'Tolbrugstraat 19, 4811 WN Breda', ['4811 WN Breda (ingang achterzijde)'])
  assert.equal(result, false)
})

test('detectFieldContextConflict: true for phone — a genuinely different number found elsewhere', () => {
  assert.equal(detectFieldContextConflict('phone', '076 3032490', ['020 1234567']), true)
})

test('detectFieldContextConflict: true for website — a different host found elsewhere', () => {
  assert.equal(detectFieldContextConflict('website', 'https://debotanistbreda.nl/', ['https://someotherchain.nl/']), true)
})

test('detectFieldContextConflict: false when every other sighting is inconclusive, never guessed into a conflict', () => {
  const result = detectFieldContextConflict('address', 'Tolbrugstraat 19, 4811 WN Breda', ['geen adres gevonden', ''])
  assert.equal(result, false)
})

test('detectFieldContextConflict: false for an unrecognized field name — fails closed, never throws', () => {
  assert.equal(detectFieldContextConflict('opening_hours', 'x', ['y']), false)
})

test('detectFieldContextConflict: false for a non-array otherValues — fails closed, never throws', () => {
  assert.equal(detectFieldContextConflict('address', 'x', null), false)
  assert.equal(detectFieldContextConflict('address', 'x', undefined), false)
})

test('detectFieldContextConflict: name/category use the same substring-inclusive comparison already proven for restaurant names', () => {
  assert.equal(detectFieldContextConflict('name', 'De Botanist Breda', ['De Botanist']), false)
  assert.equal(detectFieldContextConflict('name', 'De Botanist Breda', ["Bobbi's Bar"]), true)
  assert.equal(detectFieldContextConflict('category', 'Restaurant', ['Restaurant']), false)
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
