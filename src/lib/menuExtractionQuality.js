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
  pdf_arrangements_skipped: 'pdf_arrangements_skipped',
  html_arrangements_skipped: 'html_arrangements_skipped',
  pdf_ambiguous_price_lines: 'pdf_ambiguous_price_lines',
  pdf_unlinked_price_lines: 'pdf_unlinked_price_lines',
  pdf_unrecognised_headings: 'pdf_unrecognised_headings',
  pdf_inherited_sections: 'pdf_inherited_sections',
  pdf_portions_skipped: 'pdf_portions_skipped',
});

/** Flags that make the extracted menu incomplete because the product cannot
 * store the relation yet; a model call would produce a result that is
 * discarded by `unsupportedProductFields`. */
const PRODUCT_GAP_FLAGS = new Set([
  FLAG_CODES.supplement_as_item,
  FLAG_CODES.pdf_supplements_skipped,
  FLAG_CODES.pdf_arrangements_skipped,
  FLAG_CODES.html_arrangements_skipped,
  FLAG_CODES.pdf_portions_skipped,
]);

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
 *   sourceStatus: Array<{sourceId: string|null, sourceUrl: string|null, flagCodes: string[], blockedByProductGap: boolean, requiresAiExtraction: boolean}>,
 *   blockedSourceIds: string[],
 *   aiEligibleSourceIds: string[],
 *   unscopedBlockedByProductGap: boolean,
 *   blockedByProductGap: boolean,
 *   requiresAiExtraction: boolean,
 * }}
 */
function assessDeterministicMenuQuality({ menus, unknownMenuContexts, sourceInventory } = {}) {
  const menuList = (Array.isArray(menus) ? menus : []).filter((menu) => menu && typeof menu === 'object');
  const flags = [];
  const reviewTargets = [];
  const flaggedSourceIds = new Set();
  const sourceById = new Map();

  const sourceEntry = (sourceId, sourceUrl) => {
    const key = typeof sourceId === 'string' && sourceId ? sourceId : '';
    if (!sourceById.has(key)) {
      sourceById.set(key, {
        sourceId: typeof sourceId === 'string' && sourceId ? sourceId : null,
        sourceUrl: typeof sourceUrl === 'string' && sourceUrl ? sourceUrl : null,
        flagCodes: new Set(),
      });
    }
    const entry = sourceById.get(key);
    if (!entry.sourceUrl && typeof sourceUrl === 'string' && sourceUrl) entry.sourceUrl = sourceUrl;
    return entry;
  };

  const addFlag = (code, menu, detail, target) => {
    const sourceId = (menu && typeof menu.sourceId === 'string' && menu.sourceId) || null;
    const sourceUrl = (menu && typeof menu.sourceUrl === 'string' && menu.sourceUrl) || null;
    const menuContext = (menu && typeof menu.contextSlug === 'string' && menu.contextSlug) || null;
    if (sourceId) flaggedSourceIds.add(sourceId);
    sourceEntry(sourceId, sourceUrl).flagCodes.add(code);
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
        if (name.startsWith('+') || /^supplement(?:en)?\b/i.test(name)) addFlag(FLAG_CODES.supplement_as_item, menu, 'supplement als zelfstandig gerecht', target);
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
    sourceEntry(contextSummary.sourceId, contextSummary.sourceUrl);
    if (Number.isInteger(layout.supplementLines) && layout.supplementLines > 0) {
      const supplementSections = Array.isArray(layout.supplementSections) ? layout.supplementSections : [];
      const where = supplementSections
        .filter((section) => section && typeof section.heading === 'string' && section.heading.trim())
        .map((section) => {
          const pages = Array.isArray(section.pages) && section.pages.length > 0 ? ` p. ${section.pages.join(', ')}` : '';
          const lines = Number.isInteger(section.lines) ? `, ${section.lines} regel(s)` : '';
          return `${section.heading}${pages}${lines}`;
        })
        .join('; ');
      addFlag(
        FLAG_CODES.pdf_supplements_skipped,
        contextSummary,
        `${layout.supplementLines} supplementregel(s)${where ? ` in ${where}` : ''} niet als gerecht opgenomen`,
      );
    }
    if (Number.isInteger(layout.arrangementLines) && layout.arrangementLines > 0) {
      addFlag(FLAG_CODES.pdf_arrangements_skipped, contextSummary, `${layout.arrangementLines} arrangement-/keuzeregel(s) niet als gerecht opgenomen`);
    }
    if (Number.isInteger(layout.ambiguousPriceLines) && layout.ambiguousPriceLines > 0) {
      addFlag(FLAG_CODES.pdf_ambiguous_price_lines, contextSummary, `${layout.ambiguousPriceLines} regel(s) met een prijs- of hoeveelheidsgetal dat niet eenduidig is te koppelen`);
    }
    if (Number.isInteger(layout.unlinkedPriceLines) && layout.unlinkedPriceLines > 0) {
      addFlag(FLAG_CODES.pdf_unlinked_price_lines, contextSummary, `${layout.unlinkedPriceLines} prijsregel(s) zonder aantoonbare lokale naam-/prijskoppeling`);
    }
    if (Number.isInteger(layout.unrecognizedHeadingLines) && layout.unrecognizedHeadingLines > 0) {
      addFlag(FLAG_CODES.pdf_unrecognised_headings, contextSummary, `${layout.unrecognizedHeadingLines} mogelijke rubriekkop(pen) niet herkend`);
    }
    if (
      (Number.isInteger(layout.inheritedSectionColumns) && layout.inheritedSectionColumns > 0) ||
      (Number.isInteger(layout.inheritedSubheadingColumns) && layout.inheritedSubheadingColumns > 0)
    ) {
      addFlag(
        FLAG_CODES.pdf_inherited_sections,
        contextSummary,
        `${layout.inheritedSectionColumns || 0} kolom(men) en ${layout.inheritedSubheadingColumns || 0} subrubriek(en) met een overgenomen rubricering`,
      );
    }
    if (Number.isInteger(layout.portionLines) && layout.portionLines > 0) {
      addFlag(FLAG_CODES.pdf_portions_skipped, contextSummary, `${layout.portionLines} portie-/hoeveelheidsregel(s) niet als los gerecht opgenomen`);
    }
  }

  for (const source of Array.isArray(sourceInventory) ? sourceInventory : []) {
    if (!source || source.status !== 'read') continue;
    sourceEntry(typeof source.id === 'string' ? source.id : null, typeof source.url === 'string' ? source.url : null);
    // HTML arrangement/choice sections that were deliberately excluded by the
    // parser are a product gap for that source, exactly like PDF supplements:
    // a model could only turn them into ordinary dishes. Reported, never paid.
    if (Number.isInteger(source.excludedSections) && source.excludedSections > 0) {
      sourceEntry(typeof source.id === 'string' ? source.id : null, typeof source.url === 'string' ? source.url : null).flagCodes.add(
        FLAG_CODES.html_arrangements_skipped,
      );
      flags.push({
        code: FLAG_CODES.html_arrangements_skipped,
        sourceId: typeof source.id === 'string' ? source.id : null,
        sourceUrl: typeof source.url === 'string' ? source.url : null,
        menuContext: null,
        detail: `${source.excludedSections} uitgesloten sectie(s) met alternatieve prijzen`,
      });
      if (typeof source.id === 'string') flaggedSourceIds.add(source.id);
    }
    // Only a PDF is expected to yield dishes by itself. An HTML homepage may
    // legitimately contain no menu (its menu lives on a linked page), so a
    // "zero items" flag there would mark every ordinary homepage as suspect.
    if (source.kind !== 'pdf') continue;
    const hasItems = menuList.some((menu) => menu.sourceId === source.id && itemCount(menu) > 0);
    if (hasItems) continue;
    sourceEntry(typeof source.id === 'string' ? source.id : null, typeof source.url === 'string' ? source.url : null).flagCodes.add(
      FLAG_CODES.no_deterministic_items,
    );
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
  // Per-source gate: a product gap in one source must never disable repair of
  // another source. Each flagged source is classified on its own flags; an
  // unscoped layout flag (no source id) can only be treated as global.
  const sourceStatus = [...sourceById.values()].map((entry) => {
    const flagCodes = [...entry.flagCodes];
    const blockedByProductGap = flagCodes.some((code) => PRODUCT_GAP_FLAGS.has(code));
    const hasImprovableFlag = flagCodes.some((code) => !PRODUCT_GAP_FLAGS.has(code));
    return {
      sourceId: entry.sourceId,
      sourceUrl: entry.sourceUrl,
      flagCodes,
      blockedByProductGap,
      requiresAiExtraction: !blockedByProductGap && hasImprovableFlag,
    };
  });
  const scopedStatus = sourceStatus.filter((entry) => entry.sourceId !== null);
  const blockedSourceIds = scopedStatus.filter((entry) => entry.blockedByProductGap).map((entry) => entry.sourceId);
  const aiEligibleSourceIds = scopedStatus.filter((entry) => entry.requiresAiExtraction).map((entry) => entry.sourceId);
  const unscopedBlockedByProductGap = sourceStatus.some((entry) => entry.sourceId === null && entry.blockedByProductGap);
  const blockedByProductGap = blockedSourceIds.length > 0 || unscopedBlockedByProductGap;
  const sufficient = menuList.length > 0 && flags.length === 0;
  const requiresAiExtraction =
    !unscopedBlockedByProductGap &&
    (menuList.length === 0
      ? scopedStatus.length === 0 || scopedStatus.some((entry) => !entry.blockedByProductGap)
      : aiEligibleSourceIds.length > 0);

  return {
    sufficient,
    flags,
    codes,
    flaggedSourceIds: [...flaggedSourceIds],
    reviewTargets,
    sourceStatus,
    blockedSourceIds,
    aiEligibleSourceIds,
    unscopedBlockedByProductGap,
    blockedByProductGap,
    requiresAiExtraction,
  };
}

/** Marks exactly the flagged categories "Controle nodig"; never clears one.
 * Every category of a source blocked by a product gap is marked too: that
 * menu is known to be incomplete, and keeping it unmarked would present a
 * partial source as reviewed. */
function applyQualityReview(menuContexts, assessment) {
  const list = Array.isArray(menuContexts) ? menuContexts : [];
  let marked = 0;
  const markCategory = (menuIndex, categoryIndex) => {
    const menu = list[menuIndex];
    const category = menu && Array.isArray(menu.categories) ? menu.categories[categoryIndex] : null;
    if (!category || category.uncertain === true) return;
    category.uncertain = true;
    marked += 1;
  };
  for (const target of (assessment && Array.isArray(assessment.reviewTargets) && assessment.reviewTargets) || []) {
    markCategory(target.menuIndex, target.categoryIndex);
  }
  const blocked = new Set(
    (assessment && Array.isArray(assessment.blockedSourceIds) && assessment.blockedSourceIds) || [],
  );
  if (blocked.size > 0) {
    list.forEach((menu, menuIndex) => {
      if (!menu || !blocked.has(menu.sourceId)) return;
      const categories = Array.isArray(menu.categories) ? menu.categories : [];
      categories.forEach((_category, categoryIndex) => markCategory(menuIndex, categoryIndex));
    });
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
