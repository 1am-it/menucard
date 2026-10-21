'use strict';

// Aggregation for a holdout evaluation (#59 Delivery Lead review 6315269210).
// Pure and independent of the model: it only summarises what the real pipeline
// recorded. It never verifies a menu against a source (that needs a controlled
// reference), so it reports invented dishes/prices as NOT MEASURABLE instead of
// claiming zero. Evidence counts are per item and use the extractor's own
// locator/pattern/contentHash/quote, never a model-provided confidence.
//
// Grouping follows the pinned thresholds document: HTML, PDF, blocked/404 and
// "no menu" are reported separately, with the reasons for anything missing.

const THRESHOLDS = {
  inventedDishes: 0,
  inventedPrices: 0,
  sourceIdPercent: 100,
  locatorPercent: 100,
  supportPercent: 100,
  missingReasonPercent: 100,
};

const SAMPLE_LIMIT = 5;

function bounded(value, max = 300) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : '';
}

function itemList(menus) {
  const items = [];
  for (const menu of Array.isArray(menus) ? menus : []) {
    for (const category of (menu && Array.isArray(menu.categories) && menu.categories) || []) {
      for (const item of (category && Array.isArray(category.items) && category.items) || []) {
        items.push({ item, menu, category });
      }
    }
  }
  return items;
}

function itemSupport(item) {
  const evidence = item && item.evidence && typeof item.evidence === 'object' ? item.evidence : null;
  if (!evidence) return null;
  return bounded(evidence.quote, 200) || bounded(evidence.pattern, 80) || bounded(evidence.contentHash, 200) || null;
}

/** Items, sections, price status and evidence coverage for one result. */
function summarizeMenus(menus) {
  const rows = itemList(menus);
  const priceStatus = {};
  let knownWithoutAmount = 0;
  const missingSourceId = [];
  const missingLocator = [];
  const missingSupport = [];
  let sourceIdMissing = 0;
  let locatorMissing = 0;
  let supportMissing = 0;
  for (const { item, menu } of rows) {
    const status = bounded(item.priceStatus, 40) || (Number.isInteger(item.amountMinorUnits) ? 'known' : 'unknown');
    priceStatus[status] = (priceStatus[status] || 0) + 1;
    if (status === 'known' && !Number.isInteger(item.amountMinorUnits)) knownWithoutAmount += 1;
    const evidence = item.evidence && typeof item.evidence === 'object' ? item.evidence : null;
    const sourceId = bounded((evidence && evidence.sourceId) || (menu && menu.sourceId), 80);
    const locator = bounded(evidence && evidence.locator, 200);
    const support = itemSupport(item);
    const name = bounded(item.name, 120);
    if (!sourceId) {
      sourceIdMissing += 1;
      if (missingSourceId.length < SAMPLE_LIMIT) missingSourceId.push(name);
    }
    if (!locator) {
      locatorMissing += 1;
      if (missingLocator.length < SAMPLE_LIMIT) missingLocator.push(name);
    }
    if (!support) {
      supportMissing += 1;
      if (missingSupport.length < SAMPLE_LIMIT) missingSupport.push(name);
    }
  }
  const total = rows.length;
  const withSourceId = total - sourceIdMissing;
  const withLocator = total - locatorMissing;
  const withSupport = total - supportMissing;
  const percent = (value) => (total === 0 ? null : Math.round((value / total) * 100));
  return {
    itemCount: total,
    categoryCount: (Array.isArray(menus) ? menus : [])
      .reduce((sum, menu) => sum + ((menu && Array.isArray(menu.categories) && menu.categories.length) || 0), 0),
    menuCount: Array.isArray(menus) ? menus.length : 0,
    priceStatus,
    knownWithoutAmount,
    evidence: {
      itemCount: total,
      withSourceId,
      withLocator,
      withSupport,
      sourceIdPercent: percent(withSourceId),
      locatorPercent: percent(withLocator),
      supportPercent: percent(withSupport),
      missingSourceId,
      missingLocator,
      missingSupport,
    },
  };
}

/** One group per outcome type from the thresholds document. */
function resultType(result) {
  if (!result || result.status === 'blocked') return 'blocked';
  if (!Number.isInteger(result.itemCount) || result.itemCount === 0) return 'no_menu';
  return ['html', 'pdf', 'unsupported'].includes(result.kind) ? result.kind : 'unsupported';
}

function emptyGroup() {
  return {
    sourceCount: 0,
    itemCount: 0,
    sectionCount: 0,
    withSourceId: 0,
    withLocator: 0,
    withSupport: 0,
    sources: [],
  };
}

function groupPercent(group, field) {
  return group.itemCount === 0 ? null : Math.round((group[field] / group.itemCount) * 100);
}

/**
 * Builds the per-type report. `results` is the same per-source object the
 * probe wrote. Invented dishes/prices are explicitly NOT MEASURABLE here: that
 * needs a controlled source reference per source, which the holdout by design
 * does not have before its one evaluation.
 */
function aggregateHoldoutReport(results) {
  const groups = {};
  const sources = [];
  for (const [id, result] of Object.entries(results || {})) {
    const type = resultType(result);
    if (!groups[type]) groups[type] = emptyGroup();
    const group = groups[type];
    const evidence = (result.evidence && result.evidence.evidence) || (result.evidence || {});
    const itemCount = Number.isInteger(result.itemCount) ? result.itemCount : 0;
    const missingReasons = [];
    if (result.status === 'blocked' && bounded(result.blockedReason || result.result, 500)) {
      missingReasons.push(bounded(result.blockedReason || result.result, 500));
    }
    for (const limitation of Array.isArray(result.limitations) ? result.limitations : []) {
      if (bounded(limitation, 500)) missingReasons.push(bounded(limitation, 500));
    }
    if (result.errors && bounded(result.errors, 300)) missingReasons.push(bounded(result.errors, 300));
    group.sourceCount += 1;
    group.itemCount += itemCount;
    group.sectionCount += Number.isInteger(result.categoryCount) ? result.categoryCount : 0;
    group.withSourceId += Number.isInteger(evidence.withSourceId) ? evidence.withSourceId : 0;
    group.withLocator += Number.isInteger(evidence.withLocator) ? evidence.withLocator : 0;
    group.withSupport += Number.isInteger(evidence.withSupport) ? evidence.withSupport : 0;
    group.sources.push(id);
    sources.push({
      id,
      label: bounded(result.label, 160) || null,
      type,
      status: result.status || null,
      kind: result.kind || null,
      sourceVersionMatches: result.sourceVersionMatches == null ? null : Boolean(result.sourceVersionMatches),
      itemCount,
      sectionCount: Number.isInteger(result.categoryCount) ? result.categoryCount : null,
      menuCount: Number.isInteger(result.menuCount) ? result.menuCount : null,
      priceStatus: result.priceStatus || null,
      coverage: result.coverage || null,
      evidence: result.evidence || null,
      limitations: Array.isArray(result.limitations) ? result.limitations : [],
      errors: result.errors || result.analysisError || null,
      blockedReason: result.status === 'blocked' ? bounded(result.blockedReason || result.result, 500) : null,
      missingReasons: [...new Set(missingReasons)],
    });
  }

  const groupReport = {};
  for (const [type, group] of Object.entries(groups)) {
    const sourceIdPercent = groupPercent(group, 'withSourceId');
    const locatorPercent = groupPercent(group, 'withLocator');
    const supportPercent = groupPercent(group, 'withSupport');
    groupReport[type] = {
      sourceCount: group.sourceCount,
      sources: group.sources,
      itemCount: group.itemCount,
      sectionCount: group.sectionCount,
      evidence: { withSourceId: group.withSourceId, withLocator: group.withLocator, withSupport: group.withSupport, sourceIdPercent, locatorPercent, supportPercent },
      thresholds: {
        inventedDishes: { target: THRESHOLDS.inventedDishes, measured: null, status: 'not_measurable_without_controlled_reference' },
        inventedPrices: { target: THRESHOLDS.inventedPrices, measured: null, status: 'not_measurable_without_controlled_reference' },
        sourceId: { target: THRESHOLDS.sourceIdPercent, measured: sourceIdPercent, status: sourceIdPercent == null ? 'no_items' : sourceIdPercent === 100 ? 'pass' : 'fail' },
        locator: { target: THRESHOLDS.locatorPercent, measured: locatorPercent, status: locatorPercent == null ? 'no_items' : locatorPercent === 100 ? 'pass' : 'fail' },
        support: { target: THRESHOLDS.supportPercent, measured: supportPercent, status: supportPercent == null ? 'no_items' : supportPercent === 100 ? 'pass' : 'fail' },
        missingReason: {
          target: THRESHOLDS.missingReasonPercent,
          measured: null,
          status: 'not_measurable_without_controlled_reference',
        },
      },
    };
  }

  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    note: 'Aggregate of one pinned first evaluation. Evidence percentages come from per-item extractor locators/patterns/hashes, never from model confidence. Invented-item and missing-item counts require a controlled reference per source and are therefore reported as not measurable here.',
    thresholdsDocument: 'docs/guides/menu-extraction-representative-set.md',
    thresholds: THRESHOLDS,
    groups: groupReport,
    sources,
  };
}

module.exports = {
  THRESHOLDS,
  summarizeMenus,
  itemSupport,
  resultType,
  aggregateHoldoutReport,
};
