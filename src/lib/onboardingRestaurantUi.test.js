'use strict'

// Structural safety net for BE-20's app/internal/onboarding-restaurant/page.js.
// Never claims to have visually tested this UI (no browser is available in
// this environment) — asserts the source-level guarantees that matter
// most, mirroring src/lib/onboardingMenuConceptUi.test.js's own approach
// for the sibling BE-19 page.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const PAGE_PATH = path.join(REPO_ROOT, 'app/internal/onboarding-restaurant/page.js')

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8')
}

test('structural safety net: calls the new restaurant-analysis-jobs endpoint, never the BE-18 read-url endpoint', () => {
  const source = readPageSource()
  assert.match(source, /\/api\/internal\/v1\/restaurant-analysis-jobs/)
  assert.doesNotMatch(source, /\/api\/internal\/v1\/onboarding-menu\/read-url/)
})

test('structural safety net: states plainly that nothing is published automatically, before any analysis starts', () => {
  const source = readPageSource()
  assert.match(source, /Nog niets wordt gepubliceerd/)
})

test('structural safety net: createConceptFromReceipt sends only receipt_id/source_url/an explicit duplicate confirmation — never a restaurant field, menu field, or extracted content', () => {
  const source = readPageSource()
  const fnStart = source.indexOf('async function createConceptFromReceipt')
  assert.ok(fnStart !== -1, 'expected to find createConceptFromReceipt')
  const fnBody = source.slice(fnStart, source.indexOf('\n  }', fnStart) + 4)
  assert.match(fnBody, /receipt_id: result\.receipt\.id/)
  assert.match(fnBody, /source_url: sourceUrlInput/)
  assert.doesNotMatch(fnBody, /restaurant_match_type/)
  assert.doesNotMatch(fnBody, /matched_restaurant_id/)
  assert.doesNotMatch(fnBody, /field_evidence/)
})

test('structural safety net: every field with insufficient evidence is marked "Handmatige beoordeling nodig", never silently shown as if it were confirmed', () => {
  const source = readPageSource()
  assert.match(source, /Handmatige beoordeling nodig/)
  assert.match(source, /!evidence\.reviewReady/)
})

test('structural safety net: an unknown menu context is shown as an explicit reviewer-facing item, never silently dropped', () => {
  const source = readPageSource()
  assert.match(source, /onbekende sectie/)
  assert.match(source, /unknownMenuContexts\.map/)
})

test('structural safety net: menu proposals are only ever offered for a confirmed restaurant identity — never alongside the restaurant-concept-creation path', () => {
  const source = readPageSource()
  assert.match(source, /!needsRestaurantChoice && foundMenus\.map/)
  assert.match(source, /!needsRestaurantChoice && foundMenus\.length > 0/)
})

test('structural safety net: no image, photo, or <img> element anywhere on this page — no restaurant/dish photography', () => {
  const source = readPageSource()
  assert.doesNotMatch(source, /<img\b/i)
  assert.doesNotMatch(source, /next\/image/)
})

test('structural safety net: reuses the shared InternalNav shell and the existing session-gated loading pattern', () => {
  const source = readPageSource()
  assert.match(source, /import InternalNav from ['"]@\/src\/components\/InternalNav['"]/)
  assert.match(source, /const supabase = getSupabaseBrowser\(\)/)
  assert.match(source, /supabase\.auth\.getSession\(\)/)
  assert.match(source, /router\.replace\(['"]\/internal\/login['"]\)/)
})

test('structural safety net: starting a new analysis resets all previous concept/menu-proposal state — never carries a stale result across runs', () => {
  const source = readPageSource()
  const fnStart = source.indexOf('async function runAnalysis')
  const fnBody = source.slice(fnStart, source.indexOf('\n  }', fnStart))
  assert.match(fnBody, /setConceptError\(null\)/)
  assert.match(fnBody, /setConceptDuplicateOf\(null\)/)
  assert.match(fnBody, /setConceptResult\(null\)/)
  assert.match(fnBody, /setUrlIntakeId\(null\)/)
})
