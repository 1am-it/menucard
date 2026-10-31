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

const { buildMenuEntry, applyExport, menuKeyFor, restaurantMenuEntries } = require('../../../src/lib/menuExport');

const NOTES = 'Opgehaald van de eigen website van het restaurant. Controleer altijd de actuele kaart.';
const MENU_SORT = 'menukaart';

/** One neutral read menu as the content shape the existing export expects. */
function menuContent(menu) {
  return {
    title: menu && typeof menu.title === 'string' ? menu.title : null,
    categories: ((menu && menu.categories) || []).map((category) => ({
      name: category.name,
      ...(Array.isArray(category.path) && category.path.length > 1 ? { path: category.path } : {}),
      items: (category.items || []).map((item) => ({ name: item.name, desc: item.desc || '', price: item.price })),
    })),
  };
}

/** The one data/menus.json entry for this restaurant, in file order. */
function buildEntry({ restaurantId, menu, menus, sourceUrl, scraped }) {
  const built = buildMenuEntry({
    content: menuContent(menu),
    currentEntries: restaurantMenuEntries(menus, restaurantId),
    sourceUrl,
    scraped,
  });
  return {
    subtitle: built.subtitle,
    ...(built.title ? { title: built.title } : {}),
    scraped: built.scraped,
    source: built.source,
    notes: NOTES,
    categories: built.categories,
  };
}

/**
 * New data/menus.json content: this restaurant's menus replaced by the one
 * new card at the position of its first existing menu. Only the menus half of
 * applyExport is used; the menuLinks half belongs to its own commit.
 */
function applyMenuItem({ menus, restaurants, restaurantId, entry }) {
  const applied = applyExport({ menus, restaurants, restaurantId, entry });
  return applied.menus;
}

/** The menuLinks for this restaurant's new card (its own commit). */
function menuLinksFor({ menus, restaurants, restaurantId, entry }) {
  return applyExport({ menus, restaurants, restaurantId, entry }).restaurants[restaurantId].menuLinks;
}

module.exports = { NOTES, MENU_SORT, menuKeyFor, menuContent, buildEntry, applyMenuItem, menuLinksFor };
