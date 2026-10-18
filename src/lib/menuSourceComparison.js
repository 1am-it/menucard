'use strict';

// Compares one parsed menu source against a controlled reference for that
// same source (#59, Delivery Lead reviews 6246984520 and 6247746317). It
// reports missed, extra, mispriced and wrongly-linked items explicitly — it
// never computes a single "quality score" and never treats an equal item count
// as proof.
//
// Strict accounting: every reference row is explained exactly once (matched,
// price error, wrong section, or missing) and every actual row is explained
// exactly once (matched, price error, wrong section, or surplus). A row that
// remains after matching is always surplus — it is never discarded because a
// same-name/same-price row exists somewhere else in the reference. Matching
// consumes rows one by one, so legitimate repetitions in the reference are
// respected as a multiset.
//
// Pure and browser-safe: the caller supplies both sides. A reference is a
// controlled observation of the stated source version, not ground truth for a
// later version; the probe reports the source hashes alongside the result.

function bounded(value, max = 200) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : '';
}

function normalizeName(value) {
  return bounded(value, 300)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  const text = bounded(value, 40).replace(/\s/g, '').replace(',', '.');
  const match = text.match(/^€?(\d{1,3}(?:\.\d{1,2})?)$/);
  return match ? Number(match[1]).toFixed(2) : text;
}

function normalizePath(path) {
  return (Array.isArray(path) ? path : []).map((label) => bounded(label, 100)).filter(Boolean);
}

function pathKey(path) {
  return normalizePath(path).join('\u0000');
}

function categoryPath(category) {
  if (!category || typeof category !== 'object') return [];
  if (Array.isArray(category.path) && category.path.length > 0) return normalizePath(category.path);
  if (Array.isArray(category.sourcePath) && category.sourcePath.length > 0) return normalizePath(category.sourcePath);
  return bounded(category.name, 100) ? [bounded(category.name, 100)] : [];
}

/** Flattens the product menu-context shape into exact, comparable rows. */
function flattenMenuItems(menus) {
  const rows = [];
  for (const menu of Array.isArray(menus) ? menus : []) {
    if (!menu || typeof menu !== 'object') continue;
    for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
      const path = categoryPath(category);
      for (const item of (category && Array.isArray(category.items) && category.items) || []) {
        if (!item || !normalizeName(item.name)) continue;
        rows.push({
          name: bounded(item.name, 200),
          key: normalizeName(item.name),
          price: normalizePrice(item.price),
          path,
          pathKey: pathKey(path),
          sourceId: bounded(menu.sourceId, 80) || null,
        });
      }
    }
  }
  return rows;
}

/** The reference has the same row shape; `categories` may be either the
 * product shape or `{path, items}`. */
function flattenReference(reference) {
  return flattenMenuItems(reference && Array.isArray(reference.categories) ? [{ categories: reference.categories }] : []);
}

function rowKey(row) {
  return `${row.key}\u0000${row.price}\u0000${row.pathKey}`;
}

/** Counts rows per exact name+price+section key (multiset accounting). */
function countRows(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(rowKey(row), (counts.get(rowKey(row)) || 0) + 1);
  return counts;
}

/**
 * @returns {{
 *   label: string,
 *   expectedItems: number,
 *   actualItems: number,
 *   matched: number,
 *   missing: Array,
 *   extra: Array,
 *   priceMismatches: Array,
 *   categoryMismatches: Array,
 *   duplicates: Array,
 *   accounting: {
 *     expected: { total: number, matched: number, missing: number, priceMismatch: number, categoryMismatch: number, accounted: number, balanced: boolean },
 *     actual: { total: number, matched: number, extra: number, priceMismatch: number, categoryMismatch: number, accounted: number, balanced: boolean },
 *   },
 * }}
 */
function compareMenuSource(reference, menus) {
  const expected = flattenReference(reference);
  const actual = flattenMenuItems(menus);
  const consumed = new Set();
  const consumedByExpected = new Set();
  let matched = 0;

  const take = (predicate) => {
    for (let i = 0; i < actual.length; i += 1) {
      if (consumed.has(i)) continue;
      if (predicate(actual[i])) {
        consumed.add(i);
        return actual[i];
      }
    }
    return null;
  };

  // 1. Exact item: same name, same price, same section.
  expected.forEach((row, index) => {
    if (take((candidate) => rowKey(candidate) === rowKey(row))) {
      matched += 1;
      consumedByExpected.add(index);
    }
  });

  // 2. Same dish and price, different section: a wrong relation.
  const categoryMismatches = [];
  expected.forEach((row, index) => {
    if (consumedByExpected.has(index)) return;
    const candidate = take((actualRow) => actualRow.key === row.key && actualRow.price === row.price);
    if (candidate) {
      consumedByExpected.add(index);
      categoryMismatches.push({ name: row.name, price: row.price, expectedPath: row.path, actualPath: candidate.path });
    }
  });

  // 3. Same dish in the same section with another amount: a price error.
  const priceMismatches = [];
  expected.forEach((row, index) => {
    if (consumedByExpected.has(index)) return;
    const candidate = take((actualRow) => actualRow.key === row.key && actualRow.pathKey === row.pathKey);
    if (candidate) {
      consumedByExpected.add(index);
      priceMismatches.push({ name: row.name, path: row.path, expectedPrice: row.price, actualPrice: candidate.price });
    }
  });

  const missing = expected
    .filter((_row, index) => !consumedByExpected.has(index))
    .map((row) => ({ name: row.name, price: row.price, path: row.path }));

  // Every remaining actual row is surplus. Classifying it away because a
  // same-name/same-price row exists elsewhere in the reference would hide a
  // dish that sits in an extra section or is repeated once too often.
  const extra = actual
    .filter((_row, index) => !consumed.has(index))
    .map((row) => ({ name: row.name, price: row.price, path: row.path }));

  // A repetition is only a duplicate when it exceeds what the reference
  // legitimately repeats for that exact name+price+section. One occurrence on
  // each side is covered by the exact match above.
  const duplicates = [];
  const expectedCounts = countRows(expected);
  const actualCounts = countRows(actual);
  for (const [key, count] of actualCounts) {
    const expectedCount = expectedCounts.get(key) || 0;
    if (count > 1 && count > expectedCount) {
      const row = actual.find((candidate) => rowKey(candidate) === key);
      duplicates.push({ name: row.name, price: row.price, path: row.path, count, expectedCount });
    }
  }

  // The probe refuses a green result unless both sides balance. These numbers
  // are derived from the same lists the caller inspects, so a future change
  // that silently drops a row breaks the invariant instead of hiding it.
  const expectedAccounted = matched + priceMismatches.length + categoryMismatches.length + missing.length;
  const actualAccounted = matched + priceMismatches.length + categoryMismatches.length + extra.length;

  return {
    label: bounded(reference && reference.label, 160) || 'bron',
    expectedItems: expected.length,
    actualItems: actual.length,
    matched,
    missing,
    extra,
    priceMismatches,
    categoryMismatches,
    duplicates,
    accounting: {
      expected: {
        total: expected.length,
        matched,
        missing: missing.length,
        priceMismatch: priceMismatches.length,
        categoryMismatch: categoryMismatches.length,
        accounted: expectedAccounted,
        balanced: expectedAccounted === expected.length,
      },
      actual: {
        total: actual.length,
        matched,
        extra: extra.length,
        priceMismatch: priceMismatches.length,
        categoryMismatch: categoryMismatches.length,
        accounted: actualAccounted,
        balanced: actualAccounted === actual.length,
      },
    },
  };
}

module.exports = {
  normalizeName,
  normalizePrice,
  categoryPath,
  flattenMenuItems,
  flattenReference,
  compareMenuSource,
};

