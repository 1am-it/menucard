'use strict';

// #59 fase 2 — veilig importeren van een geplakt AI-antwoord (K3, K4).
//
// Het geplakte antwoord is onbetrouwbare data:
//   - harde groottegrens (1 MiB) vóór er iets wordt geparsed;
//   - vergevingsgezinde codeblokextractie: de app haalt het codeblok zelf uit
//     het volledige antwoord en geeft anders een gewone melding, nooit een
//     technische parsefout;
//   - `JSON.parse` in een try/catch, daarna uitsluitend als data behandeld;
//   - validatie met de bestaande `validateStructuredOutput` en dezelfde
//     `LIMITS`, aangevuld met de bundelbinding (bron en SHA-256), de
//     Money-regels van het concept en de relatieregels (varianten,
//     supplementen, arrangementen).
//
// Het resultaat is per regel één van vier toestanden: geldig, fout,
// niet automatisch controleerbaar of niet opslaanbaar. Een geldige JSON is
// geen kwaliteitsacceptatie: nul items is geen geslaagde extractie.
//
// Puur en zonder fetch/database, zodat elke regel met een test te bewijzen is.

const schema = require('./menuExtractionSchema');
const { normalizePrice } = require('./menuConcept');
const { computeBundleHash } = require('./manualMenuImportBundle');
const { describeImportProblems } = require('./manualMenuImportProblems');
const { applyDerivableNormalizations, describeNormalization } = require('./menuExtractionNormalization');

const MAX_ANSWER_BYTES = 1024 * 1024;
const MAX_AI_NAME = schema.LIMITS.label;
const MAX_PROBLEMS = 20;
const MAX_QUESTION = 400;

const ROW_STATES = ['valid', 'error', 'unverifiable', 'unsupported'];

const STATE_LABELS = {
  valid: 'in orde',
  error: 'staat niet in de bron',
  unverifiable: 'uit scan, controleer',
  unsupported: 'niet op te slaan',
};

const ROW_CODES = {
  quote_not_in_source: { state: 'error', label: 'staat niet in de bron', askAi: true },
  source_hash_mismatch: { state: 'error', label: 'staat niet in de bron', askAi: true },
  unknown_source: { state: 'error', label: 'staat niet in de bron', askAi: false },
  locator_invalid: { state: 'error', label: 'staat niet in de bron', askAi: true },
  scan_unverified: { state: 'unverifiable', label: 'uit scan, controleer', askAi: true },
  category_uncertain: { state: 'unverifiable', label: 'rubriek controleren', askAi: true },
  price_variant: { state: 'unsupported', label: 'twee prijzen', askAi: false },
  supplement_as_main_price: { state: 'unsupported', label: 'is een toeslag', askAi: true },
  from_price: { state: 'unsupported', label: 'niet op te slaan', askAi: true },
  allergens: { state: 'unsupported', label: 'niet op te slaan', askAi: true },
  availability: { state: 'unsupported', label: 'niet op te slaan', askAi: true },
  price_out_of_concept_range: { state: 'unsupported', label: 'niet op te slaan', askAi: false },
  arrangement_like: { state: 'unsupported', label: 'niet op te slaan', askAi: true },
};

const ARRANGEMENT_SIGNAL = /\b(arrangement|meergangen|meer\s*gangen|keuzemenu|keuze\s*menu|verrassingsmenu|chef'?s?\s*menu|shared\s*dining|proeverij)\b/i;

function humanMessage(code) {
  switch (code) {
    case 'ai_name_required':
      return 'Vul eerst in welke AI je gebruikte.';
    case 'answer_required':
      return 'Plak eerst het antwoord van de AI.';
    case 'answer_too_large':
      return 'Dit antwoord is groter dan 1 MiB. Kopieer alleen het codeblok.';
    case 'code_block_missing':
    case 'invalid_json':
      return 'Kopieer alleen het codeblok uit het antwoord van de AI.';
    case 'no_items':
      return 'Geen gerechten gevonden. Dit is geen geslaagde extractie; controleer de bron of vraag de AI opnieuw.';
    case 'schema_violation':
      return 'Het antwoord past niet bij de afspraken. Vraag de AI om alleen het codeblok opnieuw te geven.';
    case 'bundle_expired':
    case 'unknown_bundle':
      return 'Deze prompt is verlopen of hoort niet bij deze import. Maak een nieuwe prompt en plak het nieuwe antwoord.';
    case 'bundle_hash_mismatch':
      return 'De prompt en de bron zijn intussen gewijzigd. Maak een nieuwe prompt voordat je importeert.';
    default:
      return 'Het antwoord kon niet worden gecontroleerd.';
  }
}

function boundedProblems(problems) {
  return (Array.isArray(problems) ? problems : []).slice(0, MAX_PROBLEMS).map((text) => String(text).slice(0, 240));
}

// ── V1/V2 (Delivery Lead review 6377050602) ─────────────────────────────────
// Het taalmodel telt onbetrouwbaar. `coverage.itemsExtracted` en een
// `complete`-status met limitations zijn uit het antwoord zelf af te leiden, dus
// past de handmatige import exact dezelfde functie toe als route B
// (src/lib/menuExtractionNormalization.js) — geen tweede implementatie. Dat
// gebeurt vóór `validateStructuredOutput`, zodat de validator ongewijzigd blijft
// en een foute telling alleen via deze bewezen afleiding wordt geaccepteerd.
//
// Een toegepaste correctie verdwijnt niet: elk item krijgt een `notice` in
// gewone taal, gaat mee in het toestandstoken, komt op het reviewscherm en
// wordt bij het concept bewaard (`importProvenance.normalizations`).

function withNotice(entry) {
  const notice = describeNormalization(entry);
  return notice ? { ...entry, notice } : { ...entry };
}

/**
 * De aangevraagde en al eerder toegepaste correcties, zonder dubbelen. Een
 * vervolgvraag bouwt het rapport opnieuw op; de eerdere melding moet dan
 * zichtbaar blijven in plaats van stil te verdwijnen.
 */
function mergeNormalizations(carried, applied) {
  const merged = [];
  const seen = new Set();
  for (const entry of [...(Array.isArray(carried) ? carried : []), ...(Array.isArray(applied) ? applied : [])]) {
    if (!entry || typeof entry !== 'object' || typeof entry.rule !== 'string') continue;
    const key = `${entry.rule}\u0000${typeof entry.field === 'string' ? entry.field : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(withNotice(entry));
  }
  return merged;
}

/** Het AI-naamveld is zelfgerapporteerd en onbewezen; leeg is geen import. */
function validateAiName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return { ok: false, code: 'ai_name_required', message: humanMessage('ai_name_required') };
  if (text.length > MAX_AI_NAME) {
    return { ok: false, code: 'ai_name_required', message: `Vul een AI-naam van maximaal ${MAX_AI_NAME} tekens in.` };
  }
  return { ok: true, aiName: text };
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : '', 'utf8');
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Vergevingsgezinde codeblokextractie. Volgorde:
 *   1. elk ```-codeblok, van boven naar beneden; het eerste blok dat een
 *      JSON-object met een toegestane topsleutel oplevert wint;
 *   2. anders de hele plak, als die zelf met `{` begint en parseert;
 *   3. anders het buitenste `{ … }`-bereik uit de tekst.
 * Geen enkele tak geeft een technische parsefout aan de gebruiker.
 */
function extractCodeBlock(answer) {
  const text = typeof answer === 'string' ? answer : '';
  if (text.trim() === '') return { ok: false, code: 'answer_required', message: humanMessage('answer_required') };
  if (byteLength(text) > MAX_ANSWER_BYTES) return { ok: false, code: 'answer_too_large', message: humanMessage('answer_too_large') };

  const candidates = [];
  const fence = /```([a-zA-Z0-9_-]*)[ \t]*\n([\s\S]*?)```/g;
  let match;
  while ((match = fence.exec(text)) !== null) candidates.push({ body: match[2], source: 'code_block' });
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) candidates.push({ body: trimmed, source: 'whole' });
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push({ body: text.slice(first, last + 1), source: 'braces' });

  let sawJson = false;
  for (const candidate of candidates) {
    let value;
    try {
      value = JSON.parse(candidate.body);
    } catch {
      continue;
    }
    sawJson = true;
    const object = asObject(value);
    if (!object) continue;
    const keys = Object.keys(object);
    if (!keys.some((key) => schema.EXTRACTION_OUTPUT_SCHEMA.allowedTopLevel.includes(key))) continue;
    return { ok: true, value: object, source: candidate.source };
  }
  return {
    ok: false,
    // Een geldig JSON-object zonder één van de verwachte topsleutels is geen
    // parsefout maar een verkeerd antwoord; de melding blijft gewoon.
    code: sawJson ? 'schema_violation' : 'code_block_missing',
    message: sawJson ? humanMessage('schema_violation') : humanMessage('code_block_missing'),
  };
}

/** Eén bron zoals de bestaande validator hem verwacht: id + optionele tekst. */
function validatorSources(bundle) {
  return bundle.sources.map((source) => ({
    id: source.id,
    url: source.url,
    kind: source.kind,
    status: source.status,
    sha256: source.sha256,
    ...(source.hasText && source.text ? { text: source.text } : {}),
  }));
}

function rowPathLabel(menu, category) {
  const path = Array.isArray(category && category.path) && category.path.length > 0
    ? category.path
    : [category && category.name].filter(Boolean);
  const labels = [menu && menu.title, ...path].filter((label) => typeof label === 'string' && label.trim());
  return labels.join(' › ');
}

function priceTextOf(item) {
  if (typeof item.priceText === 'string' && item.priceText.trim()) return item.priceText.trim();
  if (item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits)) {
    return `€ ${(item.amountMinorUnits / 100).toFixed(2).replace('.', ',')}`;
  }
  if (item.priceStatus === 'multiple_undecomposed') return 'meerdere prijzen';
  if (item.priceStatus === 'on_request') return 'op aanvraag';
  return 'prijs onbekend';
}

function isArrangementLike(menu, category, item) {
  const labels = [menu && menu.title, menu && menu.variant, category && category.name, ...(Array.isArray(category && category.path) ? category.path : [])];
  return labels.some((label) => typeof label === 'string' && ARRANGEMENT_SIGNAL.test(label));
}


/** Schemafouten die aan één regel hangen en dus per regel reviewbaar zijn. */
function rowCodeForProblem(problem) {
  if (/\.items\[\d+\]\.evidence\.quote is not present in the cited source$/.test(problem)) return 'quote_not_in_source';
  if (/\.items\[\d+\]\.evidence\.sourceId must reference the source inventory$/.test(problem)) return 'unknown_source';
  if (/\.items\[\d+\]\.evidence\.locator must be a short non-empty string$/.test(problem)) return 'locator_invalid';
  return null;
}

function rowProblemKey(problem) {
  const match = /^menus\[(\d+)\]\.categories\[(\d+)\]\.items\[(\d+)\]/.exec(problem);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/**
 * Per regel één toestand. Nooit afvlakken: een variant wordt geen enkele
 * prijs, een supplement wordt geen hoofdprijs en een arrangement wordt geen
 * gewoon gerecht. De mens kiest of laat weg; de app beslist niet.
 */
function classifyRow({ item, menu, category, source, rowProblemCodes }) {
  const reasons = [];
  const relations = [];
  if (item.supplementOf) relations.push('supplement_as_main_price');
  if (Array.isArray(item.priceVariants) && item.priceVariants.length > 0) relations.push('price_variant');
  if (item.isFrom === true) relations.push('from_price');
  if (item.allergens) relations.push('allergens');
  if (item.availability) relations.push('availability');
  if (isArrangementLike(menu, category, item)) relations.push('arrangement_like');

  const priceOutOfRange =
    item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits) && normalizePrice(item.amountMinorUnits / 100) === null;

  let code = null;
  if (relations.includes('supplement_as_main_price')) code = 'supplement_as_main_price';
  else if (relations.includes('price_variant')) code = 'price_variant';
  else if (relations.length > 0) code = relations[0];
  else if (priceOutOfRange) code = 'price_out_of_concept_range';
  else if (rowProblemCodes.length > 0) code = rowProblemCodes[0];
  else if (category && category.uncertain === true) code = 'category_uncertain';
  else if (source && !source.hasText) code = 'scan_unverified';

  if (code) {
    reasons.push(ROW_CODES[code].label);
  }
  const state = code ? ROW_CODES[code].state : 'valid';
  return {
    reasons,
    relations,
    code,
    state,
    label: code ? ROW_CODES[code].label : STATE_LABELS.valid,
    askAi: code ? Boolean(ROW_CODES[code].askAi) : false,
  };
}

function buildRows(output, bundle, problemCodesByRow) {
  const sourceById = new Map(bundle.sources.map((source) => [source.id, source]));
  const rows = [];
  const menus = Array.isArray(output.menus) ? output.menus : [];
  menus.forEach((menu, m) => {
    const categories = Array.isArray(menu && menu.categories) ? menu.categories : [];
    categories.forEach((category, c) => {
      const items = Array.isArray(category && category.items) ? category.items : [];
      items.forEach((item, i) => {
        if (!item || typeof item !== 'object') return;
        const id = `${m}.${c}.${i}`;
        const evidence = item.evidence && typeof item.evidence === 'object' ? item.evidence : {};
        const source = sourceById.get(evidence.sourceId) || null;
        const classified = classifyRow({
          item,
          menu,
          category,
          source,
          rowProblemCodes: problemCodesByRow.get(id) || [],
        });
        rows.push({
          id,
          menuIndex: m,
          categoryIndex: c,
          itemIndex: i,
          menuTitle: typeof menu.title === 'string' ? menu.title : null,
          pathLabel: rowPathLabel(menu, category),
          name: typeof item.name === 'string' ? item.name : '',
          description: typeof item.description === 'string' ? item.description : null,
          priceText: priceTextOf(item),
          priceStatus: item.priceStatus,
          amountMinorUnits: Number.isInteger(item.amountMinorUnits) ? item.amountMinorUnits : null,
          priceVariants: Array.isArray(item.priceVariants)
            ? item.priceVariants.map((variant) => ({
                label: variant && typeof variant.label === 'string' ? variant.label : null,
                amountMinorUnits: variant && Number.isInteger(variant.amountMinorUnits) ? variant.amountMinorUnits : null,
              }))
            : null,
          supplementOf: typeof item.supplementOf === 'string' ? item.supplementOf : null,
          sourceId: typeof evidence.sourceId === 'string' ? evidence.sourceId : null,
          sourceUrl: source ? source.url : null,
          locator: typeof evidence.locator === 'string' ? evidence.locator : null,
          quote: typeof evidence.quote === 'string' ? evidence.quote : null,
          hasText: Boolean(source && source.hasText),
          state: classified.state,
          code: classified.code,
          label: classified.label,
          reasons: classified.reasons,
          relations: classified.relations,
          askAi: classified.askAi,
          // Bewijs uit een bron zonder tekst is nooit automatisch bevestigd.
          evidenceVerified: Boolean(source && source.hasText && !(problemCodesByRow.get(id) || []).includes('quote_not_in_source')),
        });
      });
    });
  });
  return rows;
}

function emptyReport({ importId, bundle, aiName, code, problems, normalizations }) {
  return {
    ok: false,
    importId,
    bundleId: bundle ? bundle.bundleId : null,
    bundleHash: bundle ? bundle.bundleHash : null,
    aiName: aiName || null,
    code,
    message: humanMessage(code),
    problems: boundedProblems(problems),
    // U1/U2 (review 6376543234): de leesbare punten en de kopieerbare
    // herstelvraag staan naast de technische regels. Zonder problemen blijven
    // ze leeg; ze versoepelen niets en worden nooit een goedkeuring.
    problemSummary: [],
    problemSummaryOmitted: 0,
    recoveryQuestion: null,
    // V2: een toegepaste afleiding blijft ook bij een afgekeurd antwoord in het
    // spoor staan; er is dan geen reviewscherm en dus geen melding.
    normalizations: Array.isArray(normalizations) ? normalizations : [],
    rows: [],
    summary: { menus: 0, items: 0, valid: 0, needsReview: 0, blocked: 0, unsupported: 0, unverifiable: 0 },
    coverage: null,
  };
}

/**
 * Bouwt het gevalideerde importresultaat. `output` is al uit de codeblok-
 * extractie gekomen; hier wordt hij opnieuw als onbetrouwbare data behandeld.
 *
 * `carriedNormalizations` zijn de correcties die al bij een eerdere stap van
 * dezelfde import zijn toegepast (bijvoorbeeld vóór een vervolgvraag). Ze
 * worden niet opnieuw afgeleid maar blijven zichtbaar.
 */
function buildImportReport({ importId, bundle, output, aiName, now = new Date(), carriedNormalizations } = {}) {
  const nameCheck = validateAiName(aiName);
  if (!nameCheck.ok) return emptyReport({ importId, bundle, aiName, code: nameCheck.code });
  if (!bundle) return emptyReport({ importId, bundle, aiName: nameCheck.aiName, code: 'unknown_bundle' });

  // V1: dezelfde afleiding als route B, vóór de ongewijzigde validator. Het
  // antwoord wordt niet gemuteerd; de validator ziet de afgeleide waarden.
  const normalized = applyDerivableNormalizations(output);
  const answer = normalized.output;
  const normalizations = mergeNormalizations(carriedNormalizations, normalized.normalizations);

  const problems = schema.validateStructuredOutput(answer, validatorSources(bundle));
  const problemCodesByRow = new Map();
  const fatal = [];
  for (const problem of problems) {
    const id = rowProblemKey(problem);
    const code = rowCodeForProblem(problem);
    if (id && code) {
      if (!problemCodesByRow.has(id)) problemCodesByRow.set(id, []);
      problemCodesByRow.get(id).push(code);
    } else {
      fatal.push(problem);
    }
  }
  if (fatal.length > 0) {
    const report = emptyReport({
      importId,
      bundle,
      aiName: nameCheck.aiName,
      code: 'schema_violation',
      problems: fatal,
      normalizations,
    });
    // U1/U2: dezelfde regels, maar in gewone taal en met één herstelvraag.
    // `problems` blijft ongewijzigd het technische detail van de blokkade; de
    // leesbare samenvatting noemt ook de regelgebonden fouten, want ook die
    // moet de AI herstellen voordat dit antwoord opnieuw kan worden aangeboden.
    const explained = describeImportProblems(problems, answer);
    report.problemSummary = explained.groups;
    report.problemSummaryOmitted = explained.omitted;
    report.recoveryQuestion = explained.recoveryQuestion;
    return report;
  }

  const rows = buildRows(answer, bundle, problemCodesByRow);
  if (rows.length === 0) {
    return emptyReport({
      importId,
      bundle,
      aiName: nameCheck.aiName,
      code: 'no_items',
      problems: answer && answer.coverage && answer.coverage.status === 'no_items' ? ['coverage.no_items'] : [],
      normalizations,
    });
  }

  const counts = rows.reduce(
    (acc, row) => {
      acc[row.state] += 1;
      return acc;
    },
    { valid: 0, error: 0, unverifiable: 0, unsupported: 0 },
  );
  const menus = (Array.isArray(answer.menus) ? answer.menus : []).map((menu, index) => ({
    index,
    title: typeof menu.title === 'string' ? menu.title : null,
    variant: typeof menu.variant === 'string' ? menu.variant : null,
    sourceId: typeof menu.sourceId === 'string' ? menu.sourceId : null,
    categoryCount: Array.isArray(menu.categories) ? menu.categories.length : 0,
    itemCount: (Array.isArray(menu.categories) ? menu.categories : []).reduce(
      (sum, category) => sum + (Array.isArray(category && category.items) ? category.items.length : 0),
      0,
    ),
  }));

  return {
    ok: true,
    importId,
    bundleId: bundle.bundleId,
    bundleHash: bundle.bundleHash,
    aiName: nameCheck.aiName,
    importedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    code: null,
    message: null,
    problems: [],
    // U1/U2: de vorm is ook bij een geslaagde controle hetzelfde; er is dan
    // niets te herstellen.
    problemSummary: [],
    problemSummaryOmitted: 0,
    recoveryQuestion: null,
    // V2: wat het systeem zelf heeft bijgesteld, technisch én in gewone taal.
    // Nooit een goedkeuring en nooit een modelclaim.
    normalizations,
    rows,
    menus,
    summary: {
      menus: menus.length,
      items: rows.length,
      valid: counts.valid,
      needsReview: rows.length - counts.valid,
      blocked: counts.error,
      unsupported: counts.unsupported,
      unverifiable: counts.unverifiable,
    },
    coverage: answer.coverage || null,
    rejected: Array.isArray(answer.rejected) ? answer.rejected : [],
    technical: {
      protocolVersion: bundle.protocol.version,
      protocolHash: bundle.protocol.hash,
      instructionSchemaVersion: bundle.protocol.schemaVersion,
      schemaVersion: bundle.schemaVersion,
      schemaHash: bundle.schemaHash,
      bundleHash: computeBundleHash(bundle.binding),
      sources: bundle.sources.map((source) => ({ id: source.id, url: source.url, sha256: source.sha256, hasText: source.hasText })),
      fetchedAt: bundle.fetchedAt,
    },
    // De gevalideerde uitvoer blijft server-side; de opslagstap hergebruikt
    // exact dit object en bouwt niets opnieuw uit clientinvoer. Het is de
    // genormaliseerde uitvoer: dezelfde waarden die de validator heeft gezien.
    validated: { menus: answer.menus, coverage: answer.coverage, rejected: Array.isArray(answer.rejected) ? answer.rejected : [] },
    output: answer,
  };
}


/**
 * De import is alleen geldig binnen de bundel die de app zelf exporteerde.
 * Een verlopen bundel, een andere bundel of een gewijzigde binding is een
 * blokkade, nooit een waarschuwing die toch doorlaat.
 */
function checkBundleBinding({ bundle, bundleHash, actorUserId, restaurantId }) {
  if (!bundle) return { ok: false, code: 'bundle_expired', message: humanMessage('bundle_expired') };
  if (typeof actorUserId !== 'string' || bundle.actorUserId !== actorUserId) {
    return { ok: false, code: 'unknown_bundle', message: humanMessage('unknown_bundle') };
  }
  if (typeof restaurantId === 'string' && restaurantId !== bundle.restaurantId) {
    return { ok: false, code: 'unknown_bundle', message: humanMessage('unknown_bundle') };
  }
  const recomputed = computeBundleHash(bundle.binding);
  if (recomputed !== bundle.bundleHash) {
    return { ok: false, code: 'bundle_hash_mismatch', message: humanMessage('bundle_hash_mismatch') };
  }
  if (typeof bundleHash === 'string' && bundleHash !== bundle.bundleHash) {
    return { ok: false, code: 'bundle_hash_mismatch', message: humanMessage('bundle_hash_mismatch') };
  }
  return { ok: true };
}

/**
 * Wat het scherm mag zien: nooit de gevalideerde uitvoer of de brontekst.
 * "Nooit JSON tonen" is hier een eigenschap van de vorm, niet van de CSS.
 */
function publicImportReport(report) {
  if (!report) return null;
  const { validated, output, ...rest } = report;
  return rest;
}

/** Eén samenvattingsregel in gewone taal: "9 gerechten · 5 in orde · 4 nalopen". */
function summaryLine(report) {
  if (!report || !report.summary) return '';
  const { items, valid, needsReview } = report.summary;
  return `${items} ${items === 1 ? 'gerecht' : 'gerechten'} · ${valid} in orde · ${needsReview} ${needsReview === 1 ? 'nalopen' : 'nalopen'}`;
}

module.exports = {
  MAX_ANSWER_BYTES,
  MAX_AI_NAME,
  MAX_QUESTION,
  ROW_STATES,
  STATE_LABELS,
  ROW_CODES,
  humanMessage,
  validateAiName,
  extractCodeBlock,
  buildImportReport,
  mergeNormalizations,
  checkBundleBinding,
  publicImportReport,
  summaryLine,
};

