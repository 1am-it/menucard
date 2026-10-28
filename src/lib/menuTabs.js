'use strict';

// BE-42 (#98) — 2A: de menukaarten van één restaurant als tabbladen.
//
// Bewust een pure module zonder React, net als src/lib/restaurantBrowse.js: de
// serverpagina bouwt hiermee het kaartmodel, zodat de vaste volgorde, de
// standaardkaart en de tabkeuze zonder browser en zonder klok testbaar zijn.
//
// Regels die hier vastliggen (contract criterium 2):
// - volgorde: lunch, diner, borrel, daarna overige (specialiteiten en elk
//   onbekend menutype), binnen "overige" de volgorde van de kaartlinks;
// - standaardtabblad is de eerste kaart in die volgorde. Er wordt hier geen
//   klok, datum of `Intl` gebruikt, dus de server-HTML is niet tijdsafhankelijk
//   (de BE-29-regel);
// - het model draagt de inhoud van precies één kaart: de gekozen kaart. De
//   andere kaarten leveren alleen hun naam en hun aantal gerechten, nooit hun
//   gerechten (zuinig, eis < 250 KB);
// - alleen gepubliceerde kaarten (de `menuLinks` van het restaurant) én
//   kaarten met echte data worden een tabblad; er wordt niets verzonnen.

const MENU_ACTION = 'kaart';

// De vaste volgorde van het eigenaarsbesluit (28 okt): lunch, diner, borrel,
// overige. `specialiteiten` is een bekend "overige"-type en houdt daar zijn
// eigen titel; elk ander type valt terug op de titel van de kaart zelf.
const MENU_TAB_ORDER = ['lunch', 'diner', 'borrel'];
const OVERIGE_RANK = MENU_TAB_ORDER.length;

const MENU_TITLES = {
  lunch: 'Lunchkaart',
  diner: 'Dinerkaart',
  borrel: 'Borrelkaart',
  specialiteiten: 'Specialiteiten',
};

const FALLBACK_TITLE = 'Menukaart';

/** Het menutype van een kaart-id (`"6-diner"` → `"diner"`); '' als het ontbreekt. */
function mealTypeOf(menuId) {
  const parts = String(menuId == null ? '' : menuId).split('-');
  return parts.length > 1 ? parts.slice(1).join('-') : '';
}

/** De zichtbare naam van een kaart: het bekende menutype, anders de eigen titel. */
function menuTitleOf(menuId, entry) {
  const mealType = mealTypeOf(menuId);
  if (MENU_TITLES[mealType]) return MENU_TITLES[mealType];
  const title = entry && typeof entry.title === 'string' ? entry.title.trim() : '';
  if (title) return title;
  const subtitle = entry && typeof entry.subtitle === 'string' ? entry.subtitle.trim() : '';
  return subtitle || FALLBACK_TITLE;
}

/** Het aantal gerechten van een hele kaart, over alle menukopjes samen. */
function dishCountOf(entry) {
  const categories = entry && Array.isArray(entry.categories) ? entry.categories : [];
  return categories.reduce(
    (total, category) => total + (category && Array.isArray(category.items) ? category.items.length : 0),
    0
  );
}

function orderRank(menuId) {
  const rank = MENU_TAB_ORDER.indexOf(mealTypeOf(menuId));
  return rank === -1 ? OVERIGE_RANK : rank;
}

/** Stabiele sortering op de vaste volgorde; gelijke rang houdt de eigen volgorde. */
function orderMenuIds(menuIds) {
  return (Array.isArray(menuIds) ? menuIds : [])
    .map((menuId, index) => ({ menuId, index }))
    .sort((a, b) => (orderRank(a.menuId) - orderRank(b.menuId)) || (a.index - b.index))
    .map((entry) => entry.menuId);
}

/** De href van een tabblad: een echte link die de server kan renderen. */
function menuTabHref(restaurantId, menuId) {
  return `/restaurant/${restaurantId}?${MENU_ACTION}=${encodeURIComponent(menuId)}`;
}

/**
 * Het tabmodel van één restaurant plus de ene gekozen kaart.
 *
 * @param {object} options
 * @param {string} options.restaurantId
 * @param {Array<{id?:string,label?:string}>} options.menuLinks  gepubliceerde kaarten
 * @param {object} options.menus  de volledige menus.json (alleen server-side)
 * @param {string} [options.requested]  de `?kaart=`-waarde uit de URL
 * @returns {{tabs:Array<{id:string,label:string,dishCount:number,href:string,active:boolean}>,
 *   activeId:string,activeMenu:object}|null}
 */
function restaurantMenus({ restaurantId, menuLinks, menus, requested } = {}) {
  const all = menus && typeof menus === 'object' ? menus : {};
  const restaurant = String(restaurantId == null ? '' : restaurantId);
  const prefix = `${restaurant}-`;
  const links = Array.isArray(menuLinks) ? menuLinks : [];

  const ids = orderMenuIds(
    links
      .map((link) => (link && typeof link.id === 'string' ? link.id : ''))
      .filter((menuId) => menuId.startsWith(prefix) && menuId.length > prefix.length && Boolean(all[menuId]))
  );
  if (ids.length === 0) return null;

  const tabs = ids.map((menuId) => ({
    id: menuId,
    label: menuTitleOf(menuId, all[menuId]),
    dishCount: dishCountOf(all[menuId]),
    href: menuTabHref(restaurant, menuId),
  }));

  // Standaardtabblad: de eerste kaart in de vaste volgorde, nooit de klok. Een
  // onbekende of vreemde `?kaart=` valt daarom terug op die eerste kaart.
  const requestedId = typeof requested === 'string' ? requested : '';
  const activeId = ids.includes(requestedId) ? requestedId : ids[0];
  const activeEntry = all[activeId];

  return {
    tabs: tabs.map((tab) => ({ ...tab, active: tab.id === activeId })),
    activeId,
    // Precies één kaart: de gekozen. De andere kaarten gaan niet mee.
    activeMenu: {
      id: activeId,
      label: menuTitleOf(activeId, activeEntry),
      dishCount: dishCountOf(activeEntry),
      notes: activeEntry.notes || null,
      source: activeEntry.source || null,
      scraped: activeEntry.scraped || null,
      categories: Array.isArray(activeEntry.categories) ? activeEntry.categories : [],
    },
  };
}

/**
 * Het restaurantrecord zoals de view het nodig heeft: zonder de volledige
 * kopie van alle menukaarten die data/restaurants.json per restaurant meedraagt
 * (`menus`). Die tweede kopie ging sinds BE-08 als prop naar de browser en
 * zette zo alle kaarten tóch in de HTML; de view gebruikt hem nergens. De
 * oorspronkelijke data blijft onaangeroerd (geen mutatie).
 */
function restaurantForView(restaurant) {
  if (!restaurant || typeof restaurant !== 'object') return null;
  if (!('menus' in restaurant)) return restaurant;
  const { menus: embeddedMenus, ...rest } = restaurant;
  return rest;
}

module.exports = {
  MENU_ACTION,
  MENU_TAB_ORDER,
  MENU_TITLES,
  FALLBACK_TITLE,
  mealTypeOf,
  menuTitleOf,
  dishCountOf,
  orderMenuIds,
  menuTabHref,
  restaurantMenus,
  restaurantForView,
};
