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
// Context-conflict detection (e.g. a chain/head-office address on a
// location-specific page) is real, not hardcoded — see
// src/lib/fieldContextConflict.js: whenever this same analysis finds more
// than one materially different value for the same field across
// different pages of the same site, that field's confidence is capped at
// `laag`, never `hoog`, per deriveFieldConfidence's own rule. An earlier
// version of this module passed a hardcoded `false` here — an
// independent review correctly flagged that as never actually exercising
// the "no context conflict" leg of BE-20's own three-part confidence
// rule. When a comparison is genuinely inconclusive (no other sighting
// exists, or it cannot be compared), the safe default still applies: no
// conflict is asserted, and the field's confidence is decided by the
// normal content-hash-plus-plausibility rule alone.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

const { extractMenusFromHtml } = require('./menuJsonLdExtraction')
const { findSameHostMenuCandidates } = require('./sameHostDiscovery')
const { extractRestaurantFieldsWithEvidence } = require('./restaurantFieldEvidence')
const { ALLOWED_FIELD_NAMES, deriveFieldConfidence, isFieldReviewReady } = require('./fieldConfidence')
const { computeFieldEvidenceHash } = require('./fieldEvidenceHash')
const { detectFieldContextConflict } = require('./fieldContextConflict')
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
  // `hasContextConflict` is a real, explainable, server-side check (see
  // src/lib/fieldContextConflict.js): whether this same analysis also
  // found a DEFINITIVELY different value for this field on another page
  // of the same site (e.g. a different Dutch postcode). When that
  // comparison is inconclusive rather than genuinely absent (no other
  // sighting exists, or every other sighting could not be compared),
  // `detectFieldContextConflict` itself already returns `false` — the
  // safe default this ticket requires: an unconfirmed conflict never
  // promotes a field to `hoog`, it simply leaves the normal content-hash-
  // plus-plausibility rule to decide between `hoog`/`middel`.
  const restaurantCandidateFields = {}
  const fieldEvidence = {}
  for (const fieldName of ALLOWED_FIELD_NAMES) {
    const found = fieldsByName[fieldName]
    if (!found) continue
    restaurantCandidateFields[fieldName] = found.value
    const contentHash = computeFieldEvidenceHash(found.rawSourceFragment)
    const hasContextConflict = detectFieldContextConflict(fieldName, found.value, otherFieldValuesByName[fieldName])
    const confidence = deriveFieldConfidence({
      fieldName,
      value: found.value,
      extractionMethod: found.extractionMethod,
      hasContentHash: Boolean(contentHash),
      hasContextConflict,
    })
    fieldEvidence[fieldName] = {
      value: found.value,
      extractionMethod: found.extractionMethod,
      sourceUrl: found.sourceUrl,
      contentHash,
      confidence,
      contextConflict: hasContextConflict,
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
