'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const manifestData = require('./manifest.json')
const { FIXTURE_IDS, buildFixture } = require('./fixtures')

test('buildFixture: returns null for an unknown fixture id, never throws', () => {
  assert.equal(buildFixture('does-not-exist'), null)
})

test('every fixtureId referenced by manifest.json resolves to a real fixture builder', () => {
  for (const entry of manifestData) {
    if (entry.fixtureId === null) continue
    assert.ok(FIXTURE_IDS.includes(entry.fixtureId), `manifest entry ${entry.id} references unknown fixtureId ${entry.fixtureId}`)
    assert.ok(buildFixture(entry.fixtureId), `fixtureId ${entry.fixtureId} did not build`)
  }
})

test('every fixture homepage URL is on the .invalid TLD — never a real, resolvable domain', () => {
  for (const fixtureId of FIXTURE_IDS) {
    const fixture = buildFixture(fixtureId)
    if (!fixture.homepageUrl) continue
    const host = new URL(fixture.homepageUrl).hostname
    assert.ok(host.endsWith('.invalid'), `${fixtureId}'s homepageUrl host "${host}" is not on the .invalid TLD`)
  }
})

test('a PDF-entry fixture supplies pdfBase64 and no homepageHtml; an HTML-entry fixture is the reverse', () => {
  for (const fixtureId of FIXTURE_IDS) {
    const fixture = buildFixture(fixtureId)
    if (fixture.entryIsPdf) {
      assert.ok(typeof fixture.pdfBase64 === 'string' && fixture.pdfBase64.length > 0)
      assert.equal(fixture.homepageHtml, null)
    } else {
      assert.ok(typeof fixture.homepageHtml === 'string' && fixture.homepageHtml.length > 0)
      assert.equal(fixture.pdfBase64, null)
    }
  }
})

test('every candidateResponses key is an absolute URL actually linked from that fixture\'s own homepageHtml', () => {
  for (const fixtureId of FIXTURE_IDS) {
    const fixture = buildFixture(fixtureId)
    for (const candidateUrl of Object.keys(fixture.candidateResponses)) {
      const path = new URL(candidateUrl).pathname
      assert.ok(
        fixture.homepageHtml && fixture.homepageHtml.includes(`href="${path}"`),
        `${fixtureId}: candidate ${candidateUrl} is never actually linked from its own homepageHtml`
      )
    }
  }
})
