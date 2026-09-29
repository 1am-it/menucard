// BE-21 — provider-neutral adapter contract for the benchmark
// foundation. Every adapter (today: `deterministic`, the exact BE-20
// pipeline, reused unchanged; later: `ai_structured`, `ocr`, both
// deliberately unavailable stubs today) resolves the SAME shape, so
// `scoring.js`/`runner.js` never need to know which kind produced a
// result.
//
// **The one rule this whole file exists to enforce structurally, not
// just by convention**: "een benchmark mag nooit een hogere
// betrouwbaarheid rapporteren dan BE-20 zelf toestaat." An adapter
// result NEVER carries a pre-computed `confidence` value — only the raw
// evidence inputs BE-20's own `src/lib/fieldConfidence.js`'s
// `deriveFieldConfidence` needs (`extractionMethod`, `hasContentHash`,
// `contextStatus`). `scoring.js` is the only place confidence is ever
// derived, by calling that exact, unmodified BE-20 function — never by
// trusting a value an adapter claims for itself. This makes "no adapter
// can ever report a higher confidence than BE-20 allows" true by
// construction: there is no code path through which a self-reported
// confidence could reach the report at all, deterministic or not.
//
// Isolated tooling, never imported by product code — see manifest.js's
// own header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const { runRestaurantSourceAnalysis, countWords } = require('../../src/lib/restaurantSourceAnalysis')
const { extractDigitalPdfText, PdfExtractionError } = require('../../src/lib/pdfTextExtraction')
const { computeFieldEvidenceHash } = require('../../src/lib/fieldEvidenceHash')

/** The only adapter kinds this contract knows about. `ai_structured` and
 * `ocr` name the exact two capabilities be-21's own ticket exists to
 * benchmark — both intentionally unavailable in every build this
 * foundation ships, per this checkpoint's own hard boundary (no external
 * AI/OCR provider, no vendor account, no secret). */
const ADAPTER_KINDS = ['deterministic', 'ai_structured', 'ocr']

/** Builds the `fetchCandidate` function `runRestaurantSourceAnalysis`
 * requires, from a fixture's own plain `candidateResponses` map — an
 * exact-URL lookup, never a real network call. An undeclared candidate
 * URL (should not happen for a well-formed fixture; see
 * `fixtures.test.js`'s own check that every candidate is actually linked)
 * fails closed as `{ status: 'error' }`, never guessed at. */
function fetchCandidateFromFixture(candidateResponses) {
  return async function fetchCandidate(url) {
    return candidateResponses[url] || { status: 'error' }
  }
}

/**
 * Runs BE-20's own, unmodified deterministic pipeline against one
 * fixture. Never mutates, wraps, or re-derives anything BE-20 itself
 * computes — for the PDF-entry path, mirrors
 * `app/api/internal/v1/restaurant-analysis-jobs/route.js`'s own "entry
 * URL itself is a PDF" branch exactly (the same functions, in the same
 * order), since that branch lives in the route, not in
 * `runRestaurantSourceAnalysis` itself, and this benchmark needs to
 * exercise it too. Always resolves the shared `AdapterResult` shape —
 * see this file's own header for why it never carries a computed
 * `confidence`.
 */
function createDeterministicAdapter() {
  return {
    kind: 'deterministic',
    available: true,
    async run(fixture) {
      try {
        if (fixture.entryIsPdf) {
          const pdfBytes = Buffer.from(fixture.pdfBase64, 'base64')
          try {
            const pdfResult = await extractDigitalPdfText(pdfBytes)
            return {
              kind: 'deterministic',
              available: true,
              fields: {},
              menuContextNames: [],
              unknownMenuContextCount: 1,
              errors: [],
              notes: [],
              _internal: {
                unknownMenuContexts: [
                  {
                    extractionMethod: 'pdf_text',
                    pageCount: pdfResult.pageCount,
                    wordCount: countWords(pdfResult.text),
                    hasContentHash: Boolean(computeFieldEvidenceHash(pdfResult.text)),
                  },
                ],
              },
            }
          } catch (err) {
            // The RAW PdfExtractionError.reason (e.g. `pdf_encrypted`,
            // `pdf_no_text_layer`), never the job-level rolled-up
            // `pdf_extraction_failed` — this benchmark scores against
            // the same fine-grained, closed vocabulary
            // `manifest.json`'s own `expectedErrorCode` uses, matching
            // `src/lib/pdfTextExtraction.js`'s own `ALLOWED_PDF_ERROR_REASONS`
            // exactly. The coarser job-level rollup
            // (`src/lib/restaurantSourceAnalysisJobs.js`'s own
            // `rollUpPdfAdapterErrorReason`) is a separate, already-tested
            // concern this benchmark does not need to re-exercise.
            const reason = err instanceof PdfExtractionError ? err.reason : 'pdf_corrupt'
            return {
              kind: 'deterministic',
              available: true,
              fields: {},
              menuContextNames: [],
              unknownMenuContextCount: 0,
              errors: [{ code: reason }],
              notes: [],
              _internal: { unknownMenuContexts: [] },
            }
          }
        }

        const result = await runRestaurantSourceAnalysis({
          homepageHtml: fixture.homepageHtml,
          homepageUrl: fixture.homepageUrl,
          fetchCandidate: fetchCandidateFromFixture(fixture.candidateResponses),
        })

        const fields = {}
        for (const [fieldName, evidence] of Object.entries(result.fieldEvidence)) {
          // Deliberately only the raw evidence inputs — never
          // `evidence.confidence`/`evidence.reviewReady`, both of which
          // BE-20 itself already computed. This adapter passes through
          // BE-20's own field VALUE and evidence unchanged, but
          // `scoring.js` re-derives confidence itself; see this file's
          // own header comment for why.
          fields[fieldName] = {
            value: evidence.value,
            extractionMethod: evidence.extractionMethod,
            hasContentHash: Boolean(evidence.contentHash),
            contextStatus: evidence.contextStatus,
          }
        }

        return {
          kind: 'deterministic',
          available: true,
          fields,
          menuContextNames: result.menuContexts.map((m) => m.name),
          unknownMenuContextCount: result.unknownMenuContexts.length,
          errors: [],
          notes: result.notes,
          _internal: { unknownMenuContexts: result.unknownMenuContexts },
        }
      } catch (err) {
        // Defense in depth only — every documented, expected failure
        // above already resolves normally. An adapter must never throw
        // an unhandled exception into the runner.
        return {
          kind: 'deterministic',
          available: true,
          fields: {},
          menuContextNames: [],
          unknownMenuContextCount: 0,
          errors: [{ code: 'internal_error' }],
          notes: [],
          _internal: { unknownMenuContexts: [] },
        }
      }
    },
  }
}

/**
 * A deliberately unavailable stub for a capability this build never
 * activates — mirrors `src/lib/claudeStructuringAdapter.js`'s own
 * `{ enabled: false }` pattern exactly: no network call, no secret read,
 * no fabricated result. Proves the contract is genuinely pluggable
 * (`runner.js` can iterate `[deterministic, aiStructured, ocr]`
 * uniformly) without activating anything this checkpoint's own hard
 * boundaries forbid.
 */
function createUnavailableAdapter(kind) {
  if (!ADAPTER_KINDS.includes(kind) || kind === 'deterministic') {
    throw new Error(`createUnavailableAdapter is only for a non-deterministic kind, got: ${kind}`)
  }
  return {
    kind,
    available: false,
    async run() {
      return {
        kind,
        available: false,
        reason: 'not_activated_in_this_environment',
        fields: {},
        menuContextNames: [],
        unknownMenuContextCount: 0,
        errors: [],
        notes: [`${kind} was not evaluated — no vendor, secret, or account is configured in this environment.`],
        _internal: { unknownMenuContexts: [] },
      }
    },
  }
}

/**
 * Structural guard: fails loudly if an `AdapterResult` ever smuggles a
 * `confidence` or `reviewReady` key on any field — the one shape
 * violation that would silently defeat this file's own central
 * guarantee. `runner.js` calls this explicitly, as defense in depth,
 * immediately after every `adapter.run(...)` and before handing the
 * result to `scoring.js`'s `scoreCase` — never scoring a result this
 * guard has not already passed. `scoring.js` itself provides the
 * primary guarantee regardless (it only ever reads `.value`/
 * `.extractionMethod`/`.hasContentHash`/`.contextStatus` off a field and
 * always re-derives confidence itself via BE-20's own
 * `deriveFieldConfidence`, so a smuggled `confidence` value could never
 * reach a report even without this guard) — this function's own job is
 * to turn that silent no-op into a loud, immediate failure instead, so a
 * future buggy or malicious adapter is caught at the moment it
 * misbehaves, not left to be caught only by a test happening to notice.
 */
function assertNeverCarriesPrecomputedConfidence(adapterResult) {
  for (const [fieldName, evidence] of Object.entries(adapterResult.fields || {})) {
    if (evidence && (Object.prototype.hasOwnProperty.call(evidence, 'confidence') || Object.prototype.hasOwnProperty.call(evidence, 'reviewReady'))) {
      throw new Error(`AdapterResult field "${fieldName}" carries a precomputed confidence/reviewReady value — forbidden by this contract`)
    }
  }
}

module.exports = {
  ADAPTER_KINDS,
  createDeterministicAdapter,
  createUnavailableAdapter,
  assertNeverCarriesPrecomputedConfidence,
}
