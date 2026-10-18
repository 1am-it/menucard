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
const { normalizeMenuHierarchy } = require('./menuHierarchy')
const { findSameHostMenuCandidates, MAX_CANDIDATES } = require('./sameHostDiscovery')
const { extractRestaurantFieldsWithEvidence } = require('./restaurantFieldEvidence')
const { ALLOWED_FIELD_NAMES, deriveFieldConfidence, isFieldReviewReady } = require('./fieldConfidence')
const { computeFieldEvidenceHash } = require('./fieldEvidenceHash')
const { checkFieldContextStatus } = require('./fieldContextConflict')
const { extractDigitalPdfLines, extractDigitalPdfTextWithFallback, PdfExtractionError } = require('./pdfTextExtraction')
const { structurePdfLinesIntoMenu, compactPdfLayoutText } = require('./pdfMenuStructuring')
const { rollUpPdfAdapterErrorReason } = require('./restaurantSourceAnalysisJobs')
const { composeEvidenceBasedDescription } = require('./restaurantConceptDescription')
const { runClaudeStructuringAdapter } = require('./claudeStructuringAdapter')
const { extractHtmlMenuStructure } = require('./htmlMenuStructure')
const { pdfContextToMenuContext } = require('./pdfMenuContext')
const { buildExtractionResult, countMenuItems } = require('./menuExtractionResult')
const { assessDeterministicMenuQuality, applyQualityReview, aiReplacementGate } = require('./menuExtractionQuality')

/**
 * BE-25 fase 2: a menu context from the visible HTML of a discovered menu
 * page, via the deterministic BE-22 recognizer. Only dishes with one known
 * price count — a line without a reliable price never becomes a menu item —
 * and the recognizer's own minimum (MIN_ITEMS) and refusals (opening hours,
 * events, reservations, service units, ambiguous structures) apply.
 * Returns `{ menu, itemCount }` or `null`. Never throws into the analysis.
 */
/**
 * The HTML structure adapter's sections as one menu context. The heading
 * route is kept losslessly (src/lib/menuHierarchy.js): a shared title, a
 * path of any depth per section, the original source route, the source
 * position and locator, and an uncertainty flag — never one flattened name.
 */
function menuFromHtmlStructure(html, usedSlugs) {
  let result
  try {
    result = extractHtmlMenuStructure(html)
  } catch {
    return null
  }
  if (!result || result.status !== 'parsed') return null
  const kept = result.sections
    .map((section, position) => ({
      section,
      position,
      items: section.items
        .filter((item) => item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits))
        .map((item) => ({ name: item.name, desc: item.description || null, price: (item.amountMinorUnits / 100).toFixed(2) })),
    }))
    .filter((entry) => entry.items.length > 0)
  const itemCount = kept.reduce((n, entry) => n + entry.items.length, 0)
  if (itemCount === 0) return null
  const hierarchy = normalizeMenuHierarchy(kept.map((entry) => entry.section.path), kept.map((entry) => entry.section.uncertain === true))
  const categories = kept.map((entry, i) => {
    const shape = hierarchy.categories[i]
    const category = { name: shape.name, path: shape.path, sourcePath: shape.sourcePath, position: entry.position, locator: entry.section.items[0].evidence.locator, items: entry.items }
    if (shape.uncertain) category.uncertain = true
    return category
  })
  let contextSlug = 'menukaart'
  for (let i = 0; usedSlugs.has(contextSlug); i += 1) contextSlug = `menukaart${String.fromCharCode(97 + (i % 26))}`
  const excludedSections = (Array.isArray(result.excludedSections) ? result.excludedSections : [])
    .filter((entry) => entry && Array.isArray(entry.path) && entry.path.length > 0)
    .slice(0, 20)
    .map((entry) => ({ path: entry.path.map((label) => String(label || '').slice(0, 60)), unpricedLines: entry.unpricedLines }))
  return { menu: { name: 'Menukaart', contextSlug, title: hierarchy.title, structure: hierarchy.structure, categories }, itemCount, excludedSections }
}

/**
 * Honest limitations for recognised headings whose content could not be
 * stored as dishes (typically an arrangement or choice menu whose prices do
 * not belong to one dish). Never a guessed item, never silence.
 */
function htmlMenuExclusionLimitations(url, found) {
  return ((found && found.excludedSections) || []).map(
    (entry) => `Menukaart ${url}: sectie "${entry.path.join(' › ')}" is niet als gerechten opgenomen; ${entry.unpricedLines} regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).`,
  )
}

/** Records the count (never the content) on the source entry so the quality
 * gate can treat it as a product gap for exactly that source. */
function noteHtmlExclusions(sourceInventory, sourceId, found) {
  const entry = (Array.isArray(sourceInventory) ? sourceInventory : []).find((source) => source && source.id === sourceId)
  if (!entry) return
  const count = ((found && found.excludedSections) || []).length
  if (count > 0) entry.excludedSections = (Number.isInteger(entry.excludedSections) ? entry.excludedSections : 0) + count
}

/** A plain-language note for a recognised HTML menu. */
function htmlMenuNote(url, found) {
  const base = `Menukaart herkend uit de HTML van ${url}: ${found.itemCount} gerechten met prijs in ${found.menu.categories.length} rubrieken.`
  return found.menu.structure === 'uncertain'
    ? `${base} De rubriekindeling is onzeker: controleer de bronroute.`
    : `${base} Controleer rubrieken en prijzen.`
}

/** A plain-language note for a recognized PDF menu, with page coverage. */
function pdfMenuNote(url, found, pageCount) {
  const pages = Number.isInteger(pageCount) ? ` (${pageCount} ${pageCount === 1 ? 'pagina' : "pagina's"})` : ''
  return `Menukaart herkend uit de PDF van ${url}${pages}: ${found.itemCount} gerechten met prijs in ${found.menu.categories.length} rubrieken. Controleer pagina's, rubrieken en prijzen.`
}

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
 * The one, single place a discovered PDF (a same-host candidate here,
 * or the entry URL itself in
 * `app/api/internal/v1/restaurant-analysis-jobs/route.js`'s own PDF-entry
 * branch) is turned into an `unknownMenuContexts` entry — shared so both
 * call sites apply the exact same extraction-with-fallback and menu-
 * structuring logic, never two subtly different copies.
 *
 * Rejects with the underlying `PdfExtractionError` exactly like the
 * plain `extractDigitalPdfText` used to — every caller's existing
 * catch/note-and-continue handling stays unchanged. On success, always
 * returns the same shape as before (`sourceUrl`/`extractionMethod`/
 * `pageCount`/`wordCount`/`contentHash`) plus two new, additive fields:
 * `usedFallback` (honest signal that the byte-scanning fallback, not
 * the structure-aware primary parser, produced this text — see
 * `src/lib/pdfTextExtraction.js`'s own `extractDigitalPdfTextWithFallback`)
 * and `recognizedSections` (this fix's own new deterministic menu
 * recognition — see `src/lib/pdfMenuStructuring.js` — always `[]`, never
 * omitted, when nothing reliable was found, or when the fallback path
 * ran and has no position data to structure at all).
 */
async function readPdfMenuSource(pdfBytes, sourceUrl, sourceId) {
  const result = await extractDigitalPdfTextWithFallback(pdfBytes)

  let recognizedSections = []
  let layout = null
  let extractionText = result.text
  let extractionTextTruncated = false
  if (!result.usedFallback) {
    // Structuring is a bonus layered on top of an already-succeeded,
    // structure-aware text extraction — never lets a structuring-
    // specific failure discard the plain text/wordCount result the
    // primary parser already confirmed. Re-parses the same bytes via
    // extractDigitalPdfLines (position data extractDigitalPdfText's own
    // flattened text never carries) — a real, accepted second parse,
    // not a correctness risk: both functions apply the exact same
    // validation/budgets to the exact same bytes.
    try {
      const { pages } = await extractDigitalPdfLines(pdfBytes)
      const structured = structurePdfLinesIntoMenu(pages)
      recognizedSections = structured.categories
      layout = structured.layout
      // The same lines, page- and column-aware, are the only PDF content a
      // future model adapter receives. They are bounded and kept out of the
      // context object, the receipt and every log.
      const compact = compactPdfLayoutText(pages)
      extractionText = compact.text
      extractionTextTruncated = compact.truncated
    } catch {
      recognizedSections = []
      layout = null
      extractionText = result.text
    }
  }

  return {
    context: {
      sourceUrl,
      ...(typeof sourceId === 'string' && sourceId ? { sourceId } : {}),
      extractionMethod: 'pdf_text',
      pageCount: result.pageCount,
      wordCount: countWords(result.text),
      contentHash: computeFieldEvidenceHash(result.text),
      usedFallback: result.usedFallback,
      recognizedSections,
      // Counts only — never source text. Persisted with the job so review can
      // tell "nothing found" apart from "content deliberately not turned into
      // an ordinary dish" (supplements, prose prices, unknown headings).
      ...(layout ? { layout: { ...layout, duplicateLayerOffsets: [...layout.duplicateLayerOffsets] } } : {}),
    },
    extractionText,
    extractionTextTruncated,
  }
}

/**
 * The one, single place a discovered PDF (a same-host candidate here,
 * or the entry URL itself in
 * `app/api/internal/v1/restaurant-analysis-jobs/route.js`'s own PDF-entry
 * branch) is turned into an `unknownMenuContexts` entry — shared so both
 * call sites apply the exact same extraction-with-fallback and menu-
 * structuring logic, never two subtly different copies.
 *
 * Rejects with the underlying `PdfExtractionError` exactly like the
 * plain `extractDigitalPdfText` used to — every caller's existing
 * catch/note-and-continue handling stays unchanged. On success, always
 * returns the same shape as before (`sourceUrl`/`extractionMethod`/
 * `pageCount`/`wordCount`/`contentHash`) plus additive fields:
 * `usedFallback` (honest signal that the byte-scanning fallback, not
 * the structure-aware primary parser, produced this text — see
 * `src/lib/pdfTextExtraction.js`'s own `extractDigitalPdfTextWithFallback`),
 * `recognizedSections` (this fix's own new deterministic menu
 * recognition — see `src/lib/pdfMenuStructuring.js` — always `[]`, never
 * omitted, when nothing reliable was found, or when the fallback path
 * ran and has no position data to structure at all) and `layout`
 * (bounded counts of content that was read but not stored as an ordinary
 * dish). `readPdfMenuSource` additionally returns the bounded extraction
 * text, which is NEVER put on this context.
 */
async function buildUnknownMenuContext(pdfBytes, sourceUrl, sourceId) {
  const { context } = await readPdfMenuSource(pdfBytes, sourceUrl, sourceId)
  return context
}


/**
 * Plain-language, bounded limitations for PDF content that was read but
 * deliberately not turned into ordinary dishes. Shared by the discovered-PDF
 * and direct-PDF paths so both report the same facts. Counts only, never
 * source text.
 */
function pdfLayoutLimitations(sourceUrl, layout = {}) {
  const limitations = []
  if (Number.isInteger(layout.duplicateLayerItems) && layout.duplicateLayerItems > 0) {
    limitations.push(`PDF ${sourceUrl}: een tweede, overlappende tekstlaag is genegeerd (${layout.duplicateLayerItems} dubbele tekstregels).`)
  }
  if (Number.isInteger(layout.supplementLines) && layout.supplementLines > 0) {
    limitations.push(`PDF ${sourceUrl}: ${layout.supplementLines} supplementregel(s) zijn niet als gerecht opgenomen; het concept ondersteunt supplementen nog niet.`)
  }
  if (Number.isInteger(layout.arrangementLines) && layout.arrangementLines > 0) {
    limitations.push(`PDF ${sourceUrl}: ${layout.arrangementLines} arrangement-/keuzeregel(s) zijn niet als gerecht opgenomen; het concept ondersteunt arrangementen nog niet.`)
  }
  if (Number.isInteger(layout.ambiguousPriceLines) && layout.ambiguousPriceLines > 0) {
    limitations.push(`PDF ${sourceUrl}: ${layout.ambiguousPriceLines} regel(s) met een prijs midden in de regel zijn niet als gerecht overgenomen.`)
  }
  if (Number.isInteger(layout.unlinkedPriceLines) && layout.unlinkedPriceLines > 0) {
    limitations.push(`PDF ${sourceUrl}: ${layout.unlinkedPriceLines} prijsregel(s) konden zonder aantoonbare lokale naam-/prijskoppeling niet als gerecht worden opgenomen.`)
  }
  if (Number.isInteger(layout.unrecognizedHeadingLines) && layout.unrecognizedHeadingLines > 0) {
    limitations.push(`PDF ${sourceUrl}: ${layout.unrecognizedHeadingLines} mogelijke rubriekkop(pen) zijn niet herkend en dus niet als rubriek opgeslagen.`)
  }
  return limitations
}

/**
 * Shared provider-neutral extraction step used by both the HTML and the
 * direct-PDF analysis paths. It runs BEFORE any model call:
 *   1. assess the deterministic result (quality/coverage gates);
 *   2. mark exactly the flagged categories "Controle nodig";
 *   3. refuse a model call for a source that needs constructs the concept
 *      cannot store (supplements/arrangements) while still allowing repair of
 *      another source in the same analysis — such output would be discarded;
 *   4. skip the call entirely when the deterministic result is sufficient;
 *   5. otherwise use the validated model result only as an explicit,
 *      source- and version-scoped REPLACEMENT of a flagged deterministic menu,
 *      never as a silent merge and never as an approval.
 * Mutates `menuContexts`/`notes`/`limitations` in place and returns
 * `{ aiExtraction, assessment }`.
 */
async function applyProviderNeutralExtraction({
  menuContexts,
  unknownMenuContexts,
  sourceInventory,
  sourceTexts,
  notes,
  limitations,
  restaurantCandidateFields,
  structuredExtraction,
}) {
  const menus = Array.isArray(menuContexts) ? menuContexts : []
  const assessment = assessDeterministicMenuQuality({ menus, unknownMenuContexts, sourceInventory })
  const marked = applyQualityReview(menus, assessment)
  if (assessment.flags.length > 0) {
    limitations.push(
      `Kwaliteitscontrole op de deterministische extractie vraagt aandacht (${assessment.codes.join(', ')}); het resultaat is niet als volledig beoordeeld.`,
    )
    if (marked > 0) notes.push(`${marked} rubriek(en) zijn als "Controle nodig" gemarkeerd op basis van de kwaliteitscontrole.`)
  }

  if (typeof structuredExtraction !== 'function') return { aiExtraction: null, assessment }

  // Product gaps are per source: a supplement/arrangement in one source must
  // not silence a recoverable defect in another source. Blocked sources keep
  // their deterministic result, stay "Controle nodig" and keep their own
  // provenance; they are never sent to the provider (output would be rejected)
  // and their model output, if any, is never used.
  const blockedSourceIds = new Set(assessment.blockedSourceIds || [])
  const blockedStatus = (assessment.sourceStatus || []).filter((entry) => entry.blockedByProductGap)
  for (const entry of blockedStatus) {
    const label = entry.sourceId ? `bron ${entry.sourceId}` : 'een bron zonder bron-ID'
    const url = entry.sourceUrl ? ` (${entry.sourceUrl})` : ''
    limitations.push(
      `Geen model-extractie uitgevoerd voor ${label}${url}: de bron bevat supplementen of relaties die het concept nog niet kan opslaan (${entry.flagCodes.join(', ')}). Het deterministische resultaat blijft ongewijzigd, als "Controle nodig" gemarkeerd en niet als volledig beoordeeld.`,
    )
  }

  if (menus.length > 0 && assessment.sufficient) {
    notes.push('Model-extractie overgeslagen: de deterministische extractie voldeed aan de kwaliteitscontrole.')
    return { aiExtraction: { enabled: true, ok: null, skipped: true, reason: 'deterministic_result_sufficient', quality: assessment.codes }, assessment }
  }

  const eligibleFlagged = (assessment.sourceStatus || []).filter((entry) => entry.requiresAiExtraction)
  const unscopedBlocked = assessment.unscopedBlockedByProductGap === true
  const nothingRecoverable =
    unscopedBlocked ||
    (menus.length > 0 && eligibleFlagged.length === 0) ||
    (menus.length === 0 && blockedSourceIds.size > 0 && eligibleFlagged.length === 0 && (assessment.sourceStatus || []).length > 0 && (assessment.sourceStatus || []).every((entry) => entry.blockedByProductGap))
  if (nothingRecoverable) {
    return {
      aiExtraction: {
        enabled: false,
        ok: null,
        skipped: true,
        reason: 'unsupported_product_gap',
        quality: assessment.codes,
        blockedSources: blockedStatus.map((entry) => ({ sourceId: entry.sourceId, sourceUrl: entry.sourceUrl, codes: entry.flagCodes })),
      },
      assessment,
    }
  }

  const aiSources = (Array.isArray(sourceInventory) ? sourceInventory : [])
    .filter((source) => !(source && blockedSourceIds.has(source.id)))
    .map((source) => ({
      ...source,
      ...(sourceTexts && sourceTexts.has(source.id) ? { text: sourceTexts.get(source.id) } : {}),
    }))
  let aiExtraction
  try {
    aiExtraction = await structuredExtraction({ sources: aiSources, restaurantFields: restaurantCandidateFields })
  } catch {
    aiExtraction = { enabled: true, ok: false, reason: 'adapter_failed' }
  }
  if (!aiExtraction || aiExtraction.enabled !== true) return { aiExtraction, assessment }
  aiExtraction = {
    ...aiExtraction,
    quality: assessment.codes,
    ...(blockedStatus.length > 0
      ? { blockedSources: blockedStatus.map((entry) => ({ sourceId: entry.sourceId, sourceUrl: entry.sourceUrl, codes: entry.flagCodes })) }
      : {}),
  }

  if (!aiExtraction.ok || !Array.isArray(aiExtraction.menus) || aiExtraction.menus.length === 0) {
    limitations.push(`Model-extractie niet gebruikt (${aiExtraction.reason || 'onbekende reden'}).`)
    return { aiExtraction, assessment }
  }

  if (menus.length === 0) {
    const accepted = aiExtraction.menus.filter((menu) => !(menu && blockedSourceIds.has(menu.sourceId)))
    const rejectedBlocked = aiExtraction.menus.length - accepted.length
    if (rejectedBlocked > 0) {
      limitations.push(`${rejectedBlocked} modelmenu('s) voor een bron met een productgat zijn niet gebruikt.`)
    }
    if (accepted.length === 0) {
      return { aiExtraction, assessment }
    }
    menus.push(...accepted)
    notes.push('Aanvullende structurering via de geconfigureerde adapter toegevoegd; menselijke controle blijft nodig.')
    return { aiExtraction, assessment }
  }

  // Source-scoped replacement only. A deterministic menu that was not flagged
  // for this source is kept; a model menu for an unflagged source is not added.
  const deterministicBySource = new Map()
  for (const menu of menus) {
    if (!menu || typeof menu.sourceId !== 'string') continue
    deterministicBySource.set(menu.sourceId, (deterministicBySource.get(menu.sourceId) || 0) + countMenuItems([menu]))
  }
  const flagged = new Set(assessment.flaggedSourceIds)
  const replaceableBySource = new Map()
  const rejected = []
  for (const aiMenu of aiExtraction.menus) {
    const sourceId = aiMenu && typeof aiMenu.sourceId === 'string' ? aiMenu.sourceId : null
    if (sourceId && blockedSourceIds.has(sourceId)) {
      rejected.push({ sourceId, reason: 'source_blocked_by_product_gap' })
      continue
    }
    if (!sourceId || !flagged.has(sourceId)) {
      rejected.push({ sourceId, reason: 'source_not_flagged' })
      continue
    }
    const gate = aiReplacementGate({ aiMenu, deterministicItemCount: deterministicBySource.get(sourceId) || 0, sourceId })
    if (!gate.ok) {
      rejected.push({ sourceId, reason: gate.reason })
      continue
    }
    if (!replaceableBySource.has(sourceId)) replaceableBySource.set(sourceId, [])
    replaceableBySource.get(sourceId).push({ aiMenu, gate })
  }

  if (replaceableBySource.size === 0) {
    limitations.push('Modelresultaat niet gebruikt: geen onderbouwde verbetering voor de gemarkeerde bron(nen).')
    if (rejected.length > 0) limitations.push(`Modelresultaat niet samengevoegd (${[...new Set(rejected.map((row) => row.reason))].join(', ')}).`)
    return { aiExtraction, assessment }
  }

  const replacedSummary = []
  for (const [sourceId, entries] of replaceableBySource) {
    const existingCount = deterministicBySource.get(sourceId) || 0
    for (let i = menus.length - 1; i >= 0; i -= 1) {
      if (menus[i] && menus[i].sourceId === sourceId) menus.splice(i, 1)
    }
    for (const { aiMenu, gate } of entries) {
      const categories = (Array.isArray(aiMenu.categories) ? aiMenu.categories : []).map((category) => ({ ...category, uncertain: true }))
      menus.push({
        ...aiMenu,
        extractionMethod: 'ai_structured',
        replacesDeterministic: { sourceId, itemCount: existingCount, qualityFlags: assessment.codes },
        categories,
      })
      replacedSummary.push(`${sourceId}: ${existingCount} → ${gate.itemCount} gerechten`)
    }
  }
  limitations.push(
    `Model-extractie verving de deterministische uitkomst voor ${replacedSummary.join('; ')} op basis van de kwaliteitscontrole (${assessment.codes.join(', ')}). Het vervangen resultaat is als "Controle nodig" gemarkeerd en niet automatisch goedgekeurd.`,
  )
  notes.push('De modeluitkomst is bron- en versiegebonden vervangen; open het resultaat met broncontext en controleer de gemarkeerde rubrieken.')
  if (rejected.length > 0) {
    limitations.push(`Niet gebruikt modelresultaat voor andere bron(nen): ${[...new Set(rejected.map((row) => row.reason))].join(', ')}.`)
  }
  return { aiExtraction, assessment }
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
async function runRestaurantSourceAnalysis({ homepageHtml, homepageUrl, fetchCandidate, structuredExtraction }) {
  const menuContexts = []
  const unknownMenuContexts = []
  const notes = []
  const sourceInventory = []
  const sourceTexts = new Map()
  const limitations = []
  let sourceNumber = 0

  function addSource(entry) {
    sourceNumber += 1
    const source = { id: `source-${sourceNumber}`, ...entry }
    sourceInventory.push(source)
    return source.id
  }

  // The entry page is a real source even when it yields no menu: the reviewer
  // must be able to see that it was read (or blocked/failed), not infer it
  // from free-text notes.
  const homepageSourceId = addSource({
    url: homepageUrl,
    kind: 'html',
    status: 'read',
    contentHash: computeFieldEvidenceHash(homepageHtml),
  })
  sourceTexts.set(homepageSourceId, homepageHtml)

  // 1. Homepage menu structure — BE-18's own extractor, unchanged.
  for (const menu of extractMenusFromHtml(homepageHtml)) {
    menuContexts.push({ ...menu, extractionMethod: 'json_ld', sourceUrl: homepageUrl, sourceId: homepageSourceId })
  }
  // 1b. No JSON-LD menu on the entry page itself: read its already-fetched
  // HTML with the same strict recognizer as a discovered menu page (BE-25),
  // so a menu page entered directly gets the same path. No extra fetch.
  if (menuContexts.length === 0) {
    const entryHtmlMenu = menuFromHtmlStructure(homepageHtml, new Set())
    if (entryHtmlMenu) {
      menuContexts.push({ ...entryHtmlMenu.menu, extractionMethod: 'html', sourceUrl: homepageUrl, sourceId: homepageSourceId })
      notes.push(htmlMenuNote(homepageUrl, entryHtmlMenu))
      limitations.push(...htmlMenuExclusionLimitations(homepageUrl, entryHtmlMenu))
      noteHtmlExclusions(sourceInventory, homepageSourceId, entryHtmlMenu)
    }
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

  // 3. Bounded same-host discovery. MAX_CANDIDATES is the budget for the
  // whole analysis: at most five candidate fetches beyond the already-fetched
  // entry page. A discovered page that holds no menu but links to several
  // same-host menu variants (a "menu hub" such as /menukaart -> /lunch,
  // /diner, /dranken) may contribute its own links, but only one level deeper
  // and only while that same budget lasts. Never a second-level hub
  // expansion, never a cross-host link, never a re-fetch of the entry page.
  const candidateQueue = findSameHostMenuCandidates(homepageHtml, homepageUrl).map((candidate) => ({ ...candidate, depth: 1 }))
  const queuedCandidates = new Set(candidateQueue.map((candidate) => candidate.url))
  const visitedCandidates = new Set()
  let candidateFetches = 0

  while (candidateQueue.length > 0 && candidateFetches < MAX_CANDIDATES) {
    const candidate = candidateQueue.shift()
    if (visitedCandidates.has(candidate.url)) continue
    visitedCandidates.add(candidate.url)
    candidateFetches += 1

    let fetched
    try {
      fetched = await fetchCandidate(candidate.url)
    } catch {
      fetched = { status: 'error' }
    }

    if (!fetched || fetched.status === 'blocked') {
      addSource({ url: candidate.url, kind: 'other', status: 'blocked', limitation: 'Niet opgehaald: robots.txt of onveilige bron.' })
      limitations.push(`Niet opgehaald: ${candidate.url} (robots.txt of onveilige bron).`)
      notes.push(`Kon ${candidate.url} niet automatisch raadplegen (robots.txt of een onveilige bron).`)
      continue
    }
    if (fetched.status === 'error') {
      addSource({ url: candidate.url, kind: 'other', status: 'failed', limitation: 'Ophalen mislukt.' })
      limitations.push(`Niet gelezen: ${candidate.url} (ophalen mislukt).`)
      notes.push(`Ophalen van ${candidate.url} is mislukt.`)
      continue
    }

    if (fetched.status === 'html') {
      const sourceUrl = fetched.finalUrl || candidate.url
      const sourceId = addSource({
        url: sourceUrl,
        kind: 'html',
        status: 'read',
        contentHash: computeFieldEvidenceHash(fetched.body),
      })
      sourceTexts.set(sourceId, fetched.body)
      const existingSlugs = new Set(menuContexts.map((m) => m.contextSlug))
      const candidateMenus = extractMenusFromHtml(fetched.body)
      for (const menu of candidateMenus) {
        if (existingSlugs.has(menu.contextSlug)) continue
        menuContexts.push({ ...menu, extractionMethod: 'html', sourceUrl, sourceId })
        existingSlugs.add(menu.contextSlug)
      }
      // No JSON-LD menu on a page a menu link pointed to: read its visible
      // HTML with the deterministic BE-22 structure recognizer (BE-25 fase
      // 2) — only priced dishes in recognised structures, never a guess.
      const htmlMenu = candidateMenus.length === 0 ? menuFromHtmlStructure(fetched.body, existingSlugs) : null
      if (htmlMenu) {
        menuContexts.push({ ...htmlMenu.menu, extractionMethod: 'html', sourceUrl, sourceId })
        existingSlugs.add(htmlMenu.menu.contextSlug)
        notes.push(htmlMenuNote(sourceUrl, htmlMenu))
        limitations.push(...htmlMenuExclusionLimitations(sourceUrl, htmlMenu))
        noteHtmlExclusions(sourceInventory, sourceId, htmlMenu)
      } else if (candidateMenus.length === 0) {
        // The page was read, but holds no menu this pipeline can read
        // automatically. Name the page for the human reviewer — never a
        // claim that no menu exists, never a guessed menu.
        limitations.push(`Gelezen zonder automatisch herkende menukaart: ${sourceUrl}.`)
        notes.push(
          `Mogelijke menupagina gelezen: ${sourceUrl} (link "${String(candidate.matchedOn || '').slice(0, 60)}"). Hier is geen automatisch leesbare menukaart herkend; bekijk deze pagina handmatig.`
        )
        // A menu overview page (for example /menukaart with tiles for lunch,
        // diner and drinks) is not itself a menu. Its own same-host menu links
        // are relevant follow-up pages; they are followed only one level below
        // this page and only from the shared MAX_CANDIDATES budget.
        if (candidate.depth === 1) {
          const hubLinks = findSameHostMenuCandidates(fetched.body, sourceUrl)
            .filter((link) => !visitedCandidates.has(link.url) && !queuedCandidates.has(link.url))
          if (hubLinks.length >= 2) {
            const remaining = MAX_CANDIDATES - candidateFetches
            for (const link of hubLinks.slice(0, remaining)) {
              candidateQueue.push({ ...link, depth: 2 })
              queuedCandidates.add(link.url)
            }
            if (remaining > 0) {
              notes.push(
                `Menukaartpagina ${sourceUrl} is een tussenpagina; ${Math.min(hubLinks.length, remaining)} relevante menulink(s) binnen dezelfde site zijn gevolgd.`
              )
            }
          }
        }
      }
      const candidateFieldEvidence = extractRestaurantFieldsWithEvidence(fetched.body)
      for (const fieldName of ALLOWED_FIELD_NAMES) {
        recordFieldSighting(fieldName, candidateFieldEvidence[fieldName], sourceUrl)
      }
      continue
    }

    if (fetched.status === 'pdf') {
      const sourceUrl = fetched.finalUrl || candidate.url
      const sourceId = addSource({ url: sourceUrl, kind: 'pdf', status: 'read' })
      const source = sourceInventory[sourceInventory.length - 1]
      try {
        // A digital PDF's plain text is never itself a confidently-named,
        // structured menu context without AI structuring (disabled today —
        // see runClaudeStructuringAdapter below). `recognizedSections` is the
        // deterministic, reviewable layer: real (name, price) candidates when
        // the PDF's own layout allows them to be found, never a raw excerpt.
        // The same sections are ALSO promoted to the canonical menu-context
        // shape, so receipt, summary, detail and concept cannot disagree about
        // whether this PDF yielded dishes (the Smelt failure mode).
        const { context: pdfContext, extractionText, extractionTextTruncated } = await readPdfMenuSource(fetched.bytes, sourceUrl, sourceId)
        unknownMenuContexts.push(pdfContext)
        // The bounded, page/column-aware text is what a future model adapter
        // reads. It stays in memory only: never on the context, the receipt
        // or a log line.
        if (extractionText) sourceTexts.set(sourceId, extractionText)
        Object.assign(source, {
          pageCount: pdfContext.pageCount,
          wordCount: pdfContext.wordCount,
          contentHash: pdfContext.contentHash,
        })
        if (pdfContext.usedFallback) {
          limitations.push(`PDF ${sourceUrl} is alleen via de tekstfallback gelezen; paginastructuur ontbreekt.`)
        }
        if (extractionTextTruncated) {
          limitations.push(`PDF ${sourceUrl} is voor modellezing afgekapt op de veilige tekstlimiet.`)
        }
        limitations.push(...pdfLayoutLimitations(sourceUrl, pdfContext.layout || {}))
        const converted = pdfContextToMenuContext(pdfContext, new Set(menuContexts.map((m) => m.contextSlug)), { sourceId })
        if (converted) {
          menuContexts.push({ ...converted.menu, sourceUrl, sourceId })
          source.itemCount = converted.itemCount
          notes.push(pdfMenuNote(sourceUrl, converted, pdfContext.pageCount))
        } else {
          limitations.push(`PDF ${sourceUrl} bevat geen betrouwbaar herkenbare gerechten met prijs.`)
          notes.push(`PDF op ${sourceUrl} is gelezen, maar bevat geen betrouwbaar herkenbare gerechten met prijs.`)
        }
      } catch (err) {
        // Any failure here — a properly-typed PdfExtractionError, or, as
        // defense in depth, any other unexpected error — is reported as a
        // plain-language note and never re-thrown: one bad candidate PDF
        // must never crash the rest of this analysis.
        const reason = err instanceof PdfExtractionError ? rollUpPdfAdapterErrorReason(err.reason) : 'pdf_extraction_failed'
        Object.assign(source, { status: 'failed', limitation: `PDF niet leesbaar (${reason}).` })
        limitations.push(`PDF ${sourceUrl} kon niet worden gelezen (${reason}).`)
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
    limitations.push('AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.')
  }

  // 7. Optional provider-neutral hook. It is absent/disabled by default; a
  // caller may inject a configured, budget-guarded runtime after the provider
  // and data-processing decisions. Quality/coverage gates decide whether a
  // model call is useful at all; a validated result may only replace a
  // flagged deterministic menu of the SAME source, never merge into it.
  const { aiExtraction } = await applyProviderNeutralExtraction({
    menuContexts,
    unknownMenuContexts,
    sourceInventory,
    sourceTexts,
    notes,
    limitations,
    restaurantCandidateFields,
    structuredExtraction,
  })

  const extractionResult = buildExtractionResult({
    sourceInventory,
    menus: menuContexts,
    unknownMenuContexts,
    limitations,
    notes,
  })
  if (aiExtraction && aiExtraction.enabled) {
    extractionResult.ai = {
      ok: aiExtraction.ok === true,
      reason: aiExtraction.reason || null,
      meta: aiExtraction.meta || null,
    }
  }

  return { restaurantCandidateFields, fieldEvidence, menuContexts, unknownMenuContexts, description, notes, sourceInventory, limitations, extractionResult, aiExtraction }
}

module.exports = {
  countWords,
  readPdfMenuSource,
  buildUnknownMenuContext,
  pdfLayoutLimitations,
  applyProviderNeutralExtraction,
  runRestaurantSourceAnalysis,
}
