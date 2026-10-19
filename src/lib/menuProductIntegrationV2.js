'use strict';

// Read-only bridge between the versioned `menu-extraction-product/v2`
// contract and the existing receipt, concept, review and export paths.
//
// This module is pure and browser-safe: no fetch, no database, no provider,
// no filesystem and no write. It answers one question for every existing
// reader: is this stored value legacy v1 concept content, or a versioned
// envelope that the current v1 readers may not interpret?
//
// Rules enforced here:
//   - a v2 envelope is validated with the same `readProductRecord` the pure
//     schema layer uses, then shown through ONE sanitized, bounded view;
//   - an unknown or missing version is never a v1 default: it is reported as
//     `unsupported_schema_version` and every save/confirm/export/publish
//     action is blocked;
//   - structural validity is NOT source verification. Without a registered,
//     checkable source text/hash context a v2 row stays `unverified`, so it
//     is never labelled proven, saveable or publishable in this round;
//   - an older v1 projection (`candidate_summary.menus`) next to a v2
//     envelope is reported as legacy and is never treated as authoritative;
//   - every displayed string is sanitized (control characters removed,
//     bounded length). Source quotes remain data and are rendered as text;
//   - no confidence/reviewReady/approved status is derived from an envelope.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// src/lib/.

const {
  READER_BLOCKED_ACTIONS,
  readProductRecord,
} = require('./menuProductSchemaV2');

const RECEIPT_PRODUCT_KEY = 'menuExtractionV2';
const CONCEPT_SCHEMA_KEY = 'schemaVersion';

const PRODUCT_READ_ONLY_MESSAGE = 'Deze menukaart gebruikt menu-extractieproduct v2. Weergeven is alleen-lezen: opslaan, bevestigen, goedkeuren en exporteren zijn in deze ronde geblokkeerd.';
const RECEIPT_AUTHORITATIVE_MESSAGE = 'De oorspronkelijke analyse bevat een v2-envelope. Een oudere v1-projectie is daarnaast niet gezaghebbend; opslaan, goedkeuren en exporteren zijn geblokkeerd.';
const SOURCE_UNVERIFIED_MESSAGE = 'De brontekst en hash zijn niet als controleerbare broncontext geregistreerd. Een structureel geldige kaart is daarom niet bronbevestigd.';
const INVALID_MESSAGE = 'Deze opslag bevat geen geldige, versiegebonden menukaart. Er wordt niets opgeslagen, goedgekeurd of geëxporteerd.';
const UNSUPPORTED_MESSAGE = 'Deze menukaart gebruikt een onbekende of niet-ondersteunde schemaversie. Weergeven kan alleen als beperking; schrijven is geblokkeerd.';

const MAX_TEXT = {
  name: 200,
  description: 1000,
  title: 160,
  category: 160,
  priceText: 160,
  label: 80,
  locator: 200,
  quote: 500,
  limitation: 300,
  reason: 80,
  id: 80,
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

/** Removes control characters and clamps to the contract's own text bound. */
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const stripped = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return null;
  return stripped.slice(0, max);
}

function cleanList(value, max, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanText(entry, max))
    .filter(Boolean)
    .slice(0, limit);
}

function formatAmount(amountMinorUnits, currency) {
  if (!Number.isInteger(amountMinorUnits) || amountMinorUnits < 0 || currency !== 'EUR') return null;
  return `€ ${(amountMinorUnits / 100).toFixed(2).replace('.', ',')}`;
}

function evidenceView(evidence) {
  if (!isObject(evidence)) return null;
  const contentHash = cleanText(evidence.contentHash, 64);
  return {
    sourceId: cleanText(evidence.sourceId, MAX_TEXT.id),
    locator: cleanText(evidence.locator, MAX_TEXT.locator),
    quote: cleanText(evidence.quote, MAX_TEXT.quote),
    ...(contentHash ? { contentHash } : {}),
  };
}

function priceView(price) {
  if (!isObject(price)) {
    return { status: 'unknown', amountMinorUnits: null, currency: null, display: null, text: null, isFrom: false, evidence: null };
  }
  return {
    status: typeof price.status === 'string' ? price.status : 'unknown',
    amountMinorUnits: Number.isInteger(price.amountMinorUnits) ? price.amountMinorUnits : null,
    currency: typeof price.currency === 'string' ? price.currency : null,
    display: formatAmount(price.amountMinorUnits, price.currency),
    text: cleanText(price.text, MAX_TEXT.priceText),
    isFrom: price.isFrom === true,
    evidence: evidenceView(price.evidence),
  };
}

function variantView(variant, index) {
  const source = isObject(variant) ? variant : {};
  return {
    id: cleanText(source.id, MAX_TEXT.id) || `variant-${index + 1}`,
    label: cleanText(source.label, MAX_TEXT.label),
    kind: typeof source.kind === 'string' ? source.kind : 'other',
    amountMinorUnits: Number.isInteger(source.amountMinorUnits) ? source.amountMinorUnits : null,
    currency: typeof source.currency === 'string' ? source.currency : null,
    display: formatAmount(source.amountMinorUnits, source.currency),
    text: cleanText(source.text, MAX_TEXT.priceText),
    isSupplement: source.isSupplement === true,
    perPerson: source.perPerson === true,
    evidence: evidenceView(source.evidence),
  };
}

function supplementView(supplementOf) {
  if (!isObject(supplementOf)) return null;
  if (supplementOf.status === 'resolved') {
    return { status: 'resolved', itemId: cleanText(supplementOf.itemId, MAX_TEXT.id), label: null, context: null, limitation: null };
  }
  if (supplementOf.status !== 'unresolved') return null;
  const context = isObject(supplementOf.context) ? supplementOf.context : {};
  return {
    status: 'unresolved',
    itemId: null,
    label: cleanText(supplementOf.label, MAX_TEXT.label),
    context: {
      menuId: cleanText(context.menuId, MAX_TEXT.id),
      categoryId: cleanText(context.categoryId, MAX_TEXT.id),
    },
    limitation: cleanText(supplementOf.limitation, MAX_TEXT.limitation),
  };
}

function allergensView(allergens) {
  const source = isObject(allergens) ? allergens : {};
  if (source.status !== 'explicit') {
    return { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' };
  }
  return {
    status: 'explicit',
    codes: cleanList(source.codes, MAX_TEXT.label, 20),
    sourceText: cleanText(source.sourceText, MAX_TEXT.quote),
    sourceTextStatus: typeof source.sourceTextStatus === 'string' ? source.sourceTextStatus : 'unknown',
  };
}

function itemView(item, index, notes) {
  const source = isObject(item) ? item : {};
  const name = cleanText(source.name, MAX_TEXT.name);
  const priceVariants = (Array.isArray(source.priceVariants) ? source.priceVariants : []).slice(0, 10);
  const supplementOf = supplementView(source.supplementOf);
  if (supplementOf && supplementOf.status === 'unresolved') {
    notes.push({
      code: 'supplement_target_unresolved',
      name,
      label: `Supplement${name ? ` "${name}"` : ''}: target niet vastgelegd; context blijft ${supplementOf.context.menuId || '?'} / ${supplementOf.context.categoryId || '?'}.`,
    });
  }
  if (priceVariants.length > 0 && source.primaryPriceRef === null) {
    notes.push({
      code: 'primary_price_not_chosen',
      name,
      label: 'Meerdere prijzen; er is geen hoofdprijs gekozen en dus ook geen hoofbedrag getoond.',
    });
  }
  return {
    id: cleanText(source.id, MAX_TEXT.id) || `item-${index + 1}`,
    kind: typeof source.kind === 'string' ? source.kind : 'unknown',
    name,
    description: cleanText(source.description, MAX_TEXT.description),
    price: priceView(source.price),
    priceVariants: priceVariants.map(variantView),
    primaryPriceRef: cleanText(source.primaryPriceRef, MAX_TEXT.id),
    supplementOf,
    choiceGroupRef: cleanText(source.choiceGroupRef, MAX_TEXT.id),
    allergens: allergensView(source.allergens),
    dietaryLabels: cleanList(source.dietaryLabels, MAX_TEXT.label, 10),
    availability: cleanText(source.availability, MAX_TEXT.label),
    evidence: evidenceView(source.evidence),
  };
}

function categoryView(category, index, notes) {
  const source = isObject(category) ? category : {};
  const items = (Array.isArray(source.items) ? source.items : []).map((item, i) => itemView(item, i, notes));
  return {
    id: cleanText(source.id, MAX_TEXT.id) || `cat-${index + 1}`,
    name: cleanText(source.name, MAX_TEXT.category),
    path: cleanList(source.path, MAX_TEXT.category, 8),
    sourcePath: cleanList(source.sourcePath, MAX_TEXT.category, 8),
    kind: typeof source.kind === 'string' ? source.kind : 'section',
    choice: isObject(source.choice)
      ? {
          count: Number.isInteger(source.choice.count) ? source.choice.count : null,
          min: Number.isInteger(source.choice.min) ? source.choice.min : null,
          max: Number.isInteger(source.choice.max) ? source.choice.max : null,
        }
      : null,
    uncertain: source.uncertain === true,
    items,
  };
}

function menuView(menu, index, notes) {
  const source = isObject(menu) ? menu : {};
  const variant = isObject(source.variant) ? source.variant : {};
  return {
    id: cleanText(source.id, MAX_TEXT.id) || `menu-${index + 1}`,
    title: cleanText(source.title, MAX_TEXT.title),
    sourceId: cleanText(source.sourceId, MAX_TEXT.id),
    variant: {
      id: cleanText(variant.id, MAX_TEXT.id),
      label: cleanText(variant.label, MAX_TEXT.title),
      sourceLabel: cleanText(variant.sourceLabel, MAX_TEXT.title),
      locale: cleanText(variant.locale, 20),
      location: cleanText(variant.location, MAX_TEXT.title),
      order: Number.isInteger(variant.order) ? variant.order : null,
    },
    categories: (Array.isArray(source.categories) ? source.categories : []).map((category, c) => categoryView(category, c, notes)),
  };
}

function coverageView(coverage) {
  const source = isObject(coverage) ? coverage : {};
  return {
    status: typeof source.status === 'string' ? source.status : 'partial',
    sourcesRead: Number.isInteger(source.sourcesRead) ? source.sourcesRead : 0,
    pagesRead: Number.isInteger(source.pagesRead) ? source.pagesRead : 0,
    itemsExtracted: Number.isInteger(source.itemsExtracted) ? source.itemsExtracted : 0,
    unreadSources: (Array.isArray(source.unreadSources) ? source.unreadSources : []).slice(0, 100).map((row) => ({
      sourceId: cleanText(row && row.sourceId, MAX_TEXT.id),
      locator: cleanText(row && row.locator, MAX_TEXT.locator),
      reason: cleanText(row && row.reason, MAX_TEXT.reason),
    })),
    limitations: cleanList(source.limitations, MAX_TEXT.limitation, 50),
  };
}

function rejectedView(rejected) {
  return (Array.isArray(rejected) ? rejected : []).slice(0, 200).map((row) => ({
    sourceId: cleanText(row && row.sourceId, MAX_TEXT.id),
    locator: cleanText(row && row.locator, MAX_TEXT.locator),
    reason: cleanText(row && row.reason, MAX_TEXT.reason) || 'other',
    text: cleanText(row && row.text, 300),
  }));
}

/**
 * One sanitized, bounded, read-only view of a validated v2 product. It always
 * carries the two round-level blockers: v2 writes are off and the source is
 * not verified without a registered source/hash context.
 */
function buildProductReviewView(product) {
  const notes = [];
  const seenNotes = new Set();
  const menus = (Array.isArray(product.menus) ? product.menus : []).map((menu, m) => menuView(menu, m, notes));
  const coverage = coverageView(product.coverage);
  let categoryCount = 0;
  let itemCount = 0;
  let priceVariantCount = 0;
  let supplementCount = 0;
  for (const menu of menus) {
    categoryCount += menu.categories.length;
    for (const category of menu.categories) {
      itemCount += category.items.length;
      for (const item of category.items) {
        priceVariantCount += item.priceVariants.length;
        if (item.supplementOf) supplementCount += 1;
      }
    }
  }

  const blockers = [
    { code: 'product_v2_read_only', label: PRODUCT_READ_ONLY_MESSAGE },
    { code: 'source_not_verified', label: SOURCE_UNVERIFIED_MESSAGE },
  ];
  if (coverage.status === 'no_items') {
    blockers.push({ code: 'coverage_no_items', label: 'De bron bevat volgens deze uitvoer nul items. Dat is geen geslaagde extractie.' });
  } else if (coverage.status === 'partial') {
    blockers.push({ code: 'coverage_partial', label: 'De dekking is gedeeltelijk; niet-gelezen bronnen en beperkingen staan hieronder.' });
  }
  if (itemCount === 0) {
    blockers.push({ code: 'empty_product', label: 'Een lege kaart wordt nooit als volledige of geslaagde import getoond.' });
  }

  const uniqueNotes = [];
  for (const note of notes) {
    const key = `${note.code}|${note.name || ''}|${note.label}`;
    if (seenNotes.has(key)) continue;
    seenNotes.add(key);
    uniqueNotes.push(note);
    if (uniqueNotes.length >= 100) break;
  }

  return {
    schemaVersion: product.schemaVersion,
    sourceVerification: 'unverified',
    readOnly: true,
    blockedActions: [...READER_BLOCKED_ACTIONS],
    counts: { menus: menus.length, categories: categoryCount, items: itemCount, priceVariants: priceVariantCount, supplements: supplementCount },
    blockers,
    notes: uniqueNotes,
    menus,
    rejected: rejectedView(product.rejected),
    coverage,
  };
}

function readVersionedEnvelope(value) {
  const read = readProductRecord(value);
  if (read.status === 'v2') {
    return {
      kind: 'v2',
      schemaVersion: read.schemaVersion,
      reason: 'product_v2_read_only',
      problems: [],
      blockedActions: [...READER_BLOCKED_ACTIONS],
      product: read.value,
      view: buildProductReviewView(read.value),
    };
  }
  if (read.status === 'unsupported_schema_version') {
    return {
      kind: 'unsupported',
      schemaVersion: read.schemaVersion === undefined ? null : read.schemaVersion,
      reason: 'unsupported_schema_version',
      problems: read.problems,
      blockedActions: [...READER_BLOCKED_ACTIONS],
      product: null,
      view: null,
    };
  }
  if (read.status === 'v1') {
    // A versioned key without the v2 version is not legacy concept content:
    // the existing v1 readers must not silently interpret it.
    return {
      kind: 'unsupported',
      schemaVersion: read.schemaVersion,
      reason: 'unsupported_schema_version',
      problems: ['unsupported_schema_version: a versioned envelope must use menu-extraction-product/v2'],
      blockedActions: [...READER_BLOCKED_ACTIONS],
      product: null,
      view: null,
    };
  }
  return {
    kind: 'invalid',
    schemaVersion: read.schemaVersion === undefined ? null : read.schemaVersion,
    reason: 'invalid_product_version',
    problems: read.problems,
    blockedActions: [...READER_BLOCKED_ACTIONS],
    product: null,
    view: null,
  };
}

/**
 * Reads a receipt's bounded candidate summary. A v2 envelope lives under
 * `menuExtractionV2`; the legacy `menus` key may still be present and is then
 * explicitly reported as a non-authoritative projection. A missing key, or a
 * PostgREST `null` for a missing JSON path, is legacy v1.
 */
function readReceiptProduct(candidateSummary) {
  if (candidateSummary === undefined || candidateSummary === null) {
    return { kind: 'v1', schemaVersion: null, legacyMenusPresent: false, view: null, reason: null, problems: [], blockedActions: [] };
  }
  if (!isObject(candidateSummary)) {
    return {
      kind: 'invalid',
      schemaVersion: null,
      legacyMenusPresent: false,
      reason: 'receipt_candidate_summary_invalid',
      problems: ['receipt candidate_summary must be an object'],
      blockedActions: [...READER_BLOCKED_ACTIONS],
      view: null,
    };
  }
  const legacyMenusPresent = Array.isArray(candidateSummary.menus);
  if (!hasOwn(candidateSummary, RECEIPT_PRODUCT_KEY) || candidateSummary[RECEIPT_PRODUCT_KEY] === null || candidateSummary[RECEIPT_PRODUCT_KEY] === undefined) {
    return { kind: 'v1', schemaVersion: null, legacyMenusPresent, view: null, reason: null, problems: [], blockedActions: [] };
  }
  return { ...readVersionedEnvelope(candidateSummary[RECEIPT_PRODUCT_KEY]), legacyMenusPresent };
}

/**
 * Reads the bounded projection selected by existing Supabase queries:
 * `menus:candidate_summary->menus, product:candidate_summary->menuExtractionV2`.
 */
function readReceiptProjection(receipt) {
  if (!isObject(receipt)) return readReceiptProduct(null);
  if (hasOwn(receipt, RECEIPT_PRODUCT_KEY)) return readReceiptProduct(receipt);
  const summary = { menus: receipt.menus };
  if (receipt.product !== null && receipt.product !== undefined) summary[RECEIPT_PRODUCT_KEY] = receipt.product;
  return readReceiptProduct(summary);
}

/**
 * Reads stored concept content. Legacy v1 concept content has no
 * `schemaVersion`; any versioned value is fail-closed and returns a view or a
 * concrete problem list.
 */
function readConceptProduct(capturedContent) {
  if (!isObject(capturedContent)) {
    return {
      kind: 'invalid',
      schemaVersion: null,
      reason: 'invalid_concept_content',
      problems: ['concept content must be an object'],
      blockedActions: [...READER_BLOCKED_ACTIONS],
      view: null,
    };
  }
  if (!hasOwn(capturedContent, CONCEPT_SCHEMA_KEY)) {
    return { kind: 'v1', schemaVersion: null, reason: null, problems: [], blockedActions: [], view: null };
  }
  return readVersionedEnvelope(capturedContent);
}

/**
 * The generic snapshot write path accepts only legacy v1 concept content. A
 * versioned envelope (or a v2-shaped `menus` array without a version) is
 * refused before any request validation can pass it to a hash or insert.
 */
function isUnsupportedConceptEnvelope(value) {
  if (!isObject(value)) return false;
  if (hasOwn(value, CONCEPT_SCHEMA_KEY)) return true;
  return Array.isArray(value.menus) && !Array.isArray(value.categories);
}

class UnsupportedProductSchemaError extends Error {
  constructor(message, productInfo) {
    super(message);
    this.name = 'UnsupportedProductSchemaError';
    this.code = 'unsupported_product_schema';
    this.productInfo = productInfo || null;
  }
}

/** Guard for the existing v1 concept reader; never flattens or guesses. */
function assertLegacyConceptContent(value) {
  if (!isUnsupportedConceptEnvelope(value)) return value;
  const info = hasOwn(value, CONCEPT_SCHEMA_KEY)
    ? readConceptProduct(value)
    : {
        kind: 'invalid',
        schemaVersion: null,
        reason: 'unsupported_schema_version',
        problems: ['a menu array without a schemaVersion is not legacy v1 concept content'],
        blockedActions: [...READER_BLOCKED_ACTIONS],
        view: null,
      };
  throw new UnsupportedProductSchemaError(UNSUPPORTED_MESSAGE, info);
}

/** A bounded summary for the existing MenuControl (counts + attention). */
function summarizeProductMenu(view) {
  if (!view) return null;
  return {
    itemCount: view.counts.items,
    categoryCount: view.counts.categories,
    categories: [],
    title: view.menus.length === 1 ? view.menus[0].title : null,
    variantLabels: view.menus.map((menu) => menu.variant.label).filter(Boolean),
    priceVariantCount: view.counts.priceVariants,
    supplementCount: view.counts.supplements,
    attention: view.notes.slice(0, 50).map((note, index) => ({
      id: `product-note-${index + 1}`,
      name: note.name || 'Kaart',
      reason: note.label,
    })),
  };
}

function refusalMessage(reason) {
  if (reason === 'receipt_product_v2_authoritative') return RECEIPT_AUTHORITATIVE_MESSAGE;
  if (reason === 'product_v2_read_only') return PRODUCT_READ_ONLY_MESSAGE;
  if (reason === 'unsupported_schema_version') return UNSUPPORTED_MESSAGE;
  return INVALID_MESSAGE;
}

/**
 * The single refusal shape for every existing write/approve/export ingress.
 * It returns before the caller performs a hash, claim, update, RPC or GitHub
 * request; the raw row is never rewritten and no v1 fallback is offered.
 */
function productActionRefusal(action, info, options = {}) {
  const reason = options.reason || (info && info.reason) || 'product_v2_read_only';
  const schemaVersion = info && info.schemaVersion !== undefined ? info.schemaVersion : null;
  const problems = Array.isArray(info && info.problems) ? [...info.problems] : [];
  return {
    status: 409,
    body: {
      error: options.message || refusalMessage(reason),
      reason,
      action: action || null,
      schemaVersion,
      problems,
      blockedActions: [...READER_BLOCKED_ACTIONS],
    },
  };
}

module.exports = {
  RECEIPT_PRODUCT_KEY,
  PRODUCT_READ_ONLY_MESSAGE,
  RECEIPT_AUTHORITATIVE_MESSAGE,
  SOURCE_UNVERIFIED_MESSAGE,
  INVALID_MESSAGE,
  UNSUPPORTED_MESSAGE,
  UnsupportedProductSchemaError,
  cleanText,
  formatAmount,
  buildProductReviewView,
  readReceiptProduct,
  readReceiptProjection,
  readConceptProduct,
  isUnsupportedConceptEnvelope,
  assertLegacyConceptContent,
  summarizeProductMenu,
  productActionRefusal,
};





