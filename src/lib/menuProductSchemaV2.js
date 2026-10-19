'use strict';

// menu-extraction-product/v2 — the versioned internal contract for menu
// variants, price variants and supplements that the current v1 receipt/concept
// cannot store losslessly.
//
// Pure and browser-safe: no fetch, no database client, no provider, no
// filesystem and no write route. Nothing in this round stores a receipt or
// concept, activates a schema route, changes data/menus.json or publishes.
// The read-only inventory of every path that must be connected later is
// docs/guides/menu-extraction-v2-integration.md.
//
// Design rules enforced here:
//   - an unknown schema version is a hard error, never a silent v1 default;
//   - a primary price is never guessed: `primaryPriceRef` is null unless the
//     producer recorded an explicit relation, and a supplement variant can
//     never be primary;
//   - every item and every price amount needs its own source evidence; a quote
//     that does not contain the claimed amount is `price_evidence_missing`;
//   - a supplement may point at an unknown target only when the menu/category
//     context is proven, and it then carries an explicit limitation;
//   - unknown is not zero and not an empty list: allergens stay explicit or
//     unknown, and `sourceTextStatus` says whether the source passage was
//     isolated;
//   - manual and extracted values are recorded separately via `origins`;
//   - IDs are result-local, unique within one analysis and carry no rights.
// No confidence/reviewReady/approved/publicationReady field exists at any
// depth; `findForbiddenKey` rejects those keys wherever they appear.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// src/lib/.

const MENU_PRODUCT_SCHEMA_VERSION = 'menu-extraction-product/v2';
const LEGACY_OUTPUT_SCHEMA_VERSION = 'menu-extraction-output/v1';

const CATEGORY_KINDS = ['section', 'choice_group', 'arrangement', 'beverage'];
const ITEM_KINDS = ['dish', 'choice', 'supplement', 'arrangement', 'beverage', 'unknown'];
const PRICE_STATUSES = ['known', 'from', 'multiple_undecomposed', 'on_request', 'unknown'];
const VARIANT_KINDS = ['glass', 'bottle', 'portion', 'person', 'other'];
const ALLERGEN_STATUSES = ['explicit', 'unknown'];
const ALLERGEN_SOURCE_TEXT_STATUSES = ['recorded', 'not_isolated', 'unknown'];
const ORIGINS = ['extracted', 'manual', 'unknown'];
const COVERAGE_STATUSES = ['complete', 'partial', 'no_items'];
const SUPPLEMENT_TARGET_STATUSES = ['resolved', 'unresolved'];
const REJECTION_REASONS = ['not_menu', 'unreadable', 'missing_price', 'missing_name', 'ambiguous_price', 'unsupported', 'duplicate', 'other'];
const FORBIDDEN_TRUST_KEYS = ['confidence', 'reviewReady', 'approved', 'publicationReady'];

// Actions the older reader must block when it cannot interpret a row. Kept in
// the same vocabulary the design and review use, so a route can report one
// concrete reason and still preserve the raw row.
const READER_BLOCKED_ACTIONS = ['save', 'confirm', 'export', 'publish'];

const LIMITS = Object.freeze({
  menus: 100,
  categoriesPerMenu: 100,
  itemsPerCategory: 500,
  itemsTotal: 1000,
  rejected: 200,
  variantsPerItem: 10,
  allergensPerItem: 20,
  dietaryLabelsPerItem: 10,
  pathDepth: 8,
  id: 80,
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
  sourceText: 500,
  allergenCode: 80,
});

const ORIGIN_FIELDS = ['name', 'description', 'price', 'allergens', 'supplementOf', 'availability', 'kind'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasExactKeys(obj, allowed) {
  return Object.keys(obj).every((key) => allowed.includes(key));
}

function hasAllKeys(obj, required) {
  return required.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function isShortString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function isOptionalString(value, max) {
  return value === null || (typeof value === 'string' && value.length <= max);
}

function isOptionalShortString(value, max) {
  return value === null || isShortString(value, max);
}

function isHexHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Recursive trust scan with a depth cap; returns the first forbidden key. */
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

/**
 * The exact source-language renderings a claimed amount may have in a quote.
 * Deliberately conservative: no conversion, no rounding, and only the common
 * Dutch thousands notation. A quote that contains none of these forms is not
 * price evidence.
 */
function amountRenderings(amountMinorUnits) {
  if (!isNonNegativeInteger(amountMinorUnits)) return [];
  const euros = Math.floor(amountMinorUnits / 100);
  const cents = amountMinorUnits % 100;
  const twoDigits = String(cents).padStart(2, '0');
  const forms = new Set([`${euros},${twoDigits}`, `${euros}.${twoDigits}`]);
  if (cents % 10 === 0) {
    forms.add(`${euros},${cents / 10}`);
    forms.add(`${euros}.${cents / 10}`);
  }
  if (cents === 0) forms.add(String(euros));
  if (euros >= 1000) {
    const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    forms.add(`${grouped},${twoDigits}`);
    if (cents === 0) forms.add(grouped);
  }
  return [...forms];
}

function containsNumericToken(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^0-9])${escaped}(?:[^0-9]|$)`).test(text);
}

/** True only when `quote` itself contains the claimed amount in the source. */
function quoteContainsAmount(quote, amountMinorUnits) {
  if (typeof quote !== 'string') return false;
  return amountRenderings(amountMinorUnits).some((token) => containsNumericToken(quote, token));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function sourceIndex(sources) {
  const map = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (isObject(source) && typeof source.id === 'string' && source.id.trim()) map.set(source.id, source);
  }
  return map;
}

function validateEvidence(evidence, where, ctx, problems, { required = true } = {}) {
  if (evidence === null || evidence === undefined) {
    if (required) problems.push(`${where} is required`);
    return null;
  }
  if (!isObject(evidence)) {
    problems.push(`${where} must be an object or null`);
    return null;
  }
  const allowed = ['sourceId', 'locator', 'quote', 'contentHash'];
  if (!hasExactKeys(evidence, allowed)) problems.push(`${where} has unknown fields`);
  if (!isShortString(evidence.sourceId, LIMITS.sourceId)) {
    problems.push(`${where}.sourceId must be a short non-empty string`);
  } else if (ctx.hasInventory && !ctx.sourceById.has(evidence.sourceId)) {
    problems.push(`${where}.sourceId must reference the source inventory`);
  }
  if (!isShortString(evidence.locator, LIMITS.locator)) problems.push(`${where}.locator must be a short non-empty string`);
  if (!isShortString(evidence.quote, LIMITS.quote)) {
    problems.push(`${where}.quote must contain a short supporting passage`);
  } else if (ctx.sourceById.has(evidence.sourceId)) {
    const source = ctx.sourceById.get(evidence.sourceId);
    if (source && typeof source.text === 'string' && !normalizeText(source.text).includes(normalizeText(evidence.quote))) {
      problems.push(`${where}.quote is not present in the cited source`);
    }
  }
  if (evidence.contentHash !== undefined && !isHexHash(evidence.contentHash)) {
    problems.push(`${where}.contentHash must be 64 lowercase hex characters when present`);
  }
  return evidence;
}

function validatePriceEvidence(price, where, problems) {
  if (price.status !== 'known' && price.status !== 'from') return;
  if (!isObject(price.evidence)) {
    problems.push(`${where}.price.evidence is required for a ${price.status} price`);
    return;
  }
  if (!quoteContainsAmount(price.evidence.quote, price.amountMinorUnits)) {
    problems.push(`${where}.price.evidence.quote does not contain the claimed amount (price_evidence_missing)`);
  }
}


function validatePrice(price, where, ctx, problems) {
  if (!isObject(price)) {
    problems.push(`${where} must be an object`);
    return;
  }
  const allowed = ['status', 'amountMinorUnits', 'currency', 'text', 'isFrom', 'evidence'];
  if (!hasExactKeys(price, allowed)) problems.push(`${where} has unknown fields`);
  if (!PRICE_STATUSES.includes(price.status)) problems.push(`${where}.status is invalid`);
  const priced = price.status === 'known' || price.status === 'from';
  if (priced) {
    if (!isNonNegativeInteger(price.amountMinorUnits)) problems.push(`${where}.amountMinorUnits is required for a ${price.status} price`);
    if (price.currency !== 'EUR') problems.push(`${where}.currency must be EUR for a ${price.status} price`);
  } else {
    if (price.amountMinorUnits !== null) problems.push(`${where}.amountMinorUnits must be null unless the status is known or from`);
    if (price.currency !== null) problems.push(`${where}.currency must be null unless the status is known or from`);
  }
  if (price.isFrom !== (price.status === 'from')) problems.push(`${where}.isFrom must be true exactly for status "from"`);
  if (!isOptionalString(price.text, LIMITS.priceText)) problems.push(`${where}.text must be null or a bounded string`);
  validateEvidence(price.evidence, `${where}.evidence`, ctx, problems, { required: false });
  validatePriceEvidence(price, where, problems);
}

function validateVariant(variant, where, ctx, problems) {
  if (!isObject(variant)) {
    problems.push(`${where} must be an object`);
    return;
  }
  const allowed = ['id', 'label', 'kind', 'amountMinorUnits', 'currency', 'text', 'isSupplement', 'perPerson', 'evidence', 'origin'];
  if (!hasExactKeys(variant, allowed)) problems.push(`${where} has unknown fields`);
  if (!hasAllKeys(variant, allowed)) problems.push(`${where} must carry every contract field explicitly`);
  registerId(ctx, variant.id, where, problems);
  if (!isOptionalShortString(variant.label, LIMITS.label)) problems.push(`${where}.label must be null or a short string`);
  if (!VARIANT_KINDS.includes(variant.kind)) problems.push(`${where}.kind is invalid`);
  if (!isNonNegativeInteger(variant.amountMinorUnits)) problems.push(`${where}.amountMinorUnits must be a non-negative integer`);
  if (variant.currency !== 'EUR') problems.push(`${where}.currency must be EUR`);
  if (!isOptionalString(variant.text, LIMITS.priceText)) problems.push(`${where}.text must be null or a bounded string`);
  if (typeof variant.isSupplement !== 'boolean') problems.push(`${where}.isSupplement must be boolean`);
  if (typeof variant.perPerson !== 'boolean') problems.push(`${where}.perPerson must be boolean`);
  if (!ORIGINS.includes(variant.origin)) problems.push(`${where}.origin is invalid`);
  validateEvidence(variant.evidence, `${where}.evidence`, ctx, problems);
  if (isObject(variant.evidence) && isNonNegativeInteger(variant.amountMinorUnits) && !quoteContainsAmount(variant.evidence.quote, variant.amountMinorUnits)) {
    problems.push(`${where}.evidence.quote does not contain the claimed amount (price_evidence_missing)`);
  }
}

function validateAllergens(allergens, where, ctx, problems) {
  if (!isObject(allergens)) {
    problems.push(`${where} must be an object`);
    return;
  }
  const allowed = ['status', 'codes', 'sourceText', 'sourceTextStatus'];
  if (!hasExactKeys(allergens, allowed)) problems.push(`${where} has unknown fields`);
  if (!ALLERGEN_STATUSES.includes(allergens.status)) problems.push(`${where}.status is invalid`);
  if (!Array.isArray(allergens.codes) || allergens.codes.length > LIMITS.allergensPerItem) {
    problems.push(`${where}.codes must be a bounded array`);
  } else if (allergens.codes.some((code) => !isShortString(code, LIMITS.allergenCode))) {
    problems.push(`${where}.codes must contain short non-empty strings`);
  }
  if (!ALLERGEN_SOURCE_TEXT_STATUSES.includes(allergens.sourceTextStatus)) problems.push(`${where}.sourceTextStatus is invalid`);
  if (!isOptionalString(allergens.sourceText, LIMITS.sourceText)) problems.push(`${where}.sourceText must be null or a bounded string`);

  if (allergens.status === 'unknown') {
    if (Array.isArray(allergens.codes) && allergens.codes.length > 0) problems.push(`${where}: unknown allergens must not carry codes`);
    if (allergens.sourceText !== null) problems.push(`${where}: unknown allergens must not carry sourceText`);
    if (allergens.sourceTextStatus !== 'unknown') problems.push(`${where}: unknown allergens need sourceTextStatus "unknown"`);
    return;
  }
  if (!Array.isArray(allergens.codes) || allergens.codes.length === 0) problems.push(`${where}: explicit allergens need at least one code`);
  if (allergens.sourceTextStatus === 'recorded') {
    if (!isShortString(allergens.sourceText, LIMITS.sourceText)) problems.push(`${where}.sourceText is required when sourceTextStatus is "recorded"`);
    else if (ctx.hasInventory) {
      const inSource = [...ctx.sourceById.values()].some((source) => typeof source.text === 'string' && normalizeText(source.text).includes(normalizeText(allergens.sourceText)));
      if (!inSource) problems.push(`${where}.sourceText is not present in the cited sources`);
    }
  } else if (allergens.sourceText !== null) {
    problems.push(`${where}.sourceText must be null unless sourceTextStatus is "recorded"`);
  }
  if (allergens.sourceTextStatus === 'unknown') problems.push(`${where}: explicit allergens need "recorded" or "not_isolated" sourceTextStatus`);
}


function validateOrigins(origins, where, problems) {
  if (!isObject(origins)) {
    problems.push(`${where} must be an object`);
    return;
  }
  if (!hasExactKeys(origins, ORIGIN_FIELDS)) problems.push(`${where} has unknown fields`);
  if (!hasAllKeys(origins, ORIGIN_FIELDS)) problems.push(`${where} must record every field origin`);
  for (const field of ORIGIN_FIELDS) if (!ORIGINS.includes(origins[field])) problems.push(`${where}.${field} is invalid`);
}

function registerId(ctx, id, where, problems) {
  if (!isShortString(id, LIMITS.id)) {
    problems.push(`${where}.id must be a short non-empty string`);
    return;
  }
  if (ctx.ids.has(id)) {
    problems.push(`${where}.id "${id}" is not unique (already used at ${ctx.ids.get(id)})`);
    return;
  }
  ctx.ids.set(id, where);
}

function validateSupplementTarget(target, where, ctx, refs, item, problems) {
  if (!isObject(target)) {
    problems.push(`${where} must be an object`);
    return;
  }
  if (!SUPPLEMENT_TARGET_STATUSES.includes(target.status)) {
    problems.push(`${where}.status is invalid`);
    return;
  }
  if (target.status === 'resolved') {
    if (!hasExactKeys(target, ['status', 'itemId'])) problems.push(`${where} has unknown fields`);
    if (!isShortString(target.itemId, LIMITS.id)) problems.push(`${where}.itemId must be a short non-empty string`);
    else refs.supplements.push({ where, targetItemId: target.itemId, menuId: ctx.currentMenuId, itemId: item.id });
    return;
  }
  if (!hasExactKeys(target, ['status', 'label', 'context', 'limitation'])) problems.push(`${where} has unknown fields`);
  if (!isOptionalShortString(target.label, LIMITS.label)) problems.push(`${where}.label must be null or a short source label`);
  if (!isObject(target.context) || !hasExactKeys(target.context, ['menuId', 'categoryId'])) {
    problems.push(`${where}.context must name the containing menu and category`);
  } else {
    if (target.context.menuId !== ctx.currentMenuId) problems.push(`${where}.context.menuId must be the containing menu`);
    if (target.context.categoryId !== ctx.currentCategoryId) problems.push(`${where}.context.categoryId must be the containing category`);
  }
  if (!isShortString(target.limitation, LIMITS.limitation)) problems.push(`${where}.limitation must state why the target is unresolved`);
}


function validateItem(item, where, ctx, refs, problems) {
  if (!isObject(item)) {
    problems.push(`${where} must be an object`);
    return;
  }
  const allowed = ['id', 'kind', 'name', 'description', 'price', 'priceVariants', 'primaryPriceRef', 'supplementOf', 'choiceGroupRef', 'allergens', 'dietaryLabels', 'availability', 'evidence', 'origins'];
  if (!hasExactKeys(item, allowed)) problems.push(`${where} has unknown fields`);
  if (!hasAllKeys(item, allowed)) problems.push(`${where} must carry every contract field explicitly`);
  registerId(ctx, item.id, where, problems);
  if (!ITEM_KINDS.includes(item.kind)) problems.push(`${where}.kind is invalid`);
  if (!isShortString(item.name, LIMITS.name)) problems.push(`${where}.name must be a short non-empty string`);
  if (!isOptionalString(item.description, LIMITS.description)) problems.push(`${where}.description must be null or a bounded string`);
  validateOrigins(item.origins, `${where}.origins`, problems);

  validatePrice(item.price, `${where}.price`, ctx, problems);
  const status = isObject(item.price) ? item.price.status : null;

  if (!Array.isArray(item.priceVariants) || item.priceVariants.length > LIMITS.variantsPerItem) {
    problems.push(`${where}.priceVariants must be an array of at most ${LIMITS.variantsPerItem}`);
  } else {
    item.priceVariants.forEach((variant, v) => validateVariant(variant, `${where}.priceVariants[${v}]`, ctx, problems));
    if (item.priceVariants.length > 0 && status !== 'multiple_undecomposed') {
      problems.push(`${where}.priceVariants require price.status "multiple_undecomposed"`);
    }
    if (item.primaryPriceRef !== null) {
      const target = item.priceVariants.find((variant) => isObject(variant) && variant.id === item.primaryPriceRef);
      if (!isShortString(item.primaryPriceRef, LIMITS.id)) problems.push(`${where}.primaryPriceRef must be null or a short ID`);
      else if (!target) problems.push(`${where}.primaryPriceRef must reference one of this item's price variants`);
      else if (target.isSupplement === true) problems.push(`${where}.primaryPriceRef must never point at a supplement variant`);
    }
  }

  if (item.kind === 'supplement') {
    if (item.supplementOf === null) problems.push(`${where}: a supplement needs an explicit supplementOf relation`);
    else validateSupplementTarget(item.supplementOf, `${where}.supplementOf`, ctx, refs, item, problems);
  } else if (item.supplementOf !== null) {
    problems.push(`${where}.supplementOf must be null unless item.kind is "supplement"`);
  }

  if (item.choiceGroupRef !== null && !isShortString(item.choiceGroupRef, LIMITS.id)) {
    problems.push(`${where}.choiceGroupRef must be null or a short category ID`);
  } else if (item.choiceGroupRef !== null && item.kind === 'choice') {
    refs.choices.push({ where: `${where}.choiceGroupRef`, targetCategoryId: item.choiceGroupRef, menuId: ctx.currentMenuId });
  } else if (item.choiceGroupRef !== null) {
    problems.push(`${where}.choiceGroupRef must be null unless item.kind is "choice"`);
  }
  if (item.kind === 'choice' && item.choiceGroupRef === null) problems.push(`${where}: a choice needs a choiceGroupRef`);

  validateAllergens(item.allergens, `${where}.allergens`, ctx, problems);

  if (!Array.isArray(item.dietaryLabels) || item.dietaryLabels.length > LIMITS.dietaryLabelsPerItem) {
    problems.push(`${where}.dietaryLabels must be a bounded array`);
  } else if (item.dietaryLabels.some((label) => !isShortString(label, LIMITS.label))) {
    problems.push(`${where}.dietaryLabels must contain short non-empty strings`);
  }
  if (item.availability !== null && !isShortString(item.availability, LIMITS.label)) problems.push(`${where}.availability must be null or a short source text`);
  validateEvidence(item.evidence, `${where}.evidence`, ctx, problems);
}


function validatePath(path, where, problems) {
  if (!Array.isArray(path) || path.length === 0 || path.length > LIMITS.pathDepth || path.some((label) => !isShortString(label, LIMITS.category))) {
    problems.push(`${where} must be a non-empty bounded string array`);
  }
}

function validateCategoryHeader(category, where, ctx, problems, categoryMap) {
  if (!isObject(category)) {
    problems.push(`${where} must be an object`);
    return;
  }
  const allowed = ['id', 'name', 'path', 'sourcePath', 'kind', 'choice', 'uncertain', 'items'];
  if (!hasExactKeys(category, allowed)) problems.push(`${where} has unknown fields`);
  if (!hasAllKeys(category, allowed)) problems.push(`${where} must carry every contract field explicitly`);
  registerId(ctx, category.id, where, problems);
  if (!isShortString(category.name, LIMITS.category)) problems.push(`${where}.name must be a short non-empty string`);
  validatePath(category.path, `${where}.path`, problems);
  if (category.sourcePath !== null) validatePath(category.sourcePath, `${where}.sourcePath`, problems);
  if (!CATEGORY_KINDS.includes(category.kind)) problems.push(`${where}.kind is invalid`);
  if (typeof category.uncertain !== 'boolean') problems.push(`${where}.uncertain must be boolean`);
  if (!Array.isArray(category.items)) problems.push(`${where}.items must be an array`);
  if (category.kind === 'choice_group') {
    if (!isObject(category.choice)) {
      problems.push(`${where}.choice is required for a choice_group`);
    } else {
      if (!hasExactKeys(category.choice, ['min', 'max'])) problems.push(`${where}.choice has unknown fields`);
      if (!isNonNegativeInteger(category.choice.min) || !isNonNegativeInteger(category.choice.max)) problems.push(`${where}.choice.min/max must be non-negative integers`);
      else if (category.choice.min > category.choice.max) problems.push(`${where}.choice.min must not exceed max`);
    }
  } else if (category.choice !== null) {
    problems.push(`${where}.choice must be null unless kind is "choice_group"`);
  }
  if (isShortString(category.id, LIMITS.id) && !categoryMap.has(category.id)) categoryMap.set(category.id, category);
}

function validateMenu(menu, where, ctx, refs, problems) {
  if (!isObject(menu)) {
    problems.push(`${where} must be an object`);
    return null;
  }
  const allowed = ['id', 'title', 'sourceId', 'variant', 'categories'];
  if (!hasExactKeys(menu, allowed)) problems.push(`${where} has unknown fields`);
  if (!hasAllKeys(menu, allowed)) problems.push(`${where} must carry every contract field explicitly`);
  registerId(ctx, menu.id, where, problems);
  if (!isShortString(menu.title, LIMITS.title)) problems.push(`${where}.title must be a short non-empty string`);
  if (!isShortString(menu.sourceId, LIMITS.sourceId)) problems.push(`${where}.sourceId must be a short non-empty string`);
  else if (ctx.hasInventory && !ctx.sourceById.has(menu.sourceId)) problems.push(`${where}.sourceId must reference the source inventory`);

  const variant = menu.variant;
  if (!isObject(variant)) {
    problems.push(`${where}.variant must be an object`);
  } else {
    const variantAllowed = ['id', 'label', 'sourceLabel', 'locale', 'location', 'order'];
    if (!hasExactKeys(variant, variantAllowed)) problems.push(`${where}.variant has unknown fields`);
    if (!hasAllKeys(variant, variantAllowed)) problems.push(`${where}.variant must carry every contract field explicitly`);
    registerId(ctx, variant.id, `${where}.variant`, problems);
    if (!isOptionalShortString(variant.label, LIMITS.label)) problems.push(`${where}.variant.label must be null or a short string`);
    if (!isOptionalShortString(variant.sourceLabel, LIMITS.label)) problems.push(`${where}.variant.sourceLabel must be null or a short string`);
    if (!isOptionalShortString(variant.locale, LIMITS.label)) problems.push(`${where}.variant.locale must be null or a short string`);
    if (!isOptionalShortString(variant.location, LIMITS.label)) problems.push(`${where}.variant.location must be null or a short string`);
    if (variant.order !== null && !isNonNegativeInteger(variant.order)) problems.push(`${where}.variant.order must be null or a non-negative integer`);
  }

  if (!Array.isArray(menu.categories)) {
    problems.push(`${where}.categories must be an array`);
    return { id: menu.id, categoryMap: new Map(), itemMap: new Map(), itemCount: 0 };
  }
  if (menu.categories.length > LIMITS.categoriesPerMenu) problems.push(`${where} has more than ${LIMITS.categoriesPerMenu} categories`);
  const categoryMap = new Map();
  menu.categories.forEach((category, c) => validateCategoryHeader(category, `${where}.categories[${c}]`, ctx, problems, categoryMap));

  const itemMap = new Map();
  let itemCount = 0;
  ctx.currentMenuId = menu.id;
  menu.categories.forEach((category, c) => {
    if (!isObject(category) || !Array.isArray(category.items)) return;
    const catAt = `${where}.categories[${c}]`;
    if (category.items.length > LIMITS.itemsPerCategory) problems.push(`${catAt} has more than ${LIMITS.itemsPerCategory} items`);
    ctx.currentCategoryId = category.id;
    category.items.forEach((item, i) => {
      itemCount += 1;
      validateItem(item, `${catAt}.items[${i}]`, ctx, refs, problems);
      if (isObject(item) && isShortString(item.id, LIMITS.id) && !itemMap.has(item.id)) itemMap.set(item.id, item);
    });
  });
  return { id: menu.id, categoryMap, itemMap, itemCount };
}


function resolveReferences(menuRecords, refs, problems) {
  const menusById = new Map();
  for (const record of menuRecords) if (isShortString(record.id, LIMITS.id)) menusById.set(record.id, record);
  for (const ref of refs.supplements) {
    const menu = menusById.get(ref.menuId);
    if (!menu) {
      problems.push(`${ref.where}: the containing menu context is unknown`);
      continue;
    }
    const target = menu.itemMap.get(ref.targetItemId);
    if (!target) problems.push(`${ref.where} references a missing item "${ref.targetItemId}"`);
    else if (target.id === ref.itemId) problems.push(`${ref.where} cannot reference the supplement itself`);
    else if (target.kind === 'supplement') problems.push(`${ref.where} must reference a non-supplement item`);
  }
  for (const ref of refs.choices) {
    const menu = menusById.get(ref.menuId);
    const category = menu && menu.categoryMap.get(ref.targetCategoryId);
    if (!category) problems.push(`${ref.where} references a missing category "${ref.targetCategoryId}"`);
    else if (category.kind !== 'choice_group') problems.push(`${ref.where} must reference a choice_group category`);
  }
}

function validateRejected(rejected, ctx, problems) {
  if (rejected === undefined) return;
  if (!Array.isArray(rejected) || rejected.length > LIMITS.rejected) {
    problems.push('rejected must be a bounded array');
    return;
  }
  rejected.forEach((row, r) => {
    const where = `rejected[${r}]`;
    if (!isObject(row)) {
      problems.push(`${where} must be an object`);
      return;
    }
    if (!hasExactKeys(row, ['sourceId', 'locator', 'reason', 'text'])) problems.push(`${where} has unknown fields`);
    if (!isShortString(row.sourceId, LIMITS.sourceId)) problems.push(`${where}.sourceId must be a short non-empty string`);
    else if (ctx.hasInventory && !ctx.sourceById.has(row.sourceId)) problems.push(`${where}.sourceId must reference the source inventory`);
    if (!isShortString(row.locator, LIMITS.locator)) problems.push(`${where}.locator must be a short non-empty string`);
    if (!REJECTION_REASONS.includes(row.reason)) problems.push(`${where}.reason is invalid`);
    if (row.text !== undefined && !isShortString(row.text, LIMITS.rejectedText)) problems.push(`${where}.text must be a short non-empty string when present`);
  });
}


function validateCoverage(coverage, itemCount, ctx, problems) {
  if (!isObject(coverage)) {
    problems.push('coverage must be an object');
    return;
  }
  const allowed = ['status', 'sourcesRead', 'pagesRead', 'itemsExtracted', 'unreadSources', 'limitations'];
  if (!hasExactKeys(coverage, allowed)) problems.push('coverage has unknown fields');
  if (!hasAllKeys(coverage, allowed)) problems.push('coverage must carry every contract field explicitly');
  if (!COVERAGE_STATUSES.includes(coverage.status)) problems.push('coverage.status is invalid');
  for (const key of ['sourcesRead', 'pagesRead', 'itemsExtracted']) {
    if (!isNonNegativeInteger(coverage[key])) problems.push(`coverage.${key} must be a non-negative integer`);
  }
  if (coverage.itemsExtracted !== itemCount) problems.push('coverage.itemsExtracted must equal the number of extracted items');
  if (ctx.hasInventory && isNonNegativeInteger(coverage.sourcesRead) && coverage.sourcesRead > ctx.sourceById.size) {
    problems.push('coverage.sourcesRead exceeds the source inventory');
  }

  const unread = coverage.unreadSources;
  if (!Array.isArray(unread) || unread.length > LIMITS.unreadSources) {
    problems.push('coverage.unreadSources must be a bounded array');
  } else {
    unread.forEach((row, r) => {
      const where = `coverage.unreadSources[${r}]`;
      if (!isObject(row)) {
        problems.push(`${where} must be an object`);
        return;
      }
      if (!hasExactKeys(row, ['sourceId', 'locator', 'reason'])) problems.push(`${where} has unknown fields`);
      if (!isShortString(row.sourceId, LIMITS.sourceId)) problems.push(`${where}.sourceId must be a short non-empty string`);
      else if (ctx.hasInventory && !ctx.sourceById.has(row.sourceId)) problems.push(`${where}.sourceId must reference the source inventory`);
      if (!isShortString(row.locator, LIMITS.locator)) problems.push(`${where}.locator must be a short non-empty string`);
      if (!REJECTION_REASONS.includes(row.reason)) problems.push(`${where}.reason is invalid`);
    });
  }

  const limitations = coverage.limitations;
  if (!Array.isArray(limitations) || limitations.length > LIMITS.limitations || limitations.some((line) => !isShortString(line, LIMITS.limitation))) {
    problems.push('coverage.limitations must be a bounded string array');
  }
  const unreadCount = Array.isArray(unread) ? unread.length : 0;
  const limitationCount = Array.isArray(limitations) ? limitations.length : 0;
  if (coverage.status === 'complete' && unreadCount > 0) problems.push('complete coverage cannot contain unread sources');
  if (coverage.status === 'complete' && limitationCount > 0) problems.push('complete coverage cannot contain limitations');
  if (coverage.status === 'complete' && ctx.hasInventory && coverage.sourcesRead !== ctx.sourceById.size) problems.push('complete coverage must read every source');
  if (coverage.status === 'partial' && unreadCount === 0 && limitationCount === 0) problems.push('partial coverage needs an unread source or limitation');
  if (coverage.status === 'no_items' && itemCount !== 0) problems.push('no_items coverage cannot contain extracted items');
  if (coverage.status !== 'no_items' && itemCount === 0) problems.push('coverage status requires at least one extracted item');
}

/**
 * Strict, independent validation of one canonical v2 product. `sources` is the
 * backend's own inventory; it is optional here (pure tests and the mapper pass
 * it), but when present every source reference must exist and every quote must
 * occur in its source text. Returns an array of concrete problems; an empty
 * array is the only success.
 */
function validateMenuProductV2(product, sources) {
  const problems = [];
  if (!isObject(product)) return ['product must be an object'];
  const forbidden = findForbiddenKey(product);
  if (forbidden) problems.push(`forbidden trust key: ${forbidden}`);
  if (product.schemaVersion !== MENU_PRODUCT_SCHEMA_VERSION) {
    problems.push(`unsupported_schema_version: expected ${MENU_PRODUCT_SCHEMA_VERSION}`);
    return problems;
  }
  if (!hasExactKeys(product, ['schemaVersion', 'menus', 'rejected', 'coverage'])) problems.push('unknown top-level field');
  if (!Array.isArray(product.menus)) {
    problems.push('menus must be an array');
    return problems;
  }
  if (product.menus.length > LIMITS.menus) problems.push(`more than ${LIMITS.menus} menus`);

  const ctx = {
    sourceById: sourceIndex(sources),
    hasInventory: Array.isArray(sources),
    ids: new Map(),
    currentMenuId: null,
    currentCategoryId: null,
  };
  const refs = { supplements: [], choices: [] };
  const menuRecords = [];
  let itemCount = 0;
  product.menus.forEach((menu, m) => {
    const record = validateMenu(menu, `menus[${m}]`, ctx, refs, problems);
    if (record) {
      menuRecords.push(record);
      itemCount += record.itemCount;
    }
  });
  if (itemCount > LIMITS.itemsTotal) problems.push(`more than ${LIMITS.itemsTotal} items`);
  resolveReferences(menuRecords, refs, problems);
  validateRejected(product.rejected, ctx, problems);
  validateCoverage(product.coverage, itemCount, ctx, problems);
  return problems;
}


/**
 * Classifies a stored product envelope without interpreting it:
 *   'v2'      the exact supported v2 version;
 *   'v1'      a legacy record (no version, or the v1 extraction version);
 *   'unknown' any other version — never treated as v1;
 *   'invalid' not an object.
 */
function detectProductSchema(value) {
  if (!isObject(value)) return 'invalid';
  if (value.schemaVersion === MENU_PRODUCT_SCHEMA_VERSION) return 'v2';
  if (value.schemaVersion === undefined || value.schemaVersion === LEGACY_OUTPUT_SCHEMA_VERSION) return 'v1';
  return 'unknown';
}

/**
 * Fail-closed reader for a stored receipt/concept envelope. It never rewrites
 * v2 into v1 and never drops a row it cannot read: an unknown or invalid
 * version is returned with the raw value preserved and every write/export/
 * publish action blocked. A valid v1 record is returned as legacy and is still
 * owned by the existing v1 readers.
 */
function readProductRecord(record, sources) {
  const detected = detectProductSchema(record);
  if (detected === 'invalid') {
    return {
      status: 'invalid',
      ok: false,
      schemaVersion: null,
      problems: ['record must be an object'],
      blockedActions: [...READER_BLOCKED_ACTIONS],
      preservedRaw: record,
    };
  }
  if (detected === 'v2') {
    const problems = validateMenuProductV2(record, sources);
    if (problems.length > 0) {
      return {
        status: 'invalid',
        ok: false,
        schemaVersion: record.schemaVersion,
        problems,
        blockedActions: [...READER_BLOCKED_ACTIONS],
        preservedRaw: record,
      };
    }
    return { status: 'v2', ok: true, schemaVersion: record.schemaVersion, value: record, problems: [], blockedActions: [] };
  }
  if (detected === 'v1') {
    const forbidden = findForbiddenKey(record);
    if (forbidden) {
      return {
        status: 'invalid',
        ok: false,
        schemaVersion: record.schemaVersion === undefined ? null : record.schemaVersion,
        problems: [`forbidden trust key: ${forbidden}`],
        blockedActions: [...READER_BLOCKED_ACTIONS],
        preservedRaw: record,
      };
    }
    return { status: 'v1', ok: true, schemaVersion: record.schemaVersion === undefined ? null : record.schemaVersion, value: record, problems: [], blockedActions: [] };
  }
  return {
    status: 'unsupported_schema_version',
    ok: false,
    schemaVersion: record.schemaVersion,
    problems: [`unsupported_schema_version: ${String(record.schemaVersion)} is not a supported product version`],
    blockedActions: [...READER_BLOCKED_ACTIONS],
    preservedRaw: record,
  };
}

module.exports = {
  MENU_PRODUCT_SCHEMA_VERSION,
  LEGACY_OUTPUT_SCHEMA_VERSION,
  CATEGORY_KINDS,
  ITEM_KINDS,
  PRICE_STATUSES,
  VARIANT_KINDS,
  ALLERGEN_STATUSES,
  ALLERGEN_SOURCE_TEXT_STATUSES,
  ORIGINS,
  ORIGIN_FIELDS,
  COVERAGE_STATUSES,
  SUPPLEMENT_TARGET_STATUSES,
  REJECTION_REASONS,
  FORBIDDEN_TRUST_KEYS,
  READER_BLOCKED_ACTIONS,
  LIMITS,
  findForbiddenKey,
  amountRenderings,
  quoteContainsAmount,
  validateMenuProductV2,
  detectProductSchema,
  readProductRecord,
};

