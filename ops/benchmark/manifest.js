// BE-21 — benchmark case manifest: pure logic (closed vocabularies +
// validation) for the leverancier-neutral benchmark foundation this
// checkpoint builds. This is scaffolding for the eventual real, 50-100-
// source vendor benchmark be-21-restaurant-source-extraction-vendor-benchmark.md
// itself describes — it never claims to BE that benchmark. No source in
// `manifest.json` with provenance `real_benchmark_evidence_pending` has
// ever been fetched by anything in this directory; see that file's own
// header comment.
//
// Isolated tooling, never imported by product code — matches this
// project's own `ops/scripts/*.js` precedent (e.g.
// `ops/scripts/import-breda-osm.js`), never reachable from `/internal/*`,
// per be-21's own "Voortgang" note ("Step 4 here means the isolated
// benchmark harness/scripts... never product code reachable from
// `/internal/*`").
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const { ALLOWED_FIELD_NAMES } = require('../../src/lib/fieldConfidence')
const { ALLOWED_PDF_ERROR_REASONS } = require('../../src/lib/pdfTextExtraction')

/** The stratification categories be-21's own "Vaststaande productkeuzes"
 * §2 names for the future real 50-100-source benchmark set. A manifest
 * entry's `sourceType` must be exactly one of these — never a freely
 * invented category. */
const ALLOWED_SOURCE_TYPES = [
  'html_only',
  'digital_pdf',
  'scanned_pdf',
  'chain_location',
  'multilingual',
  'javascript_dependent',
]

/** Where a manifest entry's content actually comes from — the one thing
 * this whole manifest exists to keep honestly, permanently distinguishable:
 *  - `synthetic_fixture`: HTML/PDF bytes authored locally for this
 *    foundation, resembling a restaurant page in shape only — never a copy
 *    of, or a claim about, any real restaurant's actual website.
 *  - `local_be20_fixture`: bytes reused verbatim from an existing,
 *    already-committed BE-20 test fixture (e.g. `pdfTextExtraction.test.js`'s
 *    own hand-built PDFs) — same status as `synthetic_fixture` for
 *    evidentiary purposes (still not real-world evidence), recorded
 *    separately only so a reader can trace exactly which file it came
 *    from.
 *  - `real_benchmark_evidence_pending`: one of BE-21's own named real
 *    sources (the six-URL mandatory subset, or a future addition toward
 *    the full 50-100). Metadata only — a URL string copied verbatim from
 *    the already-published `be-20`/`be-21` ticket text. This foundation
 *    never fetches it, never scores it, and never invents a result for
 *    it; see `runner.js`'s own explicit "pending" handling.
 */
const ALLOWED_PROVENANCE = ['synthetic_fixture', 'local_be20_fixture', 'real_benchmark_evidence_pending']

/** The exact six mandatory sources be-20's own "Vaststaande
 * productkeuzes" §10 and be-21's own "Vaststaande productkeuzes" §2 both
 * name — copied verbatim from that already-published, checked-in
 * documentation text, never independently re-typed or re-derived. This is
 * the one place this foundation names them; `manifest.json`'s own six
 * `real_benchmark_evidence_pending` entries must reference exactly this
 * set, checked by `validateManifest` below. */
const MANDATORY_SIX_URLS = [
  'https://debotanistbreda.nl/',
  'https://bobbisbar.nl/',
  'https://www.gauchosgrill.nl/breda',
  'https://mrmoos.nl/',
  'https://demarktbreda.nl/',
  'https://breda.colonie.nl/',
]

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validates one manifest entry in isolation. Returns an array of problem
 * strings — empty when the entry is valid. Never throws; a caller decides
 * what to do with a non-empty problem list.
 */
function validateManifestEntry(entry) {
  const problems = []
  if (!entry || typeof entry !== 'object') {
    return ['entry is not an object']
  }

  if (!isNonEmptyString(entry.id)) problems.push('id must be a non-empty string')
  if (!ALLOWED_SOURCE_TYPES.includes(entry.sourceType)) {
    problems.push(`sourceType "${entry.sourceType}" is not one of ${ALLOWED_SOURCE_TYPES.join(', ')}`)
  }
  if (!ALLOWED_PROVENANCE.includes(entry.provenance)) {
    problems.push(`provenance "${entry.provenance}" is not one of ${ALLOWED_PROVENANCE.join(', ')}`)
  }
  if (typeof entry.mandatorySubset !== 'boolean') problems.push('mandatorySubset must be a boolean')
  if (typeof entry.notes !== 'string' || entry.notes.trim().length === 0) {
    problems.push('notes must be a non-empty string explaining what this entry actually is')
  }

  // mandatorySubset is meaningful only for a real, named benchmark source —
  // never for a locally-authored fixture, which can never itself BE one of
  // be-20/be-21's six mandatory sources.
  if (entry.mandatorySubset === true && entry.provenance !== 'real_benchmark_evidence_pending') {
    problems.push('mandatorySubset may only be true when provenance is real_benchmark_evidence_pending')
  }

  if (entry.provenance === 'real_benchmark_evidence_pending') {
    if (!isNonEmptyString(entry.referenceUrl) || !/^https?:\/\//.test(entry.referenceUrl)) {
      problems.push('a real_benchmark_evidence_pending entry requires a non-empty http(s) referenceUrl')
    }
    if (entry.fixtureId !== null) {
      problems.push('a real_benchmark_evidence_pending entry must have fixtureId: null — no local fixture stands in for a real, unfetched source')
    }
    if (entry.groundTruth !== null) {
      problems.push('a real_benchmark_evidence_pending entry must have groundTruth: null — no ground truth exists yet for a source this foundation has never fetched')
    }
    if (entry.fetched !== false) {
      problems.push('a real_benchmark_evidence_pending entry must have fetched: false — this foundation never performs a real fetch')
    }
  } else {
    // synthetic_fixture / local_be20_fixture
    if (entry.referenceUrl !== null) {
      problems.push(`a ${entry.provenance} entry must have referenceUrl: null — it must never be presented as if it were a real, named source`)
    }
    if (!isNonEmptyString(entry.fixtureId)) {
      problems.push(`a ${entry.provenance} entry requires a non-empty fixtureId naming its fixtures.js builder`)
    }
    if (!entry.groundTruth || typeof entry.groundTruth !== 'object' || Array.isArray(entry.groundTruth)) {
      problems.push('a fixture-backed entry requires a groundTruth object (may be {} only for a deliberately-empty-evidence case, but the key must exist)')
    } else {
      for (const fieldName of Object.keys(entry.groundTruth)) {
        if (!ALLOWED_FIELD_NAMES.includes(fieldName) && fieldName !== 'menuContextNames' && fieldName !== 'unknownMenuContextCount') {
          problems.push(`groundTruth key "${fieldName}" is not a recognized restaurant field or menu-level expectation`)
        }
      }
    }
    if (entry.expectedErrorCode !== null && !ALLOWED_PDF_ERROR_REASONS.includes(entry.expectedErrorCode)) {
      problems.push(`expectedErrorCode "${entry.expectedErrorCode}" must be null or one of ${ALLOWED_PDF_ERROR_REASONS.join(', ')}`)
    }
  }

  return problems
}

/**
 * Validates the whole manifest array: every entry individually (via
 * `validateManifestEntry`), plus the cross-entry invariants a single
 * entry can never check by itself — unique ids, and the exact six
 * mandatory sources all present and correctly flagged. Returns
 * `{ valid: boolean, problems: string[] }` — never throws.
 */
function validateManifest(manifest) {
  const problems = []
  if (!Array.isArray(manifest)) {
    return { valid: false, problems: ['manifest must be an array'] }
  }

  const seenIds = new Set()
  for (const entry of manifest) {
    const entryProblems = validateManifestEntry(entry)
    for (const p of entryProblems) problems.push(`${entry && entry.id ? entry.id : '(unknown id)'}: ${p}`)
    if (entry && isNonEmptyString(entry.id)) {
      if (seenIds.has(entry.id)) problems.push(`duplicate id: ${entry.id}`)
      seenIds.add(entry.id)
    }
  }

  const mandatoryUrlsPresent = new Set(
    manifest
      .filter((e) => e && e.provenance === 'real_benchmark_evidence_pending' && e.mandatorySubset === true)
      .map((e) => e.referenceUrl)
  )
  for (const url of MANDATORY_SIX_URLS) {
    if (!mandatoryUrlsPresent.has(url)) {
      problems.push(`mandatory source missing or not flagged mandatorySubset: ${url}`)
    }
  }

  return { valid: problems.length === 0, problems }
}

module.exports = {
  ALLOWED_SOURCE_TYPES,
  ALLOWED_PROVENANCE,
  MANDATORY_SIX_URLS,
  validateManifestEntry,
  validateManifest,
}
