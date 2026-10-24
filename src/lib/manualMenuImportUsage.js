'use strict';

// #59 fase 2 — export van het app-AI-gebruik (K1–K3, eigenaarsbesluit 2026-10-22,
// Lead-bevinding F6).
//
// De tellingen komen **uitsluitend uit wat al duurzaam is opgeslagen**: de
// conceptversies in `menu_snapshot_proposals` waarvan
// `captured_content.importProvenance.kind` gelijk is aan `handmatige_ai_import`.
// Daaruit lezen we de zelfgerapporteerde AI-naam, het importtijdstip en de
// regels die een mens heeft gecorrigeerd of weggelaten. Er is geen `Map` op
// moduleniveau meer: op Vercel zou zo'n teller per instantie leven en dus
// onwaar zijn. Er is ook geen nieuwe tabel en geen migratie.
//
// Wat niet duurzaam wordt bewaard — de gemaakte prompts, een gecontroleerde
// import die nooit is opgeslagen, een vervolgantwoord, een geweigerde opslag —
// staat in het document als de vaste tekst "niet bijgehouden" en **nooit als 0**.
// Een 0 betekent hier: gemeten en nul. Dat onderscheid is het punt van F6.
//
// Alleen metagegevens: toepassing, AI-naam, aantallen, tijdvak en kostenstatus.
// Geen menu-inhoud, geen prompts, geen sleutels en geen persoonsgegevens.
// Kosten staan er alleen in als ze gemeten zijn; anders staat er letterlijk
// "via abonnement, niet gemeten" en nooit 0. Het bestand is geen facturatie en
// geen bewijs dat een model is gebruikt.
//
// DevDashboardTower leest dit document als alleen-lezen bron; dit module schrijft
// niets en kent geen netwerk.

const USAGE_SCHEMA_VERSION = 'manual-ai-import-usage/v3';
const APPLICATION = 'handmatige-ai-import';
const APPLICATION_LABEL = 'menu-extractie';
const NOT_MEASURED_LABEL = 'via abonnement, niet gemeten';
const NOT_TRACKED_LABEL = 'niet bijgehouden';
const PROVENANCE_KIND = 'handmatige_ai_import';
// W7 of the Delivery Lead order (review 6380804419): a concept the app read
// itself ("Gelezen door AI") is counted in the same ledger and the same export,
// with its provider, model and measured cost.
const AI_READ_KIND = 'ai_gelezen';
const PROVENANCE_KINDS = Object.freeze([PROVENANCE_KIND, AI_READ_KIND]);
const MAX_AI_NAMES = 20;
const MAX_AI_NAME = 80;
const MAX_ROUTES = 8;
const MAX_NOTE = 300;
const MAX_SOURCE_ROWS = 5000;
// Spiegel van MAX_REASONS in src/lib/manualMenuImportReview.js: de herkomst wordt
// per concept op dat aantal beslissingen afgekapt. Is de grens bereikt, dan is de
// telling een ondergrens en meldt het document `bounded: true`. De test
// manualMenuImportUsage.test.js bewijst dat beide constanten gelijk blijven.
const MAX_ROW_DECISIONS = 200;

const PERIOD_BASIS = 'importProvenance.importedAt';

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

// Alleen deze route/actie-paren zijn uit duurzame gegevens af te leiden.
const DURABLE_ACTIONS = {
  [ROUTES.save]: ['concept_saved'],
};

// Alles wat de oude teller bijhield maar nergens duurzaam wordt bewaard. De
// reden staat erbij, zodat "niet bijgehouden" uitlegbaar is en niet als 0 leest.
const NOT_TRACKED = [
  {
    route: ROUTES.bundles,
    action: 'prompt_created',
    reason: 'De prompt wordt één keer teruggegeven en nooit bewaard.',
  },
  {
    route: ROUTES.imports,
    action: 'import_checked',
    reason: 'Een gecontroleerde import zonder opslag laat geen spoor na.',
  },
  {
    route: ROUTES.imports,
    action: 'rejected',
    reason: 'Een geweigerde import schrijft geen rij.',
  },
  {
    route: ROUTES.followUp,
    action: 'follow_up',
    reason: 'Een vervolgantwoord wordt niet bewaard.',
  },
  {
    route: ROUTES.save,
    action: 'rejected',
    reason: 'Een geweigerde opslag schrijft geen rij.',
  },
];

const DURABLE_SOURCE = {
  kind: 'durable',
  table: 'menu_snapshot_proposals',
  jsonField: 'captured_content.importProvenance',
  provenanceKind: PROVENANCE_KIND,
  provenanceKinds: [...PROVENANCE_KINDS],
  note: 'Tellingen komen uit opgeslagen conceptversies met importProvenance; niets wordt in het geheugen bijgehouden.',
};

const CONTENTS_NOTE = 'alleen metagegevens';
const SELF_REPORTED_NOTE = 'De AI-naam is zelfgerapporteerd en onbewezen.';
const NOT_TRACKED_NOTE = 'Stappen zonder duurzame opslag staan als "niet bijgehouden" en nooit als 0.';
const UNATTRIBUTED_NOTE = 'Concepten zonder AI-naam in de herkomst.';
const AI_OMITTED_NOTE = `Meer dan ${MAX_AI_NAMES} AI-namen: de rest is niet per naam uitgesplitst.`;
const AI_READ_NOTE = 'Alleen AI-concepten die de app zelf las, met provider, model en gemeten kosten; onbekende kosten staan er als onbekend.';

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function boundedText(value, max = MAX_NOTE) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, max);
}

function normalizeAiName(value) {
  const text = boundedText(value, MAX_AI_NAME);
  return text === null ? null : text;
}

function isoOrNull(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime()) ? null : stamp.toISOString();
}

function isIsoTimestamp(value) {
  const iso = isoOrNull(value);
  return iso !== null && iso === value;
}

/** De herkomst van één opgeslagen concept, of null als het geen AI-import is. */
function provenanceOf(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const content = row.captured_content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const provenance = content.importProvenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return null;
  if (!PROVENANCE_KINDS.includes(provenance.kind)) return null;
  return provenance;
}

/**
 * W7: the cost of one AI-read concept, from its own durable metadata. A
 * measured cost is an integer number of eurocents; everything else stays
 * unknown (never 0).
 */
function aiReadCost(provenance) {
  const cost = provenance && provenance.cost;
  if (cost && Number.isInteger(cost.eurCents) && cost.eurCents >= 0 && cost.known !== false) {
    return { known: true, eurCents: cost.eurCents };
  }
  return { known: false, eurCents: null };
}

/** Hoeveel regels een mens corrigeerde, wegliet of bevestigde (duurzaam bewaard). */
function rowDecisionCounts(provenance) {
  const list = Array.isArray(provenance.rows) ? provenance.rows : [];
  let corrected = 0;
  let omitted = 0;
  let confirmed = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.action === 'correct') corrected += 1;
    else if (entry.action === 'drop') omitted += 1;
    else confirmed += 1;
  }
  return { corrected, omitted, confirmed, bounded: list.length >= MAX_ROW_DECISIONS };
}

function costBlock(cost) {
  if (cost && typeof cost === 'object' && Number.isFinite(cost.amount) && cost.amount > 0 && typeof cost.currency === 'string' && cost.currency.trim()) {
    return { status: 'measured', amount: Number(cost.amount.toFixed(2)), currency: cost.currency.trim().slice(0, 3).toUpperCase() };
  }
  // Nooit 0 en nooit een schatting: een abonnement is niet gemeten.
  return { status: 'not_measured', label: NOT_MEASURED_LABEL };
}

/**
 * Bouwt het exportdocument uit duurzame conceptrijen
 * (`{ id, captured_content }`). `limit`/`bounded` komen uit de leesquery, zodat
 * een afgekapte leesactie zichtbaar blijft in plaats van stil te tellen.
 * `cost` hoort alleen gevuld te zijn als de kosten werkelijk gemeten zijn.
 */
function buildUsageExport({ rows, limit = MAX_SOURCE_ROWS, bounded, generatedAt = new Date(), cost = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const perAi = new Map();
  const perModel = new Map();
  const nameKinds = new Map();
  let used = 0;
  let ignored = 0;
  let unattributed = 0;
  let correctedRows = 0;
  let omittedRows = 0;
  let confirmedRows = 0;
  let decisionsBounded = false;
  let timestampsMissing = 0;
  let from = null;
  let to = null;
  // W7: AI reads ("Gelezen door AI") are counted in the same document, with
  // their own provider, model and measured cost. An unknown cost stays
  // unknown and is counted, never booked as 0.
  let aiReadConcepts = 0;
  let aiReadCostEurCents = 0;
  let aiReadUnknownCosts = 0;

  for (const row of list) {
    const provenance = provenanceOf(row);
    if (!provenance) {
      ignored += 1;
      continue;
    }
    const rawId = row.id;
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null;
    if (id !== null) {
      if (seen.has(id)) {
        ignored += 1;
        continue;
      }
      seen.add(id);
    }
    used += 1;
    const name = normalizeAiName(provenance.aiName);
    if (name === null) {
      unattributed += 1;
    } else {
      perAi.set(name, (perAi.get(name) || 0) + 1);
      nameKinds.set(name, provenance.kind);
    }
    if (provenance.kind === AI_READ_KIND) {
      aiReadConcepts += 1;
      const provider = boundedText(provenance.provider, 40);
      const model = boundedText(provenance.model, 60);
      const key = `${provider || 'onbekend'}\u0000${model || 'onbekend'}`;
      const entry = perModel.get(key) || { provider, model, concepts: 0, costEurCents: 0, unknownCosts: 0 };
      entry.concepts += 1;
      const cost = aiReadCost(provenance);
      if (cost.known) {
        entry.costEurCents += cost.eurCents;
        aiReadCostEurCents += cost.eurCents;
      } else {
        entry.unknownCosts += 1;
        aiReadUnknownCosts += 1;
      }
      perModel.set(key, entry);
    }
    const decisions = rowDecisionCounts(provenance);
    correctedRows += decisions.corrected;
    omittedRows += decisions.omitted;
    confirmedRows += decisions.confirmed;
    if (decisions.bounded) decisionsBounded = true;
    const importedAt = isoOrNull(provenance.importedAt);
    if (importedAt === null) timestampsMissing += 1;
    else {
      if (from === null || importedAt < from) from = importedAt;
      if (to === null || importedAt > to) to = importedAt;
    }
  }

  // Begrensd per AI-naam: eerst de namen met de meeste concepten, daarna
  // alfabetisch. Wat niet past wordt geteld en benoemd, nooit stil weggegooid.
  const ranked = [...perAi.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nl'));
  const kept = ranked.slice(0, MAX_AI_NAMES);
  const dropped = ranked.slice(MAX_AI_NAMES);
  const ai = kept.map(([aiName, concepts]) => ({
    aiName,
    // A name a person typed is self-reported; the name of a call this app made
    // itself is not.
    selfReported: nameKinds.get(aiName) !== AI_READ_KIND,
    counts: { concept_saved: concepts },
  }));
  // W7: per provider/model what it read and what it cost (or did not measure).
  const providers = [...perModel.entries()]
    .map(([, entry]) => ({
      provider: entry.provider,
      model: entry.model,
      concepts: entry.concepts,
      cost: entry.unknownCosts > 0 && entry.costEurCents === 0
        ? { status: 'not_measured', label: NOT_MEASURED_LABEL, unknownConcepts: entry.unknownCosts }
        : {
            status: 'measured',
            amountEurCents: entry.costEurCents,
            currency: 'EUR',
            unknownConcepts: entry.unknownCosts,
          },
    }))
    .sort((a, b) => b.concepts - a.concepts || String(a.provider).localeCompare(String(b.provider), 'nl'));
  const aiRead = {
    concepts: aiReadConcepts,
    cost: aiReadConcepts === 0 || (aiReadCostEurCents === 0 && aiReadUnknownCosts > 0)
      ? { status: 'not_measured', label: NOT_MEASURED_LABEL, unknownConcepts: aiReadUnknownCosts }
      : {
          status: 'measured',
          amountEurCents: aiReadCostEurCents,
          currency: 'EUR',
          unknownConcepts: aiReadUnknownCosts,
        },
    providers,
    note: AI_READ_NOTE,
  };
  const aiOmitted = {
    names: dropped.length,
    concepts: dropped.reduce((sum, [, concepts]) => sum + concepts, 0),
    note: AI_OMITTED_NOTE,
  };

  const routes = Object.entries(DURABLE_ACTIONS).map(([route, actions]) => ({
    route,
    counts: Object.fromEntries(actions.map((action) => [action, action === 'concept_saved' ? used : 0])),
  }));

  const totals = {
    promptCreated: NOT_TRACKED_LABEL,
    importChecked: NOT_TRACKED_LABEL,
    followUp: NOT_TRACKED_LABEL,
    conceptSaved: used,
    rejected: NOT_TRACKED_LABEL,
  };

  const effectiveLimit = isCount(limit) && limit > 0 ? limit : MAX_SOURCE_ROWS;
  const effectiveBounded = typeof bounded === 'boolean' ? bounded : list.length >= effectiveLimit;
  const stamp = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);

  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    application: APPLICATION,
    applicationLabel: APPLICATION_LABEL,
    generatedAt: stamp.toISOString(),
    source: {
      ...DURABLE_SOURCE,
      rowsRead: list.length,
      rowsUsed: used,
      rowsIgnored: ignored,
      limit: effectiveLimit,
      bounded: effectiveBounded,
    },
    period: { from, to, basis: PERIOD_BASIS, timestampsMissing },
    costs: costBlock(cost),
    routes,
    ai,
    aiRead,
    aiOmitted,
    unattributed: { concepts: unattributed, note: UNATTRIBUTED_NOTE },
    reviewOutcomes: {
      concepts: used,
      correctedRows,
      omittedRows,
      confirmedRows,
      bounded: decisionsBounded,
    },
    totals,
    notTracked: NOT_TRACKED.map((entry) => ({ ...entry })),
    actionLabels: { ...ACTION_LABELS },
    // Expliciet: dit bestand is geen menu-inhoud en geen bewijs van kwaliteit.
    contents: CONTENTS_NOTE,
    selfReportedNote: SELF_REPORTED_NOTE,
    notTrackedNote: NOT_TRACKED_NOTE,
  };
}

const ALLOWED_FIELDS = [
  'schemaVersion',
  'application',
  'applicationLabel',
  'generatedAt',
  'source',
  'period',
  'costs',
  'routes',
  'ai',
  'aiRead',
  'aiOmitted',
  'unattributed',
  'reviewOutcomes',
  'totals',
  'notTracked',
  'actionLabels',
  'contents',
  'selfReportedNote',
  'notTrackedNote',
];

const TOTAL_ACTIONS = {
  promptCreated: 'prompt_created',
  importChecked: 'import_checked',
  followUp: 'follow_up',
  conceptSaved: 'concept_saved',
  rejected: 'rejected',
};

/** Strict leescontrole voor de consument (DevDashboardTower) en de tests. */
function validateUsageExport(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['usage export must be an object'];
  if (doc.schemaVersion !== USAGE_SCHEMA_VERSION) problems.push('schemaVersion is not supported');
  if (doc.application !== APPLICATION) problems.push('application is not recognised');
  if (doc.applicationLabel !== APPLICATION_LABEL) problems.push('applicationLabel is not recognised');
  if (!isIsoTimestamp(doc.generatedAt)) problems.push('generatedAt must be an ISO timestamp');

  const source = doc.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    problems.push('source is required');
  } else {
    if (source.kind !== DURABLE_SOURCE.kind) problems.push('source.kind must be durable');
    if (source.table !== DURABLE_SOURCE.table) problems.push('source.table is not the durable concept table');
    if (source.jsonField !== DURABLE_SOURCE.jsonField) problems.push('source.jsonField is not the provenance field');
    if (source.provenanceKind !== PROVENANCE_KIND) problems.push('source.provenanceKind is not supported');
    if (!Array.isArray(source.provenanceKinds) || source.provenanceKinds.join(',') !== PROVENANCE_KINDS.join(',')) {
      problems.push('source.provenanceKinds must list both supported kinds');
    }
    for (const key of ['rowsRead', 'rowsUsed', 'rowsIgnored']) if (!isCount(source[key])) problems.push(`source.${key} must be a non-negative integer`);
    if (!isCount(source.limit) || source.limit === 0) problems.push('source.limit must be a positive integer');
    if (isCount(source.limit) && source.limit > MAX_SOURCE_ROWS) problems.push('source.limit is above the fixed maximum');
    if (typeof source.bounded !== 'boolean') problems.push('source.bounded must be a boolean');
    if (isCount(source.rowsRead) && isCount(source.rowsUsed) && isCount(source.rowsIgnored) && source.rowsRead !== source.rowsUsed + source.rowsIgnored) {
      problems.push('source.rowsRead must equal rowsUsed + rowsIgnored');
    }
    if (isCount(source.rowsRead) && isCount(source.limit) && source.limit > 0 && source.bounded !== source.rowsRead >= source.limit) {
      problems.push('source.bounded must reflect the row limit');
    }
  }

  const period = doc.period;
  if (!period || typeof period !== 'object' || Array.isArray(period)) {
    problems.push('period is required');
  } else {
    for (const key of ['from', 'to']) if (period[key] !== null && !isIsoTimestamp(period[key])) problems.push(`period.${key} must be null or an ISO timestamp`);
    if (typeof period.from === 'string' && typeof period.to === 'string' && period.from > period.to) problems.push('period.from must not be after period.to');
    if (period.basis !== PERIOD_BASIS) problems.push('period.basis is not the provenance timestamp');
    if (!isCount(period.timestampsMissing)) problems.push('period.timestampsMissing must be a non-negative integer');
  }

  const costs = doc.costs;
  if (!costs || typeof costs !== 'object' || Array.isArray(costs)) {
    problems.push('costs are required');
  } else {
    if (!['measured', 'not_measured'].includes(costs.status)) problems.push('costs.status is invalid');
    if (costs.status === 'not_measured' && costs.label !== NOT_MEASURED_LABEL) problems.push('not measured costs need the fixed label');
    if (costs.status === 'measured' && !(Number.isFinite(costs.amount) && costs.amount > 0)) problems.push('measured costs need a positive amount');
  }

  const routes = Array.isArray(doc.routes) ? doc.routes : null;
  if (!routes) {
    problems.push('routes must be an array');
  } else {
    if (routes.length > MAX_ROUTES) problems.push('routes is too long');
    const seenRoutes = new Set();
    for (const entry of routes) {
      const durable = entry && typeof entry.route === 'string' ? DURABLE_ACTIONS[entry.route] : null;
      if (!durable) {
        problems.push('unknown or not durable route');
        continue;
      }
      if (seenRoutes.has(entry.route)) problems.push('duplicate route');
      seenRoutes.add(entry.route);
      const counts = entry && entry.counts && typeof entry.counts === 'object' ? entry.counts : null;
      const keys = counts ? Object.keys(counts).sort().join(',') : '';
      if (!counts || keys !== [...durable].sort().join(',')) problems.push(`route ${entry.route} must carry exactly ${durable.join(', ')}`);
      for (const action of durable) if (!isCount(counts && counts[action])) problems.push('route counts are invalid');
    }
    for (const route of Object.keys(DURABLE_ACTIONS)) if (!seenRoutes.has(route)) problems.push(`route ${route} is missing`);
  }

  const ai = Array.isArray(doc.ai) ? doc.ai : null;
  if (!ai) {
    problems.push('ai must be an array');
  } else {
    if (ai.length > MAX_AI_NAMES) problems.push('ai is too long');
    const names = new Set();
    for (const entry of ai) {
      if (!entry || typeof entry.aiName !== 'string' || entry.aiName.trim() === '' || entry.aiName.length > MAX_AI_NAME) {
        problems.push('ai name is invalid');
      } else if (names.has(entry.aiName)) {
        problems.push('duplicate ai name');
      } else {
        names.add(entry.aiName);
      }
      if (!entry || typeof entry.selfReported !== 'boolean') problems.push('ai entry must state whether the name is self-reported');
      const counts = entry && entry.counts && typeof entry.counts === 'object' ? entry.counts : null;
      const keys = counts ? Object.keys(counts).sort().join(',') : '';
      if (!counts || keys !== 'concept_saved') problems.push('ai counts must carry exactly concept_saved');
      if (!isCount(counts && counts.concept_saved)) problems.push('ai counts are invalid');
    }
  }

  const aiRead = doc.aiRead;
  if (!aiRead || typeof aiRead !== 'object' || Array.isArray(aiRead)) {
    problems.push('aiRead is required');
  } else {
    if (!isCount(aiRead.concepts)) problems.push('aiRead.concepts must be a non-negative integer');
    if (boundedText(aiRead.note) === null) problems.push('aiRead.note is required');
    const cost = aiRead.cost;
    if (!cost || typeof cost !== 'object' || Array.isArray(cost)) {
      problems.push('aiRead.cost is required');
    } else {
      if (!['measured', 'not_measured'].includes(cost.status)) problems.push('aiRead.cost.status is invalid');
      if (!isCount(cost.unknownConcepts)) problems.push('aiRead.cost.unknownConcepts must be a non-negative integer');
      if (cost.status === 'measured') {
        if (!(Number.isInteger(cost.amountEurCents) && cost.amountEurCents >= 0)) problems.push('measured aiRead cost needs eurocents');
        if (cost.currency !== 'EUR') problems.push('measured aiRead cost must be in EUR');
      } else if (cost.label !== NOT_MEASURED_LABEL) {
        problems.push('unmeasured aiRead cost needs the fixed label');
      }
    }
    const providers = Array.isArray(aiRead.providers) ? aiRead.providers : null;
    if (!providers) {
      problems.push('aiRead.providers must be an array');
    } else {
      if (providers.length > MAX_AI_NAMES) problems.push('aiRead.providers is too long');
      for (const entry of providers) {
        if (!entry || typeof entry !== 'object') {
          problems.push('aiRead provider entry is invalid');
          continue;
        }
        if (entry.provider !== null && boundedText(entry.provider, 40) === null) problems.push('aiRead provider name is invalid');
        if (entry.model !== null && boundedText(entry.model, 60) === null) problems.push('aiRead model name is invalid');
        if (!isCount(entry.concepts)) problems.push('aiRead provider concepts must be a non-negative integer');
        const entryCost = entry.cost && typeof entry.cost === 'object' ? entry.cost : null;
        if (!entryCost) problems.push('aiRead provider cost is required');
        else if (!['measured', 'not_measured'].includes(entryCost.status)) problems.push('aiRead provider cost status is invalid');
        else if (!isCount(entryCost.unknownConcepts)) problems.push('aiRead provider unknownConcepts must be a non-negative integer');
      }
      if (isCount(aiRead.concepts) && providers.reduce((sum, entry) => sum + (entry && isCount(entry.concepts) ? entry.concepts : 0), 0) !== aiRead.concepts) {
        problems.push('aiRead provider concepts must add up');
      }
    }
  }

  const aiOmitted = doc.aiOmitted;
  if (!aiOmitted || typeof aiOmitted !== 'object' || Array.isArray(aiOmitted)) {
    problems.push('aiOmitted is required');
  } else {
    if (!isCount(aiOmitted.names)) problems.push('aiOmitted.names must be a non-negative integer');
    if (!isCount(aiOmitted.concepts)) problems.push('aiOmitted.concepts must be a non-negative integer');
    if (aiOmitted.names === 0 && aiOmitted.concepts !== 0) problems.push('aiOmitted must not count concepts without omitted names');
    if (boundedText(aiOmitted.note) === null) problems.push('aiOmitted.note is required');
  }

  const unattributed = doc.unattributed;
  if (!unattributed || typeof unattributed !== 'object' || Array.isArray(unattributed)) {
    problems.push('unattributed is required');
  } else {
    if (!isCount(unattributed.concepts)) problems.push('unattributed.concepts must be a non-negative integer');
    if (boundedText(unattributed.note) === null) problems.push('unattributed.note is required');
  }

  const review = doc.reviewOutcomes;
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    problems.push('reviewOutcomes is required');
  } else {
    for (const key of ['concepts', 'correctedRows', 'omittedRows', 'confirmedRows']) {
      if (!isCount(review[key])) problems.push(`reviewOutcomes.${key} must be a non-negative integer`);
    }
    if (typeof review.bounded !== 'boolean') problems.push('reviewOutcomes.bounded must be a boolean');
    if (isCount(review.concepts) && source && isCount(source.rowsUsed) && review.concepts !== source.rowsUsed) {
      problems.push('reviewOutcomes.concepts must equal source.rowsUsed');
    }
  }

  const totals = doc.totals;
  if (!totals || typeof totals !== 'object' || Array.isArray(totals)) {
    problems.push('totals are required');
  } else {
    if (Object.keys(totals).length !== Object.keys(TOTAL_ACTIONS).length) problems.push('totals must carry exactly five counters');
    for (const key of Object.keys(TOTAL_ACTIONS)) {
      const value = totals[key];
      if (value !== NOT_TRACKED_LABEL && !isCount(value)) problems.push(`totals.${key} must be a count or the fixed not-tracked label`);
    }
    const routeHas = (action) => Boolean(routes) && routes.some((entry) => entry && entry.counts && isCount(entry.counts[action]));
    const listedAsNotTracked = (action) => Array.isArray(doc.notTracked) && doc.notTracked.some((entry) => entry && entry.action === action);
    for (const [key, action] of Object.entries(TOTAL_ACTIONS)) {
      const value = totals[key];
      if (isCount(value)) {
        if (!routeHas(action)) {
          problems.push(`totals.${key} is a count but no route tracks it`);
        } else if (routes.reduce((sum, entry) => sum + (isCount(entry.counts[action]) ? entry.counts[action] : 0), 0) !== value) {
          problems.push(`totals.${key} must equal the route sum`);
        }
        if (listedAsNotTracked(action)) problems.push(`totals.${key} is tracked and must not be listed as not tracked`);
      } else if (value === NOT_TRACKED_LABEL) {
        if (routeHas(action)) problems.push(`totals.${key} is not tracked but a route counts it`);
        if (!listedAsNotTracked(action)) problems.push(`totals.${key} needs a notTracked reason`);
      }
    }
    if (isCount(totals.conceptSaved) && ai) {
      const perName = ai.reduce((sum, entry) => sum + (entry && isCount(entry.counts && entry.counts.concept_saved) ? entry.counts.concept_saved : 0), 0);
      const rest =
        (isCount(unattributed && unattributed.concepts) ? unattributed.concepts : 0) +
        (isCount(aiOmitted && aiOmitted.concepts) ? aiOmitted.concepts : 0);
      if (perName + rest !== totals.conceptSaved) problems.push('saved concepts must add up: per AI + unattributed + omitted');
    }
  }

  const notTracked = Array.isArray(doc.notTracked) ? doc.notTracked : null;
  if (!notTracked) {
    problems.push('notTracked must be an array');
  } else {
    if (notTracked.length > MAX_ROUTES * ACTIONS.length) problems.push('notTracked is too long');
    const pairs = new Set();
    for (const entry of notTracked) {
      if (!entry || typeof entry !== 'object') {
        problems.push('notTracked entry is invalid');
        continue;
      }
      if (!Object.values(ROUTES).includes(entry.route)) problems.push('notTracked.route is unknown');
      if (!ACTIONS.includes(entry.action)) problems.push('notTracked.action is unknown');
      const durable = DURABLE_ACTIONS[entry.route];
      if (Array.isArray(durable) && durable.includes(entry.action)) problems.push('a durably tracked action must not be listed as not tracked');
      if (entry.counts !== undefined) problems.push('notTracked entries must not carry counts');
      const pair = `${entry.route}|${entry.action}`;
      if (pairs.has(pair)) problems.push('duplicate notTracked entry');
      pairs.add(pair);
      if (boundedText(entry.reason) === null) problems.push('notTracked.reason is required');
    }
  }

  if (doc.contents !== CONTENTS_NOTE) problems.push('contents must state metadata only');
  if (boundedText(doc.selfReportedNote) === null) problems.push('selfReportedNote is required');
  if (boundedText(doc.notTrackedNote) === null) problems.push('notTrackedNote is required');
  if (!doc.actionLabels || typeof doc.actionLabels !== 'object' || Array.isArray(doc.actionLabels)) problems.push('actionLabels are required');

  // Geen menu-inhoud, prompts of sleutels: een vaste, kleine sleutelset.
  for (const key of Object.keys(doc)) if (!ALLOWED_FIELDS.includes(key)) problems.push(`unknown field: ${key}`);
  return problems;
}

module.exports = {
  USAGE_SCHEMA_VERSION,
  APPLICATION,
  APPLICATION_LABEL,
  NOT_MEASURED_LABEL,
  NOT_TRACKED_LABEL,
  PROVENANCE_KIND,
  AI_READ_KIND,
  PROVENANCE_KINDS,
  PERIOD_BASIS,
  DURABLE_SOURCE,
  ROUTES,
  ACTIONS,
  ACTION_LABELS,
  DURABLE_ACTIONS,
  NOT_TRACKED,
  MAX_AI_NAMES,
  MAX_AI_NAME,
  MAX_SOURCE_ROWS,
  MAX_ROW_DECISIONS,
  buildUsageExport,
  validateUsageExport,
};

