'use strict';

// Versioned, exact output contract for a future model-assisted extractor.
// This is independent of any provider. It deliberately describes only the
// fields the backend can validate and map; unknown fields are errors, not
// silent schema extensions. No confidence/approval/review field exists.
//
// Prices follow MARKET-02's four states. Evidence carries a source reference,
// a short locator and the supporting quote; a quote is mandatory, so a model
// cannot claim a field without a source passage. A variant/supplement/choice
// relation is represented explicitly and is reported as unsupported by the
// current product concept rather than flattened.

const EXTRACTION_OUTPUT_SCHEMA_VERSION = 'menu-extraction-output/v1';
const PRICE_STATUSES = ['known', 'multiple_undecomposed', 'on_request', 'unknown'];
const COVERAGE_STATUSES = ['complete', 'partial', 'no_items'];
const REJECTION_REASONS = ['not_menu', 'unreadable', 'missing_price', 'missing_name', 'ambiguous_price', 'unsupported', 'duplicate', 'other'];
const ALLERGEN_STATUSES = ['explicit', 'unknown'];
const FORBIDDEN_TRUST_KEYS = ['confidence', 'reviewReady', 'approved', 'publicationReady'];

const LIMITS = Object.freeze({
  menus: 100,
  categoriesPerMenu: 100,
  itemsPerCategory: 500,
  itemsTotal: 1000,
  rejected: 200,
  variantsPerItem: 10,
  allergensPerItem: 20,
  pathDepth: 8,
  title: 160,
  category: 160,
  name: 200,
  description: 1000,
  priceText: 160,
  locator: 200,
  quote: 500,
  label: 80,
  limitation: 300,
  rejectedText: 300,
  sourceId: 80,
  unreadSources: 100,
  limitations: 50,
});

const EXTRACTION_OUTPUT_SCHEMA = Object.freeze({
  version: EXTRACTION_OUTPUT_SCHEMA_VERSION,
  requiredTopLevel: ['menus', 'coverage'],
  allowedTopLevel: ['menus', 'rejected', 'coverage'],
  menus: {
    required: ['title', 'sourceId', 'categories'],
    allowed: ['title', 'sourceId', 'variant', 'order', 'categories'],
    variant: 'string|null',
    order: 'non-negative integer|null',
    categories: { required: ['name', 'items'], allowed: ['name', 'path', 'uncertain', 'items'] },
    items: {
      required: ['name', 'priceStatus', 'evidence'],
      allowed: ['name', 'description', 'priceStatus', 'amountMinorUnits', 'currency', 'priceText', 'priceVariants', 'isFrom', 'supplementOf', 'allergens', 'availability', 'evidence'],
    },
  },
  rejected: { allowed: ['sourceId', 'locator', 'reason', 'text'] },
  coverage: {
    required: ['status', 'sourcesRead', 'pagesRead', 'itemsExtracted', 'unreadSources', 'limitations'],
    allowed: ['status', 'sourcesRead', 'pagesRead', 'itemsExtracted', 'unreadSources', 'limitations'],
  },
  priceStatuses: PRICE_STATUSES,
  coverageStatuses: COVERAGE_STATUSES,
  forbiddenTrustKeys: FORBIDDEN_TRUST_KEYS,
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasExactKeys(obj, allowed) {
  return Object.keys(obj).every((key) => allowed.includes(key));
}

function shortString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function optionalString(value, max) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length <= max);
}

function findForbiddenKey(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenKey(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_TRUST_KEYS.includes(key)) return key;
    const found = findForbiddenKey(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

// S2 of the Delivery Lead order for #59 / BE-21 (review 6376108648): one
// documented equivalence of typographic character classes, and nothing else.
//
// The live Zuyd run of 2026-10-24 was rejected twice on four citations that
// differed from the source only in the shape of the quotation mark: the source
// prints `‘Catch of the day’` and the model answered `'Catch of the day'`. A
// curly quote and a straight quote are the same character to a reader and to a
// menu, so the equality of those shapes is what is compared. These are
// character-class variants of one glyph, not a content relaxation:
//
//   - typographic single quotes and the prime  -> '
//   - typographic double quotes and the double prime -> "
//   - en dash and em dash                      -> -
//   - the hard (non-breaking) space            -> a normal space
//
// Every other difference stays a difference: other words, joined source lines,
// an added separator, a changed digit or a different order are still rejected.
// The list is exported so the offline diagnosis and the regressions use exactly
// this table instead of a second, quieter copy.
const TYPOGRAPHIC_EQUIVALENTS = Object.freeze([
  Object.freeze({ characters: '\u2018\u2019\u201A\u2032', replacement: "'" }),
  Object.freeze({ characters: '\u201C\u201D\u201E\u2033', replacement: '"' }),
  Object.freeze({ characters: '\u2013\u2014', replacement: '-' }),
  Object.freeze({ characters: '\u00A0', replacement: ' ' }),
]);

function equateTypographicCharacters(value) {
  let text = value;
  for (const entry of TYPOGRAPHIC_EQUIVALENTS) {
    for (const character of entry.characters) text = text.split(character).join(entry.replacement);
  }
  return text;
}

/**
 * The one normalization the evidence check uses: equate the typographic
 * character classes above, collapse every whitespace run (including a newline)
 * to a single space, trim and lower-case. Exported unchanged so the offline
 * citation diagnosis, the report's own coverage count and the manual import can
 * never disagree with the validator about what "present" means. Nothing else is
 * loosened: the validator keeps the last word.
 */
function normalizeEvidenceText(value) {
  if (typeof value !== 'string') return '';
  return equateTypographicCharacters(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Whether a quote is a literal passage of the cited source, by that rule. */
function quoteIsPresentInSource(quote, sourceText) {
  if (typeof quote !== 'string' || typeof sourceText !== 'string') return false;
  const normalizedQuote = normalizeEvidenceText(quote);
  if (normalizedQuote.length === 0) return false;
  return normalizeEvidenceText(sourceText).includes(normalizedQuote);
}

const IMAGE_LOCATOR = /^(afbeelding|pagina)\s+(\d{1,3})$/i;
const IMAGE_LOCATOR_PROBLEM = 'must name "afbeelding N" or "pagina N" for an image or scan source';

/** A source whose evidence can never be checked literally: an image page or a scan. */
function isImageSource(source) {
  if (!source || typeof source !== 'object') return false;
  if (source.kind === 'image' || source.imageRead === true) return true;
  return Array.isArray(source.images) && source.images.length > 0;
}

/** "afbeelding 2" / "pagina 3" as { kind, number, label }, or null. */
function imageProvenance(locator) {
  if (typeof locator !== 'string') return null;
  const text = locator.trim();
  const match = IMAGE_LOCATOR.exec(text);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isInteger(number) || number < 1) return null;
  const kind = match[1].toLowerCase() === 'afbeelding' ? 'image' : 'page';
  return {
    kind,
    number,
    label: kind === 'image' ? `gelezen van afbeelding ${number}` : `gelezen van pagina ${number}`,
  };
}

function validateEvidence(evidence, where, sourceById, problems) {
  if (!isObject(evidence)) {
    problems.push(`${where}.evidence must be an object`);
    return;
  }
  if (!hasExactKeys(evidence, ['sourceId', 'locator', 'quote'])) problems.push(`${where}.evidence has unknown fields`);
  if (!shortString(evidence.sourceId, LIMITS.sourceId) || !sourceById.has(evidence.sourceId)) problems.push(`${where}.evidence.sourceId must reference the source inventory`);
  if (!shortString(evidence.locator, LIMITS.locator)) problems.push(`${where}.evidence.locator must be a short non-empty string`);
  if (!shortString(evidence.quote, LIMITS.quote)) {
    problems.push(`${where}.evidence.quote must contain a short supporting passage`);
  } else {
    const source = sourceById.get(evidence.sourceId);
    const sourceText = source && typeof source.text === 'string' ? source.text : null;
    // BE-33 (#79, criterion 3): a quote from an image or a scan can never be
    // checked literally, so it is not compared with text. Its origin is
    // mandatory instead: a dish without "afbeelding N"/"pagina N" is refused.
    if (isImageSource(source)) {
      if (!imageProvenance(evidence.locator)) problems.push(`${where}.evidence.locator ${IMAGE_LOCATOR_PROBLEM}`);
    } else if (sourceText && !quoteIsPresentInSource(evidence.quote, sourceText)) {
      problems.push(`${where}.evidence.quote is not present in the cited source`);
    }
  }
}

function validateVariants(variants, where, problems) {
  if (!Array.isArray(variants) || variants.length > LIMITS.variantsPerItem) {
    problems.push(`${where}.priceVariants must be an array of at most ${LIMITS.variantsPerItem}`);
    return;
  }
  variants.forEach((variant, v) => {
    const at = `${where}.priceVariants[${v}]`;
    if (!isObject(variant)) return problems.push(`${at} must be an object`);
    if (!hasExactKeys(variant, ['label', 'amountMinorUnits', 'currency'])) problems.push(`${at} has unknown fields`);
    if (!(variant.label === null || shortString(variant.label, LIMITS.label))) problems.push(`${at}.label must be null or a short string`);
    if (!isNonNegativeInteger(variant.amountMinorUnits)) problems.push(`${at}.amountMinorUnits must be a non-negative integer`);
    if (variant.currency !== 'EUR') problems.push(`${at}.currency must be EUR`);
  });
}

function validateItem(item, where, sourceById, problems) {
  if (!isObject(item)) {
    problems.push(`${where} must be an object`);
    return;
  }
  if (!hasExactKeys(item, EXTRACTION_OUTPUT_SCHEMA.menus.items.allowed)) problems.push(`${where} has unknown fields`);
  if (!shortString(item.name, LIMITS.name)) problems.push(`${where}.name must be a short non-empty string`);
  if (!optionalString(item.description, LIMITS.description)) problems.push(`${where}.description is too long or not a string`);
  if (!PRICE_STATUSES.includes(item.priceStatus)) problems.push(`${where}.priceStatus is invalid`);

  const known = item.priceStatus === 'known';
  if (known && !isNonNegativeInteger(item.amountMinorUnits)) problems.push(`${where}.amountMinorUnits is required for a known price`);
  if (!known && item.amountMinorUnits !== undefined && item.amountMinorUnits !== null) problems.push(`${where}.amountMinorUnits must be absent/null unless known`);
  if (known && item.currency !== 'EUR') problems.push(`${where}.currency must be EUR for a known price`);
  if (!known && item.currency !== undefined && item.currency !== null) problems.push(`${where}.currency must be absent/null unless known`);
  if (!optionalString(item.priceText, LIMITS.priceText)) problems.push(`${where}.priceText is too long or not a string`);
  if (item.isFrom !== undefined && typeof item.isFrom !== 'boolean') problems.push(`${where}.isFrom must be boolean when present`);
  if (item.supplementOf !== undefined && !shortString(item.supplementOf, LIMITS.name)) problems.push(`${where}.supplementOf must be a short non-empty item reference`);

  if (item.priceVariants !== undefined) {
    validateVariants(item.priceVariants, where, problems);
    if (item.priceStatus !== 'multiple_undecomposed') problems.push(`${where}.priceVariants require priceStatus multiple_undecomposed`);
    if (item.amountMinorUnits !== undefined && item.amountMinorUnits !== null) problems.push(`${where}.amountMinorUnits must be null when price variants exist`);
  }

  if (item.allergens !== undefined) {
    const allergens = item.allergens;
    if (!isObject(allergens) || !hasExactKeys(allergens, ['status', 'values'])) {
      problems.push(`${where}.allergens must be an object with status and values`);
    } else {
      if (!ALLERGEN_STATUSES.includes(allergens.status)) problems.push(`${where}.allergens.status is invalid`);
      if (!Array.isArray(allergens.values) || allergens.values.length > LIMITS.allergensPerItem || allergens.values.some((v) => !shortString(v, LIMITS.label))) {
        problems.push(`${where}.allergens.values must be a bounded string array`);
      } else if (allergens.status === 'explicit' && allergens.values.length === 0) {
        problems.push(`${where}.allergens explicit status needs at least one value`);
      } else if (allergens.status === 'unknown' && allergens.values.length !== 0) {
        problems.push(`${where}.allergens unknown status must not carry values`);
      }
    }
  }
  if (item.availability !== undefined && !shortString(item.availability, LIMITS.label)) problems.push(`${where}.availability must be a short non-empty string`);
  validateEvidence(item.evidence, where, sourceById, problems);
}

/**
 * Strict independent validation. `sources` is the backend's own inventory;
 * `source.text` is optional, but when present every evidence quote must occur
 * in it. No model-supplied field is trusted because it says so.
 */
function validateStructuredOutput(output, sources) {
  const problems = [];
  if (!isObject(output)) return ['output must be an object'];
  const forbidden = findForbiddenKey(output);
  if (forbidden) problems.push(`forbidden trust key: ${forbidden}`);
  for (const key of Object.keys(output)) if (!EXTRACTION_OUTPUT_SCHEMA.allowedTopLevel.includes(key)) problems.push(`unknown top-level field: ${key}`);
  if (!Array.isArray(output.menus)) problems.push('menus must be an array');
  if (!isObject(output.coverage)) problems.push('coverage must be an object');
  if (problems.length > 0) return problems;

  const sourceList = Array.isArray(sources) ? sources : [];
  const sourceById = new Map();
  for (const source of sourceList) if (isObject(source) && typeof source.id === 'string') sourceById.set(source.id, source);
  if (output.menus.length > LIMITS.menus) problems.push(`more than ${LIMITS.menus} menus`);
  let itemCount = 0;

  output.menus.forEach((menu, m) => {
    const at = `menus[${m}]`;
    if (!isObject(menu)) return problems.push(`${at} must be an object`);
    if (!hasExactKeys(menu, EXTRACTION_OUTPUT_SCHEMA.menus.allowed)) problems.push(`${at} has unknown fields`);
    if (!shortString(menu.title, LIMITS.title)) problems.push(`${at}.title must be a short non-empty string`);
    if (!shortString(menu.sourceId, LIMITS.sourceId) || !sourceById.has(menu.sourceId)) problems.push(`${at}.sourceId must reference the source inventory`);
    if (menu.variant !== undefined && !(menu.variant === null || shortString(menu.variant, LIMITS.title))) problems.push(`${at}.variant must be null or a short string`);
    if (menu.order !== undefined && !(menu.order === null || isNonNegativeInteger(menu.order))) problems.push(`${at}.order must be a non-negative integer or null`);
    if (!Array.isArray(menu.categories)) return problems.push(`${at}.categories must be an array`);
    if (menu.categories.length > LIMITS.categoriesPerMenu) problems.push(`${at} has more than ${LIMITS.categoriesPerMenu} categories`);
    menu.categories.forEach((category, c) => {
      const catAt = `${at}.categories[${c}]`;
      if (!isObject(category)) return problems.push(`${catAt} must be an object`);
      if (!hasExactKeys(category, EXTRACTION_OUTPUT_SCHEMA.menus.categories.allowed)) problems.push(`${catAt} has unknown fields`);
      if (!shortString(category.name, LIMITS.category)) problems.push(`${catAt}.name must be a short non-empty string`);
      if (category.path !== undefined) {
        if (!Array.isArray(category.path) || category.path.length > LIMITS.pathDepth || category.path.some((p) => !shortString(p, LIMITS.category))) {
          problems.push(`${catAt}.path must be a bounded string array`);
        }
      }
      if (category.uncertain !== undefined && typeof category.uncertain !== 'boolean') problems.push(`${catAt}.uncertain must be boolean when present`);
      if (!Array.isArray(category.items)) return problems.push(`${catAt}.items must be an array`);
      if (category.items.length > LIMITS.itemsPerCategory) problems.push(`${catAt} has more than ${LIMITS.itemsPerCategory} items`);
      category.items.forEach((item, i) => {
        itemCount += 1;
        validateItem(item, `${catAt}.items[${i}]`, sourceById, problems);
      });
    });
  });
  if (itemCount > LIMITS.itemsTotal) problems.push(`more than ${LIMITS.itemsTotal} items`);


  if (output.rejected !== undefined) {
    if (!Array.isArray(output.rejected) || output.rejected.length > LIMITS.rejected) {
      problems.push('rejected must be a bounded array');
    } else {
      output.rejected.forEach((row, r) => {
        const at = `rejected[${r}]`;
        if (!isObject(row)) return problems.push(`${at} must be an object`);
        if (!hasExactKeys(row, EXTRACTION_OUTPUT_SCHEMA.rejected.allowed)) problems.push(`${at} has unknown fields`);
        if (!shortString(row.sourceId, LIMITS.sourceId) || !sourceById.has(row.sourceId)) problems.push(`${at}.sourceId must reference the source inventory`);
        if (!shortString(row.locator, LIMITS.locator)) problems.push(`${at}.locator must be a short non-empty string`);
        if (!REJECTION_REASONS.includes(row.reason)) problems.push(`${at}.reason is invalid`);
        if (row.text !== undefined && !shortString(row.text, LIMITS.rejectedText)) problems.push(`${at}.text must be a short non-empty string when present`);
      });
    }
  }

  const coverage = output.coverage;
  if (coverage) {
    if (!hasExactKeys(coverage, EXTRACTION_OUTPUT_SCHEMA.coverage.allowed)) problems.push('coverage has unknown fields');
    if (!COVERAGE_STATUSES.includes(coverage.status)) problems.push('coverage.status is invalid');
    for (const key of ['sourcesRead', 'pagesRead', 'itemsExtracted']) if (!isNonNegativeInteger(coverage[key])) problems.push(`coverage.${key} must be a non-negative integer`);
    if (isNonNegativeInteger(coverage.itemsExtracted) && coverage.itemsExtracted !== itemCount) problems.push('coverage.itemsExtracted must equal the number of extracted items');
    if (isNonNegativeInteger(coverage.sourcesRead) && coverage.sourcesRead > sourceList.length) problems.push('coverage.sourcesRead exceeds the source inventory');
    const unreadSources = Array.isArray(coverage.unreadSources) ? coverage.unreadSources : [];
    if (!Array.isArray(coverage.unreadSources) || unreadSources.length > LIMITS.unreadSources) {
      problems.push('coverage.unreadSources must be a bounded array');
    } else {
      unreadSources.forEach((row, i) => {
        const at = `coverage.unreadSources[${i}]`;
        if (!isObject(row) || !hasExactKeys(row, ['sourceId', 'locator', 'reason'])) return problems.push(`${at} is invalid`);
        if (!shortString(row.sourceId, LIMITS.sourceId) || !sourceById.has(row.sourceId)) problems.push(`${at}.sourceId must reference the source inventory`);
        if (!shortString(row.locator, LIMITS.locator)) problems.push(`${at}.locator must be a short non-empty string`);
        if (!REJECTION_REASONS.includes(row.reason)) problems.push(`${at}.reason is invalid`);
      });
    }
    const limitations = Array.isArray(coverage.limitations) ? coverage.limitations : [];
    if (!Array.isArray(coverage.limitations) || limitations.length > LIMITS.limitations || limitations.some((l) => !shortString(l, LIMITS.limitation))) {
      problems.push('coverage.limitations must be a bounded string array');
    }
    if (coverage.status === 'complete' && unreadSources.length > 0) problems.push('complete coverage cannot contain unread sources');
    if (coverage.status === 'complete' && limitations.length > 0) problems.push('complete coverage cannot contain limitations');
    if (coverage.status === 'complete' && coverage.sourcesRead !== sourceList.length) problems.push('complete coverage must read every source');
    if (coverage.status === 'partial' && unreadSources.length === 0 && limitations.length === 0) problems.push('partial coverage needs an unread source or limitation');
    if (coverage.status === 'no_items' && itemCount !== 0) problems.push('no_items coverage cannot contain extracted items');
    if (coverage.status !== 'no_items' && itemCount === 0) problems.push('coverage status requires at least one extracted item');
  }
  return problems;
}

module.exports = {
  EXTRACTION_OUTPUT_SCHEMA_VERSION,
  EXTRACTION_OUTPUT_SCHEMA,
  PRICE_STATUSES,
  COVERAGE_STATUSES,
  REJECTION_REASONS,
  ALLERGEN_STATUSES,
  FORBIDDEN_TRUST_KEYS,
  LIMITS,
  TYPOGRAPHIC_EQUIVALENTS,
  equateTypographicCharacters,
  findForbiddenKey,
  imageProvenance,
  isImageSource,
  normalizeEvidenceText,
  quoteIsPresentInSource,
  validateStructuredOutput,
};

