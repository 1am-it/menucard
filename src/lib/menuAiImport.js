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

// W2 + Y1: one bounded synchronous call, no retry of its own. The route's own
// maxDuration (300 s, verified against Vercel's duration documentation in
// docs/guides/menu-extraction-implementation.md) has to cover the call plus
// validation and the concept write. The measured worst case was 46.8 s, so the
// call stops at 120 s and the job deadline at 150 s: roughly 2.5x the measured
// maximum and still 150 s of the function left for validation and the write.
const AI_LIMITS = Object.freeze({
  ...DEFAULT_EXTRACTION_LIMITS,
  callTimeoutMs: 120_000,
  jobDeadlineMs: 150_000,
  maxRetries: 0,
  maxCostEurCents: AI_MAX_COST_EUR_CENTS,
  maxConcurrency: 1,
});

// BE-36 (#87, criterion 4): every reason has its own sentence in plain Dutch
// with a next step. The manual import stays a small link on the screen; it is
// never the only thing an error says.
const MESSAGES = Object.freeze({
  ai_not_configured: 'AI is niet ingesteld.',
  ai_flagged_off: 'AI is niet ingesteld.',
  ai_key_missing: 'AI is niet ingesteld.',
  forbidden: 'Alleen interne medewerkers kunnen de kaart met AI laten lezen.',
  source_required: 'Kies eerst een bron die al in de app staat.',
  source_unknown: 'Deze bron hoort niet bij een bestaande analyse of import. Kies de bron opnieuw.',
  source_empty: 'Deze bron bevat geen leesbare tekst of afbeelding om aan de AI te geven.',
  budget_exhausted: 'Het budget van deze maand is op.',
  budget_unavailable: 'Het AI-gebruik kon niet worden gecontroleerd. Er is niets aangeroepen; probeer het later opnieuw.',
  budget_exceeded: 'Het budget van deze lezing is op. Probeer het opnieuw of lees minder pagina\'s.',
  invalid_request: 'Ongeldig verzoek. Vernieuw de pagina en probeer het opnieuw.',
  restaurant_required: 'Kies eerst een restaurant uit de bestaande lijst.',
  provider_unavailable: 'De AI is even niet bereikbaar. Probeer het over een minuut opnieuw.',
  model_unavailable: 'De AI is even niet bereikbaar. Probeer het over een minuut opnieuw.',
  rate_limited: 'De AI krijgt te veel verzoeken. Probeer het over een minuut opnieuw.',
  timeout: 'De AI deed er te lang over. Probeer het opnieuw.',
  output_truncated: 'Het antwoord van de AI was afgekapt. Probeer het opnieuw.',
  output_limit: 'Het antwoord van de AI was te groot voor één pagina. Probeer het opnieuw.',
  input_limit: 'Deze bron is te groot voor de AI. Lees een kleinere pagina of minder pagina\'s.',
  page_limit: 'Deze PDF heeft te veel pagina\'s voor één lezing.',
  document_limit: 'Er zijn te veel documenten voor één lezing.',
  schema_violation: 'Het antwoord van de AI past niet bij de afspraken. Er is niets opgeslagen; probeer het opnieuw.',
  no_items: 'De AI vond geen gerechten op deze pagina. Controleer de bron of probeer het opnieuw.',
  partial_read: 'Een deel van de kaart is gelezen. Probeer de pagina\'s die niet lukten opnieuw.',
  source_missing: 'De pagina staat niet meer op deze bron. Controleer de link of probeer het later opnieuw.',
  concept_failed: 'Het concept kon niet worden opgeslagen. De lezing is niet verloren: probeer het opnieuw.',
  budget_guard_required: 'De kostenbewaking is niet beschikbaar; er is niets aangeroepen.',
  async_budget_guard_unsupported: 'De kostenbewaking is niet beschikbaar; er is niets aangeroepen.',
  budget_settle_failed: 'De kosten van deze lezing konden niet worden vastgelegd; er is niets opgeslagen.',
});

function reply(status, body) {
  return { status, body };
}

function messageFor(reason) {
  return MESSAGES[reason] || 'De AI-lezing lukte niet. Probeer het opnieuw.';
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
 * A reading's cost is counted once per `readId`, so a corrected version of the
 * same reading does not spend the budget twice. A row without a measured cost
 * counts as the full per-call maximum, never as zero.
 */
function monthlySpendFromRows(rows, { now = new Date() } = {}) {
  const start = monthStartIso(now);
  let spentEurCents = 0;
  let concepts = 0;
  let unknownConcepts = 0;
  const countedReads = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.created_at !== 'string' || row.created_at < start) continue;
    concepts += 1;
    const provenance = row.captured_content && row.captured_content.importProvenance;
    const readKey = provenance && typeof provenance.readId === 'string' && provenance.readId !== ''
      ? provenance.readId
      : `row:${row.id === undefined || row.id === null ? concepts : row.id}`;
    if (countedReads.has(readKey)) continue;
    countedReads.add(readKey);
    const cost = conceptCost(row);
    if (!cost.known) unknownConcepts += 1;
    spentEurCents += cost.eurCents;
  }
  return {
    spentEurCents,
    concepts,
    reads: countedReads.size,
    unknownConcepts,
    limitEurCents: AI_MONTH_LIMIT_EUR_CENTS,
    remainingEurCents: Math.max(0, AI_MONTH_LIMIT_EUR_CENTS - spentEurCents),
    monthStart: start,
  };
}

/**
 * Refuse when the next call could pass the monthly ceiling. BE-36 (#87,
 * criterion 5): the reservation is no longer one fixed per-call maximum but the
 * planned maximum of this reading, which follows the number of pages. The
 * default stays the existing per-call maximum, so every other caller keeps its
 * current rule.
 */
function budgetDecision(spend, { maxEurCents = AI_MAX_COST_EUR_CENTS } = {}) {
  if (!spend || typeof spend !== 'object') return { allowed: false, reason: 'budget_unavailable' };
  if (!Number.isInteger(spend.spentEurCents)) return { allowed: false, reason: 'budget_unavailable' };
  const reservation = Number.isInteger(maxEurCents) && maxEurCents >= 0 ? maxEurCents : AI_MAX_COST_EUR_CENTS;
  const projected = spend.spentEurCents + reservation;
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

/**
 * The fixed provenance fields of one AI reading, taken only from the sealed
 * origin of a step or from the call itself. Returns null for anything that is
 * not this app's own AI reading, so a client can never claim that origin.
 */
function aiOriginOverrides(origin) {
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) return null;
  if (origin.kind !== AI_READ_PROVENANCE_KIND) return null;
  const cost = origin.cost && typeof origin.cost === 'object' && !Array.isArray(origin.cost) ? origin.cost : null;
  return {
    kind: AI_READ_PROVENANCE_KIND,
    label: AI_READ_LABEL,
    aiName: typeof origin.aiName === 'string' && origin.aiName.trim() !== '' ? origin.aiName.trim().slice(0, 80) : AI_READ_AI_NAME,
    aiNameSelfReported: false,
    provider: typeof origin.provider === 'string' ? origin.provider.trim().slice(0, 40) : null,
    model: typeof origin.model === 'string' ? origin.model.trim().slice(0, 60) : null,
    // One reading has one id: the ledger counts its cost once, also when the
    // human later saves a corrected version of the same reading.
    readId: typeof origin.readId === 'string' && origin.readId.trim() !== '' ? origin.readId.trim().slice(0, 80) : null,
    readAt: typeof origin.readAt === 'string' ? origin.readAt.slice(0, 40) : null,
    providerRequestId: typeof origin.requestId === 'string' ? origin.requestId.slice(0, 80) : null,
    cost: {
      eurCents: cost && Number.isInteger(cost.eurCents) ? cost.eurCents : null,
      known: Boolean(cost && cost.known === true && Number.isInteger(cost.eurCents)),
      source: 'usage',
    },
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
  aiOriginOverrides,
  budgetDecision,
  conceptCost,
  messageFor,
  monthStartIso,
  monthlySpendFromRows,
  publicMonthly,
  reply,
};
