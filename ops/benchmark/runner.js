// BE-21 — the deterministic, fully offline local benchmark runner. Ties
// `manifest.json` (what to run), `fixtures.js` (the local bytes to run
// against), `adapters.js` (what runs it), and `scoring.js` (how the
// result is judged) together. Never fetches anything — every fixture is
// an in-memory string/byte buffer already committed to this repository;
// see `manifest.js`'s own header for why a `real_benchmark_evidence_pending`
// entry's adapter is never even invoked.
//
// Isolated tooling, never imported by product code — see manifest.js's
// own header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const defaultManifest = require('./manifest.json')
const { validateManifest } = require('./manifest')
const { buildFixture } = require('./fixtures')
const { scoreCase } = require('./scoring')
const { assertNeverCarriesPrecomputedConfidence } = require('./adapters')

/**
 * Runs every entry in `manifest` against every adapter in `adapters`.
 * Returns `{ manifestValid, manifestProblems, caseScores }` — never
 * throws for a normal manifest; throws only for a genuine configuration
 * bug (a manifest entry naming a `fixtureId` that does not resolve to a
 * real fixture), since that can only mean this benchmark's own files are
 * out of sync with each other, never a runtime condition to score around.
 *
 * For a `real_benchmark_evidence_pending` entry, no adapter's `run` is
 * ever called — the case is recorded as `skipped_pending_real_fetch` for
 * every adapter, deterministically, with no fixture build, no timing,
 * and no fetch of any kind. For an unavailable adapter (`available:
 * false`), `run` IS called (so its own honest "not activated" result
 * exists), but the result is never handed to `scoreCase` — it is
 * recorded as `not_evaluated` instead, never blended into ordinary
 * accuracy/miss statistics (see `scoring.js`'s own header on this
 * distinction).
 *
 * Deterministic and reproducible: given the same `manifest`/`adapters`,
 * every case's `status`/`fieldScores`/`menuScore`/`errorClassification`
 * is byte-for-byte identical across runs — only `timingMs` (real wall-
 * clock local execution time, never a vendor latency claim) varies, and
 * is therefore excluded from any reproducibility comparison a caller
 * makes.
 *
 * Every available adapter's result is passed through
 * `adapters.js`'s own `assertNeverCarriesPrecomputedConfidence` — as
 * explicit defense in depth, not the primary guarantee — immediately
 * after it runs and before `scoring.js` ever sees it: a future adapter
 * that smuggles a precomputed `confidence`/`reviewReady` value throws
 * here, loudly and immediately, rather than merely having that value
 * silently ignored by `scoreCase` (which never reads it anyway).
 */
async function runBenchmark({ manifest = defaultManifest, adapters } = {}) {
  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new Error('runBenchmark requires a non-empty adapters array')
  }

  const { valid: manifestValid, problems: manifestProblems } = validateManifest(manifest)

  const caseScores = []
  for (const entry of manifest) {
    if (entry.provenance === 'real_benchmark_evidence_pending') {
      for (const adapter of adapters) {
        caseScores.push({
          caseId: entry.id,
          sourceType: entry.sourceType,
          adapterKind: adapter.kind,
          status: 'skipped_pending_real_fetch',
          reason: 'no real fetch has been performed for this source in this environment',
        })
      }
      continue
    }

    const fixture = buildFixture(entry.fixtureId)
    if (!fixture) {
      throw new Error(`manifest entry "${entry.id}" references fixtureId "${entry.fixtureId}", which does not resolve to a real fixture — this benchmark's own files are out of sync`)
    }

    for (const adapter of adapters) {
      if (!adapter.available) {
        const stubResult = await adapter.run(fixture)
        caseScores.push({
          caseId: entry.id,
          sourceType: entry.sourceType,
          adapterKind: adapter.kind,
          status: 'not_evaluated',
          reason: stubResult.reason || 'adapter unavailable in this environment',
        })
        continue
      }

      const startedAt = process.hrtime.bigint()
      const adapterResult = await adapter.run(fixture)
      const timingMs = Number(process.hrtime.bigint() - startedAt) / 1e6

      // Defense in depth, explicitly wired in — never scores a result
      // that smuggles a precomputed confidence/reviewReady value. Throws
      // immediately, loudly, and before any scoring happens; see
      // adapters.js's own doc comment on this function for why this is
      // additive to, never a substitute for, scoring.js's own primary
      // guarantee (it never reads such a value even when present).
      assertNeverCarriesPrecomputedConfidence(adapterResult)

      const score = scoreCase(entry, adapterResult, { timingMs })
      score.adapterKind = adapter.kind
      caseScores.push(score)
    }
  }

  return { manifestValid, manifestProblems, caseScores }
}

/** Deep-clones `caseScores` with every `timingMs` value replaced by
 * `null` — the one, single place a reproducibility comparison should
 * ever normalize away real wall-clock timing before comparing two runs
 * for equality. Exported so a caller (or a report) never has to
 * reimplement this normalization differently. */
function stripTimingForComparison(caseScores) {
  return caseScores.map((score) => (score && 'timingMs' in score ? { ...score, timingMs: null } : score))
}

module.exports = { runBenchmark, stripTimingForComparison }
