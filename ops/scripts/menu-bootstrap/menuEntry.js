'use strict';

// BE-71 (#176, besluit 021) — the output side, deliberately separate from
// fetching and reading (besluit 021 §4): today it writes the existing
// data/menus.json shape, later the same engine can feed the pipeline.
//
// The entry keeps exactly the established shape (see "6-diner" in
// data/menus.json): subtitle, an optional title, scraped, source, notes and
// categories with the existing item fields. src/lib/menuExport.js's own
// buildMenuEntry / applyExport do the mapping, so a dish that already exists on
// the live card keeps its published enrichment.

const { buildMenuEntry, menuKeyFor, restaurantMenuEntries } = require('../../../src/lib/menuExport');

const NOTES = 'Opgehaald van de eigen website van het restaurant. Controleer altijd de actuele kaart.';
const MENU_SORT = 'menukaart';

// Lead-review ronde 2 (#176): the soort comes from the card's own url and page
// title, and uses the keys, subtitles and labels this repository already
// prints (data/menus.json and data/restaurants.json). A restaurant may have
// more than one card: each keeps its own key (`<id>-lunch`, `<id>-diner`, …).
const MENU_VARIANTS = {
  lunch: { subtitle: 'Lunchkaart', label: '🥗 Lunchkaart' },
  diner: { subtitle: 'Dinerkaart', label: '🍽 Dinerkaart' },
  borrel: { subtitle: 'Borrelkaart', label: '🍸 Borrelkaart' },
  afhaal: { subtitle: 'Afhaalkaart', label: '🥡 Afhaalkaart' },
  menukaart: { subtitle: 'Menukaart', label: '📋 Menukaart' },
};

// Longest word first, so "lunchkaart" is not read as the shorter "kaart".
// A closed list of daypart/menu words, never a fuzzy match.
const SCOPE_PATTERN =
  /(lunchkaart|lunchmenu|lunchgerechten|lunch|dinerkaart|dinnermenu|dineren|diner|avondkaart|avondmenu|borrelkaart|borrelhapjes|borrel|afhaalkaart|afhaalmenu|afhaalgerechten|afhalen|afhaal|takeaway|take-away|meeneem)/gi;
const SCOPE_BY_WORD = { lunchkaart: 'lunch', lunchmenu: 'lunch', lunchgerechten: 'lunch', lunch: 'lunch', dinerkaart: 'diner', dinnermenu: 'diner', dineren: 'diner', diner: 'diner', avondkaart: 'diner', avondmenu: 'diner', borrelkaart: 'borrel', borrelhapjes: 'borrel', borrel: 'borrel', afhaalkaart: 'afhaal', afhaalmenu: 'afhaal', afhaalgerechten: 'afhaal', afhalen: 'afhaal', afhaal: 'afhaal', takeaway: 'afhaal', 'take-away': 'afhaal', meeneem: 'afhaal' };

function scopeInText(text) {
  const value = String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  SCOPE_PATTERN.lastIndex = 0;
  const match = SCOPE_PATTERN.exec(value);
  return match ? SCOPE_BY_WORD[match[1].toLowerCase()] || null : null;
}

/**
 * The soort of one card: the url decides (that is the page actually read), the
 * page title is the fallback. No daypart word at all means "menukaart".
 */
function menuScopeFor({ sourceUrl, title } = {}) {
  const haystacks = [];
  try {
    const parsed = new URL(String(sourceUrl || ''));
    haystacks.push(`${decodeURIComponent(parsed.pathname)} ${parsed.search}`);
  } catch {
    haystacks.push(String(sourceUrl || ''));
  }
  if (typeof title === 'string' && title.trim()) haystacks.push(title);
  for (const haystack of haystacks) {
    const scope = scopeInText(haystack);
    if (scope) return scope;
  }
  return MENU_SORT;
}

/** The data/menus.json key of one card: `<restaurantId>-<soort>`. */
function menuKey(restaurantId, scope) {
  const kind = scope && MENU_VARIANTS[scope] ? scope : MENU_SORT;
  return `${restaurantId}-${kind}`;
}

/** One neutral read menu as the content shape the existing export expects. */
function menuContent(menu) {
  return {
    // The page title is used for the soort of the card (see menuScopeFor); it
    // is not part of the data/menus.json shape, which prints a subtitle.
    title: null,
    categories: ((menu && menu.categories) || []).map((category) => ({
      name: category.name,
      ...(Array.isArray(category.path) && category.path.length > 1 ? { path: category.path } : {}),
      items: (category.items || []).map((item) => ({ name: item.name, desc: item.desc || '', price: item.price })),
    })),
  };
}

/** Marks the dishes whose printed amount is a supplement, so the existing
 * data shape carries `priceIsSupplement` (buildMenuEntry fills the field, but
 * only this read knows it). Category and item order is one-to-one with the
 * reader's own output. */
function markSupplements(categories, menu) {
  const source = (menu && menu.categories) || [];
  categories.forEach((category, categoryIndex) => {
    const read = source[categoryIndex] || {};
    (category.items || []).forEach((item, itemIndex) => {
      if (((read.items || [])[itemIndex] || {}).priceIsSupplement === true) item.priceIsSupplement = true;
    });
  });
  return categories;
}

/** The one data/menus.json entry for this restaurant, in file order. */
function buildEntry({ restaurantId, menu, menus, sourceUrl, scraped, scope }) {
  const built = buildMenuEntry({
    content: menuContent(menu),
    currentEntries: restaurantMenuEntries(menus, restaurantId),
    sourceUrl,
    scraped,
  });
  const kind = scope || menuScopeFor({ sourceUrl, title: menu && menu.title });
  const variant = MENU_VARIANTS[kind] || MENU_VARIANTS[MENU_SORT];
  return {
    subtitle: variant.subtitle,
    ...(built.title ? { title: built.title } : {}),
    scraped: built.scraped,
    source: built.source,
    notes: NOTES,
    categories: markSupplements(built.categories, menu),
  };
}

/**
 * The key, the soort and the entry of one card, in one step: a restaurant may
 * hold more than one card, each under its own `<restaurantId>-<soort>` key.
 */
function buildExport({ restaurantId, menu, menus, sourceUrl, scraped }) {
  const scope = menuScopeFor({ sourceUrl, title: menu && menu.title });
  return {
    key: menuKey(restaurantId, scope),
    scope,
    subtitle: (MENU_VARIANTS[scope] || MENU_VARIANTS[MENU_SORT]).subtitle,
    entry: buildEntry({ restaurantId, menu, menus, sourceUrl, scraped, scope }),
  };
}

/**
 * New data/menus.json content: this card replaces the entry with the same key
 * at its own position; a new key is placed directly after the restaurant's
 * other cards. The restaurant's other cards stay untouched (a lunch and a
 * dinner card are two entries). Only the menus half of applyExport is used;
 * the menuLinks half belongs to its own commit.
 */
function applyMenuItem({ menus, restaurantId, entry, key }) {
  const target = key || menuKeyFor(restaurantId);
  const source = menus || {};
  const keys = Object.keys(source);
  const next = {};
  if (keys.includes(target)) {
    for (const k of keys) next[k] = k === target ? entry : source[k];
    return next;
  }
  // A new card goes directly after the restaurant's other cards.
  let insertAfter = -1;
  keys.forEach((k, index) => {
    if (k.startsWith(`${restaurantId}-`)) insertAfter = index;
  });
  keys.forEach((k, index) => {
    next[k] = source[k];
    if (index === insertAfter) next[target] = entry;
  });
  if (insertAfter === -1) next[target] = entry;
  return next;
}

/**
 * The menuLinks for every card of this restaurant (its own commit): each
 * existing key keeps the label the data already prints, a new key gets the
 * label of its soort. A link to a card that no longer exists is dropped.
 */
function menuLinksFor({ menus, restaurantId, currentLinks }) {
  const existing = new Map();
  for (const link of Array.isArray(currentLinks) ? currentLinks : []) {
    if (link && typeof link.id === 'string') existing.set(link.id, link.label);
  }
  const links = [];
  for (const key of Object.keys(menus || {})) {
    if (!key.startsWith(`${restaurantId}-`)) continue;
    const scope = key.slice(restaurantId.length + 1);
    const label = existing.get(key) || (MENU_VARIANTS[scope] || MENU_VARIANTS[MENU_SORT]).label;
    links.push({ id: key, label });
  }
  return links;
}

module.exports = {
  NOTES,
  MENU_SORT,
  MENU_VARIANTS,
  menuKeyFor,
  menuScopeFor,
  menuKey,
  menuContent,
  buildEntry,
  buildExport,
  applyMenuItem,
  menuLinksFor,
};
