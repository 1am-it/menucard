'use strict';

// #59 fase 2 â€” de menselijke controle vÃ³Ã³r opslaan (K4, K5, K6).
//
// De regels komen uit de bestaande conceptwereld: niets wordt afgevlakt, er is
// geen accepteer-alles, en opslaan kan pas als elk open punt door een mens is
// afgehandeld. Aanvullend op de bestaande `menuConcept`-blokkades:
//   - een variant ("twee prijzen") vraagt een expliciete prijskeuze of weglaten;
//   - een supplement wordt nooit de hoofdprijs: bevestigen betekent zichtbaar
//     "als toeslag weggelaten", niet stilzwijgend een gerecht;
//   - een regel uit een scan zonder tekst is per regel bevestigd of gecorrigeerd;
//   - een regel die niet in de bron staat vraagt een korte verplichte reden, die
//     met de herkomst wordt bewaard (eigenaarsbesluit 2026-10-22d).
//
// Puur en zonder fetch/database. De beslissingen en de Vraag AI-teller reizen
// sinds herstelronde 6350337273 mee in het ondertekende toestandstoken
// (src/lib/manualMenuImportState.js); er is geen opslag op moduleniveau meer.
// De handler schrijft pas via de bestaande conceptroute.

const { normalizePrice, buildMenuConcept } = require('./menuConcept');
const { mapStructuredOutputToMenuContexts } = require('./menuExtractionMapping');
const { extractCodeBlock, buildImportReport } = require('./manualMenuImportImport');
const schema = require('./menuExtractionSchema');
const { describeNormalizations } = require('./menuExtractionNormalization');
const { PROVENANCE_KIND } = require('./manualMenuImportBundle');
const { compareCaptureWithConcept, itemFromPricedLine } = require('./menuSourceCoverage');

const MAX_NOTE = 300;
const MAX_REASONS = 200;
const MAX_FOLLOW_UPS_PER_IMPORT = 20;
const MAX_FOLLOW_UPS_PER_ROW = 1;

const ACTIONS = ['confirm', 'correct', 'drop', 'choose_price', 'price_unknown'];

// W6 (Lead review 6380804419): a row whose price the source does not state.
// The human either supplies a price, marks it unknown, or drops the row.
const PRICE_UNKNOWN_CODES = new Set(['price_unknown', 'price_on_request']);

// Vaste redenen bij "staat niet in de bron"; een korte toelichting is
// verplicht en wordt met de herkomst bewaard.
const MISSING_REASONS = {
  niet_in_bron: 'Niet in de bron gevonden',
  scan_onleesbaar: 'Scan of afbeelding onleesbaar',
  bron_gewijzigd: 'Bron is intussen gewijzigd',
  verkeerde_kaart: 'Hoort bij een andere kaart of vestiging',
  anders: 'Anders, zie toelichting',
};

class ManualImportReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ManualImportReviewError';
    this.code = code;
  }
}

function boundedNote(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, MAX_NOTE);
}

function normalizePath(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > schema.LIMITS.pathDepth) return null;
  const labels = value
    .map((label) => (typeof label === 'string' ? label.replace(/\s+/g, ' ').trim() : ''))
    .filter(Boolean);
  if (labels.length !== value.length) return null;
  if (labels.some((label) => label.length > schema.LIMITS.category)) return null;
  return labels;
}

/** EÃ©n beslissing: altijd voor precies Ã©Ã©n regel, nooit een bulkclaim. */
function validateDecision({ row, decision } = {}) {
  if (!row) return { ok: false, code: 'unknown_row', message: 'Deze regel hoort niet bij deze import.' };
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return { ok: false, code: 'decision_invalid', message: 'Kies Ã©Ã©n handeling voor deze regel.' };
  }
  if (decision.acceptAll === true || decision.rows !== undefined) {
    return { ok: false, code: 'accept_all_forbidden', message: 'Er is geen "alles accepteren". Beoordeel elke regel apart.' };
  }
  const action = decision.action;
  if (!ACTIONS.includes(action)) return { ok: false, code: 'decision_invalid', message: 'Kies Ã©Ã©n handeling voor deze regel.' };
  if (row.state === 'valid') {
    return { ok: false, code: 'row_not_open', message: 'Deze regel is al in orde.' };
  }
  if (action === 'choose_price' && row.code !== 'price_variant') {
    return { ok: false, code: 'decision_invalid', message: 'Kies alleen een prijs bij een regel met twee prijzen.' };
  }
  if (row.code === 'price_variant' && action !== 'choose_price' && action !== 'drop') {
    return { ok: false, code: 'price_choice_required', message: 'Kies een prijs of laat de regel weg.' };
  }
  // W6: "Prijs onbekend" only exists for a row without a price. The dish stays
  // with an unknown price — never € 0,00 and never a guessed amount.
  if (action === 'price_unknown' && !PRICE_UNKNOWN_CODES.has(row.code)) {
    return { ok: false, code: 'decision_invalid', message: 'Kies "Prijs onbekend" alleen bij een regel zonder prijs.' };
  }
  if (PRICE_UNKNOWN_CODES.has(row.code) && action !== 'price_unknown' && action !== 'drop' && action !== 'correct') {
    return {
      ok: false,
      code: 'price_choice_required',
      message: 'Vul een prijs in, kies "Prijs onbekend" of laat de regel weg.',
    };
  }
  if (action === 'choose_price') {
    const variants = Array.isArray(row.priceVariants) ? row.priceVariants : [];
    const index = decision.variantIndex;
    if (!Number.isInteger(index) || index < 0 || index >= variants.length) {
      return { ok: false, code: 'price_choice_required', message: 'Kies een prijs of laat de regel weg.' };
    }
    const amount = variants[index].amountMinorUnits;
    if (!Number.isInteger(amount) || normalizePrice(amount / 100) === null) {
      return { ok: false, code: 'price_choice_required', message: 'Deze prijs kan het concept niet opslaan. Kies een andere prijs of laat de regel weg.' };
    }
    return { ok: true, action, variantIndex: index, amountMinorUnits: amount };
  }
  if (action === 'correct') {
    const corrected = decision.corrected && typeof decision.corrected === 'object' ? decision.corrected : null;
    if (!corrected) return { ok: false, code: 'correction_incomplete', message: 'Vul de correctie in.' };
    const name = typeof corrected.name === 'string' ? corrected.name.replace(/\s+/g, ' ').trim().slice(0, schema.LIMITS.name) : '';
    if (name === '') return { ok: false, code: 'correction_incomplete', message: 'Een gerecht heeft een naam nodig.' };
    let price = null;
    if (corrected.price !== undefined && corrected.price !== null && String(corrected.price).trim() !== '') {
      price = normalizePrice(String(corrected.price));
      if (price === null) {
        return {
          ok: false,
          code: 'correction_incomplete',
          message: 'Vul een prijs in die het concept kan opslaan (groter dan â‚¬ 0,00 en maximaal â‚¬ 500,00).',
        };
      }
    }
    const description = typeof corrected.description === 'string' ? corrected.description.trim().slice(0, schema.LIMITS.description) : null;
    // W6: correcting a row without a price means supplying that price; leaving
    // it empty would silently keep an unpriced dish.
    if (PRICE_UNKNOWN_CODES.has(row.code) && !price) {
      return { ok: false, code: 'correction_incomplete', message: 'Vul een prijs in, of kies "Prijs onbekend".' };
    }
    const path = corrected.path === undefined ? undefined : normalizePath(corrected.path);
    if (corrected.path !== undefined && path === null) {
      return { ok: false, code: 'correction_incomplete', message: 'Kies een geldige rubriek.' };
    }
    return { ok: true, action, correction: { name, description, price, path } };
  }
  if (action === 'drop') return { ok: true, action };
  // confirm: bij "staat niet in de bron" is een korte reden verplicht (d).
  if (row.state === 'error') {
    const reasonCode = typeof decision.reasonCode === 'string' ? decision.reasonCode : '';
    if (!Object.prototype.hasOwnProperty.call(MISSING_REASONS, reasonCode)) {
      return { ok: false, code: 'reason_required', message: 'Kies een reden waarom deze regel toch klopt.' };
    }
    const note = boundedNote(decision.note);
    if (!note) return { ok: false, code: 'reason_required', message: 'Schrijf kort op waarom deze regel toch klopt.' };
    return { ok: true, action, reasonCode, note };
  }
  return { ok: true, action };
}


/** Past Ã©Ã©n gevalideerde beslissing toe op de beslissingenlijst. */
function decideRow({ report, decisions, decision } = {}) {
  if (!report || !Array.isArray(report.rows)) {
    return { ok: false, code: 'unknown_import', message: 'Deze import hoort niet bij deze sessie.' };
  }
  // Een bulk- of accepteer-alles-payload is nooit een geldige beslissing, ook
  // niet als er geen rowId bij zit.
  if (decision && typeof decision === 'object' && (decision.acceptAll === true || decision.rows !== undefined)) {
    return { ok: false, code: 'accept_all_forbidden', message: 'Er is geen "alles accepteren". Beoordeel elke regel apart.' };
  }
  const rowId = decision && typeof decision.rowId === 'string' ? decision.rowId : null;
  const row = rowId ? report.rows.find((entry) => entry.id === rowId) : null;
  if (!row) return { ok: false, code: 'unknown_row', message: 'Deze regel hoort niet bij deze import.' };
  const check = validateDecision({ row, decision });
  if (!check.ok) return check;

  const next = new Map(decisions || []);
  next.set(row.id, {
    rowId: row.id,
    action: check.action,
    reasonCode: check.reasonCode || null,
    note: check.note || null,
    variantIndex: Number.isInteger(check.variantIndex) ? check.variantIndex : null,
    correction: check.correction || null,
    at: new Date().toISOString(),
  });
  return { ok: true, decisions: next, row: rowForView(row, next.get(row.id)) };
}

// Variant 1 (Lead order 6382189724): the two choices per uncovered line.
const UNCOVERED_ACTIONS = ['add_uncovered', 'uncovered_not_dish'];

function uncoveredLineKey(line) {
  return `uncovered:${line.id}`;
}

function uncoveredDecisionEntry(line, action, extra) {
  return {
    rowId: uncoveredLineKey(line),
    action,
    line: {
      sourceId: line.sourceId,
      lineNumber: line.lineNumber,
      text: line.text,
      section: line.section || null,
    },
    ...(extra || {}),
    at: new Date().toISOString(),
  };
}

/**
 * X3: one human choice on one uncovered line. The server recomputes the
 * comparison from the capture it read itself, so a client can never inject a
 * line, a name or a price. Adding goes through the same validator as every
 * other dish: the new row appears in the review with its section marked
 * uncertain, so the human confirms or corrects name and section there.
 */
function decideUncoveredLine({ report, decisions, bundle, decision } = {}) {
  if (!report || !Array.isArray(report.rows)) {
    return { ok: false, code: 'unknown_import', message: 'Deze import hoort niet bij deze sessie.' };
  }
  const action = decision && typeof decision.action === 'string' ? decision.action : '';
  if (!UNCOVERED_ACTIONS.includes(action)) {
    return { ok: false, code: 'decision_invalid', message: 'Kies Toevoegen of Geen gerecht.' };
  }
  // No "accept all": exactly one line per decision, also here.
  if (decision.acceptAll === true || decision.rows !== undefined) {
    return { ok: false, code: 'accept_all_forbidden', message: 'Er is geen "alles accepteren". Beoordeel elke regel apart.' };
  }
  const lineId = decision && typeof decision.lineId === 'string' ? decision.lineId.trim() : '';
  if (lineId === '' || lineId.length > 160) {
    return { ok: false, code: 'unknown_line', message: 'Deze regel staat niet meer open. Laad de review opnieuw.' };
  }
  const map = decisions instanceof Map ? decisions : new Map();
  const view = uncoveredView({ report, decisions: map, capture: bundle ? bundle.sources : null });
  if (!view.available) {
    return { ok: false, code: 'capture_unavailable', message: view.message };
  }
  const line = view.lines.find((entry) => entry.id === lineId);
  if (!line) {
    return { ok: false, code: 'unknown_line', message: 'Deze regel staat niet meer open. Laad de review opnieuw.' };
  }
  const next = new Map(map);
  if (action === 'uncovered_not_dish') {
    next.set(uncoveredLineKey(line), uncoveredDecisionEntry(line, action));
    return { ok: true, decisions: next, report: null, row: null, line };
  }
  const added = addLineAsItem({ report, bundle, line });
  if (!added.ok) return added;
  next.set(uncoveredLineKey(line), uncoveredDecisionEntry(line, action, { addedRowId: added.rowId }));
  return { ok: true, decisions: next, report: added.report, row: added.row, line };
}

/**
 * The "Toevoegen" item, through the existing validator. The new category is
 * always marked uncertain: the section label is the nearest printed heading,
 * a guess the human must confirm or correct with the existing "Wijzig" step.
 */
function addLineAsItem({ report, bundle, line } = {}) {
  const built = itemFromPricedLine(line);
  if (!built.ok) return built;
  const menus = cloneMenus(report.validated.menus);
  if (menus.length === 0) {
    return { ok: false, code: 'no_menu', message: 'Dit concept heeft nog geen menukaart om deze regel aan toe te voegen.' };
  }
  const found = menus.findIndex((menu) => menu && menu.sourceId === line.sourceId);
  const menuIndex = found >= 0 ? found : 0;
  const target = menus[menuIndex];
  const section = typeof line.section === 'string' && line.section.trim() ? line.section.trim().slice(0, schema.LIMITS.category) : null;
  const categories = Array.isArray(target.categories) ? target.categories : [];
  target.categories = [...categories, { name: section || 'Overig', uncertain: true, items: [built.item] }];
  const next = buildImportReport({
    importId: report.importId,
    bundle,
    output: {
      menus,
      coverage: report.validated.coverage,
      ...(Array.isArray(report.validated.rejected) && report.validated.rejected.length > 0 ? { rejected: report.validated.rejected } : {}),
    },
    aiName: report.aiName,
    now: new Date(report.importedAt),
    // V2: an earlier derivation stays visible after this step too.
    carriedNormalizations: report.normalizations,
  });
  if (!next.ok) return { ok: false, code: next.code, message: next.message };
  const rowId = `${menuIndex}.${target.categories.length - 1}.0`;
  const row = next.rows.find((entry) => entry.id === rowId) || null;
  return { ok: true, report: next, row, rowId };
}


/**
 * Het schermbeeld: per regel de toestand plus de menselijke beslissing. Een
 * bevestigd supplement is zichtbaar "als toeslag weggelaten" â€” nooit stil
 * verdwenen en nooit als gerecht opgeslagen.
 */
function rowForView(row, decision) {
  const outcome = decisionOutcome(row, decision);
  return { ...row, decision: decision || null, outcome, resolved: Boolean(outcome) };
}

function decisionOutcome(row, decision) {
  if (!decision) return row.state === 'valid' ? 'keep' : null;
  if (decision.action === 'drop') return 'exclude';
  if (decision.action === 'price_unknown') return 'keep_price_unknown';
  if (decision.action === 'choose_price') return 'keep_with_price';
  if (decision.action === 'correct') return 'keep_corrected';
  // "Klopt" op een toeslag: de AI had gelijk dat dit een toeslag is. Het
  // concept kan dat niet opslaan, dus de regel gaat er zichtbaar uit.
  if (row.code === 'supplement_as_main_price') return 'exclude_supplement';
  return 'keep_confirmed';
}

function reviewView({ report, decisions, capture } = {}) {
  if (!report || !Array.isArray(report.rows)) return null;
  const map = decisions instanceof Map ? decisions : new Map();
  const rows = report.rows.map((row) => rowForView(row, map.get(row.id)));
  const pending = rows.filter((row) => !row.resolved);
  const kept = rows.filter((row) => row.outcome !== 'exclude' && row.outcome !== 'exclude_supplement');
  const excluded = rows.length - kept.length;
  const handled = rows.filter((row) => row.resolved && row.outcome !== 'exclude' && row.outcome !== 'exclude_supplement');
  const reasons = [...map.values()]
    .filter((decision) => decision.reasonCode)
    .map((decision) => ({
      rowId: decision.rowId,
      reasonCode: decision.reasonCode,
      reasonLabel: MISSING_REASONS[decision.reasonCode] || decision.reasonCode,
      note: decision.note,
    }))
    .slice(0, MAX_REASONS);
  return {
    rows,
    summary: {
      ...report.summary,
      // "in orde" telt wat daadwerkelijk is afgehandeld Ã©n automatisch klopte;
      // "nalopen" is het aantal nog open punten.
      valid: handled.length,
      pending: pending.length,
      excluded,
      kept: kept.length,
    },
    pending: pending.map((row) => row.id),
    reasons,
    // V2 (review 6377050602): wat het systeem zelf heeft bijgesteld, in gewone
    // taal. Alleen de afgeleide telling en status; geen modelclaim en geen
    // goedkeuring. Dezelfde lijst reist mee in het toestandstoken. De bewoording
    // komt uit src/lib/menuExtractionNormalization.js, zodat route B en de
    // handmatige import niet uit elkaar kunnen lopen.
    notices: describeNormalizations(report.normalizations),
    canSave: pending.length === 0 && kept.length > 0,
    saveBlockReason:
      kept.length === 0
        ? 'Er blijven geen gerechten over om op te slaan.'
        : pending.length > 0
          ? `Kan pas als alle ${report.summary.needsReview} punten zijn nagelopen. Nog ${pending.length} open.`
          : null,
    // Variant 1 (Lead order 6382189724): the free, deterministic comparison
    // between the captured source and this concept. Always computed here on the
    // server from the capture that came out of the sealed token; the screen
    // never compares anything itself and never receives the source text.
    uncovered: uncoveredView({ report, decisions: map, capture }),
  };
}

/** The "Geen gerecht" lines a human already accounted, for the comparison. */
function accountedLines(decisions) {
  const map = decisions instanceof Map ? decisions : new Map();
  return [...map.values()]
    .filter((decision) => decision && decision.line && decision.action === 'uncovered_not_dish')
    .map((decision) => ({
      sourceId: decision.line.sourceId,
      lineNumber: Number.isInteger(decision.line.lineNumber) ? decision.line.lineNumber : null,
      text: decision.line.text,
    }));
}

/**
 * The block of variant 1. `capture` is the source text per source as the
 * server read it; without it the screen says the comparison is unavailable
 * for this concept instead of pretending there is nothing to compare.
 */
function uncoveredView({ report, decisions, capture } = {}) {
  const validated = report && report.validated ? report.validated : {};
  return compareCaptureWithConcept({
    sources: Array.isArray(capture) ? capture : null,
    menus: Array.isArray(validated.menus) ? validated.menus : [],
    rejected: Array.isArray(validated.rejected) ? validated.rejected : [],
    accounted: accountedLines(decisions),
  });
}

/** De herkomst die met het concept wordt bewaard (K5). */
function buildImportProvenance({ report, decisions } = {}) {
  const map = decisions instanceof Map ? decisions : new Map();
  const reasons = [...map.values()]
    .filter((decision) => decision.reasonCode)
    .slice(0, MAX_REASONS)
    .map((decision) => ({
      rowId: decision.rowId,
      reasonCode: decision.reasonCode,
      note: decision.note,
    }));
  const rows = (report && Array.isArray(report.rows) ? report.rows : [])
    .filter((row) => map.has(row.id))
    .slice(0, MAX_REASONS)
    .map((row) => {
      const decision = map.get(row.id);
      return {
        rowId: row.id,
        name: row.name,
        action: decision.action,
        code: row.code,
        reasonCode: decision.reasonCode || null,
        note: decision.note || null,
      };
    });
  return {
    kind: PROVENANCE_KIND,
    label: 'handmatige AI-import',
    aiName: report ? report.aiName : null,
    aiNameSelfReported: true,
    importedAt: report ? report.importedAt : null,
    protocolVersion: report && report.technical ? report.technical.protocolVersion : null,
    protocolHash: report && report.technical ? report.technical.protocolHash : null,
    schemaVersion: report && report.technical ? report.technical.schemaVersion : null,
    schemaHash: report && report.technical ? report.technical.schemaHash : null,
    bundleHash: report ? report.bundleHash : null,
    sources: (report && report.technical && Array.isArray(report.technical.sources) ? report.technical.sources : []).map((source) => ({
      id: source.id,
      url: source.url,
      sha256: source.sha256,
    })),
    reasons,
    rows,
    // V2: een toegepaste afleiding blijft bij het concept staan (duurzame
    // conceptmetadata). Het is de herkomst van de telling en de bijgestelde
    // status, geen goedkeuring en geen vervanging van het bronbewijs.
    normalizations: (report && Array.isArray(report.normalizations) ? report.normalizations : []).slice(0, 5),
    // Variant 1: wat een mens met een niet-overgenomen bronregel deed, blijft
    // in de conceptmetadata staan. Daardoor komt de regel na herladen niet
    // terug en is de keuze achteraf te controleren.
    uncovered: [...map.values()]
      .filter((decision) => decision && decision.line && typeof decision.line.text === 'string')
      .slice(0, MAX_REASONS)
      .map((decision) => ({
        sourceId: decision.line.sourceId || null,
        lineNumber: Number.isInteger(decision.line.lineNumber) ? decision.line.lineNumber : null,
        text: decision.line.text,
        section: decision.line.section || null,
        action: decision.action,
        addedRowId: decision.addedRowId || null,
      })),
  };
}


function cloneMenus(menus) {
  return JSON.parse(JSON.stringify(Array.isArray(menus) ? menus : []));
}

function pathKeyOf(labels) {
  return (Array.isArray(labels) ? labels : []).join('\u0000');
}

/**
 * De uitvoer zoals de mens hem na de controle bedoelt: weggehaalde regels weg,
 * gekozen prijzen en correcties toegepast. Alleen expliciete menselijke
 * beslissingen veranderen iets; een variant wordt nooit vanzelf Ã©Ã©n prijs.
 */
function repairMenus({ report, decisions } = {}) {
  const map = decisions instanceof Map ? decisions : new Map();
  const menus = cloneMenus(report.validated.menus);
  const excluded = [];
  const rowById = new Map((report.rows || []).map((row) => [row.id, row]));
  menus.forEach((menu, m) => {
    const categories = Array.isArray(menu.categories) ? menu.categories : [];
    const rebuilt = [];
    const byPath = new Map();
    categories.forEach((category, c) => {
      const basePath = Array.isArray(category.path) && category.path.length > 0 ? category.path : [category.name];
      const items = Array.isArray(category.items) ? category.items : [];
      // Een rubriek die de AI onzeker noemt, blijft onzeker zolang niet elke
      // regel eruit door een mens is afgehandeld. Zo verdwijnt de onzekerheid
      // nooit stilzwijgend en blijft de bestaande conceptblokkade werken.
      const allDecided = items.every((_item, i) => {
        const row = rowById.get(`${m}.${c}.${i}`);
        return !row || map.has(row.id);
      });
      const sourceCategory = category.uncertain === true && !allDecided ? category : { ...category, uncertain: false };
      items.forEach((item, i) => {
        const row = rowById.get(`${m}.${c}.${i}`);
        const decision = row ? map.get(row.id) : null;
        if (!row || !decision) {
          pushItem(rebuilt, byPath, basePath, item, sourceCategory);
          return;
        }
        if (decision.action === 'drop' || (decision.action === 'confirm' && row.code === 'supplement_as_main_price')) {
          excluded.push({
            rowId: row.id,
            name: row.name,
            reason: decision.action === 'drop' ? 'weggelaten' : 'als toeslag weggelaten',
          });
          return;
        }
        if (decision.action === 'choose_price') {
          const variant = Array.isArray(item.priceVariants) ? item.priceVariants[decision.variantIndex] : null;
          const next = { ...item, priceStatus: 'known', amountMinorUnits: variant ? variant.amountMinorUnits : item.amountMinorUnits, currency: 'EUR' };
          delete next.priceVariants;
          delete next.supplementOf;
          pushItem(rebuilt, byPath, basePath, next, sourceCategory);
          return;
        }
        // W6: "Prijs onbekend". The dish stays with an unknown price (or, when
        // the source said so, "op aanvraag"); no amount is invented.
        if (decision.action === 'price_unknown') {
          const next = {
            ...item,
            priceStatus: item.priceStatus === 'on_request' ? 'on_request' : 'unknown',
            priceUnknownAccepted: true,
          };
          delete next.amountMinorUnits;
          delete next.priceVariants;
          pushItem(rebuilt, byPath, basePath, next, sourceCategory);
          return;
        }
        if (decision.action === 'correct') {
          const correction = decision.correction || {};
          const next = { ...item, name: correction.name };
          if (correction.description !== null && correction.description !== undefined) next.description = correction.description;
          if (correction.price) {
            next.priceStatus = 'known';
            next.amountMinorUnits = Math.round(Number(correction.price) * 100);
            next.currency = 'EUR';
            delete next.priceVariants;
            delete next.supplementOf;
            delete next.isFrom;
          }
          const targetPath = Array.isArray(correction.path) && correction.path.length > 0 ? correction.path : basePath;
          pushItem(rebuilt, byPath, targetPath, next, sourceCategory);
          return;
        }
        pushItem(rebuilt, byPath, basePath, item, sourceCategory);
      });
    });
    menu.categories = rebuilt;
  });
  return { menus, excluded };
}

function pushItem(rebuilt, byPath, pathLabels, item, sourceCategory) {
  const key = pathKeyOf(pathLabels);
  let category = byPath.get(key);
  if (!category) {
    category = { name: pathLabels[pathLabels.length - 1], items: [] };
    if (pathLabels.length > 1) category.path = pathLabels;
    if (sourceCategory && sourceCategory.uncertain === true) category.uncertain = true;
    byPath.set(key, category);
    rebuilt.push(category);
  }
  category.items.push(item);
}

/** `${restaurantId}-${letters}` â€” de bestaande menu_context-vorm, niets nieuws. */
function menuContextFor(restaurantId, menus) {
  const title = (Array.isArray(menus) ? menus : []).map((menu) => menu && menu.title).find((value) => typeof value === 'string' && value.trim());
  const letters = String(title || 'import')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z]+/g, '')
    .slice(0, 20);
  return `${String(restaurantId).trim()}-${letters || 'import'}`;
}

/**
 * Het concept dat de bestaande route opslaat: eerst dezelfde mapping en
 * conceptregels als elke andere import, dan de herkomst erbij. Blokkades van
 * het bestaande concept (dubbel gerecht, prijs ontbreekt) blijven blokkades.
 */
function buildConceptDraft({ report, decisions, restaurantId } = {}) {
  const view = reviewView({ report, decisions });
  if (!view) return { ok: false, code: 'unknown_import', message: 'Deze import hoort niet bij deze sessie.' };
  if (!view.canSave) return { ok: false, code: 'blocked', message: view.saveBlockReason, pending: view.pending };
  const { menus, excluded } = repairMenus({ report, decisions });
  const sources = (report.technical && Array.isArray(report.technical.sources) ? report.technical.sources : []).map((source) => ({
    id: source.id,
    url: source.url,
  }));
  const contexts = mapStructuredOutputToMenuContexts({ menus }, sources);
  const concept = buildMenuConcept({ menus: contexts, liveLines: [], edits: {} });
  if (!concept.canSave) {
    return {
      ok: false,
      code: 'blockers',
      message: 'Dit concept heeft nog blokkades.',
      blockers: concept.blockers,
    };
  }
  const provenance = buildImportProvenance({ report, decisions });
  const content = { ...concept.content, importProvenance: { ...provenance, excluded } };
  return {
    ok: true,
    content,
    concept,
    menuContext: menuContextFor(restaurantId || report.restaurantId || 'import', contexts),
    provenance,
  };
}


function collectItems(output) {
  const items = [];
  const menus = Array.isArray(output && output.menus) ? output.menus : [];
  menus.forEach((menu, m) => {
    const categories = Array.isArray(menu && menu.categories) ? menu.categories : [];
    categories.forEach((category, c) => {
      const list = Array.isArray(category && category.items) ? category.items : [];
      list.forEach((item, i) => {
        items.push({ item, m, c, i });
      });
    });
  });
  return items;
}

/**
 * Vraag AI (K6): het antwoord gaat door dezelfde validatie en mag alleen het
 * voorstel voor die ene regel vervangen. Raakt het antwoord een andere regel
 * of een andere bron, dan wordt er niets vervangen.
 */
function applyFollowUp({ report, bundle, rowId, answer, followUpCount = 0 } = {}) {
  if (!report || !Array.isArray(report.rows)) {
    return { ok: false, code: 'unknown_import', message: 'Deze import hoort niet bij deze sessie.' };
  }
  const row = report.rows.find((entry) => entry.id === rowId);
  if (!row) return { ok: false, code: 'unknown_row', message: 'Deze regel hoort niet bij deze import.' };
  if (followUpCount >= MAX_FOLLOW_UPS_PER_ROW) {
    return { ok: false, code: 'follow_up_used', message: 'Deze regel is al Ã©Ã©n keer gevraagd. Pas zelf aan of laat de regel weg.' };
  }
  if (!row.askAi) {
    return {
      ok: false,
      code: 'follow_up_not_allowed',
      message: row.code === 'price_variant' ? 'Bij twee prijzen is er geen Vraag AI: kies zelf een prijs of laat de regel weg.' : 'Bij deze regel is Vraag AI niet mogelijk.',
    };
  }
  const parsed = extractCodeBlock(answer);
  if (!parsed.ok) return parsed;
  const items = collectItems(parsed.value);
  if (items.length !== 1) {
    return {
      ok: false,
      code: 'follow_up_out_of_scope',
      message: 'Het antwoord gaat over meer dan deze ene regel. Vraag de AI om alleen deze regel.',
    };
  }
  const only = items[0];
  const sourceId = only.item && only.item.evidence && typeof only.item.evidence.sourceId === 'string' ? only.item.evidence.sourceId : null;
  if (sourceId !== row.sourceId) {
    return {
      ok: false,
      code: 'follow_up_out_of_scope',
      message: 'Het antwoord hoort bij een andere bron. Vraag de AI om alleen deze regel uit dezelfde bron.',
    };
  }
  const menus = cloneMenus(report.validated.menus);
  const targetMenu = menus[row.menuIndex];
  const targetCategory = targetMenu && Array.isArray(targetMenu.categories) ? targetMenu.categories[row.categoryIndex] : null;
  if (!targetCategory || !Array.isArray(targetCategory.items) || !targetCategory.items[row.itemIndex]) {
    return { ok: false, code: 'unknown_row', message: 'Deze regel hoort niet bij deze import.' };
  }
  targetCategory.items[row.itemIndex] = only.item;
  const next = buildImportReport({
    importId: report.importId,
    bundle,
    output: {
      menus,
      coverage: report.validated.coverage,
      ...(Array.isArray(report.validated.rejected) && report.validated.rejected.length > 0 ? { rejected: report.validated.rejected } : {}),
    },
    aiName: report.aiName,
    now: new Date(report.importedAt),
    // V2: de eerdere afleiding blijft ook na een vervolgvraag zichtbaar.
    carriedNormalizations: report.normalizations,
  });
  if (!next.ok) return next;
  return { ok: true, report: next, row: next.rows.find((entry) => entry.id === rowId) || null };
}

function normalizeRowName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * EÃ©n antwoord voor alle open punten (K6). Elk item moet bij precies Ã©Ã©n
 * openstaande regel horen, uit dezelfde bron. Een antwoord dat een andere regel
 * raakt of een nieuwe regel toevoegt, wordt volledig geweigerd: er is geen
 * "alles overnemen". Daarna beslist de mens nog per regel.
 */
function applyOpenPointsAnswer({ report, bundle, answer, maxRows = MAX_FOLLOW_UPS_PER_IMPORT } = {}) {
  if (!report || !Array.isArray(report.rows)) {
    return { ok: false, code: 'unknown_import', message: 'Deze import hoort niet bij deze sessie.' };
  }
  const parsed = extractCodeBlock(answer);
  if (!parsed.ok) return parsed;
  const items = collectItems(parsed.value);
  if (items.length === 0) {
    return { ok: false, code: 'follow_up_out_of_scope', message: 'Het antwoord bevat geen regels.' };
  }
  if (items.length > Math.min(maxRows, 10)) {
    return { ok: false, code: 'follow_up_out_of_scope', message: 'Het antwoord gaat over te veel regels. Vraag AI over een kleinere set open punten.' };
  }
  const openRows = report.rows.filter((row) => row.askAi && row.state !== 'valid');
  const byKey = new Map(openRows.map((row) => [`${row.sourceId}\u0000${normalizeRowName(row.name)}`, row]));
  const used = new Set();
  const replacements = [];
  for (const entry of items) {
    const sourceId = entry.item && entry.item.evidence && typeof entry.item.evidence.sourceId === 'string' ? entry.item.evidence.sourceId : null;
    const key = `${sourceId}\u0000${normalizeRowName(entry.item && entry.item.name)}`;
    const row = byKey.get(key);
    if (!row || used.has(row.id)) {
      return {
        ok: false,
        code: 'follow_up_out_of_scope',
        message: 'Het antwoord raakt een regel die niet openstaat of een andere bron. Vraag de AI om alleen de open punten.',
      };
    }
    used.add(row.id);
    replacements.push({ row, item: entry.item });
  }
  const menus = cloneMenus(report.validated.menus);
  for (const { row, item: replacement } of replacements) {
    const category = menus[row.menuIndex] && menus[row.menuIndex].categories[row.categoryIndex];
    if (!category || !Array.isArray(category.items) || !category.items[row.itemIndex]) {
      return { ok: false, code: 'unknown_row', message: 'Deze regel hoort niet bij deze import.' };
    }
    category.items[row.itemIndex] = replacement;
  }
  const next = buildImportReport({
    importId: report.importId,
    bundle,
    output: {
      menus,
      coverage: report.validated.coverage,
      ...(Array.isArray(report.validated.rejected) && report.validated.rejected.length > 0 ? { rejected: report.validated.rejected } : {}),
    },
    aiName: report.aiName,
    now: new Date(report.importedAt),
    // V2: ook één antwoord voor alle open punten laat de eerdere afleiding staan.
    carriedNormalizations: report.normalizations,
  });
  if (!next.ok) return next;
  return { ok: true, report: next, rowIds: replacements.map((entry) => entry.row.id) };
}

module.exports = {
  MAX_NOTE,
  MAX_REASONS,
  MAX_FOLLOW_UPS_PER_IMPORT,
  MAX_FOLLOW_UPS_PER_ROW,
  ACTIONS,
  MISSING_REASONS,
  UNCOVERED_ACTIONS,
  ManualImportReviewError,
  validateDecision,
  decideRow,
  decideUncoveredLine,
  uncoveredView,
  reviewView,
  rowForView,
  buildImportProvenance,
  repairMenus,
  menuContextFor,
  buildConceptDraft,
  applyFollowUp,
  applyOpenPointsAnswer,
};
