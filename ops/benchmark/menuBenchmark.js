// BE-22 — the offline runner for the menu-structure track. Runs every
// synthetic case in htmlMenuFixtures.js against every given adapter and
// scores it with menuScoring.js. Never fetches anything: every case is an
// in-memory, self-written HTML string already in this repository.
//
// Mirrors runner.js's own rules: an unavailable adapter (today the
// `ai_structured` stub from adapters.js) is recorded as `not_evaluated`,
// never blended into scores, and every available adapter's result passes
// adapters.js's `assertNeverCarriesPrecomputedConfidence` before scoring.
//
// Isolated tooling, never imported by product code — see manifest.js's own
// header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const { HTML_MENU_CASES } = require('./htmlMenuFixtures')
const { scoreMenuCase } = require('./menuScoring')
const { assertNeverCarriesPrecomputedConfidence } = require('./adapters')

/** Every synthetic menu case is a single web page with no JSON-LD menu —
 * the `html_only` source type, kept apart from the field track's types. */
const MENU_SOURCE_TYPE = 'html_only'

async function runMenuBenchmark({ cases = HTML_MENU_CASES, adapters } = {}) {
  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new Error('runMenuBenchmark requires a non-empty adapters array')
  }
  const menuCaseScores = []
  for (const menuCase of cases) {
    const sourceType = menuCase.sourceType || MENU_SOURCE_TYPE
    const fixture = { html: menuCase.html }
    for (const adapter of adapters) {
      if (!adapter.available) {
        const stubResult = await adapter.run(fixture)
        menuCaseScores.push({
          caseId: menuCase.id,
          sourceType,
          adapterKind: adapter.kind,
          status: 'not_evaluated',
          reason: stubResult.reason || 'adapter unavailable in this environment',
        })
        continue
      }
      const startedAt = process.hrtime.bigint()
      const adapterResult = await adapter.run(fixture)
      const timingMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      assertNeverCarriesPrecomputedConfidence(adapterResult)
      menuCaseScores.push({ sourceType, adapterKind: adapter.kind, ...scoreMenuCase(menuCase, adapterResult, { timingMs }) })
    }
  }
  return { menuCaseScores }
}

module.exports = { MENU_SOURCE_TYPE, runMenuBenchmark }
