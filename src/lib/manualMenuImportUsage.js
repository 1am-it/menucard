'use strict';

// #59 fase 2 — export van het app-AI-gebruik (K7, eigenaarsbesluit 2026-10-22).
//
// Alleen metagegevens: toepassing, route, de zelfgerapporteerde AI-naam, de
// aantallen per stap, het tijdvak en de kostenstatus. Geen menu-inhoud, geen
// prompts, geen sleutels en geen persoonsgegevens. Kosten staan er alleen in
// als ze gemeten zijn; anders staat er letterlijk "via abonnement, niet
// gemeten" en nooit 0. Het bestand is geen facturatie en geen bewijs dat een
// model is gebruikt.
//
// DevDashboardTower leest dit bestand als alleen-lezen bron; dit module schrijft
// niets en kent geen netwerk.

const USAGE_SCHEMA_VERSION = 'manual-ai-import-usage/v1';
const APPLICATION = 'handmatige-ai-import';
const APPLICATION_LABEL = 'menu-extractie';
const NOT_MEASURED_LABEL = 'via abonnement, niet gemeten';
const MAX_AI_NAMES = 20;
const MAX_AI_NAME = 80;
const MAX_ROUTES = 8;

const ACTIONS = ['prompt_created', 'import_checked', 'follow_up', 'concept_saved', 'rejected'];

// Vaste routelijst: een route is nooit vrije tekst uit een verzoek.
const ROUTES = {
  bundles: 'manual-menu-import/bundles',
  imports: 'manual-menu-import/imports',
  decisions: 'manual-menu-import/decisions',
  followUp: 'manual-menu-import/follow-up',
  save: 'manual-menu-import/save',
};

const ACTION_LABELS = {
  prompt_created: 'prompts gemaakt',
  import_checked: 'imports gecontroleerd',
  follow_up: 'vervolgprompts',
  concept_saved: 'opgeslagen concepten',
  rejected: 'geweigerd',
};

function emptyCounts() {
  return { prompt_created: 0, import_checked: 0, follow_up: 0, concept_saved: 0, rejected: 0 };
}

/** De teller per route en per AI-naam; beide begrensd. */
class ManualImportUsageLedger {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.byRoute = new Map();
    this.byAiName = new Map();
    this.startedAt = this.now().toISOString();
  }

  record({ route, aiName, action } = {}) {
    if (!Object.values(ROUTES).includes(route)) return { ok: false, code: 'unknown_route' };
    if (!ACTIONS.includes(action)) return { ok: false, code: 'unknown_action' };
    const counts = this.byRoute.get(route) || emptyCounts();
    counts[action] += 1;
    this.byRoute.set(route, counts);
    const name = typeof aiName === 'string' && aiName.trim() ? aiName.trim().slice(0, MAX_AI_NAME) : null;
    if (name) {
      const perAi = this.byAiName.get(name) || emptyCounts();
      perAi[action] += 1;
      this.byAiName.set(name, perAi);
      while (this.byAiName.size > MAX_AI_NAMES) {
        const oldest = this.byAiName.keys().next().value;
        this.byAiName.delete(oldest);
      }
    }
    return { ok: true };
  }

  totals() {
    const totals = emptyCounts();
    for (const counts of this.byRoute.values()) for (const action of ACTIONS) totals[action] += counts[action];
    return totals;
  }
}

function roundCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function costBlock(cost) {
  if (cost && typeof cost === 'object' && Number.isFinite(cost.amount) && cost.amount > 0 && typeof cost.currency === 'string' && cost.currency.trim()) {
    return { status: 'measured', amount: Number(cost.amount.toFixed(2)), currency: cost.currency.trim().slice(0, 3).toUpperCase() };
  }
  // Nooit 0 en nooit een schatting: een abonnement is niet gemeten.
  return { status: 'not_measured', label: NOT_MEASURED_LABEL };
}

/**
 * Bouwt het exportbestand. `from`/`to` zijn het tijdvak; `cost` alleen als de
 * kosten werkelijk gemeten zijn.
 */
function buildUsageExport({ ledger, from, to, generatedAt = new Date(), cost = null } = {}) {
  const routes = [...(ledger ? ledger.byRoute.entries() : [])]
    .slice(0, MAX_ROUTES)
    .map(([route, counts]) => ({ route, counts: { ...counts } }));
  const ai = [...(ledger ? ledger.byAiName.entries() : [])]
    .slice(0, MAX_AI_NAMES)
    .map(([aiName, counts]) => ({ aiName, selfReported: true, counts: { ...counts } }));
  const totalsRaw = ledger ? ledger.totals() : emptyCounts();
  const totals = {
    promptCreated: roundCount(totalsRaw.prompt_created),
    importChecked: roundCount(totalsRaw.import_checked),
    followUp: roundCount(totalsRaw.follow_up),
    conceptSaved: roundCount(totalsRaw.concept_saved),
    rejected: roundCount(totalsRaw.rejected),
  };
  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    application: APPLICATION,
    applicationLabel: APPLICATION_LABEL,
    generatedAt: (generatedAt instanceof Date ? generatedAt : new Date(generatedAt)).toISOString(),
    period: {
      from: typeof from === 'string' ? from : (ledger ? ledger.startedAt : null),
      to: typeof to === 'string' ? to : (generatedAt instanceof Date ? generatedAt : new Date(generatedAt)).toISOString(),
    },
    costs: costBlock(cost),
    routes,
    ai,
    totals,
    actionLabels: { ...ACTION_LABELS },
    // Expliciet: dit bestand is geen menu-inhoud en geen bewijs van kwaliteit.
    contents: 'alleen metagegevens',
    selfReportedNote: 'De AI-naam is zelfgerapporteerd en onbewezen.',
  };
}

/** Strict leescontrole voor de consument (DevDashboardTower) en de tests. */
function validateUsageExport(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['usage export must be an object'];
  if (doc.schemaVersion !== USAGE_SCHEMA_VERSION) problems.push('schemaVersion is not supported');
  if (doc.application !== APPLICATION) problems.push('application is not recognised');
  if (!Array.isArray(doc.routes) || doc.routes.length > MAX_ROUTES) problems.push('routes must be a bounded array');
  if (!Array.isArray(doc.ai) || doc.ai.length > MAX_AI_NAMES) problems.push('ai must be a bounded array');
  for (const entry of Array.isArray(doc.routes) ? doc.routes : []) {
    if (!entry || typeof entry.route !== 'string' || !Object.values(ROUTES).includes(entry.route)) problems.push('unknown route');
    if (!entry || !entry.counts || ACTIONS.some((action) => !Number.isInteger(entry.counts[action]) || entry.counts[action] < 0)) {
      problems.push('route counts are invalid');
    }
  }
  for (const entry of Array.isArray(doc.ai) ? doc.ai : []) {
    if (!entry || typeof entry.aiName !== 'string' || entry.aiName.trim() === '' || entry.aiName.length > MAX_AI_NAME) problems.push('ai name is invalid');
    if (!entry || entry.selfReported !== true) problems.push('ai name must be marked self-reported');
    if (!entry || !entry.counts || ACTIONS.some((action) => !Number.isInteger(entry.counts[action]) || entry.counts[action] < 0)) {
      problems.push('ai counts are invalid');
    }
  }
  const costs = doc.costs;
  if (!costs || !['measured', 'not_measured'].includes(costs.status)) problems.push('costs.status is invalid');
  if (costs && costs.status === 'not_measured' && costs.label !== NOT_MEASURED_LABEL) problems.push('not measured costs need the fixed label');
  if (costs && costs.status === 'measured' && !(Number.isFinite(costs.amount) && costs.amount > 0)) problems.push('measured costs need a positive amount');
  // Geen menu-inhoud, prompts of sleutels: een vaste, kleine sleutelset.
  const allowed = ['schemaVersion', 'application', 'applicationLabel', 'generatedAt', 'period', 'costs', 'routes', 'ai', 'totals', 'actionLabels', 'contents', 'selfReportedNote'];
  for (const key of Object.keys(doc)) if (!allowed.includes(key)) problems.push(`unknown field: ${key}`);
  return problems;
}

const sharedUsageLedger = new ManualImportUsageLedger();

module.exports = {
  USAGE_SCHEMA_VERSION,
  APPLICATION,
  APPLICATION_LABEL,
  NOT_MEASURED_LABEL,
  ROUTES,
  ACTIONS,
  ACTION_LABELS,
  ManualImportUsageLedger,
  sharedUsageLedger,
  buildUsageExport,
  validateUsageExport,
};

