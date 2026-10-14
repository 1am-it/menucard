// BE-25 — Menukaartcontrole → concept v1: pure logic shared by the
// Batchanalyse page and its server handler. No fetch, no database.
//
// Input: the dishes a batch analysis recognised (the receipt's bounded
// candidate_summary.menus — durable, never re-fetched), the restaurant's
// current published menu lines (data/menus.json, read only) and the staff
// member's edits. Output: one line per dish with a status, the attention
// points and blockers, and the internal concept content that may be saved
// as a BE-17 menu snapshot proposal (internal, needs review, never public).
//
// Nothing slips through unmarked: a missing price, an unclear category, a
// duplicate dish and a dish that would disappear from the current menu are
// blockers until a human fixes, excludes or explicitly accepts them.

'use strict';

const UNCLEAR_CATEGORY_NAMES = new Set(['', 'menu', 'menukaart', 'kaart', 'categorie', 'overig', 'overige', 'diversen']);
const MAX_CATEGORY_NAME = 60;
const MAX_NAME = 120;

const STATUS = {
  unchanged: { label: 'Ongewijzigd', blocker: false, attention: false },
  new: { label: 'Nieuw', blocker: false, attention: false },
  price_changed: { label: 'Prijs gewijzigd', blocker: false, attention: true },
  missing_price: { label: 'Prijs ontbreekt', blocker: true, attention: true },
  unclear_category: { label: 'Rubriek onduidelijk', blocker: true, attention: true },
  duplicate: { label: 'Dubbel gerecht', blocker: true, attention: true },
  excluded: { label: 'Uitgesloten', blocker: false, attention: false },
};

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "14,50", "14.5", "€ 9", "12,-" → "14.50"; anything else → null. */
function normalizePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 && value <= 500 ? value.toFixed(2) : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(?:€\s*)?(\d{1,3})(?:[.,](\d{1,2}))?(?:\s*,[-–])?\s*(?:€)?\s*$/.exec(value);
  if (!match) return null;
  const cents = match[2] === undefined ? 0 : Number(match[2].length === 1 ? `${match[2]}0` : match[2]);
  const amount = Number(match[1]) + cents / 100;
  return amount > 0 && amount <= 500 ? amount.toFixed(2) : null;
}

function displayPrice(price) {
  return price ? `€ ${price.replace('.', ',')}` : null;
}

function isUnclearCategory(name) {
  const text = String(name || '').trim();
  return UNCLEAR_CATEGORY_NAMES.has(text.toLowerCase()) || text.length > MAX_CATEGORY_NAME;
}

/** The recognised dishes, flattened with a stable id per line. */
function recognisedLines(menus) {
  const lines = [];
  (Array.isArray(menus) ? menus : []).forEach((menu, m) => {
    ((menu && Array.isArray(menu.categories) && menu.categories) || []).forEach((category, c) => {
      ((category && Array.isArray(category.items) && category.items) || []).forEach((item, i) => {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) return;
        lines.push({
          id: `${m}.${c}.${i}`,
          name: item.name.trim().slice(0, MAX_NAME),
          desc: typeof item.desc === 'string' && item.desc.trim() ? item.desc.trim() : null,
          price: normalizePrice(item.price),
          category: category && typeof category.name === 'string' ? category.name.trim() : '',
        });
      });
    });
  });
  return lines;
}

/** Summary for the control view: categories with dishes and prices. */
function summarizeRecognisedMenu(menus) {
  const lines = recognisedLines(menus);
  const categories = [];
  for (const line of lines) {
    let category = categories.find((c) => c.name === line.category);
    if (!category) {
      category = { name: line.category || 'Zonder rubriek', items: [] };
      categories.push(category);
    }
    category.items.push({ id: line.id, name: line.name, price: displayPrice(line.price) });
  }
  const names = new Map();
  for (const line of lines) names.set(normalizeName(line.name), (names.get(normalizeName(line.name)) || 0) + 1);
  const attention = [];
  for (const line of lines) {
    if (!line.price) attention.push({ id: line.id, name: line.name, reason: 'Prijs ontbreekt' });
    else if (names.get(normalizeName(line.name)) > 1) attention.push({ id: line.id, name: line.name, reason: 'Komt meer dan eens voor' });
    else if (isUnclearCategory(line.category)) attention.push({ id: line.id, name: line.name, reason: 'Rubriek onduidelijk' });
  }
  return { itemCount: lines.length, categoryCount: categories.length, categories, attention };
}

/** The restaurant's current published menu lines (data/menus.json entries
 * whose key starts with "<restaurantId>-"). */
function liveMenuLines(liveMenus, restaurantId) {
  const lines = [];
  if (!liveMenus || typeof liveMenus !== 'object' || !restaurantId) return lines;
  for (const [key, menu] of Object.entries(liveMenus)) {
    if (!key.startsWith(`${restaurantId}-`) || !menu || !Array.isArray(menu.categories)) continue;
    menu.categories.forEach((category, c) => {
      ((category && Array.isArray(category.items) && category.items) || []).forEach((item, i) => {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) return;
        lines.push({
          id: `live:${key}.${c}.${i}`,
          name: item.name.trim(),
          desc: typeof item.desc === 'string' && item.desc.trim() ? item.desc.trim() : null,
          price: normalizePrice(typeof item.priceValue === 'number' ? item.priceValue : item.price),
          category: category && typeof category.name === 'string' ? category.name.trim() : '',
        });
      });
    });
  }
  return lines;
}

/**
 * The concept.
 *   menus:     recognised menus (candidate_summary.menus)
 *   liveLines: liveMenuLines(...) for the restaurant
 *   edits:     { lines: { [id]: { exclude?, name?, price?, category?, accept? } }, removed?: 'keep' | 'remove' }
 */
function buildMenuConcept({ menus, liveLines, edits }) {
  const lineEdits = (edits && edits.lines && typeof edits.lines === 'object' && edits.lines) || {};
  const removedDecision = edits && (edits.removed === 'keep' || edits.removed === 'remove') ? edits.removed : null;
  const live = Array.isArray(liveLines) ? liveLines : [];
  const liveByName = new Map();
  for (const l of live) if (!liveByName.has(normalizeName(l.name))) liveByName.set(normalizeName(l.name), l);

  const lines = recognisedLines(menus).map((line) => {
    const e = Object.prototype.hasOwnProperty.call(lineEdits, line.id) ? lineEdits[line.id] || {} : {};
    const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, MAX_NAME) : line.name;
    const editedPrice = e.price !== undefined && e.price !== null && e.price !== '' ? normalizePrice(String(e.price)) : undefined;
    const price = editedPrice !== undefined ? editedPrice : line.price;
    const category = typeof e.category === 'string' && e.category.trim() ? e.category.trim().slice(0, MAX_CATEGORY_NAME) : line.category;
    return { ...line, original: { name: line.name, price: line.price, category: line.category }, name, price, category, excluded: e.exclude === true, accepted: e.accept === true, edited: Boolean(e.name || e.price || e.category) };
  });

  const included = lines.filter((l) => !l.excluded);
  const nameCount = new Map();
  for (const l of included) nameCount.set(normalizeName(l.name), (nameCount.get(normalizeName(l.name)) || 0) + 1);

  for (const l of lines) {
    const liveMatch = liveByName.get(normalizeName(l.name));
    if (l.excluded) l.status = 'excluded';
    else if (!l.price) l.status = 'missing_price';
    else if (isUnclearCategory(l.category) && !l.accepted) l.status = 'unclear_category';
    else if (nameCount.get(normalizeName(l.name)) > 1 && !l.accepted) l.status = 'duplicate';
    else if (liveMatch && liveMatch.price && liveMatch.price !== l.price) l.status = 'price_changed';
    else if (liveMatch) l.status = 'unchanged';
    else l.status = 'new';
    l.livePrice = liveMatch ? liveMatch.price : null;
  }

  const recognisedNames = new Set(included.map((l) => normalizeName(l.name)));
  const removed = live.filter((l) => !recognisedNames.has(normalizeName(l.name)));

  const blockers = lines.filter((l) => STATUS[l.status].blocker).map((l) => ({ id: l.id, name: l.name, status: l.status, label: STATUS[l.status].label }));
  if (removed.length > 0 && !removedDecision) {
    blockers.push({ id: 'removed', name: null, status: 'removed', label: `${removed.length} ${removed.length === 1 ? 'gerecht' : 'gerechten'} van de huidige kaart ontbreken in de bron` });
  }

  const counts = {};
  for (const l of lines) counts[l.status] = (counts[l.status] || 0) + 1;

  const conceptCategories = [];
  const add = (categoryName, item) => {
    let c = conceptCategories.find((x) => x.name === categoryName);
    if (!c) {
      c = { name: categoryName, items: [] };
      conceptCategories.push(c);
    }
    c.items.push(item);
  };
  for (const l of included) add(l.category, { name: l.name, desc: l.desc, price: l.price });
  if (removedDecision === 'keep') for (const l of removed) add(l.category || 'Huidige kaart', { name: l.name, desc: l.desc, price: l.price });

  return {
    lines,
    removed,
    removedDecision,
    blockers,
    canSave: blockers.length === 0 && conceptCategories.some((c) => c.items.length > 0),
    counts,
    safeCount: lines.filter((l) => l.status === 'unchanged' || l.status === 'new').length,
    attentionLines: lines.filter((l) => STATUS[l.status].attention),
    content: { categories: conceptCategories },
  };
}

module.exports = {
  STATUS,
  normalizeName,
  normalizePrice,
  displayPrice,
  isUnclearCategory,
  recognisedLines,
  summarizeRecognisedMenu,
  liveMenuLines,
  buildMenuConcept,
};
