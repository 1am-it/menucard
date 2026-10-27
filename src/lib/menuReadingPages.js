'use strict';

// BE-36 (#87) — a menu that only exists as images or as a scan is read page by
// page, then put back together into one reading.
//
// The live Al Dente test of 2026-10-27 (nine menu images) gave four different
// answers for the same menu: 13 dishes, `page_limit`, 2 dishes and
// `output_truncated` after 32 s. The causes were in our own settings: all nine
// images went into one call, the answer was capped at 10,000 output tokens, and
// the validator rejected the whole reading for one deviating dish.
//
// This module is the pure part of the repair, next to the existing call chain
// (`menuExtractionAnthropicCall` → `menuExtractionAdapter` → validator): it
// splits a planned reading into pages, describes one page for one call, repairs
// the deviations that are only worth "Controle nodig" instead of a refusal, and
// merges the answers back into one menu with one menu-copy structure. It has no
// network, no SDK, no clock and no database, so every rule is provable offline.
//
// What it never does: invent a dish, a price or a menu copy, approve anything,
// or send more than one page to the model per call.

const {
  COST_PER_PAGE_EUR_CENTS,
  MAX_COST_PER_PAGE_EUR_CENTS,
  imageProvenance,
  readingMaxCostEurCents,
} = require('./menuImageRead');
const schema = require('./menuExtractionSchema');

// Criterion 2: at most two pages at the same time, one page per call, and an
// output ceiling that fits one page with margin. A page of a menu card needs
// roughly 1,000-3,000 output tokens; 8,000 leaves room without paying for a
// whole card in one answer (the live failure was a 10,000-token ceiling for
// nine images).
const MAX_CONCURRENT_PAGES = 2;
const PAGE_MAX_OUTPUT_TOKENS = 8_000;
const MAX_DOCUMENT_PAGE_TOKENS = 8_000;
// The route's function duration is 300 s. A page stops after 60 s, so a full
// reading of ten pages stays inside it even with one retry per page.
const PAGE_CALL_TIMEOUT_MS = 60_000;
// One automatic retry per page, never more (criterion 2). A retry waits a
// moment so a briefly unavailable provider is not hammered.
const PAGE_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;
// The reading stops starting new pages after this; the route's own function
// duration is 300 s and the concept write still needs room.
const READING_DEADLINE_MS = 240_000;
const MAX_REPAIRS = 40;
const MAX_REJECTED = 200;

const REPAIR_RULES = Object.freeze({
  locator: 'image_locator_repaired',
  source: 'image_source_repaired',
  price: 'missing_price_reviewed',
  field: 'page_field_dropped',
  coverage: 'page_coverage_derived',
});

const FAILURE_SENTENCES = Object.freeze({
  provider_unavailable: 'De AI was even niet bereikbaar.',
  model_unavailable: 'De AI was even niet bereikbaar.',
  rate_limited: 'De AI kreeg te veel verzoeken.',
  timeout: 'De AI deed er te lang over.',
  output_truncated: 'Het antwoord was afgekapt.',
  output_limit: 'Het antwoord was afgekapt.',
  schema_violation: 'Het antwoord was ongeldig.',
  provider_refusal: 'De AI weigerde deze pagina.',
  input_limit: 'De pagina was te groot voor de AI.',
  source_missing: 'De pagina was niet meer beschikbaar.',
  budget_exceeded: 'Het budget van deze maand is op.',
  budget_exhausted: 'Het budget van deze maand is op.',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shortText(value, max) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}


/**
 * Splits a planned reading into pages, in reading order. One image is one page;
 * a text source is one page; a scan PDF stays one document (its pages are read
 * by the provider as one document, because rendering a scanned page to an image
 * would need a new dependency and is out of scope for #87).
 *
 * Every page keeps its own origin: the number used here is the number the model
 * must repeat as `afbeelding N`, so a dish never loses the page it came from.
 */
function readingUnits(plan, sources) {
  const entries = plan && Array.isArray(plan.sources) ? plan.sources : [];
  const byId = new Map((Array.isArray(sources) ? sources : []).map((source) => [source.id, source]));
  const units = [];
  let number = 0;
  for (const entry of entries) {
    const source = byId.get(entry.id);
    if (!source) continue;
    if (entry.mode === 'text') {
      if (typeof source.text !== 'string' || source.text.trim() === '') continue;
      number += 1;
      units.push({
        number,
        kind: 'text',
        sourceId: source.id,
        sourceUrl: source.url || null,
        sourceKind: source.kind || null,
        locator: `tekst ${number}`,
        label: 'De tekst',
        text: source.text,
      });
      continue;
    }
    if (entry.mode === 'image') {
      const images = Array.isArray(source.images) ? source.images : [];
      const count = Number.isInteger(entry.imageCount) ? entry.imageCount : images.length;
      for (const [imageIndex, image] of images.slice(0, count).entries()) {
        // A page without its own bytes cannot be read, so it is no page of this
        // reading at all.
        if (!image || typeof image.data !== 'string' || image.data === '') continue;
        number += 1;
        units.push({
          number,
          kind: 'image',
          sourceId: source.id,
          sourceUrl: source.url || null,
          sourceKind: source.kind || null,
          locator: `afbeelding ${number}`,
          label: `Pagina ${number}`,
          imageIndex,
          imageUrl: image.url || null,
          mediaType: image.mediaType || null,
          data: image.data,
        });
      }
      continue;
    }
    if (entry.mode === 'document') {
      if (typeof source.documentBase64 !== 'string' || source.documentBase64 === '') continue;
      number += 1;
      const pages = Number.isInteger(source.pageCount) && source.pageCount > 0 ? source.pageCount : 1;
      units.push({
        number,
        kind: 'document',
        sourceId: source.id,
        sourceUrl: source.url || null,
        sourceKind: source.kind || null,
        locator: `pagina ${number}`,
        label: pages === 1 ? 'De PDF-pagina' : `De PDF (${pages} pagina's)`,
        pageCount: pages,
        documentBase64: source.documentBase64,
      });
    }
  }
  return units;
}

/** The one source of one call: exactly that image, that document or that text. */
function unitSource(unit) {
  if (!unit) return [];
  const base = { id: unit.sourceId, url: unit.sourceUrl, kind: unit.sourceKind };
  if (unit.kind === 'image') {
    return [{
      ...base,
      kind: unit.sourceKind || 'image',
      text: null,
      images: [{ number: unit.number, url: unit.imageUrl, mediaType: unit.mediaType, data: unit.data }],
      documentBase64: null,
      pageCount: null,
      imageRead: true,
    }];
  }
  if (unit.kind === 'document') {
    return [{
      ...base,
      kind: unit.sourceKind || 'pdf',
      text: null,
      images: [],
      documentBase64: unit.documentBase64,
      pageCount: unit.pageCount,
      imageRead: true,
    }];
  }
  return [{ ...base, text: unit.text, images: [], documentBase64: null, pageCount: null, imageRead: false }];
}

/**
 * The limits of one call: an output ceiling that fits one page, one page of
 * input and one page of budget. A scan gets room for each of its pages, because
 * it is sent as one document.
 */
function unitLimits(unit, base = {}) {
  const pages = unit && unit.kind === 'document' && Number.isInteger(unit.pageCount) && unit.pageCount > 0 ? unit.pageCount : 1;
  const maxOutputTokens = unit && unit.kind === 'document'
    ? Math.min(128_000, MAX_DOCUMENT_PAGE_TOKENS * pages)
    : PAGE_MAX_OUTPUT_TOKENS;
  // A pdf page count limits a document. A loose image is not a document page
  // (the adapter skips that check for images only) and a text source keeps the
  // reading-wide limit it always had.
  const maxPages = unit && unit.kind === 'document'
    ? pages
    : unit && unit.kind === 'image'
      ? 1
      : Number.isInteger(base && base.maxPages) && base.maxPages > 0
        ? base.maxPages
        : 1;
  return {
    ...base,
    maxOutputTokens,
    maxPages,
    callTimeoutMs: PAGE_CALL_TIMEOUT_MS,
    maxCostEurCents: MAX_COST_PER_PAGE_EUR_CENTS,
  };
}

/** The budget of one whole reading, from its number of pages (criterion 5). */
function readingCostPlan(units) {
  const pages = Array.isArray(units) ? units.length : 0;
  return {
    pages,
    maxEurCents: readingMaxCostEurCents(pages),
    estimatedEurCents: pages * COST_PER_PAGE_EUR_CENTS,
  };
}

/** A page descriptor without its bytes: what the sealed state may keep. */
function publicUnit(unit) {
  if (!unit) return null;
  return {
    number: unit.number,
    kind: unit.kind,
    sourceId: unit.sourceId,
    sourceUrl: unit.sourceUrl || null,
    sourceKind: unit.sourceKind || null,
    locator: unit.locator,
    label: unit.label,
    imageIndex: Number.isInteger(unit.imageIndex) ? unit.imageIndex : null,
    imageUrl: unit.imageUrl || null,
    mediaType: unit.mediaType || null,
    pageCount: Number.isInteger(unit.pageCount) ? unit.pageCount : null,
  };
}

/**
 * BE-36 (#87, criterion 3) — mild validation for one page.
 *
 * A page that the model read is only refused when nothing of it can be used. A
 * dish with an origin that does not match this page, a dish without a price, or
 * a doubtful menu copy stays in the reading and is shown as "Controle nodig"
 * by the existing review instead of failing the whole page. Nothing is made up:
 * the origin of a page is known here (this call carried exactly that image), a
 * missing price becomes the existing "prijs onbekend" state, and a field the
 * contract cannot store is dropped and reported.
 *
 * The existing strict validator still runs afterwards; this function only
 * removes the deviations the contract itself calls a review point.
 */
function repairPageOutput(output, unit) {
  const repairs = [];
  if (!isObject(output)) return { output, repairs };
  const locator = unit && typeof unit.locator === 'string' ? unit.locator : null;
  const sourceId = unit && typeof unit.sourceId === 'string' ? unit.sourceId : null;
  const pageCount = unit && Number.isInteger(unit.pageCount) && unit.pageCount > 0 ? unit.pageCount : 1;
  const note = (rule, field, from, to, reason) => {
    if (repairs.length >= MAX_REPAIRS) return;
    repairs.push({ rule, field, from: from === undefined ? null : from, to: to === undefined ? null : to, reason });
  };

  function repairEvidence(item, at, name) {
    const evidence = isObject(item.evidence) ? item.evidence : null;
    if (!evidence) {
      const quote = name || 'afbeelding';
      note(REPAIR_RULES.locator, `${at}.evidence`, null, locator, 'de herkomst van dit gerecht ontbrak; de gelezen pagina is bekend');
      return { sourceId: sourceId || '', locator: locator || '', quote };
    }
    let changed = false;
    let nextSource = evidence.sourceId;
    let nextLocator = evidence.locator;
    let nextQuote = evidence.quote;
    if (sourceId && evidence.sourceId !== sourceId) {
      nextSource = sourceId;
      changed = true;
      note(REPAIR_RULES.source, `${at}.evidence.sourceId`, evidence.sourceId, sourceId, 'deze pagina is de enige bron van deze aanroep');
    }
    if (locator && !imageProvenance(evidence.locator)) {
      nextLocator = locator;
      changed = true;
      note(REPAIR_RULES.locator, `${at}.evidence.locator`, evidence.locator, locator, 'de herkomst past niet bij deze pagina; het gerecht gaat naar controle');
    }
    if (!shortText(evidence.quote, 500)) {
      nextQuote = name || 'afbeelding';
      changed = true;
      note(REPAIR_RULES.locator, `${at}.evidence.quote`, null, null, 'een citaat uit een afbeelding is niet letterlijk te controleren');
    }
    if (!changed) return null;
    return { sourceId: nextSource, locator: nextLocator, quote: nextQuote };
  }

  function repairVariants(variants) {
    if (!Array.isArray(variants) || variants.length === 0 || variants.length > 10) return null;
    const out = [];
    for (const variant of variants) {
      if (!isObject(variant)) return null;
      const label = variant.label === null || variant.label === undefined ? null : shortText(variant.label, 80);
      if (variant.label !== null && variant.label !== undefined && label === null) return null;
      if (!Number.isInteger(variant.amountMinorUnits) || variant.amountMinorUnits < 0) return null;
      out.push({ label, amountMinorUnits: variant.amountMinorUnits, currency: 'EUR' });
    }
    return out;
  }

  function repairItem(item, at) {
    if (!isObject(item)) return item;
    const name = shortText(item.name, 200);
    const next = { ...item };
    const evidence = repairEvidence(item, at, name);
    if (evidence) next.evidence = evidence;

    // Price: a dish without a usable price stays, as the existing "prijs
    // onbekend" review point. Nothing is invented.
    let priceStatus = schema.PRICE_STATUSES.includes(item.priceStatus) ? item.priceStatus : 'unknown';
    if (priceStatus !== item.priceStatus) {
      note(REPAIR_RULES.price, `${at}.priceStatus`, item.priceStatus, priceStatus, 'de prijsstatus ontbreekt of is onbekend; het gerecht gaat naar controle');
    }
    const variants = repairVariants(item.priceVariants);
    if (variants) {
      next.priceVariants = variants;
      delete next.isFrom;
      if (priceStatus !== 'multiple_undecomposed') {
        priceStatus = 'multiple_undecomposed';
        note(REPAIR_RULES.price, `${at}.priceStatus`, item.priceStatus, priceStatus, 'meerdere prijzen horen bij de bestaande prijsvarianten');
      }
    } else if (item.priceVariants !== undefined) {
      delete next.priceVariants;
      if (priceStatus === 'multiple_undecomposed') priceStatus = 'unknown';
      note(REPAIR_RULES.field, `${at}.priceVariants`, null, null, 'de prijsvarianten zijn niet leesbaar en zijn weggelaten');
    }
    let amount = item.amountMinorUnits;
    let currency = item.currency;
    if (priceStatus === 'known') {
      if (!Number.isInteger(amount) || amount < 0) {
        priceStatus = 'unknown';
        amount = undefined;
        currency = undefined;
        note(REPAIR_RULES.price, `${at}.amountMinorUnits`, null, null, 'de prijs ontbreekt; het gerecht gaat naar controle');
      } else {
        currency = 'EUR';
      }
    } else {
      amount = undefined;
      currency = undefined;
    }
    if (priceStatus === 'multiple_undecomposed' && Array.isArray(next.priceVariants)) {
      amount = undefined;
      currency = undefined;
    }
    next.priceStatus = priceStatus;
    if (amount === undefined) delete next.amountMinorUnits;
    else next.amountMinorUnits = amount;
    if (currency === undefined) delete next.currency;
    else next.currency = currency;

    if (next.isFrom !== undefined && typeof next.isFrom !== 'boolean') delete next.isFrom;
    for (const key of ['supplementOf', 'availability']) {
      if (next[key] !== undefined && !shortText(next[key], key === 'supplementOf' ? 200 : 80)) delete next[key];
    }
    if (next.allergens !== undefined) {
      const allergens = next.allergens;
      const valid = isObject(allergens)
        && ['explicit', 'unknown'].includes(allergens.status)
        && Array.isArray(allergens.values)
        && allergens.values.every((value) => shortText(value, 80));
      if (!valid
        || (allergens.status === 'explicit' && allergens.values.length === 0)
        || (allergens.status === 'unknown' && allergens.values.length > 0)) {
        delete next.allergens;
        note(REPAIR_RULES.field, `${at}.allergens`, null, null, 'de allergenen zijn niet leesbaar en zijn weggelaten');
      }
    }
    return next;
  }

  const sourceMenus = Array.isArray(output.menus) ? output.menus : null;
  const menus = sourceMenus
    ? sourceMenus.map((menu, m) => {
      if (!isObject(menu)) return menu;
      const next = { ...menu };
      if (sourceId && menu.sourceId !== sourceId) {
        next.sourceId = sourceId;
        note(REPAIR_RULES.source, `menus[${m}].sourceId`, menu.sourceId, sourceId, 'deze pagina is de enige bron van deze aanroep');
      }
      if (next.variant !== undefined && next.variant !== null && !shortText(next.variant, 160)) delete next.variant;
      if (next.order !== undefined && next.order !== null && !(Number.isInteger(next.order) && next.order >= 0)) delete next.order;
      if (Array.isArray(menu.categories)) {
        next.categories = menu.categories.map((category, c) => {
          if (!isObject(category)) return category;
          const fixed = { ...category };
          if (fixed.uncertain !== undefined && typeof fixed.uncertain !== 'boolean') delete fixed.uncertain;
          if (fixed.path !== undefined && (!Array.isArray(fixed.path) || fixed.path.some((label) => !shortText(label, 160)))) delete fixed.path;
          if (Array.isArray(category.items)) {
            fixed.items = category.items.map((item, i) => repairItem(item, `menus[${m}].categories[${c}].items[${i}]`));
          } else if (category.items !== undefined) {
            fixed.items = [];
            note(REPAIR_RULES.field, `menus[${m}].categories[${c}].items`, null, null, 'de gerechten van dit menukopje waren niet leesbaar');
          }
          return fixed;
        });
      }
      return next;
    })
    : output.menus;

  const itemCount = Array.isArray(menus)
    ? menus.reduce((sum, menu) => sum + (isObject(menu) && Array.isArray(menu.categories)
      ? menu.categories.reduce((inner, category) => inner + (isObject(category) && Array.isArray(category.items) ? category.items.length : 0), 0)
      : 0), 0)
    : 0;

  const rejected = Array.isArray(output.rejected)
    ? output.rejected.filter((row) => {
      if (!isObject(row)) return false;
      if (sourceId && row.sourceId !== sourceId) return false;
      if (!shortText(row.locator, 200)) return false;
      if (!schema.REJECTION_REASONS.includes(row.reason)) return false;
      if (row.text !== undefined && !shortText(row.text, 300)) return false;
      return true;
    }).slice(0, MAX_REJECTED)
    : [];

  // The bookkeeping of one page is exactly derivable; the model's own numbers
  // are replaced instead of trusted (the same rule as the existing R1/R2).
  const modelCoverage = isObject(output.coverage) ? output.coverage : {};
  const coverage = {
    status: itemCount > 0 ? 'complete' : 'no_items',
    sourcesRead: 1,
    pagesRead: pageCount,
    itemsExtracted: itemCount,
    unreadSources: [],
    limitations: [],
  };
  if (modelCoverage.itemsExtracted !== itemCount || modelCoverage.sourcesRead !== 1 || modelCoverage.status !== coverage.status) {
    note(REPAIR_RULES.coverage, 'coverage', modelCoverage.itemsExtracted, itemCount, 'het systeem telt de gelezen pagina en de gerechten; de AI niet');
  }

  return { output: { ...output, menus, rejected, coverage }, repairs };
}

function normalizeLabel(value, max = 160) {
  return String(typeof value === 'string' ? value : '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, max);
}

/** The identity of a dish for the page boundary: name + price, within its copy. */
function dedupeKey(item) {
  const name = normalizeLabel(item && item.name, 200);
  const price = item && item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits)
    ? `${item.amountMinorUnits}`
    : `${(item && typeof item.priceStatus === 'string' ? item.priceStatus : '')}|${normalizeLabel(item && item.priceText, 160)}`;
  return `${name}\u0000${price}`;
}

/**
 * Criterion 1: the pages become one reading again, with the same menu and
 * menu-copy structure the rest of the app already uses. Equal menus and equal
 * menu copies are merged; a dish that appears on two pages with the same name
 * and the same price is kept once. Every item keeps its own evidence, so the
 * origin ("afgelezen van afbeelding 7") survives the merge.
 */
function mergeReadingOutputs(entries) {
  const menus = [];
  const menuIndex = new Map();
  const duplicates = [];
  const rejected = [];
  const readSources = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const unit = entry && entry.unit ? entry.unit : null;
    const output = entry && entry.output;
    if (!unit || !isObject(output) || !Array.isArray(output.menus)) continue;
    if (unit.sourceId) readSources.add(unit.sourceId);
    for (const menu of output.menus) {
      if (!isObject(menu)) continue;
      const title = shortText(menu.title, 160) || 'Menukaart';
      const variant = shortText(menu.variant, 160);
      const menuKey = `${normalizeLabel(title)}|${normalizeLabel(variant || '')}`;
      let target = menuIndex.get(menuKey);
      if (!target) {
        target = {
          title,
          sourceId: typeof menu.sourceId === 'string' && menu.sourceId !== '' ? menu.sourceId : unit.sourceId,
          variant,
          order: Number.isInteger(menu.order) && menu.order >= 0 ? menu.order : null,
          categories: [],
          categoryIndex: new Map(),
        };
        menus.push(target);
        menuIndex.set(menuKey, target);
      }
      for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
        if (!isObject(category)) continue;
        const path = Array.isArray(category.path)
          ? category.path.filter((label) => shortText(label, 160)).map((label) => label.trim().slice(0, 160))
          : null;
        const name = shortText(category.name, 160) || (path && path.length ? path[path.length - 1] : 'Overig');
        const categoryKey = `${normalizeLabel(name)}|${(path || []).map((label) => normalizeLabel(label)).join('>')}`;
        let bucket = target.categoryIndex.get(categoryKey);
        if (!bucket) {
          bucket = {
            name,
            ...(path && path.length ? { path } : {}),
            ...(category.uncertain === true ? { uncertain: true } : {}),
            items: [],
            itemIndex: new Map(),
          };
          target.categories.push(bucket);
          target.categoryIndex.set(categoryKey, bucket);
        }
        for (const item of Array.isArray(category.items) ? category.items : []) {
          if (!isObject(item)) continue;
          const key = dedupeKey(item);
          const firstPage = bucket.itemIndex.get(key);
          if (firstPage !== undefined && firstPage !== unit.number) {
            if (duplicates.length < 50) {
              duplicates.push({ name: shortText(item.name, 200) || '', page: unit.number, firstPage });
            }
            continue;
          }
          if (firstPage === undefined) bucket.itemIndex.set(key, unit.number);
          bucket.items.push(item);
        }
      }
    }
    for (const row of Array.isArray(output.rejected) ? output.rejected : []) {
      if (rejected.length < MAX_REJECTED) rejected.push(row);
    }
  }
  for (const menu of menus) {
    delete menu.categoryIndex;
    for (const category of menu.categories) delete category.itemIndex;
  }
  return { menus, rejected, duplicates, sourcesRead: [...readSources] };
}


// A failure that is worth one automatic retry (criterion 2). A budget stop is
// not retried: the month ceiling does not change within a minute.
const RETRYABLE_REASONS = new Set([
  'provider_unavailable',
  'model_unavailable',
  'rate_limited',
  'timeout',
  'output_truncated',
  'output_limit',
  'schema_violation',
  'provider_refusal',
]);

function retryableReason(reason) {
  return RETRYABLE_REASONS.has(reason);
}

/**
 * Criterion 2 and 4: one failed page becomes one sentence in plain Dutch and
 * one next step, for that page only. The rest of the reading is untouched.
 */
function pageFailure(unit, failure) {
  const reason = (failure && typeof failure.reason === 'string' && failure.reason) || 'model_unavailable';
  const attempts = failure && Number.isInteger(failure.attempts) ? failure.attempts : 0;
  const label = unit && typeof unit.label === 'string' ? unit.label : 'Deze pagina';
  const sentence = FAILURE_SENTENCES[reason] || 'De reden is onbekend.';
  return {
    page: unit && Number.isInteger(unit.number) ? unit.number : null,
    kind: unit ? unit.kind : null,
    sourceId: unit ? unit.sourceId : null,
    locator: unit ? unit.locator : null,
    label,
    reason,
    attempts,
    retryable: retryableReason(reason),
    message: `${label} kon niet gelezen worden. ${sentence}`,
    nextStep: 'Opnieuw proberen',
  };
}

/**
 * The pages a human may retry, from the sealed state of the previous reading:
 * only those numbers, never the whole reading again. The bytes are fetched
 * again from the same source URL; a page that is no longer there stays failed
 * and is reported, never silently invented.
 */
function retryUnits(descriptors, pages, fetchedSources) {
  const wanted = new Set((Array.isArray(pages) ? pages : []).filter((page) => Number.isInteger(page) && page > 0));
  const byUrl = new Map(
    (Array.isArray(fetchedSources) ? fetchedSources : [])
      .filter((source) => source && typeof source.url === 'string')
      .map((source) => [source.url, source]),
  );
  const units = [];
  const missing = [];
  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    if (!descriptor || !wanted.has(descriptor.number)) continue;
    const source = byUrl.get(descriptor.sourceUrl) || null;
    const base = {
      number: descriptor.number,
      kind: descriptor.kind,
      sourceId: descriptor.sourceId,
      sourceUrl: descriptor.sourceUrl,
      sourceKind: descriptor.sourceKind,
      locator: descriptor.locator,
      label: descriptor.label,
    };
    if (descriptor.kind === 'image') {
      const images = source && Array.isArray(source.images) ? source.images : [];
      const byIndex = Number.isInteger(descriptor.imageIndex) ? images[descriptor.imageIndex] : null;
      const image = images.find((entry) => entry && entry.url === descriptor.imageUrl)
        || (byIndex && byIndex.mediaType === descriptor.mediaType ? byIndex : null);
      if (!image || typeof image.data !== 'string' || image.data === '') {
        missing.push(descriptor);
        continue;
      }
      units.push({
        ...base,
        imageUrl: image.url || descriptor.imageUrl,
        mediaType: image.mediaType || descriptor.mediaType,
        data: image.data,
      });
      continue;
    }
    if (descriptor.kind === 'document') {
      if (!source || typeof source.documentBase64 !== 'string' || source.documentBase64 === '') {
        missing.push(descriptor);
        continue;
      }
      units.push({
        ...base,
        pageCount: Number.isInteger(source.pageCount) ? source.pageCount : descriptor.pageCount || 1,
        documentBase64: source.documentBase64,
      });
      continue;
    }
    if (source && typeof source.text === 'string' && source.text.trim() !== '') units.push({ ...base, text: source.text });
    else missing.push(descriptor);
  }
  return { units, missing };
}

module.exports = {
  FAILURE_SENTENCES,
  MAX_CONCURRENT_PAGES,
  PAGE_ATTEMPTS,
  PAGE_CALL_TIMEOUT_MS,
  PAGE_MAX_OUTPUT_TOKENS,
  READING_DEADLINE_MS,
  REPAIR_RULES,
  RETRYABLE_REASONS,
  RETRY_DELAY_MS,
  dedupeKey,
  mergeReadingOutputs,
  mergedCoverage,
  normalizeLabel,
  pageFailure,
  publicUnit,
  readingCostPlan,
  readingUnits,
  repairPageOutput,
  retryUnits,
  retryableReason,
  unitLimits,
  unitSource,
};

/**
 * Criterion 1 and 3: the coverage of the merged reading. A page that failed
 * makes the reading `partial`, never a refusal of the pages that did work.
 */
function mergedCoverage({ readUnits, failedUnits, itemCount, sourceCount } = {}) {
  const read = Array.isArray(readUnits) ? readUnits : [];
  const failed = Array.isArray(failedUnits) ? failedUnits : [];
  const readSources = new Set(read.map((unit) => unit && unit.sourceId).filter(Boolean));
  const unreadSources = [];
  const seen = new Set();
  for (const unit of failed) {
    if (!unit) continue;
    const key = `${unit.sourceId}|${unit.locator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (unreadSources.length < 100) unreadSources.push({ sourceId: unit.sourceId, locator: unit.locator, reason: 'unreadable' });
  }
  const limitations = [];
  let status = itemCount === 0 ? 'no_items' : failed.length > 0 ? 'partial' : 'complete';
  if (status === 'complete' && Number.isInteger(sourceCount) && readSources.size < sourceCount) {
    // A source whose pages all fell outside this reading is not "complete".
    status = itemCount > 0 ? 'partial' : 'no_items';
    limitations.push('Niet elke bron van deze lezing is gelezen.');
  }
  return {
    status,
    sourcesRead: readSources.size,
    pagesRead: read.reduce((sum, unit) => sum + (unit && unit.kind === 'document' && Number.isInteger(unit.pageCount) ? unit.pageCount : 1), 0),
    itemsExtracted: Number.isInteger(itemCount) ? itemCount : 0,
    unreadSources,
    limitations,
  };
}

