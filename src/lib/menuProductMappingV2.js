'use strict';

// Pure bridge between the validated `menu-extraction-output/v1` result and the
// versioned `menu-extraction-product/v2` envelope, plus the fail-closed
// projections back to v1 and towards the current export shape.
//
// No network, no database, no provider, no filesystem and no product route:
// this round proves the mapping and its guards only. A projection that would
// lose a name, price, path, order, relation or evidence line refuses with
// `unsupported_v1_projection` instead of flattening; it never picks the lowest
// or first price and never invents a price amount, label, supplement target or
// source quote.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// src/lib/.

const { validateStructuredOutput } = require('./menuExtractionSchema');
const {
  MENU_PRODUCT_SCHEMA_VERSION,
  LEGACY_OUTPUT_SCHEMA_VERSION,
  validateMenuProductV2,
  quoteContainsAmount,
} = require('./menuProductSchemaV2');

const SUPPLEMENT_UNRESOLVED_LIMITATION = 'v1 supplementOf is a source label; no explicit item relation was recorded';

function refusal(reason, problems, preservedInput, blockers = []) {
  return { ok: false, reason, problems, blockers, preservedInput };
}

function copyEvidence(evidence) {
  return { sourceId: evidence.sourceId, locator: evidence.locator, quote: evidence.quote };
}

function sameEvidence(a, b) {
  return Boolean(a && b) && a.sourceId === b.sourceId && a.locator === b.locator && a.quote === b.quote;
}

function hasContentHash(evidence) {
  return Boolean(evidence && typeof evidence === 'object' && Object.prototype.hasOwnProperty.call(evidence, 'contentHash'));
}

/** The closed variant-kind vocabulary derived from the source label only. */
function variantKindFromLabel(label) {
  if (typeof label !== 'string' || !label.trim()) return 'other';
  const normalized = label.trim().toLowerCase();
  if (normalized === 'glas' || normalized === 'glass') return 'glass';
  if (normalized === 'fles' || normalized === 'bottle') return 'bottle';
  if (normalized === 'portie' || normalized === 'portion') return 'portion';
  if (['persoon', 'person', 'p.p.', 'per persoon', 'per person'].includes(normalized)) return 'person';
  return 'other';
}

function unknownAllergens() {
  return { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' };
}

function allergensFromV1(allergens) {
  if (!allergens) return unknownAllergens();
  if (allergens.status === 'unknown') return unknownAllergens();
  return {
    status: 'explicit',
    codes: [...allergens.values],
    sourceText: null,
    // v1 records explicit allergen values but never the isolated passage; the
    // row-level evidence remains authoritative. This is stated, not guessed.
    sourceTextStatus: 'not_isolated',
  };
}

function originsFor(item) {
  const description = typeof item.description === 'string' && item.description.trim() ? 'extracted' : 'unknown';
  const availability = typeof item.availability === 'string' && item.availability.trim() ? 'extracted' : 'unknown';
  return {
    name: 'extracted',
    description,
    price: 'extracted',
    allergens: item.allergens && item.allergens.status !== 'unknown' ? 'extracted' : 'unknown',
    supplementOf: item.supplementOf ? 'extracted' : 'unknown',
    availability,
    kind: item.supplementOf ? 'extracted' : 'unknown',
  };
}

function mapItem(item, context, blockers) {
  const itemPath = context.path;
  const status = item.isFrom === true ? 'from' : item.priceStatus;
  if (item.isFrom === true && item.priceStatus !== 'known') {
    blockers.push({ code: 'unsupported_v1_flag_combination', path: `${itemPath}.isFrom`, detail: 'isFrom is only supported on a known price' });
  }
  const evidence = copyEvidence(item.evidence);
  let priceEvidence = null;
  if (status === 'known' || status === 'from') {
    if (!quoteContainsAmount(evidence.quote, item.amountMinorUnits)) {
      blockers.push({ code: 'price_evidence_missing', path: `${itemPath}.price.evidence`, detail: 'the item quote does not contain the claimed amount' });
    } else {
      priceEvidence = evidence;
    }
  }
  const variants = (Array.isArray(item.priceVariants) ? item.priceVariants : []).map((variant, v) => {
    const variantPath = `${itemPath}.priceVariants[${v}]`;
    if (!quoteContainsAmount(evidence.quote, variant.amountMinorUnits)) {
      blockers.push({ code: 'price_evidence_missing', path: `${variantPath}.evidence`, detail: 'the item quote does not contain the claimed variant amount' });
    }
    return {
      id: `pv-${++context.counters.priceVariant}`,
      label: variant.label === undefined ? null : variant.label,
      kind: variantKindFromLabel(variant.label),
      amountMinorUnits: variant.amountMinorUnits,
      currency: variant.currency,
      text: null,
      isSupplement: false,
      perPerson: false,
      evidence,
      origin: 'extracted',
    };
  });
  if (variants.length > 0) context.notes.add('variant_evidence_derived_from_the_item_quote');
  if (!item.supplementOf) context.notes.add('v1_has_no_item_kind: ordinary lines map to kind "unknown"');

  const supplementOf = item.supplementOf
    ? {
        status: 'unresolved',
        label: item.supplementOf,
        context: { menuId: context.menuId, categoryId: context.categoryId },
        limitation: SUPPLEMENT_UNRESOLVED_LIMITATION,
      }
    : null;
  if (supplementOf) context.notes.add('supplement_target_kept_unresolved_with_menu_context');
  context.notes.add('v1_has_no_primary_price: primaryPriceRef stays null');

  return {
    id: `item-${++context.counters.item}`,
    kind: item.supplementOf ? 'supplement' : 'unknown',
    name: item.name,
    description: item.description === undefined ? null : item.description,
    price: {
      status,
      amountMinorUnits: status === 'known' || status === 'from' ? item.amountMinorUnits : null,
      currency: status === 'known' || status === 'from' ? item.currency : null,
      text: typeof item.priceText === 'string' ? item.priceText : null,
      isFrom: status === 'from',
      evidence: priceEvidence,
    },
    priceVariants: variants,
    primaryPriceRef: null,
    supplementOf,
    choiceGroupRef: null,
    allergens: allergensFromV1(item.allergens),
    dietaryLabels: [],
    availability: item.availability === undefined ? null : item.availability,
    evidence,
    origins: originsFor(item),
  };
}


/**
 * Maps one validated v1 extraction result to v2. The v1 input and every
 * existing v1 route remain untouched. The mapping is content-lossless for the
 * fields v1 can carry; anything v1 cannot carry is made explicit (`kind:
 * "unknown"`, `sourcePath: null`, a null primary price, an unresolved but
 * contextualised supplement) and reported in `notes`. A variant whose amount is
 * not present in the item's own quote is refused, never given reconstructed
 * evidence.
 */
function mapV1ToProductV2(output, sources) {
  if (output && typeof output === 'object' && output.schemaVersion !== undefined && output.schemaVersion !== LEGACY_OUTPUT_SCHEMA_VERSION) {
    return refusal('unsupported_schema_version', [`unsupported_schema_version: ${String(output.schemaVersion)}`], output);
  }
  const v1Input = output && typeof output === 'object' && output.schemaVersion === LEGACY_OUTPUT_SCHEMA_VERSION
    ? Object.fromEntries(Object.entries(output).filter(([key]) => key !== 'schemaVersion'))
    : output;
  const v1Problems = validateStructuredOutput(v1Input, sources);
  if (v1Problems.length > 0) return refusal('invalid_v1_output', v1Problems, output);

  const blockers = [];
  const notes = new Set();
  const counters = { menu: 0, variant: 0, category: 0, item: 0, priceVariant: 0 };
  const menus = v1Input.menus.map((menu, m) => {
    const menuId = `menu-${++counters.menu}`;
    const variantId = `variant-${++counters.variant}`;
    const categories = menu.categories.map((category, c) => {
      const categoryId = `cat-${++counters.category}`;
      const path = Array.isArray(category.path) && category.path.length > 0 ? [...category.path] : [category.name];
      notes.add('v1_has_no_source_path: sourcePath stays null');
      const context = { counters, notes, menuId, categoryId };
      const items = category.items.map((item, i) => mapItem(item, {
        ...context,
        path: `menus[${m}].categories[${c}].items[${i}]`,
      }, blockers));
      return {
        id: categoryId,
        name: category.name,
        path,
        sourcePath: null,
        kind: 'section',
        choice: null,
        uncertain: category.uncertain === true,
        items,
      };
    });
    return {
      id: menuId,
      title: menu.title,
      sourceId: menu.sourceId,
      variant: {
        id: variantId,
        label: menu.variant === undefined ? null : menu.variant,
        sourceLabel: menu.variant === undefined ? null : menu.variant,
        locale: null,
        location: null,
        order: menu.order === undefined ? null : menu.order,
      },
      categories,
    };
  });

  if (blockers.length > 0) return refusal(blockers[0].code, blockers.map((b) => `${b.path}: ${b.detail}`), output, blockers);

  const product = {
    schemaVersion: MENU_PRODUCT_SCHEMA_VERSION,
    menus,
    ...(v1Input.rejected !== undefined ? { rejected: v1Input.rejected.map((row) => ({ ...row })) } : {}),
    coverage: {
      status: v1Input.coverage.status,
      sourcesRead: v1Input.coverage.sourcesRead,
      pagesRead: v1Input.coverage.pagesRead,
      itemsExtracted: v1Input.coverage.itemsExtracted,
      unreadSources: v1Input.coverage.unreadSources.map((row) => ({ ...row })),
      limitations: [...v1Input.coverage.limitations],
    },
  };
  const problems = validateMenuProductV2(product, sources);
  if (problems.length > 0) return refusal('mapping_invalid', problems, output);
  return { ok: true, value: product, blockers: [], notes: [...notes] };
}


function addBlocker(blockers, code, path, detail) {
  blockers.push({ code, path, detail });
}

function projectItem(item, where, blockers) {
  if (!['unknown', 'supplement'].includes(item.kind)) {
    addBlocker(blockers, 'unsupported_item_kind', `${where}.kind`, `v1 has no item kind; "${item.kind}" would be lost`);
  }
  const expectedOrigins = originsFor({
    description: item.description,
    allergens: item.allergens.status === 'unknown' ? undefined : item.allergens,
    supplementOf: item.kind === 'supplement' && item.supplementOf && item.supplementOf.label ? item.supplementOf.label : undefined,
    availability: item.availability,
  });
  for (const field of Object.keys(expectedOrigins)) {
    if (item.origins[field] !== expectedOrigins[field]) {
      addBlocker(blockers, 'origin_not_representable', `${where}.origins.${field}`, 'v1 cannot carry this field origin; the v1 mapper would regenerate a different one');
    }
  }
  if (item.primaryPriceRef !== null) {
    addBlocker(blockers, 'primary_price_not_representable', `${where}.primaryPriceRef`, 'v1 has no explicit primary-price relation');
  }
  if (item.choiceGroupRef !== null) {
    addBlocker(blockers, 'choice_group_not_representable', `${where}.choiceGroupRef`, 'v1 has no choice-group relation');
  }
  if (item.dietaryLabels.length > 0) {
    addBlocker(blockers, 'dietary_labels_not_representable', `${where}.dietaryLabels`, 'v1 has no dietary-label field');
  }

  const out = { name: item.name, priceStatus: item.price.status === 'from' ? 'known' : item.price.status };
  if (item.description !== null) out.description = item.description;
  if (item.price.status === 'known' || item.price.status === 'from') {
    out.amountMinorUnits = item.price.amountMinorUnits;
    out.currency = item.price.currency;
    if (item.price.status === 'from') out.isFrom = true;
    if (hasContentHash(item.price.evidence) || !sameEvidence(item.price.evidence, item.evidence)) {
      addBlocker(blockers, 'price_evidence_not_representable', `${where}.price.evidence`, 'v1 carries only the item-level quote');
    }
  } else if (item.price.evidence !== null) {
    addBlocker(blockers, 'price_evidence_not_representable', `${where}.price.evidence`, 'v1 carries only the item-level quote');
  }
  if (item.price.text !== null) out.priceText = item.price.text;

  if (item.priceVariants.length > 0) {
    out.priceVariants = item.priceVariants.map((variant, v) => {
      const variantPath = `${where}.priceVariants[${v}]`;
      if (variant.isSupplement || variant.perPerson || variant.text !== null) {
        addBlocker(blockers, 'variant_metadata_not_representable', variantPath, 'v1 variants carry only label, amount and currency');
      }
      if (variant.kind !== variantKindFromLabel(variant.label)) {
        addBlocker(blockers, 'variant_kind_not_representable', `${variantPath}.kind`, 'v1 derives the kind from the source label');
      }
      if (variant.origin !== 'extracted') {
        addBlocker(blockers, 'variant_origin_not_representable', `${variantPath}.origin`, 'v1 cannot carry a variant field origin');
      }
      if (hasContentHash(variant.evidence) || !sameEvidence(variant.evidence, item.evidence)) {
        addBlocker(blockers, 'variant_evidence_not_representable', `${variantPath}.evidence`, 'v1 variants carry no own evidence');
      }
      return { label: variant.label, amountMinorUnits: variant.amountMinorUnits, currency: variant.currency };
    });
  }

  if (item.allergens.status === 'explicit') {
    if (item.allergens.sourceTextStatus !== 'not_isolated') {
      addBlocker(blockers, 'allergen_source_text_not_representable', `${where}.allergens.sourceText`, 'v1 carries no isolated allergen passage');
    }
    out.allergens = { status: 'explicit', values: [...item.allergens.codes] };
  }
  // An explicit v2 "unknown" is omitted in v1: the legacy file has no field for
  // "not known", and absence there already means "no claim".

  if (item.kind === 'supplement') {
    if (item.supplementOf.status === 'resolved') {
      addBlocker(blockers, 'resolved_supplement_not_representable', `${where}.supplementOf`, 'v1 carries only a source label, not a resolved item reference');
    } else if (item.supplementOf.label === null) {
      addBlocker(blockers, 'supplement_label_missing', `${where}.supplementOf.label`, 'v1 needs a source label for the supplement');
    } else {
      out.supplementOf = item.supplementOf.label;
    }
  }

  if (item.availability !== null) out.availability = item.availability;
  if (hasContentHash(item.evidence)) {
    addBlocker(blockers, 'evidence_content_hash_not_representable', `${where}.evidence.contentHash`, 'v1 evidence has no contentHash field');
  }
  out.evidence = copyEvidence(item.evidence);
  return out;
}


function projectCategory(category, where, blockers) {
  if (category.kind !== 'section') {
    addBlocker(blockers, 'unsupported_category_kind', `${where}.kind`, `v1 has no category kind; "${category.kind}" would be lost`);
  }
  if (category.choice !== null) {
    addBlocker(blockers, 'choice_group_not_representable', `${where}.choice`, 'v1 has no choice constraints');
  }
  if (category.sourcePath !== null) {
    addBlocker(blockers, 'category_source_path_not_representable', `${where}.sourcePath`, 'v1 carries one path, not a separate source path');
  }
  const out = { name: category.name };
  if (category.path.length > 1) out.path = [...category.path];
  if (category.uncertain) out.uncertain = true;
  out.items = category.items.map((item, i) => projectItem(item, `${where}.items[${i}]`, blockers));
  return out;
}

/**
 * Strict v2 -> v1 projection. The only success is a v1 result that keeps every
 * name, price, path, order, relation and evidence line the v2 object carried.
 * Result-local IDs and field-origin metadata are not representable in v1 and
 * are documented as such; any content or structural construct that would be
 * lost refuses instead of flattening.
 */
function projectProductV2ToV1(product, options = {}) {
  const problems = validateMenuProductV2(product, options.sources);
  if (problems.length > 0) return { ok: false, reason: 'invalid_product_v2', problems, blockers: [], preservedInput: product };

  const blockers = [];
  const menus = product.menus.map((menu, m) => {
    const where = `menus[${m}]`;
    const variant = menu.variant;
    if (variant.locale !== null || variant.location !== null) {
      addBlocker(blockers, 'menu_variant_metadata_not_representable', `${where}.variant`, 'v1 carries one variant label without locale/location');
    }
    if (variant.label !== variant.sourceLabel) {
      addBlocker(blockers, 'menu_variant_label_not_representable', `${where}.variant`, 'v1 carries one label, not separate display and source labels');
    }
    const out = { title: menu.title, sourceId: menu.sourceId };
    if (variant.label !== null) out.variant = variant.label;
    if (variant.order !== null) out.order = variant.order;
    out.categories = menu.categories.map((category, c) => projectCategory(category, `${where}.categories[${c}]`, blockers));
    return out;
  });

  if (blockers.length > 0) {
    return { ok: false, reason: 'unsupported_v1_projection', problems: [], blockers, preservedInput: product };
  }
  const value = {
    menus,
    ...(product.rejected !== undefined ? { rejected: product.rejected.map((row) => ({ ...row })) } : {}),
    coverage: {
      status: product.coverage.status,
      sourcesRead: product.coverage.sourcesRead,
      pagesRead: product.coverage.pagesRead,
      itemsExtracted: product.coverage.itemsExtracted,
      unreadSources: product.coverage.unreadSources.map((row) => ({ ...row })),
      limitations: [...product.coverage.limitations],
    },
  };
  if (Array.isArray(options.sources)) {
    const v1Problems = validateStructuredOutput(value, options.sources);
    if (v1Problems.length > 0) {
      return { ok: false, reason: 'projection_invalid', problems: v1Problems, blockers, preservedInput: product };
    }
  }
  return { ok: true, blockers: [], value };
}


/**
 * Pure suitability guard for `data/menus.json`. It produces no file content and
 * is not called by any route. In this round it deliberately refuses every v2
 * item: the public file has one price and one `allergens` array that cannot
 * distinguish "explicit", "unknown" and "no allergens". That is the approved
 * blocked state, not a fallback; a later export contract is a separate decision.
 */
function checkProductV2ExportSuitability(product, options = {}) {
  const problems = validateMenuProductV2(product, options.sources);
  if (problems.length > 0) {
    return {
      ok: false,
      reason: 'invalid_product_v2',
      blockers: [{ code: 'invalid_product_v2', path: '', detail: 'the v2 envelope did not validate' }],
      problems,
    };
  }
  const blockers = [];
  let itemCount = 0;
  product.menus.forEach((menu, m) => {
    menu.categories.forEach((category, c) => {
      const categoryPath = `menus[${m}].categories[${c}]`;
      if (category.kind !== 'section') {
        addBlocker(blockers, 'category_kind_not_exportable', `${categoryPath}.kind`, `data/menus.json has no "${category.kind}" category`);
      }
      category.items.forEach((item, i) => {
        itemCount += 1;
        const where = `${categoryPath}.items[${i}]`;
        if (['supplement', 'choice', 'arrangement'].includes(item.kind)) {
          addBlocker(blockers, 'item_kind_not_exportable', `${where}.kind`, `data/menus.json has no "${item.kind}" item relation`);
        }
        if (item.supplementOf !== null) addBlocker(blockers, 'supplement_relation_not_exportable', `${where}.supplementOf`, 'the public file has no supplement target');
        if (item.choiceGroupRef !== null) addBlocker(blockers, 'choice_relation_not_exportable', `${where}.choiceGroupRef`, 'the public file has no choice group');
        if (item.priceVariants.length > 0) addBlocker(blockers, 'price_variants_not_exportable', `${where}.priceVariants`, 'the public file has one price field');
        if (item.primaryPriceRef !== null) addBlocker(blockers, 'primary_price_not_exportable', `${where}.primaryPriceRef`, 'the public file has no price reference');
        if (item.price.status !== 'known') addBlocker(blockers, 'price_status_not_exportable', `${where}.price.status`, `a "${item.price.status}" price cannot be exported without choosing a primary price`);
        if (item.allergens.status === 'explicit' || item.allergens.status === 'unknown') {
          addBlocker(blockers, 'allergen_status_not_exportable', `${where}.allergens.status`, 'data/menus.json cannot distinguish explicit, unknown and no allergens');
        }
        if (item.dietaryLabels.length > 0) addBlocker(blockers, 'dietary_labels_not_exportable', `${where}.dietaryLabels`, 'the public file has no dietary-label field');
        if (item.availability !== null) addBlocker(blockers, 'availability_not_exportable', `${where}.availability`, 'the public file has no availability field');
      });
    });
  });
  if (itemCount === 0) addBlocker(blockers, 'empty_menu', '', 'an empty menu is never a successful export');
  return {
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? null : 'unsupported_export_construct',
    blockers,
    problems: [],
  };
}

module.exports = {
  SUPPLEMENT_UNRESOLVED_LIMITATION,
  variantKindFromLabel,
  mapV1ToProductV2,
  projectProductV2ToV1,
  checkProductV2ExportSuitability,
};

