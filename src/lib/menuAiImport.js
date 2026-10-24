'use strict';

// W2-W5 of the Delivery Lead order for #59 / BE-21 (review 6380804419):
// "Lees met AI" as an in-app assistant. Route B's existing code does the work:
// the pinned instruction, the provider call, the validator and the normalizer
// are the same modules the manual import and the probe already use. Nothing
// here re-implements them.
//
// Boundaries kept here:
//   - the route never accepts a URL from the client. It accepts either the
//     sealed state token of the existing manual-import step 1 (a capture this
//     server itself read and sealed) or the id of an existing analysis job,
//     whose source URL is resolved from the database;
//   - the function only runs with ANTHROPIC_API_KEY *and* the explicit switch
//     MENU_AI_FALLBACK_ENABLED=true. Otherwise it reports
//     `ai_not_configured` and no call is made. The key is never returned,
//     logged or stored;
//   - the monthly budget is derived from the durable concept metadata of
//     earlier AI reads (no new table, no migration). An unknown cost counts as
//     the full per-call maximum, and a call is refused when spend plus that
//     maximum would pass the monthly ceiling;
//   - every result is validated and normalized by the existing adapter before
//     anything is written, and only the existing concept route writes. No
//     publication, no source confirmation, no internal approval.
//
// Dependency-injected and without its own network or database, so every rule
// is provable with a test.

const { isInternalOnly } = require('./importInbox');
const { buildImportBundle } = require('./manualMenuImportBundle');
const { buildImportReport, publicImportReport } = require('./manualMenuImportImport');
const { reviewView } = require('./manualMenuImportReview');
const { mapStructuredOutputToMenuContexts } = require('./menuExtractionMapping');
const { buildMenuConcept } = require('./menuConcept');
const { DEFAULT_EXTRACTION_LIMITS } = require('./menuExtractionProtocol');

const AI_READ_PROVENANCE_KIND = 'ai_gelezen';
const AI_READ_LABEL = 'Gelezen door AI';
const AI_READ_AI_NAME = 'Claude (Haiku 5.5)';
const AI_PROVIDER = 'anthropic';
const AI_MODEL = 'claude-haiku-5-5';
const AI_FEATURE_FLAG = 'MENU_AI_FALLBACK_ENABLED';
const AI_API_KEY_ENV = 'ANTHROPIC_API_KEY';

// W4: 30 eurocent per call as a hard maximum, 1000 US-cent (conservatively
// converted, same rate as K2) per calendar month.
const AI_MAX_COST_EUR_CENTS = 30;
const AI_MONTH_LIMIT_EUR_CENTS = 1000;
const MAX_SOURCES = DEFAULT_EXTRACTION_LIMITS.maxDocuments;
const MAX_IMPORT_ITEMS = 1000;

// W2: one bounded synchronous call, no retry of its own. The route's own
// maxDuration (60 s, the value the existing batch-analysis process route uses)
// has to cover the call plus validation and the concept write, so the call
// itself stops earlier and the failure is a readable message.
const AI_LIMITS = Object.freeze({
  ...DEFAULT_EXTRACTION_LIMITS,
  callTimeoutMs: 50_000,
  jobDeadlineMs: 55_000,
  maxRetries: 0,
  maxCostEurCents: AI_MAX_COST_EUR_CENTS,
  maxConcurrency: 1,
});

const MESSAGES = Object.freeze({
  ai_not_configured: 'AI is niet ingesteld.',
  ai_flagged_off: 'AI is niet ingesteld.',
  ai_key_missing: 'AI is niet ingesteld.',
  forbidden: 'Alleen interne medewerkers kunnen de kaart met AI laten lezen.',
  source_required: 'Kies eerst een bron die al in de app staat.',
  source_unknown: 'Deze bron hoort niet bij een bestaande analyse of import.',
  source_empty: 'Deze bron bevat geen leesbare tekst om aan de AI te geven.',
  budget_exhausted: 'Het AI-budget van deze maand is op. Ga verder met de handmatige import.',
  budget_unavailable: 'Het AI-gebruik kon niet worden gecontroleerd. Er is niets aangeroepen.',
  invalid_request: 'Ongeldig verzoek.',
  restaurant_required: 'Kies eerst een restaurant uit de bestaande lijst.',
  provider_unavailable: 'De AI is nu niet bereikbaar. Ga verder met de handmatige import.',
  timeout: 'De AI deed er te lang over. Ga verder met de handmatige import.',
  schema_violation: 'Het antwoord van de AI past niet bij de afspraken. Er is niets opgeslagen; ga verder met de handmatige import.',
  no_items: 'De AI vond geen gerechten. Dit is geen geslaagde lezing; ga verder met de handmatige import.',
  model_unavailable: 'De AI is nu niet bereikbaar. Ga verder met de handmatige import.',
  concept_failed: 'Het concept kon niet worden opgeslagen. De lezing is niet verloren: probeer het opnieuw of ga verder met de handmatige import.',
});

function reply(status, body) {
  return { status, body };
}

function messageFor(reason) {
  return MESSAGES[reason] || 'De AI-lezing lukte niet. Ga verder met de handmatige import.';
}

/** W3: both the key and the explicit switch are required. Never echoes a key. */
function aiConfiguration(env = {}) {
  const keyPresent = typeof env[AI_API_KEY_ENV] === 'string' && env[AI_API_KEY_ENV].trim() !== '';
  const flagOn = env[AI_FEATURE_FLAG] === 'true';
  if (!keyPresent && !flagOn) return { enabled: false, reason: 'ai_not_configured' };
  if (!keyPresent) return { enabled: false, reason: 'ai_key_missing' };
  if (!flagOn) return { enabled: false, reason: 'ai_flagged_off' };
  return { enabled: true, reason: null };
}

/** The first instant of the current UTC month, as an ISO string. */
function monthStartIso(now) {
  const date = now instanceof Date ? now : new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

/**
 * W4: one AI concept's cost, read from its durable metadata. A measured cost is
 * an integer number of eurocents; anything else is unknown and counts as the
 * full per-call maximum instead of zero.
 */
function conceptCost(row) {
  const provenance = row && row.captured_content && row.captured_content.importProvenance;
  const cost = provenance && provenance.cost;
  if (cost && Number.isInteger(cost.eurCents) && cost.eurCents >= 0 && cost.known !== false) {
    return { known: true, eurCents: cost.eurCents };
  }
  return { known: false, eurCents: AI_MAX_COST_EUR_CENTS };
}

/**
 * The spend of one month, derived only from durable concept rows. `rows` is the
 * bounded list read from the concept table; `created_at` decides the month.
 */
function monthlySpendFromRows(rows, { now = new Date() } = {}) {
  const start = monthStartIso(now);
  let spentEurCents = 0;
  let concepts = 0;
  let unknownConcepts = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.created_at !== 'string' || row.created_at < start) continue;
    concepts += 1;
    const cost = conceptCost(row);
    if (!cost.known) unknownConcepts += 1;
    spentEurCents += cost.eurCents;
  }
  return {
    spentEurCents,
    concepts,
    unknownConcepts,
    limitEurCents: AI_MONTH_LIMIT_EUR_CENTS,
    remainingEurCents: Math.max(0, AI_MONTH_LIMIT_EUR_CENTS - spentEurCents),
    monthStart: start,
  };
}

/** Refuse when the next call could pass the monthly ceiling. */
function budgetDecision(spend) {
  if (!spend || typeof spend !== 'object') return { allowed: false, reason: 'budget_unavailable' };
  if (!Number.isInteger(spend.spentEurCents)) return { allowed: false, reason: 'budget_unavailable' };
  const projected = spend.spentEurCents + AI_MAX_COST_EUR_CENTS;
  if (projected > AI_MONTH_LIMIT_EUR_CENTS) {
    return { allowed: false, reason: 'budget_exhausted', projectedEurCents: projected };
  }
  return { allowed: true, reason: null, projectedEurCents: projected };
}

/** W4 shape for the screen: "AI deze maand EUR x van EUR 10". */
function publicMonthly(spend) {
  const value = spend && typeof spend === 'object' ? spend : {};
  const spent = Number.isInteger(value.spentEurCents) ? value.spentEurCents : null;
  const limit = Number.isInteger(value.limitEurCents) ? value.limitEurCents : AI_MONTH_LIMIT_EUR_CENTS;
  return {
    spentEurCents: spent,
    limitEurCents: limit,
    remainingEurCents: spent === null ? null : Math.max(0, limit - spent),
    unknownConcepts: Number.isInteger(value.unknownConcepts) ? value.unknownConcepts : 0,
  };
}

module.exports = {
  AI_API_KEY_ENV,
  AI_FEATURE_FLAG,
  AI_LIMITS,
  AI_MAX_COST_EUR_CENTS,
  AI_MODEL,
  AI_MONTH_LIMIT_EUR_CENTS,
  AI_PROVIDER,
  AI_READ_AI_NAME,
  AI_READ_LABEL,
  AI_READ_PROVENANCE_KIND,
  MAX_IMPORT_ITEMS,
  MAX_SOURCES,
  MESSAGES,
  aiConfiguration,
  budgetDecision,
  conceptCost,
  messageFor,
  monthStartIso,
  monthlySpendFromRows,
  publicMonthly,
  reply,
};
