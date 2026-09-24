// BE-20 — pure confidence-tier and plausibility-check logic for
// extracted restaurant fields. Implements
// `be-20-general-restaurant-source-extraction.md`'s own corrected
// confidence rule exactly: a deterministic extractor, a valid
// content-hash, or the mere absence of model inference is never, by
// itself, sufficient for `hoog` — for any `extraction_method`. A field
// reaches `hoog` only when it has (1) a valid, field-specific
// content-hash source reference, (2) it passes a server-side
// plausibility check, and (3) its context has been actively compared
// against another independent sighting and found consistent
// (`contextStatus: 'consistent'`, see below) — never merely "no conflict
// was found" when no comparison was ever possible. Without all three,
// the field stays at most `middel`.
//
// **Corrected 2026-09-24, following an independent review**: this
// module previously took a plain `hasContextConflict` boolean, which an
// earlier version of its own caller (src/lib/restaurantSourceAnalysis.js)
// computed as `false` both when a field's context was genuinely checked
// and found consistent, AND when there was simply nothing to compare
// against at all (no other same-host sighting, a blocked/failed
// candidate, or an incomparable value) — silently treating "never
// validated" the same as "positively validated," which let `hoog` be
// reached from content-hash + plausibility alone in the common case
// where no real cross-page comparison ever happened. Fixed by requiring
// an explicit three-way `contextStatus` (`'consistent'` | `'conflict'` |
// `'unverified'`) instead of a boolean — see `deriveFieldConfidence`
// below for the corrected rule, and src/lib/fieldContextConflict.js's
// own `checkFieldContextStatus` for how this status is actually
// computed.
//
// Never touches the database layer, the DOM, or any server-only Node
// hashing primitive — this module is safe to import from either side. The
// actual content-hash *computation* (which needs a server-only hashing
// primitive) lives in the separate `src/lib/fieldEvidenceHash.js`,
// mirroring the existing `menuSnapshotProposals.js`/`menuSnapshotHash.js`
// split. This module only ever consumes the *result* (a hash string, or
// its absence) as an input — it never computes one itself.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

const { normalizePhoneNL, normalizeWebsite, extractNlPostcode } = require('./candidateNormalization')

/** The only confidence values this contract ever produces — matches
 * `docs/api/data-trust-model.md`'s own `confidence` scale, restated here
 * for this narrower, `extraction_method`-scoped contract (the two
 * vocabularies stay deliberately separate — see
 * `be-20-general-restaurant-source-extraction.md`'s own "Vaststaande
 * productkeuzes" §3 for why). */
const ALLOWED_CONFIDENCE_TIERS = ['hoog', 'middel', 'laag']

/** The only extraction methods this contract knows about today — additive
 * per BE-20's own decision, never a new `origin`. `ocr` is named here as
 * an already-reserved future value (BE-20's own fase-2 non-goal), never
 * produced by anything built in fase 1. */
const ALLOWED_EXTRACTION_METHODS = ['json_ld', 'html', 'pdf_text', 'ai_structured', 'ocr']

/** The same fixed field-name allowlist
 * `src/lib/restaurantProfileDrafts.js`'s `ALLOWED_DRAFT_FIELD_NAMES`
 * already enforces — never a wider set invented for this contract. */
const ALLOWED_FIELD_NAMES = ['name', 'category', 'address', 'phone', 'website']

/** The only context-validation outcomes this contract ever produces —
 * `'consistent'` (actively compared against another independent sighting
 * of the same field and found to match), `'conflict'` (actively compared
 * and found to genuinely differ), or `'unverified'` (no comparable second
 * sighting exists at all, or the comparison was inconclusive — this is
 * NOT the same as `'consistent'` and must never be treated as such). See
 * src/lib/fieldContextConflict.js's own `checkFieldContextStatus`. */
const ALLOWED_CONTEXT_STATUSES = ['consistent', 'conflict', 'unverified']

/**
 * The server-side plausibility check BE-20's confidence rule requires.
 * Reuses this project's existing, already-tested normalizers exactly —
 * never a new, invented validation heuristic:
 *  - `phone`: `normalizePhoneNL(...).valid` (a real, unambiguous Dutch
 *    phone shape).
 *  - `website`: `normalizeWebsite(...).valid` (a real http(s) URL).
 *  - `address`: `extractNlPostcode(...)` finds a recognizable Dutch
 *    postcode — `normalizeAddressNL` itself has no meaningful `valid`
 *    signal (it only ever reformats whitespace/postcode casing, never
 *    rejects a shape), so the postcode-presence check is the only
 *    honest, already-existing plausibility signal available for an
 *    address today.
 *  - `name`/`category`: no existing shape-validator exists anywhere in
 *    this project for free-text business names/categories, and this
 *    ticket does not invent one — the only honest check possible without
 *    guessing is a bounded, non-empty length check (never a claim that a
 *    plausible-length string is *correct*, only that it is not obviously
 *    empty/garbage).
 * An unknown field name fails closed (`false`) — never guessed at.
 */
function checkFieldPlausibility(fieldName, value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  const trimmed = value.trim()
  if (fieldName === 'phone') return normalizePhoneNL(trimmed).valid
  if (fieldName === 'website') return normalizeWebsite(trimmed).valid
  if (fieldName === 'address') return extractNlPostcode(trimmed) !== null
  if (fieldName === 'name' || fieldName === 'category') return trimmed.length >= 2 && trimmed.length <= 200
  return false
}

/**
 * The one entry point implementing BE-20's confidence rule. Never
 * guesses `hoog`:
 *
 *  - No content-hash at all → `middel` (nothing actively wrong is known,
 *    but there is no field-specific evidence to point to either — never
 *    `hoog` without it).
 *  - `contextStatus: 'conflict'` (an actively detected mismatch, e.g. a
 *    chain/head-office address surfacing on a location-specific page) →
 *    `laag` — a stronger, more specific negative signal than "merely
 *    unvalidated", deliberately distinguished from the plain `middel`
 *    default so a reviewer can tell "not yet checked" apart from
 *    "actively looks wrong" (this project's own "at most middel"
 *    phrasing in the ticket permits, and this function makes explicit,
 *    that a worse-than-middel outcome exists for exactly this case).
 *  - `contextStatus: 'unverified'` (no comparable second sighting exists,
 *    or the comparison was inconclusive) → `middel`, **never** `hoog` —
 *    this is the corrected case: the mere absence of a detected conflict
 *    is never, by itself, treated as a positive validation.
 *  - `contextStatus: 'consistent'` (actively compared and confirmed) →
 *    `hoog` only if the field-specific plausibility check *also* passes;
 *    `middel` if it does not.
 *
 * `extractionMethod` is accepted and validated against
 * `ALLOWED_EXTRACTION_METHODS` but never itself changes the outcome —
 * the rule is deliberately uniform across `json_ld`/`html`/`pdf_text`/
 * `ai_structured`, per the ticket's own explicit correction that a
 * deterministic method is never automatically trustworthy.
 */
function deriveFieldConfidence({ fieldName, value, extractionMethod, hasContentHash, contextStatus }) {
  if (!ALLOWED_EXTRACTION_METHODS.includes(extractionMethod)) {
    throw new Error(`Unknown extraction_method: ${extractionMethod}`)
  }
  if (!ALLOWED_FIELD_NAMES.includes(fieldName)) {
    throw new Error(`Unknown field_name: ${fieldName}`)
  }
  if (!ALLOWED_CONTEXT_STATUSES.includes(contextStatus)) {
    throw new Error(`Unknown context status: ${contextStatus}`)
  }
  if (!hasContentHash) return 'middel'
  if (contextStatus === 'conflict') return 'laag'
  if (contextStatus === 'unverified') return 'middel'
  return checkFieldPlausibility(fieldName, value) ? 'hoog' : 'middel'
}

/**
 * Whether a field, given its computed confidence, is ready for ordinary
 * review — BE-20's own "Review-readiness threshold" documentation
 * proposal: a valid content-hash source reference *and* at least
 * `middel` confidence. `laag` (or no content-hash at all, which
 * `deriveFieldConfidence` itself already maps to `middel`, never
 * `laag`, so this check is really just "not laag") always means
 * "handmatige beoordeling nodig" instead.
 */
function isFieldReviewReady({ hasContentHash, confidence }) {
  if (!ALLOWED_CONFIDENCE_TIERS.includes(confidence)) {
    throw new Error(`Unknown confidence tier: ${confidence}`)
  }
  return Boolean(hasContentHash) && confidence !== 'laag'
}

module.exports = {
  ALLOWED_CONFIDENCE_TIERS,
  ALLOWED_EXTRACTION_METHODS,
  ALLOWED_FIELD_NAMES,
  ALLOWED_CONTEXT_STATUSES,
  checkFieldPlausibility,
  deriveFieldConfidence,
  isFieldReviewReady,
}
