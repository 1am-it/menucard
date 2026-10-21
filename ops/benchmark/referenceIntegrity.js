'use strict';

// Integrity checks for the controlled #59 references (Delivery Lead review
// 6318225879). Pure: the caller supplies the captured text per capture key.
// These checks never decide whether an extraction is good; they decide whether
// the *reference* may be used at all.

const ENTITY_MAP = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&euro;': '€',
  '&#8364;': '€',
  '&#8216;': '‘',
  '&#8217;': '’',
  '&#8211;': '–',
  '&#8212;': '—',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&eacute;': 'é',
  '&egrave;': 'è',
  '&ecirc;': 'ê',
  '&agrave;': 'à',
  '&ocirc;': 'ô',
  '&ucirc;': 'û',
  '&hellip;': '…',
  '&frac12;': '½',
  '&lsquo;': '‘',
  '&rsquo;': '’',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&ndash;': '–',
  '&mdash;': '—',
};

function decodeEntities(value) {
  return String(value || '').replace(/&(?:nbsp|amp|euro|quot|apos|eacute|egrave|ecirc|agrave|ocirc|ucirc|hellip|frac12|lsquo|rsquo|ldquo|rdquo|ndash|mdash);|&#(?:8364|039|8216|8217|8211|8212);/gi, (match) => {
    const key = match.toLowerCase();
    return ENTITY_MAP[key] || ENTITY_MAP[match] || match;
  });
}

/** Visible text of an HTML capture, preserving block boundaries as spaces. */
function htmlVisibleText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

/** Normalisation used only to locate a quote, never to author one. */
function normalizeQuoteText(value) {
  return decodeEntities(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function refItems(reference) {
  const rows = [];
  for (const menu of Array.isArray(reference && reference.menus) ? reference.menus : []) {
    for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
      for (const item of Array.isArray(category.items) ? category.items : []) {
        rows.push({ kind: 'item', item, captureKey: menu.captureKey, where: `${menu.title} › ${(category.path || []).slice(1).join(' › ')}` });
      }
    }
  }
  for (const arrangement of Array.isArray(reference && reference.arrangements) ? reference.arrangements : []) {
    rows.push({ kind: 'arrangement', item: arrangement, captureKey: arrangement.captureKey, where: 'arrangement' });
  }
  for (const supplement of Array.isArray(reference && reference.supplements) ? reference.supplements : []) {
    rows.push({ kind: 'supplement', item: supplement, captureKey: supplement.captureKey, where: 'supplement' });
  }
  return rows;
}

/**
 * Every reference row must carry a name, a comparable price (or variants), a
 * locator and a quote; the quote must occur in the pinned text of its own
 * capture. Returns `{ ok, errors }`.
 */
function verifyReferenceQuotes(reference, textByCaptureKey) {
  const errors = [];
  const texts = textByCaptureKey instanceof Map ? textByCaptureKey : new Map(Object.entries(textByCaptureKey || {}));
  for (const row of refItems(reference)) {
    const item = row.item || {};
    const label = `${row.kind} ${item.name || '(naamloos)'}`;
    if (!nonEmptyString(item.name)) errors.push(`${label}: name is required`);
    if (!nonEmptyString(item.quote)) errors.push(`${label}: quote is required`);
    if (row.kind === 'item' && !nonEmptyString(item.locator)) errors.push(`${label}: locator is required`);
    const hasPrice = nonEmptyString(item.price) || (Array.isArray(item.priceVariants) && item.priceVariants.length > 0);
    if (row.kind === 'item' && !hasPrice) errors.push(`${label}: price or priceVariants is required`);
    if (!nonEmptyString(row.captureKey)) {
      errors.push(`${label}: captureKey is required`);
      continue;
    }
    const text = texts.get(row.captureKey);
    if (typeof text !== 'string') {
      errors.push(`${label}: no captured text for ${row.captureKey}`);
      continue;
    }
    if (nonEmptyString(item.quote) && !normalizeQuoteText(text).includes(normalizeQuoteText(item.quote))) {
      errors.push(`${label}: quote not found in ${row.captureKey}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Structural rules that make a reference comparable and lossless. */
function validateReferenceShape(reference) {
  const errors = [];
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    return { ok: false, errors: ['reference: not an object'] };
  }
  if (!nonEmptyString(reference.version)) errors.push('reference: version is required');
  if (!nonEmptyString(reference.sourceId)) errors.push('reference: sourceId is required');
  if (!Array.isArray(reference.menus)) errors.push('reference: menus must be an array');
  const seen = new Set();
  for (const menu of Array.isArray(reference.menus) ? reference.menus : []) {
    const title = String(menu.title || '').trim();
    if (!title) errors.push('menu: title is required');
    if (!nonEmptyString(menu.captureKey)) errors.push(`menu ${title}: captureKey is required`);
    for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
      const path = Array.isArray(category.path) ? category.path : [];
      if (path.length === 0) errors.push(`menu ${title}: category without path`);
      if (title && normalizeQuoteText(path[0]) !== normalizeQuoteText(title)) {
        errors.push(`menu ${title}: category path must start with the menu title (${path.join(' › ')})`);
      }
      for (const item of Array.isArray(category.items) ? category.items : []) {
        const key = `${normalizeQuoteText(item.name)}\u0000${normalizeQuoteText(path.join(' › '))}`;
        if (seen.has(key)) errors.push(`duplicate reference item: ${item.name} in ${path.join(' › ')}`);
        seen.add(key);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  decodeEntities,
  htmlVisibleText,
  normalizeQuoteText,
  validateReferenceShape,
  verifyReferenceQuotes,
};
