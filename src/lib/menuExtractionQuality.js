'use strict';

// Deterministic quality/coverage gates for the menu-extraction chain (#59).
//
// A successful parser run is not the same as a complete menu. This module
// inspects the deterministic result before any model call is made, so that:
//   - an obviously incomplete/inconsistent deterministic result is sent to
//     review and, when a provider is configured, to extraction;
//   - a clean deterministic result never triggers a paid model call whose
//     output would be discarded anyway;
//   - a source that needs constructs the current product concept cannot store
//     (supplements) is reported honestly instead of paying for output that
//     would be rejected by `unsupportedProductFields`.
//
// It never decides trust, never approves anything and never edits a menu: it
// only returns flag codes plus the exact menu/category positions that need
// review. Pure and browser-safe.

const MIN_AI_REPLACEMENT_COVERAGE_RATIO = 0.8;
const MAX_NAME_LENGTH = 90;
const MAX_NAME_WORDS = 12;

const FLAG_CODES = Object.freeze({
  no_deterministic_items: 'no_deterministic_items',
  unheaded_items: 'unheaded_items',
  section_marker_in_item_name: 'section_marker_in_item_name',
  duplicate_item_within_category: 'duplicate_item_within_category',
  duplicate_item_across_categories: 'duplicate_item_across_categories',
  long_item_name: 'long_item_name',
  unresolved_price: 'unresolved_price',
  supplement_as_item: 'supplement_as_item',
  pdf_supplements_skipped: 'pdf_supplements_skipped',
  pdf_ambiguous_price_lines: 'pdf_ambiguous_price_lines',
  pdf_unrecognised_headings: 'pdf_unrecognised_headings',
});

/** Flags that make the extracted menu incomplete because the product cannot
 * store the relation yet; a model call would produce a result that is
 * discarded by `unsupportedProductFields`. */
const PRODUCT_GAP_FLAGS = new Set([FLAG_CODES.supplement_as_item, FLAG_CODES.pdf_supplements_skipped]);

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function itemCount(menu) {
  let count = 0;
  for (const category of (menu && Array.isArray(menu.categories) && menu.categories) || []) {
    count += category && Array.isArray(category.items) ? category.items.length : 0;
  }
  return count;
}

function itemList(menu) {
  const items = [];
  for (const category of (menu && Array.isArray(menu.categories) && menu.categories) || []) {
    for (const item of (category && Array.isArray(category.items) && category.items) || []) {
      if (item) items.push(item);
    }
  }
  return items;
}

/**
 * @param {{menus?: Array, unknownMenuContexts?: Array, sourceInventory?: Array}} input
 * @returns {{
 *   sufficient: boolean,
 *   flags: Array<{code: string, sourceId: string|null, sourceUrl: string|null, menuContext: string|null, detail: string}>,
 *   codes: string[],
 *   flaggedSourceIds: string[],
 *   reviewTargets: Array<{menuIndex: number, categoryIndex: number}>,
 *   blockedByProductGap: boolean,
 *   requiresAiExtraction: boolean,
 * }}
 */
function assessDeterministicMenuQuality({ menus, unknownMenuContexts, sourceInventory } = {}) {
  const menuList = (Array.isArray(menus) ? menus : []).filter((menu) => menu && typeof menu === 'object');
  const flags = [];
  const reviewTargets = [];
  const flaggedSourceIds = new Set();

  const addFlag = (code, menu, detail, target) => {
    const sourceId = (menu && typeof menu.sourceId === 'string' && menu.sourceId) || null;
    const sourceUrl = (menu && typeof menu.sourceUrl === 'string' && menu.sourceUrl) || null;
    const menuContext = (menu && typeof menu.contextSlug === 'string' && menu.contextSlug) || null;
    if (sourceId) flaggedSourceIds.add(sourceId);
    flags.push({ code, sourceId, sourceUrl, menuContext, detail });
    if (target) {
      const key = `${target.menuIndex}:${target.categoryIndex}`;
      if (!reviewTargets.some((existing) => `${existing.menuIndex}:${existing.categoryIndex}` === key)) reviewTargets.push(target);
    }
  };

  menuList.forEach((menu, menuIndex) => {
    const categories = Array.isArray(menu.categories) ? menu.categories : [];
    // The same dish + price under two different sections usually means two
    // menu variants (lunch/dinner) were flattened into one menu. The variant
    // relation is then uncertain and must be reviewed, never guessed.
    const crossCategory = new Map();
    categories.forEach((category, categoryIndex) => {
      if (!category || typeof category !== 'object') return;
      const target = { menuIndex, categoryIndex };
      if (typeof category.name !== 'string' || category.name.trim().length === 0) {
        addFlag(FLAG_CODES.unheaded_items, menu, 'items zonder herkenbare rubriek', target);
      }
      const items = Array.isArray(category.items) ? category.items : [];
      const seen = new Map();
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (name.includes('//')) addFlag(FLAG_CODES.section_marker_in_item_name, menu, 'rubriekmarkering in een gerechtsnaam', target);
        if (name.length > MAX_NAME_LENGTH || name.split(/\s+/).filter(Boolean).length > MAX_NAME_WORDS) {
          addFlag(FLAG_CODES.long_item_name, menu, 'verdacht lange gerechtsnaam (mogelijk samengevoegde regel)', target);
        }
        if (name.startsWith('+')) addFlag(FLAG_CODES.supplement_as_item, menu, 'supplement als zelfstandig gerecht', target);
        if (item.priceStatus !== undefined && item.priceStatus !== 'known') {
          addFlag(FLAG_CODES.unresolved_price, menu, 'prijs niet als één bekend bedrag vastgelegd', target);
        }
        const key = normalizeName(name);
        if (!key) continue;
        seen.set(key, (seen.get(key) || 0) + 1);
        if (seen.get(key) === 2) addFlag(FLAG_CODES.duplicate_item_within_category, menu, 'zelfde gerecht tweemaal in één rubriek', target);
        const crossKey = `${key}|${typeof item.price === 'string' ? item.price : ''}`;
        const previousCategory = crossCategory.get(crossKey);
        if (previousCategory === undefined) {
          crossCategory.set(crossKey, categoryIndex);
        } else if (previousCategory !== categoryIndex) {
          addFlag(FLAG_CODES.duplicate_item_across_categories, menu, 'zelfde gerecht in meerdere rubrieken (mogelijk samengevoegde menuvarianten)', { menuIndex, categoryIndex: previousCategory });
          addFlag(FLAG_CODES.duplicate_item_across_categories, menu, 'zelfde gerecht in meerdere rubrieken (mogelijk samengevoegde menuvarianten)', target);
        }
      }
    });
  });



  // PDF-layout signals: content that was read but deliberately not turned
  // into an ordinary dish (supplements, a price mid-line, an unknown heading).
  for (const context of Array.isArray(unknownMenuContexts) ? unknownMenuContexts : []) {
    const layout = context && context.layout;
    if (!layout || typeof layout !== 'object') continue;
    const contextSummary = {
      sourceId: typeof context.sourceId === 'string' ? context.sourceId : null,
      sourceUrl: typeof context.sourceUrl === 'string' ? context.sourceUrl : null,
    };
    if (Number.isInteger(layout.supplementLines) && layout.supplementLines > 0) {
      addFlag(FLAG_CODES.pdf_supplements_skipped, contextSummary, `${layout.supplementLines} supplementregel(s) niet als gerecht opgenomen`);
    }
    if (Number.isInteger(layout.ambiguousPriceLines) && layout.ambiguousPriceLines > 0) {
      addFlag(FLAG_CODES.pdf_ambiguous_price_lines, contextSummary, `${layout.ambiguousPriceLines} regel(s) met een prijs midden in de regel`);
    }
    if (Number.isInteger(layout.unrecognizedHeadingLines) && layout.unrecognizedHeadingLines > 0) {
      addFlag(FLAG_CODES.pdf_unrecognised_headings, contextSummary, `${layout.unrecognizedHeadingLines} mogelijke rubriekkop(pen) niet herkend`);
    }
  }

  for (const source of Array.isArray(sourceInventory) ? sourceInventory : []) {
    if (!source || source.status !== 'read') continue;
    // Only a PDF is expected to yield dishes by itself. An HTML homepage may
    // legitimately contain no menu (its menu lives on a linked page), so a
    // "zero items" flag there would mark every ordinary homepage as suspect.
    if (source.kind !== 'pdf') continue;
    const hasItems = menuList.some((menu) => menu.sourceId === source.id && itemCount(menu) > 0);
    if (hasItems) continue;
    flags.push({
      code: FLAG_CODES.no_deterministic_items,
      sourceId: typeof source.id === 'string' ? source.id : null,
      sourceUrl: typeof source.url === 'string' ? source.url : null,
      menuContext: null,
      detail: 'gelezen bron zonder herkende gerechten',
    });
    if (typeof source.id === 'string') flaggedSourceIds.add(source.id);
  }

  const codes = [...new Set(flags.map((flag) => flag.code))];
  const blockedByProductGap = codes.some((code) => PRODUCT_GAP_FLAGS.has(code));
  const sufficient = menuList.length > 0 && flags.length === 0;
  const hasImprovableFlag = codes.some((code) => !PRODUCT_GAP_FLAGS.has(code));
  const requiresAiExtraction = menuList.length === 0 || (hasImprovableFlag && !blockedByProductGap);

  return {
    sufficient,
    flags,
    codes,
    flaggedSourceIds: [...flaggedSourceIds],
    reviewTargets,
    blockedByProductGap,
    requiresAiExtraction,
  };
}

/** Marks exactly the flagged categories "Controle nodig"; never clears one. */
function applyQualityReview(menuContexts, assessment) {
  const list = Array.isArray(menuContexts) ? menuContexts : [];
  let marked = 0;
  for (const target of (assessment && Array.isArray(assessment.reviewTargets) && assessment.reviewTargets) || []) {
    const menu = list[target.menuIndex];
    const category = menu && Array.isArray(menu.categories) ? menu.categories[target.categoryIndex] : null;
    if (!category || category.uncertain === true) continue;
    category.uncertain = true;
    marked += 1;
  }
  return marked;
}

/**
 * Gate for replacing a quality-flagged deterministic menu with a validated
 * model menu for the SAME source. Never a merge, never an approval:
 * - at least 80% of the deterministic item count (a materially smaller model
 *   result would lose coverage);
 * - every item must carry evidence for that same source, including a quote.
 */
function aiReplacementGate({ aiMenu, deterministicItemCount, sourceId } = {}) {
  const count = itemCount(aiMenu);
  if (count === 0) return { ok: false, reason: 'no_items' };
  const minimum = Math.ceil((Number.isInteger(deterministicItemCount) ? deterministicItemCount : 0) * MIN_AI_REPLACEMENT_COVERAGE_RATIO);
  if (count < minimum) return { ok: false, reason: 'coverage_below_deterministic', minimum, itemCount: count };
  const missingEvidence = itemList(aiMenu).some((item) => {
    const evidence = item && item.evidence;
    return !evidence || typeof evidence.quote !== 'string' || !evidence.quote.trim() || (sourceId && evidence.sourceId !== sourceId);
  });
  if (missingEvidence) return { ok: false, reason: 'missing_source_evidence' };
  return { ok: true, itemCount: count };
}

module.exports = {
  FLAG_CODES,
  PRODUCT_GAP_FLAGS,
  MIN_AI_REPLACEMENT_COVERAGE_RATIO,
  MAX_NAME_LENGTH,
  MAX_NAME_WORDS,
  itemCount,
  assessDeterministicMenuQuality,
  applyQualityReview,
  aiReplacementGate,
};
