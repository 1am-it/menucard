'use strict';

// Controlled comparison for the five #59 reference sources (Delivery Lead
// review 6318225879). It reports missed dishes, invented dishes, price errors
// and rubric errors separately — never one blended score — and adds precision
// and recall over dishes. Every deviation keeps the source item's locator and
// quote so the Lead can verify it against the pinned bytes.
//
// Pure and deterministic: the caller supplies the reference and the real
// extraction result. No fetch, parser, provider, database or write here.

const { normalizeName, normalizePrice } = require('../../src/lib/menuSourceComparison');

function normalizeLabel(value) {
  return normalizeName(value);
}

function normalizePath(path) {
  return (Array.isArray(path) ? path : []).map((label) => normalizeLabel(label)).filter(Boolean);
}

function pathKey(path) {
  return normalizePath(path).join('\u0000');
}

function validPrice(value) {
  const normalized = normalizePrice(value);
  return /^\d+\.\d{2}$/.test(normalized) ? normalized : null;
}

function priceSetFromVariants(item) {
  const values = [];
  if (Array.isArray(item && item.priceVariants)) {
    for (const variant of item.priceVariants) {
      const price = validPrice(variant && variant.price);
      if (price) values.push(price);
    }
  } else {
    const price = validPrice(item && item.price);
    if (price) values.push(price);
  }
  return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
}

/** The prices a real extraction row reports, including undecomposed text. */
function priceSetFromActual(item) {
  if (item && item.priceText && (!item.price || item.priceStatus === 'multiple_undecomposed')) {
    const amounts = [...String(item.priceText).matchAll(/(\d{1,3}[.,]\d{1,2})/g)]
      .map((match) => validPrice(match[1]))
      .filter(Boolean);
    if (amounts.length > 0) return [...new Set(amounts)].sort((a, b) => Number(a) - Number(b));
  }
  if (item && Number.isInteger(item.amountMinorUnits)) {
    return [(item.amountMinorUnits / 100).toFixed(2)];
  }
  const price = validPrice(item && item.price);
  return price ? [price] : [];
}

function samePrices(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function bounded(value, max = 400) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function referenceRows(reference) {
  const rows = [];
  for (const menu of Array.isArray(reference && reference.menus) ? reference.menus : []) {
    for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
      const path = Array.isArray(category.path) ? category.path : [];
      for (const item of Array.isArray(category.items) ? category.items : []) {
        const key = normalizeName(item && item.name);
        if (!key) continue;
        rows.push({
          side: 'reference',
          name: bounded(item.name, 200),
          key,
          prices: priceSetFromVariants(item),
          path,
          pathKey: pathKey(path),
          quote: bounded(item.quote, 600),
          locator: bounded(item.locator, 240),
          captureKey: bounded(menu.captureKey, 300),
        });
      }
    }
  }
  return rows;
}

function actualRows(menus) {
  const rows = [];
  for (const menu of Array.isArray(menus) ? menus : []) {
    const title = bounded(menu && menu.title, 160);
    for (const category of Array.isArray(menu && menu.categories) ? menu.categories : []) {
      const categoryPath = Array.isArray(category && category.path) && category.path.length > 0
        ? category.path
        : (category && category.name ? [category.name] : []);
      const path = title && normalizeLabel(title) !== normalizeLabel(categoryPath[0])
        ? [title, ...categoryPath]
        : [...categoryPath];
      for (const item of Array.isArray(category && category.items) ? category.items : []) {
        const key = normalizeName(item && item.name);
        rows.push({
          side: 'actual',
          name: bounded(item && item.name, 200) || '(naamloos)',
          key,
          prices: priceSetFromActual(item),
          priceText: bounded(item.priceText, 120),
          priceStatus: bounded(item.priceStatus, 60),
          path,
          pathKey: pathKey(path),
          quote: bounded(item.evidence && (item.evidence.quote || item.evidence.pattern), 600),
          locator: bounded(item.evidence && item.evidence.locator, 240),
          sourceUrl: bounded(menu && menu.sourceUrl, 300),
        });
      }
    }
  }
  return rows;
}

function percent(numerator, denominator) {
  if (!Number.isInteger(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const left = `${a.pathKey}\u0000${a.key}\u0000${a.prices.join(',')}`;
    const right = `${b.pathKey}\u0000${b.key}\u0000${b.prices.join(',')}`;
    return left.localeCompare(right);
  });
}

function duplicateRows(expected, actual) {
  const expectedCounts = new Map();
  for (const row of expected) {
    const key = `${row.key}\u0000${row.pathKey}`;
    expectedCounts.set(key, (expectedCounts.get(key) || 0) + 1);
  }
  const actualGroups = new Map();
  for (const row of actual) {
    const key = `${row.key}\u0000${row.pathKey}`;
    if (!actualGroups.has(key)) actualGroups.set(key, []);
    actualGroups.get(key).push(row);
  }
  const duplicates = [];
  for (const [key, rows] of actualGroups) {
    const expectedCount = expectedCounts.get(key) || 0;
    if (rows.length > 1 && rows.length > expectedCount) {
      duplicates.push({
        name: rows[0].name,
        path: rows[0].path,
        count: rows.length,
        expectedCount,
        locator: rows[rows.length - 1].locator,
      });
    }
  }
  return duplicates;
}

/**
 * Compares one real extraction with one controlled reference.
 *   reference: { menus: [{ title, categories: [{ path, items }] }], limitations, ... }
 *   menus:     the real menu contexts from the pinned-byte replay
 * Returns the four deviation classes separately, plus precision and recall.
 */
function compareControlledReference(reference, menus, options = {}) {
  const expected = referenceRows(reference);
  const actual = actualRows(menus);
  const usedActual = new Set();

  const pairs = [];
  const pair = (referenceRow, actualRow, kind) => {
    usedActual.add(actualRow);
    pairs.push({ referenceRow, actualRow, kind });
  };

  // 1. Exact: same name, same rubric path, same full price set.
  const remainingExpected = [];
  for (const row of expected) {
    const match = actual.find(
      (candidate) =>
        !usedActual.has(candidate) &&
        candidate.key === row.key &&
        candidate.pathKey === row.pathKey &&
        samePrices(candidate.prices, row.prices),
    );
    if (match) pair(row, match, 'matched');
    else remainingExpected.push(row);
  }

  // 2. Same dish and rubric path with another amount/variant: a price error.
  const priceRemainder = [];
  for (const row of remainingExpected) {
    const match = actual.find(
      (candidate) =>
        !usedActual.has(candidate) &&
        candidate.key === row.key &&
        candidate.pathKey === row.pathKey,
    );
    if (match) pair(row, match, 'price');
    else priceRemainder.push(row);
  }


  // 3. Same dish and amount under another rubric path: a rubric error, never a
  // silent match and never both "missing" and "invented" for the same row.
  const missing = [];
  for (const row of priceRemainder) {
    const match = actual.find(
      (candidate) =>
        !usedActual.has(candidate) &&
        candidate.key === row.key &&
        samePrices(candidate.prices, row.prices) &&
        candidate.pathKey !== row.pathKey,
    );
    if (match) pair(row, match, 'category');
    else missing.push(row);
  }

  const invented = actual.filter((row) => !usedActual.has(row));

  const matched = pairs.filter((entry) => entry.kind === 'matched').length;
  const priceErrors = pairs
    .filter((entry) => entry.kind === 'price')
    .map(({ referenceRow, actualRow }) => ({
      name: referenceRow.name,
      path: referenceRow.path,
      expectedPrices: referenceRow.prices,
      actualPrices: actualRow.prices,
      actualPriceText: actualRow.priceText,
      quote: referenceRow.quote,
      locator: referenceRow.locator,
      captureKey: referenceRow.captureKey,
      actualLocator: actualRow.locator,
    }));
  const categoryErrors = pairs
    .filter((entry) => entry.kind === 'category')
    .map(({ referenceRow, actualRow }) => ({
      name: referenceRow.name,
      expectedPath: referenceRow.path,
      actualPath: actualRow.path,
      price: referenceRow.prices,
      quote: referenceRow.quote,
      locator: referenceRow.locator,
      captureKey: referenceRow.captureKey,
      actualLocator: actualRow.locator,
    }));

  const accountedExpected = matched + priceErrors.length + categoryErrors.length + missing.length;
  const accountedActual = matched + priceErrors.length + categoryErrors.length + invented.length;

  return {
    label: options.label || bounded(reference && reference.label, 160) || 'bron',
    sourceId: options.sourceId || bounded(reference && reference.sourceId, 80) || null,
    referenceItems: expected.length,
    actualItems: actual.length,
    matched,
    missing: missing.length,
    invented: invented.length,
    priceErrors: priceErrors.length,
    categoryErrors: categoryErrors.length,
    precision: percent(matched, actual.length),
    recall: percent(matched, expected.length),
    missingDishes: sortRows(missing).map((row) => ({
      name: row.name,
      prices: row.prices,
      path: row.path,
      quote: row.quote,
      locator: row.locator,
      captureKey: row.captureKey,
    })),
    inventedDishes: sortRows(invented).map((row) => ({
      name: row.name,
      prices: row.prices,
      path: row.path,
      quote: row.quote,
      locator: row.locator,
      sourceUrl: row.sourceUrl,
    })),
    priceErrorRows: [...priceErrors].sort((a, b) => `${pathKey(a.path)}\u0000${a.name}`.localeCompare(`${pathKey(b.path)}\u0000${b.name}`)),
    categoryErrorRows: [...categoryErrors].sort((a, b) => `${pathKey(a.expectedPath)}\u0000${a.name}`.localeCompare(`${pathKey(b.expectedPath)}\u0000${b.name}`)),
    duplicates: duplicateRows(expected, actual),
    accounting: {
      reference: {
        total: expected.length,
        matched,
        missing: missing.length,
        priceErrors: priceErrors.length,
        categoryErrors: categoryErrors.length,
        accounted: accountedExpected,
        balanced: accountedExpected === expected.length,
      },
      actual: {
        total: actual.length,
        matched,
        invented: invented.length,
        priceErrors: priceErrors.length,
        categoryErrors: categoryErrors.length,
        accounted: accountedActual,
        balanced: accountedActual === actual.length,
      },
    },
  };
}

/** Aggregates per-source results without hiding a blocked source. */
function aggregateControlledReferences(results) {
  const list = Array.isArray(results) ? results : [];
  const captured = list.filter((result) => result.captureStatus === 'captured');
  const blocked = list.filter((result) => result.captureStatus !== 'captured');
  const sum = (field) => captured.reduce((total, result) => total + (Number.isInteger(result[field]) ? result[field] : 0), 0);
  const totals = {
    sources: list.length,
    capturedSources: captured.length,
    blockedSources: blocked.length,
    referenceItems: sum('referenceItems'),
    actualItems: sum('actualItems'),
    matched: sum('matched'),
    missing: sum('missing'),
    invented: sum('invented'),
    priceErrors: sum('priceErrors'),
    categoryErrors: sum('categoryErrors'),
  };
  return {
    ...totals,
    precision: percent(totals.matched, totals.actualItems),
    recall: percent(totals.matched, totals.referenceItems),
    blocked: blocked.map((result) => ({ id: result.sourceId, label: result.label, reason: result.blockedReason || null })),
  };
}

module.exports = {
  actualRows,
  aggregateControlledReferences,
  compareControlledReference,
  normalizePath,
  percent,
  priceSetFromActual,
  priceSetFromVariants,
  referenceRows,
};

