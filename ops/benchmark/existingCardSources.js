'use strict';

// Pure helpers for the four existing-card sources (#59 Delivery Lead review
// 6315269210). The historical `data/menus.json` export is a dated observation,
// never live truth, so a comparison reports missing, extra, mispriced and
// structurally different rows instead of "expected counts". A strict
// section-aware comparison and a name+price-only view are both reported: the
// second shows what is really on the live source even when the section model
// differs.
//
// No fetch, parser, provider, database or publication here.

const { flattenMenuItems } = require('../../src/lib/menuSourceComparison');

const CAPTURE_STATES = ['captured', 'blocked', 'failed'];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Validates the pinned manifest against the historical export. A menu key that
 * does not exist there is a configuration error, never an empty comparison.
 */
function validateExistingCardManifest(manifest, menus) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest: not an object'] };
  }
  if (!nonEmptyString(manifest.version)) errors.push('manifest: version is required');
  if (!isDate(manifest.pinnedAt)) errors.push('manifest: pinnedAt must be a date');
  if (!manifest.authorization || manifest.authorization.appProviderActivation !== false) {
    errors.push('manifest: app provider activation must remain false');
  }
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  if (sources.length === 0) errors.push('manifest: at least one source is required');
  const ids = new Set();
  for (const [index, source] of sources.entries()) {
    const where = source && nonEmptyString(source.id) ? `source ${source.id}` : `source #${index + 1}`;
    if (!source || typeof source !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!nonEmptyString(source.id)) errors.push(`${where}: id is required`);
    else if (ids.has(source.id)) errors.push(`${where}: duplicate id`);
    else ids.add(source.id);
    if (!nonEmptyString(source.label)) errors.push(`${where}: label is required`);
    for (const field of [source.entryUrl, ...(Array.isArray(source.probeUrls) ? source.probeUrls : [])]) {
      const parsed = parseUrl(field);
      const label = field === source.entryUrl ? 'entryUrl' : 'probeUrl';
      if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        errors.push(`${where}: ${label} must be a plain https URL`);
      } else if (!Array.isArray(source.allowedHosts) || !source.allowedHosts.includes(parsed.hostname)) {
        errors.push(`${where}: ${label} host must be one of the pinned allowedHosts`);
      }
    }
    if (!Array.isArray(source.probeUrls) || source.probeUrls.length === 0) {
      errors.push(`${where}: at least one probeUrl is required`);
    }
    const keys = Array.isArray(source.menuKeys) ? source.menuKeys : [];
    if (keys.length === 0) errors.push(`${where}: at least one historical menuKey is required`);
    for (const key of keys) {
      if (!menus || !menus[key]) errors.push(`${where}: historical menu ${key} does not exist`);
      else if (!Array.isArray(menus[key].categories)) errors.push(`${where}: historical menu ${key} has no categories`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** The historical card rows for one pinned source, still dated and labelled. */
function historicalEntries(menus, source) {
  return (Array.isArray(source.menuKeys) ? source.menuKeys : []).map((key) => {
    const historical = menus[key] || {};
    return {
      key,
      name: historical.name || source.label || null,
      subtitle: historical.subtitle || null,
      scraped: historical.scraped || null,
      sourceUrl: historical.source || null,
      categories: Array.isArray(historical.categories) ? historical.categories : [],
      itemCount: (Array.isArray(historical.categories) ? historical.categories : [])
        .reduce((total, category) => total + ((category.items || []).length), 0),
    };
  });
}

function normalizeUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * The live menu contexts that belong to one historical source route. Exact
 * source-URL matches win; otherwise every live menu of the source is used and
 * explicitly labelled `source_union`, so a section comparison is never
 * presented as route-exact when it is not.
 */
function liveMenusForHistoricalSource(actualMenus, sourceUrl) {
  const menus = Array.isArray(actualMenus) ? actualMenus : [];
  const wanted = normalizeUrl(sourceUrl);
  if (wanted) {
    const exact = menus.filter((menu) => normalizeUrl(menu && menu.sourceUrl) === wanted);
    if (exact.length > 0) return { menus: exact, liveMatch: 'source_url' };
  }
  return { menus, liveMatch: menus.length > 0 ? 'source_union' : 'none' };
}

/**
 * A structure-independent multiset comparison of name+price rows. It never
 * hides a row: exact name+price first, then the same name with another amount
 * as a price difference, and every remaining row is missing or extra.
 */
function namePriceComparison(referenceCategories, actualMenus) {
  const reference = flattenMenuItems([{ categories: Array.isArray(referenceCategories) ? referenceCategories : [] }])
    .map((row) => ({ name: row.name, price: row.price }));
  const actual = flattenMenuItems(actualMenus).map((row) => ({ name: row.name, price: row.price }));
  const take = (list, used, predicate) => {
    for (let i = 0; i < list.length; i += 1) {
      if (used.has(i)) continue;
      if (predicate(list[i])) {
        used.add(i);
        return i;
      }
    }
    return null;
  };
  const usedReference = new Set();
  const usedActual = new Set();
  let matched = 0;
  reference.forEach((row, index) => {
    const found = take(actual, usedActual, (actualRow) => actualRow.name === row.name && actualRow.price === row.price);
    if (found !== null) {
      usedReference.add(index);
      usedActual.add(found);
      matched += 1;
    }
  });
  const priceMismatches = [];
  reference.forEach((row, index) => {
    if (usedReference.has(index)) return;
    const found = take(actual, usedActual, (actualRow) => actualRow.name === row.name && actualRow.price !== row.price);
    if (found !== null) {
      usedReference.add(index);
      usedActual.add(found);
      priceMismatches.push({ name: row.name, expectedPrice: row.price, actualPrice: actual[found].price });
    }
  });
  const missing = reference.filter((_row, index) => !usedReference.has(index)).map((row) => ({ name: row.name, price: row.price }));
  const extra = actual.filter((_row, index) => !usedActual.has(index)).map((row) => ({ name: row.name, price: row.price }));
  return {
    referenceItems: reference.length,
    actualItems: actual.length,
    matched,
    missing,
    extra,
    priceMismatches,
    balanced: matched + priceMismatches.length + missing.length === reference.length
      && matched + priceMismatches.length + extra.length === actual.length,
  };
}

/** Compact per-menu title/section/item facts for the report. */
function summarizeLiveMenus(menus) {
  return (Array.isArray(menus) ? menus : []).map((menu) => ({
    title: menu && menu.title ? String(menu.title).slice(0, 160) : null,
    sourceUrl: menu && menu.sourceUrl ? menu.sourceUrl : null,
    contextSlug: menu && menu.contextSlug ? menu.contextSlug : null,
    extractionMethod: menu && menu.extractionMethod ? menu.extractionMethod : null,
    categories: ((menu && Array.isArray(menu.categories) && menu.categories) || []).map((category) => ({
      path: Array.isArray(category.path) ? category.path : [],
      name: category.name || null,
      itemCount: (category.items || []).length,
      uncertain: category.uncertain === true,
    })),
    items: ((menu && Array.isArray(menu.categories) && menu.categories) || []).flatMap((category) =>
      (category.items || []).map((item) => ({
        name: item.name,
        price: item.price == null ? null : String(item.price),
        priceStatus: item.priceStatus || null,
        locator: item.evidence && item.evidence.locator ? item.evidence.locator : null,
      })),
    ),
  }));
}

module.exports = {
  CAPTURE_STATES,
  validateExistingCardManifest,
  historicalEntries,
  liveMenusForHistoricalSource,
  namePriceComparison,
  summarizeLiveMenus,
};
