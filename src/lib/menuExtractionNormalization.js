'use strict';

// R1/R2 of the Delivery Lead order for #59 / BE-21 (review 6375740447).
//
// A language model counts unreliably. The two bookkeeping values this module
// corrects are exactly derivable from the answer itself, so the adapter derives
// them BEFORE the validator runs instead of trusting the model:
//
//   R1 `coverage.itemsExtracted` becomes the number of items actually present
//      in `menus[].categories[].items[]`. The count no longer comes from the
//      model at all: `buildOutputJsonSchema()` in
//      src/lib/menuExtractionAnthropicCall.js leaves the field out of the
//      provider-facing schema.
//   R2 a claimed `complete` status with non-empty `limitations` is downgraded
//      to the next non-complete status of the existing schema (`partial`, or
//      `no_items` when the answer contains no items at all). Only downwards,
//      never upwards: a `partial` or `no_items` claim is never rewritten.
//
// The validator in src/lib/menuExtractionSchema.js is deliberately NOT changed
// and is NOT bypassed: it still rejects a wrong count or a `complete` claim
// with limitations in every input it is given, such as a fixture or a replayed
// answer. Every caller that wants the derivation — the adapter (route B) and,
// since review 6377050602, the manual import — applies this same function
// BEFORE that validator. Every applied correction is returned as a
// `normalizations` entry so the probe report, the JSONL and the manual-import
// review can show it instead of hiding it.
//
// Pure: the input is never mutated.

const NORMALIZATION_SCHEMA_VERSION = 'menu-extraction-normalization/v1';

const NORMALIZATION_RULES = Object.freeze({
  derivedItemCount: 'derived_item_count',
  completeWithLimitations: 'complete_with_limitations',
  // BE-36 (#87, criterion 3): the page repairs of a reading that is read page by
  // page. A repair never approves anything; it only decides between "refuse the
  // whole page" and "this one dish needs a human look".
  imageLocatorRepaired: 'image_locator_repaired',
  imageSourceRepaired: 'image_source_repaired',
  missingPriceReviewed: 'missing_price_reviewed',
  pageFieldDropped: 'page_field_dropped',
  pageCoverageDerived: 'page_coverage_derived',
});

// V2 of the Delivery Lead order for review 6377050602: a correction that was
// applied must be readable as a normal Dutch sentence, and the wording lives
// next to the rules so route B and the manual import cannot drift apart. These
// functions only describe an entry that `applyDerivableNormalizations` already
// produced; they never derive, accept or approve anything themselves.

const NORMALIZATION_NOTICES = Object.freeze({
  [NORMALIZATION_RULES.derivedItemCount]: (entry) =>
    Number.isInteger(entry.from) && entry.from !== entry.to
      ? `Aantal gerechten door het systeem geteld: ${entry.to} (de AI zei ${entry.from}).`
      : `Aantal gerechten door het systeem geteld: ${entry.to}.`,
  [NORMALIZATION_RULES.completeWithLimitations]: (entry) =>
    entry.to === 'no_items'
      ? 'Status bijgesteld naar geen gerechten, omdat de AI zelf een beperking noemde.'
      : 'Status bijgesteld naar gedeeltelijk, omdat de AI zelf een beperking noemde.',
  [NORMALIZATION_RULES.imageLocatorRepaired]: (entry) =>
    typeof entry.to === 'string' && entry.to !== ''
      ? `Herkomst aangevuld: dit gerecht is gelezen van ${entry.to} en staat op Controle nodig.`
      : 'De herkomst van een gerecht is aangevuld; het staat op Controle nodig.',
  [NORMALIZATION_RULES.imageSourceRepaired]: () =>
    'De bron van een gerecht is bijgesteld naar de pagina die gelezen is.',
  [NORMALIZATION_RULES.missingPriceReviewed]: () =>
    'Een ontbrekende prijs is niet ingevuld; het gerecht staat op Controle nodig.',
  [NORMALIZATION_RULES.pageFieldDropped]: () =>
    'Een gegeven dat de app niet kan opslaan is weggelaten; het gerecht blijft staan.',
  [NORMALIZATION_RULES.pageCoverageDerived]: () =>
    'De telling van deze pagina is door het systeem gedaan, niet door de AI.',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The number of items in a parsed answer, or `null` when the shape does not
 * allow a count. A malformed `menus`/`categories`/`items` value is left to the
 * validator: this module only replaces a number it can prove.
 */
function countExtractedItems(output) {
  if (!isObject(output) || !Array.isArray(output.menus)) return null;
  let count = 0;
  for (const menu of output.menus) {
    if (!isObject(menu) || !Array.isArray(menu.categories)) continue;
    for (const category of menu.categories) {
      if (isObject(category) && Array.isArray(category.items)) count += category.items.length;
    }
  }
  return count;
}

/**
 * @param {unknown} output the parsed provider answer
 * @returns {{output: unknown, normalizations: Array<{rule: string, field: string, from: unknown, to: unknown, reason: string}>}}
 */
function applyDerivableNormalizations(output) {
  if (!isObject(output) || !isObject(output.coverage)) return { output, normalizations: [] };
  const itemCount = countExtractedItems(output);
  if (itemCount === null) return { output, normalizations: [] };

  const coverage = output.coverage;
  const normalizations = [];
  const changes = {};

  if (coverage.itemsExtracted !== itemCount) {
    changes.itemsExtracted = itemCount;
    normalizations.push({
      rule: NORMALIZATION_RULES.derivedItemCount,
      field: 'coverage.itemsExtracted',
      from: Number.isInteger(coverage.itemsExtracted) ? coverage.itemsExtracted : null,
      to: itemCount,
      reason: 'the adapter counts the extracted items; the model does not supply this number',
    });
  }

  const limitations = Array.isArray(coverage.limitations) ? coverage.limitations : [];
  if (coverage.status === 'complete' && limitations.length > 0) {
    // Only the first non-complete status of the existing schema; never up.
    const to = itemCount > 0 ? 'partial' : 'no_items';
    changes.status = to;
    normalizations.push({
      rule: NORMALIZATION_RULES.completeWithLimitations,
      field: 'coverage.status',
      from: 'complete',
      to,
      reason: 'complete coverage cannot contain limitations; downgraded, never upgraded',
    });
  }

  if (normalizations.length === 0) return { output, normalizations: [] };
  return { output: { ...output, coverage: { ...coverage, ...changes } }, normalizations };
}

/**
 * One plain-language sentence for one applied normalization, or `null` for an
 * entry this module did not derive. An unknown entry is never silently
 * described as something else.
 *
 * @param {unknown} entry
 * @returns {string|null}
 */
function describeNormalization(entry) {
  if (!isObject(entry) || typeof entry.rule !== 'string') return null;
  const describe = NORMALIZATION_NOTICES[entry.rule];
  return typeof describe === 'function' ? describe(entry) : null;
}

/**
 * The notices for a bounded list of entries, in order and without duplicates.
 *
 * @param {unknown} entries
 * @returns {string[]}
 */
function describeNormalizations(entries) {
  const seen = new Set();
  const notices = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const notice = describeNormalization(entry);
    if (!notice || seen.has(notice)) continue;
    seen.add(notice);
    notices.push(notice);
  }
  return notices;
}

module.exports = {
  NORMALIZATION_RULES,
  NORMALIZATION_SCHEMA_VERSION,
  NORMALIZATION_NOTICES,
  applyDerivableNormalizations,
  countExtractedItems,
  describeNormalization,
  describeNormalizations,
};
