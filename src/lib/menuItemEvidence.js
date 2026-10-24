'use strict';

// Per-item source evidence gate (#59 Delivery Lead review 6316295818).
//
// Every accepted menu item must point at the exact place in the source it came
// from (`evidence.locator`) AND carry a supporting fragment
// (`evidence.quote`, `evidence.pattern` or `evidence.contentHash`). The
// 2026-10-21 holdout-2 evaluation showed why this cannot be left to each
// extraction path: the JSON-LD path produced 156 items with 0% locators and
// 0% support, while the HTML path reached 100%. An item without that evidence
// is not reviewable, so it is refused here for every path at once.
//
// Pure and browser-safe: no fetch, no parser, no provider. It never invents
// evidence and never marks an item as proven on the strength of a
// model-provided confidence (the extractor does not emit one).

const MAX_LOCATOR = 200;
const MAX_SUPPORT = 200;

function bounded(value, max = MAX_LOCATOR) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/** The locator / supporting passage of one item, or null when absent. */
function itemEvidence(item) {
  const evidence = item && item.evidence && typeof item.evidence === 'object' ? item.evidence : null;
  if (!evidence) return null;
  const locator = bounded(evidence.locator);
  const support =
    bounded(evidence.quote, MAX_SUPPORT) || bounded(evidence.pattern, 80) || bounded(evidence.contentHash, MAX_SUPPORT);
  if (!locator || !support) return null;
  return { locator, support, pattern: bounded(evidence.pattern, 80) };
}

function hasItemEvidence(item) {
  return itemEvidence(item) !== null;
}

/**
 * Refuses every item without locator + support and reports exactly what was
 * dropped. Menus and categories are mutated in place (the same arrays the
 * receipt, summary, detail and concept all share) so no consumer can keep a
 * different set of accepted items. A category left without items is removed;
 * a menu left without categories is removed too.
 */
function applyItemEvidenceGate(menuContexts) {
  const menus = Array.isArray(menuContexts) ? menuContexts : [];
  const dropped = [];
  const keptMenus = [];
  for (const menu of menus) {
    if (!menu || !Array.isArray(menu.categories)) {
      keptMenus.push(menu);
      continue;
    }
    const keptCategories = [];
    for (const category of menu.categories) {
      if (!category || !Array.isArray(category.items)) {
        keptCategories.push(category);
        continue;
      }
      const kept = [];
      for (const item of category.items) {
        if (hasItemEvidence(item)) {
          kept.push(item);
          continue;
        }
        dropped.push({
          sourceId: bounded(menu.sourceId, 80),
          sourceUrl: bounded(menu.sourceUrl, 200),
          menuContext: bounded(menu.contextSlug, 80),
          category: bounded(category.name, 120),
          name: bounded(item && item.name, 120),
          reason: 'missing_source_evidence',
        });
      }
      category.items = kept;
      if (kept.length > 0) keptCategories.push(category);
    }
    menu.categories = keptCategories;
    if (keptCategories.length > 0) keptMenus.push(menu);
  }
  menus.splice(0, menus.length, ...keptMenus);
  return { menuContexts: menus, dropped, droppedCount: dropped.length };
}

module.exports = {
  itemEvidence,
  hasItemEvidence,
  applyItemEvidenceGate,
};
