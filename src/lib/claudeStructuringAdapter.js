// BE-20 — the Claude structuring adapter BOUNDARY only. This module never
// performs a network call, never reads an API key or any other secret,
// never sends source material anywhere, and never creates a vendor
// account or connection of any kind, regardless of the `enabled` flag
// passed to it — this is the "at most a locally-isolated, default-
// disabled Claude adapter boundary" this checkpoint's own instructions
// require, not a real integration.
//
// A real vendor call is explicitly out of scope here — this project's
// own be-21-restaurant-source-extraction-vendor-benchmark.md and
// be-20-general-restaurant-source-extraction.md's own "Privacy and
// vendor review before production use" section both require an explicit
// data processing agreement, EU-processing confirmation, and
// environment-scoped secret handling BEFORE any real source material is
// ever sent to Claude or any other external processor — none of that has
// happened, so this module fails closed unconditionally. Its only job is
// to give the rest of the analysis pipeline (src/lib/restaurantSourceAnalysis.js)
// a fixed, uniform call-and-return shape to call today, so wiring a real
// vendor integration in later stays additive rather than a breaking
// rewrite of every caller.
//
// Deliberately CommonJS, same reasoning as every other pure-logic module
// in this project.

'use strict'

/**
 * `true` only when the caller explicitly opts in AND this build has a
 * real implementation to run — currently never, since no real vendor call
 * exists in this codebase yet. Reads no environment variable, no
 * configuration file, and no secret; a future real integration replacing
 * this function's body remains this module's own explicit, later,
 * separately-reviewed change.
 */
function isClaudeAdapterEnabled() {
  return false
}

/**
 * The one entry point the orchestrator calls. Always resolves — never
 * throws, never performs I/O of any kind. When disabled (today, always),
 * resolves `{ enabled: false }`: the caller must treat this exactly like
 * "AI structuring was unavailable," per the ticket's own "The Claude
 * adapter is optional and switchable per job" rule — the job still
 * completes using whatever deterministic (`json_ld`/`html`/`pdf_text`)
 * results it already found, with a plain-language notice, never a blank
 * or invented concept.
 *
 * `input` is accepted only to fix this boundary's future real shape
 * (`{ html, pdfText, restaurantFields }` or similar) — it is never read,
 * inspected, forwarded, or logged by this module today.
 */
async function runClaudeStructuringAdapter(input) {
  if (!isClaudeAdapterEnabled()) {
    return { enabled: false }
  }
  // Unreachable today (isClaudeAdapterEnabled() always returns false) —
  // kept as an explicit, typed dead end rather than silently falling
  // through, so a future real implementation has one clear place to
  // start, and so this boundary itself, if ever mistakenly flipped on
  // before a real implementation exists, still fails closed with a
  // named, closed-vocabulary reason rather than doing nothing or
  // throwing an unhandled error.
  return { enabled: true, ok: false, reason: 'model_unavailable' }
}

module.exports = {
  isClaudeAdapterEnabled,
  runClaudeStructuringAdapter,
}
