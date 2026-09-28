// BE-20 — the fase-1 general restaurant source analysis pipeline: turns
// one already-fetched homepage into a reviewable restaurant-field/menu-
// context result, exactly as planning/specs/tickets/be-20-general-restaurant-source-extraction.md
// describes. This is the one place all of this ticket's new building
// blocks are wired together — same-host discovery, digital PDF text
// extraction, per-field source evidence, confidence, the evidence-based
// description, and the (always-disabled-today) Claude structuring
// boundary. Every one of those modules is reused UNCHANGED here; this
// file only orchestrates the order they run in and assembles their
// outputs.
//
// **Deliberately never fetches anything itself.** `fetchCandidate` is
// injected so this module's own logic (branching, dedup, confidence
// assembly) is fully unit-testable without a real network call — the
// caller (a route handler) supplies the real implementation, which must
// itself perform the same robots.txt-then-safe-outbound-fetch gate this
// project's own existing app/api/internal/v1/onboarding-menu/read-url/route.js
// already applies to its own single fetch, per this ticket's own
// "Vaststaande productkeuzes" §6 and §8 (same-host discovery bounded to
// one extra hop, this project's existing SSRF-hardened fetch helper as
// the only egress, a robots.txt check for every candidate). `fetchCandidate(url)` must resolve to
// exactly one of:
//   - `{ status: 'blocked' }` — robots.txt disallowed, or the URL was
//     otherwise unsafe to fetch at all.
//   - `{ status: 'error' }` — the fetch itself failed (network error,
//     timeout, non-2xx).
//   - `{ status: 'html', body, finalUrl }` — a successful HTML fetch.
//   - `{ status: 'pdf', bytes, finalUrl }` — a successful PDF fetch (raw
//     bytes, not yet text-extracted — that happens here).
// Never throws for a normal blocked/error/unsupported outcome — one
// candidate failing is only ever reported as a plain-language note,
// never a reason to fail the whole analysis (mirrors the ticket's own
// batch philosophy: "Elke URL wordt afzonderlijk beoordeeld en fouten
// blokkeren de rest niet," applied here one level down, to candidates
// within a single job).
//
// Server-only by inheritance: transitively requires src/lib/fieldEvidenceHash.js
// (node:crypto) and dynamically imports pdfjs-dist via
// src/lib/pdfTextExtraction.js — only a server-side route handler may call
// this module, never client code.
//
// Context validation (e.g. a chain/head-office address on a location-
// specific page) is real, not hardcoded — see
// src/lib/fieldContextConflict.js's own `checkFieldContextStatus`, which
// returns one of three explicit outcomes, never a boolean:
// `'conflict'` (actively compared against another same-site sighting and
// found to genuinely differ) caps a field at `laag`; `'consistent'`
// (actively compared and confirmed) is the only outcome that ever permits
// `hoog`, and only alongside a valid content-hash and a passed
// plausibility check; `'unverified'` (no comparable second sighting
// exists at all, or every comparison was inconclusive) caps a field at
// `middel`, exactly the same as `'conflict'`'s ceiling of `laag` is a
// stronger signal than "not yet checked."
//
// **Corrected 2026-09-24, following an independent review.** An earlier
// version of this module computed a plain boolean here that was `false`
// both when a field was genuinely validated as consistent AND when there
// was nothing at all to compare against (the common case — same-host
// discovery often finds no candidates, or a found candidate simply does
// not restate a given field) — silently treating "never checked" as "no
// conflict," which let `hoog` be reached from content-hash + plausibility
// alone far more often than intended. `checkFieldContextStatus`'s
// explicit `'unverified'` outcome, and `deriveFieldConfidence`'s own
// matching rule (src/lib/fieldConfidence.js), close that gap: `hoog` now
// requires a positively confirmed `'consistent'` status, never merely the
// absence of a detected conflict.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

const { extractMenusFromHtml } = require('./menuJsonLdExtraction')
const { findSameHostMenuCandidates } = require('./sameHostDiscovery')
const { extractRestaurantFieldsWithEvidence } = require('./restaurantFieldEvidence')
const { ALLOWED_FIELD_NAMES, deriveFieldConfidence, isFieldReviewReady } = require('./fieldConfidence')
const { computeFieldEvidenceHash } = require('./fieldEvidenceHash')
const { checkFieldContextStatus } = require('./fieldContextConflict')
const { extractDigitalPdfText, PdfExtractionError } = require('./pdfTextExtraction')
const { rollUpPdfAdapterErrorReason } = require('./restaurantSourceAnalysisJobs')
const { composeEvidenceBasedDescription } = require('./restaurantConceptDescription')
const { runClaudeStructuringAdapter } = require('./claudeStructuringAdapter')

/** A safe, derived signal for a discovered PDF's own review metadata —
 * never the raw text itself. See the "unknown menu context" assembly
 * below for why: unlike every structured restaurant field elsewhere in
 * this pipeline, a PDF's own text has no fixed field allowlist to draw
 * from, so no excerpt of it — however short — is ever stored or
 * displayed. */
function countWords(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return 0
  return text.trim().split(/\s+/).length
}

/**
 * Runs the full fase-1 analysis. Returns
 * `{ restaurantCandidateFields, fieldEvidence, menuContexts,
 * unknownMenuContexts, description, notes }` — never throws for a normal,
 * partial-evidence outcome; only an unexpected, non-PdfExtractionError
 * failure from an injected dependency propagates.
 *
 * `restaurantCandidateFields` is exactly the shape
 * src/lib/urlIntakes.js's own `buildRestaurantCandidateSummary` expects —
 * this module never widens or changes that reused, unchanged contract.
 * `menuContexts` carries the extra `extractionMethod`/`sourceUrl` fields
 * for this module's own review UI; `buildMenuCandidateSummary` already
 * only reads `name`/`contextSlug`/`categories` from each entry, so those
 * additions are inert to the existing, unchanged receipt/promotion path.
 */
async function runRestaurantSourceAnalysis({ homepageHtml, homepageUrl, fetchCandidate }) {
  const menuContexts = []
  const unknownMenuContexts = []
  const notes = []

  // 1. Homepage menu structure — BE-18's own extractor, unchanged.
  for (const menu of extractMenusFromHtml(homepageHtml)) {
    menuContexts.push({ ...menu, extractionMethod: 'json_ld', sourceUrl: homepageUrl })
  }

  // 2. Homepage field evidence — first source wins per field for the
  // actual value/evidence/hash a candidate page only ever fills a field
  // the homepage itself left absent (see the loop below), never
  // overrides an already-found one. Every OTHER, later-found value for a
  // field this analysis already has a primary value for is kept
  // separately, in `otherFieldValuesByName`, purely for the context-
  // conflict check in step 4 below — never used as evidence itself.
  const fieldsByName = {}
  const otherFieldValuesByName = {}
  for (const fieldName of ALLOWED_FIELD_NAMES) otherFieldValuesByName[fieldName] = []

  function recordFieldSighting(fieldName, found, sourceUrl) {
    if (!found) return
    if (!fieldsByName[fieldName]) {
      fieldsByName[fieldName] = { ...found, sourceUrl }
    } else {
      otherFieldValuesByName[fieldName].push(found.value)
    }
  }

  const homepageFieldEvidence = extractRestaurantFieldsWithEvidence(homepageHtml)
  for (const fieldName of ALLOWED_FIELD_NAMES) {
    recordFieldSighting(fieldName, homepageFieldEvidence[fieldName], homepageUrl)
  }

  // 3. Bounded same-host discovery — at most sameHostDiscovery.js's own
  // MAX_CANDIDATES links, each fetched at most once, never a second hop
  // from any of them (this loop never itself calls findSameHostMenuCandidates
  // again on a candidate's own body).
  const candidates = findSameHostMenuCandidates(homepageHtml, homepageUrl)
  for (const candidate of candidates) {
    let fetched
    try {
      fetched = await fetchCandidate(candidate.url)
    } catch {
      fetched = { status: 'error' }
    }

    if (!fetched || fetched.status === 'blocked') {
      notes.push(`Kon ${candidate.url} niet automatisch raadplegen (robots.txt of een onveilige bron).`)
      continue
    }
    if (fetched.status === 'error') {
      notes.push(`Ophalen van ${candidate.url} is mislukt.`)
      continue
    }

    if (fetched.status === 'html') {
      const existingSlugs = new Set(menuContexts.map((m) => m.contextSlug))
      for (const menu of extractMenusFromHtml(fetched.body)) {
        if (existingSlugs.has(menu.contextSlug)) continue
        menuContexts.push({ ...menu, extractionMethod: 'html', sourceUrl: fetched.finalUrl || candidate.url })
        existingSlugs.add(menu.contextSlug)
      }
      const candidateFieldEvidence = extractRestaurantFieldsWithEvidence(fetched.body)
      for (const fieldName of ALLOWED_FIELD_NAMES) {
        recordFieldSighting(fieldName, candidateFieldEvidence[fieldName], fetched.finalUrl || candidate.url)
      }
      continue
    }

    if (fetched.status === 'pdf') {
      try {
        const pdfResult = await extractDigitalPdfText(fetched.bytes)
        // A digital PDF's text is never itself a confidently-named,
        // structured menu context without AI structuring (disabled today
        // — see runClaudeStructuringAdapter below) — surfaced instead as
        // an explicit, reviewer-facing "unknown menu context," per the
        // ticket's own acceptance criterion for a section the system
        // found but could not confidently categorize.
        //
        // Deliberately never a raw text excerpt here — an earlier version
        // of this module kept a bounded (280-character) raw preview of
        // the extracted PDF text, which an independent review correctly
        // flagged: unlike every structured restaurant field elsewhere in
        // this pipeline (always drawn from the fixed name/category/
        // address/phone/website allowlist), a PDF's own header/footer
        // could incidentally include something outside that allowlist
        // (e.g. a name). `wordCount` gives a reviewer a real, useful
        // signal ("this PDF has substantial content") without ever
        // storing or displaying any of the PDF's own words.
        unknownMenuContexts.push({
          sourceUrl: fetched.finalUrl || candidate.url,
          extractionMethod: 'pdf_text',
          pageCount: pdfResult.pageCount,
          wordCount: countWords(pdfResult.text),
          contentHash: computeFieldEvidenceHash(pdfResult.text),
        })
      } catch (err) {
        // Any failure here — a properly-typed PdfExtractionError, or, as
        // defense in depth, any other unexpected error — is reported as a
        // plain-language note and never re-thrown: one bad candidate PDF
        // must never crash the rest of this analysis.
        const reason = err instanceof PdfExtractionError ? rollUpPdfAdapterErrorReason(err.reason) : 'pdf_extraction_failed'
        notes.push(`PDF op ${candidate.url} kon niet worden gelezen (${reason}).`)
      }
      continue
    }
  }

  // 4. Confidence + content-hash evidence, per field — never `hoog` for a
  // deterministic extractor alone (src/lib/fieldConfidence.js's own,
  // already-tested rule); every field surfaces exactly what it is.
  // `contextStatus` is a real, explainable, server-side, three-way check
  // (see src/lib/fieldContextConflict.js's own `checkFieldContextStatus`):
  // `'consistent'` only when this same analysis actively compared this
  // field's value against another same-site sighting and confirmed it
  // matches; `'conflict'` when a comparison found a genuine mismatch
  // (e.g. a different Dutch postcode); `'unverified'` when there is
  // nothing comparable at all (no other sighting, a blocked/failed
  // candidate, or an incomparable value). Only `'consistent'` can ever
  // lead to `hoog` — `'unverified'` is capped at `middel` the same as
  // having no context signal at all, never silently treated as
  // equivalent to a confirmed absence of conflict.
  const restaurantCandidateFields = {}
  const fieldEvidence = {}
  for (const fieldName of ALLOWED_FIELD_NAMES) {
    const found = fieldsByName[fieldName]
    if (!found) continue
    restaurantCandidateFields[fieldName] = found.value
    const contentHash = computeFieldEvidenceHash(found.rawSourceFragment)
    const contextStatus = checkFieldContextStatus(fieldName, found.value, otherFieldValuesByName[fieldName])
    const confidence = deriveFieldConfidence({
      fieldName,
      value: found.value,
      extractionMethod: found.extractionMethod,
      hasContentHash: Boolean(contentHash),
      contextStatus,
    })
    fieldEvidence[fieldName] = {
      value: found.value,
      extractionMethod: found.extractionMethod,
      sourceUrl: found.sourceUrl,
      contentHash,
      confidence,
      contextStatus,
      reviewReady: isFieldReviewReady({ hasContentHash: Boolean(contentHash), confidence }),
    }
  }

  // 5. The evidence-based short description — only from fields this same
  // analysis already confirmed review-ready, never a lower-confidence
  // guess dressed up as a fact.
  const description = composeEvidenceBasedDescription({
    name: fieldEvidence.name && fieldEvidence.name.reviewReady ? fieldEvidence.name.value : null,
    category: fieldEvidence.category && fieldEvidence.category.reviewReady ? fieldEvidence.category.value : null,
    address: fieldEvidence.address && fieldEvidence.address.reviewReady ? fieldEvidence.address.value : null,
  })

  // 6. The Claude adapter boundary — always disabled in this build (see
  // src/lib/claudeStructuringAdapter.js's own header), so this notice
  // always appears today; kept as a real conditional, not a hardcoded
  // string, so a later, real adapter changes this behavior automatically
  // rather than requiring this call site to be rewritten.
  const claudeResult = await runClaudeStructuringAdapter({ homepageHtml, unknownMenuContexts })
  if (!claudeResult.enabled) {
    notes.push('AI-structurering is niet beschikbaar — resultaten zijn beperkt tot deterministische extractie.')
  }

  return { restaurantCandidateFields, fieldEvidence, menuContexts, unknownMenuContexts, description, notes }
}

module.exports = {
  countWords,
  runRestaurantSourceAnalysis,
}
