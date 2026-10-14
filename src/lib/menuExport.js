'use strict';

// BE-27 "Maak review-PR" — pure generation of the static menu change for one
// internally approved menu concept. No network, no database, no filesystem.
//
// One complete, consistent menu for exactly one restaurant:
//   - data/menus.json: every "<restaurantId>-*" menu of that restaurant is
//     replaced by one "<restaurantId>-menukaart" entry holding the whole
//     approved concept (the concept was compared against all of them);
//   - data/restaurants.json: only that restaurant's `menuLinks`, so its
//     page links the new menu instead of removed dayparts.
// No business data is exported: name, address, phone, website, opening
// hours and every other restaurant field stay exactly as they are.
// The files keep their existing formatting (2-space JSON, trailing newline).

const { normalizeName } = require('./menuConcept');

const MENU_SUFFIX = 'menukaart';
const MENU_LINK_LABEL = '📋 Menukaart';

function menuKeyFor(restaurantId) {
  return `${restaurantId}-${MENU_SUFFIX}`;
}

function belongsTo(key, restaurantId) {
  return key.startsWith(`${restaurantId}-`);
}

/** "14.50" → "€14,50"; "85.00" → "€85" (the existing data/menus.json notation). */
function formatEuro(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return null;
  const whole = Math.round(value * 100) % 100 === 0;
  return `€${whole ? String(Math.round(value)) : value.toFixed(2).replace('.', ',')}`;
}

/** The restaurant's current menu entries in data/menus.json, in file order. */
function restaurantMenuEntries(menus, restaurantId) {
  const out = {};
  for (const [key, value] of Object.entries(menus || {})) if (belongsTo(key, restaurantId)) out[key] = value;
  return out;
}

/**
 * The one "<restaurantId>-menukaart" entry for an approved concept. Dishes
 * that also exist on the current menu keep their published enrichment
 * (tags, allergens, wine, supplement) and description when the concept has
 * none; prices, names and sections come from the approved concept.
 */
function buildMenuEntry({ content, currentEntries, sourceUrl, scraped }) {
  const enrichment = new Map();
  for (const entry of Object.values(currentEntries || {})) {
    for (const category of (entry && entry.categories) || []) {
      for (const item of (category && category.items) || []) {
        if (item && typeof item.name === 'string' && !enrichment.has(normalizeName(item.name))) enrichment.set(normalizeName(item.name), item);
      }
    }
  }
  const categories = ((content && content.categories) || []).map((category) => ({
    name: category.name,
    items: (category.items || []).map((item) => {
      const known = enrichment.get(normalizeName(item.name)) || {};
      const price = formatEuro(item.price);
      if (!price) throw new Error(`export_incomplete: ${item.name} has no price`);
      const out = {
        name: item.name,
        desc: item.desc || known.desc || '',
        price,
        priceValue: Number(Number(item.price).toFixed(2)),
        priceOnRequest: false,
        priceIsSupplement: false,
        priceIsFrom: false,
        priceIsMultiple: false,
        tags: Array.isArray(known.tags) ? known.tags : [],
        allergens: Array.isArray(known.allergens) ? known.allergens : [],
      };
      if (known.wine) out.wine = known.wine;
      if (known.sup) out.sup = known.sup;
      return out;
    }),
  }));
  if (!categories.some((c) => c.items.length > 0)) throw new Error('export_incomplete: no dishes');
  return { subtitle: 'Menukaart', scraped, source: sourceUrl, categories };
}

/**
 * New file contents: the restaurant's menus replaced by one entry (at the
 * position of its first existing menu, or appended), and its menuLinks
 * pointing at that entry. Every other key is carried over untouched.
 */
function applyExport({ menus, restaurants, restaurantId, entry }) {
  if (!restaurants || !restaurants[restaurantId]) throw new Error('export_unknown_restaurant');
  const key = menuKeyFor(restaurantId);
  const nextMenus = {};
  let placed = false;
  for (const [k, v] of Object.entries(menus)) {
    if (belongsTo(k, restaurantId)) {
      if (!placed) {
        nextMenus[key] = entry;
        placed = true;
      }
      continue;
    }
    nextMenus[k] = v;
  }
  if (!placed) nextMenus[key] = entry;

  const nextRestaurants = {};
  for (const [id, r] of Object.entries(restaurants)) {
    if (id !== restaurantId) {
      nextRestaurants[id] = r;
      continue;
    }
    const links = [{ id: key, label: MENU_LINK_LABEL }];
    nextRestaurants[id] = 'menuLinks' in r ? Object.fromEntries(Object.entries(r).map(([f, v]) => [f, f === 'menuLinks' ? links : v])) : { ...r, menuLinks: links };
  }
  return { menus: nextMenus, restaurants: nextRestaurants };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Defensive scope check on the generated files: only this restaurant's menu
 * keys in menus.json and only its menuLinks in restaurants.json may differ.
 * Returns the list of violations (empty when the export is in scope).
 */
function exportScopeViolations({ before, after, restaurantId }) {
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const menuKeys = new Set([...Object.keys(before.menus), ...Object.keys(after.menus)]);
  for (const k of menuKeys) if (!belongsTo(k, restaurantId) && !same(before.menus[k], after.menus[k])) problems.push(`menus:${k}`);
  const ids = new Set([...Object.keys(before.restaurants), ...Object.keys(after.restaurants)]);
  for (const id of ids) {
    const a = before.restaurants[id];
    const b = after.restaurants[id];
    if (id !== restaurantId) {
      if (!same(a, b)) problems.push(`restaurants:${id}`);
      continue;
    }
    const fields = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const f of fields) if (f !== 'menuLinks' && !same(a && a[f], b && b[f])) problems.push(`restaurants:${id}.${f}`);
  }
  return problems;
}

module.exports = {
  MENU_SUFFIX,
  menuKeyFor,
  formatEuro,
  restaurantMenuEntries,
  buildMenuEntry,
  applyExport,
  serialize,
  exportScopeViolations,
};
