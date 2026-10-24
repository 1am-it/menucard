'use strict';

// S4 of the Delivery Lead order for #59 / BE-21 (review 6376108648): explain,
// per source, why an accepted item did not match the controlled reference.
//
// Why: the live Chocolat run of 2026-10-24 accepted 37 items and matched none of
// the 26 reference rows (25 rubric errors, 12 surplus). A zero without a reason
// invites either a wrong fix (loosen the reference) or a wrong conclusion (the
// model invented the card). This module names the reason instead.
//
// It is diagnosis only, and it changes no counting rule:
//   - the input is the result of the unchanged `compareControlledReference`;
//   - the classes below add nothing to `matched`, `missing`, `invented`,
//     `categoryErrors` or `priceErrors`, and no verdict reads them;
//   - references, counting rules and measurement code are not touched.
//
// Classes:
//   - `category_path`     same name and price, another rubric path. `pathReason`
//                         says what differs: `menu_title` (only the leading
//                         menu-title segment), `extra_level` (one side has an
//                         extra rubric level) or `other`;
//   - `price`             same name and path, other prices;
//   - `name_variant`      a surplus item whose name nearly equals a missed
//                         reference name (same dish, other spelling);
//   - `not_in_reference`  surplus item with no comparable reference name;
//   - `not_extracted`     reference item with no comparable extracted name.
//
// The classes are diagnostic labels, never an acceptance signal.

const { normalizeName } = require('../../src/lib/menuSourceComparison');
const { similarity } = require('./quoteDiagnostics');

const DIAGNOSIS_SCHEMA_VERSION = 'menu-mismatch-diagnosis/v1';
const CLASSIFICATIONS = Object.freeze(['category_path', 'price', 'name_variant', 'not_in_reference', 'not_extracted']);
const PATH_REASONS = Object.freeze(['menu_title', 'extra_level', 'other']);
// A surplus and a missed name are called the same dish only when they are this
// close; the pair is reported with its score, so a reviewer can disagree.
const NAME_VARIANT_SIMILARITY = 0.75;
const MAX_ROWS = 200;
const MAX_PATH_LABEL = 120;
const MAX_NAME = 200;
const MAX_TEXT = 200;

const CLASS_LABELS_NL = Object.freeze({
  category_path: 'ander rubriekpad',
  price: 'andere prijs',
  name_variant: 'naamvariant',
  not_in_reference: 'niet in de referentie',
  not_extracted: 'niet geextraheerd',
});

const PATH_REASON_LABELS_NL = Object.freeze({
  menu_title: 'menutitel verschilt',
  extra_level: 'extra rubriekniveau',
  other: 'ander pad',
});

function bounded(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function labelsOf(path) {
  return Array.isArray(path) ? path.map((label) => bounded(label, MAX_PATH_LABEL)).filter(Boolean) : [];
}

function sameLabels(a, b) {
  return a.length === b.length && a.every((label, index) => normalizeName(label) === normalizeName(b[index]));
}

function startsWithLabels(longer, shorter) {
  if (longer.length <= shorter.length) return false;
  return shorter.every((label, index) => normalizeName(label) === normalizeName(longer[index]));
}


/**
 * What exactly differs between the expected and the actual rubric path. Only
 * the leading segment is called a menu title, because the reference keeps the
 * menu title as the first path segment and a model may print it in sentence
 * case or with a shorter wording.
 */
function pathReason(expectedPath, actualPath) {
  const expected = labelsOf(expectedPath);
  const actual = labelsOf(actualPath);
  if (expected.length === actual.length) {
    const sameLeaf = sameLabels(expected.slice(1), actual.slice(1));
    const firstDiffers = expected.length > 0 && normalizeName(expected[0]) !== normalizeName(actual[0]);
    if (sameLeaf && firstDiffers) return 'menu_title';
    return 'other';
  }
  if (startsWithLabels(actual, expected) || startsWithLabels(expected, actual)) return 'extra_level';
  if (expected.length > 0 && actual.length > 0 && normalizeName(expected[expected.length - 1]) === normalizeName(actual[actual.length - 1])) {
    // Same leaf rubric, a different number of levels above it.
    return 'extra_level';
  }
  return 'other';
}

function priceList(values) {
  return Array.isArray(values) ? values.map((value) => String(value)).slice(0, 10) : [];
}

/**
 * Pairs missed reference names with surplus names, closest first, so a spelling
 * difference is reported once instead of as a miss plus an invention.
 */
function pairNameVariants(missing, invented) {
  const scored = [];
  for (const missed of missing) {
    for (const surplus of invented) {
      const score = similarity(normalizeName(missed.name), normalizeName(surplus.name));
      if (score >= NAME_VARIANT_SIMILARITY) scored.push({ missed, surplus, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || String(a.missed.name).localeCompare(String(b.missed.name)));
  const usedMissing = new Set();
  const usedSurplus = new Set();
  const pairs = [];
  for (const entry of scored) {
    if (usedMissing.has(entry.missed) || usedSurplus.has(entry.surplus)) continue;
    usedMissing.add(entry.missed);
    usedSurplus.add(entry.surplus);
    pairs.push({ ...entry, score: Math.round(entry.score * 100) / 100 });
  }
  return { pairs, usedMissing, usedSurplus };
}

function emptyClasses() {
  return Object.fromEntries(CLASSIFICATIONS.map((code) => [code, 0]));
}


/**
 * Diagnoses one source's comparison. `comparison` is exactly what
 * `compareControlledReference` returns; nothing is recomputed and nothing is
 * accepted here.
 */
function diagnoseMismatches(comparison) {
  const categoryErrorRows = Array.isArray(comparison && comparison.categoryErrorRows) ? comparison.categoryErrorRows : [];
  const priceErrorRows = Array.isArray(comparison && comparison.priceErrorRows) ? comparison.priceErrorRows : [];
  const inventedDishes = Array.isArray(comparison && comparison.inventedDishes) ? comparison.inventedDishes : [];
  const missingDishes = Array.isArray(comparison && comparison.missingDishes) ? comparison.missingDishes : [];
  const { pairs, usedMissing, usedSurplus } = pairNameVariants(missingDishes, inventedDishes);

  const rows = [];
  const classes = emptyClasses();
  const pathReasons = Object.fromEntries(PATH_REASONS.map((code) => [code, 0]));
  let total = 0;
  const add = (row) => {
    total += 1;
    classes[row.classification] += 1;
    if (row.pathReason) pathReasons[row.pathReason] += 1;
    if (rows.length < MAX_ROWS) rows.push(row);
  };

  for (const row of categoryErrorRows) {
    const reason = pathReason(row.expectedPath, row.actualPath);
    add({
      classification: 'category_path',
      label: CLASS_LABELS_NL.category_path,
      pathReason: reason,
      pathReasonLabel: PATH_REASON_LABELS_NL[reason],
      name: bounded(row.name, MAX_NAME),
      expectedPath: labelsOf(row.expectedPath),
      actualPath: labelsOf(row.actualPath),
      prices: priceList(row.price),
      quote: bounded(row.quote, 300),
      locator: bounded(row.locator, 200),
      actualLocator: bounded(row.actualLocator, 200),
    });
  }

  for (const row of priceErrorRows) {
    add({
      classification: 'price',
      label: CLASS_LABELS_NL.price,
      name: bounded(row.name, MAX_NAME),
      path: labelsOf(row.path),
      expectedPrices: priceList(row.expectedPrices),
      actualPrices: priceList(row.actualPrices),
      actualPriceText: bounded(row.actualPriceText, MAX_TEXT),
      quote: bounded(row.quote, 300),
      locator: bounded(row.locator, 200),
      actualLocator: bounded(row.actualLocator, 200),
    });
  }

  for (const pair of pairs) {
    add({
      classification: 'name_variant',
      label: CLASS_LABELS_NL.name_variant,
      expectedName: bounded(pair.missed.name, MAX_NAME),
      actualName: bounded(pair.surplus.name, MAX_NAME),
      similarity: pair.score,
      expectedPath: labelsOf(pair.missed.path),
      actualPath: labelsOf(pair.surplus.path),
      quote: bounded(pair.surplus.quote, 300),
      locator: bounded(pair.surplus.locator, 200),
    });
  }

  for (const row of inventedDishes) {
    if (usedSurplus.has(row)) continue;
    add({
      classification: 'not_in_reference',
      label: CLASS_LABELS_NL.not_in_reference,
      name: bounded(row.name, MAX_NAME),
      path: labelsOf(row.path),
      prices: priceList(row.prices),
      quote: bounded(row.quote, 300),
      locator: bounded(row.locator, 200),
      sourceUrl: bounded(row.sourceUrl, 300),
    });
  }

  for (const row of missingDishes) {
    if (usedMissing.has(row)) continue;
    add({
      classification: 'not_extracted',
      label: CLASS_LABELS_NL.not_extracted,
      name: bounded(row.name, MAX_NAME),
      path: labelsOf(row.path),
      prices: priceList(row.prices),
      quote: bounded(row.quote, 300),
      locator: bounded(row.locator, 200),
      captureKey: bounded(row.captureKey, 300),
    });
  }

  return {
    schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
    note: 'diagnosis only: no count, reference or verdict is changed by this block',
    classes,
    pathReasons,
    rows: rows.sort(
      (a, b) =>
        CLASSIFICATIONS.indexOf(a.classification) - CLASSIFICATIONS.indexOf(b.classification) ||
        String(a.name || a.actualName || '').localeCompare(String(b.name || b.actualName || '')),
    ),
    rowsNotReported: Math.max(0, total - rows.length),
  };
}

/** The same counts without the detail rows, for the console and the totals line. */
function mismatchSummary(diagnosis) {
  if (!diagnosis || typeof diagnosis !== 'object') return null;
  const classes = { ...emptyClasses(), ...(diagnosis.classes || {}) };
  const parts = CLASSIFICATIONS.filter((code) => classes[code] > 0).map((code) => `${code} ${classes[code]}`);
  return { classes, pathReasons: { ...(diagnosis.pathReasons || {}) }, text: parts.length > 0 ? parts.join(', ') : 'geen verschil' };
}

module.exports = {
  CLASSIFICATIONS,
  CLASS_LABELS_NL,
  DIAGNOSIS_SCHEMA_VERSION,
  NAME_VARIANT_SIMILARITY,
  PATH_REASONS,
  PATH_REASON_LABELS_NL,
  diagnoseMismatches,
  mismatchSummary,
  pairNameVariants,
  pathReason,
};
