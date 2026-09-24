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
// No context-conflict detection (e.g. a chain/head-office address on a
// location-specific page) is implemented in fase 1 — `hasContextConflict`
// is always passed as `false` to deriveFieldConfidence below. This is a
// deliberate, documented fase-1 gap, not a claim that no conflict could
// exist: a field's confidence still correctly caps at `middel` without it
// (deriveFieldConfidence's own default), it simply never reaches the
// stricter `laag` outcome a detected conflict would produce. Building
// that detection is separate, later work.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

const { extractMenusFromHtml } = require('./menuJsonLdExtraction')
const { findSameHostMenuCandidates } = require('./sameHostDiscovery')
const { extractRestaurantFieldsWithEvidence } = require('./restaurantFieldEvidence')
const { ALLOWED_FIELD_NAMES, deriveFieldConfidence, isFieldReviewReady } = require('./fieldConfidence')
const { computeFieldEvidenceHash } = require('./fieldEvidenceHash')
const { extractDigitalPdfText, PdfExtractionError } = require('./pdfTextExtraction')
const { rollUpPdfAdapterErrorReason } = require('./restaurantSourceAnalysisJobs')
const { composeEvidenceBasedDescription } = require('./restaurantConceptDescription')
const { runClaudeStructuringAdapter } = require('./claudeStructuringAdapter')

/** How much of a discovered PDF's extracted text is kept for the review
 * UI's own preview — a bounded excerpt, never the full text duplicated
 * into the job's `field_evidence` column (matches this project's existing
 * data-minimisation convention, e.g. url-intake-schema.md's own bounded
 * menu-candidate summary). The content-hash below still covers the FULL
 * extracted text, not just this preview. */
const UNKNOWN_MENU_TEXT_PREVIEW_LENGTH = 280

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

  // 2. Homepage field evidence — first source wins per field; a later
  // candidate page only ever fills a field the homepage itself left
  // absent (see the loop below), never overrides an already-found one.
  const fieldsByName = {}
  const homepageFieldEvidence = extractRestaurantFieldsWithEvidence(homepageHtml)
  for (const fieldName of ALLOWED_FIELD_NAMES) {
    const found = homepageFieldEvidence[fieldName]
    if (found) fieldsByName[fieldName] = { ...found, sourceUrl: homepageUrl }
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
        if (fieldsByName[fieldName]) continue
        const found = candidateFieldEvidence[fieldName]
        if (found) fieldsByName[fieldName] = { ...found, sourceUrl: fetched.finalUrl || candidate.url }
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
        unknownMenuContexts.push({
          sourceUrl: fetched.finalUrl || candidate.url,
          extractionMethod: 'pdf_text',
          pageCount: pdfResult.pageCount,
          contentHash: computeFieldEvidenceHash(pdfResult.text),
          textPreview: pdfResult.text.slice(0, UNKNOWN_MENU_TEXT_PREVIEW_LENGTH),
        })
      } catch (err) {
        if (!(err instanceof PdfExtractionError)) throw err
        notes.push(`PDF op ${candidate.url} kon niet worden gelezen (${rollUpPdfAdapterErrorReason(err.reason)}).`)
      }
      continue
    }
  }

  // 4. Confidence + content-hash evidence, per field — never `hoog` for a
  // deterministic extractor alone (src/lib/fieldConfidence.js's own,
  // already-tested rule); every field surfaces exactly what it is.
  const restaurantCandidateFields = {}
  const fieldEvidence = {}
  for (const fieldName of ALLOWED_FIELD_NAMES) {
    const found = fieldsByName[fieldName]
    if (!found) continue
    restaurantCandidateFields[fieldName] = found.value
    const contentHash = computeFieldEvidenceHash(found.rawSourceFragment)
    const confidence = deriveFieldConfidence({
      fieldName,
      value: found.value,
      extractionMethod: found.extractionMethod,
      hasContentHash: Boolean(contentHash),
      hasContextConflict: false,
    })
    fieldEvidence[fieldName] = {
      value: found.value,
      extractionMethod: found.extractionMethod,
      sourceUrl: found.sourceUrl,
      contentHash,
      confidence,
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
  UNKNOWN_MENU_TEXT_PREVIEW_LENGTH,
  runRestaurantSourceAnalysis,
}
